"""SQLite ↔ Firebase sinxronizatsiyasi.

Nima uchun kerak: Render'ning bepul tarifida disk saqlanmaydi — qayta
deployda SQLite fayli tozalanadi. Firebase ulangan bo'lsa:

  • ro'yxatdan o'tgan mijoz va uning tanlagan mashinasi Firebase'ga yoziladi;
  • bot ishga tushganda mijozlar Firebase'dan qaytarib olinadi
    → foydalanuvchi hech qachon qaytadan ro'yxatdan o'tmaydi ("bir umrlik");
  • tovarlar (rasm URL'lari bilan) Firebase'dan import qilinadi
    → rasmlarni saytdan boshqarish mumkin;
  • har bir buyurtma nusxasi Firebase'ga tushadi (tarix yo'qolmaydi).

Firebase sozlanmagan bo'lsa — hamma funksiya jimgina o'tib ketadi.
"""

import asyncio
import logging
import time
from datetime import datetime

from config import config, remove_runtime_admin, set_runtime_admins
from database import queries as q
from services import firebase
from utils.helpers import TZ

logger = logging.getLogger(__name__)

# Firebase hozir tayyor bo'lmasa (token olinmagan, internet uzilgan) yozuvlar
# shu navbatda turadi va `retry_worker()` ularni keyin qaytadan yuboradi.
# Shu sababli bitta vaqtinchalik uzilish mijoz ma'lumotini "yo'qotmaydi".
_pending: dict[str, dict] = {}
_PENDING_LIMIT = 500


def pending_count() -> int:
    return len(_pending)


async def _send(method: str, path: str, payload) -> bool:
    if method == "put":
        return await firebase.put(path, payload)
    return await firebase.patch(path, payload)


async def _write(path: str, payload, *, method: str = "patch") -> bool:
    """Firebase'ga yozadi; imkoni bo'lmasa navbatga qo'yadi."""
    if not config.has_firebase:
        return False

    if firebase.is_enabled() and await _send(method, path, payload):
        _pending.pop(path, None)
        return True

    if len(_pending) < _PENDING_LIMIT:
        _pending[path] = {"payload": payload, "method": method}
        logger.info("Firebase tayyor emas — yozuv navbatga qo'yildi: %s", path)
    return False


async def flush_pending() -> int:
    """Navbatda turgan yozuvlarni qaytadan yuborishga urinadi."""
    if not _pending or not firebase.is_enabled():
        return 0
    sent = 0
    for path, item in list(_pending.items()):
        if await _send(item["method"], path, item["payload"]):
            _pending.pop(path, None)
            sent += 1
    if sent:
        logger.info("Navbatdagi %s yozuv Firebase'ga yuborildi", sent)
    return sent


async def retry_worker(interval: int = 60) -> None:
    """Fon vazifasi: navbatdagi yozuvlarni vaqti-vaqti bilan yuboradi."""
    while True:
        await asyncio.sleep(interval)
        try:
            await flush_pending()
        except Exception as error:  # fon vazifasi to'xtamasligi kerak
            logger.warning("Navbatni yuborishda xato: %s", error)


# ------------------------------------------------------------------ mijozlar


def _profile_payload(user_id: int, profile: dict) -> dict:
    return {
        "uid": user_id,
        "name": profile.get("full_name"),
        "phone": profile.get("phone"),
        "username": profile.get("username") or "",
        "carId": profile.get("car_id"),
        "carName": profile.get("car_name"),
        "source": "zimmer",
        "updatedAt": int(time.time() * 1000),
    }


async def push_user(user_id: int, profile: dict) -> None:
    """Mijoz profilini Firebase'ga yozadi (Avto_A1 bilan bir xil ko'rinishda)."""
    await _write(f"users/{user_id}/profile", _profile_payload(user_id, profile))


