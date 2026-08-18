"""Product Card — Telegram'da mahsulot kartochkasini ko'rsatish (Avto_A1 style).

Bu modul Avto_A1'dagi product display logikasini Zimmer'ga moslashtiradi:
- Mahsulot ma'lumotlarini HTML formatda tayyorlash
- Inline keyboard (Sotib olish, Ombor, O'chirish va h.k.)
- MediaGroup bilan ko'p rasmlarni yuborish
- Qora/qizil ranglar (Zimmer brend identiteti)
"""

import html
import logging
from typing import Optional

from aiogram import Bot
from aiogram.types import (
    InlineKeyboardMarkup,
    InlineKeyboardButton,
    InputMediaPhoto,
    Message,
)

from config import config

logger = logging.getLogger(__name__)


def esc(text: any) -> str:
    """HTML maxsus belgilaridan qochish (xavfsizlik)."""
    return html.escape(str(text if text is not None else ""))


def format_price(price: int | float) -> str:
    """Narxni formatlash: 1500000 -> 1 500 000 so'm"""
    try:
        value = int(float(price))
        return f"{value:,}".replace(",", " ") + " " + config.currency
    except (TypeError, ValueError):
        return "0 " + config.currency


def product_caption(product: dict, admin_view: bool = False) -> str:
    """Mahsulot kartochkasi uchun HTML caption yaratadi.
    
    Args:
        product: Mahsulot dict (Firebase'dan)
        admin_view: Admin ko'rinishi (ID, stock va h.k. ko'rsatiladi)
    
    Returns:
        HTML formatlangan caption
    """
    lines = []
    
    # 🎨 Zimmer brend: qora/qizil rangda title
    name = esc(product.get("name", "No name"))
    lines.append(f"<b>🔴 {name}</b>\n")
    
    # Narx (agar eski narx bo'lsa — chegirma)
    price = product.get("price", 0)
    old_price = product.get("old_price")
    
    if old_price and old_price > price:
        lines.append(f"<s>{format_price(old_price)}</s>")
        lines.append(f"<b>💰 {format_price(price)}</b> ✨ Chegirma!\n")
    else:
        lines.append(f"<b>💰 {format_price(price)}</b>\n")
    
    # Badge (TOP tanlov, Yangi va h.k.)
    badge = product.get("badge")
    if badge:
        lines.append(f"<i>🏷 {esc(badge)}</i>\n")
    
    # Tavsif
    description = product.get("description")
    if description:
        desc_text = esc(description)[:300]
        if len(str(description)) > 300:
            desc_text += "..."
        lines.append(f"\n{desc_text}\n")
    
    # Mahsulot kodi
    code = product.get("code")
    if code:
        lines.append(f"\n📦 Kod: <code>{esc(code)}</code>")
    
    # Brend va model
    brand = product.get("brand")
    model = product.get("model")
    if brand or model:
        parts = []
        if brand:
            parts.append(f"Brend: {esc(brand)}")
        if model:
            parts.append(f"Model: {esc(model)}")
        lines.append(" | ".join(parts))
    
    # Admin view: ID, stock, status
    if admin_view:
        lines.append(f"\n<i>━━━━━━━━━━━━━━━</i>")
        lines.append(f"\n<code>ID: {product.get('id')}</code>")
        
        stock = product.get("stock", 0)
        stock_emoji = "✅" if stock > 0 else "❌"
        lines.append(f"{stock_emoji} Ombor: <b>{stock} {product.get('unit', 'dona')}</b>")
        
        is_active = product.get("is_active", True)
        status = "✅ Faol" if is_active else "⏸ O'chirilgan"
        lines.append(f"Holat: {status}")
        
        is_draft = product.get("is_draft", False)
        if is_draft:
            lines.append("<b>📝 Qoralama</b>")
    else:
        # Mijoz ko'rinishi: faqat stock mavjudligi
        stock = product.get("stock", 0)
        if stock > 0:
            lines.append(f"\n✅ <i>Omborda mavjud</i>")
        else:
            lines.append(f"\n⏳ <i>Buyurtma asosida</i>")
    
    return "\n".join(lines)


