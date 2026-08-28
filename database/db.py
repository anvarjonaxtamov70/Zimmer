"""SQLite ulanishi, jadvallar va boshlang'ich (demo) ma'lumotlar.

Zimmer — Bi-LED avtotuning: mashina → Bi-LED linza → ochki (maska) →
fara optikasi rangi. Shuning uchun bazada ham shu bosqichlarga mos
jadvallar bor.
"""

import logging

import aiosqlite

from config import config
from utils import stories as story_cfg

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
    -- Kafolat MATN sifatida saqlanadi ("1 yil", "3 oy", "19 kun"):
    -- admin xohlagan muddatni yozadi, ro'yxat bilan cheklanmaydi.
    warranty     TEXT,
    description  TEXT,
    -- Mini App kartochkasining DIZAYN kaliti (`app.js: SERVICE_THEMES`):
    -- config | biled | polish | glass | clean | wheel | seat.
    -- Bo'sh bo'lsa mini app nom bo'yicha o'zi taxmin qiladi.
    theme        TEXT,
    sort         INTEGER NOT NULL DEFAULT 0,
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

-- Stories: har bir yozuv — halqa (kategoriya) ICHIDAGI bitta element.
-- Kategoriyalar kodda belgilangan (utils/stories.py), Avto_A1 kabi.
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

