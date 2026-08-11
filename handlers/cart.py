"""Savatcha va buyurtma berish (checkout)."""

from aiogram import Bot, F, Router
from aiogram.filters import Command
from aiogram.fsm.context import FSMContext
from aiogram.types import (
    CallbackQuery,
    InlineKeyboardMarkup,
    KeyboardButton,
    Message,
    ReplyKeyboardMarkup,
)

from database import queries as q
from keyboards.inline import admin_new_order_kb, cart_kb, checkout_confirm_kb
from keyboards.reply import cancel_kb, main_menu
from states import Checkout
from utils.helpers import fmt_price, normalize_phone, user_link
from utils.texts import BTN_CANCEL, BTN_CART, BTN_PHONE
from utils.ui import edit_or_send, notify_admins

router = Router(name="cart")

EMPTY_CART = (
    "🧺 Savatchangiz bo'sh.\n\n«🛍 Do'kon» bo'limidan mahsulot tanlashingiz mumkin."
)


def _item_line(item) -> str:
    """Buyurtma tarkibidagi bitta qator."""
    total = int(item["price"]) * int(item["qty"])
    return f"• {item['name']} × {item['qty']} = {fmt_price(total)}"


async def render_cart(user_id: int) -> tuple[str, InlineKeyboardMarkup]:
    items = await q.get_cart(user_id)
    if not items:
        return EMPTY_CART, cart_kb([])

    lines = ["🧺 <b>Savatchangiz</b>\n"]
    for index, item in enumerate(items, start=1):
        lines.append(
            f"{index}. <b>{item['name']}</b>\n"
            f"    {fmt_price(item['price'])} × {item['qty']} = "
            f"<b>{fmt_price(item['subtotal'])}</b>"
        )
    total = sum(int(item["subtotal"]) for item in items)
    lines.append(f"\n💰 <b>Jami: {fmt_price(total)}</b>")
    return "\n".join(lines), cart_kb(items)


@router.message(F.text == BTN_CART)
@router.message(Command("savatcha"))
async def show_cart_message(message: Message, state: FSMContext) -> None:
    await state.clear()
    text, keyboard = await render_cart(message.from_user.id)
    await message.answer(text, reply_markup=keyboard)


@router.callback_query(F.data == "cart:show")
async def show_cart_callback(callback: CallbackQuery) -> None:
    text, keyboard = await render_cart(callback.from_user.id)
    await edit_or_send(callback.message, text, keyboard)
    await callback.answer()


@router.callback_query(F.data.startswith("cart:plus:"))
async def cart_plus(callback: CallbackQuery) -> None:
    product_id = int(callback.data.split(":")[2])
    product = await q.get_product(product_id)
    items = await q.get_cart(callback.from_user.id)
    current = next((item["qty"] for item in items if item["product_id"] == product_id), 0)
    if product and current + 1 > int(product["stock"]):
        await callback.answer(f"Omborda {product['stock']} dona bor", show_alert=True)
        return
    await q.change_cart_qty(callback.from_user.id, product_id, 1)
    await _refresh_cart(callback)


@router.callback_query(F.data.startswith("cart:minus:"))
async def cart_minus(callback: CallbackQuery) -> None:
    product_id = int(callback.data.split(":")[2])
    await q.change_cart_qty(callback.from_user.id, product_id, -1)
    await _refresh_cart(callback)


@router.callback_query(F.data.startswith("cart:del:"))
async def cart_delete(callback: CallbackQuery) -> None:
    product_id = int(callback.data.split(":")[2])
    await q.remove_from_cart(callback.from_user.id, product_id)
    await _refresh_cart(callback, "O'chirildi")


@router.callback_query(F.data == "cart:clear")
async def cart_clear(callback: CallbackQuery) -> None:
    await q.clear_cart(callback.from_user.id)
    await _refresh_cart(callback, "Savatcha bo'shatildi")


async def _refresh_cart(callback: CallbackQuery, alert: str | None = None) -> None:
    text, keyboard = await render_cart(callback.from_user.id)
    await edit_or_send(callback.message, text, keyboard)
    await callback.answer(alert or "")


# ------------------------------------------------------------------- checkout


@router.callback_query(F.data == "cart:checkout")
async def checkout_start(callback: CallbackQuery, state: FSMContext) -> None:
    items = await q.get_cart(callback.from_user.id)
    if not items:
        await callback.answer("Savatchangiz bo'sh", show_alert=True)
        return

    problems = [item for item in items if int(item["qty"]) > int(item["stock"])]
    if problems:
        names = ", ".join(item["name"] for item in problems)
        await callback.answer(
            f"Omborda yetarli emas: {names}. Sonini kamaytiring.", show_alert=True
        )
        return

    await state.set_state(Checkout.address)
    await callback.message.answer(
        "🚚 <b>Buyurtma berish</b>\n\n"
        "1/2. Yetkazib berish <b>manzilini</b> yozing.\n"
        "Masalan: <i>Toshkent, Chilonzor 9-kvartal, 25-uy</i>",
        reply_markup=cancel_kb(),
    )
    await callback.answer()


