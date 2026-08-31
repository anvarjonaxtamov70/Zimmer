"""Firebase Products CRUD — Avto_A1 tizimi (1:1 ko'chirish).

Bu modul mahsulotlarni Firebase Realtime Database'da boshqaradi.
Avto_A1 loyihasidan to'liq ko'chirilgan, barcha xususiyatlari bilan:
- Race condition oldini oluvchi atomik yozish (ETag + if-match)
- Excel/CSV import bilan mos keluvchi ID tizimi
- Multi-image support
- Batch operations
- Lock mexanizmi (bir vaqtda ID to'qnashmasligi uchun)

Struktura:
    zimmer/products/{index}:
        id: int (mantiqiy ID, indeksdan mustaqil)
        name: str
        desc: str | None
        price: int
        stock: int
        code: str | None
        unit: str | None
        product_type: str ("oddiy" | "razmerli")
        brand: str | None
        model: str | None
        category: str
        categories: list[str]
        images: list[str]
        is_active: bool
        is_draft: bool
        batch_id: str | None
        has_conflict: bool
        created_at: int (timestamp ms)
        updated_at: int (timestamp ms)
"""

import asyncio
import logging
import time
from typing import Any

import aiohttp

from services import firebase as fb

logger = logging.getLogger(__name__)

# Products lock — ID va indeks to'qnashmasligi uchun
_products_lock = asyncio.Lock()


def _timestamp_ms() -> int:
    """Unix timestamp (milliseconds)."""
    return int(time.time() * 1000)


# =====================================================================
# AVTO A1 PRODUCT OFFSET SYSTEM (ID va indeks ajratilgan)
# =====================================================================
def product_offsets(raw):
    """RTDB'dan o'qilgan `products` (dict/list/None) dan (keyingi_id, keyingi_indeks).

    Avto_A1 tizimida ID va indeks AJRATILGAN:
    - ID: mahsulotning mantiqiy identifikatori (o'chmaydigan, o'zgarmaydigan)
    - Indeks: Firebase massivdagi joylanishi (o'zgarishi mumkin)

    Bu tizim race condition'ni oldini oladi va parallel import/qo'shishni xavfsiz qiladi.
    """
    if isinstance(raw, list):
        items = [p for p in raw if isinstance(p, dict)]
        next_index = len(raw)
    elif isinstance(raw, dict):
        items = [v for v in raw.values() if isinstance(v, dict)]
        nums = [int(k) for k in raw.keys() if str(k).isdigit()]
        next_index = (max(nums) + 1) if nums else len(raw)
    else:
        items, next_index = [], 0

    next_id = max([p.get("id", 0) for p in items], default=0) + 1
    return next_id, next_index


async def _slot_etag_and_value(session: aiohttp.ClientSession, idx: int):
    """products/<idx> slotining ETag va joriy qiymatini qaytaradi.

    ETag - Firebase ning optimistic concurrency control mexanizmi.
    Bu orqali "agar qiymat o'zgarmagan bo'lsagina yoz" operatsiyasini bajaramiz.
    """
    url = fb.url(f"products/{idx}")
    # Token endi QUERY'da emas, sarlavhada (`fb.auth_headers`) — u yerda
    # qolgan token Google loglariga va xato matnlariga tushardi.
    async with session.get(
        url, headers=fb.auth_headers({"X-Firebase-ETag": "true"})
    ) as r:
        etag = r.headers.get("ETag")
        # DIQQAT: Firebase xato qaytarsa (401/403) tana JSON bo'lmasligi
        # mumkin — `r.json()` ni majburlab chaqirsak ContentTypeError chiqadi
        # va sabab loglarda ko'rinmay qolardi. Shuning uchun aniq tekshiramiz.
        if r.status != 200:
            body = (await r.text())[:200]
            raise RuntimeError(f"Firebase GET products/{idx} -> {r.status}: {body}")
        value = await r.json(content_type=None)
    return etag, value


