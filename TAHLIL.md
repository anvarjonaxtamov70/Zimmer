# Zimmer — loyihaning to'liq tahlili

Sana: 2026-08-30 · Tekshirilgan hajm: ~14 600 satr Python + ~18 200 satr JavaScript + 7 832 satr CSS

Bu hujjat loyihaning barcha qatlamini o'qib chiqib yozildi: bot, API, Firebase
sinxronizatsiyasi, Mini App va admin panel. Har bir topilma uchun **qayerda**,
**nima bo'ladi** va **nega shunday** yozilgan.

---

## 1. Loyiha nima ish qiladi

Zimmer — avtotuning (Bi-LED linza, optika, aksessuar) do'koni. Uch qismdan iborat:

| Qism | Nima qiladi |
|---|---|
| **Telegram bot** (aiogram 3) | Buyurtma, savat, navbat, admin CRUD — hammasi chat ichida |
| **Mini App** (GitHub Pages) | Do'kon, konfigurator, stories, kabinet, admin panel — brauzerda |
| **API server** (aiohttp) | Mini App uchun REST; bot bilan **bitta protsessda** ishlaydi |
| **Firebase RTDB** | Doimiy nusxa — Render bepul tarifda diskni o'chiradi |
| **Cloudflare Worker** | Render o'chganda buyurtma qabul qiladi |

Ma'lumot yo'li: `SQLite (asosiy) → Firebase (nusxa) → Worker (zaxira)`.
Mini App esa **4 qatlamli zaxira** bilan o'qiydi:
`Firebase → /api/home → localStorage keshi → docs/catalog.json`.

### Nimasi yaxshi (halol baho)

Bu o'yinchoq loyiha emas — ancha jiddiy ishlar qilingan:

- **initData tekshiruvi to'g'ri yozilgan** (`api/auth.py:39-88`) — HMAC, `compare_digest`,
  `auth_date` muddati. Ko'p loyihada bu joy buzuq bo'ladi, bu yerda emas.
- **Admin huquqi "jonli" registrdan o'qiladi** (`config.py:213-287`) — yangi admin
  qo'shsa restart kerak emas, huquqni olib qo'ysa darhol ishlaydi. **Bitta ham
  himoyasiz admin endpoint topilmadi.**
- **Buyurtma holati yagona qoida mexanizmida** (`services/orders.py`) — bekor qilingan
  buyurtmani qayta ochib bo'lmaydi.
- **4 qatlamli zaxira** — server ham, Firebase ham o'lsa mijoz do'konni ko'radi.
  Bu haqiqiy hodisadan keyin yozilgan va ishlaydi.
- **78 ta CSS animatsiya, 16 ta `prefers-reduced-motion` bloki, to'liq haptic
  feedback** — vizual sifat yuqori.
- **Kod izohlari juda yaxshi** — har bir qaror "nega shunday" bilan yozilgan.
  Bu tahlilni yozishga aynan shu izohlar yordam berdi.

Ya'ni muammo "bilmaslik" emas. Muammo — loyiha juda tez o'sgan va ba'zi joyda
ikkita yechim yonma-yon qolib ketgan.

---

## 2. XATOLAR — xavflilik bo'yicha

### 🔴 1-daraja: pul yoki ma'lumot yo'qoladi

#### 1.1 Firebase qoidalari butunlay ochiq — mijozlar bazasi ko'chirilishi mumkin

**Qayerda:** `database.rules.json`

```json
"users":          { ".read": true, ".write": true },
"pending_orders": { ".read": true, ".write": true },
"catalog":        { ".read": true, ".write": true }
```

**Nima bo'ladi:** Firebase manzili Mini App ichida ochiq turadi (`docs/config.js`).
Ya'ni har qanday odam brauzerdan bitta so'rov yuborib:

- **barcha mijozning ismi, telefoni, username'ini yuklab oladi** (`zimmer/users`);
- **narxlarni o'zgartiradi** — keyin `sync.restore_catalog()` o'sha narxni
  SQLite'ga import qiladi;
- **soxta buyurtma yozadi** (`pending_orders`) — `sync.import_pending_orders()`
  uni **haqiqiy buyurtma** deb bazaga kiritadi va adminga xabar yuboradi.

**Nega shunday bo'lgan:** Worker va Mini App to'g'ridan-to'g'ri yozishi kerak edi,
eng oson yo'l — qoidani ochib qo'yish. `orders`, `products`, `admins` yopiq —
ya'ni to'g'ri yo'l bilinadi, faqat qolganiga yetmagan.

**Bu eng jiddiy muammo.** Boshqa hammasidan oldin shuni tuzatish kerak.

#### 1.2 Ombor "atomik" kamaymaydi — bitta tovar ikki kishiga sotiladi

