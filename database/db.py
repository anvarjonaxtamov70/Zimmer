"""SQLite ulanishi, jadvallar va boshlang'ich (demo) ma'lumotlar.

Zimmer — Bi-LED avtotuning: mashina → Bi-LED linza → ochki (maska) →
fara optikasi rangi. Shuning uchun bazada ham shu bosqichlarga mos
jadvallar bor.
"""

import logging

import aiosqlite

from config import config

logger = logging.getLogger(__name__)

_db: aiosqlite.Connection | None = None

# Demo ma'lumotlar versiyasi. Oshirilsa, katalog qaytadan ekiladi
# (faqat buyurtma/navbat bo'lmagan "toza" bazada).
SEED_VERSION = 2

SCHEMA = """
CREATE TABLE IF NOT EXISTS meta (
    key   TEXT PRIMARY KEY,
    value TEXT
);

CREATE TABLE IF NOT EXISTS users (
    user_id    INTEGER PRIMARY KEY,
    full_name  TEXT NOT NULL,
    phone      TEXT,
    username   TEXT,
    car_id     INTEGER REFERENCES cars(id),
    is_blocked INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Mijoz saqlab qo'ygan tovarlar («Saqlanganlar»).
-- Tovar o'chirilsa yozuv o'zi ketadi (ON DELETE CASCADE).
CREATE TABLE IF NOT EXISTS favorites (
    user_id    INTEGER NOT NULL REFERENCES users(user_id),
    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (user_id, product_id)
);

-- Bot ichidan qo'shilgan adminlar. Koddagi CORE_ADMINS va env'dagi
-- ADMINS shu jadvaldan mustaqil — ular har doim admin bo'lib qoladi.
CREATE TABLE IF NOT EXISTS admins (
    user_id    INTEGER PRIMARY KEY,
    full_name  TEXT,
    added_by   INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ------------------------------------------------------------- mashinalar
CREATE TABLE IF NOT EXISTS cars (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    name      TEXT NOT NULL,
    slug      TEXT NOT NULL UNIQUE,
    years     TEXT,
    note      TEXT,
    sort      INTEGER NOT NULL DEFAULT 0,
    is_active INTEGER NOT NULL DEFAULT 1
);

-- ---------------------------------------------------------- Bi-LED linzalar
CREATE TABLE IF NOT EXISTS biled_types (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL,
    brand       TEXT,
    size        TEXT,
    kelvin      TEXT,
    lumen       TEXT,
    warranty    TEXT,
    description TEXT,
    price       INTEGER NOT NULL DEFAULT 0,
    badge       TEXT,
    glow        TEXT NOT NULL DEFAULT '#dff1ff',
    sort        INTEGER NOT NULL DEFAULT 0,
    is_active   INTEGER NOT NULL DEFAULT 1
);

-- ------------------------------------------------------- ochki (maska/shroud)
CREATE TABLE IF NOT EXISTS shrouds (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL,
    style       TEXT NOT NULL DEFAULT 'classic',
    ring_color  TEXT NOT NULL DEFAULT '#d7dae0',
    description TEXT,
    price       INTEGER NOT NULL DEFAULT 0,
    sort        INTEGER NOT NULL DEFAULT 0,
    is_active   INTEGER NOT NULL DEFAULT 1
);

-- --------------------------------------------------------- optika ranglari
CREATE TABLE IF NOT EXISTS optic_colors (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL,
    hex_from    TEXT NOT NULL DEFAULT '#c9ced6',
    hex_to      TEXT NOT NULL DEFAULT '#6b7280',
    description TEXT,
    price       INTEGER NOT NULL DEFAULT 0,
    sort        INTEGER NOT NULL DEFAULT 0,
    is_active   INTEGER NOT NULL DEFAULT 1
);

-- ------------------------------------------------ Bi-LED (tuning) buyurtmasi
CREATE TABLE IF NOT EXISTS biled_orders (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL REFERENCES users(user_id),
    car_id     INTEGER NOT NULL REFERENCES cars(id),
    biled_id   INTEGER NOT NULL REFERENCES biled_types(id),
    shroud_id  INTEGER REFERENCES shrouds(id),
    color_id   INTEGER REFERENCES optic_colors(id),
    total      INTEGER NOT NULL DEFAULT 0,
    phone      TEXT,
    comment    TEXT,
    status     TEXT NOT NULL DEFAULT 'new',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_biled_orders_user ON biled_orders(user_id);

-- ------------------------------------------------------ o'rnatish navbatlari
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

-- ----------------------------------------------------------------- do'kon
CREATE TABLE IF NOT EXISTS categories (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    name      TEXT NOT NULL,
    icon      TEXT,
    sort      INTEGER NOT NULL DEFAULT 0,
    is_active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS products (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
    car_id      INTEGER REFERENCES cars(id),   -- NULL = barcha mashinalar uchun
    name        TEXT NOT NULL,
    description TEXT,
    price       INTEGER NOT NULL DEFAULT 0,
    old_price   INTEGER,
    stock       INTEGER NOT NULL DEFAULT 0,
    code        TEXT,                          -- artikul / OEM kod
    unit        TEXT,                          -- 'dona' | 'komplekt'
    product_type TEXT,                         -- 'oddiy' | 'razmerli'
    sizes       TEXT,                          -- razmerli uchun JSON: [{size, stock}]
    photo_id    TEXT,                          -- Telegram rasm file_id
    photo_url   TEXT,                          -- tashqi rasm manzili (Firebase/sayt)
    photo2_id   TEXT,                          -- 2-rasm
    photo2_url  TEXT,
    photo3_id   TEXT,                          -- 3-rasm
    photo3_url  TEXT,
    external_id TEXT UNIQUE,                   -- Firebase kaliti (import uchun)
    badge       TEXT,
    is_active   INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_products_category ON products(category_id, is_active);
CREATE INDEX IF NOT EXISTS idx_products_car ON products(car_id);

CREATE TABLE IF NOT EXISTS cart_items (
    user_id    INTEGER NOT NULL REFERENCES users(user_id),
    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    qty        INTEGER NOT NULL DEFAULT 1,
    PRIMARY KEY (user_id, product_id)
);

CREATE TABLE IF NOT EXISTS orders (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id         INTEGER NOT NULL REFERENCES users(user_id),
    total           INTEGER NOT NULL DEFAULT 0,
    address         TEXT,
    phone           TEXT,
    delivery_method TEXT,              -- 'courier' | 'bts' | NULL
    delivery_info   TEXT,              -- yetkazib berish tafsiloti (matn)
    payment_method  TEXT,              -- to'lov usuli (matn)
    status          TEXT NOT NULL DEFAULT 'new',
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
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

-- -------------------------------------------------- kontent: banner/story/aksiya
CREATE TABLE IF NOT EXISTS banners (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    title     TEXT NOT NULL,
    subtitle  TEXT,
    tag       TEXT,
    color_from TEXT NOT NULL DEFAULT '#e01020',
    color_to   TEXT NOT NULL DEFAULT '#3a0008',
    photo_id  TEXT,
    car_id    INTEGER REFERENCES cars(id),
    sort      INTEGER NOT NULL DEFAULT 0,
    is_active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS stories (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    title     TEXT NOT NULL,
    emoji     TEXT NOT NULL DEFAULT '🔧',
    heading   TEXT,
    body      TEXT,
    color_from TEXT NOT NULL DEFAULT '#ff3b30',
    color_to   TEXT NOT NULL DEFAULT '#7a0010',
    photo_id  TEXT,
    sort      INTEGER NOT NULL DEFAULT 0,
    is_active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS promos (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    title      TEXT NOT NULL,
    text       TEXT,
    discount   TEXT,
    until_date TEXT,
    sort       INTEGER NOT NULL DEFAULT 0,
    is_active  INTEGER NOT NULL DEFAULT 1
);
"""

