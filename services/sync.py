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
import re
import time
from datetime import UTC, datetime

from config import config, remove_runtime_admin, set_runtime_admins
from database import queries as q
from services import firebase

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


async def push_all_users() -> int:
    """BARCHA mijozlarni bulutga yozadi.

    NEGA KERAK
    `push_user` mijoz har xabar yozganda `identity.remember()` orqali
    chaqiriladi — ya'ni mijoz FAOL bo'lsa bulutga tushadi. Lekin:

      • Firebase sozlanishidan OLDIN ro'yxatdan o'tgan mijozlar hech qachon
        yozilmagan;
      • token vaqtincha olinmagan paytda yozuv yiqilgan bo'lsa,
        `identity._pushed` keshi uni «yozilgan» deb belgilab, keyingi
        urinishni `_PUSH_INTERVAL` gacha kechiktiradi;
      • uzoq vaqt yozmagan mijoz Render qayta deployda SQLite tozalanishi
        bilan butunlay yo'qoladi.

    Bu funksiya ro'yxatni to'liq tekislaydi: har bir mijoz uchun profil
    payload'i yasaladi va BITTA PATCH so'rovi bilan yuboriladi.
    """
    if not firebase.is_enabled():
        return 0

    try:
        user_ids = await q.get_all_user_ids()
    except Exception as error:
        logger.warning("Mijozlar ro'yxati o'qilmadi: %s", error)
        return 0
    if not user_ids:
        return 0

    payload: dict[str, dict] = {}
    for user_id in user_ids:
        try:
            row = await q.get_user_with_car(user_id) or await q.get_user(user_id)
            if row is None:
                continue
            profile = {key: row[key] for key in row.keys()}
            payload[str(user_id)] = {"profile": _profile_payload(user_id, profile)}
        except Exception as error:
            logger.warning("Mijoz #%s tayyorlanmadi: %s", user_id, error)

    if not payload:
        return 0

    # PATCH — bulutdagi boshqa mijozlarni O'CHIRMAYDI (PUT o'chirardi)
    if await _write("users", payload, method="patch"):
        logger.info("Mijozlar bulutga yuklandi: %s ta", len(payload))
        return len(payload)

    logger.warning("Mijozlar bulutga yozilmadi (%s ta)", len(payload))
    return 0


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
    """Firebase'dagi `{root}/products` tugunini mahalliy bazaga ko'chiradi.

    Bu tugunga bot yozadi: Excel/CSV importi va admin panelidagi qoralamalar
    (`services/firebase_products.py`). Mini App esa `{root}/catalog/products`
    dan o'qiydi. Ikkisi orasidagi KO'PRIK — mana shu funksiya:

        {root}/products  ->  SQLite  ->  push_all_catalog()  ->  {root}/catalog

    Ya'ni bot orqali qo'shilgan tovar do'konga faqat shu funksiya orqali
    tushadi. Shu sababli u yerdagi har bir e'tiborsizlik tovarni (yoki uning
    rasmini) do'kondan YO'Q qiladi.

    Qo'llab-quvvatlanadigan ko'rinishlar (loyiha tarixida uchtasi bo'lgan):
        eski Avto_A1:  {name, desc, price, stock, img, category, car,
                        badge, oldPrice, active}
        hozirgi bot:   {name, desc, price, stock, img, images[], code,
                        category, brand, model, is_active, is_draft}
        katalog usuli: {name, description, price, photo_url, photo_id,
                        photo2_url, ...}
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
    skipped_no_name = 0
    skipped_drafts = 0

    for key, item in rows:
        if not isinstance(item, dict):
            continue

        name = (item.get("name") or "").strip()
        if not name:
            # Nomsiz yozuv do'konga chiqmaydi. Bu odatda eski sxemadan
            # qolgan yoki chala yozilgan qoldiq bo'ladi — loglaymiz,
            # aks holda «tovarim qayerda?» degan savolga javob yo'q.
            skipped_no_name += 1
            continue

        # QORALAMA do'konga CHIQMASLIGI kerak. Excel importi tovarlarni
        # `is_draft: true` bilan yozadi va admin ularni ko'zdan kechirib
        # «tasdiqlash» tugmasini bosishi kerak. Ilgari bu maydon umuman
        # tekshirilmasdi — ya'ni TASDIQLANMAGAN import darhol do'konga
        # chiqib ketardi.
        if item.get("is_draft") is True:
            skipped_drafts += 1
            continue

        category_name = (item.get("category") or "Boshqa").strip()
        category_id = categories.get(category_name.lower())
        if not category_id:
            category_id = await q.add_category(category_name)
            categories[category_name.lower()] = category_id

        car_slug = (item.get("car") or "").strip().lower() or None
        car_id = cars.get(car_slug) if car_slug else None

        # Rasmlar: `images[]`, `img`, `photo_url`, `photo_id` — hammasi
        # qaraladi va har biri havolami yoki Telegram `file_id` mi degan
        # savolga ko'ra to'g'ri ustunga tushadi.
        media = _media_pairs(item)
        while len(media) < 3:
            media.append((None, None))

        # `is_active` — hozirgi nom, `active` — eski nom. Ilgari faqat
        # `active` qaralardi, ya'ni bot «yashirin» qilib qo'ygan tovar
        # (`is_active: false`) do'konda KO'RINIB turardi.
        flag = item.get("is_active")
        if flag is None:
            flag = item.get("active")
        is_active = 0 if flag is False or flag == 0 else 1

        await q.upsert_external_product(
            external_id=str(key),
            category_id=category_id,
            car_id=car_id,
            name=name,
            description=item.get("desc") or item.get("description"),
            price=_int(item.get("price")),
            # `oldPrice` — eski nom, `old_price` — hozirgi.
            old_price=_int(item.get("oldPrice") or item.get("old_price")) or None,
            stock=_int(item.get("stock"), default=0),
            code=(str(item.get("code")).strip() or None) if item.get("code") else None,
            photo_url=media[0][0],
            photo_id=media[0][1],
            photo2_url=media[1][0],
            photo2_id=media[1][1],
            photo3_url=media[2][0],
            photo3_id=media[2][1],
            badge=item.get("badge") or None,
            is_active=is_active,
        )
        imported += 1

    logger.info("Firebase'dan %s tovar import qilindi", imported)
    if skipped_no_name:
        logger.warning(
            "%s tovar NOMSIZ bo'lgani uchun o'tkazib yuborildi — "
            "Firebase'dagi `products` tugunidagi chala yozuvlar",
            skipped_no_name,
        )
    if skipped_drafts:
        logger.info("%s qoralama o'tkazib yuborildi (tasdiqlanmagan import)", skipped_drafts)
    return imported


# --------------------------------------------------------- rasm maydonlari
#
# NEGA BU KERAK
# Bot tovarni Firebase'ga `images: ["<file_id>"]` ko'rinishida yozadi
# (`services/firebase_products.py`). Ilgari `import_products()` faqat
# `img` va `photo` maydonlarini o'qirdi:
#
#     photo_url=item.get("img") or item.get("photo") or None
#
# Ya'ni `images` ro'yxati UMUMAN qaralmasdi va bot orqali qo'shilgan
# tovarning rasmi do'konga yetib bormasdi.
#
# Ikkinchi muammo: Telegram `file_id` — bu HAVOLA EMAS. U `photo_url` ga
# yozilsa brauzer `<img src="AgACAgIAAxk…">` deb urinib buzuq rasm
# ko'rsatadi. `file_id` ning o'z ustuni bor — `photo_id`. U yerga tushsa
# mavjud media quvuri o'zi ishlaydi:
#
#     Render onlayn : api/media.py    -> /api/media/products/<id>/photo
#     Render o'chgan: cloudflare-worker.js -> <WORKER>/media?id=<file_id>
#
# Shu sababli bu yerda `file_id` ni Worker havolasiga O'GIRMAYMIZ —
# o'girsak manzil `WORKER_URL` o'zgarganda bazada qotib qolardi va
# Render onlayn bo'lganda ham keraksiz Worker'dan o'tardi. `photo_id` ga
# yozamiz, havolani esa har safar ko'rsatuvchi tomon o'zi tanlaydi.

# Telegram `file_id`: base64url alifbosi, amalda 40-100 belgi.
# Chegara 20 — havola bo'lmagan qisqa qoldiqlarni rasm deb o'ylamaslik uchun.
_FILE_ID_RE = re.compile(r"^[A-Za-z0-9_-]{20,}$")

# Bitta tovarda ko'rib chiqiladigan maydonlar chegarasi (buzuq ma'lumotdan
# himoya — 3 ta rasm kerak, qolganini qaramaymiz).
_MEDIA_SCAN_LIMIT = 12


def _image_key_order(key) -> tuple[int, object]:
    """`images` lug'atining kalitlarini RAQAM bo'yicha tartiblaydi.

    RTDB siyrak massivni LUG'AT qilib saqlaydi: `{"0": …, "2": …}`. Oddiy
    matn tartibida "10" "2" dan oldin kelib qolardi.
    """
    try:
        return (0, int(key))
    except (TypeError, ValueError):
        return (1, str(key))


def _media_values(item: dict) -> list[str]:
    """Tovar yozuvidan rasm qiymatlarini tartib bilan yig'adi (takrorsiz).

    Tartib muhim: BIRINCHI qiymat asosiy rasm bo'ladi. Shuning uchun avval
    «asosiy rasm» maydonlari, keyin `images` ro'yxati, keyin 2- va 3-rasm.
    """
    out: list[str] = []

    def add(value) -> None:
        if value is None or isinstance(value, (dict, list, tuple, bool)):
            return
        text = str(value).strip()
        if text and text not in out:
            out.append(text)

    for field in ("img", "photo", "photo_url", "photo_id"):
        add(item.get(field))

    images = item.get("images")
    if isinstance(images, dict):
        for key in sorted(images.keys(), key=_image_key_order):
            add(images[key])
    elif isinstance(images, (list, tuple)):
        for value in images:
            add(value)

    for field in ("photo2_url", "photo2_id", "photo3_url", "photo3_id"):
        add(item.get(field))

    return out[:_MEDIA_SCAN_LIMIT]


def _split_media(value: str) -> tuple[str | None, str | None]:
    """Qiymatni (havola, file_id) juftligiga ajratadi.

    Tanib bo'lmasa (None, None) — masalan `/api/media/...` kabi nisbiy
    manzil yoki bo'sh satr. Bunday qiymat bazaga YOZILMAYDI: `photo_url` ga
    tushsa do'konda buzuq rasm ko'rinardi.
    """
    text = str(value or "").strip()
    if not text:
        return None, None
    low = text.lower()
    if low.startswith("https://") or low.startswith("http://"):
        return text, None
    # `//i.ibb.co/...` — protokolsiz havola
    if text.startswith("//"):
        return "https:" + text, None
    if _FILE_ID_RE.match(text):
        return None, text
    return None, None


def _media_pairs(item: dict) -> list[tuple[str | None, str | None]]:
    """Tovarning eng ko'p 3 ta rasmi: [(havola, file_id), …]."""
    pairs: list[tuple[str | None, str | None]] = []
    for value in _media_values(item):
        url, file_id = _split_media(value)
        if url or file_id:
            pairs.append((url, file_id))
        if len(pairs) == 3:
            break
    return pairs


