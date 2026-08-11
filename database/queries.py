"""Bazaga so'rovlar. Har bir funksiya aiosqlite.Row yoki oddiy tip qaytaradi."""

from collections.abc import Sequence
from typing import Any

import aiosqlite

from database.db import get_db

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


async def get_user(user_id: int) -> aiosqlite.Row | None:
    db = get_db()
    async with db.execute("SELECT * FROM users WHERE user_id = ?", (user_id,)) as cur:
        return await cur.fetchone()


async def update_phone(user_id: int, phone: str) -> None:
    db = get_db()
    await db.execute("UPDATE users SET phone = ? WHERE user_id = ?", (phone, user_id))
    await db.commit()


async def get_all_user_ids() -> list[int]:
    db = get_db()
    async with db.execute("SELECT user_id FROM users WHERE is_blocked = 0") as cur:
        return [row["user_id"] async for row in cur]


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


async def get_products(category_id: int, active_only: bool = True) -> list[aiosqlite.Row]:
    db = get_db()
    sql = "SELECT * FROM products WHERE category_id = ?"
    if active_only:
        sql += " AND is_active = 1"
    sql += " ORDER BY id"
    async with db.execute(sql, (category_id,)) as cur:
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
    }
    stats: dict[str, int] = {}
    for key, (sql, params) in queries.items():
        async with db.execute(sql, params) as cur:
            row = await cur.fetchone()
        stats[key] = int(row[0])
    return stats



# --------------------------------------------------------- Mini App uchun qo'shimcha


async def get_catalog() -> list[dict[str, Any]]:
    """Kategoriyalar va ularning mahsulotlari — Mini App uchun bitta ro'yxatda."""
    categories = await get_categories()
    catalog: list[dict[str, Any]] = []
    for category in categories:
        products = await get_products(category["id"])
        catalog.append(
            {
                "id": category["id"],
                "name": category["name"],
                "products": [
                    {
                        "id": product["id"],
                        "name": product["name"],
                        "description": product["description"],
                        "price": int(product["price"]),
                        "stock": int(product["stock"]),
                        "has_photo": bool(product["photo_id"]),
                    }
                    for product in products
                ],
            }
        )
    return catalog


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
