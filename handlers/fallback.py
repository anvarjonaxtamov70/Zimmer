"""Tushunarsiz xabarlar uchun javob (faqat FSM holati bo'lmaganda)."""

from aiogram import Router
from aiogram.filters import StateFilter
from aiogram.types import Message

from database import queries as q
from keyboards.reply import main_menu

router = Router(name="fallback")


@router.message(StateFilter(None))
async def unknown_message(message: Message, db_user=None) -> None:
    # `db_user` — IdentityMiddleware tayyorlab beradi (bazadan yoki
    # Firebase'dan tiklangan holda). Middleware ishlamagan holat uchun
    # zaxira sifatida bazadan o'zimiz o'qiymiz.
    user = db_user if db_user is not None else await q.get_user(message.from_user.id)

    if user is None or not user["phone"]:
        await message.answer(
            "Ro'yxatdan o'tish uchun /start buyrug'ini yuboring 👇",
            reply_markup=main_menu(message.from_user.id),
        )
        return

    await message.answer(
        "Tushunmadim 🤔\n\nPastdagi menyudan kerakli bo'limni tanlang.",
        reply_markup=main_menu(message.from_user.id),
    )
