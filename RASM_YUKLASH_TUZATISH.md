# Rasm yuklash: nima buzilgan edi va nima qilindi

## 1. Asosiy muammo — bitta qator

Mini app'da tovar qo'shishda «Galereyadan rasm yuklash» bosilib rasm tanlangandan
keyin **hech narsa bo'lmasdi**: eskiz chiqmasdi, foiz chiqmasdi, xato ham chiqmasdi.

Sabab `docs/js/admin-shop.js` da edi:

```js
inp.onchange = async (ev) => {
  const files = ev.target.files;   // havola olindi
  ev.target.value = "";            // <-- input tozalandi
  await handleFiles(files);        // files ALLAQACHON BO'SH
};
```

`input.files` — **tirik (live) `FileList`**. Brauzer har chaqiruvda ayni o'sha
obyektni qaytaradi, `input.value = ""` esa o'sha obyektni **joyida bo'shatadi**.
Ya'ni `files` o'zgaruvchisi ham bo'shab qoladi va `handleFiles` ning birinchi
qatori jimgina chiqib ketardi:

```js
if (!up() || !files || !files.length) return;   // <-- shu yer
```

Input `value` ni tozalash o'zi **kerak** — aks holda admin ayni o'sha faylni
ikkinchi marta tanlasa `onchange` umuman ishlamaydi. Yechim: ro'yxatni **avval**
haqiqiy massivga ko'chirib olish, **keyin** tozalash:

```js
const picked = Array.prototype.slice.call(ev.target.files || []);
ev.target.value = "";
handleFiles(picked);
```

Avto_A1 da bu xato yo'q — u `Array.from(event.target.files)` bilan avval nusxa
oladi. Shuning uchun o'sha loyihada rasm yuklash bexato ishlaydi.

Xuddi shu xato `docs/js/admin.js` dagi eski panelda ham bor edi — u ham tuzatildi.

## 2. Endi yuklanish ko'rinib turadi

Avto_A1 da bo'sh kvadrat ichida foiz ko'rsatiladi. Zimmer'da bir qadam oldinga:

| Faza | Nima ko'rinadi |
|---|---|
| tanlandi | rasm **darhol** chiqadi (`blob:` — internet kutilmaydi) |
| siqilmoqda | ustida qorong'i qatlam + aylanuvchi halqa + «siqilmoqda» |
| yuklanmoqda | foiz (`37%`) + pastda oltin chiziq |
| tayyor | ✅ chaqnaydi, qatlam so'nadi, «Asosiy» belgisi chiqadi |
| xato | qizil ❌ + aniq sabab + **↻ Qayta** tugmasi (fayl saqlanib turadi) |

Eskizlar ostida holat qatori: «⏳ 2 ta rasm yuklanmoqda — sahifadan chiqmang» /
«✅ 3 ta rasm tayyor» / «❌ 1 ta rasm yuklanmadi».

