# ☁️ Zimmer botni bulutga joylash (Render.com — bepul)

Bot 24/7 ishlashi uchun kompyuterni yoqib qo'yish shart emas. Quyidagi
qadamlar Avto_A1 botidagi bilan bir xil sxemada ishlaydi:
**`render.yaml` blueprint + `/health` endpoint + GitHub Actions keep-alive**.

---

## 1. Render'da xizmat yaratish (5 daqiqa)

1. [render.com](https://render.com) → **Sign in with GitHub**
2. Yuqoridagi **New +** → **Blueprint**
3. Repo ro'yxatidan **`Zimmer`** ni tanlang → **Connect**
   - Render repo ildizidagi `render.yaml` ni o'zi topadi va
     `zimmer-bot` nomli bepul web xizmatini taklif qiladi
4. **Apply / Create** bosing
5. Render maxfiy qiymatlarni so'raydi — ularni kiritasiz:

| Kalit | Qiymat |
|---|---|
| `BOT_TOKEN` | BotFather bergan token |
| `ADMINS` | Telegram ID'ingiz (bir nechta bo'lsa vergul bilan: `123,456`) |

> ID'ni bilish: botga `/id` yuboring yoki [@userinfobot](https://t.me/userinfobot).

6. **Deploy** tugashini kutamiz (2-4 daqiqa). **Logs** bo'limida shunday
   qator chiqishi kerak:

```
Health server ishga tushdi: 0.0.0.0:10000 (/health)
Bot ishga tushdi: @sizning_bot (123456789)
```

7. Tekshirish: brauzerda **`https://zimmer-bot.onrender.com/health`** ni
   ochsangiz shunday javob keladi:

```json
{"status": "ok", "bot": "sizning_bot", "uptime_seconds": 42, ...}
```

Endi Telegram'da botga `/start` yozib sinab ko'ring. ✅

---

## 2. Botni uxlab qolishdan saqlash

Bepul tarifda Render xizmatni **15 daqiqa so'rov bo'lmasa uxlatadi**.
Repodagi `.github/workflows/keep-alive.yml` har 10 daqiqada `/health`
manziliga ping yuborib botni uyg'oq tutadi.

Sozlash:

1. GitHub repo → **Actions** → agar so'rasa **"I understand my workflows,
   go ahead and enable them"** bosing
2. Render bergan manzil `https://zimmer-bot.onrender.com` dan farq qilsa:
   **Settings → Secrets and variables → Actions → Variables → New variable**
   - Name: `KEEP_ALIVE_URLS`
   - Value: `https://sizning-manzilingiz.onrender.com`
3. Qo'lda tekshirish: **Actions → Keep Alive → Run workflow**

---

## 3. ⚠️ Ma'lumotlar saqlanishi (muhim!)

Bepul tarifda Render diskni **saqlamaydi**: har qayta deploy yoki
konteyner restartida `zimmer.db` fayli **noldan yaratiladi** — navbatlar,
buyurtmalar va foydalanuvchilar yo'qoladi.

Sinab ko'rish uchun bu yetarli. **Haqiqiy mijozlar bilan ishlashdan oldin**
quyidagilardan birini tanlash kerak:

| Variant | Narxi | Izoh |
|---|---|---|
| **Neon / Supabase PostgreSQL** | bepul | Tavsiya etiladi. Bulutdagi doimiy baza, kod PostgreSQL'ga o'tkaziladi |
| **Firebase Realtime DB** | bepul | Avto_A1'da ishlatilgani kabi (siz allaqachon tanishsiz) |
| **Render Persistent Disk** | ~$7/oy | SQLite o'z holida qoladi, hech narsa o'zgartirilmaydi |

> Bu ishni menga aytsangiz, alohida PR qilib bajarib beraman —
> `database/queries.py` faylidagi so'rovlar PostgreSQL'ga moslashtiriladi,
> qolgan kod o'zgarmaydi.

---

## 4. Yangilanishlarni chiqarish

