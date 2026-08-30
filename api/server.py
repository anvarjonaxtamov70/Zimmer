"""Mini App API va health-check serveri (bitta aiohttp ilovasi ichida).

Server FAQAT `PORT` (Render beradi) yoki `API_PORT` (lokal sinov uchun)
env o'zgaruvchisi mavjud bo'lganda ishga tushadi.
"""

import logging
import os

import aiohttp
from aiohttp import web

from api.admin import admin_routes
from api.errors import ApiError
from api.media import handle_media
from api.routes import routes
from config import config
from utils.helpers import TZ, now

logger = logging.getLogger(__name__)

CORS_BASE = {
    "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type, X-Telegram-Init-Data",
    "Access-Control-Max-Age": "86400",
}

_origin_warned: set[str] = set()


def _cors_headers(request: web.Request) -> dict:
    """So'rov manzili ruxsat etilgan bo'lsa CORS sarlavhalarini qaytaradi.

    Ilgari bu yerda `Access-Control-Allow-Origin: *` qattiq yozilgan edi —
    ya'ni istalgan sayt brauzerdan API'ga murojaat qila olardi. O'g'irlangan
    `initData` bilan birlashganda bu butun API'ni boshqarish imkonini berardi.

    Endi faqat Mini App manzili ruxsat etiladi (`config.allowed_origins`).
    Manzil to'g'ri kelmasa CORS sarlavhasi YUBORILMAYDI va brauzer so'rovni
    o'zi to'xtatadi. Diagnostika oson bo'lishi uchun rad etilgan manzil
    log'ga BIR MARTA yoziladi.
    """
    headers = dict(CORS_BASE)
    allowed = config.allowed_origins
    origin = request.headers.get("Origin")

    # Ro'yxat bo'sh yoki `*` — eski xatti-harakat (hammaga ruxsat)
    if not allowed or "*" in allowed:
        headers["Access-Control-Allow-Origin"] = "*"
        return headers

    if origin is None:
        # Brauzerdan kelmagan so'rov (bot, monitoring, curl) — CORS kerak emas
        return headers

    if origin in allowed:
        headers["Access-Control-Allow-Origin"] = origin
        headers["Vary"] = "Origin"
        return headers

    if origin not in _origin_warned:
        _origin_warned.add(origin)
        logger.warning(
            "CORS: «%s» manzili rad etildi. Ruxsat etilganlar: %s. "
            "Kerak bo'lsa ALLOWED_ORIGINS env'iga qo'shing.",
            origin,
            ", ".join(allowed),
        )
    headers["Vary"] = "Origin"
    return headers


@web.middleware
async def error_and_cors_middleware(request: web.Request, handler):
    """CORS sarlavhalari + barcha xatolarni JSON ko'rinishida qaytarish."""
    cors = _cors_headers(request)

    if request.method == "OPTIONS":
        return web.Response(status=204, headers=cors)

    try:
        response = await handler(request)
    except ApiError as error:
        response = error.to_response()
    except web.HTTPException as error:
        # DIQQAT: yo'naltirishlarni (3xx) O'ZGARTIRMASDAN qaytaramiz.
        #
        # Ilgari bu yerda HAR QANDAY `HTTPException` uchun YANGI `json_response`
        # yasalardi va `Location` sarlavhasi TASHLAB KETILARDI. Natijada
        # `media.py` va `/api/photo/...` dagi `web.HTTPFound` manzilsiz 302
        # bo'lib qaytardi — ya'ni tashqi manzilda turgan BARCHA rasmlar
        # brauzerda ochilmasdi.
        if 300 <= error.status < 400 or error.status == 304:
            error.headers.update(cors)
            return error
        response = web.json_response(
            {"ok": False, "error": {"code": "http_error", "message": error.reason}},
            status=error.status,
        )
    except Exception:
        logger.exception("API'da kutilmagan xato")
        response = web.json_response(
            {"ok": False, "error": {"code": "server_error", "message": "Serverda xatolik"}},
            status=500,
        )

    response.headers.update(cors)
    return response


def create_app(bot, bot_username: str | None = None) -> web.Application:
    started_at = now()

    async def _startup(app: web.Application) -> None:
        # media proksisi uchun umumiy HTTP sessiya
        app["http"] = aiohttp.ClientSession(
            timeout=aiohttp.ClientTimeout(total=None, sock_connect=10, sock_read=60)
        )

    async def _cleanup(app: web.Application) -> None:
        session = app.get("http")
        if session is not None and not session.closed:
            await session.close()

    async def health(_request: web.Request) -> web.Response:
        return web.json_response(
            {
                "status": "ok",
                "bot": bot_username,
                "uptime_seconds": int((now() - started_at).total_seconds()),
                "time": now().strftime("%Y-%m-%d %H:%M:%S"),
                "timezone": str(TZ),
            }
        )

    app = web.Application(middlewares=[error_and_cors_middleware])
    app["bot"] = bot
    app.on_startup.append(_startup)
    app.on_cleanup.append(_cleanup)
    app.router.add_get("/", health)
    app.router.add_get("/health", health)
    app.add_routes(routes)
    # Mini App ichidagi admin panel: /api/admin/*
    app.add_routes(admin_routes)
    # rasm/video: /api/media/{jadval}/{id}/{photo|video}
    app.router.add_get("/api/media/{table}/{row_id}/{kind}", handle_media)
    return app


async def start_api_server(bot, bot_username: str | None = None):
    """Serverni ishga tushiradi va runner qaytaradi (yoki None)."""
    port = os.getenv("PORT") or os.getenv("API_PORT")
    if not port:
        logger.info("PORT/API_PORT topilmadi — API server yoqilmadi (lokal rejim).")
        return None

    try:
        app = create_app(bot, bot_username)
        runner = web.AppRunner(app)
        await runner.setup()
        site = web.TCPSite(runner, "0.0.0.0", int(port))
        await site.start()
    except Exception as error:
        logger.error("API server ishga tushmadi: %s", error)
        return None

    logger.info("API server ishga tushdi: 0.0.0.0:%s (/health, /api/*)", port)
    return runner
