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

from config import all_admins, config

logger = logging.getLogger(__name__)

USER_COMMANDS = [
    BotCommand(command="start", description="Botni ishga tushirish"),
    BotCommand(command="app", description="Do'konni ochish"),
    BotCommand(command="navbat", description="Navbat olish (botda)"),
    BotCommand(command="dokon", description="Do'kon (botda)"),
    BotCommand(command="menu", description="Asosiy menyu"),
    BotCommand(command="id", description="Telegram ID'ni bilish"),
]

ADMIN_COMMANDS = USER_COMMANDS + [
    BotCommand(command="admin", description="Admin panel"),
    BotCommand(command="katalog", description="Katalogni boshqarish"),
    BotCommand(command="adminlar", description="Adminlar ro'yxati"),
    BotCommand(command="firebase", description="Doimiy saqlash holati"),
]


async def apply_admin_commands(bot: Bot, user_id: int) -> None:
    """Bitta adminga admin buyruqlar menyusini o'rnatadi."""
    try:
        await bot.set_my_commands(ADMIN_COMMANDS, scope=BotCommandScopeChat(chat_id=user_id))
    except Exception as error:  # admin botni hali start qilmagan bo'lishi mumkin
        logger.info("Admin (%s) buyruqlari o'rnatilmadi: %s", user_id, error)


async def reset_user_commands(bot: Bot, user_id: int) -> None:
    """Admin huquqi olingandan keyin oddiy menyuni qaytaradi."""
    try:
        await bot.set_my_commands(USER_COMMANDS, scope=BotCommandScopeChat(chat_id=user_id))
    except Exception as error:
        logger.info("Foydalanuvchi (%s) buyruqlari tiklanmadi: %s", user_id, error)


async def set_default_commands(bot: Bot) -> None:
    await bot.set_my_commands(USER_COMMANDS, scope=BotCommandScopeDefault())
    for admin_id in all_admins():
        await apply_admin_commands(bot, admin_id)


async def set_menu_button(bot: Bot) -> None:
    """Chatdagi ko'k «Menu» tugmasini Mini App'ni ochishga o'rnatadi."""
    try:
        if config.has_mini_app:
            await bot.set_chat_menu_button(
                menu_button=MenuButtonWebApp(
                    text="Do'kon",
                    web_app=WebAppInfo(url=config.mini_app_url),
                )
            )
            logger.info("Menu tugmasi Mini App'ga ulandi: %s", config.mini_app_url)
        else:
            await bot.set_chat_menu_button(menu_button=MenuButtonCommands())
    except Exception as error:
        logger.warning("Menu tugmasi o'rnatilmadi: %s", error)
