"""Mini App API va health-check serveri (bitta aiohttp ilovasi ichida).

Server FAQAT `PORT` (Render beradi) yoki `API_PORT` (lokal sinov uchun)
env o'zgaruvchisi mavjud bo'lganda ishga tushadi.
"""

import logging
import os
import time

import aiohttp
from aiohttp import web

from api.admin import MAX_VIDEO_BYTES, admin_routes
from api.errors import ApiError
from api.media import handle_media
from api.routes import routes
from config import config
from database import queries as q
from database.db import get_db
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


# =====================================================================
#  YENGIL RATE-LIMIT (IP bo'yicha, oyna = 60 soniya)
#
#  NEGA KERAK. API Render/Fly proksisi ortida ochiq turadi. Bitta mijoz
#  (yoki bot) sekundiga o'nlab so'rov yuborsa, bepul tarif kvotasi tez
#  tugaydi va HAMMA uchun xizmat sekinlashadi. Bu oddiy chegara aynan bir
#  IP'dan kelayotgan portlashni to'xtatadi.
#
#  QANDAY ISHLAYDI. Har IP uchun (oyna_boshi, sanoq) saqlanadi. Oyna
#  60 soniya: shu vaqt ichida `RATE_LIMIT_PER_MIN` dan oshsa 429 qaytadi.
#  Xotira cheksiz o'smasligi uchun eskirgan yozuvlar vaqti-vaqti bilan
#  tozalanadi. Bu — RAM'dagi oddiy hisob, taqsimlangan (ko'p instansli)
#  emas; bitta jarayonli Render/Fly uchun yetarli.
# =====================================================================

# Sog'liq/tayyorlik/metrika so'rovlari CHEKLANMAYDI — monitoring va
# self-ping ularni tez-tez chaqiradi.
_RATE_LIMIT_EXEMPT = frozenset({"/", "/health", "/ready", "/metrics"})
_RATE_WINDOW = 60.0

# Kuzatiladigan IP'lar soniga QATTIQ chegara — soxta `X-Forwarded-For`
# bilan IP almashtirib xotirani shishirishning oldini oladi. Chegaraga
# yetganda eskirganlar tozalanadi, baribir to'lsa lug'at bo'shatiladi
# (rate-limit "fail-open" bo'ladi — bu himoyaning yon ta'siridan afzal).
_RATE_MAX_IPS = 20000

# IP -> (oyna_boshlangan_vaqt, shu oynadagi so'rovlar soni)
_rate_hits: dict[str, tuple[float, int]] = {}
_rate_last_prune = 0.0


def _client_ip(request: web.Request) -> str:
    """Mijoz IP'si. Proksi ortida `X-Forwarded-For` ning BIRINCHI hop'i."""
    forwarded = request.headers.get("X-Forwarded-For")
    if forwarded:
        first = forwarded.split(",")[0].strip()
        if first:
            return first
    return request.remote or "unknown"


def _prune_rate_hits(now_ts: float) -> None:
    """Eskirgan IP yozuvlarini tozalaydi (xotira cheksiz o'smasin).

    Odatda 60 soniyada bir marta tozalanadi. Ammo lug'at qattiq chegaradan
    oshsa (masalan soxta IP hujumi), darhol tozalanadi; shundan keyin ham
    to'la bo'lsa butunlay bo'shatiladi — xotira har qanday holatda chegarali
    qoladi.
    """
    global _rate_last_prune
    over_cap = len(_rate_hits) > _RATE_MAX_IPS
    if not over_cap and now_ts - _rate_last_prune < _RATE_WINDOW:
        return
    _rate_last_prune = now_ts
    stale = [
        ip for ip, (start, _) in _rate_hits.items() if now_ts - start >= _RATE_WINDOW
    ]
    for ip in stale:
        _rate_hits.pop(ip, None)
    if len(_rate_hits) > _RATE_MAX_IPS:
        # Hali ham to'la — eng radikal chora. Rate-limit vaqtincha "ochiq"
        # bo'ladi, lekin xotira portlamaydi.
        _rate_hits.clear()


