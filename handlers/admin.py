"""Admin panel: statistika, navbatlar, buyurtmalar, xizmat/kategoriya/mahsulot va broadcast."""

import asyncio
import logging

from aiogram import Bot, F, Router
from aiogram.filters import Command
from aiogram.fsm.context import FSMContext
from aiogram.types import CallbackQuery, KeyboardButton, Message, ReplyKeyboardMarkup

from config import config
from database import queries as q
from keyboards.inline import (
    admin_back_kb,
    admin_booking_actions_kb,
    admin_bookings_kb,
    admin_menu_kb,
    admin_order_actions_kb,
    admin_orders_kb,
    admin_pick_category_kb,
    admin_services_kb,
)
from keyboards.reply import cancel_kb, main_menu
from states import AddCategory, AddProduct, AddService, Broadcast
from utils.helpers import available_dates, date_label, fmt_price, today_iso, user_link
from utils.texts import (
    BOOKING_STATUS,
    BTN_ADMIN,
    BTN_CANCEL,
    BTN_SKIP,
    ORDER_STATUS,
)
from utils.ui import edit_or_send

logger = logging.getLogger(__name__)

router = Router(name="admin")
# butun router faqat adminlar uchun
router.message.filter(F.from_user.id.in_(config.admins))
router.callback_query.filter(F.from_user.id.in_(config.admins))

ADMIN_TITLE = "⚙️ <b>Admin panel</b>\n\nKerakli bo'limni tanlang:"


def skip_kb() -> ReplyKeyboardMarkup:
    return ReplyKeyboardMarkup(
        keyboard=[[KeyboardButton(text=BTN_SKIP)], [KeyboardButton(text=BTN_CANCEL)]],
        resize_keyboard=True,
    )


@router.message(Command("admin"))
@router.message(F.text == BTN_ADMIN)
async def admin_menu(message: Message, state: FSMContext) -> None:
    await state.clear()
    await message.answer(ADMIN_TITLE, reply_markup=admin_menu_kb())


@router.callback_query(F.data == "adm:menu")
async def admin_menu_cb(callback: CallbackQuery, state: FSMContext) -> None:
    await state.clear()
    await edit_or_send(callback.message, ADMIN_TITLE, admin_menu_kb())
    await callback.answer()


# ------------------------------------------------------------------ statistika


@router.callback_query(F.data == "adm:stats")
async def admin_stats(callback: CallbackQuery) -> None:
    stats = await q.get_stats(today_iso())
    text = (
        "📊 <b>Statistika</b>\n\n"
        f"👥 Foydalanuvchilar: <b>{stats['users']}</b>\n\n"
        f"🗓 Navbatlar (jami): <b>{stats['bookings_total']}</b>\n"
        f"📅 Bugungi navbatlar: <b>{stats['bookings_today']}</b>\n"
        f"🆕 Tasdiqlanmagan navbatlar: <b>{stats['bookings_new']}</b>\n\n"
        f"📦 Buyurtmalar (jami): <b>{stats['orders_total']}</b>\n"
        f"🆕 Yangi buyurtmalar: <b>{stats['orders_new']}</b>\n"
        f"🛍 Faol mahsulotlar: <b>{stats['products']}</b>\n"
        f"💰 Umumiy savdo: <b>{fmt_price(stats['revenue'])}</b>"
    )
    await edit_or_send(callback.message, text, admin_back_kb())
    await callback.answer()


# -------------------------------------------------------------------- navbatlar


