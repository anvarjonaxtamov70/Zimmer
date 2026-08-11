# ☁️ Zimmer botni bulutga joylash (Render.com — bepul)

Bot 24/7 ishlashi uchun kompyuterni yoqib qo'yish shart emas. Quyidagi
qadamlar Avto_A1 botidagi bilan bir xil sxemada ishlaydi:
**`render.yaml` blueprint + `/health` endpoint + GitHub Actions keep-alive**.

---

## 1. Render'da xizmat yaratish (5 daqiqa)

1. [render.com](https://render.com) → **Sign in with GitHub**
2. Yuqoridagi **New +** → **Blueprint**
3. Repo ro'yxatidan **`Zimmer`** ni tanlang → **Connect**
   - Render repo ildizidagi `render.yaml` ni o'zi topadi va
     `zimmer-bot` nomli bepul web xizmatini taklif qiladi
4. **Apply / Create** bosing
5. Render maxfiy qiymatlarni so'raydi — ularni kiritasiz:

| Kalit | Qiymat |
|---|---|
| `BOT_TOKEN` | BotFather bergan token |
| `ADMINS` | Telegram ID'ingiz (bir nechta bo'lsa vergul bilan: `123,456`) |

> ID'ni bilish: botga `/id` yuboring yoki [@userinfobot](https://t.me/userinfobot).

6. **Deploy** tugashini kutamiz (2-4 daqiqa). **Logs** bo'limida shunday
   qator chiqishi kerak:

```
Health server ishga tushdi: 0.0.0.0:10000 (/health)
Bot ishga tushdi: @sizning_bot (123456789)
```

7. Tekshirish: brauzerda **`https://zimmer-bot.onrender.com/health`** ni
   ochsangiz shunday javob keladi:

```json
{"status": "ok", "bot": "sizning_bot", "uptime_seconds": 42, ...}
```

Endi Telegram'da botga `/start` yozib sinab ko'ring. ✅

---

## 2. Botni uxlab qolishdan saqlash

Bepul tarifda Render xizmatni **15 daqiqa so'rov bo'lmasa uxlatadi**.
Repodagi `.github/workflows/keep-alive.yml` har 10 daqiqada `/health`
manziliga ping yuborib botni uyg'oq tutadi.

Sozlash:

1. GitHub repo → **Actions** → agar so'rasa **"I understand my workflows,
   go ahead and enable them"** bosing
2. Render bergan manzil `https://zimmer-bot.onrender.com` dan farq qilsa:
   **Settings → Secrets and variables → Actions → Variables → New variable**
   - Name: `KEEP_ALIVE_URLS`
   - Value: `https://sizning-manzilingiz.onrender.com`
3. Qo'lda tekshirish: **Actions → Keep Alive → Run workflow**

---

## 3. ⚠️ Ma'lumotlar saqlanishi (muhim!)

Bepul tarifda Render diskni **saqlamaydi**: har qayta deploy yoki
konteyner restartida `zimmer.db` fayli **noldan yaratiladi** — navbatlar,
buyurtmalar va foydalanuvchilar yo'qoladi.

Sinab ko'rish uchun bu yetarli. **Haqiqiy mijozlar bilan ishlashdan oldin**
quyidagilardan birini tanlash kerak:

| Variant | Narxi | Izoh |
|---|---|---|
| **Neon / Supabase PostgreSQL** | bepul | Tavsiya etiladi. Bulutdagi doimiy baza, kod PostgreSQL'ga o'tkaziladi |
| **Firebase Realtime DB** | bepul | Avto_A1'da ishlatilgani kabi (siz allaqachon tanishsiz) |
| **Render Persistent Disk** | ~$7/oy | SQLite o'z holida qoladi, hech narsa o'zgartirilmaydi |

> Bu ishni menga aytsangiz, alohida PR qilib bajarib beraman —
> `database/queries.py` faylidagi so'rovlar PostgreSQL'ga moslashtiriladi,
> qolgan kod o'zgarmaydi.

---

## 4. Yangilanishlarni chiqarish

`autoDeploy: true` yoqilgani uchun `main` branch'ga har push avtomatik
qayta deploy qiladi. Qo'lda: Render panel → **Manual Deploy → Deploy latest commit**.

---

## 5. Ko'p uchraydigan muammolar

**`TelegramConflictError: terminated by other getUpdates request`**
Bot ikki joyda bir vaqtda ishlayapti. Kompyuterdagi `python bot.py` ni
to'xtating — bitta token bilan faqat bitta nusxa ishlashi kerak.

**Deploy "live" bo'ldi, lekin bot javob bermaydi**
Logs'ni oching. `BOT_TOKEN topilmadi` degan xato bo'lsa — Render panel →
**Environment** bo'limida token kiritilganini tekshiring.

**Xizmat "Bad Gateway" / port xatosi**
`/health` serveri `PORT` env orqali ishlaydi, uni Render o'zi beradi.
`startCommand` `python bot.py` bo'lishi kerak (`render.yaml` da shunday).

**Birinchi javob sekin (30-60 soniya)**
Bot uxlagan bo'lsa, "sovuq start" vaqt oladi. Keep-alive workflow yoqilgan
bo'lsa, bu deyarli bo'lmaydi.

**Admin panel ochilmayapti**
`ADMINS` ichida sizning ID borligini tekshiring, o'zgartirgandan keyin
Render xizmatni qayta ishga tushiradi.
