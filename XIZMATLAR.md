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

Forma **kartochkalarga** bo'lingan: Asosiy → Narx va muddat → Holat →
Tavsif → Video → Tartib. Tepada **«Mijozga qanday ko'rinadi»** turadi —
narx yoki dizaynni o'zgartirsangiz natija darhol ko'rinadi, saqlab
do'konga o'tib tekshirish shart emas.

Narx maydoni ming ajratgich bilan yoziladi (`150 000`) va yonida
valyuta turadi. Majburiy maydon bo'sh qolsa forma **o'sha maydonni
belgilaydi** va unga o'tadi — ilgari xato faqat qisqa xabar bo'lib
chiqib, qaysi maydon ekani ko'rinmasdi.

## Xizmatlar tartibi

Ro'yxat **uch guruhga** bo'linadi va guruhlar har doim shu ketma-ketlikda
turadi:

| # | Guruh | Izoh |
| --- | --- | --- |
| 1 | 🧮 **Konfigurator** | Har doim **birinchi** |
| 2 | 🔧 **Xizmatlar** | Tartibni o'zingiz belgilaysiz |
| 3 | 🕒 **Tez kunda** | Har doim **oxirida** |

Bu tartib mijoz ko'radigan bo'limda ham, admin panelidagi ro'yxatda ham
**bir xil**.

### Tartibni o'zgartirish

Ro'yxatdagi har yozuvning chap tomonida **↑ / ↓** tugmalari bor. Bosasiz
— yozuv bir pog'ona ko'chadi. Raqam o'ylab o'tirish kerak emas.

Guruh chetida tugma **o'chib qoladi** (kulrang bo'ladi): konfiguratorni
o'rtaga tushirib yoki «Tez kunda» xizmatni yuqoriga chiqarib bo'lmaydi.
Bu ataylab — tasodifan buzib qo'yish mumkin bo'lmasin.

### «Tartib» raqami

Formadagi **Tartib** maydoni hamon bor, lekin qo'lda yozish shart emas.
Xizmat qo'shilganda yoki o'chirilganda raqamlar **o'zi** `10, 20, 30 …`
qilib qayta yoziladi — bo'shliq ham, takror ham qolmaydi.

> Ilgari raqamlar `1, 2, 4, 7` bo'lib ketardi (o'chirilgan yozuv
> bo'shliq qoldirardi) va ikki xizmatga bir xil raqam tushsa tartib
> tushunarsiz bo'lib qolardi.

Ikki yozuv orasiga qo'shish kerak bo'lsa qo'lda oraliq raqam yozishingiz
mumkin — masalan `10` va `20` orasiga `15`.

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

> **Dizayn** maydoni endi **ro'yxatdan tanlanadi** — kalitni qo'lda
> yozish kerak emas. Video qo'yish mumkin bo'lgan uchtasi ro'yxatda
> «(video mumkin)» deb belgilangan.
>
> Ilgari bu maydon erkin matn edi va kalitlarni qo'lda yozish kerak
> bo'lardi: bitta harf xato bo'lsa (`polirovka` / `polish`) kartochka
> dizayni jimgina buzilardi.

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
