# 🔥 ZIMMER — Bi-LED avtotuning

Bi-LED linza **sotish va o'rnatish** uchun Telegram Mini App + bot.
Mijoz botda faqat ro'yxatdan o'tadi, qolgan hammasi ilova ichida bo'ladi.

```
   Telegram
      │
      ├── 🤖 Bot (aiogram 3)      ── ro'yxatdan o'tish + ilovaga yo'naltirish
      │      └── ⚙️ Admin panel   ── buyurtma va navbatlarni boshqarish
      │
      └── 📱 Mini App (GitHub Pages) — qora/qizil premium dizayn
                   │  Authorization: tma <initData>  (HMAC imzo tekshiriladi)
                   ▼
             🌐 API (bot ichida, aiohttp) ──> 🗄 SQLite
```

Hosting: bot + API — **Render.com** (bepul), Mini App — **GitHub Pages** (bepul).

---

## 🎯 Buyurtma berish oqimi (konfigurator)

Mijoz ilovaga kirganda salomlashadi, so'ng 4 qadam:

| Qadam | Nima tanlanadi | Ko'rinish |
|---|---|---|
| 1️⃣ | **Mashina** — Gentra yoki Nexia 2 | Vektor siluet, yoniq fara aksenti |
| 2️⃣ | **Bi-LED linza** — 5 xil model (ZES, Koito, Hella, Aozoom) | Fara chizmasi paydo bo'ladi, linza yonadi |
| 3️⃣ | **Ochki (maska)** — klassik, Devil Eyes, Angel Eyes, sport, karbon | Halqa fara ichida real vaqtda o'zgaradi |
| 4️⃣ | **Fara optikasi rangi** — xrom, matt qora, tutun, qizil, oltin | Korpus gradienti almashadi |
| ✅ | Yakuniy narx + izoh → buyurtma | Confetti + ✓ animatsiyasi |

Har bir tanlovda **fara SVG'si qayta chiziladi**: linza yorug'ligi, nur konusi,
DRL chizig'i, ochki halqasi va korpus rangi o'zgaradi. Rasm fayllari kerak emas —
hammasi vektor va CSS animatsiya.

Buyurtma yuborilgach mijoz **asosiy menyuga** o'tadi.

## 🏠 Asosiy menyu (Avto_A1 uslubida)

- 📸 **Stories** — gradient halqali doiralar, to'liq ekran ko'rish, progress chiziq, 5s avtomatik
- 🖼 **Banner karusel** — snap-scroll, avtomatik almashish, nuqtali indikator
- 🎁 **Aksiyalar** — chegirma badge'lari bilan gorizontal kartalar
- 🔧 **Konfigurator CTA** — yaltiroq (sheen) animatsiya bilan
- 🗓 **O'rnatishga navbat** — bottom sheet: xizmat → kun → bo'sh vaqt
- 🛍 **Mahsulotlar** — **faqat tanlangan mashinaga mos** + universal tovarlar
- 🧺 Savatcha va 👤 Kabinet (Bi-LED buyurtmalari, navbatlar, buyurtmalar)

## 👤 Ro'yxatdan o'tish — to'siqsiz

Ilovaga kirishda **hech qanday to'siq yo'q**. Foydalanuvchi Telegram
`initData`si asosida **avtomatik** bazaga qo'shiladi (ismi Telegram'dan
olinadi) — katalog, konfigurator va narxlar darhol ko'rinadi.

**Telefon faqat buyurtma bosilganda** so'raladi: ilova ichidagi kichik forma —
Telegram raqamini bir tugma bilan yuborish (`requestContact`) yoki qo'lda
kiritish. Bir marta kiritiladi, keyin boshqa so'ralmaydi.

## 🔥 Firebase — mijozlar va tovarlar doimiy saqlanadi

Avto_A1 bilan bir xil usul: service-account → OAuth token → RTDB REST.

- Mijozlar Firebase'ga yoziladi va bot qayta ishga tushganda **o'zi tiklanadi**
  → Render qayta deploy qilsa ham foydalanuvchi qaytadan ro'yxatdan o'tmaydi
- **Tovarlar rasm URL'lari bilan** Firebase'dan import qilinadi → mahsulot va
  rasmlarni saytdan boshqarish mumkin
- Buyurtma va navbatlar nusxasi Firebase'da qoladi (tarix yo'qolmaydi)

Sozlash: `SERVICE_ACCOUNT_JSON`, `FIREBASE_DB_URL`, `FIREBASE_ROOT` —
batafsil [DEPLOY.md](DEPLOY.md). Firebase ulanmasa ham hammasi ishlaydi
(faqat mahalliy bazada saqlanadi).

## ⚙️ Admin panel (`/admin`)

- 🔥 **Bi-LED buyurtmalar** — to'liq konfiguratsiya ko'rinadi (mashina, linza, ochki, rang, narx)
  - holatlar: 🆕 yangi → ✅ qabul → 🔧 ishda → ✨ topshirildi (mijozga avtomatik xabar)
