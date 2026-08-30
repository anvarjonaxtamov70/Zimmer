"""Navbat olish: xizmat -> kun -> vaqt -> tasdiqlash."""

from aiogram import Bot, F, Router
from aiogram.filters import Command
from aiogram.fsm.context import FSMContext
from aiogram.types import CallbackQuery, Message

from database import queries as q
from services import orders, sync
from keyboards.inline import (
    admin_new_booking_kb,
    booking_confirm_kb,
    dates_kb,
    my_bookings_kb,
    services_kb,
    times_kb,
)
from keyboards.reply import main_menu
from utils.helpers import (
    available_dates,
    date_label,
    decode_time,
    fmt_price,
    free_slots,
    html_escape,
    today_iso,
    user_link,
)
from utils.texts import BOOKING_STATUS, BTN_MY_QUEUE, BTN_QUEUE
from utils.ui import edit_or_send, notify_admins

router = Router(name="queue")

NOT_REGISTERED = "Avval ro'yxatdan o'tishingiz kerak. /start buyrug'ini yuboring."


async def _taken_slots(date_iso: str) -> list[tuple[str, int]]:
    rows = await q.get_day_bookings(date_iso)
    return [(row["time"], int(row["duration_min"])) for row in rows]


# ------------------------------------------------------------- 1. xizmat tanlash


@router.message(F.text == BTN_QUEUE)
@router.message(Command("navbat"))
async def start_booking(message: Message, state: FSMContext) -> None:
    await state.clear()
    user = await q.get_user(message.from_user.id)
    if not user:
        await message.answer(NOT_REGISTERED)
        return

    # «Tez kunda» xizmatlar ro'yxatga TUSHMAYDI — narxi yo'q, ya'ni
    # ularga navbat olish mumkin emas.
    services = await q.get_services(bookable_only=True)
    if not services:
        await message.answer(
            "Hozircha xizmatlar qo'shilmagan. Keyinroq urinib ko'ring.",
            reply_markup=main_menu(message.from_user.id),
        )
        return

    await message.answer(
        "🗓 <b>Navbat olish</b>\n\nQaysi xizmat uchun navbat olasiz?",
        reply_markup=services_kb(services),
    )


@router.callback_query(F.data == "back:svc")
async def back_to_services(callback: CallbackQuery) -> None:
    services = await q.get_services(bookable_only=True)
    await edit_or_send(
        callback.message,
        "🗓 <b>Navbat olish</b>\n\nQaysi xizmat uchun navbat olasiz?",
        services_kb(services),
    )
    await callback.answer()


# ---------------------------------------------------------------- 2. kun tanlash


@router.callback_query(F.data.startswith("svc:"))
@router.callback_query(F.data.startswith("back:dates:"))
async def choose_date(callback: CallbackQuery) -> None:
    service_id = int(callback.data.split(":")[-1])
    service = await q.get_bookable_service(service_id)
    if not service:
        await callback.answer("Xizmat topilmadi", show_alert=True)
        return

    text = (
        f"🛠 Xizmat: <b>{html_escape(service['name'])}</b>\n"
        f"⏱ Davomiyligi: {service['duration_min']} daqiqa\n"
        f"💰 Narx: {fmt_price(service['price'])}\n\n"
        "📅 Qaysi kunga navbat olasiz?"
    )
    await edit_or_send(callback.message, text, dates_kb(service_id, available_dates()))
    await callback.answer()


# --------------------------------------------------------------- 3. vaqt tanlash


@router.callback_query(F.data.startswith("dt:"))
@router.callback_query(F.data.startswith("back:times:"))
async def choose_time(callback: CallbackQuery) -> None:
    parts = callback.data.split(":")
    service_id, date_iso = int(parts[-2]), parts[-1]
    service = await q.get_bookable_service(service_id)
    if not service:
        await callback.answer("Xizmat topilmadi", show_alert=True)
        return

    slots = free_slots(date_iso, int(service["duration_min"]), await _taken_slots(date_iso))
    if not slots:
        await callback.answer(
            "Bu kunda bo'sh vaqt qolmadi 😔 Boshqa kunni tanlang.", show_alert=True
        )
        return

    text = (
        f"🛠 Xizmat: <b>{html_escape(service['name'])}</b>\n"
        f"📅 Sana: <b>{date_label(date_iso)}</b>\n\n"
        f"🕐 Bo'sh vaqtlar ({len(slots)} ta). Qulay vaqtni tanlang:"
    )
    await edit_or_send(callback.message, text, times_kb(service_id, date_iso, slots))
    await callback.answer()