# ------------------------------------------------------------------ demo ma'lumot

DEMO_CARS = [
    # name, slug, years, note, sort
    ("Gentra", "gentra", "2013 – 2024", "Chevrolet / Ravon Gentra", 1),
    ("Nexia 2", "nexia2", "2008 – 2016", "Daewoo Nexia 2 (DOHC / SOHC)", 2),
]

DEMO_BILED = [
    # name, brand, size, kelvin, lumen, warranty, description, price, badge, glow, sort
    (
        "ZES 5 Ultra 3.0",
        "ZES",
        '3.0"',
        "5000K",
        "6 000 lm",
        "6 oy",
        "Byudjet variant. Yorug'lik chegarasi aniq, kunlik yurish uchun yetarli.",
        1_200_000,
        "Byudjet",
        "#eaf4ff",
        1,
    ),
    (
        "Koito Q5 3.0",
        "Koito",
        '3.0"',
        "5500K",
        "8 500 lm",
        "1 yil",
        "Yaponiya optikasi. Silliq yorug'lik chizig'i, ko'zni qamashtirmaydi.",
        1_500_000,
        None,
        "#f2f8ff",
        2,
    ),
    (
        "Hella 3R 3.0",
        "Hella",
        '3.0"',
        "5000K",
        "9 000 lm",
        "1 yil",
        "Original zavod sifatiga eng yaqin variant. Chegarasi juda tekis.",
        2_200_000,
        "Original",
        "#ffffff",
        3,
    ),
    (
        "Aozoom A5+ 3.0",
        "Aozoom",
        '3.0"',
        "5500K",
        "11 000 lm",
        "1 yil",
        "Eng ko'p tanlanadigan model. Kuchli yorug'lik + toza chegara.",
        1_900_000,
        "TOP tanlov",
        "#ffffff",
        4,
    ),
    (
        "Aozoom Dragon Knight 3.0",
        "Aozoom",
        '3.0"',
        "6000K",
        "14 000 lm",
        "2 yil",
        "Premium daraja. Maksimal yorug'lik, kechasi kunduzdek ko'rinish.",
        2_600_000,
        "Premium",
        "#ffffff",
        5,
    ),
]