- 📊 Statistika — Bi-LED, navbat va do'kon bo'yicha alohida + umumiy savdo
- 🗓 Kun bo'yicha navbatlar, 📦 do'kon buyurtmalari, 📣 ommaviy xabar
- 🗂 **Katalogni boshqarish** (`/katalog`) — pastda batafsil

### 🗂 Katalogni boshqarish — hamma narsa tahrirlanadi

10 bo'lim, bitta universal interfeys: 💡 Bi-LED linzalar · 🕶 Ochkilar ·
🎨 Optika ranglari · 🚗 Mashinalar · 🛍 Mahsulotlar · 🗂 Kategoriyalar ·
🔧 Xizmatlar · 🖼 Bannerlar · 📸 Stories · 🎁 Aksiyalar.

Har bir element uchun:

| Amal | Qanday |
|---|---|
| ✏️ Har bir maydonni tahrirlash | Nom, narx, tavsif, brend, kelvin, lumen, kafolat, badge, rang (HEX), tartib... |
| 🖼 Rasm qo'shish | Telegram'ga rasm yuborasiz **yoki** URL yozasiz (Firebase/sayt/CDN) |
| 🎬 Video qo'shish | Video/GIF yuborasiz yoki URL yozasiz — ilovada «Video» tabida ko'rinadi |
| 👁 Ko'rish · 🗑 O'chirish | Yuklangan media'ni tekshirish yoki olib tashlash |
| 🟢/🔴 Yoqish–yashirish | Mijozga ko'rinmasin, lekin ma'lumot saqlanib qolsin |
| ➕ Yangi qo'shish | Faqat majburiy maydonlar so'raladi, qolganini keyin to'ldirasiz |
| 🗑 Butunlay o'chirish | Tasdiqlash so'raladi |

Kiritilgan qiymatlar tekshiriladi (narx — son, rang — `#rrggbb`, media — fayl
yoki `https://`), jadval/ustun nomlari **oq ro'yxat** bilan cheklangan —
SQL injection mumkin emas.

---

## 🚀 Lokal ishga tushirish

```bash
git clone https://github.com/anvarjonaxtamov70/Zimmer.git
cd Zimmer

python3 -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install -r requirements.txt

cp .env.example .env             # BOT_TOKEN va ADMINS ni yozing
python bot.py
```

Birinchi ishga tushirishda `zimmer.db` yaratiladi va katalog to'ldiriladi:
2 mashina, 5 linza, 5 ochki, 5 rang, 3 xizmat, 9 mahsulot, banner/story/aksiyalar.

> Mini App API'sini lokal sinash: `API_PORT=8080 python bot.py`

## ☁️ Bulutga joylash

To'liq qo'llanma: **[DEPLOY.md](DEPLOY.md)**

1. **Bot + API** → Render: New → Blueprint → `Zimmer` → `BOT_TOKEN`, `ADMINS`
2. **Mini App** → GitHub Pages allaqachon yoqilgan (`gh-pages` branch).
   `docs/` o'zgarsa, workflow uni avtomatik yangilaydi
3. **BotFather** → Menu Button URL: `https://anvarjonaxtamov70.github.io/Zimmer/`

## ⚡ Ishlash (telefon qizmasligi uchun)

Animatsiyaga boy, lekin **arzon** — Apple ilovalaridagidek silliq:

| Qoida | Nima qilingan |
|---|---|
| `filter: blur()` yo'q | Yumshoq nur radial-gradient bilan (GPU uchun deyarli bepul) |
| SVG filtrlari yo'q | `feGaussianBlur` olib tashlandi — fara nuri gradientlar bilan |
| Cheksiz animatsiya 1 ta | Faqat linzaning «nafas olishi» (opacity), qolgani bir martalik |
| Fonga o'tsa to'xtaydi | `visibilitychange` → `body.paused` + videolar pauza |
| `backdrop-filter` 3 joyda | Faqat topbar, home header va navbar |
| Uzun ro'yxatlar | `content-visibility: auto` — ko'rinmayotgan qism hisoblanmaydi |
| Scroll hodisasi | `requestAnimationFrame` bilan cheklangan |
| Videolar | `preload="none"` — bosilmaguncha yuklanmaydi |
| Media | Tashqi URL bo'lsa server orqali o'tmaydi (to'g'ridan-to'g'ri) |
| Telegram fayllari | Oqim (stream) bilan uzatiladi, `Range` qo'llab-quvvatlanadi |

`prefers-reduced-motion` hurmat qilinadi — tizimda animatsiya o'chirilgan
bo'lsa, ilova ham tinch ishlaydi.

## 🔐 Xavfsizlik

Har so'rovda `Authorization: tma <initData>` yuboriladi va server uni bot
tokeni bilan HMAC-SHA256 orqali tekshiradi (`api/auth.py`). Boshqa odam
nomidan buyurtma berish yoki narxni o'zgartirish mumkin emas — **narx doim
bazadan** hisoblanadi, mijoz yuborgan qiymatga ishonilmaydi.