# ------------------------------------------------------------------ 4. tasdiqlash


@router.callback_query(F.data.startswith("tm:"))
async def confirm_booking(callback: CallbackQuery) -> None:
    _, sid, date_iso, time_enc = callback.data.split(":")
    service = await q.get_bookable_service(int(sid))
    if not service:
        await callback.answer(
            "Bu xizmat hozir navbat qabul qilmaydi", show_alert=True
        )
        return
    time_str = decode_time(time_enc)

    text = (
        "🔎 <b>Navbatni tasdiqlang</b>\n\n"
        f"🛠 Xizmat: <b>{html_escape(service['name'])}</b>\n"
        f"📅 Sana: <b>{date_label(date_iso)}</b>\n"
        f"🕐 Vaqt: <b>{time_str}</b>\n"
        f"⏱ Davomiyligi: {service['duration_min']} daqiqa\n"
        f"💰 Narx: {fmt_price(service['price'])}\n\n"
        "Hammasi to'g'rimi?"
    )
    await edit_or_send(
        callback.message, text, booking_confirm_kb(int(sid), date_iso, time_str)
    )
    await callback.answer()


@router.callback_query(F.data.startswith("bkok:"))
async def save_booking(callback: CallbackQuery, bot: Bot) -> None:
    _, sid, date_iso, time_enc = callback.data.split(":")
    service_id, time_str = int(sid), decode_time(time_enc)
    service = await q.get_bookable_service(service_id)
    if not service:
        await callback.answer("Xizmat topilmadi", show_alert=True)
        return

    user = await q.get_user(callback.from_user.id)
    if not user:
        await callback.answer(NOT_REGISTERED, show_alert=True)
        return

    # vaqt oralig'ida band bo'lib qolgan bo'lishi mumkin — qayta tekshiramiz
    slots = free_slots(date_iso, int(service["duration_min"]), await _taken_slots(date_iso))
    if time_str not in slots:
        await callback.answer(
            "Afsus, bu vaqt allaqachon band bo'ldi. Boshqa vaqtni tanlang.", show_alert=True
        )
        slots = free_slots(date_iso, int(service["duration_min"]), await _taken_slots(date_iso))
        await edit_or_send(
            callback.message,
            f"📅 <b>{date_label(date_iso)}</b> uchun bo'sh vaqtlar:",
            times_kb(service_id, date_iso, slots),
        )
        return

    try:
        booking_id = await q.add_booking(callback.from_user.id, service_id, date_iso, time_str)
    except q.SlotTaken:
        # Bazadagi UNIQUE cheklov to'qnashuvni oxirgi nuqtada ushlab qoldi:
        # yuqoridagi tekshiruv bilan yozuv orasida boshqa mijoz olib qo'ygan.
        await callback.answer(
            "Afsus, bu vaqt shu lahzada band bo'ldi. Boshqa vaqtni tanlang.", show_alert=True
        )
        slots = free_slots(date_iso, int(service["duration_min"]), await _taken_slots(date_iso))
        await edit_or_send(
            callback.message,
            f"📅 <b>{date_label(date_iso)}</b> uchun bo'sh vaqtlar:",
            times_kb(service_id, date_iso, slots),
        )
        return

    # Bulutga yozamiz — ilgari bot orqali olingan navbat FAQAT SQLite'da
    # qolardi va qayta deployda yo'qolardi. Bundan tashqari Mini App bo'sh
    # vaqtni bulutdan hisoblaydi, ya'ni bu navbat unga ko'rinmasdi va
    # o'sha vaqtga ikkinchi mijoz yozilib qolardi.
    booking_row = await q.get_booking(booking_id)
    if booking_row is not None:
        await sync.push_booking(booking_row)

    await edit_or_send(
        callback.message,
        "✅ <b>Navbatingiz band qilindi!</b>\n\n"
        f"🆔 Navbat raqami: <b>#{booking_id}</b>\n"
        f"🛠 Xizmat: <b>{html_escape(service['name'])}</b>\n"
        f"📅 Sana: <b>{date_label(date_iso)}</b>\n"
        f"🕐 Vaqt: <b>{time_str}</b>\n"
        f"💰 Narx: {fmt_price(service['price'])}\n\n"
        "Iltimos, belgilangan vaqtdan 5 daqiqa oldin keling. "
        "Navbatni «📅 Mening navbatlarim» bo'limidan bekor qilishingiz mumkin.",
    )
    await callback.answer("Navbat olindi ✅")

    await notify_admins(
        bot,
        "🔔 <b>Yangi navbat</b>\n\n"
        f"🆔 #{booking_id}\n"
        f"👤 {user_link(user['full_name'], user['username'], user['user_id'])}\n"
        f"📞 {user['phone']}\n"
        f"🛠 {html_escape(service['name'])}\n"
        f"📅 {date_label(date_iso)}\n"
        f"🕐 {time_str}",
        admin_new_booking_kb(booking_id),
    )


