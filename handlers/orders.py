"""Foydalanuvchining buyurtmalar tarixi."""

from aiogram import F, Router
from aiogram.fsm.context import FSMContext
from aiogram.types import Message

from database import queries as q
from keyboards.reply import main_menu
from utils.helpers import fmt_price, html_escape
from utils.texts import BTN_ORDERS, ORDER_STATUS

router = Router(name="orders")


@router.message(F.text == BTN_ORDERS)
async def my_orders(message: Message, state: FSMContext) -> None:
    await state.clear()
    orders = await q.get_user_orders(message.from_user.id)
    if not orders:
        await message.answer(
            "📦 Sizda hozircha buyurtma yo'q.\n\n«🛍 Do'kon» bo'limidan xarid qilishingiz mumkin.",
            reply_markup=main_menu(message.from_user.id),
        )
        return

    lines = ["📦 <b>Mening buyurtmalarim</b>\n"]
    for order in orders:
        items = await q.get_order_items(order["id"])
        goods = ", ".join(
            f"{html_escape(item['name'])} ×{item['qty']}" for item in items
        )
        lines.append(
            f"🆔 <b>#{order['id']}</b> · {ORDER_STATUS.get(order['status'], order['status'])}\n"
            f"🛍 {goods}\n"
            f"💰 {fmt_price(order['total'])}\n"
            f"📅 {order['created_at']}\n"
        )
    await message.answer("\n".join(lines), reply_markup=main_menu(message.from_user.id))
