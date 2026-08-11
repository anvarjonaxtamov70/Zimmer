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
]

_creds = None
_warned = False
_session: aiohttp.ClientSession | None = None


# --------------------------------------------------------------------- token


def _service_account_info() -> dict | None:
    """Service-account ma'lumotini env yoki fayldan o'qiydi."""
    raw = os.getenv("SERVICE_ACCOUNT_JSON", "").strip()
    if raw:
        if not raw.lstrip().startswith("{"):
            try:
                raw = base64.b64decode(raw).decode("utf-8")
            except Exception as error:
                logger.error("SERVICE_ACCOUNT_JSON base64 dekod xatosi: %s", error)
                return None
        try:
            return json.loads(raw)
        except json.JSONDecodeError as error:
            logger.error("SERVICE_ACCOUNT_JSON yaroqsiz JSON: %s", error)
            return None

    path = config.service_account_file
    if path and os.path.exists(path):
        try:
            with open(path, encoding="utf-8") as file:
                return json.load(file)
        except Exception as error:
            logger.error("serviceAccount.json o'qilmadi: %s", error)
    return None


def _refresh_blocking() -> str | None:
    """BLOKLAYDI — faqat asyncio.to_thread ichida chaqirilsin."""
    global _creds, _warned

    info = _service_account_info()
    if not info:
        if not _warned:
            logger.info(
                "Firebase sozlanmagan (SERVICE_ACCOUNT_JSON yo'q) — "
                "ma'lumotlar faqat mahalliy bazada saqlanadi."
            )
            _warned = True
        return None

    try:
        import google.auth.transport.requests
        from google.oauth2 import service_account
    except ImportError:
        if not _warned:
            logger.warning("google-auth o'rnatilmagan — Firebase sinxronizatsiyasi o'chirilgan.")
            _warned = True
        return None

    try:
        if _creds is None:
            _creds = service_account.Credentials.from_service_account_info(info, scopes=SCOPES)
        if not _creds.valid:
            _creds.refresh(google.auth.transport.requests.Request())
        return _creds.token
    except Exception as error:
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


async def put(path: str, data) -> bool:
    """Tugunni butunlay almashtiradi."""
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
