"""«SHOGIRD» — Mini App ichidagi yordamchi.

NEGA ALOHIDA MODUL (`ai_brain` yetarli emasmi?)

`services/ai_brain.py` — BOTDAGI suhbat uchun yozilgan va uning eng
asosiy ko'rsatmasi shunday: «ASOSIY VAZIFANG — MIJOZNI DO'KONGA (MINI
ILOVAGA) OLIB BORISH». Botda bu to'g'ri: mijoz Telegram yozishmasida
turadi va uni ilovaga chaqirish kerak.

Mini App ichida esa bu ko'rsatma ZARARLI — mijoz ALLAQACHON ilovada.
«Do'konni ochish» degan javob uni chalkashtiradi va yordamchi
foydasiz bo'lib qoladi. Shogird boshqa ish qiladi: mijozni ILOVA
ICHIDA yo'naltiradi («🛠 Xizmatlar» → «Fara polirovkasi» → «Navbat
olish»).

IKKINCHI FARQ — JAVOBGA ILOVANING O'ZIDAN KARTOCHKA QO'SHILADI.
Model faqat MATN yozadi. Mijozga esa bosiladigan narsa kerak. Shu
sababli javob matni va savol katalogga solishtirilib, mos xizmat va
tovarlar ID'si bilan qaytariladi — ilova ularni haqiqiy kartochka
qilib chizadi («Savatga qo'shish», «Navbat olish»).

MUHIM: kartochkalar MODEL TANLAMAYDI, ular bazadagi nomlar bilan
solishtirish orqali topiladi. Ya'ni yo'q tovar hech qachon
ko'rsatilmaydi va narx ham modeldan emas, bazadan keladi.

Katalog matni (`ai_brain.catalog_snapshot`) QAYTA ISHLATILADI — kesh
bot bilan umumiy, ya'ni admin narxni o'zgartirsa ikkisi ham bir vaqtda
biladi.
"""

from __future__ import annotations

import logging
import re
import time
from dataclasses import dataclass

from config import config, is_admin, is_owner
from database import queries as q
from services import ai, ai_brain
from utils.helpers import fmt_price

logger = logging.getLogger(__name__)

# Savol uzunligi. Uzun matn tokenni yeydi va bepul tarif chegarasiga
# tezroq olib boradi; 700 belgi — bir necha gap uchun yetarli.
MAX_QUESTION_LEN = 700

# Ketma-ket so'rovlar orasidagi eng kichik oraliq (soniya).
# Botdagidan (3 s) kichikroq: ilovada tugma so'rov ketayotganda o'zi
# bloklanadi, ya'ni tasodifiy ikki bosish allaqachon oldini olingan.
COOLDOWN_SECONDS = 2

# Suhbat tarixi: nechta juftlik saqlanadi.
HISTORY_TURNS = 5

# Xotira cheksiz o'smasligi uchun
_TALK_TTL = 30 * 60
_TALK_MAX = 300

# Javobga qo'shiladigan kartochkalar soni. Ko'p bo'lsa javob katalogga
# aylanib ketadi va matn o'qilmaydi.
MAX_PRODUCT_CARDS = 3
MAX_SERVICE_CARDS = 2

# Javob uzunligi. Ilovada pufakcha ko'rinishida chiziladi — uzun matn
# ekranni to'ldirib, ostidagi kartochkalar ko'rinmay qoladi.
MAX_TOKENS = 520

_talks: dict[int, ai.Conversation] = {}
_last_call: dict[int, float] = {}
_busy: set[int] = set()


# ------------------------------------------------------------------ suhbat


def _talk(user_id: int) -> ai.Conversation:
    """Foydalanuvchining suhbatini oladi, eskilarini tozalaydi."""
    now = time.time()

    if len(_talks) > _TALK_MAX:
        stale = [uid for uid, talk in _talks.items() if now - talk.touched > _TALK_TTL]
        for uid in stale:
            _talks.pop(uid, None)
        if len(_talks) > _TALK_MAX:
            oldest = sorted(_talks.items(), key=lambda item: item[1].touched)
            for uid, _ in oldest[: len(_talks) - _TALK_MAX]:
                _talks.pop(uid, None)

    talk = _talks.get(user_id)
    if talk is None or now - talk.touched > _TALK_TTL:
        talk = ai.Conversation()
        _talks[user_id] = talk
    talk.touched = now
    return talk


def reset(user_id: int) -> None:
    """Suhbatni boshidan boshlaydi («↻ Yangi suhbat» tugmasi)."""
    _talks.pop(user_id, None)


