"""Bazaga so'rovlar. Har bir funksiya aiosqlite.Row yoki oddiy tip qaytaradi."""

import logging
import re
from collections.abc import Sequence
from typing import Any

import aiosqlite

from database.db import get_db

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------- foydalanuvchi


async def add_user(user_id: int, full_name: str, phone: str | None, username: str | None) -> None:
    db = get_db()
    await db.execute(
        "INSERT INTO users (user_id, full_name, phone, username) VALUES (?, ?, ?, ?)"
        " ON CONFLICT(user_id) DO UPDATE SET"
        " full_name = excluded.full_name,"
        " phone = COALESCE(excluded.phone, users.phone),"
        " username = excluded.username",
        (user_id, full_name, phone, username),
    )
    await db.commit()


async def touch_user(user_id: int, full_name: str, username: str | None) -> None:
    """Foydalanuvchini "ko'rdim" deb belgilaydi (har bir xabarda chaqiriladi).

    `add_user`dan farqi: ro'yxatdan o'tgan mijozning (telefoni bor)
    ismini Telegram profilidagi nom bilan ALMASHTIRMAYDI. Ya'ni mijoz
    "Anvarjon Axtamov" deb yozgan bo'lsa, u shundayligicha qoladi.
    """
    db = get_db()
    await db.execute(
        "INSERT INTO users (user_id, full_name, username) VALUES (?, ?, ?)"
        " ON CONFLICT(user_id) DO UPDATE SET"
        " username = COALESCE(excluded.username, users.username),"
        " full_name = CASE"
        "   WHEN users.phone IS NULL AND excluded.full_name IS NOT NULL"
        "        AND TRIM(excluded.full_name) <> ''"
        "   THEN excluded.full_name ELSE users.full_name END",
        (user_id, full_name, username),
    )
    await db.commit()


async def get_user(user_id: int) -> aiosqlite.Row | None:
    db = get_db()
    async with db.execute("SELECT * FROM users WHERE user_id = ?", (user_id,)) as cur:
        return await cur.fetchone()


async def update_phone(user_id: int, phone: str) -> None:
    db = get_db()
    await db.execute("UPDATE users SET phone = ? WHERE user_id = ?", (phone, user_id))
    await db.commit()


async def get_user_with_car(user_id: int) -> aiosqlite.Row | None:
    """Foydalanuvchi + tanlagan mashinasi nomi bilan."""
    db = get_db()
    async with db.execute(
        "SELECT u.*, c.name AS car_name, c.slug AS car_slug, c.years AS car_years"
        " FROM users u LEFT JOIN cars c ON c.id = u.car_id"
        " WHERE u.user_id = ?",
        (user_id,),
    ) as cur:
        return await cur.fetchone()


async def get_all_user_ids() -> list[int]:
    db = get_db()
    async with db.execute("SELECT user_id FROM users WHERE is_blocked = 0") as cur:
        return [row["user_id"] async for row in cur]


# ------------------------------------------------------------------- adminlar


async def get_admins() -> list[aiosqlite.Row]:
    """Bot ichidan qo'shilgan adminlar (kod/env adminlari bu jadvalda yo'q)."""
    db = get_db()
    async with db.execute("SELECT * FROM admins ORDER BY created_at") as cur:
        return await cur.fetchall()


async def get_admin_ids() -> list[int]:
    db = get_db()
    async with db.execute("SELECT user_id FROM admins ORDER BY created_at") as cur:
        return [row["user_id"] async for row in cur]


async def add_admin(user_id: int, full_name: str | None, added_by: int | None) -> None:
    db = get_db()
    await db.execute(
        "INSERT INTO admins (user_id, full_name, added_by) VALUES (?, ?, ?)"
        " ON CONFLICT(user_id) DO UPDATE SET"
        " full_name = COALESCE(excluded.full_name, admins.full_name)",
        (user_id, full_name, added_by),
    )
    await db.commit()


async def remove_admin(user_id: int) -> bool:
    db = get_db()
    cur = await db.execute("DELETE FROM admins WHERE user_id = ?", (user_id,))
    await db.commit()
    return cur.rowcount > 0


# -------------------------------------------------------------------- xizmatlar


async def get_services(active_only: bool = True) -> list[aiosqlite.Row]:
    db = get_db()
    sql = "SELECT * FROM services"
    if active_only:
        sql += " WHERE is_active = 1"
    sql += " ORDER BY id"
    async with db.execute(sql) as cur:
        return await cur.fetchall()


async def get_service(service_id: int) -> aiosqlite.Row | None:
    db = get_db()
    async with db.execute("SELECT * FROM services WHERE id = ?", (service_id,)) as cur:
        return await cur.fetchone()


async def add_service(name: str, duration_min: int, price: int) -> int:
    db = get_db()
    cur = await db.execute(
        "INSERT INTO services (name, duration_min, price) VALUES (?, ?, ?)",
        (name, duration_min, price),
    )
    await db.commit()
    return int(cur.lastrowid)


async def toggle_service(service_id: int) -> None:
    db = get_db()
    await db.execute(
        "UPDATE services SET is_active = 1 - is_active WHERE id = ?", (service_id,)
    )
    await db.commit()


# --------------------------------------------------------------------- navbatlar

ACTIVE_BOOKING_STATUSES = ("new", "confirmed")


async def get_day_bookings(date: str) -> list[aiosqlite.Row]:
    """Berilgan kundagi bekor qilinmagan navbatlar (vaqt + davomiylik bilan)."""
    db = get_db()
    async with db.execute(
        "SELECT b.time, s.duration_min FROM bookings b"
        " JOIN services s ON s.id = b.service_id"
        " WHERE b.date = ? AND b.status != 'cancelled'",
        (date,),
    ) as cur:
        return await cur.fetchall()


async def add_booking(user_id: int, service_id: int, date: str, time: str) -> int:
    db = get_db()
    cur = await db.execute(
        "INSERT INTO bookings (user_id, service_id, date, time) VALUES (?, ?, ?, ?)",
        (user_id, service_id, date, time),
    )
    await db.commit()
    return int(cur.lastrowid)


