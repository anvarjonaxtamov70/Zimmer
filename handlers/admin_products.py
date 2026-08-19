"""Admin mahsulot boshqaruvi — Firebase + multi-image upload.

Bu handler mahsulotlarni Firebase'da boshqaradi:
- Yangi mahsulot qo'shish (dialog orqali)
- Mahsulotga ko'p rasmlar yuklash (Telegram MediaGroup)
- Mahsulot tahrirlash
- O'chirish/faollashtirish
- Product Card display (Avto_A1 style)
"""

import logging
from aiogram import Router, F, Bot
from aiogram.types import Message, CallbackQuery
from aiogram.filters import Command
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup

from config import is_admin
from services import firebase_products as fb_prod
from services import firebase_storage as fb_storage
from utils import product_card

logger = logging.getLogger(__name__)
router = Router()


class AddProductStates(StatesGroup):
    """Yangi mahsulot qo'shish dialog holatlari."""
    name = State()
    price = State()
    stock = State()
    description = State()
    images = State()
    confirm = State()


class EditProductStates(StatesGroup):
    """Mahsulot tahrirlash holatlari."""
    select_field = State()
    edit_value = State()


# Vaqtinchalik saqlash uchun (FSM data'ga sig'maydiganlari)
_temp_product_data = {}


# ============================================================================
# CALLBACK HANDLERS: Admin Menu Tugmalari
# ============================================================================

@router.callback_query(F.data == "adm:add_product")
async def callback_add_product(callback: CallbackQuery, state: FSMContext):
    """Admin menu'dan 'Mahsulot qo'shish' tugmasi bosilganda."""
    await callback.answer()
    await state.set_state(AddProductStates.name)
    await callback.message.answer(
        "📦 <b>Yangi mahsulot qo'shish</b>\n\n"
        "Mahsulot nomini yuboring:"
    )


@router.callback_query(F.data == "adm:products_list")
async def callback_products_list(callback: CallbackQuery):
    """Admin menu'dan 'Mahsulotlar' tugmasi bosilganda."""
    await callback.answer()
    await show_products_list(callback.message)


@router.callback_query(F.data == "adm:products_drafts")
async def callback_products_drafts(callback: CallbackQuery):
    """Admin menu'dan 'Qoralamalar' tugmasi bosilganda."""
    await callback.answer()
    products = await fb_prod.get_all_products(is_draft=True)
    if not products:
        await callback.message.answer("📋 Qoralama mahsulotlar yo'q.")
        return
    
    text = f"📋 <b>Qoralama mahsulotlar ({len(products)} ta)</b>\n\n"
    for p in products[:10]:
        text += f"• ID {p['id']}: {p['name']}\n"
    
    await callback.message.answer(text)


@router.callback_query(F.data == "adm:import_products")
async def callback_import_products(callback: CallbackQuery):
    """Admin menu'dan 'Import' tugmasi bosilganda."""
    await callback.answer()
    await callback.message.answer(
        "📥 <b>Excel/CSV Import</b>\n\n"
        "Excel (.xlsx) yoki CSV faylni yuboring.\n"
        "Fayl quyidagi ustunlarni o'z ichiga olishi kerak:\n"
        "- name/nomi (majburiy)\n"
        "- price/narx (majburiy)\n"
        "- stock/ombor (ixtiyoriy)\n"
        "- description/tavsif (ixtiyoriy)\n"
        "- code/kod (ixtiyoriy)\n"
        "- brand/brend (ixtiyoriy)"
    )


# ============================================================================
# COMMAND HANDLERS
# ============================================================================

@router.message(Command("add_product"), F.from_user.id.func(is_admin))
async def start_add_product(message: Message, state: FSMContext):
    """Yangi mahsulot qo'shish dialogini boshlaydi."""
    await state.set_state(AddProductStates.name)
    await message.answer(
        "📦 <b>Yangi mahsulot qo'shish</b>\n\n"
        "1️⃣ Mahsulot nomini yuboring:\n\n"
        "<i>Bekor qilish uchun /cancel</i>",
        parse_mode="HTML"
    )


@router.message(AddProductStates.name, F.from_user.id.func(is_admin))
async def process_product_name(message: Message, state: FSMContext):
    """Mahsulot nomini qabul qiladi."""
    name = message.text.strip()
    
    if len(name) < 2:
        await message.answer("❌ Nom juda qisqa. Qayta kiriting:")
        return
    
    await state.update_data(name=name)
    await state.set_state(AddProductStates.price)
    
    await message.answer(
        f"✅ Nom: <b>{name}</b>\n\n"
        f"2️⃣ Narxni yuboring (so'mda, faqat son):\n\n"
        f"<i>Masalan: 150000</i>",
        parse_mode="HTML"
    )