def has_talk(user_id: int) -> bool:
    """Shu foydalanuvchi bilan yozishma boshlanganmi."""
    talk = _talks.get(user_id)
    return bool(talk and talk.messages)


def cooldown_left(user_id: int) -> float:
    last = _last_call.get(user_id, 0.0)
    return max(0.0, COOLDOWN_SECONDS - (time.time() - last))


def busy(user_id: int) -> bool:
    """Shu foydalanuvchining so'rovi hozir bajarilyaptimi."""
    return user_id in _busy


# ---------------------------------------------------------------- ko'rsatma


def _address(user_id: int | None, name: str) -> str:
    """Shogird foydalanuvchiga qanday murojaat qiladi."""
    if is_owner(user_id):
        return (
            "Bu odam — DO'KON EGASI. Unga «xo'jayin» deb murojaat qil. "
            "Qisqa va ishga oid gapir."
        )
    if is_admin(user_id):
        return (
            "Bu odam — do'kon ADMINI. Unga «admin» deb murojaat qil. "
            "U mijoz emas, xodim."
        )
    if name:
        return f"Bu — MIJOZ, ismi: {name}. Unga ismi bilan, «siz» deb murojaat qil."
    return "Bu — MIJOZ. Unga «siz» deb, iliq murojaat qil."


async def system_prompt(user_id: int | None, name: str = "") -> str:
    """Shogird uchun to'liq ko'rsatma.

    `ai_brain.system_prompt` dan farqi — YO'NALTIRISH. Botda maqsad
    «ilovani ochish», bu yerda esa mijoz ilova ichida bo'lgani uchun
    maqsad — TO'G'RI BO'LIMGA olib borish.
    """
    catalog = await ai_brain.catalog_snapshot()

    contact_lines = []
    if config.shop_phone:
        contact_lines.append(f"telefon {config.shop_phone}")
    if config.pay_admin_username:
        contact_lines.append(f"Telegram @{config.pay_admin_username}")
    contact = ", ".join(contact_lines) or "ustaxona bilan"

    return f"""Sen — «{config.shop_name}» avtochiroq ustaxonasining SHOGIRDIsan.
Samarqandda joylashganmiz. Fara (avtomobil chiroqlari) bilan ishlaymiz:
Bi-LED linza o'rnatish, fara polirovkasi, fara ichini tozalash, shishasini
almashtirish, rul va o'rindiq chexollari. Do'konda LED lampalar, DRL
lentalar va fara uchun materiallar sotiladi.

{_address(user_id, name)}

ENG MUHIMI: MIJOZ HOZIR MINI ILOVANING ICHIDA TURADI.
Shuning uchun «do'konni ochish», «ilovaga o'tish» yoki havola YOZMA —
u allaqachon shu yerda. O'rniga ILOVA ICHIDA yo'naltir.

ILOVA BO'LIMLARI (pastdagi menyu):
- «🏠 Asosiy» — mahsulotlar, qidiruv va filtrlar
- «🛠 Xizmatlar» — har xizmatning narxi, kafolati va «Navbat olish»
- «🎓 Shogird» — sen shu yerdasan
- «🧺 Savatcha» — tanlangan tovarlar va «Rasmiylashtirish»
- «❤️ Saqlangan» — belgilab qo'yilgan tovarlar
- «👤 Kabinet» — buyurtmalarim, navbatlarim, manzillarim

Yo'naltirish shunday bo'ladi: «🛠 Xizmatlar bo'limidan «Fara
polirovkasi» ni tanlab, «Navbat olish» ni bosing» yoki «Tovarni savatga
qo'shib, 🧺 Savatcha → Rasmiylashtirish ni bosing».

SEN O'ZING HECH NARSA QILMAYSAN. Buyurtma bermaysan, navbat olmaysan,
narx o'zgartirmaysan va tovarni savatga qo'shmaysan — bularni mijozning
O'ZI bosadi. Sening ishing: tushuntirish, maslahat berish va qaysi
tugmani bosishni ko'rsatish.

TILI. O'zbek tilida, LOTIN yozuvida javob ber. Mijoz rus yoki ingliz
tilida yozsa — o'sha tilda javob ber. Sodda va qisqa: 4-5 qatordan
oshmasin. Ro'yxat kerak bo'lsa qisqa punktlar.

MUAMMONI ANIQLASH. «Faram xira», «ichiga suv kirdi», «bir tomoni
ishlamaydi» kabi gaplarda avval 1-2 ta aniqlashtiruvchi savol ber
(mashina modeli, qachondan beri, ikki tomonmi ham), keyin mos xizmatni
va uning narxini ayt.

QAT'IY QOIDALAR:
- Narx, kafolat va mavjudlikni FAQAT pastdagi ro'yxatdan ol. Ro'yxatda
  yo'q narsaning narxini AYTMA — «bu haqda ustadan aniqlab beraman»
  deb javob ber.
- «Tez kunda» deb belgilangan xizmatga narx aytma va navbat taklif qilma.
- Hech qachon chegirma, bepul xizmat yoki aniq muddat VA'DA QILMA.
- Tibbiy, huquqiy yoki moliyaviy maslahat berma.
- Aniq bilmasang: «aniq aytolmayman, ustadan so'rab beraman» de va
  aloqa ma'lumotini ber: {contact}.
- HTML yoki markdown teg ishlatma (**, ##, <b>) — oddiy matn yoz.

JONLI MA'LUMOT (narx va mavjudlik shu yerdan):
{catalog}
"""