def product_keyboard(
    product: dict,
    admin_view: bool = False,
    show_purchase: bool = True,
) -> InlineKeyboardMarkup:
    """Mahsulot kartochkasi uchun inline keyboard.
    
    Args:
        product: Mahsulot dict
        admin_view: Admin tugmalari (tahrirlash, o'chirish)
        show_purchase: "Sotib olish" tugmasini ko'rsatish
    
    Returns:
        InlineKeyboardMarkup
    """
    product_id = product.get("id")
    buttons = []
    
    if admin_view:
        # Admin tugmalari
        row1 = []
        row2 = []
        
        # Ombor miqdorini yangilash
        row1.append(InlineKeyboardButton(
            text=f"📦 Ombor: {product.get('stock', 0)}",
            callback_data=f"product_stock:{product_id}"
        ))
        
        # Faollashtirish/o'chirish
        is_active = product.get("is_active", True)
        toggle_text = "⏸ O'chirish" if is_active else "✅ Yoqish"
        row1.append(InlineKeyboardButton(
            text=toggle_text,
            callback_data=f"product_toggle:{product_id}"
        ))
        
        # Tahrirlash
        row2.append(InlineKeyboardButton(
            text="✏️ Tahrirlash",
            callback_data=f"product_edit:{product_id}"
        ))
        
        # O'chirish
        row2.append(InlineKeyboardButton(
            text="🗑 O'chirish",
            callback_data=f"product_delete:{product_id}"
        ))
        
        buttons.append(row1)
        buttons.append(row2)
        
        # Qoralamani tasdiqlash
        if product.get("is_draft"):
            buttons.append([InlineKeyboardButton(
                text="✅ Tasdiqlash (draft → live)",
                callback_data=f"product_approve:{product_id}"
            )])
    else:
        # Mijoz tugmalari
        if show_purchase and product.get("is_active", True):
            # Savatga qo'shish
            buttons.append([InlineKeyboardButton(
                text="🛒 Savatga qo'shish",
                callback_data=f"cart_add:{product_id}"
            )])
    
    # Do'konga qaytish
    buttons.append([InlineKeyboardButton(
        text="◀️ Orqaga",
        callback_data="shop_back"
    )])
    
    return InlineKeyboardMarkup(inline_keyboard=buttons)


async def send_product_card(
    bot: Bot,
    chat_id: int,
    product: dict,
    admin_view: bool = False,
    show_purchase: bool = True,
) -> Optional[Message]:
    """Mahsulot kartochkasini yuboradi (rasm yoki MediaGroup bilan).
    
    Args:
        bot: Bot instance
        chat_id: Chat ID
        product: Mahsulot dict
        admin_view: Admin ko'rinishi
        show_purchase: Sotib olish tugmasini ko'rsatish
    
    Returns:
        Yuborilgan Message yoki None
    """
    caption = product_caption(product, admin_view=admin_view)
    keyboard = product_keyboard(product, admin_view=admin_view, show_purchase=show_purchase)
    
    images = product.get("images", [])
    
    try:
        if not images:
            # Rasmlar yo'q — faqat matn
            return await bot.send_message(
                chat_id=chat_id,
                text=caption,
                parse_mode="HTML",
                reply_markup=keyboard,
            )
        
        elif len(images) == 1:
            # Bitta rasm
            return await bot.send_photo(
                chat_id=chat_id,
                photo=images[0],
                caption=caption,
                parse_mode="HTML",
                reply_markup=keyboard,
            )
        
        else:
            # Ko'p rasmlar — MediaGroup (album)
            media_group = []
            for i, image_url in enumerate(images[:10]):  # Max 10 ta
                media = InputMediaPhoto(
                    media=image_url,
                    caption=caption if i == 0 else None,
                    parse_mode="HTML" if i == 0 else None,
                )
                media_group.append(media)
            
            # MediaGroup yuborish
            messages = await bot.send_media_group(
                chat_id=chat_id,
                media=media_group,
            )
            
            # Keyboardni alohida yuborish (MediaGroup keyboard qo'llab-quvvatlamaydi)
            await bot.send_message(
                chat_id=chat_id,
                text="👆 Tugmalardan foydalaning:",
                reply_markup=keyboard,
            )
            
            return messages[0] if messages else None
    
    except Exception as e:
        logger.error(f"Product card yuborishda xato: {e}", exc_info=True)
        return None


async def edit_product_card(
    bot: Bot,
    chat_id: int,
    message_id: int,
    product: dict,
    admin_view: bool = False,
    show_purchase: bool = True,
) -> bool:
    """Mavjud product card'ni yangilaydi (faqat caption va keyboard).
    
    MediaGroup'ni edit qilib bo'lmaydi, shuning uchun faqat bitta rasm
    yoki matnli xabarlar uchun ishlaydi.
    
    Returns:
        True agar muvaffaqiyatli bo'lsa
    """
    caption = product_caption(product, admin_view=admin_view)
    keyboard = product_keyboard(product, admin_view=admin_view, show_purchase=show_purchase)
    
    try:
        images = product.get("images", [])
        
        if not images:
            # Matnli xabar
            await bot.edit_message_text(
                chat_id=chat_id,
                message_id=message_id,
                text=caption,
                parse_mode="HTML",
                reply_markup=keyboard,
            )
        else:
            # Rasm bilan
            await bot.edit_message_caption(
                chat_id=chat_id,
                message_id=message_id,
                caption=caption,
                parse_mode="HTML",
                reply_markup=keyboard,
            )
        
        return True
    
    except Exception as e:
        logger.error(f"Product card yangilashda xato: {e}")
        return False