@router.callback_query(F.data.startswith("adm:bookings:"))
async def admin_bookings(callback: CallbackQuery) -> None:
    raw_date = callback.data.split(":")[2]
    date_iso = today_iso() if raw_date == "today" else raw_date
    bookings = await q.get_bookings_by_date(date_iso)

    if bookings:
        lines = [f"🗓 <b>{date_label(date_iso)}</b> — {len(bookings)} ta navbat\n"]
        for bk in bookings:
            lines.append(
                f"🕐 <b>{bk['time']}</b> · {bk['service_name']}\n"
                f"    👤 {bk['full_name']} · 📞 {bk['phone']}\n"
                f"    {BOOKING_STATUS.get(bk['status'], bk['status'])}"
            )
        text = "\n".join(lines)
    else:
        text = f"🗓 <b>{date_label(date_iso)}</b>\n\nBu kunga navbat yo'q."

    await edit_or_send(
        callback.message, text, admin_bookings_kb(date_iso, bookings, available_dates())
    )
    await callback.answer()


@router.callback_query(F.data.startswith("adm:bk:"))
async def admin_booking_detail(callback: CallbackQuery) -> None:
    booking_id = int(callback.data.split(":")[2])
    bk = await q.get_booking(booking_id)
    if not bk:
        await callback.answer("Navbat topilmadi", show_alert=True)
        return

    text = (
        f"🗓 <b>Navbat #{bk['id']}</b>\n\n"
        f"👤 {user_link(bk['full_name'], bk['username'], bk['user_id'])}\n"
        f"📞 {bk['phone']}\n"
        f"🛠 {bk['service_name']} · {fmt_price(bk['price'])}\n"
        f"📅 {date_label(bk['date'])} · 🕐 <b>{bk['time']}</b>\n"
        f"📌 Holat: {BOOKING_STATUS.get(bk['status'], bk['status'])}\n"
        f"🕓 Yaratilgan: {bk['created_at']}"
    )
    await edit_or_send(
        callback.message, text, admin_booking_actions_kb(booking_id, bk["date"])
    )
    await callback.answer()


@router.callback_query(F.data.startswith("adm:bkst:"))
async def admin_booking_status(callback: CallbackQuery, bot: Bot) -> None:
    _, _, raw_id, status = callback.data.split(":")
    booking_id = int(raw_id)
    bk = await q.get_booking(booking_id)
    if not bk:
        await callback.answer("Navbat topilmadi", show_alert=True)
        return

    await q.set_booking_status(booking_id, status)
    label = BOOKING_STATUS.get(status, status)

    messages = {
        "confirmed": (
            f"✅ Navbatingiz <b>tasdiqlandi</b>!\n\n"
            f"🛠 {bk['service_name']}\n📅 {date_label(bk['date'])} · 🕐 <b>{bk['time']}</b>\n\n"
            "Belgilangan vaqtda kutamiz!"
        ),
        "done": (
            f"✔️ Navbatingiz bajarildi.\n🛠 {bk['service_name']}\n\n"
            "Bizni tanlaganingiz uchun rahmat! 🙌"
        ),
        "cancelled": (
            f"❌ Afsuski, navbatingiz bekor qilindi.\n"
            f"🛠 {bk['service_name']}\n📅 {date_label(bk['date'])} · 🕐 {bk['time']}\n\n"
            "Boshqa vaqtga navbat olishingiz mumkin."
        ),
    }
    if status in messages:
        try:
            await bot.send_message(bk["user_id"], messages[status])
        except Exception as error:
            logger.warning("Foydalanuvchiga xabar yuborilmadi: %s", error)

    await callback.answer(f"Holat: {label}")
    updated = await q.get_booking(booking_id)
    text = (
        f"🗓 <b>Navbat #{updated['id']}</b>\n\n"
        f"👤 {user_link(updated['full_name'], updated['username'], updated['user_id'])}\n"
        f"📞 {updated['phone']}\n"
        f"🛠 {updated['service_name']}\n"
        f"📅 {date_label(updated['date'])} · 🕐 <b>{updated['time']}</b>\n"
        f"📌 Holat: {BOOKING_STATUS.get(updated['status'], updated['status'])}"
    )
    await edit_or_send(
        callback.message, text, admin_booking_actions_kb(booking_id, updated["date"])
    )