DEMO_SHROUDS = [
    # name, style, ring_color, description, price, sort
    (
        "Klassik xrom",
        "classic",
        "#d9dee6",
        "Zavod ko'rinishi, oddiy va bezakli xrom halqa.",
        250_000,
        1,
    ),
    (
        "Devil Eyes",
        "devil",
        "#ff2d2d",
        "Qizil shayton ko'zi. Kechasi juda ajralib turadi.",
        450_000,
        2,
    ),
    ("Angel Eyes", "angel", "#eaf6ff", "Oq halqa (DRL). Nemis avtomobillari uslubi.", 400_000, 3),
    (
        "Sport matt qora",
        "sport",
        "#2a2d33",
        "Matt qora agressiv maska. Qizil optikaga juda mos.",
        300_000,
        4,
    ),
    ("Karbon", "carbon", "#3c4046", "Haqiqiy karbon to'quv naqshi. Premium ko'rinish.", 500_000, 5),
]

DEMO_COLORS = [
    # name, hex_from, hex_to, description, price, sort
    ("Xrom (standart)", "#e7ebf1", "#8b929c", "Zavod xrom ko'rinishi.", 0, 1),
    ("Matt qora", "#3a3d42", "#111216", "Eng ko'p tanlanadigan zamonaviy uslub.", 350_000, 2),
    ("Tutun (smoke)", "#5b5f6b", "#1b1d22", "Tutunsimon yarim shaffof effekt.", 400_000, 3),
    (
        "Qizil aksent",
        "#ff3b30",
        "#6d0a10",
        "Qora korpus + qizil chiziq. Zimmer uslubi.",
        450_000,
        4,
    ),
    ("Oltin", "#f0d060", "#8a6a14", "Cheklangan uslub. Diqqatni tortadi.", 500_000, 5),
]

DEMO_SERVICES = [
    ("Bi-LED o'rnatish (2 fara)", 120, 400_000),
    ("Fara polirovka / tozalash", 60, 150_000),
    ("Fara germetizatsiya", 45, 120_000),
]

DEMO_CATEGORIES = [
    ("Lampalar", "💡", 1),
    ("DRL va lentalar", "🔆", 2),
    ("Fara uchun materiallar", "🧰", 3),
]

