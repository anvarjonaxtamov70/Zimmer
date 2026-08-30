"""Admin panel katalogining tavsifi (sof ma'lumot — Telegram'ga bog'liq emas).

Bu fayl qaysi bo'limlar bor, ularda qanday maydonlar bo'lishi va kiritilgan
qiymat qanday tekshirilishini belgilaydi. `admin_crud.py` shu tavsif asosida
barcha bo'limlar uchun bitta universal interfeys yasaydi.
"""

import re
from collections.abc import Callable
from dataclasses import dataclass
from dataclasses import field as dc_field

from database import queries as q
from utils import stories as story_cfg
from utils.helpers import fmt_price

HEX = re.compile(r"^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$")


@dataclass(frozen=True)
class Field:
    column: str
    label: str
    kind: str = "text"  # text | long | int | money | color | photo | video | choice
    required: bool = False
    hint: str = ""
    choices: Callable | None = None  # -> [(qiymat, yozuv)]
    # Formada maydon qaysi KARTOCHKAGA tushadi (`FORM_GROUPS` kaliti).
    # Bo'sh bo'lsa tur bo'yicha o'zi tanlanadi (`_auto_group`).
    group: str = ""


@dataclass(frozen=True)
class Entity:
    key: str
    table: str
    title: str
    icon: str
    fields: tuple[Field, ...]
    label: Callable
    create: tuple[str, ...] = dc_field(default_factory=tuple)
    # Ro'yxatdagi GURUH sarlavhalari: (guruh raqami, ikonka, nom).
    #
    # Guruh raqamini `database/queries.py: row_group()` beradi. Hozircha
    # faqat `services` da guruh bor (konfigurator / oddiy / «Tez kunda»),
    # qolgan bo'limlarda hammasi 0-guruh va sarlavha chizilmaydi.
    #
    # Sarlavha KODDA emas, shu yerda turadi — admin paneli faqat
    # serverdan kelgan nomni ko'rsatadi.
    row_groups: tuple[tuple[int, str, str], ...] = dc_field(default_factory=tuple)
    # Formadagi kartochkalar TARTIBI (`FORM_GROUPS` kalitlari). Bo'sh
    # bo'lsa `FORM_GROUP_ORDER` dagi umumiy tartib ishlatiladi.
    form_groups: tuple[str, ...] = dc_field(default_factory=tuple)


# =====================================================================
#  FORMANI KARTOCHKALARGA BO'LISH
#
#  MUAMMO. Forma barcha maydonlarni BITTA uzun ustunda chizardi: 12 ta
#  bir xil kulrang input ketma-ket. Xizmat qo'shayotgan admin qaysi
#  maydon nimaga tegishli ekanini ajratib olmaydi — narx, video, tartib
#  va tavsif hammasi bir xil ko'rinadi.
#
#  YECHIM. Maydonlar MA'NOSI bo'yicha kartochkalarga bo'linadi, har
#  birida ikonka va sarlavha bor. Aynan shu tuzilma «Yangi tovar
#  qo'shish» oynasida allaqachon bor va u ancha tushunarli ko'rinadi.
#
#  MUHIM: guruh KO'RSATISHGA tegishli, saqlashga emas. Guruhlarni
#  o'zgartirish ma'lumotga ta'sir qilmaydi — faqat forma boshqacha
#  chiziladi.
# =====================================================================

# Guruh kaliti -> (ikonka, sarlavha, kichik izoh)
FORM_GROUPS: dict[str, tuple[str, str, str]] = {
    "main": ("📝", "Asosiy ma'lumot", "Nomi va ko'rinishi"),
    "price": ("💰", "Narx va muddat", "Mijoz shu raqamni ko'radi"),
    "state": ("🕒", "Holat", "Xizmat ishlayaptimi yoki tez kundami"),
    "text": ("💬", "Tavsif", "Mijozga qisqa tushuntirish"),
    "media": ("🖼", "Rasm va video", "Fayl yuklang yoki havola yozing"),
    "link": ("🔗", "Bog'lanish", "Boshqa bo'limlar bilan aloqasi"),
    "order": ("🔢", "Tartib", "Ro'yxatda qaysi o'rinda tursin"),
}