async def get_booking(booking_id: int) -> aiosqlite.Row | None:
    db = get_db()
    async with db.execute(
        "SELECT b.*, s.name AS service_name, s.price, s.duration_min,"
        " u.full_name, u.phone, u.username"
        " FROM bookings b"
        " JOIN services s ON s.id = b.service_id"
        " JOIN users u ON u.user_id = b.user_id"
        " WHERE b.id = ?",
        (booking_id,),
    ) as cur:
        return await cur.fetchone()


async def get_user_bookings(user_id: int, only_active: bool = True) -> list[aiosqlite.Row]:
    db = get_db()
    sql = (
        "SELECT b.*, s.name AS service_name, s.price FROM bookings b"
        " JOIN services s ON s.id = b.service_id"
        " WHERE b.user_id = ?"
    )
    params: list[Any] = [user_id]
    if only_active:
        sql += " AND b.status IN ('new', 'confirmed')"
    sql += " ORDER BY b.date, b.time"
    async with db.execute(sql, params) as cur:
        return await cur.fetchall()


async def get_bookings_by_date(date: str) -> list[aiosqlite.Row]:
    """Admin uchun: kun bo'yicha barcha navbatlar."""
    db = get_db()
    async with db.execute(
        "SELECT b.*, s.name AS service_name, u.full_name, u.phone, u.username"
        " FROM bookings b"
        " JOIN services s ON s.id = b.service_id"
        " JOIN users u ON u.user_id = b.user_id"
        " WHERE b.date = ? ORDER BY b.time",
        (date,),
    ) as cur:
        return await cur.fetchall()


async def set_booking_status(booking_id: int, status: str) -> None:
    db = get_db()
    await db.execute("UPDATE bookings SET status = ? WHERE id = ?", (status, booking_id))
    await db.commit()


async def is_slot_taken(date: str, time: str) -> bool:
    db = get_db()
    async with db.execute(
        "SELECT 1 FROM bookings WHERE date = ? AND time = ? AND status != 'cancelled'",
        (date, time),
    ) as cur:
        return await cur.fetchone() is not None


# ------------------------------------------------------------------ kategoriyalar


async def get_categories(active_only: bool = True) -> list[aiosqlite.Row]:
    db = get_db()
    sql = "SELECT * FROM categories"
    if active_only:
        sql += " WHERE is_active = 1"
    sql += " ORDER BY id"
    async with db.execute(sql) as cur:
        return await cur.fetchall()


async def get_category(category_id: int) -> aiosqlite.Row | None:
    db = get_db()
    async with db.execute("SELECT * FROM categories WHERE id = ?", (category_id,)) as cur:
        return await cur.fetchone()


async def add_category(name: str) -> int:
    db = get_db()
    cur = await db.execute("INSERT INTO categories (name) VALUES (?)", (name,))
    await db.commit()
    return int(cur.lastrowid)


# -------------------------------------------------------------------- mahsulotlar


async def get_products(
    category_id: int,
    active_only: bool = True,
    car_id: int | None = None,
) -> list[aiosqlite.Row]:
    """Kategoriya mahsulotlari. car_id berilsa — shu mashinaga mos + universal."""
    db = get_db()
    sql = "SELECT * FROM products WHERE category_id = ?"
    params: list[Any] = [category_id]
    if active_only:
        sql += " AND is_active = 1"
    if car_id is not None:
        sql += " AND (car_id IS NULL OR car_id = ?)"
        params.append(car_id)
    sql += " ORDER BY (car_id IS NULL), id"
    async with db.execute(sql, params) as cur:
        return await cur.fetchall()


async def get_product(product_id: int) -> aiosqlite.Row | None:
    db = get_db()
    async with db.execute("SELECT * FROM products WHERE id = ?", (product_id,)) as cur:
        return await cur.fetchone()


async def add_product(
    category_id: int,
    name: str,
    description: str | None,
    price: int,
    stock: int,
    photo_id: str | None,
) -> int:
    db = get_db()
    cur = await db.execute(
        "INSERT INTO products (category_id, name, description, price, stock, photo_id)"
        " VALUES (?, ?, ?, ?, ?, ?)",
        (category_id, name, description, price, stock, photo_id),
    )
    await db.commit()
    return int(cur.lastrowid)


async def toggle_product(product_id: int) -> None:
    db = get_db()
    await db.execute(
        "UPDATE products SET is_active = 1 - is_active WHERE id = ?", (product_id,)
    )
    await db.commit()


# ---------------------------------------------------------------------- savatcha


async def add_to_cart(user_id: int, product_id: int, qty: int = 1) -> None:
    db = get_db()
    await db.execute(
        "INSERT INTO cart_items (user_id, product_id, qty) VALUES (?, ?, ?)"
        " ON CONFLICT(user_id, product_id) DO UPDATE SET qty = qty + excluded.qty",
        (user_id, product_id, qty),
    )
    await db.commit()


async def get_cart(user_id: int) -> list[aiosqlite.Row]:
    db = get_db()
    async with db.execute(
        "SELECT c.product_id, c.qty, p.name, p.price, p.stock,"
        " (c.qty * p.price) AS subtotal"
        " FROM cart_items c JOIN products p ON p.id = c.product_id"
        " WHERE c.user_id = ? ORDER BY p.name",
        (user_id,),
    ) as cur:
        return await cur.fetchall()


async def change_cart_qty(user_id: int, product_id: int, delta: int) -> None:
    db = get_db()
    await db.execute(
        "UPDATE cart_items SET qty = qty + ? WHERE user_id = ? AND product_id = ?",
        (delta, user_id, product_id),
    )
    await db.execute(
        "DELETE FROM cart_items WHERE user_id = ? AND product_id = ? AND qty < 1",
        (user_id, product_id),
    )
    await db.commit()


async def remove_from_cart(user_id: int, product_id: int) -> None:
    db = get_db()
    await db.execute(
        "DELETE FROM cart_items WHERE user_id = ? AND product_id = ?", (user_id, product_id)
    )
    await db.commit()


async def clear_cart(user_id: int) -> None:
    db = get_db()
    await db.execute("DELETE FROM cart_items WHERE user_id = ?", (user_id,))
    await db.commit()


async def cart_total(user_id: int) -> int:
    db = get_db()
    async with db.execute(
        "SELECT COALESCE(SUM(c.qty * p.price), 0) AS total FROM cart_items c"
        " JOIN products p ON p.id = c.product_id WHERE c.user_id = ?",
        (user_id,),
    ) as cur:
        row = await cur.fetchone()
    return int(row["total"])