**Qayerda:** `database/queries.py:822-869` (`create_order_from_items`), `:402-441`

```python
product = await get_product(product_id)      # 1) qoldiqni O'QIYDI
if qty > int(product["stock"]): ...          # 2) tekshiradi
...
await db.execute("UPDATE products SET stock = MAX(stock - ?, 0) ...")  # 3) kamaytiradi
```

**Nima bo'ladi:** 1 va 3 orasida `await` bor. Oxirgi 1 dona tovarga ikki mijoz
bir vaqtda buyurtma bersa — **ikkisi ham 2-qadamdan o'tadi**, ikkita buyurtma
yaratiladi, qoldiq 0 ga tushadi. Bittasiga tovar yo'q.

**Nega:** SQL o'qish va yozish ajratilgan. To'g'ri yo'li — bitta so'rov:
`UPDATE products SET stock = stock - ? WHERE id = ? AND stock >= ?`.

#### 1.3 Bir vaqtga ikki navbat yozilishi mumkin

**Qayerda:** `api/routes.py:671-680`, `handlers/queue.py:170-183`

`free_slots()` bo'sh vaqtni tekshiradi, keyin `add_booking()` yozadi — orasida
himoya yo'q, `bookings(date, time)` ustuniga UNIQUE cheklov ham yo'q.
Natija: soat 14:00 ga ikki mijoz yoziladi, usta bilmaydi.

#### 1.4 Buyurtma `201` qaytaradi, lekin bulutga tushmagan bo'lishi mumkin

**Qayerda:** `services/sync.py:31-38`

```python
_PENDING_LIMIT = 500
if len(_pending) < _PENDING_LIMIT:
    _pending[path] = {...}
# 500 dan oshsa — JIMGINA tashlanadi, log ham yozilmaydi
```

Bundan tashqari `push_order()` natijasini **hech kim tekshirmaydi** —
API baribir `201 Yaratildi` deydi. Render qayta deploy bo'lsa SQLite o'chadi,
bulutda esa o'sha buyurtma yo'q. **Buyurtma butunlay yo'qoladi.**

#### 1.5 Firebase "ulangan" deb ko'rsatadi, lekin token muddati o'tgan

**Qayerda:** `services/firebase.py:188-200`

```python
def token():
    return getattr(_creds, "token", None) if _creds is not None else None

def is_enabled():
    return bool(config.firebase_db_url) and token() is not None
```

`token()` **muddatini tekshirmaydi**. Muddati o'tgan token ham `None` emas,
ya'ni `is_enabled()` → `True`. Natijada barcha yozuv 401 bilan qaytadi va
`push_status`, `firebase_products` ularni jimgina tashlab ketadi.
Refresher esa 30 daqiqada bir ishlaydi — ya'ni **yarim soat ma'lumot yo'qoladi**.

---

### 🟠 2-daraja: ilova buziladi yoki noto'g'ri ishlaydi

#### 2.1 Katalog seansda BIR MARTA o'qiladi — admin o'zgartirishi ko'rinmaydi

**Qayerda:** `docs/js/app.js:1290-1297`

```js
if (!S.home) S.home = await ZimmerOffline.home({ strict: !S.offline });
if (!S.home && !S.offline) S.home = await api("/api/home");
```

`S.home` bir marta to'lgach **boshqa hech qachon yangilanmaydi**.

**Bu ayni maqsadni buzadi.** Kod izohida (`app.js:1279-1315`) aynan shu yozilgan:
"admin Firebase'ga yozadi, mijoz SQLite'dan o'qiydi — mos kelmaydi, endi yagona
manba Firebase". Lekin `if (!S.home)` qorovuli sababli admin yangi tovar qo'shsa
ham, narxni o'zgartirsa ham, mijoz **ilovani yopib qayta ochmaguncha ko'rmaydi**.

Hatto admin ko'prigi ham buni bilmaydi: `app.js:5941-5944` da `loadHome` maxsus
"tovar qo'shilgandan keyin katalogni qayta o'qish uchun" berilgan — lekin u
ishlamaydi.

**Yechim oson:** `loadHome(force)` parametri qo'shish.

#### 2.2 Konfigurator bir marta ishlatilgandan keyin butunlay o'ladi

**Qayerda:** `docs/js/app.js:1068-1077`

```js
document.querySelector(".flow-body").innerHTML = `<div class="done-wrap">...`;
$("done-home").onclick = () => location.reload();
```

Buyurtma bergandan keyin **butun konfigurator DOM'i o'chiriladi**. Tiklanishi
faqat `location.reload()` ga bog'langan. Lekin mijoz o'sha tugmani bosmasdan
Telegram'ning **orqaga tugmasini** yoki pastdagi menyuni bossa — reload bo'lmaydi.
Keyin konfiguratorga qaytsa: `renderCars()` → `$("cars")` = `null` →
`setStep()` (`app.js:605`) `null.classList` da **TypeError** →
**konfigurator seans oxirigacha ishlamaydi**.

