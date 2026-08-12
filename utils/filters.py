"""Adminlikni JONLI tekshiradigan filtrlar.

Nima uchun kerak?
`F.from_user.id.in_(config.admins)` ko'rinishidagi filtr modul import
qilingan paytdagi ro'yxatga bog'lanib qoladi. Ya'ni yangi admin
qo'shilsa, u faqat butun xizmat qayta ishga tushgandan keyin ishlardi.

`IsAdmin()` har safar `config.is_admin()` ni chaqiradi — registr
(kod + env + baza + Firebase) qanday bo'lsa, javob ham shunday bo'ladi.
"""

from aiogram.filters import BaseFilter
from aiogram.types import CallbackQuery, Message

from config import is_admin


class IsAdmin(BaseFilter):
    """Faqat adminlar uchun."""

    async def __call__(self, event: Message | CallbackQuery) -> bool:
        user = getattr(event, "from_user", None)
        return user is not None and is_admin(user.id)


class NotAdmin(BaseFilter):
    """Admin bo'lmaganlar uchun (tushunarli javob berish uchun)."""

    async def __call__(self, event: Message | CallbackQuery) -> bool:
        user = getattr(event, "from_user", None)
        return user is None or not is_admin(user.id)