# O'zbekistonda eng ko'p uchraydigan GM / Chevrolet / Daewoo / Ravon
# modellari — Damas'dan Tahoe'gacha.
#
# DIQQAT: bu ro'yxat `docs/js/cars.js: LIST` bilan MOS bo'lishi kerak.
# Mini App server bo'sh ro'yxat qaytarsa o'sha fayldagi nusxani ishlatadi;
# ikki joyda boshqa-boshqa nom bo'lsa mijoz ikki xil ro'yxat ko'rardi.
#
# name, slug, years, note, sort
DEMO_CARS = [
    # yengil tijorat
    ("Damas", "damas", "1996 – hozir", "Chevrolet / Daewoo Damas", 1),
    ("Labo", "labo", "1996 – hozir", "Chevrolet / Daewoo Labo", 2),
    # kichik sinf
    ("Tico", "tico", "1996 – 2001", "Daewoo Tico", 3),
    ("Matiz", "matiz", "2001 – 2015", "Daewoo / Chevrolet Matiz", 4),
    ("Spark", "spark", "2011 – 2015", "Chevrolet Spark (M300)", 5),
    ("Spark 2", "spark2", "2016 – 2022", "Chevrolet Spark (M400)", 6),
    ("Ravon R2", "ravon-r2", "2016 – 2018", "Ravon R2 (Spark)", 7),
    # Nexia oilasi
    ("Nexia 1", "nexia1", "1996 – 2008", "Daewoo Nexia (SOHC / DOHC)", 8),
    ("Nexia 2", "nexia2", "2008 – 2016", "Daewoo Nexia 2", 9),
    ("Nexia 3", "nexia3", "2016 – hozir", "Ravon Nexia R3 / Nexia 3", 10),
    ("Ravon R3", "ravon-r3", "2016 – 2018", "Ravon R3 (Nexia)", 11),
    # klassik Daewoo
    ("Espero", "espero", "1995 – 1999", "Daewoo Espero", 12),
    ("Nubira", "nubira", "1999 – 2003", "Daewoo Nubira", 13),
    ("Leganza", "leganza", "1997 – 2002", "Daewoo Leganza", 14),
    ("Magnus", "magnus", "2003 – 2007", "Daewoo Magnus / Evanda", 15),
    ("Epica", "epica", "2007 – 2011", "Chevrolet Epica", 16),
    # o'rta sinf sedanlar
    ("Lacetti", "lacetti", "2004 – 2018", "Chevrolet Lacetti", 17),
    ("Gentra", "gentra", "2013 – 2024", "Chevrolet / Ravon Gentra", 18),
    ("Aveo", "aveo", "2011 – 2015", "Chevrolet Aveo", 19),
    ("Cobalt", "cobalt", "2013 – hozir", "Chevrolet / Ravon Cobalt", 20),
    ("Ravon R4", "ravon-r4", "2016 – 2020", "Ravon R4 (Cobalt)", 21),
    ("Onix", "onix", "2019 – hozir", "Chevrolet Onix", 22),
    ("Monza", "monza", "2023 – hozir", "Chevrolet Monza", 23),
    # katta sedanlar
    ("Malibu", "malibu", "2012 – 2016", "Chevrolet Malibu", 24),
    ("Malibu 2", "malibu2", "2018 – hozir", "Chevrolet Malibu 2", 25),
    ("Malibu XL", "malibu-xl", "2021 – hozir", "Chevrolet Malibu XL", 26),
    # universal / minivan
    ("Orlando", "orlando", "2011 – 2018", "Chevrolet Orlando (7 o'rin)", 27),
    # krossover va SUV
    ("Tracker", "tracker", "2013 – 2020", "Chevrolet Tracker 1", 28),
    ("Tracker 2", "tracker2", "2020 – hozir", "Chevrolet Tracker 2", 29),
    ("Captiva", "captiva", "2007 – 2018", "Chevrolet Captiva", 30),
    ("Captiva 5", "captiva5", "2021 – hozir", "Chevrolet Captiva 5", 31),
    ("Trailblazer", "trailblazer", "2021 – hozir", "Chevrolet Trailblazer", 32),
    ("Equinox", "equinox", "2018 – hozir", "Chevrolet Equinox", 33),
    ("Traverse", "traverse", "2018 – hozir", "Chevrolet Traverse (7 o'rin)", 34),
    ("Tahoe", "tahoe", "2015 – hozir", "Chevrolet Tahoe", 35),
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

# Xizmatlar. Tartib MUHIM: Mini App shu tartibda ko'rsatadi.
# name, duration_min, price, warranty, description, theme, sort
DEMO_SERVICES = [
    (
        "Bi-LED konfigurator", 0, 0, "1 yil",
        "Mashinangizga mos linzani tanlab, narxni o'zingiz ko'ring.",
        "config", 1,
    ),
    (
        "Bi-LED o'rnatish (2 fara)", 120, 400_000, "1 yil",
        "Linzani o'rnatish, nur chegarasini sozlash va germetiklash.",
        "biled", 2,
    ),
    (
        "Fara polirovkasi", 60, 150_000, "3 oy",
        "Sarg'aygan qatlamni olib tashlab, himoya lak qoplaymiz.",
        "polish", 3,
    ),
    (
        "Fara shishasini almashtirish", 90, 250_000, "6 oy",
        "Yorilgan yoki singan shisha o'rniga yangisi qo'yiladi.",
        "glass", 4,
    ),
    (
        "Fara ichini tozalash", 45, 120_000, "3 oy",
        "Chang, bug' va namlik to'liq tozalanadi, so'ng germetiklanadi.",
        "clean", 5,
    ),
    (
        "Rul chexol tikish", 90, 200_000, "6 oy",
        "Rul g'ilofi o'lchov bo'yicha qo'lda tikiladi.",
        "wheel", 6,
    ),
    (
        "O'rindiq chexol tikish", 240, 700_000, "1 yil",
        "Barcha o'rindiqlarga o'lchov bo'yicha to'liq chexol.",
        "seat", 7,
    ),
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

# Demo stories. Har bir yozuv — KATEGORIYA (halqa) ichidagi bitta element.
# Halqa nomi/rangi utils/stories.py dan olinadi, shuning uchun bu yerda
# faqat mazmun turadi. Bitta halqaga bir nechta element qo'yish mumkin.
# (category, sarlavha, emoji, bosh matn, tavsif, sort)
DEMO_STORIES = [
    (
        "bugun",
        "Ish jarayoni",
        "🔧",
        "Fara qanday ochiladi?",
        "Fara ehtiyotkorlik bilan pechda ochiladi, ichi tozalanadi, linza markazlab "
        "o'rnatiladi va qayta germetizatsiya qilinadi. Butun jarayon 2-3 soat.",
        1,
    ),
    (
        "natijalar",
        "Natija",
        "✨",
        "Kechasi farq juda katta",
        "Bi-LED yorug'ligi aniq chegara bilan tushadi — qarshi haydovchini "
        "qamashtirmaydi, lekin yo'l kunduzdek ko'rinadi.",
        2,
    ),
    (
        "natijalar",
        "Bizning ishlarimiz",
        "🏆",
        "Bajarilgan ishlar",
        "Mijozlarimiz mashinalarida bajarilgan ishlar. Videoni bot orqali "
        "yuklaysiz: /admin -> Stories -> Video.",
        3,
    ),
    (
        "mijozlar",
        "Mijoz fikri",
        "💬",
        "Gentra egasi, Toshkent",
        "«Aozoom A5+ o'rnatdim. Kechasi yo'lni ko'rish butunlay boshqacha bo'ldi, "
        "ochki ham juda chiroyli chiqdi.»",
        4,
    ),
    (
        "kafolat",
        "Kafolat",
        "🛡",
        "1 yil kafolat",
        "Barcha linzalarga kafolat beriladi. Muammo chiqsa — bepul tekshirib, "
        "kerak bo'lsa almashtiramiz.",
        5,
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
    # Cloudflare Worker qabul qilgan buyurtmalar (Render o'chgan paytda
    # berilgan) `external_code` bilan belgilanadi — masalan "ZM-K7AMHB".
    # Bot ularni bazaga ko'chirganda shu kod yoziladi va IKKINCHI MARTA
    # ko'chirilmasligi shu kod bo'yicha tekshiriladi.
    # DIQQAT: bu lug'atda har bir jadval FAQAT BIR MARTA bo'lishi kerak.
    # Kalit takrorlansa, Python oxirgisini oladi va oldingi migratsiyalar
    # jimgina yo'qoladi (masalan `sort` ustuni yaratilmay qoladi).
    "products": [
        ("car_id", "INTEGER"),
        ("old_price", "INTEGER"),
        ("badge", "TEXT"),
        ("external_id", "TEXT"),
        ("sort", "INTEGER NOT NULL DEFAULT 0"),
        *MEDIA_COLUMNS,
        # Ombor va "yangi tovar qo'shish" uchun qo'shimcha maydonlar
        ("code", "TEXT"),
        ("unit", "TEXT"),
        ("product_type", "TEXT"),
        ("sizes", "TEXT"),
        ("photo2_id", "TEXT"),
        ("photo2_url", "TEXT"),
        ("photo3_id", "TEXT"),
        ("photo3_url", "TEXT"),
    ],
    "categories": [("icon", "TEXT"), ("sort", "INTEGER NOT NULL DEFAULT 0")],
    # Xizmatlar endi Mini App'da alohida bo'lim: har biriga kafolat, tavsif
    # va dizayn kaliti kerak.
    "services": [
        ("warranty", "TEXT"),
        ("description", "TEXT"),
        ("theme", "TEXT"),
        ("sort", "INTEGER NOT NULL DEFAULT 0"),
    ],
    # Eski bazalarga yetkazib berish/to'lov ustunlarini qo'shamiz.
    "orders": [
        ("delivery_method", "TEXT"),
        ("delivery_info", "TEXT"),
        ("payment_method", "TEXT"),
        # Cloudflare Worker qabul qilgan buyurtmalar (Render o'chgan paytda
        # berilgan) `ZM-XXXXXX` kodi bilan belgilanadi. Bot ularni bazaga
        # ko'chirganda shu kod yoziladi — takroriy ko'chirish shu bo'yicha
        # to'xtatiladi (`idx_orders_external_code` yagona indeksi bilan).
        ("external_code", "TEXT"),
    ],
    "cars": [*MEDIA_COLUMNS],
    "biled_types": [*MEDIA_COLUMNS],
    "shrouds": [*MEDIA_COLUMNS],
    "optic_colors": [*MEDIA_COLUMNS],
    "banners": [*MEDIA_COLUMNS],
    # Stories endi KATEGORIYALARGA bo'linadi (Avto_A1 kabi): bitta halqa
    # ichida bir nechta video/rasm bo'ladi.
    # `link` — story'dan tovarga (yoki tashqi manzilga) o'tish havolasi.
    # Mini App'da story ostida «Batafsil ko'rish» tugmasi bo'lib chiqadi.
    "stories": [*MEDIA_COLUMNS, ("category", "TEXT"), ("link", "TEXT")],
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
    # Jonli bazada `_seed()` o'tkazib yuboriladi — yangi xizmat/mashinalar
    # shu yerda qo'shiladi (hech narsa o'chirilmaydi).
    await _ensure_catalog()
    await _assign_story_categories()
    logger.info("Baza tayyor: %s", config.db_path)
    return _db


# Eski (kategoriyasiz) storieslarni mos halqaga taqsimlash.
# Kalit — story sarlavhasidagi so'z, qiymat — kategoriya kaliti.
STORY_CATEGORY_GUESS = {
    "ish jarayoni": "bugun",
    "natijalar": "natijalar",
    "natija": "natijalar",
    "mijoz fikri": "mijozlar",
    "mijoz": "mijozlar",
    "kafolat": "kafolat",
    "aksiya": "aksiyalar",
    "manzil": "lokatsiya",
    "lokatsiya": "lokatsiya",
    "to'lov": "tolov",
    "tolov": "tolov",
    "aloqa": "aloqa",
    "yetkazib berish": "natijalar",
}


async def _assign_story_categories() -> None:
    """Kategoriyasi yo'q storieslarga kategoriya beradi (bir martalik).

    Ilgari har bir story alohida halqa edi. Endi halqalar — KATEGORIYALAR,
    story esa ularning ichidagi element (Avto_A1 kabi). Eski yozuvlar
    yo'qolmasligi uchun sarlavhasiga qarab mos halqaga joylanadi.
    """
    db = get_db()
    async with db.execute(
        "SELECT id, title FROM stories WHERE category IS NULL OR TRIM(category) = ''"
    ) as cur:
        rows = await cur.fetchall()
    if not rows:
        return

    for row in rows:
        title = str(row["title"] or "").strip().lower()
        category = STORY_CATEGORY_GUESS.get(title) or next(
            (value for name, value in STORY_CATEGORY_GUESS.items() if name in title),
            story_cfg.DEFAULT_CATEGORY,
        )
        await db.execute(
            "UPDATE stories SET category = ? WHERE id = ?",
            (story_cfg.normalize(category), row["id"]),
        )
    await db.commit()
    logger.info("%s ta story kategoriyaga taqsimlandi.", len(rows))


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
    # Worker buyurtmasi IKKI MARTA ko'chirilmasligi uchun. Yagona indeks
    # bo'lgani uchun takroriy INSERT bazaning o'zida to'xtatiladi — ya'ni
    # bir vaqtda ikki import ishlasa ham dublikat paydo bo'lmaydi.
    await db.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_external_code"
        " ON orders(external_code) WHERE external_code IS NOT NULL"
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


# =============================================================================
# KATALOGNI TO'LDIRIB TURISH (idempotent)
#
# NEGA `_seed()` YETARLI EMAS
# `_seed()` faqat BIR MARTA ishlaydi (`seed_version`) va bazada buyurtma
# bo'lsa umuman o'tkazib yuboriladi — bu to'g'ri, aks holda admin qo'shgan
# katalogni o'chirib tashlardi. Lekin natijada JONLI bazaga yangi xizmat
# yoki mashina qo'shib bo'lmaydi: yangilanish chiqsa ham ular paydo
# bo'lmaydi va Mini App'dagi «Xizmatlar» bo'limi bo'sh turadi.
#
# Bu funksiya boshqacha ishlaydi: hech narsani O'CHIRMAYDI va
# O'ZGARTIRMAYDI, faqat YO'Q yozuvlarni qo'shadi va bo'sh (NULL) yangi
# ustunlarni to'ldiradi. Shuning uchun har ishga tushishda xavfsiz
# chaqirilishi mumkin.
# =============================================================================

# Eski nomlar. Bazada shu nomlardan biri bo'lsa, yangi xizmat TAKRORLANMAYDI
# (nomi o'zgargan, mohiyati bir xil).
SERVICE_ALIASES: dict[str, tuple[str, ...]] = {
    "Fara polirovkasi": ("fara polirovka / tozalash", "fara polirovka"),
    "Fara ichini tozalash": ("fara germetizatsiya",),
}

# Nomdan dizayn kalitini taxmin qilish — `docs/js/app.js: themeOf()` bilan
# bir xil tartibda. Eski yozuvlar ham to'g'ri dizayn olsin.
_THEME_GUESS: tuple[tuple[str, str], ...] = (
    ("konfigurator", "config"),
    ("rul", "wheel"),
    ("rindiq", "seat"),
    ("shisha", "glass"),
    ("polirov", "polish"),
    ("tozala", "clean"),
    ("germet", "clean"),
    ("bi-led", "biled"),
    ("biled", "biled"),
)


def _guess_theme(name: str) -> str | None:
    low = (name or "").lower()
    for needle, theme in _THEME_GUESS:
        if needle in low:
            return theme
    return None


async def _ensure_services() -> None:
    """Yetishmayotgan xizmatlarni qo'shadi, bo'sh maydonlarni to'ldiradi."""
    db = get_db()
    async with db.execute("SELECT id, name, warranty, description, theme, sort FROM services") as cur:
        rows = await cur.fetchall()

    have = {(row["name"] or "").strip().lower() for row in rows}
    added = 0

    for name, duration, price, warranty, description, theme, sort in DEMO_SERVICES:
        key = name.strip().lower()
        aliases = {a.lower() for a in SERVICE_ALIASES.get(name, ())}
        if key in have or (aliases & have):
            continue
        await db.execute(
            "INSERT INTO services (name, duration_min, price, warranty, description,"
            " theme, sort) VALUES (?,?,?,?,?,?,?)",
            (name, duration, price, warranty, description, theme, sort),
        )
        added += 1

    # Eski yozuvlarda yangi ustunlar bo'sh — dizayn kaliti va tartibni
    # to'ldiramiz. Admin qo'lda yozgan qiymatga TEGMAYMIZ.
    filled = 0
    for row in rows:
        patch: dict[str, object] = {}
        if not (row["theme"] or "").strip():
            guessed = _guess_theme(row["name"] or "")
            if guessed:
                patch["theme"] = guessed
        if not row["sort"]:
            patch["sort"] = int(row["id"]) + 100  # yangilaridan keyin turadi
        if not patch:
            continue
        sets = ", ".join(f"{col} = ?" for col in patch)
        await db.execute(
            f"UPDATE services SET {sets} WHERE id = ?", (*patch.values(), row["id"])
        )
        filled += 1

    if added or filled:
        await db.commit()
        logger.info("Xizmatlar: %s qo'shildi, %s yozuv to'ldirildi", added, filled)


async def _ensure_cars() -> None:
    """Yetishmayotgan mashinalarni qo'shadi (slug bo'yicha)."""
    db = get_db()
    async with db.execute("SELECT slug FROM cars") as cur:
        have = {(row["slug"] or "").strip().lower() for row in await cur.fetchall()}

    added = 0
    for name, slug, years, note, sort in DEMO_CARS:
        if slug.strip().lower() in have:
            continue
        await db.execute(
            "INSERT INTO cars (name, slug, years, note, sort) VALUES (?,?,?,?,?)",
            (name, slug, years, note, sort),
        )
        added += 1

    if added:
        await db.commit()
        logger.info("Mashinalar: %s model qo'shildi", added)


async def _ensure_catalog() -> None:
    """Xizmat va mashina ro'yxatlarini to'ldirib turadi.

    Xato bo'lsa ilova YIQILMAYDI: bu qo'shimcha to'ldirish, asosiy ish
    emas. Bazada nima bo'lsa — shu bilan davom etadi.
    """
    try:
        await _ensure_services()
        await _ensure_cars()
    except Exception as error:  # noqa: BLE001 — to'ldirish ilovani yiqitmasin
        logger.warning("Katalogni to'ldirib bo'lmadi: %s", error)


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
        "INSERT INTO services (name, duration_min, price, warranty, description,"
        " theme, sort) VALUES (?,?,?,?,?,?,?)",
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
        # Rang halqadan (kategoriyadan) olinadi — ustunlar to'ldirilib qo'yiladi
        await db.executemany(
            "INSERT INTO stories (category, title, emoji, heading, body, sort,"
            " color_from, color_to) VALUES (?,?,?,?,?,?,?,?)",
            [
                (
                    category,
                    title,
                    emoji,
                    heading,
                    body,
                    sort,
                    story_cfg.STORY_MAP[category]["color_from"],
                    story_cfg.STORY_MAP[category]["color_to"],
                )
                for category, title, emoji, heading, body, sort in DEMO_STORIES
            ],
        )
    if await _count("promos") == 0:
        await db.executemany(
            "INSERT INTO promos (title, text, discount, until_date, sort) VALUES (?,?,?,?,?)",
            DEMO_PROMOS,
        )

    await db.commit()
    await _meta_set("seed_version", str(SEED_VERSION))
    logger.info("Katalog to'ldirildi (seed_version=%s)", SEED_VERSION)
