# 🤖 Zimmer bot

Telegram bot: **navbat olish** (booking) va **mahsulot sotib olish** (do'kon) bir joyda.
aiogram 3 + SQLite asosida yozilgan, qo'shimcha server yoki baza o'rnatish shart emas.

## Imkoniyatlar

### Foydalanuvchi uchun
- 📱 Ro'yxatdan o'tish (ism + telefon raqam)
- 🗓 **Navbat olish**: xizmat → kun → bo'sh vaqt → tasdiqlash
  - band vaqtlar avtomatik chiqarib tashlanadi (xizmat davomiyligi hisobga olinadi)
  - bugungi kun uchun o'tib ketgan vaqtlar ko'rsatilmaydi
- 📅 Mening navbatlarim + navbatni bekor qilish
- 🛍 **Do'kon**: kategoriya → mahsulot (rasm, tavsif, narx, ombor qoldig'i)
- 🧺 Savatcha: sonini oshirish/kamaytirish, o'chirish, tozalash
- 🚚 Buyurtma berish: manzil + telefon → tasdiqlash
- 📦 Buyurtmalarim tarixi va holati

### Admin uchun (`/admin`)
- 📊 Statistika (foydalanuvchi, navbat, buyurtma, savdo summasi)
- 🗓 Kun bo'yicha navbatlar: tasdiqlash / bajarildi / bekor qilish
- 📦 Buyurtmalar: qabul qilish / yetkazildi / bekor qilish
- 🛠 Xizmatlarni qo'shish va yoqib-o'chirish
- 🗂 Kategoriya va 🛍 mahsulot qo'shish (rasm bilan)
- 📣 Barcha foydalanuvchilarga ommaviy xabar
- Har bir yangi navbat/buyurtma haqida adminga darhol xabar keladi

## O'rnatish

```bash
git clone https://github.com/anvarjonaxtamov70/Zimmer.git
cd Zimmer

python3 -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install -r requirements.txt

cp .env.example .env             # Windows: copy .env.example .env
```

`.env` faylini to'ldiring:

```env
BOT_TOKEN=BotFather'dan olgan token
ADMINS=sizning_telegram_id
```

Telegram ID'ni bilish uchun botni ishga tushirib `/id` yuboring yoki
[@userinfobot](https://t.me/userinfobot) dan foydalaning.

Ishga tushirish:

```bash
python bot.py
```

Birinchi ishga tushirishda `zimmer.db` fayli avtomatik yaratiladi va
namuna xizmatlar/mahsulotlar qo'shiladi (keyin admin panelda o'zgartirasiz).

## Sozlamalar (`.env`)

| O'zgaruvchi | Ma'nosi | Standart |
|---|---|---|
| `BOT_TOKEN` | BotFather tokeni | — |
| `ADMINS` | Admin ID'lari, vergul bilan | — |
| `SHOP_NAME` | Bot/do'kon nomi | `Zimmer` |
| `DB_PATH` | SQLite fayli | `zimmer.db` |
| `TIMEZONE` | Vaqt zonasi | `Asia/Tashkent` |
| `WORK_START_HOUR` | Ish boshlanishi (soat) | `9` |
| `WORK_END_HOUR` | Ish tugashi (soat) | `18` |
| `SLOT_MINUTES` | Navbat oralig'i (daqiqa) | `30` |
| `BOOKING_DAYS_AHEAD` | Necha kun oldinga navbat | `7` |
| `CURRENCY` | Valyuta yozuvi | `so'm` |

## ☁️ Bulutga joylash (24/7 ishlashi uchun)

Bot Render.com'ning bepul tarifida ishlashga tayyor: repo ildizida
`render.yaml` blueprint, `/health` endpoint va har 10 daqiqada ping
yuboradigan GitHub Actions workflow bor.

Qisqacha: Render → New → Blueprint → `Zimmer` repo → `BOT_TOKEN` va
`ADMINS` ni kiritish → Deploy.

To'liq qo'llanma va muammolar yechimi: **[DEPLOY.md](DEPLOY.md)**

> ⚠️ Bepul tarifda disk saqlanmaydi — qayta deployda SQLite bazasi
> tozalanadi. Doimiy saqlash variantlari DEPLOY.md da yozilgan.

## Loyiha tuzilishi

```
zimmer/
├── bot.py                # kirish nuqtasi (polling)
├── config.py             # .env sozlamalari
├── render.yaml           # Render.com deploy blueprint
├── DEPLOY.md             # bulutga joylash qo'llanmasi
├── .github/workflows/    # keep-alive ping (botni uyg'oq tutadi)
├── database/
│   ├── db.py             # ulanish, jadvallar, namuna ma'lumot
│   └── queries.py        # barcha SQL so'rovlar
├── handlers/
│   ├── start.py          # /start, ro'yxatdan o'tish, menyu
│   ├── queue.py          # navbat olish
│   ├── shop.py           # kategoriya va mahsulotlar
│   ├── cart.py           # savatcha + buyurtma berish
│   ├── orders.py         # buyurtmalar tarixi
│   ├── admin.py          # admin panel
│   └── fallback.py       # tushunarsiz xabarlar
├── keyboards/            # reply va inline tugmalar
├── states/               # FSM holatlar
└── utils/                # helperlar, matnlar, komandalar, health server
```

## Ma'lumotlar bazasi

`users`, `services`, `bookings`, `categories`, `products`, `cart_items`,
`orders`, `order_items` jadvallari. Sxema `database/db.py` ichida —
bot ishga tushganda avtomatik yaratiladi.

## Keyingi rejalar

- To'lov tizimlari (Payme/Click) integratsiyasi
- Navbat haqida eslatma (bir kun oldin xabar)
- Statistika eksporti (Excel)
- Ko'p tilli interfeys (uz / ru)
