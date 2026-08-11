import logging

from aiogram import Bot
from aiogram.types import (
    BotCommand,
    BotCommandScopeChat,
    BotCommandScopeDefault,
    MenuButtonCommands,
    MenuButtonWebApp,
    WebAppInfo,
)

from config import config

logger = logging.getLogger(__name__)

USER_COMMANDS = [
    BotCommand(command="start", description="Botni ishga tushirish"),
    BotCommand(command="app", description="Ilovani ochish"),
    BotCommand(command="navbat", description="Navbat olish (botda)"),
    BotCommand(command="dokon", description="Do'kon (botda)"),
    BotCommand(command="menu", description="Asosiy menyu"),
]

ADMIN_COMMANDS = USER_COMMANDS + [
    BotCommand(command="admin", description="Admin panel"),
    BotCommand(command="id", description="Telegram ID'ni bilish"),
]


async def set_default_commands(bot: Bot) -> None:
    await bot.set_my_commands(USER_COMMANDS, scope=BotCommandScopeDefault())
    for admin_id in config.admins:
        try:
            await bot.set_my_commands(
                ADMIN_COMMANDS, scope=BotCommandScopeChat(chat_id=admin_id)
            )
        except Exception:  # admin botni hali start qilmagan bo'lishi mumkin
            continue


async def set_menu_button(bot: Bot) -> None:
    """Chatdagi ko'k «Menu» tugmasini Mini App'ni ochishga o'rnatadi."""
    try:
        if config.has_mini_app:
            await bot.set_chat_menu_button(
                menu_button=MenuButtonWebApp(
                    text="Ilova",
                    web_app=WebAppInfo(url=config.mini_app_url),
                )
            )
            logger.info("Menu tugmasi Mini App'ga ulandi: %s", config.mini_app_url)
        else:
            await bot.set_chat_menu_button(menu_button=MenuButtonCommands())
    except Exception as error:
        logger.warning("Menu tugmasi o'rnatilmadi: %s", error)
