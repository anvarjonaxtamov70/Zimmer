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

import logging
import time

from database import queries as q
from services import firebase

logger = logging.getLogger(__name__)


# ------------------------------------------------------------------ mijozlar


async def push_user(user_id: int, profile: dict) -> None:
    """Mijoz profilini Firebase'ga yozadi (Avto_A1 bilan bir xil ko'rinishda)."""
    if not firebase.is_enabled():
        return
    payload = {
        "uid": user_id,
        "name": profile.get("full_name"),
        "phone": profile.get("phone"),
        "username": profile.get("username") or "",
        "carId": profile.get("car_id"),
        "carName": profile.get("car_name"),
        "source": "zimmer",
        "updatedAt": int(time.time() * 1000),
    }
    await firebase.patch(f"users/{user_id}/profile", payload)


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


async def push_status(kind: str, order_id: int, status: str) -> None:
    """Holat o'zgarganda Firebase'dagi nusxani ham yangilaydi."""
    if not firebase.is_enabled():
        return
    node = {"biled": "biled_orders", "order": "orders", "booking": "bookings"}.get(kind)
    if node:
        await firebase.patch(f"{node}/{order_id}", {"status": status})


# ------------------------------------------------------------ ishga tushirish


async def initial_sync() -> None:
    """Bot ishga tushganda: token → mijozlarni qaytarish → tovarlarni import."""
    if not firebase.is_enabled():
        return
    try:
        await restore_users()
        await import_products()
    except Exception as error:
        logger.warning("Boshlang'ich sinxronizatsiya xatosi: %s", error)