# Guruh berilmagan bo'limlar uchun umumiy tartib.
FORM_GROUP_ORDER: tuple[str, ...] = ("main", "price", "state", "text", "media", "link", "order")


def _auto_group(field: Field) -> str:
    """Guruh ko'rsatilmagan maydon uchun uni TURI bo'yicha tanlaydi.

    Shu tufayli har bir bo'limga qo'lda guruh yozish SHART EMAS: yangi
    maydon qo'shilsa ham o'zi mos kartochkaga tushadi. Faqat muhim
    bo'limlarda (masalan xizmatlar) guruh qo'lda aniqlashtiriladi.
    """
    if field.kind in ("photo", "video"):
        return "media"
    if field.column == "sort":
        return "order"
    if field.kind == "long":
        return "text"
    if field.kind == "money" or field.column in ("price", "old_price", "duration_min"):
        return "price"
    if field.column.endswith("_id") and field.kind == "choice":
        return "link"
    return "main"


def group_of(field: Field) -> str:
    """Maydonning guruhi (qo'lda ko'rsatilgani ustun turadi)."""
    key = (field.group or "").strip()
    if key and key in FORM_GROUPS:
        return key
    return _auto_group(field)


def form_layout(entity: Entity) -> list[tuple[str, str, str, str, list[Field]]]:
    """Forma tuzilishi: (kalit, ikonka, sarlavha, izoh, maydonlar).

    BO'SH guruhlar tushib qoladi — ya'ni bo'limda video maydoni bo'lmasa
    «Rasm va video» kartochkasi umuman chizilmaydi.
    """
    buckets: dict[str, list[Field]] = {}
    for field in entity.fields:
        buckets.setdefault(group_of(field), []).append(field)

    # Tartib: bo'limning o'zi bergani, keyin umumiy tartib, keyin
    # ro'yxatda qolgan notanish guruhlar (hech narsa yo'qolmasin).
    order = [key for key in entity.form_groups if key in buckets]
    order += [key for key in FORM_GROUP_ORDER if key in buckets and key not in order]
    order += [key for key in buckets if key not in order]

    layout = []
    for key in order:
        icon, title, note = FORM_GROUPS.get(key, ("📄", key, ""))
        layout.append((key, icon, title, note, buckets[key]))
    return layout


# ------------------------------------------------------------- tanlov manbalari


async def category_choices() -> list[tuple[str, str]]:
    rows = await q.get_categories(active_only=False)
    return [(str(r["id"]), f"{r['icon'] or '🗂'} {r['name']}") for r in rows]


async def car_choices() -> list[tuple[str, str]]:
    rows = await q.get_cars(active_only=False)
    return [("", "🌐 Barcha mashinalar")] + [(str(r["id"]), r["name"]) for r in rows]


async def story_choices() -> list[tuple[str, str]]:
    """Stories halqalari (kategoriyalari) — utils/stories.py dagi yagona manba."""
    return story_cfg.choices()


def _story_label(row) -> str:
    """Ro'yxatda qaysi halqaga tegishli ekani ko'rinib turadi."""
    keys = row.keys()
    category = row["category"] if "category" in keys else None
    return f"{story_cfg.title_of(category)} — {row['title']}"


async def unit_choices() -> list[tuple[str, str]]:
    return [("dona", "1 dona"), ("komplekt", "Nabor (komplekt)")]


async def style_choices() -> list[tuple[str, str]]:
    return [
        ("classic", "⭕️ Klassik xrom"),
        ("devil", "😈 Devil Eyes"),
        ("angel", "😇 Angel Eyes"),
        ("sport", "🏁 Sport matt"),
        ("carbon", "🩶 Karbon"),
    ]


MEDIA = (
    Field("photo_id", "Rasm", "photo", hint="Rasm yuboring yoki URL yozing"),
    Field("video_id", "Video", "video", hint="Video yuboring yoki URL yozing"),
)