async def firebase_append_products(
    session: aiohttp.ClientSession | None,
    new_products: list[dict],
    start_index: int,
    max_probe: int = 64
) -> bool:
    """Yangi mahsulotlarni massivga XAVFSIZ (atomik) append qiladi.

    Avto_A1 ning asosiy innovatsiyasi: har bir mahsulot uchun bo'sh slot topiladi
    va u ETag (if-match) bilan ATOMIK egallanadi. Agar admin/boshqa manba ayni
    paytda o'sha slotni egallasa (slot bo'sh emas yoki 412 Precondition Failed),
    keyingi slotga o'tiladi.

    Shu sababli mavjud mahsulotlar HECH QACHON ustidan yozilmaydi (race-free).

    Args:
        session: aiohttp session
        new_products: yangi mahsulotlar ro'yxati
        start_index: boshlang'ich indeks
        max_probe: maksimal urinishlar (to'liq bo'lsa keyingi slotga o'tadi)

    Returns:
        True - hammasi yozildi, False - qattiq xato
    """
    if not new_products:
        return True

    if not fb.is_enabled():
        logger.error(
            "Firebase ulanmagan — mahsulot bulutga yozilmadi. Sabab: %s",
            fb.diagnose(),
        )
        return False

    # Sessiya berilmasa — `services/firebase` ning umumiy (timeout sozlangan)
    # sessiyasini olamiz. Ilgari har chaqiruvda yangi `ClientSession()` ochilardi:
    # timeout yo'q edi va sessiyalar "leak" bo'lardi.
    if session is None:
        session = await fb.session()

    idx = start_index
    for p in new_products:
        placed = False
        probes = 0

        while probes < max_probe:
            probes += 1
            try:
                etag, value = await _slot_etag_and_value(session, idx)
            except Exception as e:
                logger.error(f"products[{idx}] ETag o'qish xatosi: {e}")
                return False

            # Slot band — ustidan YOZMAYMIZ, keyingisiga o'tamiz
            if value is not None:
                idx += 1
                continue

            # Bo'sh slot topildi — atomik yozamiz
            headers = fb.auth_headers({"if-match": etag} if etag else None)
            try:
                url = fb.url(f"products/{idx}")
                async with session.put(
                    url, json=p, headers=headers, timeout=aiohttp.ClientTimeout(total=30)
                ) as pr:
                    if pr.status == 200:
                        placed = True
                        idx += 1
                        break
                    if pr.status == 412:  # poyga: slotni boshqasi egalladi
                        idx += 1
                        continue
                    logger.error(f"products[{idx}] yozilmadi (status={pr.status})")
                    return False
            except Exception as e:
                logger.error(f"products[{idx}] PUT xatosi: {e}")
                return False

        if not placed:
            logger.error("products append: bo'sh slot topilmadi (max_probe tugadi)")
            return False

    return True


# =====================================================================
# CRUD OPERATIONS (Avto_A1 style)
# =====================================================================
async def add_product(
    *,
    name: str,
    price: int,
    stock: int = 0,
    desc: str | None = None,
    code: str | None = None,
    unit: str = "dona",
    product_type: str = "oddiy",
    brand: str | None = None,
    model: str | None = None,
    category: str = "umumiy",
    categories: list[str] | None = None,
    images: list[str] | None = None,
    is_draft: bool = False,
    batch_id: str | None = None,
    description: str | None = None,
    **_ignored: Any,
) -> int:
    """Yangi mahsulot qo'shadi (Avto_A1 style).

    Lock ostida ID olinadi va atomik yoziladi.

    `description` — `desc` ning eski nomi. Migratsiya paytida chaqiruvchilarning
    bir qismi `description=` bilan chaqirar edi va `TypeError: add_product() got
    an unexpected keyword argument 'description'` chiqardi. Endi ikkisi ham
    ishlaydi. Notanish qolgan kalitlar (`**_ignored`) botni yiqitmaydi — faqat
    ogohlantirish yoziladi.
    """
    if description and not desc:
        desc = description
    if _ignored:
        logger.warning("add_product: e'tiborsiz qoldirilgan maydonlar: %s", list(_ignored))

    async with _products_lock:
        # Keyingi ID va indeksni olish
        raw_products = await fb.get("products")
        next_id, next_index = product_offsets(raw_products)

        # Mahsulot ma'lumotlari
        product_data = {
            "id": next_id,
            "name": name[:200],
            "desc": desc[:1000] if desc else "",
            "price": int(price),
            "stock": int(stock),
            "code": code[:50] if code else "",
            "unit": unit,
            "product_type": product_type,
            "brand": brand[:50] if brand else "Umumiy",
            "model": model[:50] if model else "Umumiy",
            "category": category,
            "categories": categories or [category],
            "img": images[0] if images else "",  # birinchi rasm (backward compat)
            "images": images or [],
            "is_active": True,
            "is_draft": is_draft,
            "batch_id": batch_id,
            "has_conflict": False,
            "created_at": _timestamp_ms(),
            "updated_at": _timestamp_ms(),
        }

        # Atomik yozish (umumiy sessiya — ichida o'zi oladi)
        success = await firebase_append_products(None, [product_data], next_index)

        if success:
            logger.info("Mahsulot qo'shildi: %s (ID=%s)", name, next_id)
            return next_id

        logger.error("Mahsulot qo'shilmadi: %s (Firebase: %s)", name, fb.diagnose())
        return 0