@router.message(AddProductStates.price, F.from_user.id.func(is_admin))
async def process_product_price(message: Message, state: FSMContext):
    """Mahsulot narxini qabul qiladi."""
    try:
        price = int(message.text.strip().replace(" ", "").replace(",", ""))
        if price <= 0:
            raise ValueError()
    except ValueError:
        await message.answer("❌ Noto'g'ri narx. Faqat musbat son kiriting:")
        return
    
    await state.update_data(price=price)
    await state.set_state(AddProductStates.stock)
    
    await message.answer(
        f"✅ Narx: <b>{price:,} so'm</b>\n\n"
        f"3️⃣ Ombordagi miqdorni yuboring:\n\n"
        f"<i>O'tkazib yuborish uchun 0 yuboring yoki /skip</i>",
        parse_mode="HTML"
    )


@router.message(AddProductStates.stock, F.from_user.id.func(is_admin))
async def process_product_stock(message: Message, state: FSMContext):
    """Mahsulot ombor miqdorini qabul qiladi."""
    text = message.text.strip()
    
    if text == "/skip":
        stock = 0
    else:
        try:
            stock = int(text.replace(" ", "").replace(",", ""))
            if stock < 0:
                raise ValueError()
        except ValueError:
            await message.answer("❌ Noto'g'ri son. Qayta kiriting yoki /skip:")
            return
    
    await state.update_data(stock=stock)
    await state.set_state(AddProductStates.description)
    
    await message.answer(
        f"✅ Ombor: <b>{stock} dona</b>\n\n"
        f"4️⃣ Mahsulot tavsifini yuboring:\n\n"
        f"<i>O'tkazib yuborish uchun /skip</i>",
        parse_mode="HTML"
    )


@router.message(AddProductStates.description, F.from_user.id.func(is_admin))
async def process_product_description(message: Message, state: FSMContext):
    """Mahsulot tavsifini qabul qiladi."""
    text = message.text.strip()
    
    description = None if text == "/skip" else text[:500]
    
    await state.update_data(description=description)
    await state.set_state(AddProductStates.images)
    
    user_id = message.from_user.id
    _temp_product_data[user_id] = {"images": []}
    
    await message.answer(
        "✅ Tavsif saqlandi\n\n"
        "5️⃣ Mahsulot rasmlarini yuboring:\n\n"
        "• Bitta rasm yoki MediaGroup (bir necha rasm birga)\n"
        "• Bir necha marta yuborishingiz mumkin\n"
        "• Tugagach /done bosing\n\n"
        "<i>Rasmlar kerak bo'lmasa /skip</i>",
        parse_mode="HTML"
    )


@router.message(AddProductStates.images, F.photo, F.from_user.id.func(is_admin))
async def process_product_images(message: Message, state: FSMContext, bot: Bot):
    """Mahsulot rasmlarini qabul qiladi (MediaGroup qo'llab-quvvatlaydi).
    
    Avto_A1 style: rasmlar Telegram file_id sifatida saqlanadi.
    Agar Firebase Storage sozlangan bo'lsa, Firebase'ga yuklanadi va
    doimiy URL qaytariladi.
    """
    user_id = message.from_user.id
    
    if user_id not in _temp_product_data:
        _temp_product_data[user_id] = {"images": []}
    
    # Eng katta o'lchamdagi rasmni olish
    photo = message.photo[-1]
    file_id = photo.file_id
    
    _temp_product_data[user_id]["images"].append(file_id)
    
    count = len(_temp_product_data[user_id]["images"])
    await message.answer(
        f"✅ Rasm qo'shildi ({count} ta)\n\n"
        f"Yana rasm yuborishingiz yoki /done bosishingiz mumkin.",
        parse_mode="HTML"
    )


@router.message(AddProductStates.images, Command("done"), F.from_user.id.func(is_admin))
@router.message(AddProductStates.images, Command("skip"), F.from_user.id.func(is_admin))
async def finish_product_images(message: Message, state: FSMContext):
    """Rasm yuklashni tugatadi va tasdiqni so'raydi."""
    user_id = message.from_user.id
    images = _temp_product_data.get(user_id, {}).get("images", [])
    
    data = await state.get_data()
    await state.set_state(AddProductStates.confirm)
    
    # Xulosa
    text = (
        "📦 <b>Mahsulot ma'lumotlari</b>\n\n"
        f"Nomi: <b>{data['name']}</b>\n"
        f"Narx: <b>{data['price']:,} so'm</b>\n"
        f"Ombor: <b>{data.get('stock', 0)} dona</b>\n"
    )
    
    if data.get('description'):
        desc = data['description'][:100]
        if len(data['description']) > 100:
            desc += "..."
        text += f"Tavsif: <i>{desc}</i>\n"
    
    text += f"Rasmlar: <b>{len(images)} ta</b>\n\n"
    text += "Tasdiqlaysizmi?\n\n"
    text += "/confirm — Tasdiqlash va saqlash\n"
    text += "/cancel — Bekor qilish"
    
    await message.answer(text, parse_mode="HTML")


