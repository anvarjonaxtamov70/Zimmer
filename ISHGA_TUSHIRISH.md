# Ishga tushirish — qadam-baqadam

Kod GitHub'da tayyor bo'lishi **yetarli emas**: uchta tashqi xizmat qo'lda
sozlanadi. Bu sahifa aynan shu ishlarni ketma-ket yozadi.

Har bir qadamdan keyin **tekshirish** bor — bajarilganini ko'z bilan
ko'rasiz.

---

## 0. Avval TASHXIS ishga tushiring

Nimani qilish kerakligini **taxmin qilmaslik** uchun. Bu ishlar hech
narsani o'zgartirmaydi — faqat o'qiydi.

1. GitHub'da repoga kiring → yuqoridagi **Actions** yorlig'i
2. Chapdan **«Tashxis (nima ishlayapti, nima yo'q)»** ni tanlang
3. O'ngdan **Run workflow** → yashil **Run workflow** tugmasi
4. 1 daqiqa kutib, paydo bo'lgan ishni bosing

Har bir qatlam uchun ✅ yoki ❌ yozadi:

| Qatlam | ❌ bo'lsa |
| --- | --- |
| Render (bot API) | Bot uxlagan / kvota tugagan |
| Firebase RTDB | **1-qadam** bajarilmagan |
| Cloudflare Worker | **2-qadam** bajarilmagan |
| GitHub Pages | Ilova fayllari chiqmagan |

Tashxis Worker'ning **eski nusxasi** turganini ham aytadi.

---

## 1. Firebase qoidalari — ENG MUHIM

**Bajarilmasa:** mijozlar bazasi (ism, telefon, manzil) internetda
**hammaga ochiq** qoladi.

### Qadamlar

1. <https://console.firebase.google.com> ni ochib, loyihani tanlang
2. Chap menyu: **Build** → **Realtime Database**
3. Yuqoridagi **Rules** yorlig'i
4. Yangi oynada shu manzilni ochib, matnni to'liq nusxalang
   (`Ctrl+A` → `Ctrl+C`):

   <https://raw.githubusercontent.com/anvarjonaxtamov70/Zimmer/main/database.rules.json>

5. Console'dagi tahrirlagichda `Ctrl+A` → `Ctrl+V` (hammasini
   almashtirasiz)
6. **Publish** tugmasini bosing

> ⚠️ Matnni **chatdan yoki hujjatdan nusxa olmang** — faqat yuqoridagi
> `raw` manzildan. Aks holda qo'shtirnoq va apostroflar buzilib Console
> xato beradi.

### Tekshirish

Tashxisni (0-qadam) qaytadan ishga tushiring. **Firebase** qatlami:

| Natija | Ma'nosi |
| --- | --- |
| ✅ `Firebase OCHIQ va katalog TO'LA` | Tayyor |
| ❌ `401/403 — o'qishni RAD ETDI` | Publish o'tmagan, qaytadan |
| ❌ `200 + null — katalog BO'SH` | Qoidalar to'g'ri. Botga `/firebase` yuboring |

Ilovada ham ko'rinadi: do'kon ochiladi, tovarlar chiqadi, admin →
**Ombor** → qoldiqni o'zgartirish ishlaydi.

---

## 2. Cloudflare Worker — kodni qayta qo'yish

**Bajarilmasa:** admin panelida buyurtmalar ro'yxati **bo'sh** ko'rinadi
va holat o'zgarganda mijozga xabar ketmaydi.

Cloudflare GitHub'dan **o'zi yangilanmaydi**. Kod qo'lda qo'yiladi.

### Qadamlar

1. <https://dash.cloudflare.com> → chapdan **Workers & Pages**
2. Ro'yxatdan Worker'ni tanlang — nomi **`zimmer-worker`**
   (`docs/config.js` dagi `WORKER_URL` shunga ishora qiladi)
3. O'ng tepadan **Edit code** (yoki `< >` belgisi / **Quick edit**)
4. Muharrirdagi **hamma kodni o'chirib** (`Ctrl+A` → `Delete`), repodagi
   `cloudflare-worker.js` faylining **to'liq matnini** qo'ying:

   <https://raw.githubusercontent.com/anvarjonaxtamov70/Zimmer/main/cloudflare-worker.js>

5. **Deploy** (yoki **Save and deploy**)

> **Secret'larga tegmaysiz** — ular joyida qoladi. Faqat kod almashadi.
> Qism-qism emas, **butun faylni** almashtirasiz.

### Agar Worker hali YARATILMAGAN bo'lsa

Ro'yxatda `zimmer-worker` bo'lmasa — avval yaratish kerak. To'liq
ko'rsatma: **`WORKER_SETUP.md`**, «1. Worker yaratish» va «2. Secret'larni
kiritish». Qisqacha, kiritiladigan qiymatlar:

**Secret** (Encrypt belgilangan):

| Nom | Qiymat |
| --- | --- |
| `BOT_TOKEN` | BotFather tokeni |
| `FIREBASE_CLIENT_EMAIL` | `serviceAccount.json` → `client_email` |
| `FIREBASE_PRIVATE_KEY` | `serviceAccount.json` → `private_key` (butun matn, `-----BEGIN...` bilan) |

