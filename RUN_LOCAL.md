# Zimmer botni kompyuterda ishlatish (VS Code)

Render o'chgan yoki kvota tugagan paytda bot kompyuteringizda ishlab tursin.
Bot ishlayotgan vaqtda hammasi normal: buyurtma, navbat, admin panel, Firebase.

> ⚠️ **BIRINCHI QADAM — Render'ni to'xtatish.** Ikkita bot bitta token bilan
> bir vaqtda ishlay olmaydi: Telegram `409 Conflict` beradi va **ikkisi ham**
> xabarlarni yo'qotib qo'yadi. Pastdagi «Render'ni to'xtatish» bo'limini o'qing.

---

## 1. Nima kerak

| Nima | Izoh |
|---|---|
| **Python 3.10 yoki yuqori** | 3.11 tavsiya etiladi (Render'da ham shu). **3.9 va pastda ishlamaydi** — kod `str \| None` yozuvidan foydalanadi (PEP 604, 3.10+) |
| **VS Code** | + `Python` va `Python Debugger` kengaytmalari |
| **Bot tokeni** | BotFather'dan (Render'dagi bilan bir xil) |
| Firebase kaliti | Ixtiyoriy, lekin bulut bilan sinxron bo'lishi uchun tavsiya etiladi |

Python borligini tekshirish:

```bash
python --version      # Windows
python3 --version     # Mac / Linux
```

`3.10.x` yoki yuqori chiqishi kerak. Yo'q bo'lsa: <https://www.python.org/downloads/>
(Windows'da o'rnatishda **«Add Python to PATH»** ni belgilashni unutmang.)

---

## 2. Loyihani olish

```bash
git clone https://github.com/anvarjonaxtamov70/Zimmer.git
cd Zimmer
code .
```

Repo allaqachon bor bo'lsa — yangilab oling:

```bash
git checkout main
git pull
```

---

## 3. Virtual muhit va kutubxonalar

VS Code'da terminal ochish: **Ctrl+`** (Mac'da **Cmd+`**).

**Windows (PowerShell):**

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

> `Activate.ps1` ishlamasa (ruxsat xatosi), bir marta shuni bajaring:
> `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`

**Mac / Linux:**

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

O'rnatish ~1–2 daqiqa (`pandas` kattaroq).

Keyin VS Code pastdagi holat qatorida **`.venv`** ni tanlang, yoki
**Ctrl+Shift+P → «Python: Select Interpreter» → `.venv`**.

---

## 4. `.env` faylini yasash

```bash
# Windows
copy .env.example .env

