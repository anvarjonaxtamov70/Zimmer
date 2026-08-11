"""Tugma matnlari va statuslar."""

from config import config

# --- asosiy menyu tugmalari
BTN_APP = "🚀 Ilovani ochish"
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
        f"<b>{config.shop_name}</b> ga xush kelibsiz.\n\n"
        "Barcha ishlar <b>ilova</b> ichida bajariladi:\n"
        "• 🗓 <b>Navbat olish</b> — kun va bo'sh vaqtni tanlab\n"
        "• 🛍 <b>Mahsulot xarid qilish</b>\n"
        "• 📅 Navbat va buyurtmalaringizni kuzatish\n\n"
        "Pastdagi <b>🚀 Ilovani ochish</b> tugmasini bosing 👇"
    )


APP_INTRO = (
    "🚀 <b>{shop}</b> ilovasi\n\n"
    "Navbat olish, mahsulot xarid qilish va buyurtmalarni kuzatish — "
    "hammasi ilova ichida.\n\n"
    "Ilovani ochish uchun tugmani bosing:"
)


CONTACT_TEXT = (
    f"☎️ <b>{config.shop_name} bilan aloqa</b>\n\n"
    "📍 Manzil: (admin sozlamalarda ko'rsatadi)\n"
    "🕘 Ish vaqti: {start}:00 - {end}:00\n"
    "📞 Telefon: +998 90 000 00 00\n\n"
    "Savollaringiz bo'lsa, adminga yozing."
).format(start=config.work_start_hour, end=config.work_end_hour)
