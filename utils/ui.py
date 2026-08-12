"""Xabarlarni tahrirlash va adminlarga xabar yuborish uchun yordamchilar."""

import logging

from aiogram import Bot
from aiogram.exceptions import TelegramBadRequest
from aiogram.types import InlineKeyboardMarkup, Message

from config import all_admins

logger = logging.getLogger(__name__)


async def edit_or_send(
    message: Message,
    text: str,
    reply_markup: InlineKeyboardMarkup | None = None,
) -> None:
    """Xabarni tahrirlaydi; iloji bo'lmasa (masalan rasmli xabar) yangisini yuboradi."""
    try:
        if message.text is not None:
            await message.edit_text(text, reply_markup=reply_markup)
            return
    except TelegramBadRequest as error:
        if "message is not modified" in str(error):
            return
        logger.debug("edit_text ishlamadi: %s", error)

    try:
        await message.delete()
    except TelegramBadRequest:
        pass
    await message.answer(text, reply_markup=reply_markup)


async def notify_admins(
    bot: Bot,
    text: str,
    reply_markup: InlineKeyboardMarkup | None = None,
) -> None:
    for admin_id in all_admins():
        try:
            await bot.send_message(admin_id, text, reply_markup=reply_markup)
        except Exception as error:  # admin botni bloklagan bo'lishi mumkin
            logger.warning("Adminga (%s) xabar yuborilmadi: %s", admin_id, error)