# --------------------------------------------------------------------- buyurtma


async def create_order(user_id: int, address: str, phone: str) -> int | None:
    """Savatchadagi mahsulotlardan buyurtma yaratadi va savatchani bo'shatadi."""
    items = await get_cart(user_id)
    if not items:
        return None

    db = get_db()
    total = sum(int(item["subtotal"]) for item in items)
    cur = await db.execute(
        "INSERT INTO orders (user_id, total, address, phone) VALUES (?, ?, ?, ?)",
        (user_id, total, address, phone),
    )
    order_id = int(cur.lastrowid)

    rows: Sequence[tuple] = [
        (order_id, item["product_id"], item["name"], int(item["price"]), int(item["qty"]))
        for item in items
    ]
    await db.executemany(
        "INSERT INTO order_items (order_id, product_id, name, price, qty)"
        " VALUES (?, ?, ?, ?, ?)",
        rows,
    )
    for item in items:
        await db.execute(
            "UPDATE products SET stock = MAX(stock - ?, 0) WHERE id = ?",
            (int(item["qty"]), item["product_id"]),
        )
    await db.execute("DELETE FROM cart_items WHERE user_id = ?", (user_id,))
    await db.commit()
    return order_id


async def get_order(order_id: int) -> aiosqlite.Row | None:
    db = get_db()
    async with db.execute(
        "SELECT o.*, u.full_name, u.username FROM orders o"
        " JOIN users u ON u.user_id = o.user_id WHERE o.id = ?",
        (order_id,),
    ) as cur:
        return await cur.fetchone()


async def get_order_items(order_id: int) -> list[aiosqlite.Row]:
    db = get_db()
    async with db.execute(
        "SELECT * FROM order_items WHERE order_id = ? ORDER BY id", (order_id,)
    ) as cur:
        return await cur.fetchall()


async def get_user_orders(user_id: int, limit: int = 10) -> list[aiosqlite.Row]:
    db = get_db()
    async with db.execute(
        "SELECT * FROM orders WHERE user_id = ? ORDER BY id DESC LIMIT ?",
        (user_id, limit),
    ) as cur:
        return await cur.fetchall()


async def get_orders(status: str | None = None, limit: int = 15) -> list[aiosqlite.Row]:
    db = get_db()
    sql = (
        "SELECT o.*, u.full_name, u.username FROM orders o"
        " JOIN users u ON u.user_id = o.user_id"
    )
    params: list[Any] = []
    if status:
        sql += " WHERE o.status = ?"
        params.append(status)
    sql += " ORDER BY o.id DESC LIMIT ?"
    params.append(limit)
    async with db.execute(sql, params) as cur:
        return await cur.fetchall()


async def set_order_status(order_id: int, status: str) -> None:
    db = get_db()
    await db.execute("UPDATE orders SET status = ? WHERE id = ?", (status, order_id))
    await db.commit()


async def restore_order_stock(order_id: int) -> int:
    """Bekor qilingan buyurtmadagi tovarlarni omborga qaytaradi.

    Buyurtma berilganda ombor soni kamaytiriladi (`create_order`). Buyurtma
    bekor qilinsa, o'sha sonni qaytarish kerak — aks holda tovar bazada
    "yo'qolib" qoladi va sotuvda ko'rinmay qoladi.

    Qaytaradi: omborga qaytarilgan umumiy dona soni.
    """
    db = get_db()
    async with db.execute(
        "SELECT product_id, qty FROM order_items WHERE order_id = ? AND product_id IS NOT NULL",
        (order_id,),
    ) as cur:
        rows = await cur.fetchall()

    restored = 0
    for row in rows:
        qty = int(row["qty"] or 0)
        if qty <= 0:
            continue
        await db.execute(
            "UPDATE products SET stock = stock + ? WHERE id = ?", (qty, row["product_id"])
        )
        restored += qty

    if restored:
        await db.commit()
    return restored


# -------------------------------------------------------------------- statistika


async def get_stats(today: str) -> dict[str, int]:
    db = get_db()
    queries = {
        "users": ("SELECT COUNT(*) FROM users", ()),
        "bookings_total": ("SELECT COUNT(*) FROM bookings", ()),
        "bookings_today": ("SELECT COUNT(*) FROM bookings WHERE date = ?", (today,)),
        "bookings_new": ("SELECT COUNT(*) FROM bookings WHERE status = 'new'", ()),
        "orders_total": ("SELECT COUNT(*) FROM orders", ()),
        "orders_new": ("SELECT COUNT(*) FROM orders WHERE status = 'new'", ()),
        "revenue": (
            "SELECT COALESCE(SUM(total), 0) FROM orders WHERE status != 'cancelled'",
            (),
        ),
        "products": ("SELECT COUNT(*) FROM products WHERE is_active = 1", ()),
        "biled_total": ("SELECT COUNT(*) FROM biled_orders", ()),
        "biled_new": ("SELECT COUNT(*) FROM biled_orders WHERE status = 'new'", ()),
        "biled_revenue": (
            "SELECT COALESCE(SUM(total), 0) FROM biled_orders WHERE status != 'cancelled'",
            (),
        ),
    }
    stats: dict[str, int] = {}
    for key, (sql, params) in queries.items():
        async with db.execute(sql, params) as cur:
            row = await cur.fetchone()
        stats[key] = int(row[0])
    return stats



# --------------------------------------------------------- Mini App uchun qo'shimcha


def product_json(product: aiosqlite.Row) -> dict[str, Any]:
    keys = product.keys()
    return {
        "id": product["id"],
        "name": product["name"],
        "description": product["description"],
        "price": int(product["price"]),
        "old_price": int(product["old_price"])
        if "old_price" in keys and product["old_price"]
        else None,
        "badge": product["badge"] if "badge" in keys else None,
        "stock": int(product["stock"]),
        "car_id": product["car_id"] if "car_id" in keys else None,
        # media: xom qiymatlar — yakuniy manzillar API qatlamida yasaladi
        "has_photo": bool(product["photo_id"]),
        "photo_url_raw": product["photo_url"] if "photo_url" in keys else None,
        "has_video": bool(product["video_id"]) if "video_id" in keys else False,
        "video_url_raw": product["video_url"] if "video_url" in keys else None,
    }


