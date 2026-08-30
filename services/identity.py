"""Mijozni tanish xizmati — "bir umr eslab qolish".

Muammo nimada edi?
------------------
Render'ning bepul tarifida disk saqlanmaydi: har qayta deployda yoki
konteyner uyg'onganda SQLite fayli toza bo'lib qoladi. Ilgari mijoz
faqat `/start` bosganda bazaga yozilardi va boshqa hech qayerda
tekshirilmasdi. Natijada:

  • baza tozalangach mijoz "notanish" bo'lib qolardi;
  • fallback handler "/start yuboring" deb qaytarardi;
  • mijoz qaytadan ism-telefon kiritishga majbur bo'lardi.

Yechim
------
1. HAR BIR xabar/callback'da foydalanuvchi bazaga yoziladi
   (`middlewares.identity`) — ID hech qachon "yo'qolmaydi".
2. Bazada topilmasa — Firebase'dan AYNAN shu mijoz profili so'raladi
   (`sync.fetch_user`). Ismi va telefoni bulutdan qaytariladi, ya'ni
   mijoz qaytadan ro'yxatdan o'tmaydi.
3. Profil o'zgarganda (yoki uzoq vaqt yozilmaganda) Firebase'ga
   qaytadan yoziladi — bulutdagi nusxa har doim yangi bo'ladi.
"""

import logging
import time

from database import queries as q
from services import sync

logger = logging.getLogger(__name__)

FALLBACK_NAME = "Mijoz"

# Firebase'ga ortiqcha yozmaslik uchun: user_id -> (imzo, vaqt)
_pushed: dict[int, tuple[str, float]] = {}
_PUSH_INTERVAL = 6 * 3600  # imzo o'zgarmasa ham 6 soatda bir yangilanadi

# Bulutda topilmagan ID'lar — har xabarda qayta so'ramaslik uchun.
#
# DIQQAT: bu kesh VAQTINCHALIK. Ilgari u oddiy `set` edi va ID bir marta
# tushsa protsess to'xtamaguncha CHIQMASDI. Natijada ikki muammo bor edi:
#
#   1. Mijoz keyinchalik bulutda paydo bo'lsa (masalan boshqa qurilmadan
#      ro'yxatdan o'tsa yoki `push_all_users` ishlasa) — u HECH QACHON
#      tiklanmasdi, chunki ID "bulutda yo'q" deb belgilangan edi.
#   2. To'plam cheksiz o'sardi.
#
# Endi har bir ID muddat bilan saqlanadi va muddati o'tgach qayta
# so'raladi. Chegara ham bor.
_cloud_missing: dict[int, float] = {}
_MISSING_TTL = 30 * 60
_MISSING_LIMIT = 2000


def _is_cloud_missing(user_id: int) -> bool:
    """Shu ID yaqinda bulutda topilmaganmi (ya'ni qayta so'ramaymizmi)?"""
    at = _cloud_missing.get(user_id)
    if at is None:
        return False
    if time.time() - at >= _MISSING_TTL:
        _cloud_missing.pop(user_id, None)
        return False
    return True


def _mark_cloud_missing(user_id: int) -> None:
    now = time.time()
    _cloud_missing[user_id] = now
    if len(_cloud_missing) <= _MISSING_LIMIT:
        return
    # Muddati o'tganlarni tozalaymiz, kamlik qilsa eng eskilarini
    for key, at in list(_cloud_missing.items()):
        if now - at >= _MISSING_TTL:
            _cloud_missing.pop(key, None)
    if len(_cloud_missing) > _MISSING_LIMIT:
        for key, _ in sorted(_cloud_missing.items(), key=lambda item: item[1])[
            : len(_cloud_missing) - _MISSING_LIMIT
        ]:
            _cloud_missing.pop(key, None)


def display_name(first_name: str | None, last_name: str | None = None) -> str:
    """Telegram profilidan ko'rsatiladigan ism yasaydi."""
    parts = [part for part in (first_name, last_name) if part]
    return " ".join(parts).strip() or FALLBACK_NAME


def _signature(row) -> str:
    return "|".join(
        str(row[key] or "") for key in ("full_name", "phone", "username", "car_id")
    )


async def restore_from_cloud(user_id: int) -> bool:
    """Firebase'dan bitta mijozni mahalliy bazaga qaytaradi."""
    if _is_cloud_missing(user_id):
        return False

    profile = await sync.fetch_user(user_id)
    if not profile:
        _mark_cloud_missing(user_id)
        return False

    name = profile.get("name") or FALLBACK_NAME
    phone = profile.get("phone") or None
    username = profile.get("username") or None
    if isinstance(username, str):
        username = username.lstrip("@") or None

    await q.add_user(user_id, name, phone, username)

    car_id = profile.get("carId")
    if car_id:
        try:
            if await q.get_car(int(car_id)):
                await q.set_user_car(user_id, int(car_id))
        except (TypeError, ValueError):
            pass

    logger.info("Mijoz Firebase'dan tiklandi: %s (%s)", name, user_id)
    return True


async def push_profile(user_id: int) -> None:
    """Mijoz profilini Firebase'ga yozadi (mashinasi nomi bilan)."""
    full = await q.get_user_with_car(user_id)
    if not full:
        return
    await sync.push_user(
        user_id,
        {
            "full_name": full["full_name"],
            "phone": full["phone"],
            "username": full["username"],
            "car_id": full["car_id"],
            "car_name": full["car_name"],
        },
    )
    _pushed[user_id] = (_signature(full), time.time())


async def remember(
    user_id: int,
    full_name: str | None = None,
    username: str | None = None,
    *,
    push: bool = True,
):
    """Foydalanuvchini eslab qoladi va yangi ma'lumotini qaytaradi.

    Har bir xabarda chaqirilishi mo'ljallangan: arzon (mahalliy SQLite),
    lekin mijozning ID'si va ismi hech qachon yo'qolmasligini kafolatlaydi.
    """
    row = await q.get_user(user_id)
    if row is None:
        await restore_from_cloud(user_id)
        row = await q.get_user(user_id)

    await q.touch_user(user_id, full_name or FALLBACK_NAME, username)
    row = await q.get_user(user_id)
    if row is None:  # bo'lishi mumkin emas, lekin himoya bo'lib turadi
        return None

    if push:
        signature = _signature(row)
        cached_signature, pushed_at = _pushed.get(user_id, ("", 0.0))
        if signature != cached_signature or time.time() - pushed_at > _PUSH_INTERVAL:
            _pushed[user_id] = (signature, time.time())
            _cloud_missing.pop(user_id, None)
            await push_profile(user_id)

    return row


def forget_cache(user_id: int) -> None:
    """Profil o'zgargandan keyin keshni tozalaydi (keyingi push kafolatlanadi)."""
    _pushed.pop(user_id, None)
    _cloud_missing.pop(user_id, None)