# kategoriya tartibi, mashina slug (None = universal), nom, tavsif,
# narx, eski narx, ombor, badge
DEMO_PRODUCTS = [
    (
        1,
        None,
        "LED lampa H4 (juft)",
        "6000K, radiatorli sovutish, 12V",
        320_000,
        380_000,
        24,
        "Chegirma",
    ),
    (1, None, "LED lampa H7 (juft)", "6000K, CANBUS bilan", 300_000, None, 18, None),
    (
        1,
        "gentra",
        "Gentra uchun H4 to'plami",
        "Gentra faralariga aynan mos, adapter bilan",
        420_000,
        None,
        10,
        "Mos keladi",
    ),
    (
        1,
        "nexia2",
        "Nexia 2 uchun H4 to'plami",
        "Nexia 2 fara korpusiga mos, uzaytirgich bilan",
        390_000,
        None,
        12,
        "Mos keladi",
    ),
    (
        2,
        None,
        "DRL lenta COB (2 dona)",
        "Kunduzgi yurish chirog'i, egiluvchan",
        180_000,
        220_000,
        30,
        None,
    ),
    (
        2,
        "gentra",
        "Gentra DRL bamper lentasi",
        "Bamperga o'rnatiladigan to'plam",
        260_000,
        None,
        8,
        None,
    ),
    (3, None, "Fara germetigi (qora)", "Issiqqa chidamli, 310 ml", 85_000, None, 40, None),
    (
        3,
        None,
        "Polirovka to'plami",
        "Pasta + doska, faralarni tiklash uchun",
        150_000,
        None,
        15,
        None,
    ),
    (3, "nexia2", "Nexia 2 fara shishasi", "Original o'lchamda, shaffof", 480_000, None, 6, None),
]

DEMO_BANNERS = [
    (
        "Bi-LED o'rnatish",
        "Ikki faraga to'liq to'plam + o'rnatish",
        "-15% shu hafta",
        "#ff2d2d",
        "#38000a",
        None,
        1,
    ),
    (
        "Kafolat 1 yil",
        "Linzalarga rasmiy kafolat, xizmat ko'rsatish bilan",
        "Ishonch",
        "#c1121f",
        "#14161a",
        None,
        2,
    ),
    (
        "Gentra & Nexia 2",
        "Aynan sizning modelga tayyor yechimlar",
        "Yangi",
        "#8a0f18",
        "#0b0c0f",
        None,
        3,
    ),
]

DEMO_STORIES = [
    (
        "Ish jarayoni",
        "🔧",
        "Fara qanday ochiladi?",
        "Fara ehtiyotkorlik bilan pechda ochiladi, ichi tozalanadi, linza markazlab "
        "o'rnatiladi va qayta germetizatsiya qilinadi. Butun jarayon 2-3 soat.",
        "#ff3b30",
        "#6d0a10",
        1,
    ),
    (
        "Natija",
        "✨",
        "Kechasi farq juda katta",
        "Bi-LED yorug'ligi aniq chegara bilan tushadi — qarshi haydovchini "
        "qamashtirmaydi, lekin yo'l kunduzdek ko'rinadi.",
        "#e01020",
        "#2a0006",
        2,
    ),
    (
        "Mijoz fikri",
        "💬",
        "Gentra egasi, Toshkent",
        "«Aozoom A5+ o'rnatdim. Kechasi yo'lni ko'rish butunlay boshqacha bo'ldi, "
        "ochki ham juda chiroyli chiqdi.»",
        "#ff6b3d",
        "#3a0f00",
        3,
    ),
    (
        "Kafolat",
        "🛡",
        "1 yil kafolat",
        "Barcha linzalarga kafolat beriladi. Muammo chiqsa — bepul tekshirib, "
        "kerak bo'lsa almashtiramiz.",
        "#c1121f",
        "#101215",
        4,
    ),
]

