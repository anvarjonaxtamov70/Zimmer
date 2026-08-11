"""Tushunarsiz xabarlar uchun javob (faqat FSM holati bo'lmaganda)."""

from aiogram import Router
from aiogram.filters import StateFilter
from aiogram.types import Message

from database import queries as q
from keyboards.reply import main_menu

router = Router(name="fallback")


@router.message(StateFilter(None))
async def unknown_message(message: Message) -> None:
    user = await q.get_user(message.from_user.id)
    if not user:
        await message.answer(
            "Botdan foydalanish uchun /start buyrug'ini yuboring 👇"
        )
        return
    await message.answer(
        "Tushunmadim 🤔\n\nPastdagi menyudan kerakli bo'limni tanlang.",
        reply_markup=main_menu(message.from_user.id),
    )