async def get_catalog(car_id: int | None = None) -> list[dict[str, Any]]:
    """Kategoriyalar va mahsulotlar — Mini App uchun (mashinaga qarab filtrlangan)."""
    categories = await get_categories()
    catalog: list[dict[str, Any]] = []
    for category in categories:
        products = await get_products(category["id"], car_id=car_id)
        if not products:
            continue
        keys = category.keys()
        catalog.append(
            {
                "id": category["id"],
                "name": category["name"],
                "icon": category["icon"] if "icon" in keys else None,
                "products": [product_json(product) for product in products],
            }
        )
    return catalog


# ---------------------------------------------------------- saqlanganlar


async def toggle_favorite(user_id: int, product_id: int) -> bool:
    """Tovarni saqlaydi yoki saqlanganlardan oladi. Qaytaradi: yangi holat."""
    db = get_db()
    cur = await db.execute(
        "DELETE FROM favorites WHERE user_id = ? AND product_id = ?", (user_id, product_id)
    )
    if cur.rowcount > 0:
        await db.commit()
        return False

    await db.execute(
        "INSERT OR IGNORE INTO favorites (user_id, product_id) VALUES (?, ?)",
        (user_id, product_id),
    )
    await db.commit()
    return True


async def get_favorite_ids(user_id: int) -> list[int]:
    """Saqlangan tovar ID'lari (ilovada yurakni bo'yash uchun)."""
    db = get_db()
    async with db.execute(
        "SELECT product_id FROM favorites WHERE user_id = ?", (user_id,)
    ) as cur:
        return [row["product_id"] async for row in cur]


async def get_favorites(user_id: int) -> list[dict[str, Any]]:
    """Saqlangan tovarlar — yangi saqlangani birinchi bo'lib."""
    db = get_db()
    async with db.execute(
        "SELECT p.* FROM favorites f JOIN products p ON p.id = f.product_id"
        " WHERE f.user_id = ? AND p.is_active = 1"
        " ORDER BY f.created_at DESC, f.product_id DESC",
        (user_id,),
    ) as cur:
        rows = await cur.fetchall()
    return [product_json(row) for row in rows]


async def get_favorite_names(user_id: int) -> list[str]:
    """Saqlangan tovar NOMLARI — bulutga yozish uchun (ID'lar o'zgaradi)."""
    db = get_db()
    async with db.execute(
        "SELECT p.name FROM favorites f JOIN products p ON p.id = f.product_id"
        " WHERE f.user_id = ?",
        (user_id,),
    ) as cur:
        return [row["name"] async for row in cur]


async def add_favorite_by_name(user_id: int, name: str) -> bool:
    """Bulutdan tiklash: tovarni nomi bo'yicha topib saqlanganlarga qo'shadi."""
    product_id = await catalog_find("products", name)
    if product_id is None:
        return False
    db = get_db()
    cur = await db.execute(
        "INSERT OR IGNORE INTO favorites (user_id, product_id) VALUES (?, ?)",
        (user_id, product_id),
    )
    await db.commit()
    return cur.rowcount > 0


async def create_order_from_items(
    user_id: int,
    items: list[tuple[int, int]],
    address: str,
    phone: str,
) -> tuple[int | None, list[dict[str, Any]]]:
    """Mini App'dan kelgan ro'yxat asosida buyurtma yaratadi.

    items -- [(product_id, qty), ...]
    Qaytaradi: (order_id, muammolar). Muammo bo'lsa order_id = None.
    """
    problems: list[dict[str, Any]] = []
    prepared: list[tuple[aiosqlite.Row, int]] = []

    for product_id, qty in items:
        product = await get_product(product_id)
        if not product or not product["is_active"]:
            problems.append({"product_id": product_id, "reason": "not_found"})
            continue
        if qty < 1:
            problems.append({"product_id": product_id, "reason": "bad_qty"})
            continue
        if qty > int(product["stock"]):
            problems.append(
                {
                    "product_id": product_id,
                    "name": product["name"],
                    "reason": "out_of_stock",
                    "available": int(product["stock"]),
                }
            )
            continue
        prepared.append((product, qty))

    if problems or not prepared:
        return None, problems

    db = get_db()
    total = sum(int(product["price"]) * qty for product, qty in prepared)
    cur = await db.execute(
        "INSERT INTO orders (user_id, total, address, phone) VALUES (?, ?, ?, ?)",
        (user_id, total, address, phone),
    )
    order_id = int(cur.lastrowid)

    await db.executemany(
        "INSERT INTO order_items (order_id, product_id, name, price, qty)"
        " VALUES (?, ?, ?, ?, ?)",
        [
            (order_id, product["id"], product["name"], int(product["price"]), qty)
            for product, qty in prepared
        ],
    )
    for product, qty in prepared:
        await db.execute(
            "UPDATE products SET stock = MAX(stock - ?, 0) WHERE id = ?",
            (qty, product["id"]),
        )
    await db.commit()
    return order_id, []



# ========================================================================
#                        Bi-LED TUNING (asosiy yo'nalish)
# ========================================================================

# ------------------------------------------------------------------ mashinalar


async def get_cars(active_only: bool = True) -> list[aiosqlite.Row]:
    db = get_db()
    sql = "SELECT * FROM cars"
    if active_only:
        sql += " WHERE is_active = 1"
    sql += " ORDER BY sort, id"
    async with db.execute(sql) as cur:
        return await cur.fetchall()


async def get_car(car_id: int) -> aiosqlite.Row | None:
    db = get_db()
    async with db.execute("SELECT * FROM cars WHERE id = ?", (car_id,)) as cur:
        return await cur.fetchone()


async def add_car(name: str, slug: str, years: str | None, note: str | None) -> int:
    db = get_db()
    cur = await db.execute(
        "INSERT INTO cars (name, slug, years, note) VALUES (?, ?, ?, ?)",
        (name, slug, years, note),
    )
    await db.commit()
    return int(cur.lastrowid)


async def set_user_car(user_id: int, car_id: int) -> None:
    db = get_db()
    await db.execute("UPDATE users SET car_id = ? WHERE user_id = ?", (car_id, user_id))
    await db.commit()


# ------------------------------------------------------- konfigurator variantlari


async def get_biled_types(active_only: bool = True) -> list[aiosqlite.Row]:
    db = get_db()
    sql = "SELECT * FROM biled_types"
    if active_only:
        sql += " WHERE is_active = 1"
    sql += " ORDER BY sort, id"
    async with db.execute(sql) as cur:
        return await cur.fetchall()


