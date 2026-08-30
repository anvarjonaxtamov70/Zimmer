# Xizmatlar bo'limi — admin qo'llanmasi

Mini App'dagi **Xizmatlar** bo'limi (`#services` / `#service`) va uni
boshqarish. Bu hujjat kodni emas, ADMIN nima qila olishini yozadi.

## Xizmat narxini o'zgartirish

Ikki yo'l bor, ikkisi ham bir xil bazaga yozadi:

1. **Mini App → Boshqaruv → Xizmatlar va narxlar** (yangi)
   Ro'yxatdan xizmatni tanlang → narx, kafolat, davomiylik, tavsifni
   o'zgartirib saqlang. O'zgarish darhol mijozlarga ko'rinadi.
2. **Telegram bot → `/admin` → 🔧 Xizmatlar (navbat)**

> Ilgari faqat ikkinchi yo'l ishlardi: Mini App'ning boshqaruv menyusida
> «Xizmatlar» plitkasi umuman yo'q edi.

## Video (faqat uchta fara xizmati)

Video **faqat** shu uchta xizmatga qo'yiladi:

| Xizmat | `theme` |
| --- | --- |
| Fara polirovkasi | `polish` |
| Fara ichini tozalash | `clean` |
| Fara shishasini almashtirish | `glass` |

Boshqa xizmatga video yuborilsa server **rad etadi** (`400`). Ro'yxat
`config.py: VIDEO_SERVICE_THEMES` da turadi; cheklov xizmat NOMIGA emas,
`theme` ustuniga bog'langan — nomni o'zgartirsangiz ham ishlaydi.

Mijoz tomonida video **avtomatik yuklanmaydi**: avval «▶ Videoni ko'rish»
tugmasi turadi, `<video>` elementi faqat bosilgandan keyin yaratiladi.
Ya'ni uzun va sifatli video mijozning trafigini bekorga yemaydi.

### Uzun / yuqori sifatli video qanday qo'yiladi

`video_id` maydonining ikki ishlash usuli bor:

* **Telegram orqali fayl yuborish** — eng oson, lekin bot API chegarasi
  **50 MB**. Undan kattasi yuborilmaydi.
* **`https://` URL yozish** — hajm cheklovi YO'Q. Videoni Firebase
  Storage, Cloudflare R2 yoki boshqa xostingga qo'yib, to'g'ridan-to'g'ri
  havolasini shu maydonga yozing.

Uzun va yuqori kachestvali video uchun **ikkinchi usul** tavsiya
qilinadi. Tavsiyalar:

* format `mp4` (H.264 + AAC) — barcha brauzer va Telegram ichida ochiladi;
* `faststart` (moov atom boshida) — aks holda video o'ynashdan oldin
  butun fayl yuklanishini kutadi;
* 1080p yetarli: mobil ekranda 4K farqi ko'rinmaydi, trafik esa 4 barobar.

> Bulut zaxira rejimida (Render uxlagan payt) **faqat `https://` URL**
> ishlaydi: Telegram `file_id` ni brauzer o'qiy olmaydi, uni faqat server
> `/media/...` orqali beradi.

## «Tez kunda» holati

Xizmat ro'yxatda **ko'rinadi**, lekin:

* narx o'rnida «Tez kunda» yozuvi turadi (`0 so'm` EMAS);
* plitkada burchakda «Tez kunda» yorlig'i chiqadi;
* navbat olish tugmasi **butunlay yashiriladi**;
* server ham himoyalangan: `POST /api/bookings` `409` qaytaradi, bot
  esa bunday xizmatni navbat ro'yxatida ko'rsatmaydi.

Yoqish/o'chirish: xizmat formasidagi **Holat** maydoni →
`✅ Ishlaydi` yoki `🕒 Tez kunda`.

Hozircha «Tez kunda» turgan yo'nalishlar: **Laminat salon**,
**Tanirovka**, **Broni plyonka**. Narx tayyor bo'lganda Holat'ni
`✅ Ishlaydi` ga o'tkazing va narxni kiriting — boshqa hech narsa
qilish shart emas.

## Nom o'zgarishlari va o'chirilgan xizmat

Bot ishga tushganda **bir martalik** migratsiya bajariladi
(`database/db.py: _migrate_services`, `meta.services_revision` bilan
belgilanadi):

* «Rul chexol **tikish**» → «Rul chexol **o'rnatish**»
* «O'rindiq chexol **tikish**» → «O'rindiq chexol **o'rnatish**»
* «Fara germetizatsiya» → `is_active = 0` (ro'yxatdan yo'qoladi)

**Yozuv o'chirilmaydi, faqat yashiriladi.** `bookings.service_id` shu
qatorlarga ishora qiladi — o'chirilsa navbat tarixi buzilardi.

Migratsiya **bir marta** ishlaydi. Ya'ni «Tez kunda» ni qo'lda
o'chirsangiz yoki narx qo'ysangiz — bot qayta ishga tushganda
o'zgarishingiz **tiklanmaydi**.

«Fara germetizatsiya» ni qaytarish kerak bo'lsa: `/admin` → Xizmatlar →
o'sha xizmatni tanlab **Faol** holatiga qaytaring.