## 📋 Sozlamalar (`.env`)

| O'zgaruvchi | Ma'nosi | Standart |
|---|---|---|
| `BOT_TOKEN` | BotFather tokeni | — |
| `ADMINS` | Admin ID'lari, vergul bilan | — |
| `MINI_APP_URL` | Mini App manzili | `.../Zimmer/` |
| `SHOP_NAME` | Brend nomi | `Zimmer` |
| `DB_PATH` | SQLite fayli | `zimmer.db` |
| `TIMEZONE` | Vaqt zonasi | `Asia/Tashkent` |
| `WORK_START_HOUR` / `WORK_END_HOUR` | Ish vaqti | `9` / `18` |
| `SLOT_MINUTES` | Navbat oralig'i | `30` |
| `BOOKING_DAYS_AHEAD` | Necha kun oldinga navbat | `7` |
| `CURRENCY` | Valyuta | `so'm` |
| `API_PORT` | Lokal API porti | — |
| `FIREBASE_DB_URL` | Realtime Database manzili | — (o'chirilgan) |
| `FIREBASE_ROOT` | Firebase'dagi tugun nomi | `zimmer` |
| `SERVICE_ACCOUNT_JSON` | Firebase service-account JSON (yoki base64) | — |

## 📁 Tuzilishi

```
Zimmer/
├── bot.py                 # polling + API server
├── config.py
├── api/
│   ├── auth.py            # initData HMAC tekshiruvi
│   ├── routes.py          # barcha endpointlar
│   ├── media.py           # rasm/video uzatish (stream + Range)
│   ├── server.py          # aiohttp + CORS + /health
│   └── errors.py
├── docs/                  # Mini App (gh-pages ga chiqadi)
│   ├── index.html
│   ├── styles.css         # qora/qizil tema, 24 ta animatsiya
│   ├── config.js          # API_BASE
│   └── js/
│       ├── headlight.js   # parametrik fara SVG
│       ├── cars.js        # mashina siluetlari
│       └── app.js         # oqim, asosiy menyu, stories
├── services/
│   ├── firebase.py        # RTDB REST + service-account token
│   └── sync.py            # mijoz/tovar/buyurtma sinxronizatsiyasi
├── database/
│   ├── db.py              # sxema, migratsiya, katalog
│   └── queries.py         # SQL so'rovlar
├── handlers/
│   ├── admin.py           # buyurtmalar, statistika, broadcast
│   ├── admin_crud.py      # universal katalog tahrirlash dvigateli
│   ├── admin_schema.py    # bo'limlar va maydonlar tavsifi (sof mantiq)
│   └── start, queue, shop, cart, orders, fallback
├── keyboards/ states/ utils/
└── .github/workflows/     # keep-alive + gh-pages sinxronizatsiya
```

## 🗄 Ma'lumotlar bazasi

**Tuning:** `cars`, `biled_types`, `shrouds`, `optic_colors`, `biled_orders`
**Do'kon:** `categories`, `products` (`car_id` bilan), `cart_items`, `orders`, `order_items`
**Navbat:** `services`, `bookings`
**Kontent:** `banners`, `stories`, `promos`
**Xizmat:** `users` (`car_id`), `meta` (seed versiyasi)

Eski bazaga yangi ustunlar avtomatik qo'shiladi (`_migrate`), katalog esa
`seed_version` orqali yangilanadi — buyurtmalar bor bo'lsa tegilmaydi.

## 🌐 API

| Metod | Yo'l | Vazifasi |
|---|---|---|
| GET | `/health` | Render tiriklik tekshiruvi |
| GET | `/api/config` | brend, valyuta, ish vaqti |
| GET | `/api/me` · POST `/api/me/car` | profil, mashinani saqlash |
| POST | `/api/register` | ilova ichida ism + telefon saqlash |
| GET | `/api/cars` | mashinalar |
| GET | `/api/tuning` | linzalar + ochkilar + ranglar |
| POST/GET | `/api/biled-orders` | konfiguratsiya buyurtmasi |
| GET | `/api/home` | stories, banner, aksiya, mahsulotlar |
| GET | `/api/catalog` | katalog (mashinaga qarab) |
| GET | `/api/media/{jadval}/{id}/{photo\|video}` | rasm/video (stream, Range) |
| GET | `/api/services` · `/api/dates` · `/api/slots` | navbat uchun |
| POST/GET | `/api/bookings` (+`/cancel`) | navbat |
| POST/GET | `/api/orders` | do'kon buyurtmalari |

## 🔮 Keyingi qadamlar

- Yana mashinalar (Cobalt, Spark, Malibu...) — admin paneldan qo'shish
- Haqiqiy fara/ish rasmlari (hozir vektor chizma)
- To'lov (Payme/Click) va bo'lib to'lash
- PostgreSQL (Render'da doimiy saqlash uchun)
- uz / ru tillari