# ------------------------------------------------------------------ buyurtmalar


@router.callback_query(F.data.startswith("adm:orders:"))
async def admin_orders(callback: CallbackQuery) -> None:
    status = callback.data.split(":")[2]
    orders = await q.get_orders(None if status == "all" else status)

    if orders:
        lines = [f"📦 <b>Buyurtmalar</b> ({ORDER_STATUS.get(status, 'Hammasi')})\n"]
        for order in orders:
            lines.append(
                f"🆔 <b>#{order['id']}</b> · {fmt_price(order['total'])}\n"
                f"    👤 {order['full_name']} · 📞 {order['phone']}\n"
                f"    {ORDER_STATUS.get(order['status'], order['status'])} · {order['created_at']}"
            )
        text = "\n".join(lines)
    else:
        text = "📦 <b>Buyurtmalar</b>\n\nBu holatda buyurtma yo'q."

    await edit_or_send(callback.message, text, admin_orders_kb(orders, status))
    await callback.answer()


@router.callback_query(F.data.startswith("adm:ord:"))
async def admin_order_detail(callback: CallbackQuery) -> None:
    order_id = int(callback.data.split(":")[2])
    order = await q.get_order(order_id)
    if not order:
        await callback.answer("Buyurtma topilmadi", show_alert=True)
        return

    items = await q.get_order_items(order_id)
    lines = [
        f"📦 <b>Buyurtma #{order['id']}</b>\n",
        f"👤 {user_link(order['full_name'], order['username'], order['user_id'])}",
        f"📞 {order['phone']}",
        f"📍 {order['address']}",
        f"📌 Holat: {ORDER_STATUS.get(order['status'], order['status'])}",
        f"🕓 {order['created_at']}\n",
    ]
    for item in items:
        lines.append(
            f"• {item['name']} × {item['qty']} = {fmt_price(item['price'] * item['qty'])}"
        )
    lines.append(f"\n💰 Jami: <b>{fmt_price(order['total'])}</b>")

    await edit_or_send(
        callback.message, "\n".join(lines), admin_order_actions_kb(order_id, order["status"])
    )
    await callback.answer()


@router.callback_query(F.data.startswith("adm:ordst:"))
async def admin_order_status(callback: CallbackQuery, bot: Bot) -> None:
    _, _, raw_id, status = callback.data.split(":")
    order_id = int(raw_id)
    order = await q.get_order(order_id)
    if not order:
        await callback.answer("Buyurtma topilmadi", show_alert=True)
        return

    await q.set_order_status(order_id, status)
    messages = {
        "accepted": (
            f"✅ Buyurtmangiz <b>#{order_id}</b> qabul qilindi!\n"
            "Tez orada yetkazib beramiz. 🚚"
        ),
        "delivered": (
            f"🚚 Buyurtmangiz <b>#{order_id}</b> yetkazildi.\n"
            "Xaridingiz uchun rahmat! 🎉"
        ),
        "cancelled": (
            f"❌ Buyurtmangiz <b>#{order_id}</b> bekor qilindi.\n"
            "Batafsil ma'lumot uchun operator bilan bog'lanishingiz mumkin."
        ),
    }
    if status in messages:
        try:
            await bot.send_message(order["user_id"], messages[status])
        except Exception as error:
            logger.warning("Foydalanuvchiga xabar yuborilmadi: %s", error)

    await callback.answer(f"Holat: {ORDER_STATUS.get(status, status)}")
    await admin_order_detail_refresh(callback, order_id)


