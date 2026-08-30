"""Zimmer bot — kirish nuqtasi."""

import asyncio
import logging
import os
import sys

import aiohttp
from aiogram import Bot, Dispatcher
from aiogram.client.default import DefaultBotProperties
from aiogram.enums import ParseMode
from aiogram.fsm.storage.memory import MemoryStorage

from api.server import start_api_server
from config import all_admins, config
from database.db import close_db, init_db
from handlers import get_routers
from middlewares import IdentityMiddleware
from services import admins as admin_registry
from services import firebase, sync
from utils.commands import set_default_commands, set_menu_button
from utils.ui import notify_admins

logger = logging.getLogger("zimmer")


async def _startup_report(bot: Bot) -> None:
    """Doimiy saqlash ishlamasa — adminlarni jimgina emas, ochiq ogohlantiradi.

    Ilgari Firebase ulanmagani faqat log'da qolib ketardi va mijozlar
    nega "esdan chiqib" qolayotgani ko'rinmasdi.
    """
    if os.getenv("STARTUP_REPORT", "1").strip().lower() in {"0", "false", "no", "off"}:
        return
    if config.has_firebase and firebase.is_enabled():
        return

    await notify_admins(
        bot,
        "⚠️ <b>Diqqat: doimiy saqlash o'chiq</b>\n\n"
        f"Sabab: {firebase.diagnose()}\n\n"
        "Bot ishlaydi, lekin mijozlar ro'yxati faqat vaqtinchalik bazada. "
        "Render bepul tarifida qayta deployda u tozalanadi — mijozlar "
        "qaytadan ro'yxatdan o'tishga majbur bo'ladi.\n\n"
        "Tuzatgandan keyin /firebase buyrug'i bilan tekshiring.\n\n"
        f"Adminlar hozir: {len(all_admins())} ta (ular yo'qolmaydi — kodda saqlangan).",
    )


async def keep_awake() -> None:
    """O'ZINI-O'ZI UYG'OTISH — bulutda uxlab qolmaslik uchun.

    Nima uchun kerak: Render'ning bepul "web service" 15 daqiqa KIRUVCHI
    trafik bo'lmasa uxlab qoladi. Bot long-polling ishlatadi, ya'ni o'zicha
    kiruvchi so'rov olmaydi — natijada uxlaydi va keyingi xabarga kech
    javob beradi (yoki umuman javob bermaydi).

    Yechim: bot O'ZINING ochiq manziliga har ~10 daqiqada GET yuboradi.
    Bu kiruvchi trafik hisoblanadi, shuning uchun xizmat uxlamaydi va
    TASHQI ping xizmati (UptimeRobot, GitHub Actions) SHART EMAS.

    Render `RENDER_EXTERNAL_URL` ni o'zi beradi. Boshqa platformada
    `KEEP_ALIVE_URL` ni qo'lda yozish mumkin. Manzil bo'lmasa (lokal
    kompyuter) bu vazifa hech narsa qilmaydi.
    """
    base = config.keep_alive_url
    if not base:
        logger.info("Self-ping o'chiq (manzil yo'q) — lokal rejim.")
        return

    ping_url = base.rstrip("/") + "/health"
    interval = max(60, config.keep_alive_interval)
    await asyncio.sleep(45)  # server to'liq ko'tarilishini kutamiz

    logger.info("Self-ping yoqildi: %s (har %s soniyada)", ping_url, interval)
    timeout = aiohttp.ClientTimeout(total=30)
    async with aiohttp.ClientSession(timeout=timeout) as session:
        while True:
            try:
                async with session.get(ping_url) as response:
                    if response.status >= 400:
                        logger.warning("Self-ping: %s", response.status)
            except asyncio.CancelledError:
                raise
            except Exception as error:
                logger.warning("Self-ping xatosi: %s", error)
            await asyncio.sleep(interval)


