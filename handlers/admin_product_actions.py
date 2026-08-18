"""Admin product card actions — inline keyboard callback handlers.

Avto_A1 style product card'larining callback handlerlar:
- product_stock - ombor miqdorini yangilash
- product_toggle - faollashtirish/o'chirish
- product_edit - tahrirlash
- product_delete - o'chirish
- product_approve - qoralamani tasdiqlash
"""

import logging
from aiogram import Router, F, Bot
from aiogram.types import CallbackQuery, Message
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup

from config import is_admin
from services import firebase_products as fb_prod
from utils import product_card

logger = logging.getLogger(__name__)
router = Router()


class ProductStockEdit(StatesGroup):
    """Ombor miqdorini yangilash holati."""
    waiting_quantity = State()


@router.callback_query(F.data.startswith("product_stock:"), F.from_user.id.func(is_admin))
async def product_stock_callback(callback: CallbackQuery, state: FSMContext):
    """Ombor miqdorini yangilash dialogini boshlaydi."""
    product_id = int(callback.data.split(":")[1])
    
    product = await fb_prod.get_product(product_id)
    if not product:
        await callback.answer("❌ Mahsulot topilmadi", show_alert=True)
        return
    
    await state.set_state(ProductStockEdit.waiting_quantity)
    await state.update_data(product_id=product_id, callback_message_id=callback.message.message_id)
    
    await callback.message.answer(
        f"📦 <b>{product.get('name')}</b>\n\n"
        f"Hozirgi ombor: <b>{product.get('stock', 0)} dona</b>\n\n"
        f"Yangi miqdorni yuboring (raqam):\n\n"
        f"<i>/cancel — bekor qilish</i>",
        parse_mode="HTML"
    )
    await callback.answer()


@router.message(ProductStockEdit.waiting_quantity, F.from_user.id.func(is_admin))
async def process_stock_update(message: Message, state: FSMContext, bot: Bot):
    """Yangi ombor miqdorini qabul qiladi va yangilaydi."""
    try:
        quantity = int(message.text.strip())
        if quantity < 0:
            await message.answer("❌ Miqdor manfiy bo'lishi mumkin emas")
            return
    except ValueError:
        await message.answer("❌ Faqat raqam kiriting")
        return
    
    data = await state.get_data()
    product_id = data.get("product_id")
    
    if not product_id:
        await message.answer("❌ Xatolik yuz berdi")
        await state.clear()
        return
    
    success = await fb_prod.update_stock(product_id, quantity)
    
    if success:
        # Yangilangan product card ko'rsatish
        updated_product = await fb_prod.get_product(product_id)
        if updated_product:
            await product_card.send_product_card(
                bot=bot,
                chat_id=message.chat.id,
                product=updated_product,
                admin_view=True,
                show_purchase=False,
            )
        
        await message.answer(
            f"✅ <b>Ombor yangilandi</b>\n\n"
            f"Yangi miqdor: <b>{quantity} dona</b>",
            parse_mode="HTML"
        )
    else:
        await message.answer("❌ Yangilash amalga oshmadi")
    
    await state.clear()


@router.callback_query(F.data.startswith("product_toggle:"), F.from_user.id.func(is_admin))
async def product_toggle_callback(callback: CallbackQuery, bot: Bot):
    """Mahsulotni faollashtirish/o'chirish."""
    product_id = int(callback.data.split(":")[1])
    
    product = await fb_prod.get_product(product_id)
    if not product:
        await callback.answer("❌ Mahsulot topilmadi", show_alert=True)
        return
    
    success = await fb_prod.toggle_product(product_id)
    
    if success:
        # Yangilangan product card ko'rsatish
        updated_product = await fb_prod.get_product(product_id)
        if updated_product:
            try:
                await product_card.edit_product_card(
                    bot=bot,
                    chat_id=callback.message.chat.id,
                    message_id=callback.message.message_id,
                    product=updated_product,
                    admin_view=True,
                    show_purchase=False,
                )
            except Exception:
                # Agar edit bo'lmasa, yangi card yuborish
                await product_card.send_product_card(
                    bot=bot,
                    chat_id=callback.message.chat.id,
                    product=updated_product,
                    admin_view=True,
                    show_purchase=False,
                )
        
        new_state = not product.get("is_active", True)
        status = "faollashtirildi ✅" if new_state else "o'chirildi ⏸"
        await callback.answer(f"Mahsulot {status}", show_alert=False)
    else:
        await callback.answer("❌ O'zgartirish amalga oshmadi", show_alert=True)