async def admin_order_detail_refresh(callback: CallbackQuery, order_id: int) -> None:
    order = await q.get_order(order_id)
    items = await q.get_order_items(order_id)
    lines = [
        f"📦 <b>Buyurtma #{order['id']}</b>\n",
        f"👤 {user_link(order['full_name'], order['username'], order['user_id'])}",
        f"📞 {order['phone']}",
        f"📍 {order['address']}",
        f"📌 Holat: {ORDER_STATUS.get(order['status'], order['status'])}\n",
    ]
    for item in items:
        lines.append(
            f"• {item['name']} × {item['qty']} = {fmt_price(item['price'] * item['qty'])}"
        )
    lines.append(f"\n💰 Jami: <b>{fmt_price(order['total'])}</b>")
    await edit_or_send(
        callback.message, "\n".join(lines), admin_order_actions_kb(order_id, order["status"])
    )


# --------------------------------------------------------------------- xizmatlar


@router.callback_query(F.data == "adm:services")
async def admin_services(callback: CallbackQuery) -> None:
    services = await q.get_services(active_only=False)
    text = (
        "🛠 <b>Xizmatlar</b>\n\n"
        "Xizmat nomini bosib uni yoqish/o'chirish mumkin.\n"
        "🟢 — faol, 🔴 — o'chirilgan"
    )
    await edit_or_send(callback.message, text, admin_services_kb(services))
    await callback.answer()


@router.callback_query(F.data.startswith("adm:svctoggle:"))
async def admin_toggle_service(callback: CallbackQuery) -> None:
    service_id = int(callback.data.split(":")[2])
    await q.toggle_service(service_id)
    services = await q.get_services(active_only=False)
    await edit_or_send(
        callback.message,
        "🛠 <b>Xizmatlar</b>\n\n🟢 — faol, 🔴 — o'chirilgan",
        admin_services_kb(services),
    )
    await callback.answer("O'zgartirildi")


@router.callback_query(F.data == "adm:addsvc")
async def add_service_start(callback: CallbackQuery, state: FSMContext) -> None:
    await state.set_state(AddService.name)
    await callback.message.answer(
        "🛠 <b>Yangi xizmat</b>\n\n1/3. Xizmat nomini yozing:", reply_markup=cancel_kb()
    )
    await callback.answer()


@router.message(AddService.name, F.text)
async def add_service_name(message: Message, state: FSMContext) -> None:
    if await _cancelled(message, state):
        return
    await state.update_data(name=message.text.strip())
    await state.set_state(AddService.duration)
    await message.answer("2/3. Davomiyligini daqiqada yozing (masalan: 30):")


@router.message(AddService.duration, F.text)
async def add_service_duration(message: Message, state: FSMContext) -> None:
    if await _cancelled(message, state):
        return
    value = _parse_int(message.text)
    if value is None or value < 5 or value > 480:
        await message.answer("5 dan 480 gacha son yuboring (daqiqa).")
        return
    await state.update_data(duration=value)
    await state.set_state(AddService.price)
    await message.answer("3/3. Narxini yozing (masalan: 50000):")


@router.message(AddService.price, F.text)
async def add_service_price(message: Message, state: FSMContext) -> None:
    if await _cancelled(message, state):
        return
    price = _parse_int(message.text)
    if price is None or price < 0:
        await message.answer("Narxni son ko'rinishida yuboring (masalan: 50000).")
        return

    data = await state.get_data()
    service_id = await q.add_service(data["name"], data["duration"], price)
    await state.clear()
    await message.answer(
        f"✅ Xizmat qo'shildi!\n\n🆔 #{service_id}\n🛠 {data['name']}\n"
        f"⏱ {data['duration']} daqiqa\n💰 {fmt_price(price)}",
        reply_markup=main_menu(message.from_user.id),
    )
    await message.answer(ADMIN_TITLE, reply_markup=admin_menu_kb())


# ----------------------------------------------------------------- kategoriyalar


