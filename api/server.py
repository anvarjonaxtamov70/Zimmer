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
from utils.helpers import TZ, now

logger = logging.getLogger(__name__)

CORS_HEADERS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type, X-Telegram-Init-Data",
    "Access-Control-Max-Age": "86400",
}


@web.middleware
async def error_and_cors_middleware(request: web.Request, handler):
    """CORS sarlavhalari + barcha xatolarni JSON ko'rinishida qaytarish."""
    if request.method == "OPTIONS":
        return web.Response(status=204, headers=CORS_HEADERS)

    try:
        response = await handler(request)
    except ApiError as error:
        response = error.to_response()
    except web.HTTPException as error:
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

    response.headers.update(CORS_HEADERS)
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