# ------------------------------------------------------------ mening navbatlarim


@router.message(F.text == BTN_MY_QUEUE)
async def my_bookings(message: Message, state: FSMContext) -> None:
    await state.clear()
    bookings = await q.get_user_bookings(message.from_user.id)
    upcoming = [bk for bk in bookings if bk["date"] >= today_iso()]
    if not upcoming:
        await message.answer(
            "📅 Sizda faol navbat yo'q.\n\n«🗓 Navbat olish» tugmasi orqali navbat oling.",
            reply_markup=main_menu(message.from_user.id),
        )
        return

    lines = ["📅 <b>Mening navbatlarim</b>\n"]
    for bk in upcoming:
        lines.append(
            f"🆔 <b>#{bk['id']}</b> · {BOOKING_STATUS.get(bk['status'], bk['status'])}\n"
            f"🛠 {html_escape(bk['service_name'])}\n"
            f"📅 {date_label(bk['date'])} · 🕐 <b>{bk['time']}</b>\n"
            f"💰 {fmt_price(bk['price'])}\n"
        )
    await message.answer("\n".join(lines), reply_markup=my_bookings_kb(upcoming))


@router.callback_query(F.data.startswith("bkcancel:"))
async def cancel_booking(callback: CallbackQuery, bot: Bot) -> None:
    booking_id = int(callback.data.split(":")[1])
    booking = await q.get_booking(booking_id)
    if not booking or booking["user_id"] != callback.from_user.id:
        await callback.answer("Navbat topilmadi", show_alert=True)
        return
    if booking["status"] == "cancelled":
        await callback.answer("Bu navbat allaqachon bekor qilingan", show_alert=True)
        return

    # Holat mexanizmi orqali: tekshiradi, bazaga yozadi, bulutga uzatadi va
    # ochiq bandlik jadvalidan o'chiradi. Ilgari bu yerda `set_booking_status`
    # TO'G'RIDAN chaqirilardi — natijada Firebase'da holat abadiy «new» bo'lib
    # qolardi va bekor qilingan vaqt boshqa mijozga BAND ko'rinardi.
    allowed, reason = orders.check("booking", booking["status"], "cancelled")
    if not allowed:
        await callback.answer(
            orders.reason_text("booking", booking["status"], "cancelled", reason),
            show_alert=True,
        )
        return

    await orders.apply("booking", booking_id, "cancelled")
    await edit_or_send(
        callback.message,
        f"❌ <b>#{booking_id}</b> raqamli navbat bekor qilindi.\n"
        f"🛠 {booking['service_name']} · {date_label(booking['date'])} {booking['time']}\n\n"
        "Yangi navbat olish uchun «🗓 Navbat olish» tugmasini bosing.",
    )
    await callback.answer("Bekor qilindi")

    await notify_admins(
        bot,
        "⚠️ <b>Navbat bekor qilindi</b>\n\n"
        f"🆔 #{booking_id}\n"
        f"👤 {booking['full_name']} ({booking['phone']})\n"
        f"🛠 {html_escape(booking['service_name'])}\n"
        f"📅 {date_label(booking['date'])} 🕐 {booking['time']}",
    )