@router.callback_query(F.data == "adm:addcat")
async def add_category_start(callback: CallbackQuery, state: FSMContext) -> None:
    categories = await q.get_categories(active_only=False)
    existing = "\n".join(f"• {cat['name']}" for cat in categories) or "— hozircha yo'q —"
    await state.set_state(AddCategory.name)
    await callback.message.answer(
        f"🗂 <b>Yangi kategoriya</b>\n\nMavjud kategoriyalar:\n{existing}\n\n"
        "Yangi kategoriya nomini yozing:",
        reply_markup=cancel_kb(),
    )
    await callback.answer()


@router.message(AddCategory.name, F.text)
async def add_category_name(message: Message, state: FSMContext) -> None:
    if await _cancelled(message, state):
        return
    name = message.text.strip()
    if len(name) < 2:
        await message.answer("Nom juda qisqa. Qaytadan yozing.")
        return
    category_id = await q.add_category(name)
    await state.clear()
    await message.answer(
        f"✅ Kategoriya qo'shildi: <b>{name}</b> (#{category_id})",
        reply_markup=main_menu(message.from_user.id),
    )
    await message.answer(ADMIN_TITLE, reply_markup=admin_menu_kb())


# ------------------------------------------------------------------- mahsulotlar


@router.callback_query(F.data == "adm:addprod")
async def add_product_start(callback: CallbackQuery, state: FSMContext) -> None:
    categories = await q.get_categories(active_only=False)
    if not categories:
        await callback.answer(
            "Avval kategoriya qo'shing (🗂 Kategoriya qo'shish)", show_alert=True
        )
        return
    await state.set_state(AddProduct.category)
    await edit_or_send(
        callback.message,
        "🛍 <b>Yangi mahsulot</b>\n\n1/6. Kategoriyani tanlang:",
        admin_pick_category_kb(categories),
    )
    await callback.answer()


@router.callback_query(AddProduct.category, F.data.startswith("adm:pickcat:"))
async def add_product_category(callback: CallbackQuery, state: FSMContext) -> None:
    category_id = int(callback.data.split(":")[2])
    await state.update_data(category_id=category_id)
    await state.set_state(AddProduct.name)
    await callback.message.answer(
        "2/6. Mahsulot nomini yozing:", reply_markup=cancel_kb()
    )
    await callback.answer()


@router.message(AddProduct.name, F.text)
async def add_product_name(message: Message, state: FSMContext) -> None:
    if await _cancelled(message, state):
        return
    await state.update_data(name=message.text.strip())
    await state.set_state(AddProduct.description)
    await message.answer(
        "3/6. Mahsulot tavsifini yozing (yoki o'tkazib yuboring):",
        reply_markup=skip_kb(),
    )


@router.message(AddProduct.description, F.text)
async def add_product_description(message: Message, state: FSMContext) -> None:
    if await _cancelled(message, state):
        return
    text = message.text.strip()
    await state.update_data(description=None if text == BTN_SKIP else text)
    await state.set_state(AddProduct.price)
    await message.answer("4/6. Narxini yozing (masalan: 45000):", reply_markup=cancel_kb())


@router.message(AddProduct.price, F.text)
async def add_product_price(message: Message, state: FSMContext) -> None:
    if await _cancelled(message, state):
        return
    price = _parse_int(message.text)
    if price is None or price < 0:
        await message.answer("Narxni son ko'rinishida yuboring.")
        return
    await state.update_data(price=price)
    await state.set_state(AddProduct.stock)
    await message.answer("5/6. Ombordagi sonini yozing (masalan: 10):")


@router.message(AddProduct.stock, F.text)
async def add_product_stock(message: Message, state: FSMContext) -> None:
    if await _cancelled(message, state):
        return
    stock = _parse_int(message.text)
    if stock is None or stock < 0:
        await message.answer("Sonni butun son ko'rinishida yuboring.")
        return
    await state.update_data(stock=stock)
    await state.set_state(AddProduct.photo)
    await message.answer(
        "6/6. Mahsulot rasmini yuboring (yoki o'tkazib yuboring):", reply_markup=skip_kb()
    )