# Xizmat kartochkasining dizayn kalitlari.
#
# DIQQAT: `docs/js/app.js: SERVICE_THEMES` bilan bir xil bo'lishi kerak.
# Notanish kalit yozilsa Mini App zaxira dizaynga o'tadi — ya'ni xizmat
# yo'qolmaydi, lekin ikonkasi tasodifiy bo'ladi.
#
# Ilgari bu maydon ERKIN MATN edi va hint'da kalitlar vergul bilan
# sanalgan edi. Admin ularni qo'lda yozardi: bitta harf xato bo'lsa
# (`polirovka` / `polish`) dizayn jimgina buzilardi. Endi ro'yxatdan
# tanlanadi va har biri ikonkasi bilan ko'rinadi.
#
# «Video mumkin» belgisi ATAYLAB yozib qo'yilgan: video faqat uchta fara
# xizmatiga qo'yiladi (`config.VIDEO_SERVICE_THEMES`) va admin buni
# temani tanlash paytida bilishi kerak.
SERVICE_THEMES: tuple[tuple[str, str], ...] = (
    ("config", "💡 Konfigurator — har doim birinchi"),
    ("biled", "🔧 Bi-LED o'rnatish"),
    ("polish", "✨ Fara polirovkasi (video mumkin)"),
    ("glass", "🪟 Fara shishasi (video mumkin)"),
    ("clean", "🧼 Fara ichini tozalash (video mumkin)"),
    ("wheel", "🕹 Rul chexoli"),
    ("seat", "🪑 O'rindiq chexoli"),
    ("laminate", "🪞 Laminat salon"),
    ("tint", "🌓 Tanirovka"),
    ("armor", "🛡 Broni plyonka"),
)


def service_theme_choices() -> list[tuple[str, str]]:
    """Xizmat dizayni. Bo'sh variant — nom bo'yicha o'zi tanlanadi."""
    return [("", "🎲 Nom bo'yicha o'zi tanlasin"), *SERVICE_THEMES]


def coming_soon_choices() -> list[tuple[str, str]]:
    """«Tez kunda» holati.

    Alohida `bool` turi qo'shilmadi: u forma chizishni (`admin.js`),
    tekshirishni (`api/admin.py`) va bot formasini — uchta joyni
    o'zgartirishni talab qiladi. `choice` esa allaqachon ishlaydi va
    ro'yxat ko'rinishida chiqadi, ya'ni admin 0/1 ni eslab yurmaydi.
    """
    return [("0", "✅ Ishlaydi (narx ko'rinadi)"), ("1", "🕒 Tez kunda")]


def _service_label(row) -> str:
    """Xizmat ro'yxatidagi bitta qator.

    «Tez kunda» xizmatda narx YO'Q, shuning uchun `fmt_price(0)` — ya'ni
    «0 so'm» — chiqishi kerak emas: admin ro'yxatga qarab «narxni
    qo'yishni unutdimmi?» deb o'ylardi. O'sha holatda holatning o'zi
    yoziladi.
    """
    keys = row.keys()
    soon = bool(row["coming_soon"]) if "coming_soon" in keys else False
    if soon:
        return f"{row['name']} · 🕒 Tez kunda"

    parts = [str(row["name"])]
    if row["duration_min"]:
        parts.append(f"{row['duration_min']} daq")
    parts.append(fmt_price(row["price"]))
    # Video FAQAT uchta fara xizmatida bo'ladi — bor/yo'qligi ro'yxatdan
    # ko'rinsin, aks holda admin har bir xizmatni ochib tekshirardi.
    if ("video_id" in keys and row["video_id"]) or ("video_url" in keys and row["video_url"]):
        parts.append("🎬")
    return " · ".join(parts)


