"""Render.com uchun kichik health-check serveri.

Render'dagi "web service" ochiq port kutadi va `/health` manziliga so'rov
yuborib xizmat tirikligini tekshiradi. Server FAQAT `PORT` env o'zgaruvchisi
mavjud bo'lganda ishga tushadi — lokal kompyuterda bot oddiy polling
rejimida, qo'shimcha server ochmasdan ishlaydi.
"""

import logging
import os
from datetime import datetime

from utils.helpers import TZ, now

logger = logging.getLogger(__name__)

_started_at: datetime | None = None


async def start_health_server(bot_username: str | None = None):
    """Health serverni ishga tushiradi. Runner qaytaradi (to'xtatish uchun)."""
    global _started_at

    port = os.getenv("PORT")
    if not port:
        logger.info("PORT topilmadi — health server kerak emas (lokal rejim).")
        return None

    try:
        from aiohttp import web
    except ImportError as error:
        logger.error("aiohttp yuklanmadi, health server ishga tushmadi: %s", error)
        return None

    _started_at = now()

    async def health(_request):
        uptime = int((now() - _started_at).total_seconds()) if _started_at else 0
        return web.json_response(
            {
                "status": "ok",
                "bot": bot_username,
                "uptime_seconds": uptime,
                "time": now().strftime("%Y-%m-%d %H:%M:%S"),
                "timezone": str(TZ),
            }
        )

    app = web.Application()
    app.router.add_get("/", health)
    app.router.add_get("/health", health)

    runner = web.AppRunner(app)
    await runner.setup()
    site = web.TCPSite(runner, "0.0.0.0", int(port))
    await site.start()
    logger.info("Health server ishga tushdi: 0.0.0.0:%s (/health)", port)
    return runner