`setStep()` da bitta ham `null` tekshiruvi yo'q.

#### 2.3 Qoldig'i noma'lum tovarni cheksiz savatga qo'shish mumkin

**Qayerda:** `docs/js/app.js:2640`

```js
if (have + want > product.stock) return toast(`Omborda ${product.stock} dona bor`);
```

`product.stock` `undefined` bo'lsa → `NaN > NaN` → `false` → **cheklov ishlamaydi**.
Mijoz 50 dona qo'shadi, checkout'da 409 xato oladi va nima bo'lganini tushunmaydi.

#### 2.4 Bitta telefonda ikki akkaunt savatni bo'lishadi

**Qayerda:** `docs/js/app.js:409-416`, `:6443-6447`, `:1095`

```js
localStorage.getItem("zimmer_cart")
localStorage.getItem("zimmer_addresses")
"zimmer_offline_favorites"
```

Kalitlarda **Telegram user id yo'q**. Ota-bola bir telefondan kirsa — savat,
manzillar va saqlanganlar aralashadi.

Qizig'i: profil uchun bu **to'g'ri qilingan** — `offlineMe()` (`app.js:1183-1190`)
keshni `initDataUnsafe.user.id` bilan tekshiradi. Ya'ni usul bor, savatga
qo'llanmagan.

#### 2.5 Rasmga yo'naltirish (redirect) buzilgan

**Qayerda:** `api/server.py:36-41`

```python
except web.HTTPException as error:
    response = web.json_response({...}, status=error.status)   # ← Location YO'QOLADI
```

`media.py:115` va `routes.py:769-776` `web.HTTPFound` (302) ishlatadi — tashqi
rasm manziliga yo'naltirish uchun. Middleware **yangi javob yasaydi va
`Location` sarlavhasini tashlab ketadi**. Natija: brauzer manzilsiz 302 oladi,
**rasm ochilmaydi**.

#### 2.6 Excel import butun serverni to'xtatadi

**Qayerda:** `handlers/admin_import.py:118,132`

```python
df = pd.read_excel(io.BytesIO(file_bytes))   # to'g'ridan-to'g'ri coroutine ichida
```

`pandas` **bloklaydi**. Bot, API, `/health`, self-ping — hammasi bitta event
loop'da. Katta fayl kelsa **hammasi muzlaydi**. Render `/health` javob
bermaganini ko'rib xizmatni qayta ishga tushiradi → SQLite o'chadi.

`asyncio.to_thread` to'g'ri usuli **shu loyihada allaqachon bor**
(`firebase.py:185`) — bu joyga qo'llanmagan. Xuddi shu muammo
`api/admin.py` da 45 MB `upload.file.read()` da ham bor.

#### 2.7 Navbat bekor qilinsa bulutda `new` bo'lib qoladi

**Qayerda:** `api/routes.py:733`, `handlers/queue.py:248`

```python
await q.set_booking_status(booking_id, "cancelled")   # to'g'ridan-to'g'ri
```

Boshqa hamma joy `orders.apply()` orqali o'tadi — u holatni tekshiradi **va
`sync.push_status()` chaqiradi**. Bu ikki joy chetlab o'tadi:
- tugagan navbatni "bekor qilish" mumkin;
- **Firebase'da holat `new` bo'lib qoladi** → zaxira rejimda mijoz bekor
  qilingan navbatni faol deb ko'radi.

#### 2.8 Zaxira rejimdan chiqish yo'li yo'q va ogohlantirish ham yo'q

**Qayerda:** `docs/js/app.js:1246-1265`

Ikki funksiya ataylab bo'shatilgan:
- `renderOfflineBar()` — chiziqni **o'chiradi**;
- `scheduleServerRecheck()` — faqat eski intervalni tozalaydi, **tekshirmaydi**.

Natijada `S.offline = true` bo'lgach:
1. Render tiklansa ham **rejim qaytmaydi**;
2. Buyurtma va navbat `offlineBlocked()` bilan bloklangan;
3. **Mijoz buni bilmaydi** — "Rasmiylashtirish" ni bosgandagina "biz bilan
   bog'laning" oynasini ko'radi.

Izohda "bezovta qilardi" deb yozilgan — to'g'ri, lekin butunlay olib tashlash
o'rniga jimgina belgi qo'yish kerak edi.

#### 2.9 Telefon/manzilda `<` belgisi bo'lsa admin xabari yo'qoladi

**Qayerda:** `api/routes.py:846-870`, `handlers/cart.py:300-345`