@router.callback_query(F.data.startswith("product_delete:"), F.from_user.id.func(is_admin))
async def product_delete_callback(callback: CallbackQuery):
    """Mahsulotni o'chirish (tasdiq so'raydi)."""
    product_id = int(callback.data.split(":")[1])
    
    product = await fb_prod.get_product(product_id)
    if not product:
        await callback.answer("❌ Mahsulot topilmadi", show_alert=True)
        return
    
    # Tasdiq tugmalari
    from aiogram.types import InlineKeyboardMarkup, InlineKeyboardButton
    
    keyboard = InlineKeyboardMarkup(inline_keyboard=[
        [
            InlineKeyboardButton(
                text="✅ Ha, o'chirish",
                callback_data=f"product_delete_confirm:{product_id}"
            ),
            InlineKeyboardButton(
                text="❌ Yo'q",
                callback_data="product_delete_cancel"
            ),
        ]
    ])
    
    await callback.message.answer(
        f"⚠️ <b>Mahsulotni o'chirish</b>\n\n"
        f"<b>{product.get('name')}</b>\n"
        f"ID: <code>{product_id}</code>\n\n"
        f"Ushbu mahsulot butunlay o'chiriladi. Davom etasizmi?",
        parse_mode="HTML",
        reply_markup=keyboard
    )
    await callback.answer()


@router.callback_query(F.data.startswith("product_delete_confirm:"), F.from_user.id.func(is_admin))
async def product_delete_confirm_callback(callback: CallbackQuery):
    """Mahsulotni o'chirishni tasdiqlaydi."""
    product_id = int(callback.data.split(":")[1])
    
    product = await fb_prod.get_product(product_id)
    if not product:
        await callback.answer("❌ Mahsulot allaqachon o'chirilgan", show_alert=True)
        await callback.message.delete()
        return
    
    success = await fb_prod.delete_product(product_id)
    
    if success:
        await callback.message.edit_text(
            f"🗑 <b>Mahsulot o'chirildi</b>\n\n"
            f"{product.get('name')}\n"
            f"ID: {product_id}",
            parse_mode="HTML"
        )
        await callback.answer("✅ O'chirildi")
    else:
        await callback.answer("❌ O'chirishda xatolik", show_alert=True)


@router.callback_query(F.data == "product_delete_cancel", F.from_user.id.func(is_admin))
async def product_delete_cancel_callback(callback: CallbackQuery):
    """Mahsulotni o'chirishni bekor qiladi."""
    await callback.message.delete()
    await callback.answer("❌ Bekor qilindi")


@router.callback_query(F.data.startswith("product_approve:"), F.from_user.id.func(is_admin))
async def product_approve_callback(callback: CallbackQuery, bot: Bot):
    """Qoralama mahsulotni tasdiqlaydi (draft → live)."""
    product_id = int(callback.data.split(":")[1])
    
    product = await fb_prod.get_product(product_id)
    if not product:
        await callback.answer("❌ Mahsulot topilmadi", show_alert=True)
        return
    
    if not product.get("is_draft"):
        await callback.answer("✅ Mahsulot allaqachon tasdiqlangan", show_alert=False)
        return
    
    success = await fb_prod.set_draft_status(product_id, is_draft=False)
    
    if success:
        # Yangilangan product card ko'rsatish
        updated_product = await fb_prod.get_product(product_id)
        if updated_product:
            try:
                await product_card.edit_product_card(
                    bot=bot,
                    chat_id=callback.message.chat.id,
                    message_id=callback.message.message_id,
                    product=updated_product,
                    admin_view=True,
                    show_purchase=False,
                )
            except Exception:
                await product_card.send_product_card(
                    bot=bot,
                    chat_id=callback.message.chat.id,
                    product=updated_product,
                    admin_view=True,
                    show_purchase=False,
                )
        
        await callback.answer("✅ Mahsulot tasdiqlandi va do'konda ko'rinadi", show_alert=False)
    else:
        await callback.answer("❌ Tasdiqlashda xatolik", show_alert=True)


@router.callback_query(F.data.startswith("product_edit:"), F.from_user.id.func(is_admin))
async def product_edit_callback(callback: CallbackQuery):
    """Mahsulotni tahrirlash (hozircha oddiy xabar)."""
    product_id = int(callback.data.split(":")[1])
    
    await callback.answer(
        f"📝 Mahsulot ID: {product_id}\n\n"
        f"Tahrirlash funktsiyasi keyinroq qo'shiladi.\n"
        f"Hozircha buyruqlardan foydalaning:\n"
        f"/update_stock {product_id} <miqdor>\n"
        f"/toggle_product {product_id}\n"
        f"/delete_product {product_id}",
        show_alert=True
    )


@router.callback_query(F.data == "shop_back")
async def shop_back_callback(callback: CallbackQuery):
    """Do'konga qaytish (umumiy handler)."""
    await callback.message.delete()
    await callback.answer()
