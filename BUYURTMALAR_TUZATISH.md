# Buyurtmalar va savat: nima buzilgan edi

## 1. Buyurtma berib bo'lmasdi (eng og'ir)

Do'kon katalogi **Firebase**'dan o'qiladi (`catalog/products`) — admin paneli ham
shu yerga yozadi. Buyurtma esa **`/api/orders`** ga ketardi va u **SQLite**'ga
qaraydi:

```python
product = await get_product(product_id)   # SELECT ... FROM products
if not product:
    problems.append({"product_id": product_id, "reason": "not_found"})
```

Mini app admin panelida qo'shilgan tovarning id'si **900000 dan** boshlanadi
(`fb.js: ID_BASE`) va SQLite'da **umuman yo'q**. Natijada:

```
409 order_failed → «Ba'zi mahsulotlar yetarli emas. Savatchani yangilang»
```

Mijoz tovarni ko'radi, savatga qo'shadi — lekin buyurtma bermaydi. Xabar ham
**yolg'on sabab** ko'rsatadi (qoldiq yetarli, tovar shunchaki boshqa omborda),
shuning uchun savatni yangilash hech narsa bermaydi.

**Yechim.** Buyurtma endi **Cloudflare Worker** orqali ketadi — u narx va
qoldiqni aynan `catalog/products` dan o'zi o'qiydi, tekshiradi,
`pending_orders` ga yozadi, qoldiqni kamaytiradi va adminga Telegram xabarini
yuboradi. Ya'ni katalog va buyurtma **bitta manbaga** qaraydi.
`/api/orders` zaxira sifatida qoladi (Worker sozlanmagan bo'lsa).

## 2. Savat eski ma'lumot bilan ishlardi

Savat `localStorage` da nom/narx/qoldiq **nusxasi** bilan saqlanadi va
`renderCart()` katalogga umuman qaramaydi. Shu sababli:

- admin tovarni o'chirsa — savatda turaveradi va buyurtma yiqiladi;
- narx o'zgarsa — savatda **eski narx**, jami summa serverdagiga mos kelmaydi;
- qoldiq kamaysa — xato faqat oxirida chiqadi.

Endi savat ochilganda va buyurtma berishdan oldin jonli katalog bilan
solishtiriladi: sotuvdan chiqqan tovar olib tashlanadi, narx/qoldiq
yangilanadi va mijozga nima o'zgarganini aytadi.

Buning ustiga, Worker `problems` qaytarsa sabab **ajratiladi**: «sotuvda yo'q»
tovarlar savatdan avtomatik olib tashlanadi, «qoldiq yetmadi» esa alohida
aytiladi. Ilgari ikkisi ham «Yetarli emas» deyilardi.

## 3. Admin panelda buyurtmalar ko'rinmasdi

Buyurtmalar tarixan **ikki joyda** saqlanadi:

| Firebase tuguni | Kim yozadi | Brauzer o'qiy oladimi |
|---|---|---|
| `zimmer/pending_orders/{uid}_{kod}` | Worker (Render o'chganda) | **ha** |
| `zimmer/orders/{sqlite_id}` | bot, `sync.push_order` | **yo'q** — `.read: false` |

Admin paneli faqat birinchisini o'qirdi. Render tirik bo'lganda buyurtma
SQLite'ga tushadi va nusxasi `zimmer/orders` da qoladi — o'sha tugun
qoidalarda yopiq. Shuning uchun mijozning kabinetida buyurtmalar turadi, admin
panelida esa **«Hali buyurtma tushmagan»**.

**Yechim.** Buyurtmalar Worker orqali olinadi: u service-account bilan
**ikkala tugunni** o'qiydi, birlashtiradi (takrorlanmaydi) va faqat
**tasdiqlangan adminga** beradi (`requireAdmin`: initData imzosi → uid →
`ADMIN_IDS`).

Shu sababli `zimmer/orders` ni qoidalarda **ochish kerak emas** — mijoz telefon
raqamlari yopiq qoladi. Worker sozlanmagan bo'lsa eskicha `pending_orders`
o'qiladi va admin nima uchun eski buyurtmalar yo'qligini biladi.

## 4. Mijoz kabinetida yangi buyurtma ko'rinmasdi

Worker buyurtmasi SQLite'ga faqat bot ishga tushganda (yoki 2 daqiqalik
tekshiruvda) ko'chiriladi, `/api/orders` esa SQLite'dan o'qiydi. Ya'ni mijoz
buyurtma beradi, «qabul qilindi» xabarini ko'radi — keyin kabinetda **topmaydi**.

Endi kabinet ikki manbani birlashtiradi: `/api/orders` + Firebase
`pending_orders` (faqat o'z buyurtmalari, `uid` bo'yicha indekslangan so'rov).
Takrorlanish `sqlite_id` belgisiga qarab olinadi.

## 5. Holat nomlari uch xil edi

| Qayerda | «yo'lda» | «yetkazildi» |
|---|---|---|
| SQLite / bot | — | `delivered` |
| Worker + admin panel | `delivering` | `done` |
| mijoz profili | `shipped` | `done` |

Panelda qo'yilgan `done` SQLite uchun **notanish** qiymat edi:

- mijoz `status_label` sifatida xom `done` so'zini ko'rardi;
- `services/orders.check()` uni `UNKNOWN` deb hisoblab, bot paneli o'sha
  buyurtmada **tiqilib qolardi**.

Endi hamma joyda **bir xil beshta nom**: `new · accepted · delivering ·
delivered · cancelled`. Eski nomlar (`done`, `shipped`) o'qishda avtomatik
o'giriladi, ya'ni bazadagi mavjud yozuvlar ham to'g'ri ko'rinadi.
`delivering` bosqichi `services/orders.py` ga ham qo'shildi.

## 6. Holatni o'zgartirish SQLite buyurtmasiga ta'sir qilmasdi

Panel to'g'ridan `pending_orders/{key}` ga yozardi. SQLite buyurtmasi uchun
bunday kalit yo'q — ya'ni tugma bosilardi, lekin **hech narsa o'zgarmasdi** va
mijoz xabar olmasdi.

Endi Worker to'g'ri tugunga yozadi (`source: "pending" | "db"`) va mijozga
Telegram xabarini yuboradi.

## 7. Sotilgan qoldiq qaytib kelardi

`initial_sync()` tartibi shunday edi:

```
push_all_catalog()        # SQLite qoldig'i -> Firebase
...
import_pending_orders()   # Worker buyurtmasi -> SQLite (qoldiq kamayadi)
```

Worker bulutdagi qoldiqni allaqachon kamaytirgan, SQLite'da esa hali eski.
`push_all_catalog()` birinchi ishlaganda **kamaymagan** qoldiqni bulutga yozib,
sotilgan tovarni qayta tiklardi — ombor o'z-o'zidan «to'lib» ketardi va yo'q
tovar sotuvda turardi.

Endi `import_pending_orders()` **oldin** ishlaydi.

## 8. Dizayn — bitta uslub, iOS hissi

Ilgari admin paneldagi va kabinetdagi buyurtma butunlay boshqacha ko'rinardi
(`.adm-order` va `.card`). Endi ikkisi ham bir xil `.ord` uslubida:

```
kod · vaqt                    [holat belgisi]
mijoz ismi              [📞 telefon]
──────────────────────────────────────
LED lampa H7            ×1   450 000 so'm
──────────────────────────────────────
📍 manzil · 🚚 yetkazish · 💳 to'lov
──────────────────────────────────────
Jami                        450 000 so'm
[✅ Qabul qilish]  [✕ Bekor qilish]
```

- 18px yumshoq burchaklar, guruhlangan qatorlar, ingichka ajratgichlar;
- holat «pill» belgilari bo'yalgan fon bilan (yangi — qizil, qabul — yashil,
  yo'lda — sariq, yetkazildi — tilla, bekor — kulrang);
- **yangi** buyurtma kartochkasi ajralib turadi (admin o'tkazib yubormaydi);
- telefon — bosiladigan tugma (raqamni terish uchun);
- amal tugmalari 44px balandlikda (barmoq bilan qulay);
- admin panelida tepada xulosa: **Yangi · Jarayonda · Jami**.

## Sizdan nima talab qilinadi

1. Merge qiling va **GitHub Pages** yangilanishini kutib, ilovani to'liq yopib
   qayta oching.
2. **`cloudflare-worker.js` ni qayta deploy qiling** — buyurtmalarni
   birlashtirish va holat o'zgartirish o'zgarishlari o'sha faylda.
3. Worker'da **`ADMIN_IDS`** secret'i to'g'ri turganini tekshiring (vergul
   bilan: `5105291033,483425630`). Aks holda admin panelida faqat yangi
   buyurtmalar ko'rinadi va bu haqda ogohlantirish chiqadi.
4. Render'ni qayta deploy qiling (holat lug'ati va sinxronizatsiya tartibi
   o'zgardi).


---

# 9. Admin panel: har bo'lim alohida oynada

## Ilgari qanday edi

Panelda uchta tugma bor edi: **Yangi tovar**, **Ombor**, **Buyurtmalar**.
Oxirgisi faqat **do'kon** buyurtmalarini bitta uzun ro'yxatda ko'rsatardi.

Mijozning kabinetida esa **uchta** bo'lim bor:

- 🛍 Mahsulot buyurtmalari
- 🔥 Bi-LED buyurtmalarim
- 🗓 Navbatlarim

Ya'ni admin mijoz ko'rgan narsaning **uchdan bir qismini** ko'rardi — Bi-LED
buyurtmasi va navbat mini app panelida **umuman yo'q** edi. Ularni boshqarish
uchun botga o'tish kerak bo'lardi.

## Endi qanday

Menyu **beshta** tugma, «Ombor» va «Yangi tovar» kabi har biri **o'z oynasini**
ochadi:

```
┌──────────────┬──────────────┐
│ ＋ Yangi tovar│ 📦 Ombor      │
└──────────────┴──────────────┘
  Buyurtmalar
┌────────────────────────────┐
│ 🛍 Mahsulot buyurtmalari ③ │
│ 🔥 Bi-LED buyurtmalari      │
│ 🗓 Navbatlar             ①  │
└────────────────────────────┘
```

- Tugmada **yangi** yozuvlar soni qizil belgi bilan turadi — admin nimaga
  qarash kerakligini darhol ko'radi va buyurtmani o'tkazib yubormaydi.
  Sanoqchilar fonda yuklanadi, ya'ni menyu darhol ochiladi.
- Har oynada **holat filtri**: `Hammasi · 🆕 Yangi · ⏳ Jarayonda ·
  ✅ Yakunlangan · ✕ Bekor`. Har chipda soni ko'rinadi; bo'sh filtr
  ko'rsatilmaydi.
- Orqaga tugmasi menyuga qaytaradi, yangilash tugmasi **ayni** bo'limni qayta
  o'qiydi (ilgari har doim do'kon buyurtmalariga qaytarib yuborardi).

## Har turning O'Z holatlari

Uch tur uchun bosqichlar boshqacha va bu endi hurmat qilinadi:

| Tur | Bosqichlar |
|---|---|
| 🛍 Mahsulot | yangi → qabul qilindi → yo'lda → yetkazildi |
| 🔥 Bi-LED | yangi → qabul qilindi → ish jarayonida → topshirildi |
| 🗓 Navbat | yangi → tasdiqlangan → bajarilgan |

Bularning barchasi `utils/texts.py` (`ORDER_STATUS`, `BILED_STATUS`,
`BOOKING_STATUS`) va `services/orders.py` (`FLOWS`) dagi ro'yxatlar bilan
**aynan bir xil** — shuning uchun panelda qo'yilgan holat bot uchun notanish
bo'lib qolmaydi.

Muhim tafsilot: `done` so'zi Bi-LED va navbatda **haqiqiy** holat («topshirildi»
/ «bajarilgan»), do'kon buyurtmasida esa **eski** nom (yangisi `delivered`).
Shu sababli o'girish faqat do'kon buyurtmalariga qo'llanadi.

## Ma'lumot qayerdan

| Bo'lim | Manba |
|---|---|
| 🛍 Mahsulot | Worker `/admin/orders` — `pending_orders` + `orders` birlashtirilgan |
| 🔥 Bi-LED | **to'g'ridan** Firebase `biled_orders` |
| 🗓 Navbat | **to'g'ridan** Firebase `bookings` |

Bi-LED va navbat tugunlari `database.rules.json` da o'qishga ochiq, shuning
uchun Worker o'chgan bo'lsa ham ro'yxat ko'rinadi.

**Holatni o'zgartirish** esa Worker orqali — mijozga Telegram xabarini yuborish
uchun bot tokeni kerak, u faqat Worker'da. Worker o'chgan bo'lsa Bi-LED va
navbat to'g'ridan Firebase'ga yoziladi (qoidalar ruxsat beradi) va admin xabar
ketmaganini ko'radi. Do'kon buyurtmasining SQLite nusxasi uchun esa Worker
**shart** — `orders` tuguni yopiq.

`cloudflare-worker.js` dagi `/admin/order-status` endi `kind` parametrini
qabul qiladi (`order` | `biled` | `booking`) va har tur uchun o'z tuguniga
yozib, o'z xabar matnini yuboradi.