async def get_biled_type(biled_id: int) -> aiosqlite.Row | None:
    db = get_db()
    async with db.execute("SELECT * FROM biled_types WHERE id = ?", (biled_id,)) as cur:
        return await cur.fetchone()


async def get_shrouds(active_only: bool = True) -> list[aiosqlite.Row]:
    db = get_db()
    sql = "SELECT * FROM shrouds"
    if active_only:
        sql += " WHERE is_active = 1"
    sql += " ORDER BY sort, id"
    async with db.execute(sql) as cur:
        return await cur.fetchall()


async def get_shroud(shroud_id: int) -> aiosqlite.Row | None:
    db = get_db()
    async with db.execute("SELECT * FROM shrouds WHERE id = ?", (shroud_id,)) as cur:
        return await cur.fetchone()


async def get_optic_colors(active_only: bool = True) -> list[aiosqlite.Row]:
    db = get_db()
    sql = "SELECT * FROM optic_colors"
    if active_only:
        sql += " WHERE is_active = 1"
    sql += " ORDER BY sort, id"
    async with db.execute(sql) as cur:
        return await cur.fetchall()


async def get_optic_color(color_id: int) -> aiosqlite.Row | None:
    db = get_db()
    async with db.execute(
        "SELECT * FROM optic_colors WHERE id = ?", (color_id,)
    ) as cur:
        return await cur.fetchone()


# ------------------------------------------------------- Bi-LED buyurtmalari


async def create_biled_order(
    user_id: int,
    car_id: int,
    biled_id: int,
    shroud_id: int | None,
    color_id: int | None,
    phone: str,
    comment: str | None,
) -> tuple[int | None, int]:
    """Konfiguratsiya buyurtmasini yaratadi. Qaytaradi: (order_id, total)."""
    biled = await get_biled_type(biled_id)
    if not biled or not biled["is_active"]:
        return None, 0

    total = int(biled["price"])
    if shroud_id:
        shroud = await get_shroud(shroud_id)
        if shroud:
            total += int(shroud["price"])
    if color_id:
        color = await get_optic_color(color_id)
        if color:
            total += int(color["price"])

    db = get_db()
    cur = await db.execute(
        "INSERT INTO biled_orders (user_id, car_id, biled_id, shroud_id, color_id,"
        " total, phone, comment) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        (user_id, car_id, biled_id, shroud_id, color_id, total, phone, comment),
    )
    await db.commit()
    return int(cur.lastrowid), total


BILED_ORDER_SELECT = """
SELECT b.*, c.name AS car_name, c.years AS car_years,
       t.name AS biled_name, t.brand AS biled_brand, t.price AS biled_price,
       s.name AS shroud_name, s.price AS shroud_price,
       o.name AS color_name, o.price AS color_price,
       u.full_name, u.username
  FROM biled_orders b
  JOIN cars c        ON c.id = b.car_id
  JOIN biled_types t ON t.id = b.biled_id
  LEFT JOIN shrouds s      ON s.id = b.shroud_id
  LEFT JOIN optic_colors o ON o.id = b.color_id
  JOIN users u       ON u.user_id = b.user_id
"""


async def get_biled_order(order_id: int) -> aiosqlite.Row | None:
    db = get_db()
    async with db.execute(BILED_ORDER_SELECT + " WHERE b.id = ?", (order_id,)) as cur:
        return await cur.fetchone()


async def get_user_biled_orders(user_id: int, limit: int = 20) -> list[aiosqlite.Row]:
    db = get_db()
    async with db.execute(
        BILED_ORDER_SELECT + " WHERE b.user_id = ? ORDER BY b.id DESC LIMIT ?",
        (user_id, limit),
    ) as cur:
        return await cur.fetchall()


async def get_biled_orders(status: str | None = None, limit: int = 15) -> list[aiosqlite.Row]:
    db = get_db()
    sql = BILED_ORDER_SELECT
    params: list[Any] = []
    if status:
        sql += " WHERE b.status = ?"
        params.append(status)
    sql += " ORDER BY b.id DESC LIMIT ?"
    params.append(limit)
    async with db.execute(sql, params) as cur:
        return await cur.fetchall()


async def set_biled_order_status(order_id: int, status: str) -> None:
    db = get_db()
    await db.execute("UPDATE biled_orders SET status = ? WHERE id = ?", (status, order_id))
    await db.commit()


# ------------------------------------------------ kontent: banner, story, aksiya


async def get_banners(car_id: int | None = None) -> list[aiosqlite.Row]:
    db = get_db()
    sql = "SELECT * FROM banners WHERE is_active = 1"
    params: list[Any] = []
    if car_id is not None:
        sql += " AND (car_id IS NULL OR car_id = ?)"
        params.append(car_id)
    sql += " ORDER BY sort, id"
    async with db.execute(sql, params) as cur:
        return await cur.fetchall()


async def get_stories() -> list[aiosqlite.Row]:
    db = get_db()
    async with db.execute(
        "SELECT * FROM stories WHERE is_active = 1 ORDER BY sort, id"
    ) as cur:
        return await cur.fetchall()


async def get_promos() -> list[aiosqlite.Row]:
    db = get_db()
    async with db.execute(
        "SELECT * FROM promos WHERE is_active = 1 ORDER BY sort, id"
    ) as cur:
        return await cur.fetchall()


async def add_banner(
    title: str, subtitle: str | None, tag: str | None, photo_id: str | None
) -> int:
    db = get_db()
    cur = await db.execute(
        "INSERT INTO banners (title, subtitle, tag, photo_id) VALUES (?, ?, ?, ?)",
        (title, subtitle, tag, photo_id),
    )
    await db.commit()
    return int(cur.lastrowid)


async def add_story(
    title: str, emoji: str, heading: str | None, body: str | None, photo_id: str | None
) -> int:
    db = get_db()
    cur = await db.execute(
        "INSERT INTO stories (title, emoji, heading, body, photo_id)"
        " VALUES (?, ?, ?, ?, ?)",
        (title, emoji, heading, body, photo_id),
    )
    await db.commit()
    return int(cur.lastrowid)



# --------------------------------------------------- Firebase'dan import qilish