async def fetch_user(user_id: int) -> dict | None:
    """Firebase'dan BITTA mijoz profilini oladi.

    Mahalliy baza tozalanib ketgan bo'lsa ham, mijoz birinchi xabar
    yozganda uni shu funksiya orqali darhol "tanib" olamiz.
    """
    if not firebase.is_enabled():
        return None
    node = await firebase.get(f"users/{user_id}")
    if not isinstance(node, dict):
        return None
    profile = node.get("profile")
    return profile if isinstance(profile, dict) else node


async def push_favorites(user_id: int) -> None:
    """«Saqlanganlar» ro'yxatini bulutga yozadi.

    Tovar ID'lari baza tozalangandan keyin o'zgaradi, shuning uchun
    NOMLAR saqlanadi — katalog kabi.
    """
    try:
        names = await q.get_favorite_names(user_id)
    except Exception as error:
        logger.warning("Saqlanganlar o'qilmadi (%s): %s", user_id, error)
        return
    await _write(
        f"users/{user_id}/favorites",
        {"names": names, "updatedAt": int(time.time() * 1000)},
        method="put",
    )


async def restore_favorites() -> int:
    """Mijozlarning «Saqlanganlar» ro'yxatini bulutdan qaytaradi."""
    if not firebase.is_enabled():
        return 0

    node = await firebase.get("users")
    restored = 0
    for key, value in firebase.items(node):
        saved = value.get("favorites")
        if not isinstance(saved, dict):
            continue
        names = saved.get("names")
        if isinstance(names, dict):
            names = list(names.values())
        if not isinstance(names, list):
            continue
        try:
            user_id = int(value.get("profile", {}).get("uid") or key)
        except (TypeError, ValueError):
            continue
        for name in names:
            try:
                if await q.add_favorite_by_name(user_id, str(name)):
                    restored += 1
            except Exception as error:
                logger.warning("«%s» saqlanganlarga qo'shilmadi: %s", name, error)

    if restored:
        logger.info("Firebase'dan %s saqlangan tovar qaytarildi", restored)
    return restored


async def restore_users() -> int:
    """Firebase'dagi mijozlarni mahalliy bazaga qaytaradi. Qaytaradi: soni."""
    if not firebase.is_enabled():
        return 0

    node = await firebase.get("users")
    restored = 0
    for key, value in firebase.items(node):
        profile = value.get("profile") if isinstance(value.get("profile"), dict) else value
        if not isinstance(profile, dict):
            continue
        try:
            user_id = int(profile.get("uid") or key)
        except (TypeError, ValueError):
            continue

        name = profile.get("name") or "Mijoz"
        phone = profile.get("phone")
        username = profile.get("username") or None
        if isinstance(username, str):
            username = username.lstrip("@") or None

        existing = await q.get_user(user_id)
        if existing and existing["phone"]:
            continue  # mahalliy ma'lumot yangi — tegmaymiz

        await q.add_user(user_id, name, phone, username)
        car_id = profile.get("carId")
        if car_id:
            try:
                if await q.get_car(int(car_id)):
                    await q.set_user_car(user_id, int(car_id))
            except (TypeError, ValueError):
                pass
        restored += 1

    if restored:
        logger.info("Firebase'dan %s mijoz qaytarildi", restored)
    return restored


# ------------------------------------------------------------------ adminlar


async def push_admin(user_id: int, full_name: str | None, added_by: int | None) -> None:
    """Bot ichidan qo'shilgan adminni Firebase'ga yozadi."""
    await _write(
        f"admins/{user_id}",
        {
            "uid": user_id,
            "name": full_name,
            "addedBy": added_by,
            "active": True,
            "source": "zimmer",
            "updatedAt": int(time.time() * 1000),
        },
    )


async def remove_admin(user_id: int) -> None:
    """Firebase'da adminni faolsiz deb belgilaydi (tarix o'chmasin)."""
    await _write(
        f"admins/{user_id}",
        {"uid": user_id, "active": False, "updatedAt": int(time.time() * 1000)},
    )