Mijozning ismi, manzili, izohi `parse_mode=HTML` xabariga **escape qilinmasdan**
qo'yiladi. Mijoz ismida `<` bo'lsa Telegram xabarni rad etadi →
`notify_admins` yiqiladi → **admin buyurtmani ko'rmaydi** (mijozga xabar
`try` ichida, adminga yo'q).

Frontend'da `esc()` hamma joyda to'g'ri ishlatilgan — backend'da unutilgan.

---

### 🟡 3-daraja: sekinlik va texnik qarz

#### 3.1 Har bir mijoz 231 KB admin kodini yuklaydi

`admin.js` (61 KB) + `admin-shop.js` (103 KB) + `admin-crm.js` (41 KB) +
`admin-stories.js` (26 KB) = **231 KB**, `docs/index.html:714-722`.

Admin tugmasi `me.is_admin` bo'lmasa yashiriladi — lekin **kod baribir
yuklanadi**. 3 kishi admin, minglab mijoz yuklaydi.

#### 3.2 Hech bir script `defer` emas

`index.html:701-723` — 12 ta script **ketma-ket, bloklab** yuklanadi,
birinchi piksel chizilishidan oldin. Jami ~680 KB JS + 260 KB CSS +
6 og'irlikdagi Google Fonts.

`bts.js` — **61 KB bitta satrdagi JSON** (O'zbekistondagi barcha BTS
filiallari). Faqat checkout'ning BTS shoxida kerak, lekin har ochilishda
o'qiladi.

#### 3.3 Ikkita raqobatchi tovar bazasi