async def get_product(product_id: int) -> dict | None:
    """Bitta mahsulotni ID bo'yicha oladi."""
    all_data = await fb.get("products")
    if not all_data:
        return None

    # ID bo'yicha qidirish (indeks emas!)
    for _key, value in fb.items(all_data):
        if isinstance(value, dict) and value.get("id") == product_id:
            return value

    return None


async def get_all_products(
    active_only: bool = True,
    include_drafts: bool = False,
    is_draft: bool | None = None,
    batch_id: str | None = None,
) -> list[dict]:
    """Barcha mahsulotlarni oladi (Avto_A1 filtrlari bilan)."""
    all_data = await fb.get("products")
    if not all_data:
        return []

    products = []
    for _key, value in fb.items(all_data):
        if not isinstance(value, dict):
            continue

        # Filtrlar
        if active_only and not value.get("is_active", True):
            continue

        # Draft filtri (3 ta holat: None=hammasi, True=faqat draft, False=faqat tayyor)
        if is_draft is not None:
            if value.get("is_draft", False) != is_draft:
                continue
        elif not include_drafts and value.get("is_draft", False):
            continue

        if batch_id and value.get("batch_id") != batch_id:
            continue

        products.append(value)

    # ID bo'yicha kamayish tartibida
    products.sort(key=lambda x: x.get("id", 0), reverse=True)
    return products


async def update_product(product_id: int, **fields) -> bool:
    """Mahsulotni yangilaydi (faqat berilgan maydonlar).

    MUHIM: Avto_A1'da patch ishlatiladi (butun mahsulotni qayta yozmaslik uchun).
    """
    if not fields:
        return False

    # Mahsulotni topish (indeksini olish kerak)
    all_data = await fb.get("products")
    if not all_data:
        return False

    product_index = None
    for key, value in fb.items(all_data):
        if isinstance(value, dict) and value.get("id") == product_id:
            product_index = key
            break

    if product_index is None:
        logger.error("Mahsulot topilmadi: ID=%s", product_id)
        return False

    # Yangilash vaqtini qo'shamiz
    fields["updated_at"] = _timestamp_ms()

    # Patch qilish
    success = await fb.patch(f"products/{product_index}", fields)

    if success:
        logger.info("Mahsulot yangilandi: ID=%s, maydonlar=%s", product_id, list(fields.keys()))
    else:
        logger.error("Mahsulot yangilanmadi: ID=%s", product_id)

    return success


async def delete_product(product_id: int) -> bool:
    """Mahsulotni o'chiradi."""
    # Mahsulotni topish
    all_data = await fb.get("products")
    if not all_data:
        return False

    product_index = None
    for key, value in fb.items(all_data):
        if isinstance(value, dict) and value.get("id") == product_id:
            product_index = key
            break

    if product_index is None:
        return False

    # O'chirish (null qo'yish)
    success = await fb.put(f"products/{product_index}", None)

    if success:
        logger.info("Mahsulot o'chirildi: ID=%s", product_id)
    else:
        logger.error("Mahsulot o'chirilmadi: ID=%s", product_id)

    return success


async def toggle_product(product_id: int) -> bool:
    """Mahsulotni faollashtirish/o'chirish."""
    product = await get_product(product_id)
    if not product:
        return False

    new_state = not product.get("is_active", True)
    return await update_product(product_id, is_active=new_state)


async def update_stock(product_id: int, quantity: int) -> bool:
    """Ombor miqdorini yangilaydi."""
    return await update_product(product_id, stock=int(quantity))


async def decrease_stock(product_id: int, amount: int) -> bool:
    """Ombor miqdorini kamaytiradi (sotuvdan keyin)."""
    product = await get_product(product_id)
    if not product:
        return False

    current_stock = product.get("stock", 0)
    new_stock = max(0, current_stock - amount)
    return await update_product(product_id, stock=new_stock)


async def get_products_by_batch(batch_id: str) -> list[dict]:
    """Bitta Excel import guruhidagi barcha mahsulotlar."""
    return await get_all_products(
        active_only=False,
        include_drafts=True,
        batch_id=batch_id
    )


async def set_draft_status(product_id: int, is_draft: bool) -> bool:
    """Mahsulotni qoralama/tayyor holatiga o'tkazadi."""
    return await update_product(product_id, is_draft=is_draft)
