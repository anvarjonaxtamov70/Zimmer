#!/usr/bin/env python3
"""`docs/catalog.json` — Mini App uchun STATIK katalog nusxasi.

NEGA BU KERAK
Mini App'ning zaxira rejimi uch qatlamli edi:
    Render API  ->  Firebase RTDB  ->  localStorage kesh
Uchalasi ham yiqilishi mumkin:
  • Render — bepul kvota tugasa 503;
  • Firebase — qoidalar qo'yilmagan bo'lsa 401, yoki tugun bo'sh;
  • kesh — mijoz ILOVAGA BIRINCHI MARTA kirsa bo'sh.
Natijada mijoz «Ulanish yo'q» devoriga urilardi.

Bu skript 4-QATLAMNI yasaydi: katalogni oddiy JSON fayl qilib `docs/` ga
yozadi. Fayl GitHub Pages orqali ilovaning O'ZI bilan bir manzildan
beriladi, ya'ni:
    • Render kerak emas;
    • Firebase kerak emas (so'rov paytida);
    • qoidalar kerak emas;
    • CORS muammosi yo'q;
    • birinchi kirishda ham ishlaydi.

MANBA (ustuvorlik bo'yicha)
  1. Firebase `{root}/catalog` — jonli ma'lumot (qoidalar ochiq bo'lsa);
  2. SQLite seed (`database/db.py`) — Render har qayta deployda bazani
     tozalaydi va aynan shu katalog qayta yaratiladi, shuning uchun bu
     "demo" emas, balki haqiqiy boshlang'ich holat.

ISHLATISH
    python scripts/build_catalog_snapshot.py             # avto (Firebase -> seed)
    python scripts/build_catalog_snapshot.py --seed-only # faqat seed'dan
"""

import argparse
import asyncio
import json
import os
import sys
import tempfile
import urllib.request
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BASE_DIR))

OUT_PATH = BASE_DIR / "docs" / "catalog.json"

# `utils/stories.py` bilan bir xil bo'lishi shart
STORY_RINGS = [
    ("aksiyalar", "Aksiyalar", "🔥", "#ff2d3a", "#6d0a10"),
    ("bugun", "Bugun", "⚡️", "#ff6b3d", "#3a0f00"),
    ("mijozlar", "Mijozlar", "💬", "#e01020", "#2a0006"),
    ("natijalar", "Natijalar", "🏆", "#ff4b3e", "#1a0508"),
    ("kafolat", "Kafolat", "🛡", "#c1121f", "#101215"),
    ("lokatsiya", "Manzil", "📍", "#ff8f3d", "#2b1200"),
    ("tolov", "To'lov", "💳", "#ff2d55", "#25040c"),
    ("aloqa", "Aloqa", "📞", "#ff5f6d", "#20060a"),
]


def price_label(value, currency="so'm") -> str:
    """`utils/helpers.py:fmt_price` bilan AYNAN bir xil: 120000 -> '120 000 so'm'."""
    return f"{int(value or 0):,}".replace(",", " ") + f" {currency}"


def external(url) -> str | None:
    """Faqat tashqi (http) manzil zaxira rejimda ochiladi."""
    text = str(url or "").strip()
    return text if text.startswith("http") else None


# =====================================================================
#  1-MANBA: Firebase (jonli)
# =====================================================================
def fetch_firebase(db_url: str, root: str) -> dict | None:
    """`{root}/catalog` ni o'qiydi. Ruxsat yo'q yoki bo'sh bo'lsa None."""
    url = f"{db_url.rstrip('/')}/{root.strip('/')}/catalog.json"
    try:
        with urllib.request.urlopen(url, timeout=30) as response:  # noqa: S310
            if response.status != 200:
                print(f"  Firebase -> {response.status}")
                return None
            data = json.loads(response.read().decode("utf-8"))
    except Exception as error:
        print(f"  Firebase o'qilmadi: {error}")
        return None

    if not isinstance(data, dict) or not data.get("products"):
        print("  Firebase'da katalog bo'sh")
        return None
    return data


