"""Admin panel: statistika, navbatlar, buyurtmalar, xizmat/kategoriya/mahsulot va broadcast."""

import asyncio
import logging

from aiogram import Bot, F, Router
from aiogram.filters import Command
from aiogram.fsm.context import FSMContext
from aiogram.types import CallbackQuery, Message

from config import VERSION, parse_ids
from database import queries as q
from keyboards.inline import (
    admin_back_kb,
    admin_biled_actions_kb,
    admin_biled_orders_kb,
    admin_booking_actions_kb,
    admin_bookings_kb,
    admin_menu_kb,
    admin_order_actions_kb,
    admin_orders_kb,
)
from keyboards.reply import cancel_kb, main_menu
from services import admins as admin_registry
from services import firebase, orders, sync
from states import Broadcast
from utils.commands import apply_admin_commands, reset_user_commands
from utils.filters import IsAdmin
from utils.helpers import (
    available_dates,
    date_label,
    fmt_price,
    html_escape,
    size_tag,
    today_iso,
    user_link,
)
from utils.texts import (
    BILED_STATUS,
    BOOKING_STATUS,
    BTN_ADMIN,
    BTN_CANCEL,
    ORDER_STATUS,
)
from utils.ui import edit_or_send

logger = logging.getLogger(__name__)

router = Router(name="admin")
# Butun router faqat adminlar uchun. Tekshiruv JONLI registrdan o'qiladi,
# shuning uchun yangi admin qo'shilsa darhol ishlaydi (restart kerak emas).
router.message.filter(IsAdmin())
router.callback_query.filter(IsAdmin())

ADMIN_TITLE = f"⚙️ <b>Admin panel</b>\n\nKerakli bo'limni tanlang:\n\n⚙️ Versiya: v{VERSION}"




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
        "🔥 <b>Bi-LED buyurtmalar</b>\n"
        f"   Jami: <b>{stats['biled_total']}</b> · Yangi: <b>{stats['biled_new']}</b>\n"
        f"   Summa: <b>{fmt_price(stats['biled_revenue'])}</b>\n\n"
        "🗓 <b>O'rnatish navbatlari</b>\n"
        f"   Jami: <b>{stats['bookings_total']}</b> · Bugun: <b>{stats['bookings_today']}</b>\n"
        f"   Tasdiqlanmagan: <b>{stats['bookings_new']}</b>\n\n"
        "📦 <b>Do'kon</b>\n"
        f"   Buyurtmalar: <b>{stats['orders_total']}</b> · Yangi: <b>{stats['orders_new']}</b>\n"
        f"   Faol mahsulot: <b>{stats['products']}</b>\n"
        f"   Savdo: <b>{fmt_price(stats['revenue'])}</b>\n\n"
        f"💰 <b>Umumiy: {fmt_price(stats['revenue'] + stats['biled_revenue'])}</b>"
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
                f"    👤 {html_escape(bk['full_name'])} · 📞 {html_escape(bk['phone'])}\n"
                f"    {BOOKING_STATUS.get(bk['status'], bk['status'])}"
            )
        text = "\n".join(lines)
    else:
        text = f"🗓 <b>{date_label(date_iso)}</b>\n\nBu kunga navbat yo'q."

    await edit_or_send(
        callback.message, text, admin_bookings_kb(date_iso, bookings, available_dates())
    )
    await callback.answer()


def _booking_detail_text(bk) -> str:
    """Navbat kartochkasi — ikki joyda bir xil ko'rinishi uchun bitta funksiya."""
    return (
        f"🗓 <b>Navbat #{bk['id']}</b>\n\n"
        f"👤 {user_link(bk['full_name'], bk['username'], bk['user_id'])}\n"
        f"📞 {html_escape(bk['phone'])}\n"
        f"🛠 {bk['service_name']} · {fmt_price(bk['price'])}\n"
        f"📅 {date_label(bk['date'])} · 🕐 <b>{bk['time']}</b>\n"
        f"📌 Holat: {BOOKING_STATUS.get(bk['status'], bk['status'])}\n"
        f"🕓 Yaratilgan: {bk['created_at']}"
    )


async def _show_booking(callback: CallbackQuery, bk) -> None:
    await edit_or_send(
        callback.message,
        _booking_detail_text(bk),
        admin_booking_actions_kb(bk["id"], bk["date"], bk["status"]),
    )