@web.middleware
async def rate_limit_middleware(request: web.Request, handler):
    """IP bo'yicha oddiy oyna-asosidagi rate-limit (error/CORS'dan OLDIN)."""
    limit = config.rate_limit_per_min

    # 0 -> o'chiq; sog'liq yo'llari ozod; CORS preflight (OPTIONS) o'tadi
    # (uni error_and_cors_middleware 204 bilan hal qiladi).
    if limit <= 0 or request.method == "OPTIONS" or request.path in _RATE_LIMIT_EXEMPT:
        return await handler(request)

    now_ts = time.monotonic()
    _prune_rate_hits(now_ts)

    ip = _client_ip(request)
    start, count = _rate_hits.get(ip, (now_ts, 0))
    if now_ts - start >= _RATE_WINDOW:
        start, count = now_ts, 0
    count += 1
    _rate_hits[ip] = (start, count)

    if count > limit:
        retry_after = max(1, int(_RATE_WINDOW - (now_ts - start)) + 1)
        response = web.json_response(
            {
                "ok": False,
                "error": {
                    "code": "rate_limited",
                    "message": "Juda ko'p so'rov yuborildi — birozdan keyin urinib ko'ring.",
                },
            },
            status=429,
        )
        response.headers["Retry-After"] = str(retry_after)
        # Brauzer 429'ni ko'ra olishi uchun CORS sarlavhalarini ham qo'shamiz
        # (bu javob error_and_cors_middleware'gacha yetib bormaydi).
        response.headers.update(_cors_headers(request))
        return response

    return await handler(request)


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

    async def _outbox_counts() -> tuple[int, int]:
        """(navbatda, yo'qolgan) — DB'dan; xato bo'lsa (0, 0)."""
        pending = dropped = 0
        try:
            pending = await q.outbox_count()
        except Exception:
            pending = 0
        try:
            raw = await q.outbox_meta_get("dropped")
            dropped = int(raw) if raw else 0
        except Exception:
            dropped = 0
        return pending, dropped

    async def ready(_request: web.Request) -> web.Response:
        """Tayyorlik (readiness): baza javob berayaptimi?

        Liveness (`/health`) — «jarayon tirikmi», readiness — «so'rovga
        xizmat qila oladimi». Ular ALOHIDA: baza yiqilsa jarayon tirik,
        lekin tayyor EMAS (Render/Fly trafikni to'xtatib turishi mumkin).
        """
        db_ok = True
        try:
            db = get_db()
            async with db.execute("SELECT 1") as cur:
                await cur.fetchone()
        except Exception as error:
            db_ok = False
            logger.warning("Readiness: baza tekshiruvi yiqildi: %s", error)

        pending, dropped = await _outbox_counts()
        payload = {
            "ready": db_ok,
            "db": "ok" if db_ok else "error",
            "firebase_enabled": bool(config.has_firebase),
            "outbox_pending": pending,
            "outbox_dropped": dropped,
        }
        return web.json_response(payload, status=200 if db_ok else 503)

    async def metrics(_request: web.Request) -> web.Response:
        """Yengil JSON metrikalar (Prometheus shart emas)."""
        pending, dropped = await _outbox_counts()
        return web.json_response(
            {
                "uptime_seconds": int((now() - started_at).total_seconds()),
                "outbox_pending": pending,
                "outbox_dropped": dropped,
                "firebase_enabled": bool(config.has_firebase),
                "bot": bool(bot_username),
            }
        )

    # Admin brauzer uploadi 45 MiB videoni qabul qiladi. Multipart sarlavha
    # va chegaralari limitni yeb qo'ymasligi uchun 1 MiB texnik zaxira bor;
    # handlerning o'zi faylni baribir MAX_VIDEO_BYTES da qat'iy tekshiradi.
    app = web.Application(
        middlewares=[rate_limit_middleware, error_and_cors_middleware],
        client_max_size=MAX_VIDEO_BYTES + 1024 * 1024,
    )
    app["bot"] = bot
    app.on_startup.append(_startup)
    app.on_cleanup.append(_cleanup)
    app.router.add_get("/", health)
    app.router.add_get("/health", health)
    app.router.add_get("/ready", ready)
    app.router.add_get("/metrics", metrics)
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
