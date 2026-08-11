"""Do'kon: kategoriyalar, mahsulotlar, savatchaga qo'shish."""

from aiogram import F, Router
from aiogram.exceptions import TelegramBadRequest
from aiogram.filters import Command
from aiogram.fsm.context import FSMContext
from aiogram.types import CallbackQuery, Message

from database import queries as q
from keyboards.inline import categories_kb, product_kb, products_kb
from keyboards.reply import main_menu
from utils.helpers import fmt_price
from utils.texts import BTN_SHOP
from utils.ui import edit_or_send

router = Router(name="shop")

SHOP_TITLE = "🛍 <b>Do'kon</b>\n\nKategoriyani tanlang:"


@router.message(F.text == BTN_SHOP)
@router.message(Command("dokon"))
async def open_shop(message: Message, state: FSMContext) -> None:
    await state.clear()
    user = await q.get_user(message.from_user.id)
    if not user:
        await message.answer("Avval ro'yxatdan o'tishingiz kerak. /start buyrug'ini yuboring.")
        return

    categories = await q.get_categories()
    if not categories:
        await message.answer(
            "Hozircha mahsulotlar qo'shilmagan. Keyinroq urinib ko'ring.",
            reply_markup=main_menu(message.from_user.id),
        )
        return
    await message.answer(SHOP_TITLE, reply_markup=categories_kb(categories))


@router.callback_query(F.data == "back:cats")
async def back_to_categories(callback: CallbackQuery) -> None:
    categories = await q.get_categories()
    await edit_or_send(callback.message, SHOP_TITLE, categories_kb(categories))
    await callback.answer()


@router.callback_query(F.data.startswith("cat:"))
@router.callback_query(F.data.startswith("back:prods:"))
async def show_products(callback: CallbackQuery) -> None:
    category_id = int(callback.data.split(":")[-1])
    category = await q.get_category(category_id)
    if not category:
        await callback.answer("Kategoriya topilmadi", show_alert=True)
        return

    products = await q.get_products(category_id)
    if not products:
        await callback.answer("Bu kategoriyada hozircha mahsulot yo'q", show_alert=True)
        return

    await edit_or_send(
        callback.message,
        f"🗂 <b>{category['name']}</b>\n\nMahsulotni tanlang:",
        products_kb(products),
    )
    await callback.answer()


@router.callback_query(F.data.startswith("prod:"))
async def show_product(callback: CallbackQuery) -> None:
    product_id = int(callback.data.split(":")[1])
    product = await q.get_product(product_id)
    if not product:
        await callback.answer("Mahsulot topilmadi", show_alert=True)
        return

    stock = int(product["stock"])
    lines = [f"🛍 <b>{product['name']}</b>", ""]
    if product["description"]:
        lines.append(f"📝 {product['description']}")
    lines.append(f"💰 Narx: <b>{fmt_price(product['price'])}</b>")
    lines.append(f"📦 Mavjud: {stock} dona" if stock > 0 else "❌ Vaqtincha mavjud emas")
    text = "\n".join(lines)
    keyboard = product_kb(product_id, int(product["category_id"]), in_stock=stock > 0)

    if product["photo_id"]:
        try:
            await callback.message.delete()
        except TelegramBadRequest:
            pass
        await callback.message.answer_photo(
            product["photo_id"], caption=text, reply_markup=keyboard
        )
    else:
        await edit_or_send(callback.message, text, keyboard)
    await callback.answer()


@router.callback_query(F.data.startswith("add:"))
async def add_to_cart(callback: CallbackQuery) -> None:
    product_id = int(callback.data.split(":")[1])
    product = await q.get_product(product_id)
    if not product or not product["is_active"]:
        await callback.answer("Mahsulot topilmadi", show_alert=True)
        return

    cart = await q.get_cart(callback.from_user.id)
    current = next((item["qty"] for item in cart if item["product_id"] == product_id), 0)
    if current + 1 > int(product["stock"]):
        await callback.answer(
            f"Omborda faqat {product['stock']} dona qoldi", show_alert=True
        )
        return

    await q.add_to_cart(callback.from_user.id, product_id)
    await callback.answer(f"✅ «{product['name']}» savatchaga qo'shildi", show_alert=False)


@router.callback_query(F.data == "noop")
async def noop(callback: CallbackQuery) -> None:
    await callback.answer()