`autoDeploy: true` yoqilgani uchun `main` branch'ga har push avtomatik
qayta deploy qiladi. Qo'lda: Render panel → **Manual Deploy → Deploy latest commit**.

---

## 5. Ko'p uchraydigan muammolar

**`TelegramConflictError: terminated by other getUpdates request`**
Bot ikki joyda bir vaqtda ishlayapti. Kompyuterdagi `python bot.py` ni
to'xtating — bitta token bilan faqat bitta nusxa ishlashi kerak.

**Deploy "live" bo'ldi, lekin bot javob bermaydi**
Logs'ni oching. `BOT_TOKEN topilmadi` degan xato bo'lsa — Render panel →
**Environment** bo'limida token kiritilganini tekshiring.

**Xizmat "Bad Gateway" / port xatosi**
`/health` serveri `PORT` env orqali ishlaydi, uni Render o'zi beradi.
`startCommand` `python bot.py` bo'lishi kerak (`render.yaml` da shunday).

**Birinchi javob sekin (30-60 soniya)**
Bot uxlagan bo'lsa, "sovuq start" vaqt oladi. Keep-alive workflow yoqilgan
bo'lsa, bu deyarli bo'lmaydi.

**Admin panel ochilmayapti**
`ADMINS` ichida sizning ID borligini tekshiring, o'zgartirgandan keyin
Render xizmatni qayta ishga tushiradi.


---

# 📱 Mini App'ni yoqish (GitHub Pages)

