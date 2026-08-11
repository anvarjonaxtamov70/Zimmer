"""Zimmer bot — kirish nuqtasi."""

import asyncio
import logging
import sys

from aiogram import Bot, Dispatcher
from aiogram.client.default import DefaultBotProperties
from aiogram.enums import ParseMode
from aiogram.fsm.storage.memory import MemoryStorage

from api.server import start_api_server
from config import config
from database.db import close_db, init_db
from handlers import get_routers
from utils.commands import set_default_commands, set_menu_button

logger = logging.getLogger("zimmer")


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

    if not config.admins:
        logger.warning(
            "ADMINS bo'sh. Admin panel ishlamaydi. Botga /id yuborib ID'ingizni "
            ".env dagi ADMINS ga yozing."
        )

    await init_db()

    bot = Bot(
        token=config.bot_token,
        default=DefaultBotProperties(parse_mode=ParseMode.HTML),
    )
    dispatcher = Dispatcher(storage=MemoryStorage())
    for router in get_routers():
        dispatcher.include_router(router)

    api_runner = None
    try:
        me = await bot.get_me()
        # Render'da PORT beriladi — shunda /health va Mini App API'si yoqiladi
        api_runner = await start_api_server(bot, me.username)
        await set_default_commands(bot)
        await set_menu_button(bot)
        await bot.delete_webhook(drop_pending_updates=True)
        logger.info("Bot ishga tushdi: @%s (%s)", me.username, me.id)
        if config.has_mini_app:
            logger.info("Mini App manzili: %s", config.mini_app_url)
        await dispatcher.start_polling(bot)
    finally:
        if api_runner is not None:
            await api_runner.cleanup()
        await close_db()
        await bot.session.close()
        logger.info("Bot to'xtatildi")


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except (KeyboardInterrupt, SystemExit):
        pass