@router.message(AddProduct.photo, F.photo)
async def add_product_photo(message: Message, state: FSMContext) -> None:
    await _save_product(message, state, message.photo[-1].file_id)


@router.message(AddProduct.photo, F.text)
async def add_product_photo_skip(message: Message, state: FSMContext) -> None:
    if await _cancelled(message, state):
        return
    if message.text.strip() != BTN_SKIP:
        await message.answer("Rasm yuboring yoki «⏭ O'tkazib yuborish» tugmasini bosing.")
        return
    await _save_product(message, state, None)


async def _save_product(message: Message, state: FSMContext, photo_id: str | None) -> None:
    data = await state.get_data()
    product_id = await q.add_product(
        data["category_id"],
        data["name"],
        data.get("description"),
        data["price"],
        data["stock"],
        photo_id,
    )
    category = await q.get_category(data["category_id"])
    category_name = category["name"] if category else "-"
    photo_label = "bor" if photo_id else "yo'q"
    await state.clear()
    await message.answer(
        f"✅ Mahsulot qo'shildi!\n\n"
        f"🆔 #{product_id}\n🛍 <b>{data['name']}</b>\n"
        f"🗂 {category_name}\n"
        f"💰 {fmt_price(data['price'])}\n📦 {data['stock']} dona\n"
        f"🖼 Rasm: {photo_label}",
        reply_markup=main_menu(message.from_user.id),
    )
    await message.answer(ADMIN_TITLE, reply_markup=admin_menu_kb())


# --------------------------------------------------------------------- broadcast


@router.callback_query(F.data == "adm:broadcast")
async def broadcast_start(callback: CallbackQuery, state: FSMContext) -> None:
    users = await q.get_all_user_ids()
    await state.set_state(Broadcast.text)
    await callback.message.answer(
        f"📣 <b>Ommaviy xabar</b>\n\nQabul qiluvchilar: <b>{len(users)}</b> foydalanuvchi\n\n"
        "Yuborilishi kerak bo'lgan xabarni yuboring (matn yoki rasm):",
        reply_markup=cancel_kb(),
    )
    await callback.answer()


@router.message(Broadcast.text)
async def broadcast_send(message: Message, state: FSMContext, bot: Bot) -> None:
    if message.text and message.text.strip() == BTN_CANCEL:
        await state.clear()
        await message.answer("❌ Bekor qilindi.", reply_markup=main_menu(message.from_user.id))
        return

    await state.clear()
    user_ids = await q.get_all_user_ids()
    status = await message.answer(f"📤 Yuborilmoqda... (0/{len(user_ids)})")

    sent, failed = 0, 0
    for index, user_id in enumerate(user_ids, start=1):
        try:
            await message.send_copy(chat_id=user_id)
            sent += 1
        except Exception:
            failed += 1
        if index % 25 == 0:
            try:
                await status.edit_text(f"📤 Yuborilmoqda... ({index}/{len(user_ids)})")
            except Exception:
                pass
        await asyncio.sleep(0.05)

    await status.edit_text(
        f"✅ Yuborildi: <b>{sent}</b>\n❌ Yuborilmadi: <b>{failed}</b>"
    )
    await message.answer(ADMIN_TITLE, reply_markup=admin_menu_kb())


# ----------------------------------------------------------------------- utils


def _parse_int(raw: str | None) -> int | None:
    if not raw:
        return None
    digits = raw.replace(" ", "").replace("_", "")
    if not digits.isdigit():
        return None
    return int(digits)


async def _cancelled(message: Message, state: FSMContext) -> bool:
    """BTN_CANCEL bosilganini tekshiradi va state'ni tozalaydi."""
    if message.text and message.text.strip() == BTN_CANCEL:
        await state.clear()
        await message.answer("❌ Bekor qilindi.", reply_markup=main_menu(message.from_user.id))
        await message.answer(ADMIN_TITLE, reply_markup=admin_menu_kb())
        return True
    return False
