from aiogram import Bot
from aiogram.types import BotCommand, BotCommandScopeChat, BotCommandScopeDefault

from config import config

USER_COMMANDS = [
    BotCommand(command="start", description="Botni ishga tushirish"),
    BotCommand(command="navbat", description="Navbat olish"),
    BotCommand(command="dokon", description="Mahsulotlar do'koni"),
    BotCommand(command="savatcha", description="Savatchani ko'rish"),
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
