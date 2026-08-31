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
from datetime import UTC, datetime
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


def _to_int(value, default: int = 0) -> int:
    """Har qanday qiymatni butun songa keltiradi (buzuq ma'lumotdan himoya)."""
    try:
        return int(float(str(value).strip()))
    except (TypeError, ValueError):
        return default


def _json_list(raw) -> list:
    """JSON matn / massiv / RTDB lug'atini oddiy ro'yxatga keltiradi.

    Zaxira nusxa har xil manbadan kelishi mumkin (Firebase yoki SQLite),
    shuning uchun defensiv: matn bo'lsa JSON deb o'qiladi, lug'at bo'lsa
    qiymatlari olinadi, massiv o'zi qaytadi. Buzuq bo'lsa — bo'sh ro'yxat.
    """
    if raw is None:
        return []
    if isinstance(raw, list):
        return raw
    if isinstance(raw, dict):
        return list(raw.values())
    if isinstance(raw, str):
        text = raw.strip()
        if not text:
            return []
        try:
            data = json.loads(text)
        except (ValueError, TypeError):
            return []
        if isinstance(data, list):
            return data
        if isinstance(data, dict):
            return list(data.values())
        return [data]
    return []


def parse_sizes(raw) -> list[dict]:
    """`sizes` maydonini `[{size, stock}]` ro'yxatiga keltiradi (defensiv).

    Razmerli tovar razmerlarini SQLite JSON matn sifatida saqlaydi. Mini App
    (`offset.js: toProduct`) shu ko'rinishni kutadi. Buzuq/bo'sh bo'lsa — [].
    """
    out: list[dict] = []
    for item in _json_list(raw):
        if isinstance(item, dict):
            size = item.get("size")
            if size is None:
                size = item.get("name")
            out.append(
                {
                    "size": str(size) if size is not None else None,
                    "stock": _to_int(item.get("stock"), 0),
                }
            )
        elif item is not None and not isinstance(item, (list, dict)):
            # Faqat razmer nomi berilgan bo'lsa (masalan "H4", "XL")
            out.append({"size": str(item), "stock": 0})
    return out


def parse_car_names(row: dict, car_name_by_id: dict) -> list[str]:
    """Tovarga bog'langan mashina NOMLARINI (takrorsiz) yig'adi.

    Manba uch xil bo'lishi mumkin va uchalasi ham qo'shiladi:
      • `car_names` / `carNames` — ko'p mashinali JSON ro'yxat;
      • `car_name` / `carName` — bitta mashina nomi;
      • `car_id` — id'dan aniqlangan nom (`cars` jadvalidan).
    """
    names: list[str] = []

    def add(value) -> None:
        text = str(value or "").strip()
        if text and text not in names:
            names.append(text)

    for value in _json_list(row.get("car_names") or row.get("carNames")):
        # Ro'yxat elementlari nom (matn) yoki {id/name} bo'lishi mumkin
        if isinstance(value, dict):
            add(value.get("name") or car_name_by_id.get(value.get("id")))
        else:
            add(value)

    add(row.get("car_name") or row.get("carName"))

    car_id = row.get("car_id")
    if car_id is not None:
        add(car_name_by_id.get(car_id))

    return names


# =====================================================================
#  1-MANBA: Firebase (jonli)
# =====================================================================
def fetch_firebase(db_url: str, root: str) -> dict | None:
    """`{root}/catalog` ni o'qiydi.

    None qaytaradi FAQAT o'qish yiqilganda (ruxsat yo'q, internet, 4xx/5xx).

    DIQQAT: ilgari «tugun bo'sh» holatida ham None qaytarilardi va chaqiruvchi
    SQLite seed'ga o'tardi. Natijada admin do'kondagi hamma tovarni o'chirsa,
    bu skript nusxaga DEMO tovarlarni («LED lampa H4» va h.k.) yozib qo'yardi
    va ular mijozga ko'rinardi. Endi bo'sh katalog ham HAQIQAT sifatida
    qaytariladi — seed faqat o'qish IMKONSIZ bo'lganda ishlatiladi.
    """
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

    if not isinstance(data, dict):
        # Tugun umuman yo'q (null) — baza hali to'ldirilmagan, seed o'rinli.
        print("  Firebase'da `catalog` tuguni yo'q")
        return None
    if not data.get("products"):
        print("  Firebase o'qildi, lekin tovar yo'q — BO'SH nusxa yasaladi")
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

    # `car_id` -> nom (ko'p mashinali tovar nomlarini to'ldirish uchun).
    # `cars` tuguni o'chirilganlarni ham hisobga olmasin — `rows_of` faol
    # bo'lganlarini beradi, lekin nomni topish uchun HAMMASI kerak.
    car_name_by_id: dict = {}
    for car in rows_of(tables.get("cars")):
        cid = car.get("id")
        name = str(car.get("name") or "").strip()
        if cid is not None and name:
            car_name_by_id[cid] = name

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

        _car_names = parse_car_names(row, car_name_by_id)

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
                # Razmerli tovar va kafolat — Mini App'ning boyroq maydonlari
                # (`offline.js: toProduct` ularni himoyalangan holda o'qiydi).
                "product_type": row.get("product_type") or "oddiy",
                "sizes": parse_sizes(row.get("sizes")),
                "warranty": row.get("warranty"),
                # Ko'p mashinali moslik: id emas, NOMLAR ro'yxati (zaxira
                # nusxada id'lar baza tozalangach o'zgaradi, nom qoladi).
                # `car_name` — birinchisi (eski/bitta mashinali ko'rinish bilan
                # mos, `app.js` uni zaxira sifatida o'qiydi).
                "car_names": _car_names,
                "car_name": (_car_names[0] if _car_names else None),
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
                "title": row.get("title"),
                "body": row.get("body") or "",
                "emoji": row.get("emoji") or emoji,
                "color_from": row.get("color_from") or c1,
                "color_to": row.get("color_to") or c2,
                "photo_url": photo,
                "photo_external": bool(photo),
                "video_url": external(row.get("video_url")),
                "video_external": True,
                "has_media": bool(photo),
                # «Batafsil» havolasi va yaratilgan vaqti (`offline.js:
                # toStoryRings` ularni himoyalangan holda o'qiydi).
                "link": row.get("link"),
                "createdAt": row.get("createdAt") or row.get("created_at"),
            }
        )

    return {
        "car_id": None,
        # Nusxa QACHON yasalgani — mijoz/diagnostika zaxira ma'lumot
        # qanchalik yangi ekanini bilsin (UTC, ISO8601).
        "_generated_at": datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
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
        # `is not None` — bo'sh katalog ham HAQIQIY javob (admin hammasini
        # o'chirgan bo'lishi mumkin). Faqat o'qish yiqilganda seed'ga o'tamiz.
        if tables is not None:
            source = "firebase"

    if tables is None:
        print("SQLite seed'dan yasalmoqda...")
        tables = await fetch_seed()

    snapshot = build(tables)
    snapshot["_source"] = source
    snapshot["_snapshot"] = True

    total = sum(len(group["products"]) for group in snapshot["catalog"])
    if total == 0 and source != "firebase":
        # Seed'dan ham hech narsa chiqmadi — bu haqiqiy nosozlik.
        print("XATO: katalog bo'sh — fayl yozilmadi.")
        return 1
    if total == 0:
        print(
            "DIQQAT: Firebase'da tovar yo'q — BO'SH nusxa yoziladi.\n"
            "        Bu ATAYLAB: aks holda o'chirilgan tovarlar o'rniga\n"
            "        demo (seed) tovarlar mijozga ko'rinib qolardi."
        )

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