@router.message(Checkout.address, F.text)
async def checkout_address(message: Message, state: FSMContext) -> None:
    address = message.text.strip()
    if address == BTN_CANCEL:
        await state.clear()
        await message.answer("❌ Bekor qilindi.", reply_markup=main_menu(message.from_user.id))
        return
    if len(address) < 5:
        await message.answer("Manzil juda qisqa. Iltimos, to'liqroq yozing.")
        return

    await state.update_data(address=address)
    user = await q.get_user(message.from_user.id)
    rows = []
    if user and user["phone"]:
        rows.append([KeyboardButton(text=user["phone"])])
    rows.append([KeyboardButton(text=BTN_PHONE, request_contact=True)])
    rows.append([KeyboardButton(text=BTN_CANCEL)])

    await state.set_state(Checkout.phone)
    await message.answer(
        "2/2. Aloqa uchun <b>telefon raqamingizni</b> yuboring.",
        reply_markup=ReplyKeyboardMarkup(keyboard=rows, resize_keyboard=True),
    )


@router.message(Checkout.phone, F.contact)
async def checkout_phone_contact(message: Message, state: FSMContext) -> None:
    await _checkout_summary(message, state, message.contact.phone_number)


@router.message(Checkout.phone, F.text)
async def checkout_phone_text(message: Message, state: FSMContext) -> None:
    if message.text.strip() == BTN_CANCEL:
        await state.clear()
        await message.answer("❌ Bekor qilindi.", reply_markup=main_menu(message.from_user.id))
        return
    phone = normalize_phone(message.text)
    if not phone:
        await message.answer("Raqam noto'g'ri. Masalan: <b>+998901234567</b>")
        return
    await _checkout_summary(message, state, phone)


async def _checkout_summary(message: Message, state: FSMContext, raw_phone: str) -> None:
    phone = normalize_phone(raw_phone) or raw_phone
    data = await state.get_data()
    items = await q.get_cart(message.from_user.id)
    if not items:
        await state.clear()
        await message.answer(EMPTY_CART, reply_markup=main_menu(message.from_user.id))
        return

    await state.update_data(phone=phone)
    await state.set_state(Checkout.confirm)

    lines = ["🧾 <b>Buyurtmani tekshiring</b>\n"]
    for index, item in enumerate(items, start=1):
        lines.append(
            f"{index}. {item['name']} × {item['qty']} = {fmt_price(item['subtotal'])}"
        )
    total = sum(int(item["subtotal"]) for item in items)
    lines.append(f"\n💰 <b>Jami: {fmt_price(total)}</b>")
    lines.append(f"📍 Manzil: {data.get('address')}")
    lines.append(f"📞 Telefon: {phone}")

    await message.answer("Rahmat!", reply_markup=main_menu(message.from_user.id))
    await message.answer("\n".join(lines), reply_markup=checkout_confirm_kb())


@router.callback_query(Checkout.confirm, F.data == "order:confirm")
async def order_confirm(callback: CallbackQuery, state: FSMContext, bot: Bot) -> None:
    data = await state.get_data()
    address, phone = data.get("address", "-"), data.get("phone", "-")
    order_id = await q.create_order(callback.from_user.id, address, phone)
    await state.clear()

    if not order_id:
        await edit_or_send(callback.message, EMPTY_CART)
        await callback.answer()
        return

    items = await q.get_order_items(order_id)
    order = await q.get_order(order_id)

    lines = [
        "✅ <b>Buyurtmangiz qabul qilindi!</b>\n",
        f"🆔 Buyurtma raqami: <b>#{order_id}</b>",
    ]
    lines.extend(_item_line(item) for item in items)
    lines.append(f"\n💰 Jami: <b>{fmt_price(order['total'])}</b>")
    lines.append(f"📍 Manzil: {address}")
    lines.append(f"📞 Telefon: {phone}\n")
    lines.append("Operator tez orada siz bilan bog'lanadi. Xaridingiz uchun rahmat! 🎉")
    await edit_or_send(callback.message, "\n".join(lines))
    await callback.answer("Buyurtma yuborildi ✅")

    admin_lines = [
        "🔔 <b>Yangi buyurtma</b>\n",
        f"🆔 #{order_id}",
        f"👤 {user_link(order['full_name'], order['username'], order['user_id'])}",
        f"📞 {phone}",
        f"📍 {address}\n",
    ]
    admin_lines.extend(_item_line(item) for item in items)
    admin_lines.append(f"\n💰 Jami: <b>{fmt_price(order['total'])}</b>")
    await notify_admins(bot, "\n".join(admin_lines), admin_new_order_kb(order_id))


@router.callback_query(F.data == "order:cancel")
async def order_cancel(callback: CallbackQuery, state: FSMContext) -> None:
    await state.clear()
    await edit_or_send(
        callback.message,
        "❌ Buyurtma bekor qilindi. Savatchangiz saqlanib qoldi.",
    )
    await callback.answer()