**Oddiy o'zgaruvchi** (Text):

| Nom | Qiymat |
| --- | --- |
| `FIREBASE_DB_URL` | `https://zimmer-42840-default-rtdb.firebaseio.com` |
| `FIREBASE_ROOT` | `zimmer` |
| `ADMIN_IDS` | `5105291033,483425630,5302078` |
| `INIT_DATA_MAX_AGE` | `86400` |

### Tekshirish

Brauzerda oching:

```
https://zimmer-worker.anvaraxtamov70.workers.dev/health
```

Kutilgan javob:

```json
{
  "status": "ok",
  "version": "1.5.0",
  "configured": { "bot_token": true, "firebase_key": true,
                  "db_url": true, "admins": 3 }
}
```

| Nima ko'rinsa | Ma'nosi |
| --- | --- |
| `version` **1.5.0** | ✅ Yangi nusxa turibdi |
| `version` 1.4.0 yoki pastroq | ❌ 4-qadam bajarilmagan |
| Biror `configured` da `false` | ❌ O'sha o'zgaruvchi kiritilmagan |
| Sahifa umuman ochilmadi | ❌ Worker yaratilmagan yoki manzil boshqa |

Mini App ham buni o'zi tekshiradi: admin panelini ochganda eski nusxa
bo'lsa **«Cloudflare'da Worker'ning ESKI nusxasi turibdi»** deb aytadi.

---

## 3. Render'da to'lov rekvizitlari

**Bajarilmasa:** Mini App'da «Karta orqali» to'lov usuli **umuman
ko'rinmaydi** (mijoz faqat naqd pulni tanlaydi).

Ilgari karta raqami `config.py` da yozilib turgan edi — ya'ni GitHub'da
hammaga ko'rinardi. Endi u faqat Render panelida turadi.

### Qadamlar

1. <https://dashboard.render.com> → **zimmer-bot** xizmatini tanlang
2. Chap menyu: **Environment**
3. **Add Environment Variable** bilan uchtasini qo'shing:

| Key | Value (o'zingizning haqiqiy ma'lumot) |
| --- | --- |
| `PAY_CARD_NUMBER` | `8600 1234 5678 9012` |
| `PAY_CARD_HOLDER` | `ANVARJON AXTAMOV` |
| `PAY_ADMIN_USERNAME` | `anvaraxtamov2004` |

> `PAY_ADMIN_USERNAME` — **`@` belgisisiz**. Mijoz chekni shu odamga
> yuboradi.

4. **Save Changes** → Render o'zi qayta deploy qiladi (2–3 daqiqa)

### Tekshirish

Mini App'ni oching → biror tovarni savatga soling → **Rasmiylashtirish**
→ to'lov usullari. **«💳 Karta orqali»** paydo bo'lishi kerak, ichida
karta raqami va egasining ismi ko'rinadi.

Ko'rinmasa: uchtasidan biri bo'sh qolgan yoki deploy hali tugamagan.

---

## 4. `WORKER_URL` — allaqachon sozlangan

`docs/config.js` da turibdi:

```js
WORKER_URL: "https://zimmer-worker.anvaraxtamov70.workers.dev",
```

Ya'ni **bu qadam alohida ish talab qilmaydi** — 2-qadamni bajarsangiz
o'zi ishlaydi. Faqat bitta shart: Cloudflare'dagi Worker nomi shu
manzilga **mos** bo'lishi kerak.

Nomi boshqa bo'lsa (masalan `zimmer-bot`), ikki yo'l bor:

* Cloudflare'da Worker'ni shu nom bilan yarating, **yoki**
* `docs/config.js` dagi `WORKER_URL` ni haqiqiy manzilga o'zgartirib
  push qiling (GitHub Pages 1–2 daqiqada yangilanadi).

### Tekshirish

Tashxis (0-qadam) → **Cloudflare Worker** qatlami ✅ bo'lsa, manzil
to'g'ri.

---

## Yakuniy tekshiruv ro'yxati

Hammasini bajarib bo'lgach, Mini App'da bir marta bosib chiqing:

- [ ] Do'kon ochiladi, tovarlar va rasmlar ko'rinadi
- [ ] Xizmatlar → navbat olish → bo'sh vaqtlar chiqadi
- [ ] Savat → Rasmiylashtirish → **«Karta orqali»** bor *(3-qadam)*
- [ ] Buyurtma berish ishlaydi, adminga Telegram xabari keladi
- [ ] Boshqaruv → **Buyurtmalar** ro'yxati to'la *(1 va 2-qadam)*
- [ ] Boshqaruv → **Ombor** → qoldiqni o'zgartirish saqlanadi *(1-qadam)*
- [ ] Boshqaruv panelida **ogohlantirish yozuvi yo'q** *(2-qadam)*

Biror joyda muammo bo'lsa — **Actions → Tashxis → Run workflow**. U
aynan qaysi qatlam yiqilganini aytadi.