def rows_of(node) -> list[dict]:
    """RTDB tuguni dict yoki massiv bo'lishi mumkin; o'chirilganlarni tashlaydi."""
    if not node:
        return []
    items = []
    if isinstance(node, list):
        items = [v for v in node if isinstance(v, dict)]
    elif isinstance(node, dict):
        for key, value in node.items():
            if isinstance(value, dict):
                value.setdefault("id", int(key) if str(key).isdigit() else key)
                items.append(value)
    return [
        item
        for item in items
        if not item.get("deleted") and item.get("is_active") not in (0, False)
    ]


# =====================================================================
#  2-MANBA: SQLite seed
# =====================================================================
async def fetch_seed() -> dict:
    """Vaqtinchalik bazani yaratib (seed ishga tushadi) katalogni o'qiydi."""
    os.environ.setdefault("BOT_TOKEN", "0:snapshot")
    os.environ["DB_PATH"] = tempfile.mktemp(suffix=".db")
    os.environ.pop("FIREBASE_DB_URL", None)  # tarmoqqa chiqmasin

    from database import db as dbmod
    from database import queries as q

    await dbmod.init_db()

    tables = {}
    for table in ("categories", "cars", "products", "banners", "stories"):  # noqa: E501
        rows = await q.admin_list(table, limit=1000)
        tables[table] = [{k: row[k] for k in row.keys()} for row in rows]

    # Mahsulotni kategoriya NOMIGA bog'laymiz (Firebase mirror shakli bilan bir xil)
    cat_by_id = {c["id"]: c["name"] for c in tables["categories"]}
    for product in tables["products"]:
        product["categoryName"] = cat_by_id.get(product.get("category_id"))

    return tables


