"""Tugma matnlari va statuslar."""

from config import config

# --- asosiy menyu tugmalari
# BTN_APP — pastdagi klaviaturadagi tugma. U Mini App'ni O'ZI ochmaydi:
# bosilganda bot chatga inline «Do'konni ochish» tugmasini yuboradi va
# ilova shu tugmadan ochiladi. Sabab: inline tugma (va ko'k «Open» menyu
# tugmasi) Telegram'ning eng ishonchli ochish yo'li — `initData` imzosi
# har doim to'liq keladi. Klaviaturadagi web_app tugmasi ba'zi
# mijozlarda ID'ni to'liq bermaydi va «tasdiqlanmadi» xatosi chiqadi.
BTN_APP = "🛍 Do'konni ochish"
BTN_OPEN_APP = "🛍 Do'konni ochish"  # chatdagi inline tugma yozuvi
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
        f"Pastdagi <b>{BTN_APP}</b> tugmasini bosing 👇"
    )


APP_INTRO = (
    "🛍 <b>{shop}</b> — do'kon va Bi-LED konfigurator\n\n"
    "Mashina → Bi-LED linza → ochki → optika rangi.\n"
    "Har bir qadamda fara ko'rinishi jonli o'zgaradi.\n\n"
    "Pastdagi tugmani bosib ochasiz 👇"
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
