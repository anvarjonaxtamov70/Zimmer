"""Firebase Products CRUD — Avto_A1 tizimini nusxalash.

Bu modul mahsulotlarni Firebase Realtime Database'da boshqaradi.
SQLite products jadvali saqlanadi (yordamchi sifatida), lekin asosiy
manba Firebase hisoblanadi.

Struktura (Avto_A1 kabi):
    zimmer/products/{product_id}:
        id: int
        name: str
        description: str | None
        price: int
        old_price: int | None
        stock: int
        code: str | None          # artikul/OEM
        unit: str | None          # "dona" | "komplekt"
        product_type: str         # "oddiy" | "razmerli"
        sizes: list | None        # [{size, stock}]
        brand: str | None         # brend (Avto_A1'dan)
        model: str | None         # model (Avto_A1'dan)
        car_id: int | None        # mashina bog'langan bo'lsa
        category_id: int
        images: list[str]         # [url1, url2, url3] - Telegram file_id yoki URL
        badge: str | None         # "Chegirma", "TOP tanlov" va h.k.
        is_active: bool
        is_draft: bool            # qoralama (Excel import'dan keyin admin tekshiradi)
        batch_id: str | None      # Excel import guruh ID'si
        created_at: str           # ISO timestamp
        updated_at: str
"""

import asyncio
import logging
import time
from datetime import datetime
from typing import Any

from services import firebase as fb

logger = logging.getLogger(__name__)

# Products bo'sh joy uchun standart kategoriya
DEFAULT_CATEGORY_ID = 1

# Lock — Excel import va admin qo'shish bir vaqtda ID to'qnashmasligi uchun
_products_lock = asyncio.Lock()


def _timestamp() -> str:
    """ISO 8601 vaqt tamg'asi."""
    return datetime.utcnow().isoformat() + "Z"


async def get_next_product_id() -> int:
    """Keyingi mahsulot ID'sini oladi (Firebase counter asosida)."""
    async with _products_lock:
        counter = await fb.get("products_counter")
        if counter is None:
            counter = 1000  # boshlanish
        next_id = int(counter) + 1
        await fb.put("products_counter", next_id)
        return next_id


async def add_product(
    *,
    name: str,
    price: int,
    stock: int = 0,
    description: str | None = None,
    old_price: int | None = None,
    code: str | None = None,
    unit: str | None = None,
    product_type: str = "oddiy",
    sizes: list | None = None,
    brand: str | None = None,
    model: str | None = None,
    car_id: int | None = None,
    category_id: int | None = None,
    images: list[str] | None = None,
    badge: str | None = None,
    is_draft: bool = False,
    batch_id: str | None = None,
) -> int:
    """Yangi mahsulot qo'shadi (Firebase). ID qaytaradi."""
    product_id = await get_next_product_id()
    
    data = {
        "id": product_id,
        "name": name[:120],
        "description": description[:500] if description else None,
        "price": int(price),
        "old_price": int(old_price) if old_price else None,
        "stock": int(stock),
        "code": code[:50] if code else None,
        "unit": unit,
        "product_type": product_type,
        "sizes": sizes if product_type == "razmerli" else None,
        "brand": brand[:50] if brand else None,
        "model": model[:50] if model else None,
        "car_id": int(car_id) if car_id else None,
        "category_id": int(category_id) if category_id else DEFAULT_CATEGORY_ID,
        "images": images or [],
        "badge": badge[:20] if badge else None,
        "is_active": True,
        "is_draft": is_draft,
        "batch_id": batch_id,
        "created_at": _timestamp(),
        "updated_at": _timestamp(),
    }
    
    success = await fb.put(f"products/{product_id}", data)
    if success:
        logger.info("Firebase'ga mahsulot qo'shildi: %s (ID=%s)", name, product_id)
        return product_id
    
    logger.error("Firebase'ga mahsulot qo'shilmadi: %s", name)
    return 0