DEMO_PROMOS = [
    (
        "Juft fara chegirmasi",
        "Ikki farani birga qilsangiz — o'rnatish narxidan 15% chegirma.",
        "-15%",
        None,
        1,
    ),
    ("Ochki sovg'a", "Premium linza tanlaganlarga klassik ochki bepul.", "Sovg'a", None, 2),
    ("Bo'lib to'lash", "3 oyga foizsiz bo'lib to'lash imkoniyati mavjud.", "0%", None, 3),
]


# --------------------------------------------------------------------- ulanish


# Media ustunlari: har bir element uchun rasm va video
#   *_id  — Telegram file_id (admin panelda yuklanadi)
#   *_url — tashqi manzil (Firebase Storage / sayt / CDN)
MEDIA_COLUMNS = [
    ("photo_id", "TEXT"),
    ("photo_url", "TEXT"),
    ("video_id", "TEXT"),
    ("video_url", "TEXT"),
]

# Eski bazalarga qo'shiladigan ustunlar (`_migrate` shu ro'yxat bo'yicha ishlaydi).
# Modul darajasida turadi — qaysi ustunlar qayerda borligini bir joydan ko'rish
# mumkin bo'lsin.
MIGRATIONS: dict[str, list[tuple[str, str]]] = {
    "users": [("car_id", "INTEGER")],
    "products": [
        ("car_id", "INTEGER"),
        ("old_price", "INTEGER"),
        ("badge", "TEXT"),
        ("external_id", "TEXT"),
        ("sort", "INTEGER NOT NULL DEFAULT 0"),
        *MEDIA_COLUMNS,
    ],
    "categories": [("icon", "TEXT"), ("sort", "INTEGER NOT NULL DEFAULT 0")],
    # Ombor va "yangi tovar qo'shish" uchun qo'shimcha maydonlar
    "products": [
        ("code", "TEXT"),
        ("unit", "TEXT"),
        ("product_type", "TEXT"),
        ("sizes", "TEXT"),
        ("photo2_id", "TEXT"),
        ("photo2_url", "TEXT"),
        ("photo3_id", "TEXT"),
        ("photo3_url", "TEXT"),
    ],
    # Eski bazalarga yetkazib berish/to'lov ustunlarini qo'shamiz.
    "orders": [
        ("delivery_method", "TEXT"),
        ("delivery_info", "TEXT"),
        ("payment_method", "TEXT"),
    ],
    "cars": [*MEDIA_COLUMNS],
    "biled_types": [*MEDIA_COLUMNS],
    "shrouds": [*MEDIA_COLUMNS],
    "optic_colors": [*MEDIA_COLUMNS],
    "banners": [*MEDIA_COLUMNS],
    "stories": [*MEDIA_COLUMNS],
}


async def init_db() -> aiosqlite.Connection:
    global _db
    _db = await aiosqlite.connect(config.db_path)
    _db.row_factory = aiosqlite.Row
    await _db.execute("PRAGMA foreign_keys = ON")
    await _db.executescript(SCHEMA)
    await _db.commit()
    await _migrate()
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


async def _columns(table: str) -> set[str]:
    db = get_db()
    async with db.execute(f"PRAGMA table_info({table})") as cur:
        rows = await cur.fetchall()
    return {row["name"] for row in rows}


async def _migrate() -> None:
    """Eski bazalarga yangi ustunlarni qo'shadi (ma'lumot yo'qotmasdan)."""
    db = get_db()
    for table, columns in MIGRATIONS.items():
        existing = await _columns(table)
        for column, ddl in columns:
            if column not in existing:
                await db.execute(f"ALTER TABLE {table} ADD COLUMN {column} {ddl}")
                logger.info("Migratsiya: %s.%s qo'shildi", table, column)

    # external_id bo'yicha yagona indeks (ALTER bilan UNIQUE qo'shilmaydi)
    await db.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_products_external"
        " ON products(external_id) WHERE external_id IS NOT NULL"
    )
    await db.commit()


async def _meta_get(key: str) -> str | None:
    db = get_db()
    async with db.execute("SELECT value FROM meta WHERE key = ?", (key,)) as cur:
        row = await cur.fetchone()
    return row["value"] if row else None


