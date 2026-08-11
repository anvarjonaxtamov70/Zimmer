"""Tugma matnlari va statuslar."""

from config import config

# --- asosiy menyu tugmalari
BTN_QUEUE = "🗓 Navbat olish"
BTN_SHOP = "🛍 Do'kon"
BTN_MY_QUEUE = "📅 Mening navbatlarim"
BTN_CART = "🧺 Savatcha"
BTN_ORDERS = "📦 Buyurtmalarim"
BTN_CONTACT = "☎️ Aloqa"
BTN_ADMIN = "⚙️ Admin panel"

BTN_PHONE = "📱 Raqamni yuborish"
BTN_CANCEL = "❌ Bekor qilish"
BTN_SKIP = "⏭ O'tkazib yuborish"

BOOKING_STATUS = {
    "new": "🆕 Yangi",
    "confirmed": "✅ Tasdiqlangan",
    "done": "✔️ Bajarilgan",
    "cancelled": "❌ Bekor qilingan",
}

ORDER_STATUS = {
    "new": "🆕 Yangi",
    "accepted": "✅ Qabul qilindi",
    "delivered": "🚚 Yetkazildi",
    "cancelled": "❌ Bekor qilingan",
}

WEEKDAYS = [
    "Dushanba",
    "Seshanba",
    "Chorshanba",
    "Payshanba",
    "Juma",
    "Shanba",
    "Yakshanba",
]

MONTHS = [
    "yanvar",
    "fevral",
    "mart",
    "aprel",
    "may",
    "iyun",
    "iyul",
    "avgust",
    "sentabr",
    "oktabr",
    "noyabr",
    "dekabr",
]


def greeting(name: str) -> str:
    return (
        f"Assalomu alaykum, <b>{name}</b>! 👋\n\n"
        f"<b>{config.shop_name}</b> botiga xush kelibsiz.\n\n"
        "Bu yerda siz:\n"
        "• 🗓 <b>Navbat olishingiz</b> — qulay kun va vaqtni tanlab\n"
        "• 🛍 <b>Mahsulot sotib olishingiz</b> mumkin\n\n"
        "Kerakli bo'limni tanlang 👇"
    )


CONTACT_TEXT = (
    f"☎️ <b>{config.shop_name} bilan aloqa</b>\n\n"
    "📍 Manzil: (admin sozlamalarda ko'rsatadi)\n"
    "🕘 Ish vaqti: {start}:00 - {end}:00\n"
    "📞 Telefon: +998 90 000 00 00\n\n"
    "Savollaringiz bo'lsa, adminga yozing."
).format(start=config.work_start_hour, end=config.work_end_hour)