# ------------------------------------------------------- javobga kartochka

# Nomlarda uchraydigan, LEKIN hech narsani ajratmaydigan so'zlar.
# Bularsiz «fara» so'zi butun katalogni tortib kelardi.
_STOP_WORDS = frozenset(
    {
        "fara",
        "faralar",
        "uchun",
        "yangi",
        "original",
        "komplekt",
        "dona",
        "juft",
        "zimmer",
        "avto",
        "mashina",
        "narxi",
        "narx",
        "xizmat",
        "xizmati",
        "ornatish",
        "o'rnatish",
        "almashtirish",
        "tovar",
        "mahsulot",
        # O'lchov va sanoq: nomda uchraydi, lekin hech narsani ajratmaydi
        "yil",
        "oy",
        "kun",
        "soat",
        "bir",
        "ham",
        "eng",
        "har",
    }
)

# Muammo tilidan xizmat temasiga ko'prik.
#
# NEGA KERAK: mijoz «faram sarg'aygan» deb yozadi, xizmat esa «Fara
# polirovkasi» deb nomlangan — umumiy so'z YO'Q, ya'ni nom bo'yicha
# solishtirish hech narsa topmaydi. Tema kalitlari `database/db.py:
# _THEME_GUESS` dagi bilan bir xil, shuning uchun admin xizmat nomini
# o'zgartirsa ham bog'liqlik saqlanadi.
_THEME_HINTS: dict[str, tuple[str, ...]] = {
    "polish": ("xira", "sarg", "sarig", "polirov", "yaltir", "matlash", "xiralash", "tusi ketgan"),
    "clean": (
        "bug'", "bug ", "namlik", "suv kir", "ho'l", "terlagan",
        "ichi kir", "chang", "tozala", "germet",
    ),
    "glass": ("shisha", "yoril", "darz", "singan", "sinib", "chok"),
    "biled": (
        "linza", "bi-led", "biled", "bi led", "yorug", "nur",
        "xenon", "ksenon", "ko'rmaydi", "xira yoq",
    ),
    "wheel": ("rul", "shturval"),
    "seat": ("o'rindiq", "orindiq", "sidenya", "chexol", "chehol"),
    "tint": ("tanirov", "tonirov", "plyonka oyna", "oyna qorayt"),
    "armor": ("broni", "bronli", "plyonka", "kuzov himoya"),
    "laminate": ("laminat", "salon panel"),
}


def _normalize(text: str) -> str:
    """Solishtirish uchun matnni bir ko'rinishga keltiradi.

    Apostrof O'ZBEK matnida uch xil yozilishi mumkin (`'`, `’`, `ʻ`) —
    bittasiga keltirilmasa «o'rindiq» va «o’rindiq» boshqa so'z bo'lib
    qolardi va hech qachon topilmasdi.
    """
    low = (text or "").lower()
    low = low.replace("’", "'").replace("ʻ", "'").replace("`", "'")
    return re.sub(r"\s+", " ", low)


def _tokens(name: str) -> list[str]:
    """Nomdan «ajratuvchi» so'zlarni oladi.

    Juda qisqa so'zlar (3 belgidan kam) tashlanadi, LEKIN raqam
    aralashgan kodlar (h4, h11, 3157) qoldiriladi — mijoz aynan
    shularni yozadi.
    """
    words = re.findall(r"[a-z0-9']+", _normalize(name))
    out = []
    for word in words:
        if word in _STOP_WORDS:
            continue
        has_digit = any(ch.isdigit() for ch in word)
        if len(word) >= 3 or has_digit:
            out.append(word)
    return out


