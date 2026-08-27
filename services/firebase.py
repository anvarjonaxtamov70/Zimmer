"""Firebase Realtime Database bilan ishlash (Avto_A1 bilan bir xil usul).

- Autentifikatsiya: service-account (`SERVICE_ACCOUNT_JSON` env yoki
  `serviceAccount.json` fayl) → OAuth access token → REST `?access_token=`.
- Token ~1 soat amal qiladi, fonda har 30 daqiqada yangilanadi. Token olish
  sinxron bo'lgani uchun `asyncio.to_thread` ichida bajariladi — bot muzlamaydi.
- Firebase sozlanmagan bo'lsa, barcha funksiyalar jimgina `None` qaytaradi:
  bot va ilova baribir ishlaydi (SQLite asosiy baza bo'lib qoladi).

Ma'lumot joylashuvi (ROOT = FIREBASE_ROOT, standart "zimmer"):
    {ROOT}/users/{user_id}/profile   — mijozlar (bir umrlik saqlanadi)
    {ROOT}/products                  — tovarlar (rasm URL'lari bilan)
    {ROOT}/biled_orders/{id}         — Bi-LED buyurtmalari
    {ROOT}/orders/{id}               — do'kon buyurtmalari
    {ROOT}/bookings/{id}             — o'rnatish navbatlari
"""

import asyncio
import base64
import json
import logging
import os
import urllib.parse

import aiohttp

from config import config

logger = logging.getLogger(__name__)

SCOPES = [
    "https://www.googleapis.com/auth/firebase.database",
    "https://www.googleapis.com/auth/userinfo.email",
    # DIQQAT: Firebase Storage (mahsulot rasmlari) GCS ustida ishlaydi va
    # ALOHIDA ruxsat talab qiladi. Bu qator bo'lmasa `services/firebase_storage.py`
    # olgan token Storage uchun YARAMAYDI va har bir yuklash 401/403 bilan
    # qaytardi — "rasm yuklanmadi" muammosining asosiy sababi shu edi.
    "https://www.googleapis.com/auth/devstorage.read_write",
]

_creds = None
_warned = False
_session: aiohttp.ClientSession | None = None

# Oxirgi muvaffaqiyatsizlik sababi (adminga ko'rsatiladi). Loglarga qarash
# shart bo'lmasin — nima xato ekani bevosita aytiladi.
_last_error: str | None = None


def last_error() -> str | None:
    return _last_error


def diagnose() -> str:
    """Firebase holati haqida odam tushunadigan qisqa izoh."""
    if not config.firebase_db_url:
        return "FIREBASE_DB_URL berilmagan."
    if is_enabled():
        return "Firebase ulangan — ma'lumotlar doimiy saqlanadi. ✅"
    if _last_error:
        return _last_error
    return "Firebase tokeni hali olinmadi (ulanish kutilmoqda)."


# --------------------------------------------------------------------- token


def _service_account_info() -> dict | None:
    """Service-account ma'lumotini env yoki fayldan o'qiydi."""
    global _last_error
    raw = os.getenv("SERVICE_ACCOUNT_JSON", "").strip()
    if raw:
        if not raw.lstrip().startswith("{"):
            try:
                raw = base64.b64decode(raw).decode("utf-8")
            except Exception as error:
                _last_error = (
                    "SERVICE_ACCOUNT_JSON base64 sifatida ochilmadi. Butun "
                    "serviceAccount.json faylini base64 ga o'giring yoki JSON "
                    "matnini to'liq qo'ying."
                )
                logger.error("SERVICE_ACCOUNT_JSON base64 dekod xatosi: %s", error)
                return None
        try:
            info = json.loads(raw)
        except json.JSONDecodeError as error:
            _last_error = (
                "SERVICE_ACCOUNT_JSON yaroqsiz JSON. Odatda sabab: matn to'liq "
                "nusxalanmagan yoki private_key dagi yangi qatorlar buzilgan. "
                "Eng ishonchli yo'l — faylni base64 ga o'girib qo'yish."
            )
            logger.error("SERVICE_ACCOUNT_JSON yaroqsiz JSON: %s", error)
            return None
        if not isinstance(info, dict) or "private_key" not in info or "client_email" not in info:
            _last_error = (
                "SERVICE_ACCOUNT_JSON to'liq emas (private_key / client_email yo'q). "
                "Firebase Console → Project settings → Service accounts → "
                "«Generate new private key» dan olingan faylni to'liq qo'ying."
            )
            logger.error("SERVICE_ACCOUNT_JSON to'liq emas")
            return None
        return info

    path = config.service_account_file
    if path and os.path.exists(path):
        try:
            with open(path, encoding="utf-8") as file:
                return json.load(file)
        except Exception as error:
            _last_error = f"serviceAccount.json fayli o'qilmadi: {error}"
            logger.error("serviceAccount.json o'qilmadi: %s", error)
            return None

    _last_error = (
        "SERVICE_ACCOUNT_JSON berilmagan. Render panelida shu o'zgaruvchini "
        "qo'shing (serviceAccount.json ning base64 ko'rinishi)."
    )
    return None


