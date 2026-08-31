"""Firebase Storage — mahsulot rasmlarini saqlash va URL olish.

Avto_A1'dan nusxalangan: Telegram file_id'larni Firebase Storage'ga yuklash
va doimiy URL olish (link hech qachon eskirmaydi).

Agar Firebase Storage sozlanmagan bo'lsa, file_id telegram serverlarda qoladi
va to'g'ridan-to'g'ri ishlatiladi (vaqtinchalik link).
"""

import logging
import os
from urllib.parse import quote

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


async def upload_telegram_file(
    bot: Bot,
    file_id: str,
    storage_path: str,
    *,
    content_type: str = "image/jpeg",
    max_bytes: int = 20 * 1024 * 1024,
) -> str | None:
    """Telegram faylini Firebase Storage'ga ko'chiradi va DOIMIY URL qaytaradi.

    NEGA BU MUHIM
    Telegram `file_id` ni faqat bot tokeni bilan ochish mumkin, ya'ni uni
    ilovaga ko'rsatish uchun Render'dagi `/api/media/...` proksisi kerak.
    Render o'chsa — barcha rasm va videolar yo'qoladi. Firebase Storage
    URL'i esa to'g'ridan-to'g'ri brauzerda ochiladi, shuning uchun
    Mini App'ning zaxira rejimi ham normal ko'rinadi.

    Args:
        storage_path: Storage ichidagi yo'l, masalan "stories/12/photo.jpg"
        content_type: "image/jpeg" yoki "video/mp4"
        max_bytes: bundan katta fayl ko'chirilmaydi

    Returns:
        Firebase Storage URL, yoki muvaffaqiyatsizlikda `file_id` (chaqiruvchi
        eski usulda ishlashda davom etadi — hech narsa buzilmaydi).
    """
    if not is_storage_enabled():
        logger.debug("Firebase Storage o'chiq — file_id qaytarilmoqda")
        return file_id

    try:
        # 1. Telegram'dan file path olish
        file_info = await bot.get_file(file_id)
        if not file_info or not file_info.file_path:
            logger.error("Telegram file info olinmadi: %s", file_id)
            return file_id

        # 2. Faylni yuklab olish (timeout bilan)
        download_url = (
            f"https://api.telegram.org/file/bot{config.bot_token}/{file_info.file_path}"
        )
        # Umumiy sessiya (har chaqiruvda yangi ulanish yaratilmasin).
        # Vaqt chegarasi so'rov darajasida beriladi — umumiy sessiyaning
        # 15 soniyasi katta fayl uchun kam.
        session = await firebase.session()
        async with session.get(
            download_url, timeout=aiohttp.ClientTimeout(total=60)
        ) as response:
            if response.status != 200:
                logger.error("Telegram file yuklash xatosi: %s", response.status)
                return file_id
            data = await response.read()

        if len(data) > max_bytes:
            logger.error(
                "Fayl juda katta (%s bayt > %s) — Storage'ga ko'chirilmadi",
                len(data),
                max_bytes,
            )
            return file_id

        # 3. Firebase Storage'ga yuklash
        url = await _upload_to_storage(data, storage_path, content_type=content_type)
        if url:
            logger.info("Fayl Firebase Storage'ga ko'chirildi: %s", storage_path)
            return url

        logger.error("Firebase Storage'ga yuklanmadi (%s) — file_id qaytarilmoqda", storage_path)
        return file_id

    except TimeoutError:
        logger.error("Storage'ga ko'chirishda timeout: %s", file_id)
        return file_id
    except Exception as e:
        logger.error("Storage'ga ko'chirishda xato: %s", e, exc_info=True)
        return file_id


async def upload_telegram_photo(
    bot: Bot, file_id: str, product_id: int, index: int = 0
) -> str | None:
    """Mahsulot rasmi uchun qisqartma (eski nom — moslik uchun saqlangan)."""
    return await upload_telegram_file(
        bot,
        file_id,
        f"products/{product_id}/image_{index}.jpg",
        content_type="image/jpeg",
        max_bytes=10 * 1024 * 1024,
    )


async def _upload_to_storage(
    file_data: bytes, file_name: str, *, content_type: str = "image/jpeg"
) -> str | None:
    """Firebase Storage REST API orqali faylni yuklaydi.

    Firebase Storage REST API:
    POST https://firebasestorage.googleapis.com/v0/b/{bucket}/o?name={path}

    Returns:
        Public download URL yoki None
    """
    if not STORAGE_BUCKET:
        return None

    # `ensure_token()` — muddati o'tgan bo'lsa YANGILAYDI.
    # Ilgari `firebase.token()` chaqirilardi va u muddatni tekshirmasdi:
    # eskirgan token bilan har bir yuklash 401 qaytarardi va admin
    # "rasm yuklanmadi" degan tushunarsiz javob olardi.
    token = await firebase.ensure_token()
    if not token:
        logger.error("Firebase token yo'q — Storage'ga yuklab bo'lmaydi")
        return None

    try:
        # Storage API endpoint.
        # DIQQAT: token QUERY'da emas, SARLAVHADA yuboriladi. Query'dagi
        # token Google'ning kirish loglariga tushadi va xato matnlarida
        # ko'rinib qolishi mumkin.
        upload_url = (
            f"https://firebasestorage.googleapis.com/v0/b/{STORAGE_BUCKET}/o"
            f"?name={quote(file_name, safe='')}"
        )

        headers = {
            "Content-Type": content_type,
            "Authorization": f"Bearer {token}",
        }

        session = await firebase.session()
        async with session.post(
            upload_url,
            data=file_data,
            headers=headers,
            timeout=aiohttp.ClientTimeout(total=120),
        ) as response:
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
                f"{quote(str(encoded_name), safe='')}?alt=media"
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

    token = await firebase.ensure_token()
    if not token:
        return False

    try:
        # products/{product_id}/ papkasidagi barcha fayllarni o'chirish
        folder_path = f"products/{product_id}/"

        # List files
        list_url = (
            f"https://firebasestorage.googleapis.com/v0/b/{STORAGE_BUCKET}/o"
            f"?prefix={quote(folder_path, safe='')}"
        )
        headers = {"Authorization": f"Bearer {token}"}

        # DIQQAT: ilgari bu yerda `aiohttp.ClientSession()` TIMEOUT'SIZ
        # yaratilardi — Storage javob bermasa chaqiruv CHEKSIZ kutib
        # qolishi mumkin edi (bitta protsessda butun bot muzlaydi).
        session = await firebase.session()
        timeout = aiohttp.ClientTimeout(total=60)

        async with session.get(list_url, headers=headers, timeout=timeout) as response:
            if response.status != 200:
                return False
            data = await response.json()

        items = data.get("items", [])

        # Har bir faylni o'chirish
        for item in items:
            file_name = item.get("name")
            if not file_name:
                continue
            delete_url = (
                f"https://firebasestorage.googleapis.com/v0/b/{STORAGE_BUCKET}/o/"
                f"{quote(str(file_name), safe='')}"
            )
            async with session.delete(
                delete_url, headers=headers, timeout=timeout
            ) as del_response:
                if del_response.status not in (200, 204, 404):
                    logger.warning(
                        "Storage fayli o'chirilmadi (%s): %s", del_response.status, file_name
                    )

        logger.info("Mahsulot %s rasmlari o'chirildi (%s ta)", product_id, len(items))
        return True

    except Exception as e:
        logger.error(f"Rasmlarni o'chirishda xato: {e}")
        return False
