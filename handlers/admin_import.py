"""Excel/CSV import handler — Avto_A1 tizimini nusxalash.

Admin Excel yoki CSV fayl yuboradi, bot uni o'qib mahsulotlarni
Firebase'ga qoralama (is_draft=True) holda qo'shadi.

Qo'llab-quvvatlanadigan formatlar:
1. Excel (.xlsx, .xls)
2. CSV (.csv)

Kutilayotgan ustunlar (tartibsiz bo'lishi mumkin):
- name / nomi / mahsulot (majburiy)
- price / narx (majburiy, so'm)
- stock / ombor / miqdor (ixtiyoriy, standart=0)
- description / tavsif / izoh (ixtiyoriy)
- code / kod / artikul (ixtiyoriy)
- brand / brend (ixtiyoriy)
- model (ixtiyoriy)
- unit / birlik (ixtiyoriy: "dona", "komplekt")
- old_price / eski_narx (ixtiyoriy)

Jarayon:
1. Admin fayl yuboradi
2. Bot faylni yuklab oladi va tahlil qiladi
3. Barcha mahsulotlar qoralama holda Firebase'ga qo'shiladi (batch_id bilan)
4. Admin'ga guruh ID va statistika yuboriladi
5. Admin mahsulotlarni tekshiradi va tasdiqlaydi (/products_drafts orqali)
"""

import asyncio
import io
import logging
import os
import tempfile
import uuid
from datetime import datetime

import aiohttp
import pandas as pd
from aiogram import Router, F
from aiogram.types import Message, BufferedInputFile
from aiogram.filters import Command

from config import config, is_admin
from services import firebase_products as fb_prod
from services import sync

logger = logging.getLogger(__name__)
router = Router()


# Ustun nomlarini normalizatsiya qilish (turli tillar/yozuvlar)
COLUMN_MAPPINGS = {
    "name": ["name", "nomi", "mahsulot", "nom", "product", "название"],
    "price": ["price", "narx", "price_uzs", "narxi", "цена"],
    "stock": ["stock", "ombor", "miqdor", "soni", "quantity", "qty", "остаток"],
    "description": ["description", "tavsif", "izoh", "desc", "описание"],
    "code": ["code", "kod", "artikul", "article", "артикул", "oem"],
    "brand": ["brand", "brend", "бренд", "firma"],
    "model": ["model", "модель"],
    "unit": ["unit", "birlik", "единица"],
    "old_price": ["old_price", "eski_narx", "старая_цена", "discount_price"],
    "badge": ["badge", "teg", "тег", "label"],
    "category_id": ["category_id", "kategoriya", "категория", "cat_id"],
}


def _normalize_columns(df: pd.DataFrame) -> pd.DataFrame:
    """DataFrame ustunlarini standart nomlarga o'zgartiradi."""
    df.columns = df.columns.str.strip().str.lower()
    
    rename_map = {}
    for standard, variants in COLUMN_MAPPINGS.items():
        for col in df.columns:
            if col in variants:
                rename_map[col] = standard
                break
    
    if rename_map:
        df = df.rename(columns=rename_map)
    
    return df


def _parse_int(value, default=0) -> int:
    """Qiymatni int ga aylantiradi, xato bo'lsa default."""
    if pd.isna(value):
        return default
    try:
        return int(float(value))
    except (ValueError, TypeError):
        return default


def _parse_str(value, default=None) -> str | None:
    """Qiymatni str ga aylantiradi, bo'sh bo'lsa default."""
    if pd.isna(value):
        return default
    text = str(value).strip()
    return text if text else default


async def _download_file(bot, file_id: str) -> bytes:
    """Telegram'dan faylni yuklab oladi."""
    file = await bot.get_file(file_id)
    file_url = f"https://api.telegram.org/file/bot{config.bot_token}/{file.file_path}"
    
    async with aiohttp.ClientSession() as session:
        async with session.get(file_url) as response:
            if response.status == 200:
                return await response.read()
            raise Exception(f"Faylni yuklab olishda xato: {response.status}")