def _refresh_blocking() -> str | None:
    """BLOKLAYDI — faqat asyncio.to_thread ichida chaqirilsin."""
    global _creds, _warned, _last_error

    info = _service_account_info()
    if not info:
        # _last_error _service_account_info ichida aniq sabab bilan qo'yiladi
        if not _warned:
            logger.info("Firebase sozlanmagan — ma'lumotlar faqat mahalliy bazada saqlanadi.")
            _warned = True
        return None

    try:
        # DIQQAT: `google.auth.transport.requests` ichida `requests` kutubxonasi
        # kerak bo'ladi. `google-auth` uni O'ZI O'RNATMAYDI — u qo'shimcha
        # ("extra") hisoblanadi. Shuning uchun requirements.txt da
        # `google-auth[requests]` deb yozilgan. Aks holda shu yerda ImportError
        # bo'lib, Firebase jimgina o'chib qolardi.
        import google.auth.transport.requests
        from google.oauth2 import service_account
    except ImportError as error:
        missing = getattr(error, "name", None) or "google-auth"
        _last_error = (
            f"«{missing}» kutubxonasi o'rnatilmagan. requirements.txt da "
            "`google-auth[requests]` borligini tekshirib, Render'da qayta "
            "deploy qiling (Clear build cache bilan)."
        )
        if not _warned:
            logger.warning(
                "Firebase uchun kutubxona yetishmaydi (%s): %s — sinxronizatsiya o'chirilgan.",
                missing,
                error,
            )
            _warned = True
        return None

    try:
        if _creds is None:
            _creds = service_account.Credentials.from_service_account_info(info, scopes=SCOPES)
        if not _creds.valid:
            _creds.refresh(google.auth.transport.requests.Request())
        _last_error = None  # muvaffaqiyat — eski xatoni tozalaymiz
        return _creds.token
    except Exception as error:
        _creds = None  # buzuq creds keshda qolmasin, keyingi urinishда qayta yasaladi
        text = str(error).lower()
        if "invalid_grant" in text or "jwt" in text or "signature" in text:
            _last_error = (
                "Firebase kaliti rad etildi (invalid_grant). Ehtimol kalit eski/o'chirilgan "
                "yoki server vaqti noto'g'ri. Firebase'da yangi private key oling."
            )
        elif "could not" in text or "unpad" in text or "padding" in text or "key" in text:
            _last_error = (
                "private_key o'qilmadi — matn buzilgan bo'lishi mumkin. "
                "serviceAccount.json ni base64 ga o'girib qo'ying."
            )
        else:
            _last_error = f"Firebase token olinmadi: {error}"
        logger.error("Firebase token olinmadi: %s", error)
        return None


async def refresh_token() -> str | None:
    try:
        return await asyncio.to_thread(_refresh_blocking)
    except Exception as error:
        logger.error("Firebase token yangilashda xato: %s", error)
        return None


def token() -> str | None:
    """Keshlangan token (bloklamaydi)."""
    return getattr(_creds, "token", None) if _creds is not None else None


async def token_refresher() -> None:
    """Fon vazifasi: tokenni muddati tugashidan oldin yangilab turadi."""
    while True:
        got = await refresh_token()
        await asyncio.sleep(30 * 60 if got else 5 * 60)


def is_enabled() -> bool:
    return bool(config.firebase_db_url) and token() is not None


# ----------------------------------------------------------------------- REST


async def _get_session() -> aiohttp.ClientSession:
    global _session
    if _session is None or _session.closed:
        _session = aiohttp.ClientSession(
            timeout=aiohttp.ClientTimeout(total=15),
            headers={"User-Agent": "zimmer-bot"},
        )
    return _session


async def close() -> None:
    global _session
    if _session is not None and not _session.closed:
        await _session.close()
    _session = None


def _url(path: str, params: dict | None = None) -> str:
    root = config.firebase_root.strip("/")
    full = f"{root}/{path.strip('/')}" if root else path.strip("/")
    url = f"{config.firebase_db_url.rstrip('/')}/{full}.json"
    query = {}
    access = token()
    if access:
        query["access_token"] = access
    if params:
        query.update(params)
    return url + ("?" + urllib.parse.urlencode(query) if query else "")


