"""Rasm va videolarni Mini App'ga uzatish.

Media ikki manbadan bo'lishi mumkin:
  • tashqi URL (Firebase Storage / sayt / CDN) — brauzer to'g'ridan-to'g'ri oladi;
  • Telegram file_id (admin panelda yuklangan) — bu yerda proksi qilinadi.

Telegram fayllari **oqim (stream)** bilan uzatiladi: xotiraga to'liq
yuklanmaydi, `Range` so'rovlari ham qo'llab-quvvatlanadi — shuning uchun
video ilova ichida normal ko'rinadi va telefonni qizdirmaydi.
"""

import asyncio
import logging
import time

import aiohttp
from aiohttp import web

from api.errors import bad_request, not_found
from config import config
from database import queries as q

logger = logging.getLogger(__name__)

# Media qo'yish mumkin bo'lgan jadvallar
MEDIA_TABLES = {
    "biled_types",
    "shrouds",
    "optic_colors",
    "products",
    "banners",
    "stories",
    "cars",
}

CONTENT_TYPES = {
    "photo": "image/jpeg",
    "photo2": "image/jpeg",  # mahsulotning 2-rasmi
    "photo3": "image/jpeg",  # mahsulotning 3-rasmi
    "video": "video/mp4",
}
CACHE = "public, max-age=86400"

# file_id -> (file_path, vaqt). Telegram yo'llari ~1 soat amal qiladi.
#
# DIQQAT: kesh CHEGARALANGAN. Ilgari u cheksiz o'sardi — har bir yangi
# rasm/video uchun yozuv qo'shilar, hech qachon tozalanmasdi. Render'ning
# bepul tarifida xotira 512 MB, ya'ni uzoq ishlagan protsess sekin-asta
# to'lib borardi.
_paths: dict[str, tuple[str, float]] = {}
_PATH_TTL = 30 * 60
_PATHS_LIMIT = 500


def _prune_paths(now: float) -> None:
    """Muddati o'tgan yozuvlarni tozalaydi, hali ham katta bo'lsa eskilarini."""
    expired = [key for key, (_, at) in _paths.items() if now - at >= _PATH_TTL]
    for key in expired:
        _paths.pop(key, None)

    if len(_paths) <= _PATHS_LIMIT:
        return
    # Eng eski yozuvlardan boshlab chegaraga tushiramiz
    for key, _ in sorted(_paths.items(), key=lambda item: item[1][1])[
        : len(_paths) - _PATHS_LIMIT
    ]:
        _paths.pop(key, None)


def media_url(table: str, row, kind: str = "photo") -> tuple[str | None, bool]:
    """(manzil, tashqimi) qaytaradi. Manzil yo'q bo'lsa (None, False)."""
    file_id, url = q.media_of(row, kind)
    if url and str(url).startswith("http"):
        return str(url), True
    if file_id:
        return f"/api/media/{table}/{row['id']}/{kind}", False
    return None, False


def media_fields(table: str, row) -> dict:
    """JSON javobga qo'shiladigan media maydonlari."""
    photo, photo_ext = media_url(table, row, "photo")
    video, video_ext = media_url(table, row, "video")
    return {
        "photo_url": photo,
        "photo_external": photo_ext,
        "video_url": video,
        "video_external": video_ext,
        "has_media": bool(photo or video),
    }


async def _file_path(bot, file_id: str) -> str | None:
    cached = _paths.get(file_id)
    now = time.time()
    if cached and now - cached[1] < _PATH_TTL:
        return cached[0]
    try:
        info = await bot.get_file(file_id)
    except Exception as error:
        logger.warning("get_file xatosi: %s", error)
        return None
    if not info or not info.file_path:
        return None
    _paths[file_id] = (info.file_path, now)
    _prune_paths(now)
    return info.file_path


async def handle_media(request: web.Request) -> web.StreamResponse:
    """GET /api/media/{table}/{row_id}/{kind}"""
    table = request.match_info["table"]
    kind = request.match_info["kind"]

    if table not in MEDIA_TABLES or kind not in CONTENT_TYPES:
        raise bad_request("Noto'g'ri media so'rovi")
    try:
        row_id = int(request.match_info["row_id"])
    except ValueError as error:
        raise bad_request("Noto'g'ri id") from error

    row = await q.admin_get(table, row_id)
    if not row:
        raise not_found("Element topilmadi")

    file_id, url = q.media_of(row, kind)

    # tashqi manzil bo'lsa — shunchaki yo'naltiramiz (serverga yuk tushmaydi)
    if url and str(url).startswith("http"):
        raise web.HTTPFound(location=str(url))
    if not file_id:
        raise not_found("Media yo'q")

    bot = request.app["bot"]
    path = await _file_path(bot, file_id)
    if not path:
        raise not_found("Fayl olinmadi")

    source = f"https://api.telegram.org/file/bot{config.bot_token}/{path}"
    headers = {}
    if request.headers.get("Range"):
        headers["Range"] = request.headers["Range"]

    session: aiohttp.ClientSession = request.app["http"]
    try:
        async with session.get(source, headers=headers) as upstream:
            if upstream.status >= 400:
                logger.warning("Telegram fayl xatosi: %s", upstream.status)
                raise not_found("Fayl mavjud emas")

            out_headers = {
                "Content-Type": CONTENT_TYPES[kind],
                "Cache-Control": CACHE,
                "Accept-Ranges": "bytes",
            }
            for name in ("Content-Length", "Content-Range"):
                if name in upstream.headers:
                    out_headers[name] = upstream.headers[name]

            response = web.StreamResponse(status=upstream.status, headers=out_headers)
            await response.prepare(request)

            # ==========================================================
            #  SARLAVHALAR YUBORILGANDAN KEYINGI XATO — ALOHIDA HOLAT
            #
            #  `prepare()` dan keyin javob sarlavhalari mijozga ALLAQACHON
            #  ketgan. Shu paytdan boshlab `raise not_found(...)` qilish
            #  MUMKIN EMAS: middleware yangi JSON javob yasashga urinadi,
            #  lekin sarlavhalarni qayta yozib bo'lmaydi va natijada
            #  ulanish 500 yoki "connection reset" bilan uziladi.
            #
            #  To'g'ri yo'l: uzatishni shunchaki TO'XTATISH. Brauzer buni
            #  chala yuklangan rasm deb qabul qiladi va `onerror` ishlaydi
            #  (Mini App'da zaxira belgisi ko'rsatiladi).
            # ==========================================================
            try:
                async for chunk in upstream.content.iter_chunked(64 * 1024):
                    await response.write(chunk)
                await response.write_eof()
            except (ConnectionResetError, asyncio.CancelledError):
                # Mijoz o'zi uzdi (sahifadan chiqdi) — bu xato emas
                raise
            except Exception as error:
                logger.warning(
                    "Media uzatish yarmida uzildi (%s/%s/%s): %s", table, row_id, kind, error
                )
            return response
    except web.HTTPException:
        # Yo'naltirish (302) va boshqa HTTP holatlari — o'zgarishsiz o'tadi
        raise
    except asyncio.CancelledError:
        raise
    except Exception as error:
        logger.warning("Media uzatishda xato: %s", error)
        raise not_found("Media uzatilmadi") from error