async def _meta_set(key: str, value: str) -> None:
    db = get_db()
    await db.execute(
        "INSERT INTO meta (key, value) VALUES (?, ?)"
        " ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        (key, value),
    )
    await db.commit()


async def _count(table: str) -> int:
    db = get_db()
    async with db.execute(f"SELECT COUNT(*) FROM {table}") as cur:
        row = await cur.fetchone()
    return int(row[0])


async def _seed() -> None:
    """Katalogni to'ldiradi. Eski demo ma'lumot bo'lsa, yangisiga almashtiradi."""
    db = get_db()
    current = await _meta_get("seed_version")

    if current == str(SEED_VERSION):
        return

    has_activity = (
        await _count("bookings") > 0
        or await _count("orders") > 0
        or await _count("biled_orders") > 0
    )

    if current is not None and has_activity:
        logger.warning(
            "Bazada buyurtmalar bor — katalog avtomatik yangilanmadi "
            "(seed_version=%s). Kerak bo'lsa admin panelda qo'lda o'zgartiring.",
            current,
        )
        await _meta_set("seed_version", str(SEED_VERSION))
        return

    if current is not None:
        # eski demo katalogni tozalaymiz (faoliyat yo'q, xavfsiz)
        for table in ("cart_items", "products", "categories", "services"):
            await db.execute(f"DELETE FROM {table}")
        logger.info("Eski demo katalog tozalandi (seed_version=%s)", current)

    await db.executemany(
        "INSERT INTO cars (name, slug, years, note, sort) VALUES (?, ?, ?, ?, ?)",
        DEMO_CARS,
    )
    await db.executemany(
        "INSERT INTO biled_types (name, brand, size, kelvin, lumen, warranty,"
        " description, price, badge, glow, sort) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
        DEMO_BILED,
    )
    await db.executemany(
        "INSERT INTO shrouds (name, style, ring_color, description, price, sort)"
        " VALUES (?,?,?,?,?,?)",
        DEMO_SHROUDS,
    )
    await db.executemany(
        "INSERT INTO optic_colors (name, hex_from, hex_to, description, price, sort)"
        " VALUES (?,?,?,?,?,?)",
        DEMO_COLORS,
    )
    await db.executemany(
        "INSERT INTO services (name, duration_min, price) VALUES (?, ?, ?)",
        DEMO_SERVICES,
    )
    await db.executemany(
        "INSERT INTO categories (name, icon, sort) VALUES (?, ?, ?)", DEMO_CATEGORIES
    )

    # mashina slug -> id
    async with db.execute("SELECT id, slug FROM cars") as cur:
        car_ids = {row["slug"]: row["id"] async for row in cur}
    async with db.execute("SELECT id FROM categories ORDER BY id") as cur:
        category_ids = [row["id"] async for row in cur]

    products = [
        (
            category_ids[cat_index - 1],
            car_ids.get(car_slug) if car_slug else None,
            name,
            description,
            price,
            old_price,
            stock,
            badge,
        )
        for cat_index, car_slug, name, description, price, old_price, stock, badge in DEMO_PRODUCTS
    ]
    await db.executemany(
        "INSERT INTO products (category_id, car_id, name, description, price,"
        " old_price, stock, badge) VALUES (?,?,?,?,?,?,?,?)",
        products,
    )

    if await _count("banners") == 0:
        await db.executemany(
            "INSERT INTO banners (title, subtitle, tag, color_from, color_to,"
            " car_id, sort) VALUES (?,?,?,?,?,?,?)",
            DEMO_BANNERS,
        )
    if await _count("stories") == 0:
        await db.executemany(
            "INSERT INTO stories (title, emoji, heading, body, color_from,"
            " color_to, sort) VALUES (?,?,?,?,?,?,?)",
            DEMO_STORIES,
        )
    if await _count("promos") == 0:
        await db.executemany(
            "INSERT INTO promos (title, text, discount, until_date, sort) VALUES (?,?,?,?,?)",
            DEMO_PROMOS,
        )

    await db.commit()
    await _meta_set("seed_version", str(SEED_VERSION))
    logger.info("Katalog to'ldirildi (seed_version=%s)", SEED_VERSION)
