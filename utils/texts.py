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

# Bi-LED (tuning) buyurtmalari holati
BILED_STATUS = {
    "new": "🆕 Yangi",
    "accepted": "✅ Qabul qilindi",
    "in_work": "🔧 Ish jarayonida",
    "done": "✨ Topshirildi",
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
        f"<b>{config.shop_name}</b> — Bi-LED avtotuning. 🔥\n\n"
        "Ilova ichida:\n"
        "• 🚗 Mashinangizni tanlaysiz\n"
        "• 💡 <b>Bi-LED linza</b> turini tanlaysiz\n"
        "• 🕶 <b>Ochki</b> (maska) va 🎨 <b>optika rangini</b> tanlaysiz\n"
        "• Faraning ko'rinishini <b>real vaqtda</b> ko'rib turasiz\n\n"
        "Pastdagi <b>🚀 Ilovani ochish</b> tugmasini bosing 👇"
    )


APP_INTRO = (
    "🚀 <b>{shop}</b> — Bi-LED konfigurator\n\n"
    "Mashina → Bi-LED linza → ochki → optika rangi.\n"
    "Har bir qadamda fara ko'rinishi jonli o'zgaradi.\n\n"
    "Ilovani ochish uchun tugmani bosing:"
)


CONTACT_TEXT = (
    f"☎️ <b>{config.shop_name} — Bi-LED avtotuning</b>\n\n"
    "🔧 Xizmatlar: Bi-LED linza o'rnatish, ochki (maska) almashtirish,\n"
    "fara optikasini bo'yash, polirovka va germetizatsiya.\n\n"
    "🛡 Linzalarga <b>1 yil kafolat</b>.\n\n"
    "🕘 Ish vaqti: {start}:00 - {end}:00\n"
    "📞 Telefon: +998 90 000 00 00\n"
    "📍 Manzil: (admin kiritadi)\n\n"
    "Savollaringiz bo'lsa, shu yerga yozing."
).format(start=config.work_start_hour, end=config.work_end_hour)