async def upsert_external_product(
    external_id: str,
    category_id: int,
    car_id: int | None,
    name: str,
    description: str | None,
    price: int,
    old_price: int | None,
    stock: int,
    photo_url: str | None,
    badge: str | None,
    is_active: int = 1,
) -> int:
    """Firebase'dagi tovarni mahalliy bazaga yozadi (bor bo'lsa yangilaydi)."""
    db = get_db()
    async with db.execute(
        "SELECT id FROM products WHERE external_id = ?", (external_id,)
    ) as cur:
        row = await cur.fetchone()

    if row:
        await db.execute(
            "UPDATE products SET category_id = ?, car_id = ?, name = ?, description = ?,"
            " price = ?, old_price = ?, stock = ?, photo_url = ?, badge = ?, is_active = ?"
            " WHERE id = ?",
            (
                category_id,
                car_id,
                name,
                description,
                price,
                old_price,
                stock,
                photo_url,
                badge,
                is_active,
                row["id"],
            ),
        )
        await db.commit()
        return int(row["id"])

    cur = await db.execute(
        "INSERT INTO products (category_id, car_id, name, description, price, old_price,"
        " stock, photo_url, badge, is_active, external_id)"
        " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (
            category_id,
            car_id,
            name,
            description,
            price,
            old_price,
            stock,
            photo_url,
            badge,
            is_active,
            external_id,
        ),
    )
    await db.commit()
    return int(cur.lastrowid)



# ========================================================================
#         ADMIN CRUD uchun universal so'rovlar (jadval/ustun oq ro'yxati)
# ========================================================================

# Xavfsizlik: jadval va ustun nomlari faqat shu ro'yxatdan olinadi.
EDITABLE: dict[str, set[str]] = {
    "cars": {
        "name", "slug", "years", "note", "sort", "is_active",
        "photo_id", "photo_url", "video_id", "video_url",
    },
    "biled_types": {
        "name", "brand", "size", "kelvin", "lumen", "warranty", "description",
        "price", "badge", "glow", "sort", "is_active",
        "photo_id", "photo_url", "video_id", "video_url",
    },
    "shrouds": {
        "name", "style", "ring_color", "description", "price", "sort", "is_active",
        "photo_id", "photo_url", "video_id", "video_url",
    },
    "optic_colors": {
        "name", "hex_from", "hex_to", "description", "price", "sort", "is_active",
        "photo_id", "photo_url", "video_id", "video_url",
    },
    "products": {
        "category_id", "car_id", "name", "description", "price", "old_price",
        "stock", "badge", "sort", "is_active",
        "photo_id", "photo_url", "video_id", "video_url",
    },
    "categories": {"name", "icon", "sort", "is_active"},
    "services": {"name", "duration_min", "price", "is_active"},
    "banners": {
        "title", "subtitle", "tag", "color_from", "color_to", "car_id",
        "sort", "is_active", "photo_id", "photo_url", "video_id", "video_url",
    },
    "stories": {
        "title", "emoji", "heading", "body", "color_from", "color_to",
        "sort", "is_active", "photo_id", "photo_url", "video_id", "video_url",
    },
    "promos": {"title", "text", "discount", "until_date", "sort", "is_active"},
}


def _check(table: str, column: str | None = None) -> None:
    if table not in EDITABLE:
        raise ValueError(f"Ruxsat berilmagan jadval: {table}")
    if column is not None and column not in EDITABLE[table]:
        raise ValueError(f"Ruxsat berilmagan ustun: {table}.{column}")


async def admin_list(table: str, limit: int = 60) -> list[aiosqlite.Row]:
    _check(table)
    db = get_db()
    order = "sort, id" if "sort" in EDITABLE[table] else "id"
    async with db.execute(f"SELECT * FROM {table} ORDER BY {order} LIMIT ?", (limit,)) as cur:
        return await cur.fetchall()


async def admin_get(table: str, row_id: int) -> aiosqlite.Row | None:
    _check(table)
    db = get_db()
    async with db.execute(f"SELECT * FROM {table} WHERE id = ?", (row_id,)) as cur:
        return await cur.fetchone()


async def admin_update(table: str, row_id: int, column: str, value) -> None:
    _check(table, column)
    db = get_db()
    await db.execute(f"UPDATE {table} SET {column} = ? WHERE id = ?", (value, row_id))
    await db.commit()


async def admin_toggle(table: str, row_id: int, column: str = "is_active") -> int:
    """Faol/o'chirilgan holatini almashtiradi va yangi qiymatni qaytaradi."""
    _check(table, column)
    db = get_db()
    await db.execute(
        f"UPDATE {table} SET {column} = 1 - COALESCE({column}, 0) WHERE id = ?", (row_id,)
    )
    await db.commit()
    row = await admin_get(table, row_id)
    return int(row[column]) if row else 0


async def admin_insert(table: str, data: dict[str, Any]) -> int:
    _check(table)
    for column in data:
        _check(table, column)
    if not data:
        raise ValueError("Bo'sh ma'lumot")

    db = get_db()
    columns = ", ".join(data)
    marks = ", ".join("?" for _ in data)
    cur = await db.execute(
        f"INSERT INTO {table} ({columns}) VALUES ({marks})", tuple(data.values())
    )
    await db.commit()
    return int(cur.lastrowid)


async def admin_delete(table: str, row_id: int) -> None:
    _check(table)
    db = get_db()
    await db.execute(f"DELETE FROM {table} WHERE id = ?", (row_id,))
    await db.commit()


async def admin_next_sort(table: str) -> int:
    _check(table)
    if "sort" not in EDITABLE[table]:
        return 0
    db = get_db()
    async with db.execute(f"SELECT COALESCE(MAX(sort), 0) + 1 FROM {table}") as cur:
        row = await cur.fetchone()
    return int(row[0])


async def admin_count(table: str) -> int:
    _check(table)
    db = get_db()
    async with db.execute(f"SELECT COUNT(*) FROM {table}") as cur:
        row = await cur.fetchone()
    return int(row[0])


# ========================================================================
#      KATALOGNI BULUTGA SAQLASH VA TIKLASH
#
# Admin panelda qo'shilgan tovar/linza/ochki va boshqalar ilgari FAQAT
# vaqtinchalik bazada qolardi — qayta deployda hammasi yo'qolib, o'rniga
# demo katalog qaytardi. Endi har bir o'zgarish bulutga yoziladi va
# bot ishga tushganda qaytariladi.
#
# ID'lar tozalangandan keyin o'zgaradi, shuning uchun moslash NOM bo'yicha
# bo'ladi (har bir jadvalning "nom" ustuni quyida).
# ========================================================================