ENTITIES: dict[str, Entity] = {
    "led": Entity(
        key="led",
        table="biled_types",
        title="Bi-LED linzalar",
        icon="💡",
        fields=(
            Field("name", "Nomi", required=True, hint="Masalan: Aozoom A5+ 3.0"),
            Field("brand", "Brend", hint="Aozoom, Hella, Koito..."),
            Field("size", "O'lchami", hint='Masalan: 3.0"'),
            Field("kelvin", "Rang harorati", hint="Masalan: 5500K"),
            Field("lumen", "Yorqinligi", hint="Masalan: 11 000 lm"),
            Field("warranty", "Kafolat", hint="Masalan: 1 yil"),
            Field("description", "Tavsif", "long"),
            Field("price", "Narx", "money", required=True),
            Field("badge", "Belgi (badge)", hint="TOP tanlov, Premium..."),
            Field("glow", "Yorug'lik rangi", "color", hint="#ffffff"),
            *MEDIA,
            Field("sort", "Tartib", "int"),
        ),
        label=lambda r: f"{r['name']} · {fmt_price(r['price'])}",
        create=("name", "price"),
    ),
    "shr": Entity(
        key="shr",
        table="shrouds",
        title="Ochkilar (maska)",
        icon="🕶",
        fields=(
            Field("name", "Nomi", required=True),
            Field("style", "Uslub", "choice", choices=style_choices),
            Field("ring_color", "Halqa rangi", "color", hint="#ff2d2d"),
            Field("description", "Tavsif", "long"),
            Field("price", "Narx", "money", required=True),
            *MEDIA,
            Field("sort", "Tartib", "int"),
        ),
        label=lambda r: f"{r['name']} · {fmt_price(r['price'])}",
        create=("name", "price"),
    ),
    "clr": Entity(
        key="clr",
        table="optic_colors",
        title="Optika ranglari",
        icon="🎨",
        fields=(
            Field("name", "Nomi", required=True),
            Field("hex_from", "Asosiy rang", "color", hint="#3a3d42"),
            Field("hex_to", "Ikkinchi rang", "color", hint="#111216"),
            Field("description", "Tavsif", "long"),
            Field("price", "Narx", "money"),
            *MEDIA,
            Field("sort", "Tartib", "int"),
        ),
        label=lambda r: f"{r['name']} · {fmt_price(r['price'])}",
        create=("name", "hex_from", "hex_to"),
    ),
    "car": Entity(
        key="car",
        table="cars",
        title="Mashinalar",
        icon="🚗",
        fields=(
            Field("name", "Nomi", required=True, hint="Masalan: Cobalt"),
            Field("years", "Yillari", hint="Masalan: 2013 – 2024"),
            Field("note", "Izoh", hint="Masalan: Chevrolet / Ravon"),
            *MEDIA,
            Field("sort", "Tartib", "int"),
        ),
        label=lambda r: f"{r['name']} · {r['years'] or '-'}",
        create=("name", "years"),
    ),
    "prd": Entity(
        key="prd",
        table="products",
        title="Mahsulotlar",
        icon="🛍",
        fields=(
            Field("name", "Nomi", required=True),
            Field("car_id", "Mashina", "choice", choices=car_choices),
            Field("description", "Tavsif", "long"),
            Field("price", "Narx", "money", required=True),
            Field(
                "old_price",
                "Eski narx (aksiya)",
                "money",
                hint="Kiritsangiz chegirma foizi o'zi hisoblanadi. Aksiya bo'lmasa — bo'sh",
            ),
            Field("stock", "Ombor (dona)", "int"),
            Field("code", "Artikul / OEM kod", hint="Ixtiyoriy"),
            # DIQQAT: `choices` — funksiya bo'lishi kerak (ro'yxat emas),
            # aks holda tanlovlar bo'sh chiqadi.
            Field("unit", "O'lchov", "choice", choices=unit_choices),
            Field("badge", "Belgi", hint="Masalan: Yangi, TOP tanlov"),
            *MEDIA,
            Field("sort", "Tartib", "int"),
        ),
        label=lambda r: f"{r['name']} · {fmt_price(r['price'])}",
        # Kategoriya UX'dan olib tashlandi — mahsulot standart kategoriyaga
        # o'zi bog'lanadi (prepare_insert). Shu bois create'da category_id yo'q.
        create=("name", "price", "stock"),
    ),
    "srv": Entity(
        key="srv",
        table="services",
        title="Xizmatlar (navbat)",
        icon="🔧",
        fields=(
            Field("name", "Nomi", required=True, group="main"),
            Field(
                "duration_min",
                "Davomiyligi (daqiqa)",
                "int",
                required=True,
                group="price",
                hint="Navbat shu vaqtga band qilinadi. Masalan: 60",
            ),
            Field("price", "Narx", "money", group="price"),
            # Kafolat MATN: "1 yil", "3 oy", "19 kun" — xohlagan muddat.
            Field(
                "warranty",
                "Kafolat muddati",
                group="price",
                hint="Masalan: 1 yil, 3 oy, 20 kun",
            ),
            Field("description", "Tavsif", "long", group="text"),
            # Mini App kartochkasining dizayni. Bo'sh bo'lsa nom bo'yicha
            # o'zi tanlanadi, shuning uchun majburiy emas.
            Field(
                "theme",
                "Dizayn",
                "choice",
                choices=service_theme_choices,
                group="main",
                hint="Kartochka ko'rinishi va ikonkasi. Bo'sh qoldirsangiz "
                "nom bo'yicha o'zi tanlanadi",
            ),
            # «Tez kunda»: narx ko'rsatilmaydi va navbat olinmaydi.
            # `required=True` — «— tanlanmagan —» varianti CHIQMASLIGI
            # uchun. Ustun `NOT NULL DEFAULT 0`, ya'ni bo'sh qiymat
            # yuborilsa baza xato berardi. Yaratishda ham so'ralmaydi
            # (`create` ro'yxatida yo'q), demak har doim 0 dan boshlanadi.
            Field(
                "coming_soon",
                "Holat",
                "choice",
                choices=coming_soon_choices,
                required=True,
                group="state",
                hint="«Tez kunda» tanlansa mijoz narxni ko'rmaydi va "
                "navbat olmaydi — yo'nalishni oldindan e'lon qilish uchun",
            ),
            # XIZMAT VIDEOSI.
            #
            # Faqat uchta FARA xizmatiga saqlanadi (`config.
            # VIDEO_SERVICE_THEMES`: polish / clean / glass). Boshqa
            # xizmatga yuborilsa server RAD ETADI — chalkashmasin.
            #
            # UZUN VA SIFATLI VIDEO UCHUN: faylni Telegram orqali
            # yuborish 50 MB bilan cheklangan (bot API chegarasi).
            # Shundan uzunrog'i kerak bo'lsa videoni Firebase Storage
            # yoki boshqa xostingga qo'yib, shu maydonga https:// URL
            # yozing — hajm cheklovi bo'lmaydi.
            Field(
                "video_id",
                "Video (faqat fara xizmatlari)",
                "video",
                group="media",
                hint="Video yuboring (50 MB gacha) yoki uzun/sifatli video "
                "uchun https:// URL yozing",
            ),
            Field(
                "sort",
                "Tartib",
                "int",
                group="order",
                hint="Kichik raqam yuqorida turadi. Ro'yxatdagi ↑/↓ "
                "tugmalari buni o'zi hisoblaydi — qo'lda yozish shart emas",
            ),
        ),
        label=_service_label,
        create=("name", "duration_min", "price"),
        # Formadagi kartochkalar tartibi. «Holat» narxdan KEYIN turadi:
        # admin avval narxni yozadi, keyin «tez kunda» ekanini belgilaydi.
        form_groups=("main", "price", "state", "text", "media", "order"),
        # Mini App'da xizmatlar uch guruhga bo'linib ko'rsatiladi va
        # AYNAN shu tartibda turadi. Admin paneli ham shunday ko'rsatadi —
        # aks holda «yuqoriga ko'chirish» tugmasi tushunarsiz ishlardi:
        # panelda yozuv ko'tariladi, do'konda esa joyi o'zgarmaydi.
        row_groups=(
            (0, "🧮", "Konfigurator — har doim birinchi"),
            (1, "🔧", "Xizmatlar"),
            (2, "🕒", "Tez kunda — har doim oxirida"),
        ),
    ),
    "ban": Entity(
        key="ban",
        table="banners",
        title="Bannerlar",
        icon="🖼",
        fields=(
            Field("title", "Sarlavha", required=True),
            Field("subtitle", "Tavsif", "long"),
            Field("tag", "Yorliq", hint="Masalan: -15% shu hafta"),
            Field("color_from", "Rang 1", "color", hint="#ff2d2d"),
            Field("color_to", "Rang 2", "color", hint="#38000a"),
            *MEDIA,
            Field("sort", "Tartib", "int"),
        ),
        label=lambda r: r["title"],
        create=("title", "subtitle"),
    ),
    "sto": Entity(
        key="sto",
        table="stories",
        title="Stories",
        icon="📸",
        fields=(
            # Halqa (kategoriya) — bitta halqa ichida bir nechta element bo'ladi
            Field(
                "category",
                "Halqa (bo'lim)",
                "choice",
                required=True,
                choices=story_choices,
                hint="Qaysi doira ichida chiqadi",
            ),
            Field("title", "Nomi", required=True, hint="Ichki nom (ro'yxat uchun)"),
            Field("emoji", "Emoji", hint="Masalan: 🔧"),
            Field("heading", "Sarlavha"),
            Field("body", "Matn", "long"),
            Field("color_from", "Rang 1", "color"),
            Field("color_to", "Rang 2", "color"),
            *MEDIA,
            Field("sort", "Tartib", "int"),
        ),
        label=_story_label,
        create=("category", "title", "emoji", "heading", "body"),
    ),
}