@router.message(AddProductStates.confirm, Command("confirm"), F.from_user.id.func(is_admin))
async def confirm_add_product(message: Message, state: FSMContext, bot: Bot):
    """Mahsulotni tasdiqlaydi va Firebase'ga saqlaydi.
    
    Avto_A1 style: rasmlar Firebase Storage'ga yuklanadi (agar sozlangan bo'lsa).
    """
    user_id = message.from_user.id
    data = await state.get_data()
    images = _temp_product_data.get(user_id, {}).get("images", [])
    
    try:
        # Mahsulotni qo'shish (rasmlar keyinroq yuklanadi)
        product_id = await fb_prod.add_product(
            name=data['name'],
            price=data['price'],
            stock=data.get('stock', 0),
            description=data.get('description'),
            images=[],  # Bo'sh — keyinroq to'ldiriladi
            is_draft=False,
        )
        
        if product_id > 0:
            # Rasmlarni Firebase Storage'ga yuklash
            uploaded_images = []
            if images and fb_storage.is_storage_enabled():
                progress_msg = await message.answer("📤 Rasmlar yuklanmoqda...")
                for i, file_id in enumerate(images):
                    image_url = await fb_storage.upload_telegram_photo(
                        bot, file_id, product_id, i
                    )
                    if image_url:
                        uploaded_images.append(image_url)
                await progress_msg.delete()
            else:
                # Firebase Storage o'chiq — file_id'larni to'g'ridan-to'g'ri saqlash
                uploaded_images = images
            
            # Rasmlarni mahsulotga qo'shish
            if uploaded_images:
                await fb_prod.update_product(product_id, images=uploaded_images)
            
            # Product card ko'rsatish
            product = await fb_prod.get_product(product_id)
            if product:
                await product_card.send_product_card(
                    bot=bot,
                    chat_id=message.chat.id,
                    product=product,
                    admin_view=True,
                    show_purchase=False,
                )
            
            await message.answer(
                f"✅ <b>Mahsulot qo'shildi!</b>\n\n"
                f"ID: <code>{product_id}</code>\n"
                f"Nom: {data['name']}\n"
                f"Rasmlar: {len(uploaded_images)} ta\n\n"
                f"Mahsulot endi do'konda ko'rinadi.",
                parse_mode="HTML"
            )
        else:
            await message.answer(
                "❌ Mahsulot saqlanmadi. Firebase xatosi.\n\n"
                "Texnik tafsilotlar logda.",
                parse_mode="HTML"
            )
    
    except Exception as e:
        logger.error("Mahsulot qo'shilmadi: %s", e, exc_info=True)
        await message.answer(
            f"❌ Xato yuz berdi:\n\n<code>{e}</code>",
            parse_mode="HTML"
        )
    
    finally:
        await state.clear()
        if user_id in _temp_product_data:
            del _temp_product_data[user_id]


@router.message(Command("cancel"))
async def cancel_handler(message: Message, state: FSMContext):
    """Har qanday dialogni bekor qiladi."""
    current_state = await state.get_state()
    if current_state is None:
        return
    
    user_id = message.from_user.id
    if user_id in _temp_product_data:
        del _temp_product_data[user_id]
    
    await state.clear()
    await message.answer(
        "❌ Bekor qilindi.",
        parse_mode="HTML"
    )