@router.callback_query(F.data.startswith("adm:bk:"))
async def admin_booking_detail(callback: CallbackQuery) -> None:
    booking_id = int(callback.data.split(":")[2])
    bk = await q.get_booking(booking_id)
    if not bk:
        await callback.answer("Navbat topilmadi", show_alert=True)
        return

    await _show_booking(callback, bk)
    await callback.answer()


@router.callback_query(F.data.startswith("adm:bkst:"))
async def admin_booking_status(callback: CallbackQuery, bot: Bot) -> None:
    _, _, raw_id, status = callback.data.split(":")
    booking_id = int(raw_id)
    bk = await q.get_booking(booking_id)
    if not bk:
        await callback.answer("Navbat topilmadi", show_alert=True)
        return

    # Bekor qilingan navbatni qayta tasdiqlab bo'lmaydi
    allowed, reason = orders.check("booking", bk["status"], status)
    if not allowed:
        await callback.answer(
            orders.reason_text("booking", bk["status"], status, reason), show_alert=True
        )
        await _show_booking(callback, bk)
        return

    await orders.apply("booking", booking_id, status)
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
    await _show_booking(callback, updated)


# ------------------------------------------------------- Bi-LED buyurtmalari


def _biled_detail_text(order) -> str:
    lines = [
        f"🔥 <b>Bi-LED buyurtma #{order['id']}</b>\n",
        f"👤 {user_link(order['full_name'], order['username'], order['user_id'])}",
        f"📞 {html_escape(order['phone']) or '-'}",
        f"🚗 Mashina: <b>{order['car_name']}</b> ({order['car_years'] or '-'})",
        f"💡 Linza: <b>{order['biled_name']}</b> — {fmt_price(order['biled_price'])}",
    ]
    if order["shroud_name"]:
        lines.append(f"🕶 Ochki: <b>{order['shroud_name']}</b> — {fmt_price(order['shroud_price'])}")
    if order["color_name"]:
        lines.append(f"🎨 Optika: <b>{order['color_name']}</b> — {fmt_price(order['color_price'])}")
    if order["comment"]:
        lines.append(f"📝 Izoh: {html_escape(order['comment'])}")
    lines.append(f"\n📌 Holat: {BILED_STATUS.get(order['status'], order['status'])}")
    lines.append(f"🕓 {order['created_at']}")
    lines.append(f"\n💰 Jami: <b>{fmt_price(order['total'])}</b>")
    return "\n".join(lines)


@router.callback_query(F.data.startswith("adm:bileds:"))
async def admin_biled_orders(callback: CallbackQuery) -> None:
    status = callback.data.split(":")[2]
    orders = await q.get_biled_orders(None if status == "all" else status)

    if orders:
        lines = [f"🔥 <b>Bi-LED buyurtmalar</b> ({BILED_STATUS.get(status, 'Hammasi')})\n"]
        for order in orders:
            lines.append(
                f"🆔 <b>#{order['id']}</b> · {order['car_name']} · {fmt_price(order['total'])}\n"
                f"    💡 {order['biled_name']}\n"
                f"    👤 {html_escape(order['full_name'])} · 📞 {html_escape(order['phone']) or '-'}\n"
                f"    {BILED_STATUS.get(order['status'], order['status'])} · {order['created_at']}"
            )
        text = "\n".join(lines)
    else:
        text = "🔥 <b>Bi-LED buyurtmalar</b>\n\nBu holatda buyurtma yo'q."

    await edit_or_send(callback.message, text, admin_biled_orders_kb(orders, status))
    await callback.answer()


@router.callback_query(F.data.startswith("adm:bil:"))
async def admin_biled_detail(callback: CallbackQuery) -> None:
    order_id = int(callback.data.split(":")[2])
    order = await q.get_biled_order(order_id)
    if not order:
        await callback.answer("Buyurtma topilmadi", show_alert=True)
        return
    await edit_or_send(
        callback.message,
        _biled_detail_text(order),
        admin_biled_actions_kb(order_id, order["status"]),
    )
    await callback.answer()


