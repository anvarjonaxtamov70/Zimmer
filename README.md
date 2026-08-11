# 🤖 Zimmer — Telegram Mini App + bot

**Navbat olish** va **mahsulot xarid qilish** uchun Telegram ilovasi.
Foydalanuvchi botda faqat ro'yxatdan o'tadi, keyin barcha ishni
**Mini App** ichida bajaradi.

```
   Telegram
      │
      ├── 🤖 Bot (aiogram 3)        ── ro'yxatdan o'tish + ilovaga yo'naltirish
      │      └── ⚙️ Admin panel     ── navbat/buyurtmalarni boshqarish
      │
      └── 📱 Mini App (GitHub Pages)
                   │  Authorization: tma <initData>   (HMAC imzo tekshiriladi)
                   ▼
             🌐 API (bot ichida, aiohttp) ──> 🗄 SQLite
```

Hosting: bot + API — **Render.com** (bepul), Mini App — **GitHub Pages** (bepul).

---

## 📱 Mini App imkoniyatlari

- 🗓 **Navbat olish**: xizmat → kun (bo'sh joy soni ko'rinadi) → bo'sh vaqt → tasdiqlash
- 🛍 **Do'kon**: kategoriyalar, mahsulot kartochkalari (rasm, tavsif, narx, ombor)
- 🧺 **Savatcha**: son o'zgartirish, o'chirish, jami summa (telefon xotirasida saqlanadi)
- 🚚 **Buyurtma**: manzil + telefon → yuborish
- 👤 **Kabinet**: navbatlarim (bekor qilish), buyurtmalarim va ularning holati
- 🎨 Telegram mavzusiga (tungi/kunduzgi) moslashadi, haptik javob, BackButton

## 🤖 Bot imkoniyatlari

