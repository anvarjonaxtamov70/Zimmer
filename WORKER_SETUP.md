# Cloudflare Worker — Render o'chganda buyurtma qabul qilish

Bu Worker bo'lsa Mini App **Render'siz to'liq ishlaydi**: mijoz tanilishi,
katalog, savat, **buyurtma berish** va adminga Telegram xabari. Render faqat
botni ishlatadi — Avto_A1 dagi kabi.

Worker **uxlamaydi** va bepul tarifda kuniga 100 000 so'rov beriladi — bitta
do'kon uchun bu juda ko'p.

---

## Nima ishlaydi

| Imkoniyat | Render ishlaganda | Render o'chganda |
|---|---|---|
| Katalog, mahsulot modali | ✅ | ✅ |
| Stories, bannerlar | ✅ | ✅ |
| **Rasmlar** (`file_id` bilan saqlanganlar ham) | ✅ | ✅ *Worker `/media`* |
| Savat, saqlanganlar | ✅ | ✅ |
| **Mijoz tanilishi** (ism, telefon, mashina) | ✅ | ✅ *Worker `/me`* |
| **Buyurtma berish** | ✅ | ✅ *Worker `/order`* |
| **Adminga Telegram xabari** | ✅ | ✅ *Worker yuboradi* |
| **Buyurtmalarim** tarixi | ✅ | ✅ |
| Navbat olish, Bi-LED buyurtmasi | ✅ | ⛔ serverni talab qiladi |
| Admin panel | ✅ | ⛔ serverni talab qiladi |

Bot ko'tarilganda Worker qabul qilgan buyurtmalar **o'zi bazaga ko'chiriladi**
(`sync.import_pending_orders`) — ular «Ombor», statistika va admin panelda
ko'rinadi.

---

## 1. Worker yaratish

1. <https://dash.cloudflare.com> → **Workers & Pages** → **Create** → **Worker**
2. Nom: `zimmer-bot` → **Deploy**
3. **Edit code** → hamma narsani o'chirib, repo ildizidagi
   **`cloudflare-worker.js`** faylining to'liq matnini qo'yish → **Deploy**

Manzil shunday bo'ladi: `https://zimmer-bot.<akkaunt>.workers.dev`

---

## 2. Secret'larni kiritish

**Settings → Variables and Secrets**

### Secret (yashirin) — «Encrypt» belgilangan bo'lsin

| Nom | Qiymat |
|---|---|
| `BOT_TOKEN` | BotFather tokeni |
| `FIREBASE_CLIENT_EMAIL` | `serviceAccount.json` dagi `client_email` |
| `FIREBASE_PRIVATE_KEY` | `serviceAccount.json` dagi `private_key` (**butun matn**, `-----BEGIN PRIVATE KEY-----` bilan birga) |

> `private_key` ichida `\n` belgilari bo'ladi — ularni **o'zgartirmang**.
> Worker ularni haqiqiy yangi qatorga o'zi aylantiradi.

### Oddiy o'zgaruvchi (Text)

| Nom | Qiymat |
|---|---|
| `FIREBASE_DB_URL` | `https://zimmer-42840-default-rtdb.firebaseio.com` |
| `FIREBASE_ROOT` | `zimmer` |
| `ADMIN_IDS` | `5105291033,483425630,5302078` |
| `INIT_DATA_MAX_AGE` | `86400` |

**Deploy** bosing.

---

## 3. Tekshirish

Brauzerda oching:

```
https://zimmer-bot.<akkaunt>.workers.dev/health
```

Shunday javob kelishi kerak:

```json
{
  "status": "ok",
  "configured": {
    "bot_token": true,
    "firebase_key": true,
    "db_url": true,
    "admins": 3
  }
}
```

Biror joyda `false` bo'lsa — o'sha o'zgaruvchi kiritilmagan.

> `/health` maxfiy qiymatlarni **ko'rsatmaydi** — faqat «kiritilgan / yo'q».

---

## 4. Manzilni ilovaga aytish

`docs/config.js` faylida:

```js
WORKER_URL: "https://zimmer-bot.<akkaunt>.workers.dev",
```

Commit qilib push qilsangiz, GitHub Pages 1–2 daqiqada yangilanadi.

---

## 5. Katalogni bulutga chiqarish (bir marta)

Worker buyurtma summasini **katalogdan** o'qiydi. Katalog bulutda bo'lmasa
buyurtma qabul qilinmaydi (`503`, «Katalog o'qilmadi»).

Bot ishlab turganda botga yuboring:

```
/firebase
```

Javobda «Bulutga yuklandi: N katalog yozuvi, M mijoz» ko'rinadi.

> Bot ishga tushganda buni **o'zi** ham bajaradi (`initial_sync`).

---

## Xavfsizlik — nima uchun bu yechim Avto_A1 dagidan yaxshiroq

Avto_A1 da buyurtmani **mijozning brauzeri** to'g'ridan-to'g'ri Firebase'ga
yozadi. Bu quyidagilarni ochib qo'yadi:

| Muammo | Avto_A1 | Zimmer (bu Worker) |
|---|---|---|
| Summani mijoz yuboradi | `total: 0` yozish mumkin | Summa **katalogdan**, server tomonda hisoblanadi. Mijoz yuborgani **o'qilmaydi** |
| Statusni mijoz yozadi | `status: "yetkazildi"` mumkin | Majburan `"new"` |
| Adminga xabar | Mijoz `notified_admin: true` yozib **botning xabarini o'chirib** qo'yadi | Bu maydonni **faqat server** yozadi |
| Yozuv yiqilsa | `.catch(function(){})` yutadi — buyurtma **yo'qoladi**, mijoz «qabul qilindi» ko'radi | Xato **mijozga qaytariladi** va aniq aytiladi |
| Ikki marta bosilsa | Ikki buyurtma | **Idempotent** — bitta buyurtma |
| Firebase qoidalari | Mijozga **yozish** huquqi kerak | Brauzerga **hech qanday** huquq berilmaydi |
| Firebase SDK | ~300 KB yuklanadi | **Kerak emas** |

Barcha chaqiruvlar Telegram `initData` **HMAC imzosi** bilan tekshiriladi.
`uid` **imzodan** olinadi, so'rov tanasidan emas — shuning uchun birov
boshqa mijoz nomidan buyurtma bera olmaydi.

---

## Muammolar

| Belgi | Sabab va yechim |
|---|---|
| `/health` da `firebase_key: false` | `FIREBASE_CLIENT_EMAIL` yoki `FIREBASE_PRIVATE_KEY` kiritilmagan |
| Buyurtmada «Katalog o'qilmadi» (503) | Botga `/firebase` yuborilmagan — katalog bulutda yo'q |
| «imzo mos kelmadi» (401) | `BOT_TOKEN` xato yoki boshqa botning tokeni |
| «initData eskirgan» (401) | Ilova uzoq ochiq turgan. Yopib qayta oching, yoki `INIT_DATA_MAX_AGE` ni oshiring |
| Rasmlar ko'rinmaydi | `WORKER_URL` `docs/config.js` da yozilmagan |
| Adminga xabar kelmaydi | `ADMIN_IDS` kiritilmagan, yoki admin botga hech qachon `/start` yozmagan (Telegram noma'lum chatga yozishga ruxsat bermaydi) |

Loglarni ko'rish: Cloudflare → Worker → **Logs** → **Begin log stream**.