# Mac / Linux
cp .env.example .env
```

Endi `.env` ni ochib **kamida shu ikkitasini** to'g'rilang:

```env
BOT_TOKEN=BotFather'dan olgan haqiqiy token
ADMINS=5105291033,483425630,5302078
```

Qolganini o'zgartirmasa ham bo'ladi. Firebase bilan sinxron bo'lishi uchun:

```env
FIREBASE_DB_URL=https://zimmer-42840-default-rtdb.firebaseio.com
FIREBASE_ROOT=zimmer
FIREBASE_STORAGE_BUCKET=zimmer-42840.appspot.com
SERVICE_ACCOUNT_FILE=serviceAccount.json
```

`serviceAccount.json` faylini **loyiha ildiziga** qo'ying (Firebase Console →
Project settings → Service accounts → «Generate new private key»).

> 🔒 `serviceAccount.json`, `.env` va `*.db` — `.gitignore` da, ya'ni GitHub'ga
> **tushmaydi**. Baribir `git status` bilan tekshirib turing: bu kalit ochilsa
> butun bazaga to'liq kirish imkoni beriladi.

`.env` da `SERVICE_ACCOUNT_JSON` (base64) ham ishlaydi — Render'dagi qiymatni
shundayligicha ko'chirsangiz bo'ladi.

---

## 5. Ishga tushirish

**Eng oson:** VS Code'da **F5** bosing → «Zimmer bot (lokal)».

Yoki terminaldan:

```bash
python bot.py
```

Muvaffaqiyatli bo'lsa terminalda shunga o'xshash chiqadi:

```
INFO | zimmer | Firebase ulandi: https://zimmer-42840-default-rtdb.firebaseio.com/zimmer
INFO | api.server | API server ishga tushdi: 0.0.0.0:8080 (/health, /api/*)
INFO | zimmer | Bot ishga tushdi: @Zimmer_uz_bot (1234567890)
```

Endi Telegram'da botga `/start` yozib ko'ring — javob berishi kerak.

To'xtatish: terminalda **Ctrl+C**.

### Ikkinchi konfiguratsiya — «Firebase'siz»

F5 menyusida **«Zimmer bot (Firebase'siz — faqat lokal baza)»** ham bor.
U bulutga umuman tegmaydi va alohida bazada (`zimmer-local.db`) ishlaydi —
haqiqiy ma'lumotga zarar bermasdan sinash uchun qulay.

---

## 6. Render'ni to'xtatish (majburiy)

Telegram bitta tokenga **faqat bitta** long-polling ulanishiga ruxsat beradi.
Render tirilib qolsa, ikkisi bir-birining xabarlarini tortib oladi va bot
tasodifiy javob bermay qo'yadi (`409 Conflict`).

**Render panelida:** xizmatni tanlang → o'ng yuqoridagi menyu → **Suspend**.

Bu ikki foyda beradi:

1. `409` to'qnashuvi bo'lmaydi;
2. **bepul soatlar sarflanmaydi** — kvota to'planib turadi va keyin
   xohlagan paytda davom etasiz.

Ishni tugatgach: **Resume** → botni kompyuterda **Ctrl+C** bilan to'xtatasiz.

> Hozir xizmat allaqachon 503 (kvota tugagan), shuning uchun to'qnashuv yo'q.
> Lekin **1-sentabrda kvota tiklanadi** va u o'zi ishga tushib ketishi mumkin —
> shuning uchun Suspend qilib qo'yish eng ishonchli.

---

## 7. Mini App'ni lokal botga ulash (ixtiyoriy)

Bot Telegram ichida to'liq ishlaydi — Mini App'ga hech narsa qilish shart emas.
Ilova esa **PR #64 dan keyin** `catalog.json` orqali katalogni baribir
ko'rsatadi (server o'chgan bo'lsa ham).

Lekin Mini App'da **buyurtma berish, navbat olish va admin panel** ishlashi
uchun u sizning kompyuteringizdagi API'ga ulanishi kerak. Telefon
`localhost` ga yeta olmaydi, shuning uchun tunnel kerak.

**Cloudflare tunnel (bepul, ro'yxatdan o'tish shart emas):**

```bash
# Windows:  winget install --id Cloudflare.cloudflared
# Mac:      brew install cloudflared
# Linux:    https://github.com/cloudflare/cloudflared/releases

cloudflared tunnel --url http://localhost:8080
```

Terminalda shunday manzil chiqadi:

```
https://random-words-1234.trycloudflare.com
```

Endi Mini App'ni **bir marta** shu manzil bilan ochsangiz, ilova uni
`localStorage` ga saqlab qoladi:

```
https://anvarjonaxtamov70.github.io/Zimmer/?api=https://random-words-1234.trycloudflare.com
```

Bu havolani brauzerda emas, **Telegram ichida** ochish kerak — masalan o'zingizga
xabar qilib yuborib bosasiz.

Tekshirish: `https://random-words-1234.trycloudflare.com/health` ochilsa,
`{"status":"ok", ...}` chiqadi.

**Render'ga qaytish:** ilovani shu havola bilan bir marta ochasiz —

```
https://anvarjonaxtamov70.github.io/Zimmer/?api=https://zimmer-bot.onrender.com
```

> Profildagi «Keshni tozalash» tugmasi bu ishga **yaramaydi** — u faqat
> sahifani qayta yuklaydi, saqlangan API manzilini o'chirmaydi. Manzilni
> almashtirishning yagona yo'li — yuqoridagi `?api=` havolasi.

> ⚠️ Bepul tunnel manzili har ishga tushirishda **o'zgaradi**. Har safar
> yangi `?api=` havolasini ochish kerak.

---

## 8. Bulut bilan sinxronlash

Lokal bot ishga tushganda Firebase'dan mijozlar va katalogni **o'zi tiklaydi**.
Teskari yo'nalish uchun (mahalliy → bulut) botga:

```
/firebase
```

Javobda «Bulutga yuklandi: N katalog yozuvi, M mijoz» ko'rinadi. Shundan keyin:

- Mini App'ning zaxira rejimi jonli katalogni ko'rsatadi;
- Render tirilganda ma'lumot yo'qolmaydi.

Boshqa foydali buyruqlar: `/admin` (panel), `/products_list`, `/add_product`.

---

## 9. Tez-tez uchraydigan muammolar

| Xato | Sabab va yechim |
|---|---|
| `BOT_TOKEN topilmadi` | `.env` yasalmagan yoki token yozilmagan. Fayl nomi aynan `.env` (`.env.txt` emas) |
| `TelegramConflictError` / `409` | Render'da ham bot ishlayapti. Xizmatni **Suspend** qiling |
| `ModuleNotFoundError: aiogram` | `.venv` yoqilmagan yoki `pip install -r requirements.txt` bajarilmagan |
| `TypeError: unsupported operand type(s) for \|` | Python 3.9 yoki pastroq. 3.10+ kerak |
| `API server yoqilmadi (lokal rejim)` | `API_PORT` berilmagan. F5 bilan ishga tushirsangiz o'zi qo'yiladi |
| Botda «doimiy saqlash o'chiq» ogohlantirishi | Firebase kaliti yo'q/xato. `/firebase` yuborib aniq sababni ko'ring |
| Mini App'da «Server uyg'onmoqda» chizig'i | Normal: ilova zaxira rejimda. Tunnel ulasangiz yo'qoladi |
| `Activate.ps1 ... ruxsat berilmadi` | `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` |

---

## 10. Qisqa xulosa

```bash
git pull
python -m venv .venv && .\.venv\Scripts\Activate.ps1   # Windows
pip install -r requirements.txt
copy .env.example .env        # keyin BOT_TOKEN ni yozing
# Render panelida xizmatni Suspend qiling
# VS Code'da F5
```

Bot Telegram'da javob bersa — tayyor. Kompyuter o'chsa bot ham to'xtaydi,
shuning uchun uzoq muddatga Render (yoki boshqa server) baribir kerak.