@router.callback_query(F.data.startswith("adm:bilst:"))
async def admin_biled_status(callback: CallbackQuery, bot: Bot) -> None:
    _, _, raw_id, status = callback.data.split(":")
    order_id = int(raw_id)
    order = await q.get_biled_order(order_id)
    if not order:
        await callback.answer("Buyurtma topilmadi", show_alert=True)
        return

    # Bekor qilingan / yopilgan buyurtma qayta o'zgarmaydi
    allowed, reason = orders.check("biled", order["status"], status)
    if not allowed:
        await callback.answer(
            orders.reason_text("biled", order["status"], status, reason), show_alert=True
        )
        await edit_or_send(
            callback.message,
            _biled_detail_text(order),
            admin_biled_actions_kb(order_id, order["status"]),
        )
        return

    await orders.apply("biled", order_id, status)
    messages = {
        "accepted": (
            f"✅ Buyurtmangiz <b>#{order_id}</b> qabul qilindi!\n\n"
            f"🚗 {order['car_name']} · 💡 {order['biled_name']}\n\n"
            "Mutaxassisimiz o'rnatish vaqtini kelishish uchun bog'lanadi. 🔧"
        ),
        "in_work": (
            f"🔧 Buyurtmangiz <b>#{order_id}</b> ish jarayonida.\n\n"
            "Faralar ochilib, linzalar o'rnatilmoqda. Tayyor bo'lganda xabar beramiz."
        ),
        "done": (
            f"✨ Buyurtmangiz <b>#{order_id}</b> tayyor!\n\n"
            f"🚗 {order['car_name']} · 💡 {order['biled_name']}\n\n"
            "Bizni tanlaganingiz uchun rahmat! Kafolat kuchda. 🛡"
        ),
        "cancelled": (
            f"❌ Buyurtmangiz <b>#{order_id}</b> bekor qilindi.\n\n"
            "Savollaringiz bo'lsa, bizga yozing."
        ),
    }
    if status in messages:
        try:
            await bot.send_message(order["user_id"], messages[status])
        except Exception as error:
            logger.warning("Foydalanuvchiga xabar yuborilmadi: %s", error)

    await callback.answer(f"Holat: {BILED_STATUS.get(status, status)}")
    updated = await q.get_biled_order(order_id)
    await edit_or_send(
        callback.message,
        _biled_detail_text(updated),
        admin_biled_actions_kb(order_id, updated["status"]),
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
                f"    👤 {html_escape(order['full_name'])} · 📞 {html_escape(order['phone'])}\n"
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
        f"📞 {html_escape(order['phone'])}",
        f"📍 {html_escape(order['address'])}",
        f"📌 Holat: {ORDER_STATUS.get(order['status'], order['status'])}",
        f"🕓 {order['created_at']}\n",
    ]
    for item in items:
        lines.append(
            f"• {html_escape(item['name'])}{size_tag(item)} × {item['qty']}"
            f" = {fmt_price(item['price'] * item['qty'])}"
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

    allowed, reason = orders.check("order", order["status"], status)
    if not allowed:
        await callback.answer(
            orders.reason_text("order", order["status"], status, reason), show_alert=True
        )
        await admin_order_detail_refresh(callback, order_id)
        return

    # Bekor qilinsa tovarlar omborga qaytadi (services/orders.py)
    await orders.apply("order", order_id, status)
    messages = {
        "accepted": (
            f"✅ Buyurtmangiz <b>#{order_id}</b> qabul qilindi!\nTez orada yetkazib beramiz. 🚚"
        ),
        "delivered": (
            f"🚚 Buyurtmangiz <b>#{order_id}</b> yetkazildi.\nXaridingiz uchun rahmat! 🎉"
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
        f"📞 {html_escape(order['phone'])}",
        f"📍 {html_escape(order['address'])}",
        f"📌 Holat: {ORDER_STATUS.get(order['status'], order['status'])}\n",
    ]
    for item in items:
        lines.append(
            f"• {html_escape(item['name'])}{size_tag(item)} × {item['qty']}"
            f" = {fmt_price(item['price'] * item['qty'])}"
        )
    lines.append(f"\n💰 Jami: <b>{fmt_price(order['total'])}</b>")
    await edit_or_send(
        callback.message, "\n".join(lines), admin_order_actions_kb(order_id, order["status"])
    )


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

    await status.edit_text(f"✅ Yuborildi: <b>{sent}</b>\n❌ Yuborilmadi: <b>{failed}</b>")
    await message.answer(ADMIN_TITLE, reply_markup=admin_menu_kb())


# ==================================================================== adminlar
#
# Ilgari yangi admin qo'shishning yagona yo'li Render panelidagi ADMINS
# o'zgaruvchisini tahrirlab, xizmatni qayta ishga tushirish edi. Endi
# adminlar bot ichidan boshqariladi: ro'yxat bazada va Firebase'da
# saqlanadi, shuning uchun qayta deploydan keyin ham yo'qolmaydi.


def _target_user_id(message: Message) -> int | None:
    """Buyruqdan yoki javob berilgan xabardan foydalanuvchi ID'sini oladi.

    Ishlaydigan usullar:
        /admin_add 5105291033
        /admin_add @user 5105291033   (matndagi ID olinadi)
        forward qilingan xabarga javob berib: /admin_add
    """
    found = parse_ids(message.text or "")
    if found:
        return found[0]

    reply = message.reply_to_message
    if reply is not None:
        if reply.forward_from is not None:
            return reply.forward_from.id
        if reply.from_user is not None and not reply.from_user.is_bot:
            return reply.from_user.id
    return None


async def _known_name(user_id: int) -> str | None:
    row = await q.get_user(user_id)
    return row["full_name"] if row else None


@router.message(Command("adminlar"))
async def cmd_admins(message: Message, state: FSMContext) -> None:
    await state.clear()
    await message.answer(await admin_registry.describe(), reply_markup=admin_back_kb())


@router.message(Command("firebase"))
async def cmd_firebase(message: Message, state: FSMContext) -> None:
    """Doimiy saqlash (Firebase) holatini tekshiradi va tiklashga urinadi.

    Sozlamani o'zgartirgandan keyin qayta deploy kutmasdan shu buyruq
    bilan tekshirish mumkin — token qaytadan olinishga urinib ko'riladi.
    """
    await state.clear()
    status = await message.answer("⏳ Firebase tekshirilmoqda...")

    await firebase.refresh_token()
    if firebase.is_enabled():
        users = await sync.restore_users()
        catalog = await sync.restore_catalog()
        history = await sync.restore_orders()
        # MUHIM: mahalliy katalogni bulutga ham YOZAMIZ. Ilgari bu buyruq
        # faqat bulutdan tiklardi, shuning uchun `{root}/catalog` to'liq
        # bo'lmasdi va Mini App'ning zaxira rejimi do'konni bo'sh ko'rsatardi.
        pushed = await sync.push_all_catalog()
        total_pushed = sum(pushed.values())
        pushed_users = await sync.push_all_users()
        # Ochiq bandlik jadvali (`slots`) — Mini App bo'sh vaqtni shundan
        # o'qiydi. Bo'sh qolsa hamma vaqt bo'sh ko'rinadi.
        slots = await sync.push_all_booking_slots()
        # Navbatda turgan va YO'QOLGAN yozuvlar. Ilgari bu ma'lumot hech
        # qayerda ko'rinmasdi — buyurtma bulutga tushmagani bilinmasdi.
        await sync.flush_pending()
        queue_line = (
            f"\n⏳ Navbatda: {sync.pending_count()} yozuv"
            if sync.pending_count()
            else ""
        )
        dropped_line = (
            f"\n❗️ <b>Yo'qolgan yozuv: {sync.dropped_count()} ta</b>"
            if sync.dropped_count()
            else ""
        )
        await status.edit_text(
            "✅ <b>Firebase ulangan.</b>\n\n"
            "Mijozlar, katalog va buyurtmalar tarixi doimiy saqlanadi — "
            "qayta deployda yo'qolmaydi.\n\n"
            "<b>Bulutdan tiklandi:</b>\n"
            f"👥 Mijozlar: {users} ta\n"
            f"🗂 Katalog: {catalog.get('added', 0)} yangi, "
            f"{catalog.get('updated', 0)} yangilandi\n"
            f"🔥 Bi-LED buyurtmalar: {history.get('biled', 0)} ta\n"
            f"📦 Do'kon buyurtmalari: {history.get('orders', 0)} ta\n"
            f"🗓 Navbatlar: {history.get('bookings', 0)} ta\n\n"
            f"<b>Bulutga yuklandi:</b> {total_pushed} katalog yozuvi, "
            f"{pushed_users} mijoz, {slots} bandlik belgisi\n"
            f"<i>{', '.join(f'{k}={v}' for k, v in pushed.items()) or 'bo‘sh'}</i>"
            f"{queue_line}{dropped_line}\n\n"
            "Shu tufayli Render o'chganda ham ilovada do'kon ko'rinadi.\n\n"
            "<i>0 bo'lsa — hammasi allaqachon bazada bor, demak yo'qolmagan.</i>"
        )
        return

    await status.edit_text(
        "⚠️ <b>Firebase hali ulanmadi.</b>\n\n"
        f"Sabab: {firebase.diagnose()}\n\n"
        "<b>Nima qilish kerak:</b>\n"
        "1. Firebase Console → Project settings → Service accounts → "
        "«Generate new private key» — JSON fayl yuklanadi.\n"
        "2. Faylni base64 ga o'giring (kompyuterda):\n"
        "<code>base64 -w0 serviceAccount.json</code>\n"
        "3. Chiqqan uzun matnni Render → Environment → "
        "<code>SERVICE_ACCOUNT_JSON</code> ga qo'ying.\n"
        "4. <code>FIREBASE_DB_URL</code> to'g'riligini tekshiring.\n"
        "5. Saqlab, xizmat qayta ishga tushgach yana /firebase yuboring."
    )


@router.callback_query(F.data == "adm:admins")
async def admins_menu_cb(callback: CallbackQuery) -> None:
    await edit_or_send(callback.message, await admin_registry.describe(), admin_back_kb())
    await callback.answer()


@router.message(Command("admin_add"))
async def cmd_admin_add(message: Message, bot: Bot) -> None:
    target = _target_user_id(message)
    if target is None:
        await message.answer(
            "ℹ️ Qo'shish uchun ID kerak:\n"
            "<code>/admin_add 5105291033</code>\n\n"
            "Yoki odamning xabarini botga <b>forward</b> qilib, o'sha xabarga "
            "javob sifatida <code>/admin_add</code> yozing.\n\n"
            "ID'ni bilish uchun u kishi botga /id yuborsa bo'ladi."
        )
        return

    name = await _known_name(target)
    added = await admin_registry.grant(target, name, message.from_user.id)
    if not added:
        await message.answer(
            f"ℹ️ <code>{target}</code> allaqachon admin "
            f"({admin_registry.source_label(target)})."
        )
        return

    await apply_admin_commands(bot, target)
    await message.answer(
        f"✅ Yangi admin qo'shildi: <code>{target}</code>"
        + (f" — {name}" if name else "")
        + "\n\nRo'yxat bazada va Firebase'da saqlandi — qayta deploydan keyin ham qoladi.",
        reply_markup=admin_back_kb(),
    )
    try:
        await bot.send_message(
            target,
            "👑 Sizga <b>admin</b> huquqi berildi!\n\n"
            "Panel: /admin\nKatalog: /katalog\nAdminlar: /adminlar",
        )
    except Exception as error:
        logger.info("Yangi adminga (%s) xabar yuborilmadi: %s", target, error)


@router.message(Command("admin_del"))
async def cmd_admin_del(message: Message, bot: Bot) -> None:
    target = _target_user_id(message)
    if target is None:
        await message.answer("ℹ️ Olib tashlash uchun: <code>/admin_del 5105291033</code>")
        return

    ok, reason = await admin_registry.revoke(target)
    if ok:
        await reset_user_commands(bot, target)
        await message.answer(
            f"✅ <code>{target}</code> adminlar ro'yxatidan olib tashlandi.",
            reply_markup=admin_back_kb(),
        )
        return

    if reason == "protected":
        await message.answer(
            f"⛔️ <code>{target}</code> — {admin_registry.source_label(target)} admin. "
            "Uni bot ichidan o'chirib bo'lmaydi.\n\n"
            "Bu ataylab shunday: asosiy adminlar hech qanday holatda "
            "(baza tozalansa ham) yo'qolmasligi kerak."
        )
        return

    await message.answer(f"ℹ️ <code>{target}</code> admin emas.")
