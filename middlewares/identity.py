"""Har bir yangilanishda foydalanuvchini tanib olish va eslab qolish.

Bu middleware bot qabul qilgan HAR BIR xabar/callback uchun ishlaydi:

  • foydalanuvchini bazaga yozadi (ID hech qachon yo'qolmaydi);
  • bazada bo'lmasa — Firebase'dan profilini tiklaydi;
  • handlerlarga tayyor ma'lumot uzatadi: `db_user` va `is_admin`.

Ilgari foydalanuvchi faqat `/start` bosganda yozilardi — shu sababli
baza tozalangandan keyin bot mijozni "tanimay" qolardi.
"""

import logging
from collections.abc import Awaitable, Callable
from typing import Any

from aiogram import BaseMiddleware
from aiogram.types import TelegramObject, User

from config import is_admin
from services import identity

logger = logging.getLogger(__name__)


def _extract_user(event: TelegramObject, data: dict[str, Any]) -> User | None:
    """Yangilanishdan foydalanuvchini oladi.

    Odatda aiogram `data["event_from_user"]` ni tayyorlab beradi. Lekin
    middleware tartibiga bog'lanib qolmaslik uchun, topilmasa Update
    obyektining o'zidan ham izlaymiz.
    """
    user = data.get("event_from_user")
    if isinstance(user, User):
        return user

    for candidate in (getattr(event, "event", None), event):
        found = getattr(candidate, "from_user", None)
        if isinstance(found, User):
            return found
    return None


class IdentityMiddleware(BaseMiddleware):
    async def __call__(
        self,
        handler: Callable[[TelegramObject, dict[str, Any]], Awaitable[Any]],
        event: TelegramObject,
        data: dict[str, Any],
    ) -> Any:
        user = _extract_user(event, data)

        if user is not None and not user.is_bot:
            data["is_admin"] = is_admin(user.id)
            try:
                data["db_user"] = await identity.remember(
                    user.id,
                    identity.display_name(user.first_name, user.last_name),
                    user.username,
                )
            except Exception as error:
                # Tanib olish ishlamasa ham bot javob berishda davom etsin
                logger.warning("Foydalanuvchi (%s) saqlanmadi: %s", user.id, error)
                data["db_user"] = None
        else:
            data.setdefault("db_user", None)
            data.setdefault("is_admin", False)

        return await handler(event, data)
