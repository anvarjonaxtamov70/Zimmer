# Render'dan boshqa qaysi platformalar mos?

Zimmer va Avto_A1 botlari uchun talablar:

- **Python 3.10+** va **doim ishlab turadigan jarayon** (Telegram long-polling)
- **~512 MB xotira** — `pandas` (Excel import) 256 MB da yiqilishi mumkin
- GitHub'dan avtomatik deploy
- **Uxlamasligi** yoki tashqi ping bilan uyg'oq turishi

---

## Qiyoslash

| Platforma | Bepul chegara | Uxlaydimi | Karta kerakmi | Botga mos? |
|---|---|---|---|---|
| **Koyeb** | **1 xizmat, 512 MB** | Kelajakda scale-to-zero rejalashtirilgan | ❌ yo'q | ✅ **Eng mos bepul** |
| **Render** | 750 soat/oy (butun akkaunt) | 15 daqiqada | ❌ yo'q | ⚠️ Faqat **1** xizmat 24/7 sig'adi |
| **Fly.io** | 256 MB × 3 mashina | ❌ uxlamaydi | ✅ kerak | ⚠️ 512 MB pullik bo'ladi |
| **Railway** | $5 kredit/oy | ❌ uxlamaydi | ✅ kerak | ⚠️ Kredit tugaydi |
| **Oracle Cloud** | **4 ARM yadro, 24 GB RAM, doimiy** | ❌ uxlamaydi | ✅ tekshirish uchun | ✅ **Eng kuchli**, lekin sozlash ko'p |
| **Google Cloud Run** | Saqiy bepul chegara | Nolga tushadi | ✅ kerak | ❌ Webhook kerak (kod o'zgaradi) |

> ⚠️ Bepul tariflar tez o'zgaradi. Ishga tushirishdan oldin provayder sahifasida
> tekshirib oling. Manbalar: [Koyeb — 512 MB bepul instans](https://www.koyeb.com/blog/new-eco-instances-the-most-affordable-way-to-deploy-apps-globally) ·
> [Koyeb — scale-to-zero rejasi](https://www.koyeb.com/blog/sustaining-free-compute-in-a-hostile-environment) ·
> [Render — 750 soat/oy](https://render.com/articles/platforms-with-a-real-free-tier-for-developers-in-2026) ·
> [Oracle Always Free](https://docs.oracle.com/iaas/Content/FreeTier/resourceref.htm)

---

## Asosiy hisob — muammoning ildizi

```
Render bepul:  750 soat/oy  (BUTUN akkaunt uchun, xizmatlar bo'ylab umumiy)

1 xizmat 24/7  =  744 soat/oy   ✅ sig'adi
2 xizmat 24/7  = 1488 soat/oy   ❌ oyning o'rtasida tugaydi
```

**Ya'ni bitta bot Render'da bepul 24/7 ishlashi mumkin, ikkitasi — yo'q.**
Shuning uchun yechim: **bitta botni boshqa provayderga ko'chirish**.

Bu yangi Render akkaunti yasashdan farq qiladi — ko'p akkaunt bilan limitni
aylanib o'tish provayderlar qoidalarida taqiqlangan va ikkala akkaunt ham
bloklanishi mumkin.

---

## Tavsiya etilgan taqsimot

| Bot | Platforma | Sabab |
|---|---|---|
| **Zimmer** | **Koyeb** (512 MB bepul) | Mini App API'si va Excel import uchun xotira kerak |
| **Avto_A1** | **Render** (744 soat sig'adi) | Yolg'iz qolganda 24/7 bepul ishlaydi |

Har ikkisi ham bepul, qoida buzilmaydi, kvota to'qnashuvi yo'q.

**Uzoq muddatga eng yaxshisi:** Oracle Cloud Always Free — bitta VM'da
ikkala bot ham, hech qachon uxlamaydi, 24 GB RAM. Lekin bu oddiy VM,
ya'ni Docker/systemd o'zingiz sozlaysiz va «out of host capacity» xatosi
ko'p uchraydi.

---

## Koyeb'ga deploy (Zimmer)

Repo tayyor: `Dockerfile` va `.dockerignore` qo'shildi.

**1.** <https://app.koyeb.com> → GitHub bilan kiring

**2.** **Create Service** → **GitHub** → `Zimmer` repo → branch `main`

**3.** **Builder** → `Dockerfile` (avtomatik topiladi)

**4.** **Instance** → **Free** (512 MB)

**5.** **Health check** → `HTTP`, path `/health`, port `8080`

**6.** **Environment variables** — quyidagilarni kiriting:

| Nom | Qiymat |
|---|---|
| `BOT_TOKEN` | BotFather tokeni *(secret)* |
| `SERVICE_ACCOUNT_JSON` | `serviceAccount.json` ning base64 ko'rinishi *(secret)* |
| `ADMINS` | `5105291033,483425630,5302078` |
| `FIREBASE_DB_URL` | `https://zimmer-42840-default-rtdb.firebaseio.com` |
| `FIREBASE_ROOT` | `zimmer` |
| `FIREBASE_STORAGE_BUCKET` | `zimmer-42840.appspot.com` |
| `MINI_APP_URL` | `https://anvarjonaxtamov70.github.io/Zimmer/` |
| `SHOP_NAME` | `Zimmer` |
| `TIMEZONE` | `Asia/Tashkent` |

`PORT` ni **qo'lda kiritmang** — Koyeb o'zi beradi.

**7.** **Deploy**. Loglarda shu chiqishi kerak:

```
INFO | api.server | API server ishga tushdi: 0.0.0.0:8080 (/health, /api/*)
INFO | zimmer | Bot ishga tushdi: @...
```

---

## Fly.io'ga deploy (muqobil)

`fly.toml` repoda tayyor.

```bash
# CLI o'rnatish
curl -L https://fly.io/install.sh | sh      # Mac/Linux
# Windows: iwr https://fly.io/install.ps1 -useb | iex

fly auth login
fly launch --no-deploy       # mavjud fly.toml ni ishlatadi

# Maxfiy qiymatlar (image ichiga TUSHMAYDI)
fly secrets set BOT_TOKEN="..." \
                SERVICE_ACCOUNT_JSON="..." \
                FIREBASE_DB_URL="https://zimmer-42840-default-rtdb.firebaseio.com" \
                ADMINS="5105291033,483425630,5302078"

fly deploy
fly logs
```

> `fly.toml` da `auto_stop_machines = false` — buni **o'zgartirmang**.
> Aks holda mashina to'xtatiladi va bot xabarlarga javob bermaydi.

---

## Avto_A1 uchun

`bot/Dockerfile` allaqachon bor. Koyeb'da xuddi shu qadamlar, faqat:

- **Work directory / Dockerfile path** → `bot`
- Environment variables: `BOT_TOKEN`, `GROQ_API_KEY`, `SERVICE_ACCOUNT_JSON`,
  `ADMIN_IDS`, `WORKER_URL`, `FIREBASE_DB_URL`, `MINI_APP_URL`,
  `GROQ_TEXT_MODEL=openai/gpt-oss-120b`, `GROQ_VISION_MODEL=qwen/qwen3.6-27b`

---

## ⚠️ Ko'chirishdan oldin — majburiy 3 qadam

**1. Render'da xizmatni Suspend qiling.**
Telegram bitta tokenga faqat **bitta** long-polling ulanishiga ruxsat beradi.
Ikkisi bir vaqtda ishlasa `409 Conflict` bo'ladi va **ikkisi ham** xabar
yo'qotadi.

**2. Yangi manzilni `docs/config.js` ga yozing.**

```js
API_BASE: "https://zimmer-bot-xxxx.koyeb.app",
```

**3. keep-alive manzilini yangilang.**
Repo → **Settings → Secrets and variables → Actions → Variables** →
`KEEP_ALIVE_URLS` = yangi manzil.

Koyeb/Fly uxlamasa keep-alive kerak ham emas — u holda workflow'ni
o'chirib qo'yish mumkin (kvota sarflanmaydi).

---

## Ko'chirgandan keyin

**1.** Botga `/firebase` yuboring — butun katalog va barcha mijozlar bulutga
chiqadi. Bepul tariflarda disk saqlanmaydi, shuning uchun bu **muhim**.

**2.** Tekshiring: `https://yangi-manzil/health` → `{"status":"ok", ...}`

**3.** Tashxis workflow'ini ishga tushiring: **Actions → «Tashxis» → Run workflow**.
U yangi manzilni `docs/config.js` dan **o'zi o'qiydi**.

---

## Qisqa xulosa

| Sizning holatingiz | Nima qilish |
|---|---|
| 1-sentabrga qadar (6 kun) | Eng oson — **kompyuterda ishlatish** (`RUN_LOCAL.md`) |
| Doimiy bepul yechim | **Zimmer → Koyeb**, **Avto_A1 → Render** |
| Eng ishonchli | **$7/oy Render Starter** bittasiga, ikkinchisi bepul |
| Eng kuchli bepul | **Oracle Cloud** VM — ikkisi bir joyda, uxlamaydi |