# =====================================================================
#  Umumiy: `/api/home` shakliga keltirish
# =====================================================================
def build(tables: dict, currency: str = "so'm") -> dict:
    products = rows_of(tables.get("products"))
    categories = rows_of(tables.get("categories"))
    banners = rows_of(tables.get("banners"))
    stories = rows_of(tables.get("stories"))

    by_name = {}
    for category in categories:
        name = str(category.get("name") or category.get("_key") or "")
        if name:
            by_name[name.lower()] = category

    groups: list[dict] = []
    index: dict[str, dict] = {}

    def bucket(category):
        name = str(category.get("name") or category.get("_key") or "Mahsulotlar")
        if name not in index:
            index[name] = {
                "id": category.get("id", name),
                "name": name,
                "icon": category.get("icon"),
                "products": [],
            }
            groups.append(index[name])
        return index[name]

    for row in sorted(products, key=lambda p: -(p.get("id") or 0)):
        images = [
            external(row.get("photo_url")),
            external(row.get("photo2_url")),
            external(row.get("photo3_url")),
        ]
        images = [url for url in images if url]

        name = str(row.get("categoryName") or "").lower()
        category = by_name.get(name) or (categories[0] if categories else {"name": "Mahsulotlar"})
        bucket(category)["products"].append(
            {
                "id": row.get("id"),
                "name": row.get("name") or "",
                "description": row.get("description"),
                "price": int(row.get("price") or 0),
                "old_price": int(row["old_price"]) if row.get("old_price") else None,
                "badge": row.get("badge"),
                "stock": int(row.get("stock") or 0),
                "car_id": row.get("car_id"),
                "price_label": price_label(row.get("price"), currency),
                "old_price_label": (
                    price_label(row["old_price"], currency) if row.get("old_price") else None
                ),
                "photo_url": images[0] if images else None,
                "photo_external": bool(images),
                "video_url": external(row.get("video_url")),
                "video_external": True,
                "has_media": bool(images),
                "images": images,
            }
        )

    ring_items: dict[str, list] = {key: [] for key, *_ in STORY_RINGS}
    defaults = {key: (emoji, c1, c2) for key, _t, emoji, c1, c2 in STORY_RINGS}
    for row in sorted(stories, key=lambda s: (s.get("sort") or 0, s.get("id") or 0)):
        key = str(row.get("category") or "bugun")
        if key not in ring_items:
            continue
        emoji, c1, c2 = defaults[key]
        photo = external(row.get("photo_url"))
        ring_items[key].append(
            {
                "id": row.get("id"),
                "heading": row.get("heading") or row.get("title") or "",
                "body": row.get("body") or "",
                "emoji": row.get("emoji") or emoji,
                "color_from": row.get("color_from") or c1,
                "color_to": row.get("color_to") or c2,
                "photo_url": photo,
                "photo_external": bool(photo),
                "video_url": external(row.get("video_url")),
                "video_external": True,
                "has_media": bool(photo),
            }
        )

    return {
        "car_id": None,
        "banners": [
            {
                "id": row.get("id"),
                "title": row.get("title") or "",
                "subtitle": row.get("subtitle") or "",
                "tag": row.get("tag") or "",
                "color_from": row.get("color_from") or "#c1121f",
                "color_to": row.get("color_to") or "#101215",
                "photo_url": external(row.get("photo_url")),
                "photo_external": bool(external(row.get("photo_url"))),
                "video_url": external(row.get("video_url")),
                "video_external": True,
                "has_media": bool(external(row.get("photo_url"))),
            }
            for row in sorted(banners, key=lambda b: (b.get("sort") or 0, b.get("id") or 0))
        ],
        "stories": [
            {
                "key": key,
                "title": title,
                "emoji": emoji,
                "color_from": c1,
                "color_to": c2,
                "count": len(ring_items[key]),
                "items": ring_items[key],
            }
            for key, title, emoji, c1, c2 in STORY_RINGS
            if ring_items[key]
        ],
        "catalog": [group for group in groups if group["products"]],
        "favorite_ids": [],
        # Mashinalar `/api/home` javobiga kirmaydi (`/api/cars` alohida), lekin
        # konfigurator va «mashinamga mos» filtri uchun kerak — nusxaga qo'shamiz.
        "cars": [
            {
                "id": row.get("id"),
                "name": row.get("name") or "",
                "years": row.get("years"),
                "note": row.get("note"),
                "photo_url": external(row.get("photo_url")),
                "has_media": bool(external(row.get("photo_url"))),
            }
            for row in sorted(
                rows_of(tables.get("cars")), key=lambda c: (c.get("sort") or 0, c.get("id") or 0)
            )
        ],
    }


async def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--seed-only", action="store_true", help="Firebase'ni o'qimaydi")
    parser.add_argument("--db-url", default=os.getenv("FIREBASE_DB_URL", ""))
    parser.add_argument("--root", default=os.getenv("FIREBASE_ROOT", "zimmer"))
    args = parser.parse_args()

    tables = None
    source = "seed"

    if not args.seed_only and args.db_url:
        print(f"Firebase o'qilmoqda: {args.db_url}")
        tables = fetch_firebase(args.db_url, args.root)
        if tables:
            source = "firebase"

    if tables is None:
        print("SQLite seed'dan yasalmoqda...")
        tables = await fetch_seed()

    snapshot = build(tables)
    snapshot["_source"] = source
    snapshot["_snapshot"] = True

    total = sum(len(group["products"]) for group in snapshot["catalog"])
    if total == 0:
        print("XATO: katalog bo'sh — fayl yozilmadi.")
        return 1

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(
        json.dumps(snapshot, ensure_ascii=False, indent=1) + "\n", encoding="utf-8"
    )
    print(
        f"✅ {OUT_PATH.relative_to(BASE_DIR)} yozildi — manba: {source}, "
        f"{total} mahsulot, {len(snapshot['catalog'])} kategoriya, "
        f"{len(snapshot['banners'])} banner, {len(snapshot['stories'])} story halqasi"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