def url(path: str, params: dict | None = None) -> str:
    """`_url` ning OMMAVIY nomi — boshqa modullar shu nomni ishlatadi.

    `services/firebase_products.py` ETag (if-match) bilan atomik yozish uchun
    to'liq manzilni o'zi yasashi kerak. Ilgari u `fb.url(...)` deb chaqirardi,
    lekin bu modulda faqat `_url` bor edi — natijada HAR BIR mahsulot qo'shish
    `AttributeError: module 'services.firebase' has no attribute 'url'` bilan
    yiqilib, xato `except Exception` ichida yutilardi va admin "qo'shilmadi"
    degan tushunarsiz javob olardi.
    """
    return _url(path, params)


async def session() -> aiohttp.ClientSession:
    """Umumiy (keshlangan) HTTP sessiya — tashqi modullar uchun."""
    return await _get_session()


async def get(path: str, params: dict | None = None):
    """Tugunni o'qiydi. Xato bo'lsa None."""
    if not config.firebase_db_url:
        return None
    try:
        session = await _get_session()
        async with session.get(_url(path, params)) as response:
            if response.status != 200:
                logger.warning("Firebase GET %s -> %s", path, response.status)
                return None
            return await response.json()
    except Exception as error:
        logger.warning("Firebase GET %s xatosi: %s", path, error)
        return None


async def _write(method: str, path: str, data) -> bool:
    if not config.firebase_db_url:
        return False
    try:
        session = await _get_session()
        async with session.request(method, _url(path), json=data) as response:
            if response.status >= 300:
                body = (await response.text())[:180]
                logger.warning("Firebase %s %s -> %s %s", method, path, response.status, body)
                return False
            return True
    except Exception as error:
        logger.warning("Firebase %s %s xatosi: %s", method, path, error)
        return False


async def patch(path: str, data: dict) -> bool:
    """Mavjud maydonlarni yangilaydi (boshqalariga tegmaydi)."""
    return await _write("PATCH", path, data)


async def delete(path: str) -> bool:
    """Tugunni butunlay olib tashlaydi.

    ==================================================================
    NEGA ALOHIDA FUNKSIYA KERAK (va nega tovar ikki marta ko'rinardi)
    ==================================================================
    RTDB'da tugunni o'chirishning ikki yo'li bor: HTTP DELETE, yoki PUT
    bilan tanaga `null` yuborish.

    Ilgari bu modulda `delete` YO'Q edi va `services/sync.py` takror
    nusxani `put(path, None)` bilan o'chirishga urinardi. Lekin `_write`
    ni ko'ring: u `session.request(method, url, json=data)` deb chaqiradi.
    aiohttp'da `json=None` — bu parametrning STANDART qiymati, ya'ni
    `json=None` berish `json` ni umuman bermaslik bilan bir xil: so'rov
    TANASIZ ketadi.

    Natijada RTDB bo'sh tanani ko'rib `400 Invalid data; couldn't parse
    JSON object, array, or value` qaytarardi, `_write` esa `False` qaytarib
    faqat log'ga ogohlantirish yozardi. Ya'ni o'chirish HAR SAFAR jimgina
    bajarilmasdi va bulutda tovarning eski kaliti qolib ketardi —
    do'konda tovar IKKI MARTA ko'rinardi.

    DELETE esa tanani talab qilmaydi, shuning uchun bu yo'l ishonchli.
    """
    return await _write("DELETE", path, None)


async def put(path: str, data) -> bool:
    """Tugunni butunlay almashtiradi.

    `data is None` bo'lsa — tugunni O'CHIRISH ko'zda tutilgan. Buni PUT
    bilan qilib bo'lmaydi (yuqoridagi `delete` izohiga qarang), shuning
    uchun DELETE ga o'tkazamiz. Shu tarzda eski chaqiruvlar ham,
    kelajakdagi e'tiborsizlik ham xatoga olib kelmaydi.
    """
    if data is None:
        return await delete(path)
    return await _write("PUT", path, data)


def items(node) -> list[tuple[str, dict]]:
    """RTDB tuguni dict yoki list bo'lishi mumkin — ikkisini ham normallashtiradi."""
    if not node:
        return []
    if isinstance(node, dict):
        return [(key, value) for key, value in node.items() if isinstance(value, dict)]
    if isinstance(node, list):
        return [(str(i), value) for i, value in enumerate(node) if isinstance(value, dict)]
    return []
