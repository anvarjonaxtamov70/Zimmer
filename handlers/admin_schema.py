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


@dataclass(frozen=True)
class Entity:
    key: str
    table: str
    title: str
    icon: str
    fields: tuple[Field, ...]
    label: Callable
    create: tuple[str, ...] = dc_field(default_factory=tuple)


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
            Field("name", "Nomi", required=True),
            Field("duration_min", "Davomiyligi (daqiqa)", "int", required=True),
            Field("price", "Narx", "money"),
        ),
        label=lambda r: f"{r['name']} · {r['duration_min']} daq · {fmt_price(r['price'])}",
        create=("name", "duration_min", "price"),
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