Mini App — bu Telegram ichida ochiladigan ilova. Kodi `docs/` papkasida,
bepul **GitHub Pages**da turadi (Avto_A1'dagi kabi).

## 1. GitHub Pages qanday ishlaydi (allaqachon yoqilgan)

Sayt **`gh-pages`** branchidan chiqariladi:

```
docs/ (main branch)  ──workflow──>  gh-pages branch  ──>  GitHub Pages
```

`gh-pages` branch push qilinganda GitHub Pages'ni **o'zi yoqadi** —
Settings bo'limiga kirish shart emas. Holat:

```
source: { branch: "gh-pages", path: "/" }   status: built
https://anvarjonaxtamov70.github.io/Zimmer/
```

Bundan keyin `docs/` ichida biror narsa o'zgarsa,
`.github/workflows/sync-pages.yml` workflow'i `gh-pages` ni avtomatik
yangilaydi. Qo'lda ishga tushirish: **Actions → Mini App'ni gh-pages'ga
chiqarish → Run workflow**.

> ### ❗ Nima uchun oldingi usul ishlamadi
> Dastlab `actions/configure-pages` (`enablement: true`) ishlatilgan edi —
> u Pages saytini API orqali yaratmoqchi bo'ladi va quyidagi xato bilan
> to'xtaydi:
>
> ```
> Create Pages site failed.
> Error: Resource not accessible by integration
> ```
>
> Sabab: workflow'ning `GITHUB_TOKEN`'i Pages saytini **yaratish**
> huquqiga ega emas (GitHub cheklovi). `gh-pages` usulida esa faqat
> oddiy `git push` kerak — shuning uchun ishonchli.

### Zaxira variant (kerak bo'lsa)

Settings → **Pages** → Source: `Deploy from a branch` →
branch **`gh-pages`**, papka **`/ (root)`**.

`main` branchning ildizida ham `index.html` bor — agar kimdir Pages'ni
`main` / `(root)` ga o'tkazsa, u foydalanuvchini `docs/` ga yo'naltiradi
(Telegram'ning `#tgWebAppData` qismi saqlanib qoladi).

### ⚠️ Manzildagi katta harf muhim

GitHub Pages manzili **harf registriga sezgir**. Repo nomi `Zimmer`
bo'lgani uchun faqat shu ko'rinish ishlaydi:

| ✅ To'g'ri | ❌ 404 beradi |
|---|---|
| `https://anvarjonaxtamov70.github.io/Zimmer/` | `.../zimmer/` (kichik z) |

Oxiridagi `/` ni ham qo'shib yozing.

> Tekshirish: manzilni brauzerda ochsangiz, "Ilovani Telegram ichidan
> oching" degan xabar chiqadi — bu **to'g'ri** ishlayotganini bildiradi.

## 2. BotFather'ga URL'ni berish

Telegram'da [@BotFather](https://t.me/BotFather):

1. `/mybots` → botingizni tanlang
2. **Bot Settings** → **Menu Button** → **Configure menu button**
3. URL sifatida yuboring:

```
https://anvarjonaxtamov70.github.io/Zimmer/
```

4. Tugma nomi: `Ilova`

> Bot ishga tushganda menyu tugmasini **o'zi ham** o'rnatadi
> (`set_menu_button`), lekin BotFather'da qo'lda qo'yish ham foydali.

## 3. Server manzilini moslash

Mini App ma'lumotlarni bot ichidagi API'dan oladi. Manzil `docs/config.js`
da yozilgan:

```js
window.ZIMMER_CONFIG = { API_BASE: "https://zimmer-bot.onrender.com" };
```

Render'dagi manzilingiz boshqacha bo'lsa, shu qatorni to'g'rilang.
Sinash uchun vaqtincha URL orqali ham berish mumkin:

```
https://anvarjonaxtamov70.github.io/Zimmer/?api=https://boshqa-nom.onrender.com
```

Render panelida esa `MINI_APP_URL` o'zgaruvchisi Pages manziliga
to'g'ri kelishini tekshiring (bot shu URL bilan tugma yasaydi).

## 4. Xavfsizlik qanday ishlaydi

Mini App har so'rovda Telegram bergan `initData` ni yuboradi:

```
Authorization: tma <initData>
```

Server uni bot tokeni bilan HMAC-SHA256 orqali tekshiradi
(`api/auth.py`). Ya'ni:

- foydalanuvchi o'z ID'sini almashtirib **boshqa odam nomidan**
  navbat yoki buyurtma bera olmaydi;
- imzosi yo'q yoki 24 soatdan oshgan so'rov qabul qilinmaydi;
- botda ro'yxatdan o'tmagan odam API'ga kira olmaydi (`403 not_registered`).

## 5. Mini App muammolari

**"Server javob bermadi" chiqadi**
`docs/config.js` dagi `API_BASE` Render manziliga to'g'ri kelmayapti yoki
xizmat uxlagan. `https://zimmer-bot.onrender.com/health` ni brauzerda
tekshiring.

**"Ro'yxatdan o'tish kerak" chiqadi**
Bu odam botda ism/telefon qoldirmagan. Botga `/start` yuborib ro'yxatdan
o'tsa, ilova ochiladi.

**Sayt 404 beradi**
Uchta sabab bo'lishi mumkin, shu tartibda tekshiring:

1. **Pages yoqilmagan yoki `gh-pages` branch yo'q** — Actions →
   *Mini App'ni gh-pages'ga chiqarish* → **Run workflow**.
   Yoki Settings → Pages'da source `gh-pages` / `(root)` bo'lishi kerak.
2. **Manzilda kichik harf** — `/zimmer/` emas, `/Zimmer/` bo'lishi shart.
3. **Deploy hali tugamagan** — Actions'da workflow yashil ✅ bo'lishini kutin
   (birinchi marta 1-2 daqiqa).

**Sahifa oq / eski versiya ko'rinadi**
GitHub Pages keshi. Telegram'da: Sozlamalar → Ma'lumot va xotira →
Keshni tozalash. Yoki `?v=2` qo'shib oching.

**Rasm ko'rinmaydi**
Mahsulot rasmi Telegram serverida saqlanadi va `/api/photo/<id>` orqali
uzatiladi. Bot uxlagan bo'lsa rasm kelmaydi — keep-alive workflow yoqilganini
tekshiring.


---

# 🔥 Firebase: mijozlar va tovarlarni doimiy saqlash

## Nima uchun kerak

Render'ning bepul tarifida disk saqlanmaydi — qayta deployda `zimmer.db`
tozalanadi. Firebase ulangan bo'lsa:

- ro'yxatdan o'tgan **mijozlar Firebase'ga yoziladi** va bot qayta ishga
  tushganda **o'zi tiklab oladi** → foydalanuvchi qaytadan ro'yxatdan
  o'tmaydi ("bir umrlik" baza);
- **tovarlar rasm URL'lari bilan** Firebase'dan import qilinadi → mahsulot va
  rasmlarni saytdan boshqarish mumkin;
- har bir buyurtma nusxasi Firebase'da qoladi (tarix yo'qolmaydi).

Avto_A1 bilan **bir xil usul**: service-account → OAuth token → RTDB REST.

## Sozlash (5 daqiqa)

1. [Firebase Console](https://console.firebase.google.com) → loyihani tanlang
   (Avto_A1 uchun: `avtoa1shop`)
2. **⚙️ Project settings → Service accounts → Generate new private key**
3. Yuklab olingan JSON faylni ochib, **butun matnini** nusxalang
4. Render panel → xizmat → **Environment** → quyidagilarni qo'shing:

| Kalit | Qiymat |
|---|---|
| `SERVICE_ACCOUNT_JSON` | JSON'ning butun matni (yoki base64) |
| `FIREBASE_DB_URL` | `https://avtoa1shop-default-rtdb.firebaseio.com` |
| `FIREBASE_ROOT` | `zimmer` |

5. **Save** → xizmat qayta ishga tushadi. Logda ko'rinadi:

```
Firebase ulandi: https://avtoa1shop-default-rtdb.firebaseio.com/zimmer
Firebase'dan N mijoz qaytarildi
Firebase'dan M tovar import qilindi
```

> `FIREBASE_ROOT=zimmer` — Zimmer ma'lumotlari **alohida tugunda** turadi,
> Avto_A1 ma'lumotlariga tegmaydi. Bir xil bazani bo'lishmoqchi bo'lsangiz
> `FIREBASE_ROOT` ni bo'sh qoldiring.

## Ma'lumot tuzilishi

```
zimmer/
├── users/<user_id>/profile   { uid, name, phone, username, carId, carName }
├── products/<key>            { name, desc, price, oldPrice, stock, img,
│                               category, car, badge, active }
├── biled_orders/<id>         { uid, car, biled, shroud, color, total, status }
├── orders/<id>               { uid, items[], total, address, status }
└── bookings/<id>             { uid, service, date, time, status }
```

## Tovar qo'shish (rasm bilan)

`zimmer/products` tuguniga yozing:

```json
{
  "lens-a5": {
    "name": "Aozoom A5+ 3.0",
    "desc": "11 000 lm, 1 yil kafolat",
    "price": 1900000,
    "oldPrice": 2100000,
    "stock": 8,
    "img": "https://.../lens-a5.jpg",
    "category": "Lampalar",
    "car": "gentra",
    "badge": "TOP",
    "active": true
  }
}
```

- `img` — rasm to'g'ridan-to'g'ri shu manzildan ko'rsatiladi (Firebase Storage,
  sayt yoki CDN — farqi yo'q);
- `car` — mashina **slug**'i (`gentra`, `nexia2`) yoki bo'sh (barcha uchun);
- `category` — nomi mos kelmasa yangi kategoriya avtomatik yaratiladi.

O'zgarishlar bot qayta ishga tushganda import qilinadi (Render'da
**Manual Deploy → Restart** yoki keyingi deployda).

## Firebase ulanmasa nima bo'ladi?

Hech narsa buzilmaydi: bot va ilova SQLite bilan ishlaydi, logda shunchaki
`Firebase sozlanmagan` deb yoziladi. Buyurtmalar, navbatlar — hammasi
ishlaydi, faqat qayta deployda mahalliy baza tozalanadi.