CATALOG_KEY: dict[str, str] = {
    "categories": "name",
    "cars": "name",
    "biled_types": "name",
    "shrouds": "name",
    "optic_colors": "name",
    "services": "name",
    "products": "name",
    "banners": "title",
    "stories": "title",
    "promos": "title",
}

# Boshqa jadvalga bog'langan ustunlar: ustun -> (jadval, bulutdagi nom kaliti).
# Bulutda ID emas, NOM saqlanadi — ID'lar o'zgargani uchun.
CATALOG_LINKS: dict[str, dict[str, tuple[str, str]]] = {
    "products": {
        "category_id": ("categories", "categoryName"),
        "car_id": ("cars", "carName"),
    },
    "banners": {"car_id": ("cars", "carName")},
}

# Bulutga yozilmaydigan ustunlar (o'zi yasaladi / to'qnashuv keltiradi)
CATALOG_SKIP = {"slug", "external_id"}

# Jadvallarni tiklash tartibi: avval bog'lanadiganlar
CATALOG_ORDER = (
    "categories",
    "cars",
    "biled_types",
    "shrouds",
    "optic_colors",
    "services",
    "products",
    "banners",
    "stories",
    "promos",
)


def catalog_columns(table: str) -> list[str]:
    """Bulutga saqlanadigan ustunlar ro'yxati."""
    return sorted(column for column in EDITABLE.get(table, ()) if column not in CATALOG_SKIP)


async def get_row_name(table: str, row_id) -> str | None:
    """Bog'langan yozuvning nomini qaytaradi (bulutda ID o'rniga saqlash uchun)."""
    if table not in CATALOG_KEY or row_id in (None, ""):
        return None
    try:
        row_id = int(row_id)
    except (TypeError, ValueError):
        return None
    db = get_db()
    column = CATALOG_KEY[table]
    async with db.execute(f"SELECT {column} AS label FROM {table} WHERE id = ?", (row_id,)) as cur:
        row = await cur.fetchone()
    return str(row["label"]) if row and row["label"] else None


async def catalog_find(table: str, key_value: str) -> int | None:
    """Nom bo'yicha yozuvni topadi (katta-kichik harfga e'tibor bermaydi)."""
    if table not in CATALOG_KEY:
        raise ValueError(f"Ruxsat berilmagan jadval: {table}")
    if key_value is None or not str(key_value).strip():
        return None
    db = get_db()
    column = CATALOG_KEY[table]
    async with db.execute(
        f"SELECT id FROM {table} WHERE lower(TRIM({column})) = lower(TRIM(?))"
        " ORDER BY id LIMIT 1",
        (str(key_value),),
    ) as cur:
        row = await cur.fetchone()
    return int(row["id"]) if row else None


async def ensure_category(name: str | None) -> int | None:
    """Kategoriyani topadi, bo'lmasa yaratadi (tovar unga bog'lanishi shart)."""
    if not name or not str(name).strip():
        return None
    found = await catalog_find("categories", name)
    if found:
        return found
    db = get_db()
    cur = await db.execute("INSERT INTO categories (name) VALUES (?)", (str(name).strip(),))
    await db.commit()
    logger.info("Bulutdan tiklashda kategoriya yaratildi: %s", name)
    return int(cur.lastrowid)


async def catalog_upsert(table: str, values: dict[str, Any]) -> tuple[int, bool]:
    """Nom bo'yicha yangilaydi yoki yangi qo'shadi.

    Qaytaradi: (id, yangi_qo'shildimi).
    """
    if table not in CATALOG_KEY:
        raise ValueError(f"Ruxsat berilmagan jadval: {table}")

    allowed = set(catalog_columns(table))
    data = {column: value for column, value in values.items() if column in allowed}
    key_column = CATALOG_KEY[table]
    key_value = data.get(key_column)
    if key_value is None or not str(key_value).strip():
        raise ValueError(f"«{table}» uchun nom berilmagan")

    db = get_db()
    existing = await catalog_find(table, key_value)

    if existing is not None:
        updates = {c: v for c, v in data.items() if c != key_column}
        if updates:
            assignments = ", ".join(f"{c} = ?" for c in updates)
            await db.execute(
                f"UPDATE {table} SET {assignments} WHERE id = ?",
                (*updates.values(), existing),
            )
            await db.commit()
        return existing, False

    if table == "cars":
        data["slug"] = await _unique_car_slug(str(key_value))

    columns = ", ".join(data)
    marks = ", ".join("?" for _ in data)
    cur = await db.execute(
        f"INSERT INTO {table} ({columns}) VALUES ({marks})", tuple(data.values())
    )
    await db.commit()
    return int(cur.lastrowid), True


async def catalog_delete_by_key(table: str, key_value: str) -> bool:
    """Bulutda o'chirilgan yozuvni mahalliy bazadan ham olib tashlaydi.

    O'chirib bo'lmasa (boshqa yozuvlar bog'langan bo'lsa) — yashiradi.
    """
    if table not in CATALOG_KEY:
        raise ValueError(f"Ruxsat berilmagan jadval: {table}")
    row_id = await catalog_find(table, key_value)
    if row_id is None:
        return False

    db = get_db()
    try:
        await db.execute(f"DELETE FROM {table} WHERE id = ?", (row_id,))
        await db.commit()
    except Exception as error:
        logger.info("«%s» #%s o'chirilmadi (%s) — yashirildi", table, row_id, error)
        await db.execute(f"UPDATE {table} SET is_active = 0 WHERE id = ?", (row_id,))
        await db.commit()
    return True


# ========================================================================
#      TARIXNI BULUTDAN TIKLASH (buyurtmalar, navbatlar)
#
# Firebase'da buyurtmalar katalog ID'lari bilan emas, NOMLAR bilan
# saqlanadi ("Cobalt", "Aozoom A5+"). Sababi: baza tozalangandan keyin
# katalog qaytadan ekiladi va ID'lar o'zgarib ketadi — nom esa o'zgarmaydi.
#
# Shuning uchun tiklashda nom bo'yicha ID topamiz. Agar element o'chirilgan
# bo'lsa, uni YASHIRIN (is_active = 0) holda qayta yaratamiz: shunda
# buyurtma tarixi to'liq ko'rinadi, lekin mijozga katalogda ko'rinmaydi.
# ========================================================================

