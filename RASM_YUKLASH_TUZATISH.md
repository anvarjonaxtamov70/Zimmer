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

**4-qadam (ixtiyoriy, keyinroq).** Botdan qo'shilgan tovar ham do'konga tushishi
uchun `services/sync.py:import_products()` da `images[0]` ni ham o'qish va
`file_id` ni Worker `/media` havolasiga o'girish kerak. Bu alohida ish —
aytsangiz qilib beraman.