Yuklanish tugamaguncha **saqlash bloklanadi** — aks holda tovar rasmsiz qolib
ketardi (havola hali kelmagan bo'ladi).

## 3. Yo'l-yo'lakay tuzatilgan mayda xatolar

- **Siqish yiqilsa yuklash to'xtardi.** Eski Android WebView'da
  `createImageBitmap` yo'q, xotira kam bo'lsa `toDataURL` bo'sh satr qaytaradi.
  Ilgari bunda «Rasm siqilmadi» deb butun yuklash bekor bo'lardi. Endi asl fayl
  yuboriladi — sekinroq, lekin ishlaydi.
- **Qo'lda kiritilgan havola eskiz bermasdi** — `renderThumbs()` da `photoUrls()`
  hisoblanardi-yu, natijasi ishlatilmasdi.
- **Tahrirlash formasida mavjud rasmlar ko'rinmasdi** — `renderThumbs()` u yerda
  umuman chaqirilmagan edi.
- **O'rtadagi rasm o'chirilsa boshqasi o'chib ketishi mumkin edi** — tugmalar
  indeks (`shop-rm-<i>`) bo'yicha bog'langan edi, endi obyekt bo'yicha.
- **Eskiz miltillardi** — har foiz o'zgarganda butun `innerHTML` qayta
  yasalardi va `<img>` qaytadan yuklanardi.
- **Buzuq havola bo'sh kvadrat qoldirardi** — endi 🖼 belgisi chiqadi.
- **`blob:` havolalari xotirada qolib ketardi** — endi bo'shatiladi.
- **`haptic("success")` ishlamasdi.** `app.js` dagi `haptic()` faqat `"ok"` va
  `"err"` ni bilardi, `"success"` esa `impactOccurred("success")` ga tushib
  jimgina yiqilardi — ya'ni tovar saqlanganda telefon tebranmasdi.

## 4. Firebase skrinshoti bo'yicha — HA, muammo bor

Siz yuborgan skrinshotdagi ma'lumot **rasm yuklash muammosiga aloqasi yo'q**
(siz to'g'ri aytdingiz). Lekin o'sha yerda **boshqa** muammo ko'rinib turadi.

Skrinshotda:

```
zimmer/
  products/1001/
    category_id: 1
    created_at: "2026-08-19T06:40:15.850526Z"      <- ISO satr
    description: "Eng zòri"
    id: 1001
    images/0: "AgACAgIAAxkBAAOHaoVPww6JFjKstvcZ..." <- Telegram file_id
    is_active: true
    price: 15099
    product_type: "oddiy"
    stock: 10
  products_counter: 1001
```

### Muammo A — bu yozuv 18-19 avgustdagi eski koddan qolgan

O'sha paytdagi `services/firebase_products.py` (git `f555b27` / `0c05b59`)
`products_counter` ni **skalyar** yozardi va tovarni `products/{id}` ga qo'yardi.
Hozirgi kod boshqacha ishlaydi: `products/{indeks}` (0, 1, 2…) va `created_at`
millisekundda. Ya'ni bu yozuv **eski sxemada** turib qolgan.

### Muammo B — `name` maydoni YO'Q

Firebase kalitlarni alifbo bo'yicha ko'rsatadi, ya'ni `name` `is_active` bilan
`price` orasida turishi kerak edi — u yerda yo'q. `services/sync.py:import_products()`
esa aynan shunday yozuvlarni tashlab ketadi:

```python
name = (item.get("name") or "").strip()
if not name:
    continue          # <-- 1001 shu yerda tushib qoladi
```

Ya'ni **bu tovar do'konda hech qachon ko'rinmaydi**.

### Muammo C — rasm `file_id` sifatida turibdi va `images` o'qilmaydi

`AgACAgIAAxk…` — Telegram `file_id`, bu **havola emas**. Brauzer uni ko'rsata
olmaydi (Worker `/media` proksisi kerak). Bundan tashqari `import_products()`
faqat `img` va `photo` maydonlarini o'qiydi:

```python
photo_url=item.get("img") or item.get("photo") or None
```

`images` ro'yxati **umuman qaralmaydi**. Ya'ni bot orqali qo'shilgan tovarning
rasmi, nomi to'g'ri bo'lsa ham, do'konga yetib bormaydi.

### Ikki xil ombor borligini bilib qo'yish kerak

| Firebase joyi | Kim yozadi | Mijoz ko'radimi |
|---|---|---|
| `zimmer/catalog/products` | mini app admin paneli, `push_all_catalog()` | **HA** |
| `zimmer/products` | bot: Excel import, qoralamalar | faqat Render uyg'onib `import_products()` ishlagandan keyin |

Mini app **faqat `catalog/products`** dan o'qiydi (`database.rules.json` da
`zimmer/products` ga o'qish umuman yopiq).

### Tuzatish yo'li — sodda qilib

**1-qadam. Tekshiring.** Firebase Console'da yuqoriga scroll qilib `catalog`
tugunini toping va `catalog/products` ichida tovarlaringiz borligini ko'ring.
Mini app aynan shu yerdan o'qiydi. Agar tovarlar shu yerda bo'lsa — do'kon
ishlayapti, `products` esa shunchaki chetda turgan qoldiq.

**2-qadam. Eski qoldiqni o'chiring.** `products/1001` nomsiz va rasmi
ko'rsatilmaydigan yozuv — undan foyda yo'q:

- Firebase Console → `zimmer` → `products` → `1001` yonidagi 🗑 belgisini bosing.
- `products_counter: 1001` ni ham o'chiring. Hozirgi mini app kodi
  `products_counter/n` (obyekt) kutadi, bazadagi skalyar 1001 esa eski sxema.
  O'chirsangiz mini app o'zi to'g'ri ko'rinishda qaytadan yasaydi (900001 dan
  boshlanadi — SQLite ID'lari bilan urishmasligi uchun).

> `products` tugunining **o'zini** o'chirmang — bot Excel import va qoralamalar
> uchun undan foydalanadi. Faqat `1001` yozuvini va `products_counter` ni oling.

**3-qadam. Tovarni mini app'dan qayta qo'shing.** Boshqaruv → Yangi tovar →
galereyadan rasm. Endi rasm ImgBB'ga chiqadi va bazaga **oddiy `https://` havola**
tushadi — Render, Worker va Firebase Storage'ga bog'liq bo'lmaydi.

**4-qadam — BAJARILDI.** Botdan (Excel importi yoki bot admin paneli) qo'shilgan
tovarning rasmi ham do'konga tushadigan bo'ldi. Batafsil: pastdagi 5-bo'lim.

## 5. Botdan qo'shilgan tovarning rasmi do'konga tushmasligi — tuzatildi

`services/sync.py:import_products()` Firebase'ning `products` tugunini SQLite'ga
ko'chiradi, keyin `push_all_catalog()` uni `catalog` ga yozadi va Mini App shu
yerdan o'qiydi. Ya'ni bu funksiya — **botdan do'konga yagona ko'prik**. U yerda
uchta muammo bor edi.

### A. `images` ro'yxati umuman o'qilmasdi

```python
photo_url=item.get("img") or item.get("photo") or None
```

Bot esa rasmni `images: ["<file_id>"]` ko'rinishida yozadi. Endi `images`,
`img`, `photo`, `photo_url`, `photo2_url`, `photo3_url`, `photo_id` — hammasi
o'qiladi, eng ko'p 3 ta rasm olinadi.

Muhim tafsilot: RTDB **siyrak massivni lug'at qilib** saqlaydi
(`images: {"0": …, "2": …}`) — skrinshotda ham aynan shunday. Ikkala ko'rinish
ham qo'llab-quvvatlanadi, kalitlar raqam bo'yicha tartiblanadi.

### B. Telegram `file_id` havola emas

`file_id` `photo_url` ga yozilsa brauzer `<img src="AgACAgIAAxk…">` deb urinib
buzuq rasm ko'rsatadi. Uning **o'z ustuni** bor — `photo_id`. Qiymat endi
tekshiriladi va to'g'ri ustunga tushadi:

| Qiymat | Qayerga |
|---|---|
| `https://…` / `http://…` / `//…` | `photo_url` |
| `AgACAgIAAxk…` (base64url, 20+ belgi) | `photo_id` |
| `/api/media/…` yoki tanib bo'lmagan matn | tashlanadi |

`photo_id` ga tushgach mavjud media quvuri o'zi ishlaydi:

- Render onlayn: `api/media.py` → `/api/media/products/<id>/photo`
- Render o'chgan: `cloudflare-worker.js` → `<WORKER_URL>/media?id=<file_id>`

Shu sababli `file_id` bazada Worker havolasiga **o'girilmaydi**: o'girilsa
manzil `WORKER_URL` o'zgarganda bazada qotib qolardi va Render onlayn bo'lganda
ham keraksiz Worker'dan o'tardi. Havolani har safar ko'rsatuvchi tomon tanlaydi.

### C. Tasdiqlanmagan qoralama va yashirin tovar do'konga chiqib ketardi

- **`is_draft` tekshirilmasdi.** Excel importi tovarlarni qoralama qilib yozadi
  va admin ularni ko'zdan kechirib «tasdiqlash» bosishi kerak. Amalda esa ular
  **darhol do'konda** paydo bo'lardi — tasdiqlashning ma'nosi yo'q edi.
- **`is_active` tekshirilmasdi** — faqat eski `active` nomi qaralardi. Bot
  «yashirish» qilgan tovar (`is_active: false`) do'konda ko'rinib turardi.
- `old_price` ham faqat eski `oldPrice` nomi bilan o'qilardi.

### D. Rasm endi bo'sh qiymat bilan o'chib ketmaydi

`upsert_external_product()` har restartda chaqiriladi. Ilgari `photo_url`
shartsiz yozilardi, ya'ni: Excel'dan import qilingan tovarga admin bot panelida
rasm qo'ysa → keyingi restartda `photo_url = NULL` bo'lib **rasm yo'qolardi**.
Endi rasm va artikul ustunlari faqat yangi qiymat kelganda yangilanadi. Nom,
narx va qoldiq esa har doim Firebase'dagidek bo'ladi — import aynan shular
uchun kerak.

### E. Tasdiqlash endi darhol ta'sir qiladi

`is_draft` tekshiruvi qo'shilgach, «tasdiqlash» tugmasi Firebase'da
`is_draft: false` qilardi-yu, tovar keyingi qayta ishga tushirishgacha do'konda
ko'rinmasdi — tugma esa «endi do'konda ko'rinadi» deb yozardi. Shu sababli yangi
`sync.publish_imported_products()` qo'shildi: Firebase `products` → SQLite →
`catalog`. U «tasdiqlash» va `/approve_batch` dan keyin chaqiriladi.
