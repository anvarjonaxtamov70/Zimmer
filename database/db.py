"""SQLite ulanishi va jadvallarni yaratish."""

import logging

import aiosqlite

from config import config

logger = logging.getLogger(__name__)

_db: aiosqlite.Connection | None = None

SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    user_id     INTEGER PRIMARY KEY,
    full_name   TEXT NOT NULL,
    phone       TEXT,
    username    TEXT,
    is_blocked  INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS services (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    name         TEXT NOT NULL,
    duration_min INTEGER NOT NULL DEFAULT 30,
    price        INTEGER NOT NULL DEFAULT 0,
    is_active    INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS bookings (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL REFERENCES users(user_id),
    service_id INTEGER NOT NULL REFERENCES services(id),
    date       TEXT NOT NULL,
    time       TEXT NOT NULL,
    status     TEXT NOT NULL DEFAULT 'new',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_bookings_date ON bookings(date, status);
CREATE INDEX IF NOT EXISTS idx_bookings_user ON bookings(user_id);

CREATE TABLE IF NOT EXISTS categories (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    name      TEXT NOT NULL,
    is_active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS products (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    description TEXT,
    price       INTEGER NOT NULL DEFAULT 0,
    stock       INTEGER NOT NULL DEFAULT 0,
    photo_id    TEXT,
    is_active   INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_products_category ON products(category_id, is_active);

CREATE TABLE IF NOT EXISTS cart_items (
    user_id    INTEGER NOT NULL REFERENCES users(user_id),
    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    qty        INTEGER NOT NULL DEFAULT 1,
    PRIMARY KEY (user_id, product_id)
);

CREATE TABLE IF NOT EXISTS orders (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL REFERENCES users(user_id),
    total      INTEGER NOT NULL DEFAULT 0,
    address    TEXT,
    phone      TEXT,
    status     TEXT NOT NULL DEFAULT 'new',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_id);

CREATE TABLE IF NOT EXISTS order_items (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id   INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    product_id INTEGER,
    name       TEXT NOT NULL,
    price      INTEGER NOT NULL,
    qty        INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);
"""

DEMO_SERVICES = [
    ("Soch olish", 30, 50000),
    ("Soqol olish", 20, 30000),
    ("Soch + soqol", 50, 70000),
]

DEMO_CATEGORIES = ["Sochga parvarish", "Aksessuarlar"]

DEMO_PRODUCTS = [
    (1, "Shampun", "Barcha soch turlari uchun, 400 ml", 45000, 20),
    (1, "Soch uchun mum", "Kuchli fiksatsiya, 100 ml", 60000, 15),
    (2, "Taroq", "Yog'ochdan yasalgan taroq", 25000, 30),
]


async def init_db() -> aiosqlite.Connection:
    """Bazani ochadi, jadvallarni yaratadi va bo'sh bo'lsa demo ma'lumot qo'shadi."""
    global _db
    _db = await aiosqlite.connect(config.db_path)
    _db.row_factory = aiosqlite.Row
    await _db.execute("PRAGMA foreign_keys = ON")
    await _db.executescript(SCHEMA)
    await _db.commit()
    await _seed()
    logger.info("Baza tayyor: %s", config.db_path)
    return _db


def get_db() -> aiosqlite.Connection:
    if _db is None:
        raise RuntimeError("Baza ochilmagan. Avval init_db() ni chaqiring.")
    return _db


async def close_db() -> None:
    global _db
    if _db is not None:
        await _db.close()
        _db = None


async def _seed() -> None:
    """Birinchi ishga tushirishda namuna xizmat va mahsulotlar."""
    db = get_db()
    async with db.execute("SELECT COUNT(*) FROM services") as cur:
        row = await cur.fetchone()
    if row[0] == 0:
        await db.executemany(
            "INSERT INTO services (name, duration_min, price) VALUES (?, ?, ?)",
            DEMO_SERVICES,
        )

    async with db.execute("SELECT COUNT(*) FROM categories") as cur:
        row = await cur.fetchone()
    if row[0] == 0:
        for name in DEMO_CATEGORIES:
            await db.execute("INSERT INTO categories (name) VALUES (?)", (name,))
        await db.executemany(
            "INSERT INTO products (category_id, name, description, price, stock)"
            " VALUES (?, ?, ?, ?, ?)",
            DEMO_PRODUCTS,
        )
    await db.commit()