async def _process_excel(file_bytes: bytes, batch_id: str) -> dict:
    """Excel faylni qayta ishlaydi va mahsulotlarni qo'shadi."""
    try:
        # Excel'ni o'qish
        df = pd.read_excel(io.BytesIO(file_bytes))
    except Exception as e:
        logger.error("Excel o'qilmadi: %s", e)
        return {"success": False, "error": f"Excel o'qilmadi: {e}"}
    
    return await _process_dataframe(df, batch_id)


async def _process_csv(file_bytes: bytes, batch_id: str) -> dict:
    """CSV faylni qayta ishlaydi va mahsulotlarni qo'shadi."""
    try:
        # Turli encodinglarni sinab ko'rish
        for encoding in ["utf-8", "cp1251", "latin1"]:
            try:
                df = pd.read_csv(io.BytesIO(file_bytes), encoding=encoding)
                break
            except UnicodeDecodeError:
                continue
        else:
            return {"success": False, "error": "CSV encoding aniqlanmadi"}
    except Exception as e:
        logger.error("CSV o'qilmadi: %s", e)
        return {"success": False, "error": f"CSV o'qilmadi: {e}"}
    
    return await _process_dataframe(df, batch_id)


async def _process_dataframe(df: pd.DataFrame, batch_id: str) -> dict:
    """DataFrame'ni tahlil qilib mahsulotlarni Firebase'ga qo'shadi."""
    if df.empty:
        return {"success": False, "error": "Fayl bo'sh"}
    
    # Ustunlarni normalizatsiya
    df = _normalize_columns(df)
    
    # Majburiy ustunlar tekshiruvi
    if "name" not in df.columns:
        return {
            "success": False,
            "error": "Majburiy ustun topilmadi: 'name' (yoki 'nomi', 'mahsulot')"
        }
    
    if "price" not in df.columns:
        return {
            "success": False,
            "error": "Majburiy ustun topilmadi: 'price' (yoki 'narx')"
        }
    
    # Mahsulotlarni qayta ishlash
    added = 0
    skipped = 0
    errors = []
    
    for idx, row in df.iterrows():
        name = _parse_str(row.get("name"))
        price = _parse_int(row.get("price"))
        
        # Validate
        if not name or len(name) < 2:
            skipped += 1
            errors.append(f"Qator {idx+2}: Nom juda qisqa yoki bo'sh")
            continue
        
        if price <= 0:
            skipped += 1
            errors.append(f"Qator {idx+2}: Narx noto'g'ri ({price})")
            continue
        
        # Mahsulot ma'lumotlarini tayyorlash (Avto_A1 style)
        try:
            product_id = await fb_prod.add_product(
                name=name,
                price=price,
                stock=_parse_int(row.get("stock"), 0),
                desc=_parse_str(row.get("description")),  # desc (Avto_A1 style)
                code=_parse_str(row.get("code")),
                brand=_parse_str(row.get("brand")),
                model=_parse_str(row.get("model")),
                unit=_parse_str(row.get("unit"), "dona"),  # default "dona"
                category="umumiy",  # Avto_A1 style (string, not ID)
                categories=["umumiy"],  # Avto_A1 style
                is_draft=True,  # Qoralama
                batch_id=batch_id,
            )
            
            if product_id > 0:
                added += 1
            else:
                skipped += 1
                errors.append(f"Qator {idx+2}: Firebase'ga qo'shilmadi")
        
        except Exception as e:
            skipped += 1
            errors.append(f"Qator {idx+2}: {e}")
            logger.error("Mahsulot qo'shilmadi (qator %s): %s", idx+2, e)
    
    return {
        "success": True,
        "added": added,
        "skipped": skipped,
        "total": len(df),
        "batch_id": batch_id,
        "errors": errors[:10],  # Faqat birinchi 10 ta xato
    }


