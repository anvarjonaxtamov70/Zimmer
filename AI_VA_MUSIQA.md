# AI yordamchi va fon musiqasi — qo'llanma

Ikkisi ham **botga** qo'shildi. Bu hujjat kodni emas, siz nima qila
olishingizni yozadi.

---

## AI yordamchi

Mijoz botga yozsa AI javob beradi: muammosini aniqlaydi, mos xizmat va
narxni aytadi, rasmga qarab holatni tushuntiradi va **do'konga
(Mini App'ga) yo'naltiradi**.

### Ishga tushirish

Render → **Environment** → bitta o'zgaruvchi qo'shing:

| Nom | Qiymat |
| --- | --- |
| `GROQ_API_KEY` | `gsk_...` (console.groq.com → API Keys) |

Boshqa hech narsa shart emas. Kalit qo'shilmasa AI o'chiq turadi va bot
oldingidek ishlaydi.

> **Kalit maxfiy.** U kodda YO'Q va git tarixiga tushmaydi. Kalit
> boshqa joyda ko'rinib qolgan bo'lsa — Groq konsolida o'chirib yangi
> yasang, so'ng Render'dagi qiymatni almashtiring. Kod o'zgarmaydi.

### Kim kim

| Kim | AI qanday murojaat qiladi |
| --- | --- |
| Bosh admin (`OWNER_ID`) | **«xo'jayin»** |
| Boshqa adminlar | **«admin»** |
| Mijozlar | ismi bilan, «siz» deb |

Bosh admin standart holatda `CORE_ADMINS` dagi birinchi ID
(`5105291033`). Boshqa odam bo'lsa Render'ga qo'shing:

```
OWNER_ID = 483425630
```

### AI nima qiladi

- **Muammoni aniqlaydi.** «Faram xira», «suv kirdi» degan mijozdan
  avval 1–2 ta aniqlashtiruvchi savol so'raydi (mashina modeli,
  qachondan beri, ikki tomonmi), keyin mos xizmatni narxi bilan
  taklif qiladi.
- **Rasmni ko'radi.** Mijoz fara rasmini yuborsa: sarg'ayganmi,
  yorilganmi, ichida bug' bormi — aytadi va qaysi xizmat kerakligini
  tushuntiradi.
- **Tovar sotadi.** Narx va mavjudlikni bazadan o'qib aytadi.
- **Do'konga yo'naltiradi.** Har javob ostida «Do'konni ochish»
  tugmasi turadi.

### AI nima QILMAYDI

- **Narx o'ylab topmaydi.** Xizmatlar va katalog har so'rovda bazadan
  o'qiladi. Ro'yxatda yo'q narsaning narxini aytmaydi — «do'konda
  ko'ring yoki so'rang» deb javob beradi.
- **«Tez kunda»** xizmatga narx aytmaydi va navbat taklif qilmaydi.
- **Chegirma, bepul xizmat yoki muddat va'da qilmaydi.**
- **Mavjud oqimlarga aralashmaydi.** Ro'yxatdan o'tish, buyurtma
  rasmiylashtirish, admin forma to'ldirish — bularning o'rtasida AI
  jim turadi. Buyruqlarga (`/...`) va menyu tugmalariga ham tegmaydi.

### Modellar

Groq modellarni vaqti-vaqti bilan **o'chiradi**. Shuning uchun ular
env orqali sozlanadi:

| Nom | Standart qiymat |
| --- | --- |
| `GROQ_TEXT_MODEL` | `openai/gpt-oss-120b` |
| `GROQ_VISION_MODEL` | `qwen/qwen3.6-27b` |

Model o'chirilsa botda javob kelmay qoladi va logda aniq yoziladi:

```
AI: «...» modeli topilmadi. Groq modelni o'chirgan bo'lishi mumkin —
GROQ_TEXT_MODEL / GROQ_VISION_MODEL ni yangilang.
```

Bunda console.groq.com/docs/models dan joriy modelni olib, Render'dagi
qiymatni almashtirasiz. **Kodga tegish kerak emas.**

### Chegaralar

Groq bepul tarifda daqiqada cheklangan so'rov beradi. Shuning uchun:
bir mijoz so'rovlari orasida 3 soniya kutish, bir vaqtda bitta so'rov,
suhbat tarixi 6 juftlik bilan cheklangan (30 daqiqada tozalanadi).

Chegaradan oshsa mijoz «Hozir juda ko'p so'rov keldi, bir daqiqadan
keyin yozing» degan xabar oladi — texnik xato ko'rsatilmaydi.

---

## Fon musiqasi

### Qo'shish

Botga **audio fayl tashlang**. Hammasi shu — sarlavha faylning o'zidan
olinadi.

Boshqarish:

| Buyruq | Nima qiladi |
| --- | --- |
| `/musiqa` | ro'yxat |
| `/musiqa_del_N` | o'chirish |
| `/musiqa_on_N` | yoqish / o'chirish |

Bir vaqtda 10 tagacha trek bo'lishi mumkin — ilova ularni navbat bilan
aylantiradi. Fayl **12 MB** gacha: kattasi mijozning trafigini behuda
yeydi.

### ⚠️ Muhim: musiqa o'zi jiringlab ketmaydi

Chrome va Safari **ovozli media'ni foydalanuvchi ekranga
teginmaguncha o'ynatmaydi**. Bu brauzer qoidasi — Zimmer'ning
kamchiligi emas va uni chetlab o'tish mumkin emas.

Amalda shunday ishlaydi:

1. Mijoz ilovani ochadi → tepada **🔇** tugmasi turadi
2. Bir marta bosadi → musiqa boshlanadi, tugma **🎵** bo'ladi
3. **Tanlovi eslab qolinadi** → keyingi kirishlarida o'zi davom etadi
   (birinchi teginishdanoq)

Ya'ni mijoz **bir marta** yoqsa, boshqa hech narsa bosishi shart emas.

### Qolgan tafsilotlar

- Ovoz balandligi pasaytirilgan — suhbatni bosib ketmaydi
- Ilova fonga o'tsa musiqa to'xtaydi (batareya), qaytganda davom etadi
- Trek qo'shilmagan bo'lsa tugma **umuman ko'rinmaydi**
- Bir trek ochilmasa keyingisiga o'tadi

### Render uxlaganda

Telegram orqali yuborilgan fayl (`file_id`) Render'ning proksisi orqali
beriladi — Render uxlasa u eshitilmaydi.

Doim ishlashini xohlasangiz musiqani Firebase Storage yoki boshqa
xostingga qo'yib, `/admin` → Musiqa bo'limida `audio_url` maydoniga
`https://` havolani yozing. Bunday trek zaxira rejimda ham eshitiladi.

---

## Tekshirish ro'yxati

Merge va deploy'dan keyin:

- [ ] Botga «faram xira» deb yozing → AI savol berib, polirovkani narxi
      bilan taklif qilishi kerak
- [ ] Fara rasmini yuboring → holatni aytishi kerak
- [ ] Bosh admin sifatida yozing → sizga «xo'jayin» deyishi kerak
- [ ] `/start` bosing → menyu chiqishi kerak (AI aralashmaydi)
- [ ] Botga audio tashlang → «Fon musiqasi qo'shildi» xabari
- [ ] Mini App'ni ochib 🎵 tugmasini bosing → musiqa boshlanishi kerak
- [ ] Ilovani yopib qayta ochsangiz → musiqa o'zi davom etishi kerak
