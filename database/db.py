"""SQLite ulanishi, jadvallar va boshlang'ich (demo) ma'lumotlar.

Zimmer — Bi-LED avtotuning: mashina → Bi-LED linza → ochki (maska) →
fara optikasi rangi. Shuning uchun bazada ham shu bosqichlarga mos
jadvallar bor.
"""

import asyncio
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
    qty        INTEGER NOT NULL,
    -- Razmerli tovarda mijoz tanlagan razmer ("H4", "3\"", "XL").
    -- Razmersiz tovarda NULL. Bu ustun bo'lmasa admin buyurtmani ko'rib
    -- "qaysi razmer?" deb mijozga qayta qo'ng'iroq qilishga majbur bo'ladi.
    size       TEXT
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

-- Mini App'dagi FON MUSIQASI.
--
-- Admin botga audio tashlaydi, u shu jadvalga tushadi va Mini App'da
-- orqa fonda eshitiladi (mijoz xohlasa).
--
-- `audio_id`  — Telegram file_id (bot orqali yuborilgan fayl);
-- `audio_url` — tashqi manzil (Firebase Storage / CDN).
--
-- IKKISI HAM BOR, chunki ular BOSHQA-BOSHQA holatda ishlaydi:
-- `file_id` ni brauzer o'zi ocholmaydi — u Render'ning `/api/media`
-- proksisi orqali beriladi. Render uxlaganda esa faqat `audio_url`
-- ishlaydi. Shuning uchun uzun/sifatli musiqa uchun URL tavsiya etiladi.
CREATE TABLE IF NOT EXISTS music (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    title     TEXT NOT NULL,
    audio_id  TEXT,
    audio_url TEXT,
    duration  INTEGER NOT NULL DEFAULT 0,
    sort      INTEGER NOT NULL DEFAULT 0,
    is_active INTEGER NOT NULL DEFAULT 1
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
# Xizmatlar. Tuple tartibi:
#   (nom, davomiyligi_daq, narx, kafolat, tavsif, tema, tartib, tez_kunda)
#
# `tez_kunda = 1` bo'lsa: xizmat ro'yxatda KO'RINADI, lekin narx o'rniga
# «Tez kunda» yoziladi va navbat olinmaydi. Shu tufayli yangi yo'nalishni
# oldindan e'lon qilish mumkin — mijoz bor ekanini biladi, admin esa narx
# tayyor bo'lgach bir belgini o'chirib xizmatni ishga tushiradi.
DEMO_SERVICES = [
    (
        "Bi-LED konfigurator", 0, 0, "1 yil",
        "Mashinangizga mos linzani tanlab, narxni o'zingiz ko'ring.",
        "config", 1, 0,
    ),
    (
        "Bi-LED o'rnatish (2 fara)", 120, 400_000, "1 yil",
        "Linzani o'rnatish, nur chegarasini sozlash va germetiklash.",
        "biled", 2, 0,
    ),
    (
        "Fara polirovkasi", 60, 150_000, "3 oy",
        "Sarg'aygan qatlamni olib tashlab, himoya lak qoplaymiz.",
        "polish", 3, 0,
    ),
    (
        "Fara shishasini almashtirish", 90, 250_000, "6 oy",
        "Yorilgan yoki singan shisha o'rniga yangisi qo'yiladi.",
        "glass", 4, 0,
    ),
    (
        "Fara ichini tozalash", 45, 120_000, "3 oy",
        "Chang, bug' va namlik to'liq tozalanadi, so'ng germetiklanadi.",
        "clean", 5, 0,
    ),
    # «tikish» -> «o'rnatish»: ish mohiyati o'rnatish, tikish emas.
    (
        "Rul chexol o'rnatish", 90, 200_000, "6 oy",
        "Rul g'ilofi o'lchov bo'yicha tanlanadi va o'rnatiladi.",
        "wheel", 6, 0,
    ),
    (
        "O'rindiq chexol o'rnatish", 240, 700_000, "1 yil",
        "Barcha o'rindiqlarga o'lchov bo'yicha to'liq chexol o'rnatiladi.",
        "seat", 7, 0,
    ),
    # ---- tez kunda ishga tushadigan yo'nalishlar ----
    (
        "Laminat salon", 0, 0, None,
        "Salon panellariga laminat qoplama. Tez kunda ishga tushadi.",
        "laminate", 8, 1,
    ),
    (
        "Tanirovka", 0, 0, None,
        "Oynalarga plyonka yopishtirish. Tez kunda ishga tushadi.",
        "tint", 9, 1,
    ),
    (
        "Broni plyonka", 0, 0, None,
        "Kuzovni chizilishdan saqlovchi himoya plyonka. Tez kunda ishga tushadi.",
        "armor", 10, 1,
    ),
]

# =====================================================================
#  DO'KON BO'LIMLARI (kategoriyalar)
#
#  Mini App'dagi filtr chiplari AYNAN shu ro'yxatdan chiziladi va AYNAN
#  shu tartibda turadi (`sort` bo'yicha, alifbo bo'yicha EMAS).
#
#  DIQQAT — CHIPLARNING NOMI KODDA EMAS, BAZADA.
#  Mini App chip yorlig'ini kategoriya NOMIDAN oladi (`app.js: _cat`).
#  Shu sababli nomni o'zgartirish = bazadagi yozuvni o'zgartirish.
# =====================================================================
DEMO_CATEGORIES = [
    ("BI-ledlar", "🔵", 1),
    ("Lampalar", "💡", 2),
    ("Aksesuarlar", "🧰", 3),
]

# Do'konda BOR BO'LISHI kerak bo'lgan bo'limlar (nom, ikonka, tartib).
# `normalize_shop_categories()` shu ro'yxatga qarab ishlaydi.
TARGET_CATEGORIES: tuple[tuple[str, str, int], ...] = (
    ("BI-ledlar", "🔵", 1),
    ("Lampalar", "💡", 2),
    ("Aksesuarlar", "🧰", 3),
)

# Eski (yoki xato yozilgan) nom -> yangi nom. Kalitlar KICHIK harflarda.
#
# BIR NECHTA eski bo'lim BITTA yangisiga birlashishi mumkin: masalan
# «DRL va lentalar» va «Fara uchun materiallar» — ikkisi ham
# «Aksesuarlar» ga. Bunda mahsulotlar KO'CHIRILADI, eski bo'lim esa
# YASHIRILADI (o'chirilmaydi — sababi pastda).
_CATEGORY_MERGE: dict[str, str] = {
    # eski demo bo'limlari
    "drl va lentalar": "Aksesuarlar",
    "fara uchun materiallar": "Aksesuarlar",
    # `default_category_id()` yasagan eski standart bo'lim
    "mahsulotlar": "Aksesuarlar",
    # imlo va til variantlari
    "aksessuarlar": "Aksesuarlar",
    "aksesuar": "Aksesuarlar",
    "аксессуары": "Aksesuarlar",
    "lampa": "Lampalar",
    "лампы": "Lampalar",
    "bi-led": "BI-ledlar",
    "bi led": "BI-ledlar",
    "biled": "BI-ledlar",
    "biledlar": "BI-ledlar",
    "bi-led linzalar": "BI-ledlar",
    "linzalar": "BI-ledlar",
    # `restore_catalog()` bog'lanmagan tovar uchun yasaydigan bo'lim
    "boshqa": "Aksesuarlar",
}


async def normalize_shop_categories() -> None:
    """Do'kon bo'limlarini `TARGET_CATEGORIES` holatiga keltiradi.

    IDEMPOTENT — har ishga tushishda xavfsiz chaqirilishi mumkin va
    ATAYLAB bir martalik migratsiya QILINMAGAN. Sabab tartibda:

        init_db()      -> normalize (SQLite tozalanadi)
        initial_sync() -> restore_catalog()   <- BULUTDAN eski nomlar
                                                 QAYTA TIKLANISHI mumkin
                       -> normalize (yana)   <- shuning uchun ikkinchi marta
                       -> push_all_catalog() -> bulutga yangi nomlar ketadi

    Bir martalik bo'lsa, bulutda eski nom qolgani uchun bo'lim
    `restore_catalog()` dan keyin qayta paydo bo'lardi va do'konda
    to'rt-besh chip ko'rinib turardi.

    NIMA QILADI
      1. `TARGET_CATEGORIES` dagi uchta bo'lim BOR bo'lishini ta'minlaydi
         (yo'q bo'lsa qo'shadi, ikonka/tartibini to'g'rilaydi);
      2. `_CATEGORY_MERGE` dagi eski nomlarni topib, ularning
         MAHSULOTLARINI nishon bo'limga ko'chiradi;
      3. eski bo'limni YASHIRADI (`is_active = 0`).

    NEGA O'CHIRILMAYDI — ENG MUHIM JOY.
    `products.category_id` ustunida `ON DELETE CASCADE` bor:

        category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE

    Ya'ni bo'limni `DELETE` qilish uning BARCHA MAHSULOTLARINI ham
    o'chirib yuboradi. Shuning uchun bu funksiya hech qachon `DELETE`
    ishlatmaydi — faqat ko'chiradi va yashiradi.

    Tanimagan nomlarga TEGMAYDI: admin o'zi qo'shgan bo'lim
    `_CATEGORY_MERGE` da bo'lmasa, o'z holida qoladi.
    """
    db = get_db()

    # ---- 1) nishon bo'limlar mavjud bo'lsin
    ids: dict[str, int] = {}
    for name, icon, sort in TARGET_CATEGORIES:
        async with db.execute(
            "SELECT id FROM categories WHERE LOWER(TRIM(name)) = ?", (name.lower(),)
        ) as cur:
            row = await cur.fetchone()
        if row:
            ids[name] = int(row["id"])
            # Nomni AYNAN kerakli ko'rinishga keltiramiz (katta-kichik harf)
            # va yashirilgan bo'lsa qaytaramiz.
            await db.execute(
                "UPDATE categories SET name = ?, icon = COALESCE(NULLIF(TRIM(icon), ''), ?),"
                " sort = ?, is_active = 1 WHERE id = ?",
                (name, icon, sort, ids[name]),
            )
        else:
            cur = await db.execute(
                "INSERT INTO categories (name, icon, sort) VALUES (?, ?, ?)",
                (name, icon, sort),
            )
            ids[name] = int(cur.lastrowid)

    # ---- 2) eski bo'limlarni ko'chiramiz
    async with db.execute("SELECT id, name, is_active FROM categories") as cur:
        rows = await cur.fetchall()

    moved = 0
    hidden = 0
    for row in rows:
        key = (row["name"] or "").strip().lower()
        target = _CATEGORY_MERGE.get(key)
        if not target:
            continue
        target_id = ids.get(target)
        if not target_id or target_id == int(row["id"]):
            continue

        cur = await db.execute(
            "UPDATE products SET category_id = ? WHERE category_id = ?",
            (target_id, row["id"]),
        )
        moved += cur.rowcount if cur.rowcount and cur.rowcount > 0 else 0

        # Faqat HALI FAOL bo'lsa yashiramiz.
        #
        # Bu funksiya har ishga tushishda chaqiriladi. Shartsiz
        # `UPDATE ... is_active = 0` yozilsa, allaqachon yashirilgan
        # bo'limlar qayta-qayta «yashirilgan» deb hisoblanardi: jurnalda
        # har safar bir xil son chiqib turardi va hech narsa
        # o'zgarmagan bo'lsa ham `commit()` qilinardi.
        #
        # DIQQAT: `DELETE` EMAS — yuqoridagi izohga qara (CASCADE).
        if row["is_active"]:
            await db.execute("UPDATE categories SET is_active = 0 WHERE id = ?", (row["id"],))
            hidden += 1

    await db.commit()
    if moved or hidden:
        logger.info(
            "Do'kon bo'limlari tartibga solindi: %s tovar ko'chirildi, %s bo'lim yashirildi",
            moved,
            hidden,
        )

# bo'lim NOMI, mashina slug (None = universal), nom, tavsif,
# narx, eski narx, ombor, badge
#
# Bo'lim TARTIB RAQAMI bilan emas, NOMI bilan ko'rsatiladi — bo'limlar
# ro'yxati o'zgarganda tovarlar boshqa bo'limga tushib qolmasin.
DEMO_PRODUCTS = [
    (
        "Lampalar",
        None,
        "LED lampa H4 (juft)",
        "6000K, radiatorli sovutish, 12V",
        320_000,
        380_000,
        24,
        "Chegirma",
    ),
    ("Lampalar", None, "LED lampa H7 (juft)", "6000K, CANBUS bilan", 300_000, None, 18, None),
    (
        "Lampalar",
        "gentra",
        "Gentra uchun H4 to'plami",
        "Gentra faralariga aynan mos, adapter bilan",
        420_000,
        None,
        10,
        "Mos keladi",
    ),
    (
        "Lampalar",
        "nexia2",
        "Nexia 2 uchun H4 to'plami",
        "Nexia 2 fara korpusiga mos, uzaytirgich bilan",
        390_000,
        None,
        12,
        "Mos keladi",
    ),
    (
        "Aksesuarlar",
        None,
        "DRL lenta COB (2 dona)",
        "Kunduzgi yurish chirog'i, egiluvchan",
        180_000,
        220_000,
        30,
        None,
    ),
    (
        "Aksesuarlar",
        "gentra",
        "Gentra DRL bamper lentasi",
        "Bamperga o'rnatiladigan to'plam",
        260_000,
        None,
        8,
        None,
    ),
    ("Aksesuarlar", None, "Fara germetigi (qora)", "Issiqqa chidamli, 310 ml", 85_000, None, 40, None),
    (
        "Aksesuarlar",
        None,
        "Polirovka to'plami",
        "Pasta + doska, faralarni tiklash uchun",
        150_000,
        None,
        15,
        None,
    ),
    ("Aksesuarlar", "nexia2", "Nexia 2 fara shishasi", "Original o'lchamda, shaffof", 480_000, None, 6, None),
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
        # Xizmat haqida VIDEO. Ilgari `services` jadvalida media ustunlari
        # UMUMAN yo'q edi — ya'ni xizmatga rasm ham, video ham qo'yib
        # bo'lmasdi. Faqat uchta fara xizmatiga ruxsat beriladi
        # (`config.VIDEO_SERVICE_THEMES`), lekin ustunlar hammasida turadi:
        # cheklov MA'LUMOTDA emas, MANTIQDA (shunda qoida bir joyda).
        *MEDIA_COLUMNS,
        # «Tez kunda» — xizmat ro'yxatda ko'rinadi, lekin narx ko'rsatilmaydi
        # va navbat olinmaydi. Yangi yo'nalishlarni oldindan e'lon qilish
        # uchun: mijoz bor ekanini biladi, admin narx tayyor bo'lgach yoqadi.
        ("coming_soon", "INTEGER NOT NULL DEFAULT 0"),
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
        # Mini App'dan kelgan buyurtmaning IDEMPOTENT kaliti. Mijoz
        # «Rasmiylashtirish» ni ikki marta bossa yoki tarmoq uzilib so'rov
        # qaytarilsa — ikkinchi urinish YANGI buyurtma yaratmasligi kerak.
        # `idx_orders_idem` yagona indeksi bilan baza o'zi to'xtatadi.
        ("idempotency_key", "TEXT"),
    ],
    # Razmerli tovarlar. Mavjud bazalarda `order_items` ustunsiz yaratilgan,
    # shuning uchun migratsiya kerak — aks holda `INSERT ... size` yiqiladi
    # va Worker buyurtmalari bazaga UMUMAN ko'chirilmasdi.
    "order_items": [("size", "TEXT")],
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


# =====================================================================
#  KO'P QADAMLI YOZUVLAR UCHUN QULF
#
#  MUAMMO. Butun loyiha BITTA `aiosqlite` ulanishidan foydalanadi (bot
#  handlerlari, API handlerlari va fon vazifalari — hammasi). Har bir
#  funksiya o'z `commit()` ini chaqiradi. Buyurtma yaratish esa bir necha
#  qadamdan iborat:
#
#      qoldiqni tekshir → buyurtmani yoz → tarkibini yoz → qoldiqni kamaytir
#
#  Qadamlar orasida `await` bor. Aynan o'sha payt boshqa coroutine
#  `commit()` qilsa — YARIM bajarilgan ish bazaga tushadi. Natijada
#  tarkibsiz buyurtma yoki kamaymagan qoldiq qolib ketishi mumkin.
#
#  NEGA `BEGIN IMMEDIATE` EMAS. Ulanish umumiy bo'lgani uchun boshqa
#  coroutine'ning `commit()` i BIZNING tranzaksiyani ham yopib qo'yadi.
#  Ya'ni oshkora tranzaksiya bu yerda kafolat BERMAYDI — buning uchun
#  har bir ulanishni ajratish kerak (kattaroq qayta qurish).
#
#  YECHIM. Ko'p qadamli amallarni shu qulf bilan KETMA-KET bajaramiz va
#  qoldiqni bitta shartli SQL bilan kamaytiramiz (`take_stock`). Ikki
#  himoya birgalikda «bir tovar ikki kishiga sotilishi» ni butunlay
#  yopadi. Buyurtma yaratish tez-tez bo'lmaydi, shuning uchun ketma-ket
#  bajarish sezilmaydi.
# =====================================================================
_write_lock = asyncio.Lock()


def write_lock() -> asyncio.Lock:
    """Ko'p qadamli yozuvlarni ketma-ket bajarish uchun umumiy qulf."""
    return _write_lock


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
    # Takroriy bosish BITTA buyurtma bo'lib qolishi uchun (idempotentlik).
    await db.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_idem"
        " ON orders(idempotency_key) WHERE idempotency_key IS NOT NULL"
    )
    # `get_orders(status=...)` shu ustun bo'yicha filtrlaydi, lekin indeks
    # yo'q edi — admin paneli har ochilganda butun jadval skanerlanardi.
    await db.execute("CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status)")

    # ------------------------------------------------------------------
    #  NAVBAT TO'QNASHUVINI BAZA DARAJASIDA TO'XTATISH
    #
    #  Ilgari faqat ilova ichida tekshirilardi: `free_slots()` bo'sh dedi →
    #  keyin INSERT. Ikki mijoz bir lahzada bir vaqtni tanlasa IKKISI HAM
    #  o'tib ketardi va usta bir vaqtga ikki odamni ko'rardi.
    #
    #  Bu indeks aynan bir xil (sana, vaqt) juftligini to'xtatadi — ya'ni
    #  ekranda ko'rinadigan slotni ikki kishi olib qo'yishi MUMKIN EMAS.
    #  Bekor qilingan navbatlar hisobga olinmaydi, shuning uchun bo'shagan
    #  vaqtni qaytadan band qilish mumkin.
    #
    #  DIQQAT: bu ustma-ust TUSHISHNI (60 daqiqali xizmat 09:00 va 09:30)
    #  to'xtatmaydi — u `free_slots()` vazifasi. Indeks eng ko'p uchraydigan
    #  to'qnashuvni yopadi.
    # ------------------------------------------------------------------
    #
    #  Mavjud bazada allaqachon dublikat bo'lsa indeks YARATILMAYDI va
    #  xato ko'tariladi. Bot shu sababli ishga tushmay qolmasligi kerak —
    #  ogohlantirish yozamiz va to'qnashgan navbatlarni ko'rsatamiz.
    try:
        await db.execute(
            "CREATE UNIQUE INDEX IF NOT EXISTS idx_bookings_slot"
            " ON bookings(date, time) WHERE status <> 'cancelled'"
        )
    except Exception as error:
        logger.warning(
            "Navbat uchun yagona indeks yaratilmadi (%s). Bazada bir vaqtga "
            "ikki navbat bor — ularni bekor qilib bot'ni qayta ishga tushiring.",
            error,
        )
        async with db.execute(
            "SELECT date, time, COUNT(*) AS n FROM bookings"
            " WHERE status <> 'cancelled' GROUP BY date, time HAVING n > 1"
        ) as cur:
            async for row in cur:
                logger.warning(
                    "  to'qnashuv: %s %s — %s ta navbat", row["date"], row["time"], row["n"]
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
#
# DIQQAT — «fara germetizatsiya» ATAYLAB OLIB TASHLANDI.
# Ilgari u «Fara ichini tozalash» ning taxallusi edi. Natijada bazada
# faqat «Fara germetizatsiya» bo'lsa, «Fara ichini tozalash» «allaqachon
# bor» deb hisoblanib QO'SHILMASDI. Endi germetizatsiya alohida xizmat
# sifatida O'CHIRILADI (`_migrate_services`), tozalash esa qo'shiladi —
# shuning uchun ular bir-birining taxallusi bo'lmasligi kerak.
SERVICE_ALIASES: dict[str, tuple[str, ...]] = {
    "Fara polirovkasi": ("fara polirovka / tozalash", "fara polirovka"),
    # «tikish» -> «o'rnatish» nomi o'zgardi: eski nom bazada bo'lsa
    # yangisi TAKRORLANMASLIGI kerak (migratsiya nomini o'zgartiradi).
    "Rul chexol o'rnatish": ("rul chexol tikish",),
    "O'rindiq chexol o'rnatish": ("o'rindiq chexol tikish", "orindiq chexol tikish"),
}

# Nomdan dizayn kalitini taxmin qilish — `docs/js/app.js: themeOf()` bilan
# bir xil tartibda. Eski yozuvlar ham to'g'ri dizayn olsin.
#
# DIQQAT: tartib MUHIM — birinchi mos kelgani olinadi. Masalan
# «Laminat salon» ichida «salon» ham bor, shuning uchun «laminat»
# yuqorida turishi kerak.
_THEME_GUESS: tuple[tuple[str, str], ...] = (
    ("konfigurator", "config"),
    ("laminat", "laminate"),
    ("tanirov", "tint"),
    ("tonirov", "tint"),  # ruscha/lotincha yozilishi ham
    ("broni", "armor"),
    ("bronli", "armor"),
    ("plyonka", "armor"),
    ("plonka", "armor"),
    ("rul", "wheel"),
    ("rindiq", "seat"),
    ("shisha", "glass"),
    ("polirov", "polish"),
    ("tozala", "clean"),
    ("germet", "clean"),
    ("bi-led", "biled"),
    ("biled", "biled"),
)


def guess_theme(name: str) -> str | None:
    """Xizmat nomidan dizayn kalitini taxmin qiladi.

    OMMAVIY: `api/admin.py` ham shu funksiyani ishlatadi — `theme` ustuni
    bo'sh bo'lganda video ruxsatini aniqlash uchun. Mini App ham xuddi
    shunday qiladi (`app.js: themeOf`), shuning uchun uch tomon bir xil
    qarorga keladi.
    """
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

    for name, duration, price, warranty, description, theme, sort, soon in DEMO_SERVICES:
        key = name.strip().lower()
        aliases = {a.lower() for a in SERVICE_ALIASES.get(name, ())}
        if key in have or (aliases & have):
            continue
        await db.execute(
            "INSERT INTO services (name, duration_min, price, warranty, description,"
            " theme, sort, coming_soon) VALUES (?,?,?,?,?,?,?,?)",
            (name, duration, price, warranty, description, theme, sort, soon),
        )
        added += 1

    # Eski yozuvlarda yangi ustunlar bo'sh — dizayn kaliti va tartibni
    # to'ldiramiz. Admin qo'lda yozgan qiymatga TEGMAYMIZ.
    filled = 0
    for row in rows:
        patch: dict[str, object] = {}
        if not (row["theme"] or "").strip():
            guessed = guess_theme(row["name"] or "")
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


# =============================================================================
#  XIZMATLAR RO'YXATINI QAYTA TASHKIL QILISH — BIR MARTALIK
#
#  NEGA ALOHIDA FUNKSIYA
#  `_ensure_services()` hech narsani O'ZGARTIRMAYDI — faqat yo'q yozuvni
#  qo'shadi. Bu to'g'ri xatti-harakat: admin qo'lda yozgan narx yoki tavsif
#  har ishga tushishda qayta yozilmaydi.
#
#  Lekin bu yerda BOSHQA vazifa bor: mavjud yozuvlarni bir marta tuzatish
#  (nomini o'zgartirish, keraksizini o'chirish, «tez kunda» belgisini
#  qo'yish). Buni har ishga tushishda qilib bo'lmaydi — aks holda admin
#  «tez kunda» ni o'chirsa, keyingi restartda u QAYTA YOQILARDI.
#
#  Shu sababli `meta` jadvalidagi belgi bilan FAQAT BIR MARTA bajariladi.
#  Belgi qo'yilgandan keyin ro'yxatni to'liq admin boshqaradi.
# =============================================================================

_SERVICES_REVISION = "2026-09-services-video"

# Nomi o'zgargan xizmatlar: eski_nom (kichik harflarda) -> yangi nom.
# «tikish» ish mohiyatini to'g'ri ifodalamaydi — chexol tikilmaydi,
# o'rnatiladi.
_SERVICE_RENAMES: dict[str, str] = {
    "rul chexol tikish": "Rul chexol o'rnatish",
    "o'rindiq chexol tikish": "O'rindiq chexol o'rnatish",
    "orindiq chexol tikish": "O'rindiq chexol o'rnatish",
    "fara chexol tikish": "Chexol o'rnatish",
}

# Ro'yxatdan olib tashlanadigan (yashiriladigan) xizmatlar.
# O'CHIRILMAYDI, `is_active = 0` qilinadi: bu xizmatga olingan eski
# navbatlar bazada qoladi va tarix buzilmaydi (`bookings.service_id`
# foreign key bilan bog'langan).
_SERVICE_RETIRE: tuple[str, ...] = ("fara germetizatsiya",)

# «Tez kunda» qilinadigan xizmatlar (narx va navbat vaqtincha yopiladi).
_SERVICE_COMING_SOON: tuple[str, ...] = (
    "laminat salon",
    "tanirovka",
    "tonirovka",
    "broni plyonka",
    "broni plonka",
    "bronli plyonka",
)


async def _migrate_services() -> None:
    """Xizmatlar ro'yxatini bir marta yangi talabga keltiradi."""
    db = get_db()
    if await _meta_get("services_revision") == _SERVICES_REVISION:
        return

    async with db.execute("SELECT id, name, coming_soon FROM services") as cur:
        rows = await cur.fetchall()

    renamed = retired = marked = 0

    for row in rows:
        key = (row["name"] or "").strip().lower()

        # 1) nomini o'zgartirish
        new_name = _SERVICE_RENAMES.get(key)
        if new_name:
            await db.execute(
                "UPDATE services SET name = ? WHERE id = ?", (new_name, row["id"])
            )
            renamed += 1
            key = new_name.strip().lower()

        # 2) ro'yxatdan olib tashlash (yashirish)
        if key in _SERVICE_RETIRE:
            await db.execute(
                "UPDATE services SET is_active = 0 WHERE id = ?", (row["id"],)
            )
            retired += 1
            continue

        # 3) «tez kunda» belgisi
        if key in _SERVICE_COMING_SOON and not row["coming_soon"]:
            await db.execute(
                "UPDATE services SET coming_soon = 1 WHERE id = ?", (row["id"],)
            )
            marked += 1

    await _meta_set("services_revision", _SERVICES_REVISION)
    await db.commit()

    if renamed or retired or marked:
        logger.info(
            "Xizmatlar yangilandi: %s nomi o'zgardi, %s yashirildi, "
            "%s «tez kunda» belgilandi",
            renamed,
            retired,
            marked,
        )


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
        # DIQQAT — TARTIB MUHIM.
        # `_migrate_services()` AVVAL ishlaydi: u eski nomlarni yangisiga
        # o'giradi («chexol tikish» -> «chexol o'rnatish»). Shundan keyingina
        # `_ensure_services()` yetishmayotganini qo'shadi — aks holda u eski
        # nomni ko'rmay, yangi nom bilan DUBLIKAT yaratib qo'yardi.
        await _migrate_services()
        await _ensure_services()
        await _ensure_cars()
        # Do'kon bo'limlari (chip nomlari). IDEMPOTENT — `initial_sync()`
        # bulutdan katalogni tiklagandan keyin YANA chaqiriladi, chunki
        # bulutda eski nomlar qolgan bo'lishi mumkin.
        await normalize_shop_categories()
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
        " theme, sort, coming_soon) VALUES (?,?,?,?,?,?,?,?)",
        DEMO_SERVICES,
    )
    await db.executemany(
        "INSERT INTO categories (name, icon, sort) VALUES (?, ?, ?)", DEMO_CATEGORIES
    )

    # mashina slug -> id
    async with db.execute("SELECT id, slug FROM cars") as cur:
        car_ids = {row["slug"]: row["id"] async for row in cur}
    # Bo'lim NOMI -> id. Ilgari `category_ids[cat_index - 1]` edi, ya'ni
    # demo tovar bo'limga TARTIB RAQAMI bilan bog'langan edi. Bo'limlar
    # ro'yxati o'zgarganda (nomi yoki tartibi) tovarlar jimgina boshqa
    # bo'limga tushib qolardi. Nom bilan bog'lash bunga yo'l qo'ymaydi.
    async with db.execute("SELECT id, name FROM categories") as cur:
        category_by_name = {row["name"]: row["id"] async for row in cur}

    products = [
        (
            category_by_name[cat_name],
            car_ids.get(car_slug) if car_slug else None,
            name,
            description,
            price,
            old_price,
            stock,
            badge,
        )
        for cat_name, car_slug, name, description, price, old_price, stock, badge in DEMO_PRODUCTS
        # Nomi topilmagan bo'lim — demo tovar tashlab ketiladi (yiqilmaydi)
        if cat_name in category_by_name
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