@router.message(Command("products_list"), F.from_user.id.func(is_admin))
async def list_products(message: Message):
    """Barcha mahsulotlar ro'yxatini ko'rsatadi."""
    products = await fb_prod.get_all_products(active_only=False, include_drafts=False)
    
    if not products:
        await message.answer(
            "📦 <b>Mahsulotlar yo'q</b>\n\n"
            "Mahsulot qo'shish uchun:\n"
            "• /add_product - dialog orqali\n"
            "• Excel/CSV fayl yuborish",
            parse_mode="HTML"
        )
        return
    
    # Faol va nofaol bo'lib guruhlash
    active = [p for p in products if p.get("is_active", True)]
    inactive = [p for p in products if not p.get("is_active", True)]
    
    text = f"📦 <b>Mahsulotlar</b>\n\n"
    text += f"Jami: {len(products)} ta\n"
    text += f"✅ Faol: {len(active)} ta\n"
    text += f"⏸ Nofaol: {len(inactive)} ta\n\n"
    
    # Oxirgi 10 ta mahsulot
    text += "<b>Oxirgi mahsulotlar:</b>\n"
    for prod in products[:10]:
        status = "✅" if prod.get("is_active", True) else "⏸"
        stock = prod.get("stock", 0)
        stock_text = f"{stock} dona" if stock > 0 else "❌ Tugagan"
        
        text += (
            f"\n{status} <b>{prod.get('name', 'No name')}</b>\n"
            f"  ID: <code>{prod.get('id')}</code>\n"
            f"  Narx: {prod.get('price', 0):,} so'm\n"
            f"  Ombor: {stock_text}\n"
        )
    
    if len(products) > 10:
        text += f"\n... va yana {len(products) - 10} ta\n"
    
    text += (
        "\n<i>Mahsulot boshqarish:</i>\n"
        "<code>/edit_product {id}</code> - tahrirlash\n"
        "<code>/toggle_product {id}</code> - yoqish/o'chirish\n"
        "<code>/delete_product {id}</code> - o'chirish"
    )
    
    await message.answer(text, parse_mode="HTML")


@router.message(Command("toggle_product"), F.from_user.id.func(is_admin))
async def toggle_product_handler(message: Message):
    """Mahsulotni faollashtirish/o'chirish."""
    args = message.text.split(maxsplit=1)
    if len(args) < 2:
        await message.answer(
            "❌ Mahsulot ID berilmadi.\n\n"
            "Foydalanish: <code>/toggle_product 1001</code>",
            parse_mode="HTML"
        )
        return
    
    try:
        product_id = int(args[1].strip())
    except ValueError:
        await message.answer("❌ Noto'g'ri ID")
        return
    
    product = await fb_prod.get_product(product_id)
    if not product:
        await message.answer(f"❌ Mahsulot topilmadi (ID: {product_id})")
        return
    
    success = await fb_prod.toggle_product(product_id)
    if success:
        new_state = not product.get("is_active", True)
        status = "faollashtirildi ✅" if new_state else "o'chirildi ⏸"
        await message.answer(
            f"✅ Mahsulot {status}\n\n"
            f"<b>{product.get('name')}</b>",
            parse_mode="HTML"
        )
    else:
        await message.answer("❌ O'zgartirish amalga oshmadi")


@router.message(Command("delete_product"), F.from_user.id.func(is_admin))
async def delete_product_handler(message: Message):
    """Mahsulotni o'chiradi."""
    args = message.text.split(maxsplit=1)
    if len(args) < 2:
        await message.answer(
            "❌ Mahsulot ID berilmadi.\n\n"
            "Foydalanish: <code>/delete_product 1001</code>",
            parse_mode="HTML"
        )
        return
    
    try:
        product_id = int(args[1].strip())
    except ValueError:
        await message.answer("❌ Noto'g'ri ID")
        return
    
    product = await fb_prod.get_product(product_id)
    if not product:
        await message.answer(f"❌ Mahsulot topilmadi (ID: {product_id})")
        return
    
    success = await fb_prod.delete_product(product_id)
    if success:
        await message.answer(
            f"🗑 <b>Mahsulot o'chirildi</b>\n\n"
            f"{product.get('name')}\n"
            f"ID: {product_id}",
            parse_mode="HTML"
        )
    else:
        await message.answer("❌ O'chirish amalga oshmadi")


@router.message(Command("update_stock"), F.from_user.id.func(is_admin))
async def update_stock_handler(message: Message, bot: Bot):
    """Mahsulot ombor miqdorini yangilaydi."""
    args = message.text.split()
    if len(args) < 3:
        await message.answer(
            "❌ Noto'g'ri format.\n\n"
            "Foydalanish: <code>/update_stock {id} {miqdor}</code>\n"
            "Masalan: <code>/update_stock 1001 50</code>",
            parse_mode="HTML"
        )
        return
    
    try:
        product_id = int(args[1])
        quantity = int(args[2])
    except ValueError:
        await message.answer("❌ ID va miqdor raqam bo'lishi kerak")
        return
    
    if quantity < 0:
        await message.answer("❌ Miqdor manfiy bo'lishi mumkin emas")
        return
    
    product = await fb_prod.get_product(product_id)
    if not product:
        await message.answer(f"❌ Mahsulot topilmadi (ID: {product_id})")
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
            f"{product.get('name')}\n"
            f"Yangi miqdor: <b>{quantity} dona</b>",
            parse_mode="HTML"
        )
    else:
        await message.answer("❌ Yangilash amalga oshmadi")