def _int(value, default: int = 0) -> int:
    try:
        return int(float(str(value).replace(" ", "").replace(",", ".")))
    except (TypeError, ValueError):
        return default


# --------------------------------------------------------------- buyurtmalar


async def push_biled_order(order) -> None:
    """Bi-LED buyurtmasini bulutga yozadi (xato ko'tarmaydi — buyurtma allaqachon saqlangan)."""
    if not firebase.is_enabled():
        return
    try:
        await _put_biled_order(order)
    except Exception as error:
        logger.warning("Bi-LED buyurtma #%s bulutga yozilmadi: %s", order["id"], error)


async def _put_biled_order(order) -> None:
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
    """Do'kon buyurtmasini bulutga yozadi (xato ko'tarmaydi)."""
    if not firebase.is_enabled():
        return
    try:
        await _put_order(order, items_list)
    except Exception as error:
        logger.warning("Buyurtma #%s bulutga yozilmadi: %s", order["id"], error)


async def _put_order(order, items_list) -> None:
    keys = order.keys()
    await firebase.put(
        f"orders/{order['id']}",
        {
            "id": order["id"],
            "uid": order["user_id"],
            "name": order["full_name"],
            "phone": order["phone"],
            "address": order["address"],
            # Yetkazib berish va to'lov usuli — deploy/tozalashdan keyin ham qaytadi
            "deliveryMethod": order["delivery_method"] if "delivery_method" in keys else None,
            "deliveryInfo": order["delivery_info"] if "delivery_info" in keys else None,
            "paymentMethod": order["payment_method"] if "payment_method" in keys else None,
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
    """Katalog yozuvini bulutga yozadi (admin o'zgartirgandan keyin chaqiriladi).

    MUHIM: bu funksiya HECH QACHON xato ko'tarmaydi. Ma'lumot allaqachon
    mahalliy bazaga yozilgan; bulutga yozish — qo'shimcha zaxira. Aks holda
    Firebase'dagi kichik nosozlik admin amalini (tovar qo'shish, qoldiqni
    saqlash) «Serverda xatolik» bilan yiqitardi.
    """
    if table not in q.CATALOG_KEY:
        return
    try:
        row = await q.admin_get(table, row_id)
        if row is None:
            return
        await _write(
            f"{CATALOG_ROOT}/{table}/{row_id}", await _catalog_payload(table, row), method="put"
        )
    except Exception as error:
        logger.warning("«%s» #%s bulutga yozilmadi: %s", table, row_id, error)


async def publish_imported_products() -> int:
    """Firebase `products` -> SQLite -> `catalog` (do'konga chiqarish).

    Qoralama tasdiqlangandan keyin chaqiriladi. IKKI qadam kerak, chunki
    ular ikki xil ish qiladi:

      • `import_products()` — Firebase `products` dan SQLite'ga ko'chiradi
        (bot va Render API shu yerdan o'qiydi);
      • `push_all_catalog()` — SQLite'ni `catalog` ga yozadi (Mini App
        do'koni va zaxira rejim shu yerdan o'qiydi).

    Ikkinchi qadam bo'lmasa admin «tasdiqladim, lekin do'konda yo'q»
    holatiga tushadi — mini app `products` tugunini o'qimaydi.
    """
    imported = await import_products()
    if imported:
        await push_all_catalog()
    return imported


async def push_all_catalog() -> dict[str, int]:
    """BUTUN mahalliy katalogni bulutga yozadi.

    NEGA BU KERAK BO'LDI
    Ilgari bulutga faqat `push_catalog(jadval, id)` orqali — ya'ni admin
    biror yozuvni O'ZGARTIRGANDA — bittalab yozilardi. Butun katalogni
    yuklaydigan funksiya YO'Q edi, `initial_sync()` esa faqat
    `restore_*` (bulut → SQLite) yo'nalishida ishlardi.

    Natijada `{root}/catalog` da FAQAT admin qo'l tekkizgan yozuvlar
    bo'lardi. Boshlang'ich (seed) tovarlar, Excel'dan import qilinganlar
    va Firebase sozlanishidan oldin qo'shilganlar bulutga HECH QACHON
    tushmasdi.

    Bu ikki narsani buzardi:
      • Render qayta deploy bo'lganda SQLite tozalanadi va `restore_catalog()`
        bulutdan faqat o'sha bir nechta yozuvni tiklaydi — qolgani yo'qoladi;
      • Mini App'ning zaxira rejimi (Render o'chganda) bulutdan o'qiydi va
        do'kon BO'SH ko'rinadi.

    Tezlik: har jadval BITTA so'rov bilan yoziladi (PATCH bilan bir necha
    yuz yozuv birga). Bittalab yozsak 500 ta so'rov bo'lardi.
    """
    if not firebase.is_enabled():
        return {}

    stats: dict[str, int] = {}
    for table in q.CATALOG_ORDER:
        if table not in q.CATALOG_KEY:
            continue
        try:
            rows = await q.admin_list(table, limit=1000)
        except Exception as error:
            logger.warning("«%s» o'qilmadi: %s", table, error)
            continue
        if not rows:
            continue

        payload: dict[str, dict] = {}
        for row in rows:
            try:
                payload[str(row["id"])] = await _catalog_payload(table, row)
            except Exception as error:
                logger.warning("«%s» #%s tayyorlanmadi: %s", table, row["id"], error)

        if not payload:
            continue

        # PATCH — bulutdagi qo'shimcha yozuvlarni O'CHIRMAYDI (PUT o'chirardi).
        if await _write(f"{CATALOG_ROOT}/{table}", payload, method="patch"):
            stats[table] = len(payload)
        else:
            logger.warning("«%s» bulutga yozilmadi (%s yozuv)", table, len(payload))

    if stats:
        logger.info(
            "Katalog bulutga yuklandi: %s (jami %s yozuv)",
            ", ".join(f"{k}={v}" for k, v in stats.items()),
            sum(stats.values()),
        )
    else:
        logger.info("Katalog bulutga yuklanmadi (bo'sh yoki Firebase ulanmagan)")
    return stats


async def delete_catalog(table: str, row_id: int, key_value: str | None) -> None:
    """Bulutda «o'chirilgan» deb belgilaydi (tarix yo'qolmasin)."""
    if table not in q.CATALOG_KEY:
        return
    try:
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
    except Exception as error:
        logger.warning("«%s» #%s o'chirilgani bulutga yozilmadi: %s", table, row_id, error)


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

    stats = {"added": 0, "updated": 0, "deleted": 0, "deduped": 0}

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

                row_id, created = await q.catalog_upsert(table, values)
                stats["added" if created else "updated"] += 1

                # ---- TAKRORLANISHNI OLDINI OLISH -------------------------
                # Mini App tovarni bulutga O'ZI yozadi va kalit sifatida
                # o'zining id sini qo'yadi (masalan 900001). `catalog_columns`
                # esa `id` ustunini tashlab yuboradi, shuning uchun SQLite
                # o'zining id sini beradi (masalan 47).
                #
                # `push_all_catalog` PATCH ishlatadi va bulutdagi ortiqcha
                # kalitlarni O'CHIRMAYDI. Natijada bulutda ikkita yozuv
                # qolardi — 900001 va 47 — va tovar do'konda IKKI MARTA
                # ko'rinardi.
                #
                # DIQQAT: bu yerda «deleted: True» belgisi bilan YUMSHOQ
                # o'chirish MUMKIN EMAS. Eski kalitning `_key` si (nomi)
                # haqiqiy tovar bilan aynan bir xil, shuning uchun keyingi
                # `restore_catalog` uni ko'rib `catalog_delete_by_key` bilan
                # HAQIQIY tovarni o'chirib yuborardi. Shu sababli tugun
                # butunlay olib tashlanadi (`put` + `None`).
                if str(key) != str(row_id):
                    if await _write(
                        f"{CATALOG_ROOT}/{table}/{key}", None, method="put"
                    ):
                        stats["deduped"] += 1
                    else:
                        logger.warning(
                            "«%s/%s» takror nusxasi o'chirilmadi — tovar ikki "
                            "marta ko'rinishi mumkin",
                            table,
                            key,
                        )
            except Exception as error:
                logger.warning("«%s/%s» tiklanmadi: %s", table, key, error)

    if any(stats.values()):
        logger.info(
            "Katalog bulutdan tiklandi: %s yangi, %s yangilandi, %s o'chirildi, "
            "%s takror nusxa tozalandi",
            stats["added"],
            stats["updated"],
            stats["deleted"],
            stats["deduped"],
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
        # UTC da saqlanadi — baza `datetime('now')` ham UTC beradi.
        # Aks holda tiklangan yozuvlar statistikada boshqa kunga tushardi.
        return datetime.fromtimestamp(millis / 1000, tz=UTC).strftime("%Y-%m-%d %H:%M:%S")
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
                    "delivery_method": item.get("deliveryMethod"),
                    "delivery_info": item.get("deliveryInfo"),
                    "payment_method": item.get("paymentMethod"),
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


async def import_pending_orders(bot=None) -> int:
    """Cloudflare Worker qabul qilgan buyurtmalarni SQLite ga ko'chiradi.

    NEGA KERAK
    Render o'chgan paytda Mini App buyurtmani Worker orqali qabul qiladi va
    `{root}/pending_orders` ga yozadi (mijozga va adminga Telegram xabari
    Worker'ning o'zi yuboradi). Bot ko'tarilganda o'sha buyurtmalar bazaga
    tushishi kerak — aks holda ular «Ombor» va statistikada ko'rinmaydi va
    admin panelda status o'zgartirib bo'lmaydi.

    DEDUPE SERVER TOMONDA
    `imported` maydonini FAQAT bot qo'yadi. Avto_A1 da mijoz `notified_admin`
    ni o'zi yozib botning xabarini o'chirib qo'ya olardi — bu yerda mijoz
    Worker'dan boshqa hech qanday yo'l bilan yozolmaydi (qoidalar yopiq).

    Qaytaradi: ko'chirilgan buyurtmalar soni.
    """
    if not firebase.is_enabled():
        return 0

    node = await firebase.get("pending_orders")
    if not node:
        return 0

    imported = 0
    for key, item in firebase.items(node):
        if item.get("imported") is True:
            continue

        code = str(item.get("code") or key)
        try:
            uid = int(item.get("uid") or 0)
        except (TypeError, ValueError):
            uid = 0
        if not uid:
            logger.warning("pending_orders/%s: uid yo'q — tashlab ketildi", key)
            continue

        raw_items = item.get("items")
        if isinstance(raw_items, dict):
            raw_items = list(raw_items.values())
        if not isinstance(raw_items, list) or not raw_items:
            logger.warning("pending_orders/%s: tarkib bo'sh — tashlab ketildi", key)
            continue

        try:
            # Mijoz bazada bo'lmasa yaratamiz (Render tozalangan bo'lishi mumkin)
            await q.ensure_user(uid, item.get("customer_name"), item.get("phone"))

            # Narx va nomni WORKER YOZGANIDEK saqlaymiz. Katalog narxi keyin
            # o'zgargan bo'lsa ham mijoz ko'rgan summa o'zgarmasligi kerak.
            lines = []
            for line in raw_items:
                if not isinstance(line, dict):
                    continue
                try:
                    lines.append(
                        {
                            "product_id": int(line.get("product_id") or 0) or None,
                            "name": str(line.get("name") or "Mahsulot")[:200],
                            "price": int(line.get("price") or 0),
                            "qty": max(1, int(line.get("qty") or 1)),
                        }
                    )
                except (TypeError, ValueError):
                    continue
            if not lines:
                logger.warning("pending_orders/%s: qatorlar o'qilmadi", key)
                continue

            order_id = await q.import_external_order(
                {
                    "user_id": uid,
                    "total": int(item.get("total") or 0),
                    "address": item.get("address"),
                    "phone": item.get("phone"),
                    "delivery_method": item.get("delivery_method"),
                    "delivery_info": item.get("delivery_info"),
                    "payment_method": item.get("payment_method"),
                    "status": item.get("status") or "new",
                    "created_at": _created_at(item.get("createdAt")),
                    "external_code": code,
                },
                lines,
            )
            if order_id is None:
                # Allaqachon ko'chirilgan (external_code bo'yicha) — belgilab qo'yamiz
                await _write(f"pending_orders/{key}", {"imported": True}, method="patch")
                continue

            await _write(
                f"pending_orders/{key}",
                {"imported": True, "sqlite_id": order_id},
                method="patch",
            )
            imported += 1
            logger.info("Worker buyurtmasi ko'chirildi: %s -> #%s", code, order_id)

            # Worker adminga xabar yubormagan bo'lsa (masalan Telegram javob
            # bermagan) — bot endi yuboradi. Ikki marta yuborilmasligi uchun
            # `notified_admin` tekshiriladi.
            if bot is not None and not item.get("notified_admin"):
                try:
                    from keyboards.inline import admin_new_order_kb
                    from utils.helpers import fmt_price
                    from utils.ui import notify_admins

                    goods = "\n".join(
                        f"• {ln['name']} × {ln['qty']} = {fmt_price(ln['price'] * ln['qty'])}"
                        for ln in lines
                    )
                    await notify_admins(
                        bot,
                        "🔔 <b>Yangi buyurtma</b> (Mini App — server o'chiq edi)\n\n"
                        f"🆔 #{order_id} · <code>{code}</code>\n"
                        f"👤 {item.get('customer_name') or 'Mijoz'}\n"
                        f"📞 {item.get('phone') or '—'}\n"
                        f"📍 {item.get('address') or '—'}\n\n"
                        f"{goods}\n\n"
                        f"💰 Jami: <b>{fmt_price(int(item.get('total') or 0))}</b>",
                        admin_new_order_kb(order_id),
                    )
                    await _write(
                        f"pending_orders/{key}", {"notified_admin": True}, method="patch"
                    )
                except Exception as error:
                    logger.warning("Buyurtma %s haqida xabar yuborilmadi: %s", code, error)

        except Exception as error:
            logger.warning("pending_orders/%s ko'chirilmadi: %s", key, error)

    if imported:
        logger.info("Worker buyurtmalari ko'chirildi: %s ta", imported)
    return imported


async def pending_orders_worker(bot=None, interval: int = 120) -> None:
    """Fon vazifasi: Worker buyurtmalarini vaqti-vaqti bilan bazaga ko'chiradi.

    Faqat ishga tushishda tekshirish YETARLI EMAS: mijozning ilovasi hali
    zaxira rejimida bo'lishi mumkin (u serverni har 20 soniyada tekshiradi,
    lekin ilova yopiq bo'lsa tekshirmaydi). Shu sababli bot ishlab turganda
    ham yangi buyurtmalar kelishi mumkin.

    Interval katta emas (2 daqiqa) — `pending_orders` tuguni kichik va
    `imported` bo'yicha indekslangan.
    """
    if not config.has_firebase:
        return
    # Ishga tushishdagi `initial_sync` bilan to'qnashmaslik uchun kutamiz
    await asyncio.sleep(interval)
    while True:
        try:
            if firebase.is_enabled():
                await import_pending_orders(bot)
        except Exception as error:
            logger.warning("Worker buyurtmalarini ko'chirishda xato: %s", error)
        await asyncio.sleep(max(30, interval))


async def push_status(kind: str, order_id: int, status: str) -> None:
    """Holat o'zgarganda Firebase'dagi nusxani ham yangilaydi (xato ko'tarmaydi)."""
    if not firebase.is_enabled():
        return
    node = {"biled": "biled_orders", "order": "orders", "booking": "bookings"}.get(kind)
    if not node:
        return
    try:
        await firebase.patch(f"{node}/{order_id}", {"status": status})
    except Exception as error:
        logger.warning("%s #%s holati bulutga yozilmadi: %s", kind, order_id, error)


# ------------------------------------------------------------ ishga tushirish


async def initial_sync(bot=None) -> None:
    """Ishga tushganda: adminlar → mijozlar → tovarlar → tarix qaytariladi.

    `bot` berilsa, Worker buyurtmalari ko'chirilganda adminlarga xabar ham
    yuboriladi (Worker yuborolmagan holat uchun).
    """
    if not firebase.is_enabled():
        return
    try:
        await restore_admins()
        await restore_users()
        await import_products()
        # Admin panelda qilingan katalog o'zgarishlari — demo katalog ustidan
        await restore_catalog()
        # …va TESKARI yo'nalish: mahalliy katalogni butunlay bulutga yozamiz.
        # Bu qator bo'lmasa `{root}/catalog` da faqat admin qo'l tekkizgan
        # yozuvlar bo'lib qolardi — natijada Mini App'ning zaxira rejimi
        # (Render o'chganda) do'konni BO'SH ko'rsatardi va qayta deployda
        # tiklanadigan tovarlar ham to'liq bo'lmasdi.
        await push_all_catalog()
        # Mijozlar ham to'liq bulutga chiqsin: `push_user` faqat FAOL mijozni
        # yozadi, shuning uchun eski/uzoq vaqt yozmagan mijozlar bulutda
        # bo'lmasdi va qayta deployda yo'qolardi.
        await push_all_users()
        # Render o'chgan paytda Worker qabul qilgan buyurtmalarni bazaga
        # ko'chiramiz — aks holda ular «Ombor» va statistikada ko'rinmaydi.
        await import_pending_orders(bot)
        # Katalog tiklangandan KEYIN — buyurtmalar unga nom bo'yicha bog'lanadi
        await restore_orders()
        # Saqlanganlar ham tovar nomiga bog'lanadi — katalogdan keyin
        await restore_favorites()
        await flush_pending()
    except Exception as error:
        logger.warning("Boshlang'ich sinxronizatsiya xatosi: %s", error)


async def sync_when_ready(bot=None, attempts: int = 30, delay: int = 20) -> None:
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
            await initial_sync(bot)
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