@router.message(F.document, F.from_user.id.func(is_admin))
async def handle_import_file(message: Message):
    """Admin Excel/CSV fayl yuborsa, avtomatik import qiladi."""
    doc = message.document
    if not doc:
        return
    
    # Fayl formatini tekshirish
    filename = doc.file_name.lower() if doc.file_name else ""
    
    if not any(filename.endswith(ext) for ext in [".xlsx", ".xls", ".csv"]):
        # Excel/CSV emas — o'tkazib yuboramiz (boshqa handler ishlashi mumkin)
        return
    
    # Import jarayonini boshlash
    status_msg = await message.answer(
        "📊 <b>Import boshlandi...</b>\n\n"
        f"Fayl: <code>{doc.file_name}</code>\n"
        f"Hajm: {doc.file_size / 1024:.1f} KB\n\n"
        "⏳ Fayl yuklanmoqda...",
        parse_mode="HTML"
    )
    
    try:
        # Faylni yuklash
        file_bytes = await _download_file(message.bot, doc.file_id)
        
        await status_msg.edit_text(
            "📊 <b>Import boshlandi...</b>\n\n"
            f"Fayl: <code>{doc.file_name}</code>\n"
            f"Hajm: {doc.file_size / 1024:.1f} KB\n\n"
            "⏳ Fayl tahlil qilinmoqda...",
            parse_mode="HTML"
        )
        
        # Batch ID yaratish
        batch_id = f"import_{datetime.now().strftime('%Y%m%d_%H%M%S')}_{uuid.uuid4().hex[:8]}"
        
        # Faylni qayta ishlash
        if filename.endswith(".csv"):
            result = await _process_csv(file_bytes, batch_id)
        else:
            result = await _process_excel(file_bytes, batch_id)
        
        # Natijani ko'rsatish
        if not result["success"]:
            await status_msg.edit_text(
                f"❌ <b>Import xatosi</b>\n\n"
                f"{result['error']}",
                parse_mode="HTML"
            )
            return
        
        # Muvaffaqiyat xabari
        text = (
            f"✅ <b>Import yakunlandi</b>\n\n"
            f"📦 Batch ID: <code>{result['batch_id']}</code>\n\n"
            f"Jami qatorlar: {result['total']}\n"
            f"✅ Qo'shildi: {result['added']}\n"
            f"⏭ O'tkazib yuborildi: {result['skipped']}\n\n"
        )
        
        if result['errors']:
            text += "<b>Xatolar:</b>\n"
            for error in result['errors']:
                text += f"• {error}\n"
            if result['skipped'] > len(result['errors']):
                text += f"... va yana {result['skipped'] - len(result['errors'])} ta\n"
        
        text += (
            "\n<i>💡 Mahsulotlar QORALAMA holda qo'shildi. "
            "Tekshirib, tasdiqlash uchun:</i>\n"
            "<code>/products_drafts</code>"
        )
        
        await status_msg.edit_text(text, parse_mode="HTML")
        
        logger.info(
            "Import yakunlandi: batch=%s, added=%s, skipped=%s",
            batch_id, result['added'], result['skipped']
        )
    
    except Exception as e:
        logger.error("Import xatosi: %s", e, exc_info=True)
        await status_msg.edit_text(
            f"❌ <b>Import xatosi</b>\n\n"
            f"<code>{e}</code>\n\n"
            f"Texnik tafsilotlar logda.",
            parse_mode="HTML"
        )


@router.message(Command("products_drafts"), F.from_user.id.func(is_admin))
async def list_draft_products(message: Message):
    """Qoralama mahsulotlar ro'yxatini ko'rsatadi."""
    products = await fb_prod.get_all_products(
        active_only=False,
        include_drafts=True
    )
    
    drafts = [p for p in products if p.get("is_draft", False)]
    
    if not drafts:
        await message.answer(
            "📦 <b>Qoralama mahsulotlar yo'q</b>\n\n"
            "Excel/CSV import qilganingizda, mahsulotlar bu yerda ko'rinadi.",
            parse_mode="HTML"
        )
        return
    
    # Batch'lar bo'yicha guruhlash
    batches = {}
    for product in drafts:
        batch_id = product.get("batch_id", "unknown")
        if batch_id not in batches:
            batches[batch_id] = []
        batches[batch_id].append(product)
    
    text = f"📦 <b>Qoralama mahsulotlar</b>\n\n"
    text += f"Jami: {len(drafts)} ta\n"
    text += f"Guruhlar: {len(batches)}\n\n"
    
    for batch_id, batch_products in list(batches.items())[:5]:
        text += f"<b>{batch_id}</b>\n"
        text += f"  {len(batch_products)} ta mahsulot\n"
        
        # Birinchi 3 ta mahsulot
        for prod in batch_products[:3]:
            text += f"  • {prod.get('name', 'No name')} - {prod.get('price', 0):,} so'm\n"
        
        if len(batch_products) > 3:
            text += f"  ... va yana {len(batch_products) - 3} ta\n"
        text += "\n"
    
    text += (
        "<i>💡 Mahsulotlarni tasdiqlash uchun admin paneldan yoki "
        "quyidagi buyruqlardan foydalaning:</i>\n\n"
        "<code>/approve_batch {batch_id}</code> - butun guruhni tasdiqlash\n"
        "<code>/delete_batch {batch_id}</code> - butun guruhni o'chirish"
    )
    
    await message.answer(text, parse_mode="HTML")