async def restore_admins() -> int:
    """Firebase'dagi adminlarni mahalliy bazaga qaytaradi.

    Shu tufayli bot qayta deploy qilinganda ham "kim admin" savoli
    bir xil javob beradi — ro'yxat bulutda saqlanadi.
    """
    if not firebase.is_enabled():
        return 0

    node = await firebase.get("admins")
    restored = 0
    for key, value in firebase.items(node):
        try:
            user_id = int(value.get("uid") or key)
        except (TypeError, ValueError):
            continue
        if value.get("active") is False:
            await q.remove_admin(user_id)
            remove_runtime_admin(user_id)
            continue
        await q.add_admin(user_id, value.get("name"), value.get("addedBy"))
        restored += 1

    if restored:
        set_runtime_admins(await q.get_admin_ids())
        logger.info("Firebase'dan %s admin qaytarildi", restored)
    return restored


# ------------------------------------------------------------------ tovarlar


async def import_products() -> int:
    """Firebase'dagi tovarlarni mahalliy bazaga ko'chiradi (rasm URL bilan).

    Kutilgan ko'rinish (Avto_A1 bilan mos):
        products/<key> = {
            name, desc, price, stock, img, category, car, badge, oldPrice, active
        }
    """
    if not firebase.is_enabled():
        return 0

    node = await firebase.get("products")
    rows = firebase.items(node)
    if not rows:
        return 0

    cars = {car["slug"]: car["id"] for car in await q.get_cars(active_only=False)}
    categories = {c["name"].lower(): c["id"] for c in await q.get_categories(active_only=False)}
    imported = 0

    for key, item in rows:
        name = (item.get("name") or "").strip()
        if not name:
            continue

        category_name = (item.get("category") or "Boshqa").strip()
        category_id = categories.get(category_name.lower())
        if not category_id:
            category_id = await q.add_category(category_name)
            categories[category_name.lower()] = category_id

        car_slug = (item.get("car") or "").strip().lower() or None
        car_id = cars.get(car_slug) if car_slug else None

        await q.upsert_external_product(
            external_id=str(key),
            category_id=category_id,
            car_id=car_id,
            name=name,
            description=item.get("desc") or item.get("description"),
            price=_int(item.get("price")),
            old_price=_int(item.get("oldPrice")) or None,
            stock=_int(item.get("stock"), default=0),
            photo_url=item.get("img") or item.get("photo") or None,
            badge=item.get("badge") or None,
            is_active=0 if item.get("active") is False else 1,
        )
        imported += 1

    logger.info("Firebase'dan %s tovar import qilindi", imported)
    return imported


def _int(value, default: int = 0) -> int:
    try:
        return int(float(str(value).replace(" ", "").replace(",", ".")))
    except (TypeError, ValueError):
        return default


# --------------------------------------------------------------- buyurtmalar


async def push_biled_order(order) -> None:
    if not firebase.is_enabled():
        return
    await firebase.put(
        f"biled_orders/{order['id']}",
        {
            "id": order["id"],
            "uid": order["user_id"],
            "name": order["full_name"],
            "phone": order["phone"],
            "car": order["car_name"],
            "biled": order["biled_name"],
            "shroud": order["shroud_name"],
            "color": order["color_name"],
            "total": order["total"],
            "comment": order["comment"],
            "status": order["status"],
            "createdAt": int(time.time() * 1000),
        },
    )


async def push_order(order, items_list) -> None:
    if not firebase.is_enabled():
        return
    await firebase.put(
        f"orders/{order['id']}",
        {
            "id": order["id"],
            "uid": order["user_id"],
            "name": order["full_name"],
            "phone": order["phone"],
            "address": order["address"],
            "total": order["total"],
            "status": order["status"],
            "items": [
                {"name": i["name"], "price": i["price"], "qty": i["qty"]} for i in items_list
            ],
            "createdAt": int(time.time() * 1000),
        },
    )