| Tizim | Qayerda | Kim ishlatadi |
|---|---|---|
| SQLite `products` + `catalog/products` | `services/sync.py:682-830` | API, Mini App |
| RTDB `products` (o'z ID sxemasi) | `services/firebase_products.py` | `/add_product`, Excel import |

`/add_product` yoki Excel bilan qo'shilgan tovar **Mini App'da ko'rinmaydi** —
`sync.import_products()` ishlamaguncha. Firebase qoidasi esa `products` ni
yopgan, ya'ni Worker ham o'qiy olmaydi. Bu joyda ikkita loyiha kodi
(Zimmer + Avto_A1) qo'shilib ketgan.

#### 3.4 Firebase'da har amal butun tugunni yuklaydi

`firebase_products.py:250-360` — `get_product`, `update_product`,
`delete_product`, `toggle_product`, `decrease_stock` **hammasi** butun
`products` tugunini yuklab, Python'da qidiradi. `toggle` esa ikki marta.

Excel'dan 200 tovar import qilinsa → **200 marta butun tugun yuklanadi**.

#### 3.5 Transaksiya yo'q, ulanish bitta

`queries.py` da 60+ joyda alohida `await db.commit()`. `BEGIN IMMEDIATE` yo'q.
Va **bitta global `aiosqlite` ulanishi** (`db.py:781-784`) bot, API va fon
vazifalari orasida bo'lishiladi.

Ya'ni `create_order_from_items` ning `await`lari orasida boshqa coroutine
`commit()` qilsa — **buyurtma tarkibsiz yoki qoldiq kamaymagan holda
saqlanib qolishi mumkin**.

#### 3.6 Boshqa sanoq

- **Sahifalash yo'q** — hamma ro'yxatda qattiq chegara (`LIST_LIMIT=200`,
  inventar 500, `get_orders` 15). Oshsa **jimgina kesiladi**.
- `orders(status)` ustuniga **indeks yo'q**, lekin `get_orders(status=...)`
  o'sha ustundan filtrlaydi.
- **Rate limiting umuman yo'q.** `POST /api/register` har chaqiruvda
  **barcha adminga** xabar yuboradi — spam qilish oson.
- **`GET /api/config` himoyasiz** — karta raqami, egasi, admin username
  hammaga ochiq (`routes.py:163-182`).
- **Media proksisi himoyasiz** — id bo'yicha har qanday rasmni ko'rish va
  serverni tekinga trafik uzatishga majburlash mumkin.
- **initData 7 kun amal qiladi** (`config.py:178`), `0` esa cheksiz.
  `Access-Control-Allow-Origin: *` bilan birga — o'g'irlangan initData
  bilan istalgan sayt API'ni boshqaradi.
- **`MemoryStorage`** (`bot.py:113`) — Render restart bo'lsa yarim
  tugagan checkout yo'qoladi.
- **`Checkout.payment` va `Checkout.confirm` da matn handleri yo'q** —
  mijoz matn yozsa **hech qanday javob olmaydi** (`fallback.py:13`
  `StateFilter(None)` da).
- **`localStorage.zimmer_api`** — `?api=` bilan API manzilini almashtirish
  va **saqlab qo'yish** mumkin (`app.js:162-176`). Mijozga soxta manzilli
  havola berish yo'li.
- **Test va CI yo'q** — 4 ta workflow bor, hech biri Python'ni tekshirmaydi.
- **O'lik kod:** `firebase_storage.delete_product_images` hech qachon
  chaqirilmaydi → tovar o'chirilsa Storage'da rasm **abadiy qoladi**.
- **CSS takrorlanishi:** `.prod-art` **uch marta** e'lon qilingan
  (`styles.css:629`, `2305`, `5764`) — uchtasi ham boshqa balandlik beradi;
  `.skel` ikki marta (`673`, `2384`).
- **Shaxsiy ma'lumot kodda:** karta raqami `5614 6818 7479 6349` va
  `AXTAMOV ANVARJON` `config.py:184-190` da standart qiymat sifatida
  git tarixida turadi.

---

## 3. Qanday funksiya qo'shish mumkin

### 🔥 Eng ko'p pul olib keladigan uchtasi

#### 1. Tovar qidiruvi (hozir umuman yo'q)

Butun ilovada 5 ta matn maydoni bor: buyurtma izohi, **buyurtma tarixi
qidiruvi** (`mo-q`), stories javobi, manzil nomi/izohi.
**Katalog uchun qidiruv yo'q.**

Mijoz faqat kategoriya chiplari bilan ko'radi. "H4 linza" kerak bo'lsa —
qo'lda varaqlaydi va ketadi.

**Nega birinchi:** e-commerce'da qidiruvdan foydalangan mijoz o'rtacha
2-3 barobar ko'p sotib oladi, chunki u **nima kerakligini bilib kelgan**.
Chip mexanizmi `app.js:2388` da tayyor — qidiruvni shu yerga ilib qo'yish
oson.

#### 2. "Mashinamga mos" filtri

`p.car_id` bazada bor. `S.me.car` mijoz mashinasi bor. Kartochka hatto
"✓ Mashinangizga mos" yozuvini **allaqachon chizadi** (`app.js:2469`).
Lekin **filtr yo'q** — mijoz mos kelmaydigan tovarni ham ko'radi.

**Nega:** avtozapchast bozorida bu №1 savol. "Mos kelmasa qaytarish"
muammosi ham kamayadi. Ma'lumot bor, faqat tugma yo'q.

#### 3. Narx bo'yicha saralash va "faqat bor tovar"

Tartib qattiq: eng yangi ID birinchi (`buildShopProducts`, `app.js:2336`).
Arzonini izlagan mijoz uchun yo'l yo'q.

### 💰 Savdoni oshiruvchilar

| Funksiya | Nega kerak |
|---|---|
| **Sharh va reyting** | Kodda `rating`/`review` so'zi **umuman yo'q**. Avtozapchastda ishonch — asosiy to'siq. Bitta 5 yulduzli sharh narxdan ko'proq ishonch beradi |
| **"O'xshash tovarlar"** | Tovar oynasida hozir faqat "savatga". Yonига 4 ta o'xshash qo'yilsa — o'rtacha chek oshadi. `shuffle()` (`app.js:2291`) allaqachon bor, ishlatilmaydi |
| **Savatda qo'shimcha taklif** | "Linza oldingizmi? Ochki ham kerak" — eng arzon sotish usuli |
| **Promokod** | Hozir chegirma faqat `old_price`. Promokod bo'lsa stories/reklamaning **samarasini o'lchash** mumkin |
| **"Kelganda xabar bering"** | Tugagan tovarda tugma faqat o'chiriladi (`app.js:2521`). Mijoz ketadi va qaytmaydi. Email/Telegram xabari — tekin qaytish |
| **Tovarga havola (deep link)** | `startapp` parametri o'qilmaydi. Ya'ni **tovarni do'stiga yuborib bo'lmaydi**. Eng arzon reklama kanali yopiq |

### 🛠 Ishni yengillashtiruvchilar

| Funksiya | Nega kerak |
|---|---|
| **To'lov shlyuzi (Payme/Click)** | Hozir: karta raqamini nusxalash → chekni adminga yuborish → admin qo'lda tekshiradi. Har buyurtmada **~5 daqiqa qo'l mehnati** va xato ehtimoli |
| **Sahifalash** | 200 tovardan keyin ro'yxat **jimgina kesiladi**. Admin nimaga ba'zi tovar ko'rinmasligini tushunmaydi |
| **Xabarnoma sozlamasi** | Har buyurtma **barcha adminga**. 3 admin = 3 marta bezovtalik. "Kim qaysi turni oladi" sozlamasi kerak |
| **Yetkazish narxi va muddati** | Faqat `FREE_DELIVERY_TARGET = 3 000 000` bor. Kuryer narxi va "2-3 kun" ko'rinmaydi → mijoz operatorga qo'ng'iroq qiladi |
| **Excel eksport** | Import bor, eksport yo'q. Buxgalteriya uchun kerak |
| **Analitika** | Hech qanday telemetriya yo'q. Qaysi tovar ko'p ko'rilgan, qayerda savat tashlab ketilgan — **bilinmaydi**. Ya'ni qaysi funksiya foyda berganini o'lchash imkonsiz |

### 🎯 Sifat

- **Telegram mavzusi (theme)** — `themeParams` va `colorScheme` **butun kodda
  0 marta** ishlatilgan. Rang qattiq: `#08080a` (`app.js:5761`,
  `index.html:6`, `styles.css:18-60`). Oq mavzudagi mijoz **doim qora ilova**
  ko'radi va u Telegram'ning o'ziga mos kelmaydi.
- **`MainButton` ishlatilmagan** — 0 marta. Har CTA o'z tugmasi, shuning uchun
  klaviatura va safe-area muammosini qo'lda hal qilish kerak bo'lgan.
- **Foydalanish qulayligi (a11y):**
  - `user-scalable=no` (`index.html:5`) — **kattalashtirish butunlay yopiq**;
  - `#toast` da `aria-live` yo'q → skrinreader **xabarni o'qimaydi**;
  - `role=` atributi **butun ilovada 0 ta**;
  - manzil tugmalari faqat emoji: `✏️ 🗑 📋 🗺` (`app.js:4770`) — **nomi yo'q**;
  - modal oynalarda **fokus boshqarilmaydi** (`tabindex` 0 ta);
  - `:focus` qoidalari faqat `outline: none` — **almashtiruvchi yo'q**;
  - rasm `alt` doim bo'sh, hatto tovar nomi mavjud bo'lganda ham.
- **Moslashuvchanlik:** 18 ta `@media`, lekin **16 tasi `prefers-reduced-motion`**.
  Haqiqiy breakpoint **ikkita**: `380px` va `360px`. Ya'ni planshet, katta
  telefon, gorizontal holat — hech biri qaralmagan.
- **Ro'yxat virtualizatsiyasi** — 500 tovar bo'lsa hammasi bir yo'la DOM'ga
  chiziladi. `content-visibility: auto` chizishni tezlashtiradi, lekin
  **JS va DOM narxini kamaytirmaydi**.

---

## 4. Animatsiyalar

### Hozir nima bor (kutilganidan ancha ko'p)

**78 `@keyframes`, 124 `animation:`, 128 `transition:`** — `docs/styles.css`.

| Bo'lim | Animatsiyalar |
|---|---|
| Ochilish | `letterPop` (133), `splashOut` (164), `gateIn` (2916), `gateIconPulse` (2923) |
| Sahifa kirishi | `riseIn` (177), `fadeUp` (188), `pageIn` (208), `pageSlideIn` (2940), `stepIn` (327), `tileIn` (988), `rowIn` (1102), `coIn` (4928), `prodIn` (5963) |
| Savat | `cartRowIn` (1754), `cartBadgePulse` (1854), `cartBadgeBounce` (2649), `progressShine` (2745), `barUp` (1963), `bump` (494) |
| Tovar oynasi | `modalSlideUp` (2980), `modalSlideDown` (2991), `ivIn`/`ivOut` (6205/6209) |
| Stories | `storySpin` (788), `stRingIn` (6276), `stOpen` (6287), `stSlideL/R` (6390/6394), `stHeart` (6426), `heartBurst` (2376) |
| Buyurtmalar | `moTileIn` (7017), `moBadgePop` (7021), `moSpin` (7052), `moCardIn` (7104), **`moTrackDraw` (7147 — kuzatuv chizig'i)**, `moDotPop` (7184), `moNowPulse` (7188) |
| Xizmatlar | `svtIn` (7513), `sdIn`/`sdOut` (7544/7550), `sdPop` (7581), `svBeam` (7665), `svSweep` (7724) |
| Skeleton | `skelShimmer` (2395), `skelPulse` (2718), `shimmer` (3561), `chipShimmer` (2841), `typingDot` (2867) |
| Fikr-mulohaza | `toastIn` (856), `toastProgress` (2702), **`fall` (864 — konfetti)**, `draw` (881 — ✓ chizilishi), `favPop` (1243), `ctaGlow` (2598), `esFloat` (2789) |

JS bilan: bosqichma-bosqich kirish (`app.js:117-124`), summa sanashi
(`animateCartTotal` 2811), rAF story progressi (1505), konfetti `burst()` (141),
uchayotgan yurak (`flyHeart` 1897).

**Haptic to'liq ishlangan** (`app.js:100-115`) — menyu, chip, savat, galereya
(har rasmda `selection`!), pull-to-refresh, tekin yetkazish chegarasi.
Bu qatlam **kuchli tomon**.

### Nima yetishmaydi

#### 1. Tovar oynasini pastga surib yopish

Rasm ko'ruvchini surib yopish mumkin, story ham. **Tovar oynasi — yo'q**
(faqat X tugmasi). Bir ilovada ikki xil xatti-harakat — mijoz qo'li adashadi.

*Nega:* eng ko'p ochiladigan oyna. Bir xillik ishonch beradi.

#### 2. "Hero" o'tish — rasm kartochkadan oynaga o'sib chiqishi

Hozir kartochka bosilsa oyna **pastdan chiqadi** (`modalSlideUp`) va rasm
qaytadan yuklanadi. Aslida bosilgan rasm **o'sib** oynaga aylanishi kerak.

*Nega:* mijoz "qayerdan kelganini" ko'rmaydi va yo'nalishni yo'qotadi.
`View Transitions API` bilan ~20 satr kod.

#### 3. "Savatga uchish"

Hozir: `haptic()` + `bump` nishoni. Rasm **savatga uchmaydi**.

*Nega:* eng ko'p bosiladigan tugma. `flyHeart` (`app.js:1897`) uchun bu
allaqachon yozilgan — **o'sha kodni takrorlash yetadi**.

#### 4. Skeleton faqat 3 joyda

Bor: tovar (`.skel`), buyurtma (`.mo-skel`), xizmat (`svSkel`).
**Yo'q:** stories rings, bannerlar, tezkor plitkalar, profil kartochkasi —
ular **birdan paydo bo'ladi** va sahifa sakraydi.

Bundan tashqari tovar skeletoni **qattiq 2 ta** div va **faqat ro'yxat bo'sh
bo'lsa** (`app.js:1273`).

#### 5. Rasm o'lchami ko'rsatilmagan → sahifa sakraydi (CLS)

Hech bir yasalgan `<img>` da `width`/`height` yo'q. CSS'da `aspect-ratio`
7 832 satrda **5 marta**. Tovar kartochkasi `padding-top: 100%` hiylasiga
tayanadi — va `.prod-art` **uch xil e'lon qilingan**.

*Nega:* rasm yuklanganda matn siljiydi, mijoz **noto'g'ri tugmani bosadi**.

#### 6. Faqat buyurtmalarda pull-to-refresh

`app.js:6092-6163` — chiroyli ishlangan (66px chegara, 0.45 rezina, haptic).
Lekin **faqat `#orders` da**. Bosh sahifa, savat, saqlanganlarda yo'q.

*Nega:* mijoz bosh sahifada ham tortadi (odat), hech nima bo'lmaydi →
"ilova qotdi" deb o'ylaydi. **Va bu §2.1 dagi eskirgan katalog muammosining
tabiiy yechimi ham bo'lardi.**

#### 7. Toast navbatsiz

`app.js:126-133`: `clearTimeout(toast._t)` + ustidan yozish.
Ketma-ket 3 xato chiqsa — **birinchi ikkitasi ko'rinmaydi**.
`app.js:7489-7493` da aynan ketma-ket toast yuboriladi.

`toastProgress` (`styles.css:2702`) keyframe'i bor — ya'ni navbat
o'ylangan, yozilmagan.

#### 8. "Qaytarish" (undo) yo'q

Savatdan o'chirish, manzil o'chirish, savatni tozalash — hammasi
`ask()` bilan tasdiq so'raydi. **Undo bo'lsa tasdiq kerak emas** —
bir bosish kamayadi va noto'g'ri o'chirish ham tuzatiladi.

#### 9. Sahifalar orasida siljish yo'q

`show()` — `.hidden` almashtirish + `pageIn`. Yon tomonga siljish yoki
orqaga surish imkoniyati yo'q.

Bundan tashqari `show()` **doim tepaga sakraydi** (`app.js:509`) —
**scroll holati saqlanmaydi**. Tovar oynasidan qaytgan mijoz katalogning
**boshiga tushadi** va joyini qaytadan izlaydi.

*Bu ro'yxatdagi eng bezovta qiluvchi kamchilik.*

#### 10. Story videosi `preload="auto"`

`app.js:1597` — har bir story elementi **butunlay oldindan yuklanadi**.
Mobil internetda qimmat. `preload="metadata"` yetardi.

---

## 5. Nimadan boshlash kerak

### 1-hafta — xavfsizlik va pul (boshqa hamma narsadan oldin)

| № | Ish | Sabab |
|---|---|---|
| 1 | `database.rules.json` ni yopish | Mijozlar bazasi hozir ochiq turadi |
| 2 | Qoldiqni atomik kamaytirish: `WHERE stock >= ?` + `BEGIN IMMEDIATE` | Tovar ikki marta sotilmasin |
| 3 | `POST /api/orders` ga idempotency key | Ikki bosish = ikki buyurtma |
| 4 | `bookings(date, time)` ga UNIQUE | Ikki navbat bir vaqtga tushmasin |
| 5 | `sync._write` natijasini tekshirish, `_pending` to'lganini loglash | Buyurtma jimgina yo'qolmasin |
| 6 | `firebase.token()` muddatini tekshirish + `refresh_token()` ga lock | 30 daqiqalik ma'lumot yo'qolishi |
| 7 | `/api/config` va `/api/media/*` ni himoyalash, karta raqamini koddan olib tashlash | Rekvizitlar ochiq |
| 8 | Backend'da `html.escape()` | `<` belgisi buyurtmani yashirmasin |

### 2-hafta — ishlamayotgan joylar

| № | Ish | Sabab |
|---|---|---|
| 9 | `loadHome(force)` + pull-to-refresh | Admin o'zgartirishi ko'rinmaydi (§2.1) |
| 10 | `showDone()` ni tuzatish + `setStep()` ga `null` tekshiruvi | Konfigurator o'lib qoladi (§2.2) |
| 11 | `localStorage` kalitlariga user id | Savat aralashadi (§2.4) |
| 12 | `addToCart` da `NaN` tekshiruvi | Cheksiz qo'shish (§2.3) |
| 13 | `server.py:36-41` — `HTTPException` ni o'zini qaytarish | Rasm ochilmaydi (§2.5) |
| 14 | `pandas` va `file.read()` ni `asyncio.to_thread` ga | Server muzlaydi (§2.6) |
| 15 | Navbat bekor qilishni `orders.apply()` ga o'tkazish | Bulutda holat yangilanmaydi (§2.7) |
| 16 | Zaxira rejim belgisi + qayta tekshiruv | Mijoz sababni bilmaydi (§2.8) |

### 3-hafta — sotuv

17. **Tovar qidiruvi** — eng ko'p daromad beradigan bitta funksiya
18. **"Mashinamga mos" filtri** — ma'lumot bor, tugma yo'q
19. **Narx bo'yicha saralash + "faqat bor tovar"**
20. **Admin JS'ni lazy-load** (231 KB) + barcha script'ga `defer` + `bts.js` ni talab bo'yicha

### 4-hafta — sayqal

21. **Scroll holatini saqlash** — eng bezovta qiluvchi kamchilik
22. **Telegram mavzusi** (`themeParams`) — 0 marta ishlatilgan
23. **Skeleton'ni stories/banner/profil uchun** + rasmga `width`/`height`
24. **Tovar oynasini surib yopish** + hero o'tish + "savatga uchish"
25. **Toast navbati va undo**
26. **a11y:** `user-scalable`, `aria-live`, emoji tugmalarga nom, fokus boshqaruvi
27. **CSS tozalash:** `.prod-art` ×3, `.skel` ×2

---

## 6. Xulosa

**Ikkita asosiy fikr:**

1. **Vizual qatlam kuchli, ma'lumot qatlami zaif.** 78 animatsiya, to'liq haptic,
   4 qatlamli zaxira — bular yaxshi ishlangan. Lekin Firebase qoidalari ochiq,
   ombor atomik emas, transaksiya yo'q. Ya'ni **ilova chiroyli ko'rinadi, lekin
   ma'lumotga ishonib bo'lmaydi.**

2. **To'g'ri usul ko'p joyda allaqachon yozilgan, faqat hamma joyga
   qo'llanmagan.** Bu eng muhim kuzatuv:

   | To'g'ri qilingan joy | Unutilgan joy |
   |---|---|
   | `firebase.py:185` — `asyncio.to_thread` | `admin_import.py:118` — pandas bloklaydi |
   | `offlineMe()` — user id tekshiradi | `zimmer_cart` — tekshirmaydi |
   | frontend — `esc()` hamma joyda | backend — `html.escape()` yo'q |
   | `orders.apply()` — holat + bulut | `routes.py:733` — chetlab o'tadi |
   | `firebase_products.py` — umumiy sessiya | `firebase_storage.py` — har chaqiruvda yangi |
   | banner scroll — rAF bilan | modal scroll — rAF'siz |
   | `#sv-list`, `#mo-list` — delegatsiya | `#products` — har render'da N closure |

   Ya'ni katta refaktoring shart emas — **bor namunani qolgan joyga tarqatish**
   yetarli. Bu esa ancha arzon ish.

**Eng qisqa javob:** birinchi navbatda `database.rules.json` va ombor mantiqini
tuzat (1-hafta). Keyin `loadHome` va konfigurator xatosini (2-hafta) — ular
mijozga har kuni ko'rinadi. Undan keyingina yangi funksiya qo'sh.
