# Firebase Realtime Database qoidalari

Qoidalar `database.rules.json` faylida. U **ataylab izohsiz** — izohlar Firebase
Console'ning tahrirlagichida muammo tug'dirishi mumkin, shuning uchun tushuntirish
shu faylda turadi. Ikki nusxa saqlanmaydi, ya'ni ular bir-biridan ajralib ketmaydi.

> ⚠️ **QOIDALAR YANGILANDI — QAYTA PUBLISH QILISH SHART.**
> Ilgari mijozlar bazasi (ism, telefon) va buyurtmalar hammaga ochiq edi.
> Yangi qoidalarni qo'ymasangiz ular ochiq qolib ketadi. Pastdagi
> «Qanday qo'yiladi» bo'limiga qarang.

## Qanday qo'yiladi

1. https://console.firebase.google.com — loyihani tanlang
2. Chap menyu: **Build** → **Realtime Database**
3. Yuqoridagi **Rules** yorlig'i
4. Oynadagi hammani o'chirib, quyidagi manzildagi matnni qo'ying:

   <https://raw.githubusercontent.com/anvarjonaxtamov70/Zimmer/main/database.rules.json>

   (Ctrl+A → Ctrl+C → Console'da Ctrl+A → Ctrl+V)

5. **Publish** tugmasini bosing

Chatdan yoki hujjatdan nusxa olmang — faqat yuqoridagi manzildan. Aks holda
qo'shtirnoqlar va apostroflar buzilib, Console xato beradi.

## Tekshirish

Publish qilgandan keyin quyidagilarni bir marta bosib chiqing:

| Tekshiruv | Kutilgan natija |
|---|---|
| Do'kon ochilishi, tovarlar ko'rinishi | ✅ ishlaydi (`catalog` o'qish ochiq) |
| Admin → **Ombor** → qoldiqni o'zgartirish | ✅ ishlaydi (`catalog` yozish ochiq) |
| Admin → **Tovar qo'shish** | ✅ ishlaydi |
| **Xizmatlar** → navbat olish → bo'sh vaqtlar | ✅ ishlaydi (`slots` tuguni) |
| Admin → **Buyurtmalar** | ⚠️ `WORKER_URL` sozlangan bo'lishi SHART |
| Kabinet → **Buyurtmalarim** (Render o'chganda) | ⚠️ `WORKER_URL` sozlangan bo'lishi SHART |

«Baza qoidalari ruxsat bermadi» chiqsa — Publish o'tmagan.

### Console Publish'ni rad etsa

Firebase qoidalarni Publish paytida **kompilyatsiya qiladi** — JSON
to'g'ri bo'lsa ham ifodada xato bo'lishi mumkin.

| Xato | Sabab | To'g'ri yozilishi |
|---|---|---|
| `! only operates on booleans` | `!` faqat mantiqiy qiymat ustida ishlaydi. `.val()` esa har qanday turni qaytaradi | `x.val() != true` (`!x.val()` emas) |
| `Unknown method` | Metod nomi xato yoki bu qoidalar tilida yo'q | Firebase hujjatidagi nomni tekshiring |
| `No such method/property` | `data` va `newData` almashib ketgan | `.validate` da `newData`, `.write` da `data` |

`!` ni **faqat** boolean qaytaruvchi metodlar bilan ishlatish mumkin:
`exists()`, `hasChild()`, `hasChildren()`, `isNumber()`, `isString()`,
`isBoolean()`, `matches()`, `contains()`, `beginsWith()`, `endsWith()`.

---

## Model

Uch xil yo'l bor va ularning huquqi **har xil**:

| Kim | Qanday ulanadi | Qoidalar unga ta'sir qiladimi |
|---|---|---|
| **Bot** (Render) | Xizmat kaliti (service account) | ❌ yo'q — to'liq huquq |
| **Cloudflare Worker** | Xizmat kaliti + initData imzosini tekshiradi | ❌ yo'q — to'liq huquq |
| **Mini App** (brauzer) | Autentifikatsiyasiz REST | ✅ **faqat shu qoidalar** |

Ya'ni qoidalar **faqat brauzerni** cheklaydi. Bot va Worker ular orqali
o'tadi — shuning uchun tugunni yopish bot ishini buzmaydi.

### Asosiy tamoyil: shaxsiy ma'lumot ochiq tugunda turmaydi

Brauzer ma'lumotni faqat quyidagi hollarda o'qiy oladi:

- **ommaviy** bo'lsa (tovar, narx, banner, bo'sh vaqtlar), yoki
- **hech kimning shaxsiy ma'lumoti bo'lmasa**.

Ism, telefon, manzil bor tugunlar brauzer uchun **yopiq**. Ularni Worker
beradi — u avval Telegram imzosini tekshiradi.

---

## Nima ochiq (brauzer uchun)

| Tugun | O'qish | Yozish | Izoh |
|---|---|---|---|
| `catalog/*` | ✅ | ✅ tekshiruv bilan | Do'kon vitrinasi. Admin paneli brauzerdan yozadi |
| `slots/{sana}` | ✅ | ✅ tekshiruv bilan | **Faqat vaqt va davomiylik.** Shaxsiy ma'lumot YO'Q |
| `bookings/{id}` | ❌ | ✅ tekshiruv bilan | Navbat yozish mumkin, **ro'yxatni o'qish mumkin emas** |
| `biled_orders/{id}` | ❌ | ✅ tekshiruv bilan | Xuddi shunday |
| `pending_orders/{id}/status` | ❌ | ✅ faqat holat | Admin holatni o'zgartirishi uchun. **Yangi buyurtma yozib bo'lmaydi** |
| `story_views`, `story_reactions` | ✅ | ✅ tekshiruv bilan | Faqat Telegram id va emoji |
| `products_counter/n`, `stories_counter/n` | ✅ | ✅ faqat o'sish | Yangi id sanoqchisi |

### Yozishda nima tekshiriladi

`catalog` yozish ochiq, lekin **qiymat turlari va shakli tekshiriladi**:

- barcha `*_url` va `link` — faqat `https://` bilan boshlanadi
  → `javascript:` yoki ochiq yo'naltirish (open redirect) qo'yib bo'lmaydi;
- `color_from`, `color_to`, `hex_from`, `hex_to`, `glow`, `ring_color` —
  faqat `#rrggbb` yoki rang nomi
  → **CSS injection yopildi** (ilgari bu qiymat `style` ichiga to'g'ridan
  qo'yilardi va ichiga `url(...)` yozib IP manzilni sizdirish mumkin edi);
- `price`, `old_price`, `stock`, `duration_min` — faqat son va oqilona
  chegara ichida → narxni `-1` yoki `1e30` qilib bo'lmaydi;
- matn maydonlariga uzunlik chegarasi → bazani matn bilan to'ldirib bo'lmaydi;
- `imported`, `sqlite_id`, `notified_admin` — **brauzerdan yozilmaydi**.

Oxirgisi muhim: ilgari `imported: true` deb yozib qo'yish mumkin edi va bot
o'sha buyurtmani «allaqachon ko'chirilgan» deb **butunlay o'tkazib ketardi**.
Ya'ni haqiqiy buyurtmani bazaga tushirmaslik mumkin edi.

---

## Nima yopiq — va nega

| Tugun | Nima uchun yopiq | Brauzer o'rniga qayerdan oladi |
|---|---|---|
| `users` | **Har bir mijozning ismi va telefoni** | Worker `/me`, `/profile` |
| `favorites` | Kim nimani saqlagani | Render `/api/favorites` |
| `pending_orders` | Ism, telefon, **manzil** | Worker `/me` va `/admin/orders` |
| `bookings` | Ism, telefon | Worker `/admin/orders` (`kind: booking`) |
| `biled_orders` | Ism, telefon | Worker `/admin/orders` (`kind: biled`) |
| `story_replies` | Mijoz yozgan xabar matni | Worker |
| `orders` | Botning SQLite nusxasi | — |
| `products` | Excel qoralamalari va **ta'minotchi narxlari** | — |
| `pending_products`, `pending_edits` | Worker yozadi, brauzer o'qimaydi | — |
| `admins` | Adminlar ro'yxati | — |

### Nega `bookings` yopiq bo'lsa ham navbat ishlaydi

Bo'sh vaqtni hisoblash uchun ilgari **butun `bookings` tuguni** o'qilardi —
ya'ni bo'sh vaqtni ko'rsatish uchun hammaning telefonini ochish kerak edi.

Endi bandlik alohida tugunda:

```
slots/2026-09-01/{navbat_id} = { "time": "14:00", "duration_min": 60 }
```

Ichida **na ism, na telefon, na xizmat nomi**. Mini App shuni o'qiydi
(`docs/js/offline.js` → `takenSlots`), bot esa yozib turadi
(`services/sync.py` → `push_booking_slot`). Navbat bekor qilinsa yozuv
o'chiriladi va vaqt yana bo'sh bo'ladi.

---

## `WORKER_URL` endi majburiy

Ilgari Worker **ixtiyoriy** edi: u sozlanmasa Mini App to'g'ridan bazaga
murojaat qilardi. Endi shaxsiy ma'lumotli tugunlar yopiq, shuning uchun
quyidagilar Worker'siz ishlamaydi:

- Admin → **Buyurtmalar** (uchta bo'lim: do'kon, Bi-LED, navbat)
- Kabinet → **Buyurtmalarim** (Render o'chgan paytda)

Sozlash: `docs/config.js` → `WORKER_URL`. Batafsil: `WORKER_SETUP.md`.

> Worker `/admin/orders` endi `kind` parametrini oladi
> (`order` | `biled` | `booking`). **Worker'ni qayta deploy qilish kerak** —
> aks holda Bi-LED va navbat ro'yxatlari bo'sh ko'rinadi.

---

## Qolgan ochiq joy (ongli qaror)

`catalog` **yozish** brauzer uchun ochiq qolgan — chunki admin paneli
(`docs/js/admin-shop.js`) bazaga to'g'ridan yozadi va u
autentifikatsiyadan o'tmaydi. Ya'ni baza manzilini bilgan odam hali ham
**narx va qoldiqni o'zgartira oladi** (lekin endi faqat to'g'ri turdagi
qiymat bilan — yuqoridagi tekshiruvlar).

To'liq yopish uchun admin yozuvlari himoyalangan yo'lga o'tishi kerak:
Render'da `/api/admin/*` (initData + admin tekshiruvi bilan) yoki Worker'da
`/admin/product` va `/admin/edit` — **ikkisi ham allaqachon bor va
ishlaydi**. `admin-shop.js` ni ularga o'tkazgandan keyin `catalog` yozishni
ham `false` qilish mumkin.

Bu keyingi qadam sifatida qoldirildi: hozirgi o'zgarish shaxsiy
ma'lumotning oshkor bo'lishini to'xtatadi, admin paneli esa ishlashda
davom etadi.