async def push_booking(booking) -> None:
    if not firebase.is_enabled():
        return
    await firebase.put(
        f"bookings/{booking['id']}",
        {
            "id": booking["id"],
            "uid": booking["user_id"],
            "name": booking["full_name"],
            "phone": booking["phone"],
            "service": booking["service_name"],
            "date": booking["date"],
            "time": booking["time"],
            "status": booking["status"],
            "createdAt": int(time.time() * 1000),
        },
    )


# ------------------------------------------------------------------- katalog
#
# Admin panelda qilingan har bir o'zgarish shu yerdan bulutga tushadi.
# Ilgari katalog faqat vaqtinchalik bazada turardi va qayta deployda
# butunlay yo'qolardi (o'rniga demo katalog qaytardi).

CATALOG_ROOT = "catalog"


async def _catalog_payload(table: str, row) -> dict:
    values = {key: row[key] for key in row.keys()}
    payload: dict = {column: values.get(column) for column in q.catalog_columns(table)}
    payload["id"] = values.get("id")
    payload["_key"] = values.get(q.CATALOG_KEY[table])

    # Bog'langan ustunlar ID emas, NOM bilan saqlanadi
    for column, (ref_table, alias) in q.CATALOG_LINKS.get(table, {}).items():
        payload[alias] = await q.get_row_name(ref_table, values.get(column))

    payload["deleted"] = False
    payload["updatedAt"] = int(time.time() * 1000)
    return payload


async def push_catalog(table: str, row_id: int) -> None:
    """Katalog yozuvini bulutga yozadi (admin o'zgartirgandan keyin chaqiriladi)."""
    if table not in q.CATALOG_KEY:
        return
    try:
        row = await q.admin_get(table, row_id)
    except Exception as error:
        logger.warning("«%s» #%s bulutga yozilmadi: %s", table, row_id, error)
        return
    if row is None:
        return
    await _write(
        f"{CATALOG_ROOT}/{table}/{row_id}", await _catalog_payload(table, row), method="put"
    )


async def delete_catalog(table: str, row_id: int, key_value: str | None) -> None:
    """Bulutda «o'chirilgan» deb belgilaydi (tarix yo'qolmasin)."""
    if table not in q.CATALOG_KEY:
        return
    await _write(
        f"{CATALOG_ROOT}/{table}/{row_id}",
        {
            "id": row_id,
            "_key": key_value,
            "deleted": True,
            "updatedAt": int(time.time() * 1000),
        },
        method="put",
    )


async def _resolve_link(ref_table: str, name) -> int | None:
    """Bulutdagi nomni mahalliy ID'ga aylantiradi."""
    if not name or not str(name).strip():
        return None
    if ref_table == "categories":
        return await q.ensure_category(name)
    if ref_table == "cars":
        return await q.ensure_car(name)
    return await q.catalog_find(ref_table, name)


async def restore_catalog() -> dict[str, int]:
    """Katalogni bulutdan qaytaradi (admin qo'shgan tovarlar yo'qolmasin)."""
    if not firebase.is_enabled():
        return {}

    node = await firebase.get(CATALOG_ROOT)
    if not isinstance(node, dict):
        return {}

    stats = {"added": 0, "updated": 0, "deleted": 0}

    # Tartib muhim: kategoriya va mashinalar avval tiklanadi, chunki
    # tovarlar va bannerlar ularga bog'lanadi.
    for table in q.CATALOG_ORDER:
        rows = node.get(table)
        if not rows:
            continue

        for key, item in firebase.items(rows):
            key_value = item.get("_key")
            if not key_value:
                continue
            try:
                if item.get("deleted"):
                    if await q.catalog_delete_by_key(table, key_value):
                        stats["deleted"] += 1
                    continue

                values = {
                    column: item[column]
                    for column in q.catalog_columns(table)
                    if column in item
                }
                for column, (ref_table, alias) in q.CATALOG_LINKS.get(table, {}).items():
                    values[column] = await _resolve_link(ref_table, item.get(alias))

                # Tovar kategoriyasiz bo'lmaydi (NOT NULL)
                if table == "products" and not values.get("category_id"):
                    values["category_id"] = await q.ensure_category("Boshqa")

                _, created = await q.catalog_upsert(table, values)
                stats["added" if created else "updated"] += 1
            except Exception as error:
                logger.warning("«%s/%s» tiklanmadi: %s", table, key, error)

    if any(stats.values()):
        logger.info(
            "Katalog bulutdan tiklandi: %s yangi, %s yangilandi, %s o'chirildi",
            stats["added"],
            stats["updated"],
            stats["deleted"],
        )
    return stats