_NAME_TABLES = {"cars", "biled_types", "shrouds", "optic_colors", "services"}


async def find_by_name(table: str, name: str) -> int | None:
    """Nom bo'yicha ID topadi (katta-kichik harf va bo'shliqqa e'tibor bermaydi)."""
    if table not in _NAME_TABLES:
        raise ValueError(f"Ruxsat berilmagan jadval: {table}")
    if not name or not str(name).strip():
        return None
    db = get_db()
    async with db.execute(
        f"SELECT id FROM {table} WHERE lower(TRIM(name)) = lower(TRIM(?)) ORDER BY id LIMIT 1",
        (str(name),),
    ) as cur:
        row = await cur.fetchone()
    return int(row["id"]) if row else None


async def _unique_car_slug(name: str) -> str:
    """Mashina nomidan takrorlanmaydigan slug yasaydi (ustun UNIQUE)."""
    base = re.sub(r"[^a-z0-9]+", "", str(name).lower()) or "car"
    existing = {row["slug"] for row in await get_cars(active_only=False)}
    slug, index = base, 1
    while slug in existing:
        index += 1
        slug = f"{base}{index}"
    return slug


async def ensure_car(name: str | None) -> int | None:
    """Mashinani nom bo'yicha topadi, bo'lmasa yashirin holda yaratadi."""
    if not name or not str(name).strip():
        return None
    found = await find_by_name("cars", name)
    if found:
        return found

    slug = await _unique_car_slug(str(name))
    db = get_db()
    cur = await db.execute(
        "INSERT INTO cars (name, slug, is_active) VALUES (?, ?, 0)", (str(name).strip(), slug)
    )
    await db.commit()
    logger.info("Tarix uchun yashirin mashina yaratildi: %s", name)
    return int(cur.lastrowid)


async def _ensure_simple(table: str, name: str | None) -> int | None:
    """Nomi bor jadvallar uchun umumiy "topib ol yoki yashirin yarat"."""
    if not name or not str(name).strip():
        return None
    found = await find_by_name(table, name)
    if found:
        return found
    db = get_db()
    cur = await db.execute(
        f"INSERT INTO {table} (name, is_active) VALUES (?, 0)", (str(name).strip(),)
    )
    await db.commit()
    logger.info("Tarix uchun yashirin yozuv yaratildi: %s.%s", table, name)
    return int(cur.lastrowid)


async def ensure_biled(name: str | None) -> int | None:
    return await _ensure_simple("biled_types", name)


async def ensure_shroud(name: str | None) -> int | None:
    return await _ensure_simple("shrouds", name)


async def ensure_color(name: str | None) -> int | None:
    return await _ensure_simple("optic_colors", name)


async def ensure_service(name: str | None) -> int | None:
    return await _ensure_simple("services", name)


async def ensure_user(user_id: int, full_name: str | None, phone: str | None) -> None:
    """Buyurtma egasini yaratadi (agar hali bazada bo'lmasa).

    Buyurtmalar `users` ga bog'langan, shuning uchun tarixni tiklashdan
    oldin mijoz qatori bo'lishi kerak. Mavjud ma'lumot ustidan YOZMAYDI.
    """
    db = get_db()
    await db.execute(
        "INSERT INTO users (user_id, full_name, phone) VALUES (?, ?, ?)"
        " ON CONFLICT(user_id) DO NOTHING",
        (user_id, (full_name or "Mijoz").strip(), phone),
    )
    await db.commit()


async def restore_biled_order(data: dict[str, Any]) -> bool:
    """Bi-LED buyurtmasini asl ID'si bilan tiklaydi. True — yangi qo'shildi."""
    db = get_db()
    cur = await db.execute(
        "INSERT OR IGNORE INTO biled_orders"
        " (id, user_id, car_id, biled_id, shroud_id, color_id, total, phone,"
        "  comment, status, created_at)"
        " VALUES (:id, :user_id, :car_id, :biled_id, :shroud_id, :color_id, :total,"
        "         :phone, :comment, :status, COALESCE(:created_at, datetime('now')))",
        data,
    )
    await db.commit()
    return cur.rowcount > 0


async def restore_shop_order(data: dict[str, Any], items: Sequence[dict]) -> bool:
    """Do'kon buyurtmasini va tarkibini tiklaydi. True — yangi qo'shildi."""
    db = get_db()
    cur = await db.execute(
        "INSERT OR IGNORE INTO orders"
        " (id, user_id, total, address, phone, status, created_at)"
        " VALUES (:id, :user_id, :total, :address, :phone, :status,"
        "         COALESCE(:created_at, datetime('now')))",
        data,
    )
    await db.commit()
    if cur.rowcount <= 0:
        return False

    # Tovar ID'lari bulutda saqlanmaydi (ular o'zgarib ketadi) — nomi,
    # narxi va soni saqlanadi, shuning uchun product_id = NULL.
    rows = [
        (data["id"], str(item.get("name") or "Tovar"), int(item.get("price") or 0),
         int(item.get("qty") or 1))
        for item in items
    ]
    if rows:
        await db.executemany(
            "INSERT INTO order_items (order_id, product_id, name, price, qty)"
            " VALUES (?, NULL, ?, ?, ?)",
            rows,
        )
        await db.commit()
    return True


async def restore_booking(data: dict[str, Any]) -> bool:
    """Navbatni asl ID'si bilan tiklaydi. True — yangi qo'shildi."""
    db = get_db()
    cur = await db.execute(
        "INSERT OR IGNORE INTO bookings"
        " (id, user_id, service_id, date, time, status, created_at)"
        " VALUES (:id, :user_id, :service_id, :date, :time, :status,"
        "         COALESCE(:created_at, datetime('now')))",
        data,
    )
    await db.commit()
    return cur.rowcount > 0


def media_of(row: aiosqlite.Row, kind: str = "photo") -> tuple[str | None, str | None]:
    """(file_id, url) juftligini qaytaradi — mavjud bo'lganini."""
    keys = row.keys()
    file_id = row[f"{kind}_id"] if f"{kind}_id" in keys else None
    url = row[f"{kind}_url"] if f"{kind}_url" in keys else None
    return file_id, url