# DIQQAT: «Aksiyalar» (promos) bo'limi ataylab olib tashlandi.
# Chegirma endi TOVARNING o'zida beriladi (Avto A1 dagi kabi):
#   • «Eski narx» ni kiritasiz — ilova chegirma foizini o'zi hisoblab,
#     qizil «-15%» yorlig'ini va chizilgan eski narxni ko'rsatadi;
#   • xohlasangiz «Belgi» maydoniga qo'shimcha yozuv qo'yasiz ("Yangi", "TOP").
# Shu sababli alohida aksiya kartochkalari va ular uchun bo'lim kerak emas.


async def prepare_insert(entity: Entity, values: dict) -> dict:
    """Yangi yozuv uchun texnik maydonlarni to'ldiradi.

    `sort` — ro'yxat oxiriga qo'yiladi; `cars.slug` — nomdan yasaladi va
    takrorlanmasligi tekshiriladi (ustun NOT NULL UNIQUE).

    Bot admin paneli ham, Mini App admin paneli ham shu funksiyani
    ishlatadi — shuning uchun ikkisi bir xil natija beradi.
    """
    data = dict(values)
    if "sort" in q.EDITABLE[entity.table]:
        data.setdefault("sort", await q.admin_next_sort(entity.table))

    # Kategoriya UX'dan olib tashlangan — mahsulotni standart kategoriyaga
    # bog'laymiz (products.category_id NOT NULL).
    if entity.table == "products" and not data.get("category_id"):
        data["category_id"] = await q.default_category_id()

    # Story: halqa kaliti tekshiriladi, rang berilmasa halqadan olinadi —
    # shunda bitta bo'lim ichidagi elementlar bir xil ko'rinadi.
    if entity.table == "stories":
        category = story_cfg.normalize(data.get("category"))
        data["category"] = category
        info = story_cfg.STORY_MAP[category]
        data.setdefault("color_from", info["color_from"])
        data.setdefault("color_to", info["color_to"])
        if not data.get("emoji"):
            data["emoji"] = info["emoji"]

    if entity.table == "cars":
        base = re.sub(r"[^a-z0-9]+", "", str(data.get("name", "")).lower()) or "car"
        slug, index = base, 1
        existing = {row["slug"] for row in await q.get_cars(active_only=False)}
        while slug in existing:
            index += 1
            slug = f"{base}{index}"
        data["slug"] = slug

    return data


def parse_value(kind: str, raw: str):
    """Admin kiritgan matnni tekshiradi. Qaytaradi: (qiymat, xato_matni)."""
    if raw == "-":
        return None, None

    if kind in ("money", "int"):
        digits = raw.replace(" ", "").replace("_", "").replace(",", "")
        if not digits.isdigit():
            return None, "Son yuboring. Masalan: 1900000"
        return int(digits), None

    if kind == "color":
        if not HEX.match(raw):
            return None, "Rang #rrggbb ko'rinishida bo'lishi kerak. Masalan: #ff2d3a"
        return raw.lower(), None

    if kind in ("photo", "video"):
        if not raw.startswith("http"):
            return None, "Faylni yuboring yoki https:// bilan boshlanadigan URL yozing."
        return raw, None

    if kind == "long":
        if len(raw) > 1000:
            return None, "Matn juda uzun (1000 belgidan kam bo'lsin)."
        return raw, None

    if len(raw) > 120:
        return None, "Juda uzun (120 belgidan kam bo'lsin)."
    return raw, None