def _created_at(value) -> str | None:
    """Firebase'dagi millisekundni bazaning matn formatiga o'giradi."""
    try:
        millis = int(value)
    except (TypeError, ValueError):
        return None
    if millis <= 0:
        return None
    try:
        return datetime.fromtimestamp(millis / 1000, tz=TZ).strftime("%Y-%m-%d %H:%M:%S")
    except (OverflowError, OSError, ValueError):
        return None


def _order_id(value, key: str) -> int | None:
    try:
        return int(value if value is not None else key)
    except (TypeError, ValueError):
        return None


async def restore_orders() -> dict[str, int]:
    """Buyurtmalar va navbatlar TARIXINI Firebase'dan qaytaradi.

    Ilgari faqat mijozlar va tovarlar tiklanardi — buyurtmalar bulutga
    yozilsa ham qaytmasdi. Natijada baza tozalangandan keyin mijoz
    "Kabinetim" da eski buyurtmalarini ko'rmay qolardi.

    Buyurtma asl raqami (#12) bilan tiklanadi, shuning uchun mijoz uchun
    hech narsa o'zgarmaydi. Mavjud yozuvlar ustidan yozilmaydi
    (INSERT OR IGNORE).
    """
    if not firebase.is_enabled():
        return {}

    counts = {"biled": 0, "orders": 0, "bookings": 0}

    # ---------------------------------------------- Bi-LED buyurtmalari
    for key, item in firebase.items(await firebase.get("biled_orders")):
        order_id = _order_id(item.get("id"), key)
        uid = _order_id(item.get("uid"), "")
        if order_id is None or uid is None:
            continue
        try:
            await q.ensure_user(uid, item.get("name"), item.get("phone"))
            car_id = await q.ensure_car(item.get("car"))
            biled_id = await q.ensure_biled(item.get("biled"))
            if not car_id or not biled_id:
                # Bu ikkisi majburiy — bo'lmasa yozuvni tiklab bo'lmaydi
                logger.warning("Bi-LED #%s tiklanmadi: mashina/linza nomi yo'q", order_id)
                continue
            added = await q.restore_biled_order(
                {
                    "id": order_id,
                    "user_id": uid,
                    "car_id": car_id,
                    "biled_id": biled_id,
                    "shroud_id": await q.ensure_shroud(item.get("shroud")),
                    "color_id": await q.ensure_color(item.get("color")),
                    "total": int(item.get("total") or 0),
                    "phone": item.get("phone"),
                    "comment": item.get("comment"),
                    "status": item.get("status") or "new",
                    "created_at": _created_at(item.get("createdAt")),
                }
            )
            counts["biled"] += 1 if added else 0
        except Exception as error:
            logger.warning("Bi-LED #%s tiklanmadi: %s", order_id, error)

    # ---------------------------------------------- do'kon buyurtmalari
    for key, item in firebase.items(await firebase.get("orders")):
        order_id = _order_id(item.get("id"), key)
        uid = _order_id(item.get("uid"), "")
        if order_id is None or uid is None:
            continue
        try:
            await q.ensure_user(uid, item.get("name"), item.get("phone"))
            raw_items = item.get("items")
            if isinstance(raw_items, dict):
                raw_items = list(raw_items.values())
            elif not isinstance(raw_items, list):
                raw_items = []
            added = await q.restore_shop_order(
                {
                    "id": order_id,
                    "user_id": uid,
                    "total": int(item.get("total") or 0),
                    "address": item.get("address"),
                    "phone": item.get("phone"),
                    "status": item.get("status") or "new",
                    "created_at": _created_at(item.get("createdAt")),
                },
                [row for row in raw_items if isinstance(row, dict)],
            )
            counts["orders"] += 1 if added else 0
        except Exception as error:
            logger.warning("Buyurtma #%s tiklanmadi: %s", order_id, error)

    # ---------------------------------------------------------- navbatlar
    for key, item in firebase.items(await firebase.get("bookings")):
        booking_id = _order_id(item.get("id"), key)
        uid = _order_id(item.get("uid"), "")
        if booking_id is None or uid is None:
            continue
        try:
            await q.ensure_user(uid, item.get("name"), item.get("phone"))
            service_id = await q.ensure_service(item.get("service"))
            if not service_id or not item.get("date") or not item.get("time"):
                logger.warning("Navbat #%s tiklanmadi: xizmat/sana yo'q", booking_id)
                continue
            added = await q.restore_booking(
                {
                    "id": booking_id,
                    "user_id": uid,
                    "service_id": service_id,
                    "date": str(item.get("date")),
                    "time": str(item.get("time")),
                    "status": item.get("status") or "new",
                    "created_at": _created_at(item.get("createdAt")),
                }
            )
            counts["bookings"] += 1 if added else 0
        except Exception as error:
            logger.warning("Navbat #%s tiklanmadi: %s", booking_id, error)

    total = sum(counts.values())
    if total:
        logger.info(
            "Firebase'dan tarix tiklandi: %s Bi-LED, %s buyurtma, %s navbat",
            counts["biled"],
            counts["orders"],
            counts["bookings"],
        )
    return counts