def _hits(tokens: list[str], low: str) -> int:
    """Nechta so'z matnda uchradi.

    IKKI XIL SOLISHTIRISH, VA BU ATAYLAB:

      * uzun so'z (4+) — QISM sifatida izlanadi. O'zbek tili
        qo'shimchali: mijoz «lentalar kerak» deb yozadi, tovar nomida
        esa «lenta» turadi. Aniq so'z bo'yicha solishtirsak topilmasdi.

      * qisqa so'z (3 harf: «drl», «led») — faqat TO'LIQ so'z sifatida.
        Qism sifatida izlansa tasodifiy o'rtadan topilib, mutlaqo
        boshqa tovar chiqib qolardi.
    """
    count = 0
    for token in tokens:
        if len(token) >= 4:
            if token in low:
                count += 1
        elif re.search(r"(?<![a-z0-9])" + re.escape(token) + r"(?![a-z0-9])", low):
            count += 1
    return count


def _hit_theme(text: str) -> set[str]:
    """Matndan qaysi xizmat temalari eslanganini topadi."""
    low = _normalize(text)
    return {theme for theme, hints in _THEME_HINTS.items() if any(h in low for h in hints)}


async def _match_services(text: str) -> list[dict]:
    """Matnga mos xizmatlarni topadi (nom bo'yicha yoki muammo tilidan)."""
    try:
        services = await q.get_services()
    except Exception as error:  # noqa: BLE001 — kartochka bo'lmasa ham javob ketadi
        logger.warning("Shogird: xizmatlar o'qilmadi: %s", error)
        return []

    low = _normalize(text)
    themes = _hit_theme(text)
    found: list[tuple[int, dict]] = []

    for svc in services:
        keys = svc.keys()
        name = svc["name"] or ""
        theme = (svc["theme"] if "theme" in keys else None) or ""
        soon = bool(svc["coming_soon"]) if "coming_soon" in keys else False

        score = 0
        # 1) nomning ajratuvchi so'zlari matnda uchradi
        hits = _hits(_tokens(name), low)
        if hits:
            score += 10 * hits
        # 2) muammo tilidan tema topildi
        if theme and theme in themes:
            score += 6
        if not score:
            continue
        # «Tez kunda» xizmat pastda turadi: unga navbat olinmaydi
        if soon:
            score -= 4

        found.append(
            (
                score,
                {
                    "id": int(svc["id"]),
                    "name": name,
                    "price_label": None if soon else fmt_price(svc["price"]),
                    "warranty": (svc["warranty"] if "warranty" in keys else None) or "",
                    "theme": theme or None,
                    "coming_soon": soon,
                },
            )
        )

    found.sort(key=lambda item: -item[0])
    return [item[1] for item in found[:MAX_SERVICE_CARDS]]


async def _match_products(text: str) -> list[dict]:
    """Matnga mos tovarlarni topadi (nom yoki kod bo'yicha)."""
    try:
        catalog = await q.get_catalog()
    except Exception as error:  # noqa: BLE001
        logger.warning("Shogird: katalog o'qilmadi: %s", error)
        return []

    low = _normalize(text)
    found: list[tuple[int, float, int, dict]] = []

    for group in catalog:
        group_name = group.get("name") or ""
        group_hit = _hits(_tokens(group_name), low) > 0
        for product in group.get("products") or []:
            name = product.get("name") or ""
            code = str(product.get("code") or "").strip()
            stock = int(product.get("stock") or 0)
            price = int(product.get("price") or 0)

            tokens = _tokens(name)
            hits = _hits(tokens, low)
            score = 10 * hits
            if code and len(code) >= 3 and _normalize(code) in low:
                score += 20
            # Kategoriya nomi eslangan bo'lsa (masalan «LED lampalar»)
            # tovar KO'RSATILADI, lekin nom mosligidan pastda turadi.
            if group_hit:
                score += 3
            if score < 6:
                continue
            if stock <= 0:
                score -= 5  # tugagan tovar oxirida

            found.append(
                (
                    score,
                    # Nomning qanchalik KO'P qismi mos kelgani. Ball teng
                    # bo'lganda aniqrog'i yuqorida turadi: «DRL lenta»
                    # so'roviga «DRL lenta 60 sm» chiqadi, «Fara germetigi
                    # (butil lenta)» esa pastda qoladi — ikkisida ham
                    # «lenta» bor, lekin birinchisida moslik to'liqroq.
                    (hits / len(tokens)) if tokens else 0.0,
                    price,
                    {
                        "id": int(product.get("id")),
                        "name": name,
                        "price_label": fmt_price(price),
                        "price": price,
                        "stock": stock,
                        "category": group_name,
                    },
                )
            )

    # Ball → moslik to'liqligi → ARZONIDAN boshlab
    found.sort(key=lambda item: (-item[0], -item[1], item[2]))
    return [item[3] for item in found[:MAX_PRODUCT_CARDS]]


