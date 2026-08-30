# 🎓 Shogird — Mini App ichidagi yordamchi

Mini ilovaning pastidagi menyuda **🎓 Shogird** bo'limi. Mijoz o'z tilida
savol beradi («faram xira bo'lib qolgan»), Shogird esa muammoni aniqlab,
mos xizmatni narxi bilan aytadi va **qaysi tugmani bosishni** ko'rsatadi.

## Nega botdagi AI yordamchi yetarli emas

Botdagi yordamchi (`services/ai_brain.py`) bitta maqsad uchun yozilgan:
**mijozni ilovaga olib kirish**. Har javob ostida «🛍 Do'konni ochish»
tugmasi turadi.

Ilova ICHIDA bu javob foydasiz — mijoz allaqachon shu yerda. Shu sababli
Shogirdning o'z ko'rsatmasi bor (`services/shogird.py`): u mijoz qayerda
turganini biladi va uni **bo'limlar bo'ylab** yo'naltiradi
(«🛠 Xizmatlar → Fara polirovkasi → Navbat olish»).

## Uchta qaror

**1. Kartochkani model tanlamaydi.**
Model faqat matn yozadi. Javob ostidagi xizmat va tovar kartochkalari
server tomonidan topiladi: javob matni va savol **bazadagi nomlar** bilan
solishtiriladi (`_match_services`, `_match_products`). Natijada:

- mavjud bo'lmagan tovar hech qachon ko'rsatilmaydi;
- kartochkadagi narx bazadan keladi — model narxni o'ylab topsa ham
  mijoz to'g'ri raqamni ko'radi;
- «Savatga qo'shish» ilovadagi katalogdan (`S.home`) o'qiydi, ya'ni
  qoldiq do'kondagi bilan bir xil manbadan tekshiriladi.

Solishtirish ikki yo'l bilan ishlaydi: nom bo'yicha (uzun so'zlar qism
sifatida — o'zbekcha qo'shimchalar uchun, «lentalar» → «lenta») va
**muammo tilidan tema bo'yicha** («sarg'aygan» → `polish`). Ikkinchisi
kerak, chunki mijoz «Fara polirovkasi» deb yozmaydi.

**2. Shogird jim qolmaydi.**
`GROQ_API_KEY` sozlanmagan, Groq chegarasi tugagan yoki Render uxlagan
bo'lishi mumkin. Bu holatlarda ilova o'zining mahalliy bilimiga o'tadi
(`app.js: SG_FAQ`): yetkazib berish, kafolat, to'lov, navbat, manzil,
narxlar va katalog qidiruvi. Ma'lumot ilovada allaqachon bor (`S.pay`,
`S.services`, `S.home`) — shunchaki bir joyga yig'ilgan.

`/api/config` javobidagi `ai_enabled` shu uchun kerak: kalit yo'q bo'lsa
ilova har savolda serverga borib xato kutib o'tirmaydi.

**3. Shogird mijoz nomidan hech narsa qilmaydi.**
Buyurtma bermaydi, navbat olmaydi, savatga qo'shmaydi. Kartochkada tugma
bor, lekin uni **mijoz** bosadi. Aks holda «yordamchi noto'g'ri tovar
buyurdi» degan holat paydo bo'lardi va uni tekshirishning yo'li yo'q edi.

## Sozlash

Yagona talab — botdagi AI bilan **bir xil** kalit:

```
GROQ_API_KEY=gsk_...
```

Render → Environment. Model nomlari ham umumiy (`GROQ_TEXT_MODEL`).
Kalit qo'yilmasa Shogird bo'limi baribir ishlaydi — mahalliy bilim
rejimida (sarlavha ostida «Asosiy ma'lumotlar rejimi» yoziladi).

## Chegaralar

| Nima | Qiymat | Nega |
|---|---|---|
| Savol uzunligi | 700 belgi | uzun matn token yeydi |
| Javob uzunligi | 520 token | pufakcha ekranni to'ldirmasin |
| So'rovlar oralig'i | 2 soniya | Groq bepul tarifi |
| Bir vaqtda so'rov | 1 ta | ikki marta bosish ikki so'rov yubormasin |
| Suhbat xotirasi | 5 juftlik, 30 daqiqa | xotirada, bazada emas |
| Kartochkalar | 2 xizmat + 3 tovar | javob katalogga aylanib ketmasin |

## Fayllar

| Fayl | Vazifasi |
|---|---|
| `services/shogird.py` | ko'rsatma, suhbat xotirasi, kartochkalarni topish |
| `api/routes.py` | `POST /api/shogird`, `POST /api/shogird/reset` |
| `docs/index.html` | `#shogird` bo'limi, menyu tugmasi |
| `docs/js/app.js` | yozishma, mahalliy bilim (`SG_FAQ`), kartochka tugmalari |
| `docs/styles.css` | dizayn (`.sg-*` — tilla aksent) |

Transport (`services/ai.py`) va katalog keshi
(`ai_brain.catalog_snapshot`) bot bilan **umumiy**: admin narxni
o'zgartirsa, bot ham, Shogird ham ikki daqiqada biladi.