async def main() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s | %(levelname)-8s | %(name)s | %(message)s",
    )

    if not config.bot_token:
        logger.error(
            "BOT_TOKEN topilmadi. .env.example faylini .env ga nusxalab, "
            "BotFather'dan olgan tokenni yozing."
        )
        sys.exit(1)

    await init_db()

    # Adminlar registri: kod (CORE_ADMINS) + env + baza. Bazada saqlangani
    # uchun bot ichidan qo'shilgan adminlar qayta ishga tushgandan keyin
    # ham o'z huquqini saqlaydi.
    await admin_registry.load()

    bot = Bot(
        token=config.bot_token,
        default=DefaultBotProperties(parse_mode=ParseMode.HTML),
    )
    dispatcher = Dispatcher(storage=MemoryStorage())
    # Har bir yangilanishda foydalanuvchini tanib olamiz va eslab qolamiz
    dispatcher.update.outer_middleware(IdentityMiddleware())
    for router in get_routers():
        dispatcher.include_router(router)

    # Firebase (ixtiyoriy, lekin mijozlar "bir umr" saqlanishi uchun kerak).
    # MUHIM: token birinchi urinishda olinmasa ham fon vazifalari ishga
    # tushadi — ulanish tiklanganda mijozlar/adminlar o'zi sinxronlanadi.
    background: list[asyncio.Task] = []
    if config.has_firebase:
        await firebase.refresh_token()
        if firebase.is_enabled():
            logger.info("Firebase ulandi: %s/%s", config.firebase_db_url, config.firebase_root)
        else:
            logger.warning(
                "FIREBASE_DB_URL berilgan, lekin token hozir olinmadi — "
                "fonda qayta urinib ko'riladi (SERVICE_ACCOUNT_JSON'ni tekshiring)."
            )
        background.append(asyncio.create_task(firebase.token_refresher()))
        background.append(asyncio.create_task(sync.sync_when_ready(bot)))
        background.append(asyncio.create_task(sync.retry_worker()))
        # Cloudflare Worker qabul qilgan buyurtmalarni bazaga ko'chirib turadi
        # (Render o'chgan paytda Mini App shu yo'l bilan buyurtma oladi).
        background.append(asyncio.create_task(sync.pending_orders_worker(bot)))
    else:
        logger.warning(
            "FIREBASE_DB_URL berilmagan — ma'lumotlar faqat mahalliy bazada. "
            "Render'ning bepul tarifida disk saqlanmaydi, shuning uchun qayta "
            "deployda mijozlar ro'yxati yo'qoladi."
        )

    api_runner = None
    try:
        me = await bot.get_me()
        # Render'da PORT beriladi — shunda /health va Mini App API'si yoqiladi
        api_runner = await start_api_server(bot, me.username)
        # Server ko'tarilgandan keyin o'zini uyg'oq tutadi (bulutda uxlamaslik)
        if api_runner is not None:
            background.append(asyncio.create_task(keep_awake()))
        await set_default_commands(bot)
        await set_menu_button(bot)
        # drop_pending_updates=False — bot uxlab qolgan paytda yozilgan
        # xabarlar YO'QOLMAYDI, uyg'ongandan keyin javob beriladi.
        await bot.delete_webhook(drop_pending_updates=False)
        logger.info("Bot ishga tushdi: @%s (%s)", me.username, me.id)
        if config.has_mini_app:
            logger.info("Mini App manzili: %s", config.mini_app_url)
        await _startup_report(bot)
        await dispatcher.start_polling(bot)
    finally:
        # ==============================================================
        #  TO'XTATISH TARTIBI MUHIM
        #
        #  Ilgari `firebase.close()` API serverdan OLDIN chaqirilardi.
        #  Natijada o'sha paytda bajarilib turgan API so'rovlari YOPILGAN
        #  sessiyaga murojaat qilib 500 qaytarardi (mijoz "xatolik"
        #  ko'rardi, aslida server shunchaki to'xtayotgan edi).
        #
        #  To'g'ri tartib: fon vazifalari → API (yangi so'rov qabul
        #  qilmaydi va joriylarini tugatadi) → Firebase sessiyasi → baza.
        # ==============================================================
        for task in background:
            task.cancel()
        if background:
            # Bekor qilish haqiqatan tugashini kutamiz, aks holda vazifa
            # yopilgan baza bilan ishlashga urinib xato yozishi mumkin.
            await asyncio.gather(*background, return_exceptions=True)

        if api_runner is not None:
            await api_runner.cleanup()

        await firebase.close()
        await close_db()
        await bot.session.close()
        logger.info("Bot to'xtatildi")


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except (KeyboardInterrupt, SystemExit):
        pass