# Javob ostidagi «keyingi savol» chiplari. Ular MODELDAN emas — shu
# yerdan, ya'ni har doim mavzuga tegishli va hech qachon o'ylab
# topilgan savol chiqmaydi.
_SUGGEST_SERVICE = "Navbat qanday olinadi?"
_SUGGEST_DELIVERY = "Yetkazib berish qanday?"
_SUGGEST_WARRANTY = "Kafolat qancha?"
_SUGGEST_WHERE = "Ustaxona qayerda?"
_SUGGEST_PAY = "To'lov usullari qanday?"


def _suggests(products: list[dict], services: list[dict], question: str) -> list[str]:
    """Javobdan keyin taklif qilinadigan 2-3 savol."""
    low = _normalize(question)
    out: list[str] = []

    if services and not all(s["coming_soon"] for s in services):
        out.append(_SUGGEST_SERVICE)
    if products:
        out.append(_SUGGEST_DELIVERY)
    if "kafolat" not in low:
        out.append(_SUGGEST_WARRANTY)
    if not out or len(out) < 2:
        out.append(_SUGGEST_PAY)
    if len(out) < 2:
        out.append(_SUGGEST_WHERE)

    # Takrorlanmasin va uchtadan oshmasin
    seen: list[str] = []
    for item in out:
        if item not in seen:
            seen.append(item)
    return seen[:3]


# ------------------------------------------------------------------- javob


@dataclass(frozen=True)
class ShogirdReply:
    """Shogirdning javobi.

    `ok=False` bo'lsa `text` — mijozga ko'rsatiladigan sabab, `reason`
    esa texnik tur (`ai.AiReply.reason` bilan bir xil qiymatlar).
    Ilova `reason` ga qarab o'zining mahalliy bilimiga o'tadi — ya'ni
    AI o'chirilgan bo'lsa ham Shogird jim qolmaydi.
    """

    ok: bool
    text: str
    reason: str = ""
    products: tuple[dict, ...] = ()
    services: tuple[dict, ...] = ()
    suggests: tuple[str, ...] = ()

    def as_json(self) -> dict:
        return {
            "ok": self.ok,
            "text": self.text,
            "reason": self.reason,
            "products": list(self.products),
            "services": list(self.services),
            "suggests": list(self.suggests),
        }


async def answer(user_id: int, name: str = "", question: str = "") -> ShogirdReply:
    """Savolga javob beradi va javobga mos kartochkalarni qo'shadi."""
    text = (question or "").strip()
    if not text:
        return ShogirdReply(False, "Savolingizni yozing.", "empty_question")
    if len(text) > MAX_QUESTION_LEN:
        text = text[:MAX_QUESTION_LEN].rstrip()

    if not ai.is_enabled():
        # Kalit sozlanmagan. Ilova buni ko'rib mahalliy bilimga o'tadi,
        # shuning uchun bu HOLAT XATO EMAS — shunchaki boshqa manba.
        return ShogirdReply(
            False,
            "Shogird hozir asosiy ma'lumotlarni beradi.",
            "no_key",
        )

    talk = _talk(user_id)
    history = ai.trim_history(talk.messages, HISTORY_TURNS)
    prompt = await system_prompt(user_id, name)
    messages = [
        {"role": "system", "content": prompt},
        *history,
        {"role": "user", "content": text},
    ]

    _busy.add(user_id)
    _last_call[user_id] = time.time()
    try:
        reply = await ai.ask(messages, max_tokens=MAX_TOKENS, temperature=0.4)
    finally:
        _busy.discard(user_id)
        _last_call[user_id] = time.time()

    if not reply.ok:
        # Xatoda tarixga hech narsa yozilmaydi — keyingi urinish toza boshlanadi
        return ShogirdReply(False, reply.text, reply.reason)

    talk.messages.append({"role": "user", "content": text})
    talk.messages.append({"role": "assistant", "content": reply.text})
    talk.messages = ai.trim_history(talk.messages, HISTORY_TURNS)

    # Kartochkalar HAM savoldan, HAM javobdan qidiriladi: model odatda
    # xizmat nomini javobda aytadi, tovar kodini esa mijoz savolda yozadi.
    haystack = f"{text}\n{reply.text}"
    services = await _match_services(haystack)
    products = await _match_products(haystack)

    return ShogirdReply(
        True,
        reply.text,
        "",
        tuple(products),
        tuple(services),
        tuple(_suggests(products, services, text)),
    )