@router.message(Command("approve_batch"), F.from_user.id.func(is_admin))
async def approve_batch(message: Message):
    """Batch'dagi barcha mahsulotlarni tasdiqlaydi (is_draft=False)."""
    args = message.text.split(maxsplit=1)
    if len(args) < 2:
        await message.answer(
            "❌ Batch ID berilmadi.\n\n"
            "Foydalanish: <code>/approve_batch import_20260818_143000_a1b2c3d4</code>",
            parse_mode="HTML"
        )
        return
    
    batch_id = args[1].strip()
    products = await fb_prod.get_products_by_batch(batch_id)
    
    if not products:
        await message.answer(
            f"❌ <b>Batch topilmadi</b>\n\n"
            f"ID: <code>{batch_id}</code>",
            parse_mode="HTML"
        )
        return
    
    # Barcha mahsulotlarni tasdiqlash
    approved = 0
    for product in products:
        success = await fb_prod.set_draft_status(product["id"], is_draft=False)
        if success:
            approved += 1

    # Tasdiqlangan tovarlar DARHOL do'konga chiqadi: Firebase `products` ->
    # SQLite -> `catalog`. Mini App `products` tugunini o'qimaydi, shuning
    # uchun bu qadam bo'lmasa pastdagi «endi do'konda ko'rinadi» yozuvi
    # yolg'on bo'lardi (tovar keyingi restart'gacha ko'rinmasdi).
    if approved:
        try:
            await sync.publish_imported_products()
        except Exception as error:
            logger.warning("Tasdiqlangan batch do'konga chiqarilmadi: %s", error)

    await message.answer(
        f"✅ <b>Batch tasdiqlandi</b>\n\n"
        f"Batch ID: <code>{batch_id}</code>\n"
        f"Tasdiqlangan: {approved} / {len(products)}\n\n"
        f"Mahsulotlar endi do'konda ko'rinadi.",
        parse_mode="HTML"
    )


@router.message(Command("delete_batch"), F.from_user.id.func(is_admin))
async def delete_batch(message: Message):
    """Batch'dagi barcha mahsulotlarni o'chiradi."""
    args = message.text.split(maxsplit=1)
    if len(args) < 2:
        await message.answer(
            "❌ Batch ID berilmadi.\n\n"
            "Foydalanish: <code>/delete_batch import_20260818_143000_a1b2c3d4</code>",
            parse_mode="HTML"
        )
        return
    
    batch_id = args[1].strip()
    products = await fb_prod.get_products_by_batch(batch_id)
    
    if not products:
        await message.answer(
            f"❌ <b>Batch topilmadi</b>\n\n"
            f"ID: <code>{batch_id}</code>",
            parse_mode="HTML"
        )
        return
    
    # Barcha mahsulotlarni o'chirish
    deleted = 0
    for product in products:
        success = await fb_prod.delete_product(product["id"])
        if success:
            deleted += 1
    
    await message.answer(
        f"🗑 <b>Batch o'chirildi</b>\n\n"
        f"Batch ID: <code>{batch_id}</code>\n"
        f"O'chirildi: {deleted} / {len(products)}",
        parse_mode="HTML"
    )