- 📱 Ro'yxatdan o'tish: ism + telefon (tugma orqali yoki qo'lda)
- 🚀 «Ilovani ochish» tugmasi va ko'k **Menu** tugmasi — ikkisi ham Mini App'ni ochadi
- 🔔 Har bir navbat/buyurtma bo'yicha tasdiq xabarlari
- Zaxira sifatida botning o'zida ham ishlaydi: `/navbat`, `/dokon`

## ⚙️ Admin panel (`/admin`)

- 📊 Statistika (foydalanuvchi, navbat, buyurtma, umumiy savdo)
- 🗓 Kun bo'yicha navbatlar → tasdiqlash / bajarildi / bekor qilish
- 📦 Buyurtmalar → qabul qilish / yetkazildi / bekor qilish
- 🛠 Xizmat qo'shish va yoqib-o'chirish
- 🗂 Kategoriya, 🛍 mahsulot qo'shish (rasm bilan)
- 📣 Barcha foydalanuvchilarga ommaviy xabar
- Holat o'zgarganda mijozga avtomatik xabar boradi

---

## 🚀 Lokal ishga tushirish

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
MINI_APP_URL=https://anvarjonaxtamov70.github.io/Zimmer/
```

Telegram ID'ni bilish uchun botga `/id` yuboring yoki
[@userinfobot](https://t.me/userinfobot).

```bash
python bot.py
```

Birinchi ishga tushirishda `zimmer.db` avtomatik yaratiladi va namuna
xizmat/mahsulotlar qo'shiladi.

> Mini App API'sini lokal sinash uchun: `API_PORT=8080 python bot.py`
> (Render'da `PORT` avtomatik beriladi).

## ☁️ Bulutga joylash

To'liq qo'llanma: **[DEPLOY.md](DEPLOY.md)**

1. **Bot + API** → Render.com: New → Blueprint → `Zimmer` repo → `BOT_TOKEN`, `ADMINS`
2. **Mini App** → GitHub Pages: Actions → *Deploy Mini App (GitHub Pages)* →
   **Run workflow** (Pages'ni o'zi yoqadi, keyin har o'zgarishda avtomatik yangilanadi)
3. **BotFather** → Menu Button URL: `https://anvarjonaxtamov70.github.io/Zimmer/`
   (katta harf bilan `Zimmer` — manzil harf registriga sezgir)

> ⚠️ Render'ning bepul tarifida disk saqlanmaydi — qayta deployda SQLite
> bazasi tozalanadi. Doimiy saqlash variantlari DEPLOY.md da.

## 🔐 Xavfsizlik

Mini App har so'rovda `Authorization: tma <initData>` yuboradi. Server uni
bot tokeni bilan HMAC-SHA256 orqali tekshiradi (`api/auth.py`) — boshqa odam
nomidan navbat yoki buyurtma berish mumkin emas. Ro'yxatdan o'tmagan
foydalanuvchi API'ga kira olmaydi.

## 📋 Sozlamalar (`.env`)

| O'zgaruvchi | Ma'nosi | Standart |
|---|---|---|
| `BOT_TOKEN` | BotFather tokeni | — |
| `ADMINS` | Admin ID'lari, vergul bilan | — |
| `MINI_APP_URL` | Mini App manzili (GitHub Pages) | `.../Zimmer/` |
| `SHOP_NAME` | Bot/do'kon nomi | `Zimmer` |
| `DB_PATH` | SQLite fayli | `zimmer.db` |
| `TIMEZONE` | Vaqt zonasi | `Asia/Tashkent` |
| `WORK_START_HOUR` | Ish boshlanishi (soat) | `9` |
| `WORK_END_HOUR` | Ish tugashi (soat) | `18` |
| `SLOT_MINUTES` | Navbat oralig'i (daqiqa) | `30` |
| `BOOKING_DAYS_AHEAD` | Necha kun oldinga navbat | `7` |
| `CURRENCY` | Valyuta yozuvi | `so'm` |
| `API_PORT` | Lokal sinov uchun API porti | — |

## 📁 Loyiha tuzilishi

```
Zimmer/
├── bot.py                # kirish nuqtasi (polling + API server)
├── config.py             # .env sozlamalari
├── render.yaml           # Render.com deploy blueprint
├── DEPLOY.md             # bulutga joylash qo'llanmasi
├── .github/workflows/    # keep-alive ping
├── api/                  # Mini App uchun REST API
│   ├── auth.py           # initData HMAC tekshiruvi
│   ├── routes.py         # endpointlar
│   ├── server.py         # aiohttp ilovasi + /health + CORS
│   └── errors.py         # JSON xato formati
├── docs/                 # Mini App (GitHub Pages shu papkani chiqaradi)
│   ├── index.html
│   ├── app.js            # butun ilova mantiqi
│   ├── styles.css        # Telegram mavzusiga moslashgan uslublar
│   └── config.js         # API_BASE manzili
├── database/
│   ├── db.py             # ulanish, jadvallar, namuna ma'lumot
│   └── queries.py        # barcha SQL so'rovlar
├── handlers/             # start, queue, shop, cart, orders, admin, fallback
├── keyboards/            # reply va inline tugmalar
├── states/               # FSM holatlar
└── utils/                # helperlar, matnlar, komandalar
```

## 🗄 Ma'lumotlar bazasi

`users`, `services`, `bookings`, `categories`, `products`, `cart_items`,
`orders`, `order_items`. Sxema `database/db.py` ichida — bot ishga
tushganda avtomatik yaratiladi.

## 🌐 API endpointlari

| Metod | Yo'l | Vazifasi |
|---|---|---|
| GET | `/health` | Render tiriklik tekshiruvi |
| GET | `/api/config` | do'kon nomi, valyuta, ish vaqti |
| GET | `/api/me` | foydalanuvchi profili, ro'yxatdan o'tganmi |
| GET | `/api/services` | xizmatlar ro'yxati |
| GET | `/api/dates?service_id=` | kunlar + har birida bo'sh joy soni |
| GET | `/api/slots?service_id=&date=` | bo'sh vaqtlar |
| POST | `/api/bookings` | navbat olish |
| GET | `/api/bookings` | mening navbatlarim |
| POST | `/api/bookings/{id}/cancel` | navbatni bekor qilish |
| GET | `/api/catalog` | kategoriyalar + mahsulotlar |
| GET | `/api/photo/{id}` | mahsulot rasmi (Telegram'dan) |
| POST | `/api/orders` | buyurtma berish |
| GET | `/api/orders` | mening buyurtmalarim |

## 🔮 Keyingi rejalar

- To'lov tizimlari (Payme/Click) integratsiyasi
- Navbat haqida eslatma (bir kun oldin xabar)
- PostgreSQL'ga o'tish (doimiy saqlash)
- Ko'p tilli interfeys (uz / ru)