async def push_status(kind: str, order_id: int, status: str) -> None:
    """Holat o'zgarganda Firebase'dagi nusxani ham yangilaydi."""
    if not firebase.is_enabled():
        return
    node = {"biled": "biled_orders", "order": "orders", "booking": "bookings"}.get(kind)
    if node:
        await firebase.patch(f"{node}/{order_id}", {"status": status})


# ------------------------------------------------------------ ishga tushirish


async def initial_sync() -> None:
    """Ishga tushganda: adminlar → mijozlar → tovarlar → tarix qaytariladi."""
    if not firebase.is_enabled():
        return
    try:
        await restore_admins()
        await restore_users()
        await import_products()
        # Admin panelda qilingan katalog o'zgarishlari — demo katalog ustidan
        await restore_catalog()
        # Katalog tiklangandan KEYIN — buyurtmalar unga nom bo'yicha bog'lanadi
        await restore_orders()
        # Saqlanganlar ham tovar nomiga bog'lanadi — katalogdan keyin
        await restore_favorites()
        await flush_pending()
    except Exception as error:
        logger.warning("Boshlang'ich sinxronizatsiya xatosi: %s", error)


async def sync_when_ready(attempts: int = 30, delay: int = 20) -> None:
    """Firebase tayyor bo'lishini kutib, keyin sinxronizatsiya qiladi.

    Ilgari `initial_sync()` faqat bot ishga tushgan paytda BIR MARTA
    chaqirilardi. Agar o'sha paytda token olinmasa (tarmoq sekin, Render
    "sovuq start"), mijozlar butun ishlash davomida tiklanmay qolardi.
    Endi tayyor bo'lishi kutiladi va shundan keyin tiklanadi.
    """
    if not config.has_firebase:
        return
    for attempt in range(1, attempts + 1):
        if firebase.is_enabled():
            await initial_sync()
            return
        if attempt == 1:
            logger.info("Firebase tokeni kutilmoqda — sinxronizatsiya keyinroq bajariladi")
        await firebase.refresh_token()
        await asyncio.sleep(delay)
    logger.warning(
        "Firebase %s urinishdan keyin ham ulanmadi — ma'lumotlar faqat mahalliy bazada. "
        "SERVICE_ACCOUNT_JSON va FIREBASE_DB_URL ni tekshiring.",
        attempts,
    )
