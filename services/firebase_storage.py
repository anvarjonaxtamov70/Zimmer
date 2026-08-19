"""Firebase Storage — mahsulot rasmlarini saqlash va URL olish.

Avto_A1'dan nusxalangan: Telegram file_id'larni Firebase Storage'ga yuklash
va doimiy URL olish (link hech qachon eskirmaydi).

Agar Firebase Storage sozlanmagan bo'lsa, file_id telegram serverlarda qoladi
va to'g'ridan-to'g'ri ishlatiladi (vaqtinchalik link).
"""

import asyncio
import logging
import os
from typing import Optional

import aiohttp
from aiogram import Bot

from config import config
from services import firebase

logger = logging.getLogger(__name__)

# Firebase Storage bucket (env'dan)
STORAGE_BUCKET = os.getenv("FIREBASE_STORAGE_BUCKET", "").strip()


def is_storage_enabled() -> bool:
    """Firebase Storage sozlangan va ishlaydimi?"""
    return bool(STORAGE_BUCKET) and firebase.is_enabled()


async def upload_telegram_photo(bot: Bot, file_id: str, product_id: int, index: int = 0) -> Optional[str]:
    """Telegram rasmni Firebase Storage'ga yuklaydi va doimiy URL qaytaradi.
    
    Args:
        bot: Aiogram Bot instance
        file_id: Telegram file_id
        product_id: Mahsulot ID (fayl nomi uchun)
        index: Rasm tartib raqami (0, 1, 2...)
    
    Returns:
        Firebase Storage URL yoki Telegram file_id (agar Storage o'chiq bo'lsa)
    """
    if not is_storage_enabled():
        logger.debug("Firebase Storage o'chiq — file_id qaytarilmoqda")
        return file_id
    
    try:
        # 1. Telegram'dan file path olish
        file_info = await bot.get_file(file_id)
        if not file_info or not file_info.file_path:
            logger.error(f"Telegram file info olinmadi: {file_id}")
            return file_id
        
        file_path = file_info.file_path
        
        # 2. Telegram file URL
        token = config.bot_token
        download_url = f"https://api.telegram.org/file/bot{token}/{file_path}"
        
        # 3. Faylni yuklab olish (timeout bilan)
        timeout = aiohttp.ClientTimeout(total=30)
        async with aiohttp.ClientSession(timeout=timeout) as session:
            async with session.get(download_url) as response:
                if response.status != 200:
                    logger.error(f"Telegram file yuklash xatosi: {response.status}")
                    return file_id
                
                file_data = await response.read()
                
                # Rasm hajmini tekshirish (max 10MB)
                if len(file_data) > 10 * 1024 * 1024:
                    logger.error(f"Rasm hajmi juda katta: {len(file_data)} bytes")
                    return file_id
        
        # 4. Firebase Storage'ga yuklash
        # Fayl nomi: products/{product_id}/image_{index}.jpg
        file_name = f"products/{product_id}/image_{index}.jpg"
        storage_url = await _upload_to_storage(file_data, file_name)
        
        if storage_url:
            logger.info(f"Rasm Firebase'ga yuklandi: {file_name}")
            return storage_url
        else:
            logger.error("Firebase Storage'ga yuklash xatosi — file_id qaytarilmoqda")
            return file_id
    
    except asyncio.TimeoutError:
        logger.error(f"Rasmni yuklashda timeout: {file_id}")
        return file_id
    except Exception as e:
        logger.error(f"Rasmni Firebase'ga yuklashda xato: {e}", exc_info=True)
        return file_id


async def _upload_to_storage(file_data: bytes, file_name: str) -> Optional[str]:
    """Firebase Storage REST API orqali faylni yuklaydi.
    
    Firebase Storage REST API:
    POST https://firebasestorage.googleapis.com/v0/b/{bucket}/o?name={path}
    
    Returns:
        Public download URL yoki None
    """
    if not STORAGE_BUCKET:
        return None
    
    token = firebase.token()
    if not token:
        logger.error("Firebase token yo'q — Storage'ga yuklab bo'lmaydi")
        return None
    
    try:
        # Storage API endpoint
        upload_url = (
            f"https://firebasestorage.googleapis.com/v0/b/{STORAGE_BUCKET}/o"
            f"?name={file_name}&access_token={token}"
        )
        
        headers = {
            "Content-Type": "image/jpeg",
        }
        
        async with aiohttp.ClientSession() as session:
            async with session.post(upload_url, data=file_data, headers=headers) as response:
                if response.status not in (200, 201):
                    error_text = await response.text()
                    logger.error(f"Storage upload xatosi {response.status}: {error_text[:200]}")
                    return None
                
                result = await response.json()
                
                # Public URL yaratish
                # Format: https://firebasestorage.googleapis.com/v0/b/{bucket}/o/{path}?alt=media
                encoded_name = result.get("name", file_name)
                public_url = (
                    f"https://firebasestorage.googleapis.com/v0/b/{STORAGE_BUCKET}/o/"
                    f"{encoded_name.replace('/', '%2F')}?alt=media"
                )
                
                return public_url
    
    except Exception as e:
        logger.error(f"Firebase Storage upload xatosi: {e}")
        return None


async def delete_product_images(product_id: int) -> bool:
    """Mahsulotning barcha rasmlarini Firebase Storage'dan o'chiradi.
    
    Args:
        product_id: Mahsulot ID
    
    Returns:
        True agar muvaffaqiyatli bo'lsa
    """
    if not is_storage_enabled():
        return False
    
    token = firebase.token()
    if not token:
        return False
    
    try:
        # products/{product_id}/ papkasidagi barcha fayllarni o'chirish
        folder_path = f"products/{product_id}/"
        
        # List files
        list_url = (
            f"https://firebasestorage.googleapis.com/v0/b/{STORAGE_BUCKET}/o"
            f"?prefix={folder_path}&access_token={token}"
        )
        
        async with aiohttp.ClientSession() as session:
            async with session.get(list_url) as response:
                if response.status != 200:
                    return False
                
                data = await response.json()
                items = data.get("items", [])
                
                # Har bir faylni o'chirish
                for item in items:
                    file_name = item.get("name")
                    if file_name:
                        delete_url = (
                            f"https://firebasestorage.googleapis.com/v0/b/{STORAGE_BUCKET}/o/"
                            f"{file_name.replace('/', '%2F')}?access_token={token}"
                        )
                        await session.delete(delete_url)
                
                logger.info(f"Mahsulot {product_id} rasmlari o'chirildi ({len(items)} ta)")
                return True
    
    except Exception as e:
        logger.error(f"Rasmlarni o'chirishda xato: {e}")
        return False
