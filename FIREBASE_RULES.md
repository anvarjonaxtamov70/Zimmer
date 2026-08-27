# Firebase Realtime Database qoidalari

Qoidalar `database.rules.json` faylida. U **ataylab izohsiz** — izohlar Firebase
Console'ning tahrirlagichida muammo tug'dirishi mumkin, shuning uchun tushuntirish
shu faylda turadi. Ikki nusxa saqlanmaydi, ya'ni ular bir-biridan ajralib ketmaydi.

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

Mini App → **Admin** → **Ombor** oching. Ro'yxat chiqsa — qoidalar ishlayapti.
«Baza qoidalari ruxsat bermadi» degan xato chiqsa — Publish o'tmagan.

## Model

Mini App bazaga **to'g'ridan** o'qiydi va yozadi (Avto_A1 dagi kabi), shuning
uchun Render ham, Cloudflare Worker ham kerak bo'lmaydi.

Bu loyiha egasining ongli qarori: hozir ishlash muhim, xavfsizlik keyin
qattiqlashtiriladi.

## Nima ochiq

| Tugun | O'qish | Yozish | Nima uchun |
|---|---|---|---|
| `catalog` | ✅ | ✅ | Tovar, narx, qoldiq, banner, stories — admin paneli shu yerga yozadi |
| `pending_orders` | ✅ | ✅ | Buyurtma berish va admin ko'rishi |
| `pending_products` | ✅ | ✅ | Qoralamalar (Worker yo'li uchun) |
| `pending_edits` | ✅ | ✅ | Tuzatishlar (Worker yo'li uchun) |
| `users` | ✅ | ✅ | Profil, saqlanganlar |
| `bookings` | ✅ | ✅ | Navbat |
| `biled_orders` | ✅ | ✅ | Bi-LED buyurtmalari |
| `favorites` | ✅ | ✅ | Saqlangan tovarlar |
| `products_counter` | ✅ | ✅ | Yangi tovar uchun id sanoqchisi |

## Nima yopiq — va nega

Bu uchtasi **ataylab** yopiq. Mini App ularga murojaat qilmaydi, ya'ni ochilsa
foyda bermaydi, faqat zarar keltiradi.

**`orders`** — botning SQLite nusxasi. Brauzer bunga yozsa `restore_orders`
buziladi: u raqamli SQLite id kutadi. Natijada bot buyurtmalarni tiklay olmay
qoladi.

**`products`** — Excel importi qoralamalari va **ta'minotchi narxlari**. Bu savdo
maxfiyati; do'kon vitrinasida ko'rinmaydi va ko'rinishi ham kerak emas.

**`admins`** — adminlar ro'yxati.

## Bilib turish kerak

Baza manzili `docs/config.js` da, GitHub Pages'da ochiq turadi. Yuqorida
«ochiq» belgilangan tugunlarni manzilni bilgan istalgan odam o'qiy va
o'zgartira oladi.

## Keyinchalik yopishga qaytish

Kod qayta yozilmaydi. Worker orqali yozish yo'li (`/order`, `/profile`,
`/admin/*`) o'chirilmagan va ishlashda davom etadi. Yopish uchun shu fayldagi
`".write": true` larni `false` ga o'zgartirib, qaytadan **Publish** qilish
kifoya — mini app avtomatik Worker yo'liga o'tadi.