async def update_product(product_id: int, **fields) -> bool:
    """Mahsulotni yangilaydi (faqat berilgan maydonlar)."""
    if not fields:
        return False
    
    fields["updated_at"] = _timestamp()
    success = await fb.patch(f"products/{product_id}", fields)
    
    if success:
        logger.info("Mahsulot yangilandi: ID=%s, maydonlar=%s", product_id, list(fields.keys()))
    else:
        logger.error("Mahsulot yangilanmadi: ID=%s", product_id)
    
    return success


async def get_product(product_id: int) -> dict | None:
    """Bitta mahsulotni oladi."""
    data = await fb.get(f"products/{product_id}")
    if data and isinstance(data, dict):
        return data
    return None


async def get_all_products(
    active_only: bool = True,
    category_id: int | None = None,
    car_id: int | None = None,
    include_drafts: bool = False,
) -> list[dict]:
    """Barcha mahsulotlarni oladi (filtrlash bilan)."""
    all_data = await fb.get("products")
    if not all_data:
        return []
    
    products = []
    for key, value in fb.items(all_data):
        if not isinstance(value, dict):
            continue
        
        # Filtrlar
        if active_only and not value.get("is_active", True):
            continue
        if not include_drafts and value.get("is_draft", False):
            continue
        if category_id is not None and value.get("category_id") != category_id:
            continue
        if car_id is not None:
            prod_car = value.get("car_id")
            # Universal (car_id=None) yoki aniq mashina
            if prod_car is not None and prod_car != car_id:
                continue
        
        products.append(value)
    
    # Yangilikdan eskisiga
    products.sort(key=lambda x: x.get("created_at", ""), reverse=True)
    return products


async def delete_product(product_id: int) -> bool:
    """Mahsulotni o'chiradi."""
    success = await fb.put(f"products/{product_id}", None)
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


async def set_draft_status(product_id: int, is_draft: bool) -> bool:
    """Mahsulotni qoralama/tayyor holatiga o'tkazadi."""
    return await update_product(product_id, is_draft=is_draft)


async def get_products_by_batch(batch_id: str) -> list[dict]:
    """Bitta Excel import guruhidagi barcha mahsulotlar."""
    all_data = await fb.get("products")
    if not all_data:
        return []
    
    products = []
    for key, value in fb.items(all_data):
        if isinstance(value, dict) and value.get("batch_id") == batch_id:
            products.append(value)
    
    return products


async def update_stock(product_id: int, quantity: int) -> bool:
    """Ombor miqdorini yangilaydi."""
    return await update_product(product_id, stock=quantity)


async def decrease_stock(product_id: int, amount: int) -> bool:
    """Ombor miqdorini kamaytiradi (sotuvdan keyin)."""
    product = await get_product(product_id)
    if not product:
        return False
    
    current_stock = product.get("stock", 0)
    new_stock = max(0, current_stock - amount)
    return await update_product(product_id, stock=new_stock)


async def add_product_images(product_id: int, image_urls: list[str]) -> bool:
    """Mahsulotga rasmlar qo'shadi (mavjudlariga qo'shiladi)."""
    product = await get_product(product_id)
    if not product:
        return False
    
    current_images = product.get("images", [])
    if not isinstance(current_images, list):
        current_images = []
    
    # Yangi rasmlarni qo'shish (duplikatlar yo'q)
    for url in image_urls:
        if url and url not in current_images:
            current_images.append(url)
    
    return await update_product(product_id, images=current_images)


async def remove_product_image(product_id: int, image_url: str) -> bool:
    """Mahsulotdan rasmni o'chiradi."""
    product = await get_product(product_id)
    if not product:
        return False
    
    current_images = product.get("images", [])
    if not isinstance(current_images, list):
        return False
    
    if image_url in current_images:
        current_images.remove(image_url)
        return await update_product(product_id, images=current_images)
    
    return False
