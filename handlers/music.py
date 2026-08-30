"""Mini App'dagi FON MUSIQASI — bot orqali boshqarish.

Admin botga audio tashlaydi va u Mini App'da orqa fonda eshitiladi.

NEGA AUDIONI SHUNCHAKI TASHLASH YETARLI.
Admin panelida forma to'ldirish, maydon tanlash va tugma bosish kerak
bo'lardi. Musiqa esa Telegram'da allaqachon fayl ko'rinishida turadi —
uni oldinga uzatish eng qisqa yo'l. Sarlavha ham faylning o'zidan
olinadi (`title` / `performer` / `file_name`).

DIQQAT — BRAUZER OVOZNI O'ZI BOSHLAMAYDI.
Bu Zimmer cheklovi emas, Chrome/Safari qoidasi: ovozli audio
foydalanuvchi TEGINMAGUNCHA boshlanmaydi. Shu sababli Mini App'da
🎵 tugmasi bor — mijoz bir marta bosadi va tanlovi eslab qolinadi.
Admin buni bilishi kerak, aks holda «musiqa ishlamayapti» deb o'ylaydi;
shuning uchun tasdiq xabarida shu haqda yozilgan.
"""

from __future__ import annotations

import logging

from aiogram import F, Router
from aiogram.filters import Command
from aiogram.types import Message

from database import queries as q
from utils.filters import IsAdmin
from utils.helpers import html_escape

logger = logging.getLogger(__name__)

router = Router(name="music")
# Butun router faqat adminlar uchun — mijoz audio tashlasa AI javob beradi
router.message.filter(IsAdmin())

# Telegram bot API fayl chegarasi 50 MB, lekin fon musiqasi uchun
# bunchasi kerak emas va mijozning trafigi behuda ketardi.
MAX_AUDIO_BYTES = 12 * 1024 * 1024

# Bir vaqtda nechta trek bo'lishi mumkin. Ko'proq bo'lsa ma'nosi yo'q:
# ilova ularni navbat bilan aylantiradi.
MAX_TRACKS = 10


def _title(message: Message) -> str:
    """Trek nomini fayldan oladi."""
    audio = message.audio
    parts = []
    if audio.performer:
        parts.append(audio.performer.strip())
    if audio.title:
        parts.append(audio.title.strip())
    if parts:
        return " — ".join(parts)[:120]
    if audio.file_name:
        # Kengaytmani olib tashlaymiz: «fon.mp3» -> «fon»
        return audio.file_name.rsplit(".", 1)[0][:120]
    return "Fon musiqasi"


@router.message(F.audio)
async def add_track(message: Message) -> None:
    """Admin audio tashladi — fon musiqasi sifatida saqlaymiz."""
    audio = message.audio

    if (audio.file_size or 0) > MAX_AUDIO_BYTES:
        await message.answer(
            f"⚠️ Fayl juda katta ({(audio.file_size or 0) // (1024 * 1024)} MB).\n\n"
            f"Fon musiqasi uchun {MAX_AUDIO_BYTES // (1024 * 1024)} MB gacha "
            "bo'lgani yaxshi — aks holda mijozning trafigi behuda ketadi.\n\n"
            "Qisqartirib yoki sifatini pasaytirib qayta yuboring."
        )
        return

    try:
        existing = await q.get_music(active_only=False)
    except Exception as error:  # noqa: BLE001
        logger.warning("Musiqa ro'yxati o'qilmadi: %s", error)
        existing = []

    if len(existing) >= MAX_TRACKS:
        await message.answer(
            f"⚠️ Musiqa ro'yxati to'la ({MAX_TRACKS} ta).\n\n"
            "Avval keraksizini o'chiring: /musiqa"
        )
        return

    title = _title(message)
    try:
        track_id = await q.add_music(
            title=title,
            audio_id=audio.file_id,
            duration=audio.duration or 0,
        )
    except Exception as error:  # noqa: BLE001
        logger.exception("Musiqa saqlanmadi: %s", error)
        await message.answer("❌ Saqlanmadi. Qaytadan urinib ko'ring.")
        return

    # Bulutga ham yozamiz — qayta deployda yo'qolmasin
    try:
        from services import sync

        await sync.push_catalog("music", track_id)
    except Exception as error:  # noqa: BLE001 — bulut asosiy ish emas
        logger.warning("Musiqa bulutga yozilmadi: %s", error)

    minutes, seconds = divmod(audio.duration or 0, 60)
    await message.answer(
        f"🎵 <b>Fon musiqasi qo'shildi</b>\n\n"
        f"Nomi: {html_escape(title)}\n"
        f"Davomiyligi: {minutes}:{seconds:02d}\n\n"
        "Mini App'da tepadagi 🎵 tugmasi bilan yoqiladi.\n\n"
        "ℹ️ <b>Muhim:</b> brauzer ovozni o'zi boshlamaydi — bu Chrome va "
        "Safari qoidasi. Mijoz 🎵 tugmasini bir marta bosishi kerak, "
        "keyin tanlovi eslab qolinadi va keyingi kirishlarida o'zi "
        "davom etadi.\n\n"
        "Ro'yxatni ko'rish: /musiqa"
    )


@router.message(Command("musiqa"))
async def list_tracks(message: Message) -> None:
    """Musiqa ro'yxati va boshqarish."""
    try:
        rows = await q.get_music(active_only=False)
    except Exception as error:  # noqa: BLE001
        logger.warning("Musiqa ro'yxati o'qilmadi: %s", error)
        rows = []

    if not rows:
        await message.answer(
            "🎵 <b>Fon musiqasi</b>\n\n"
            "Hozircha hech narsa yo'q.\n\n"
            "Qo'shish uchun menga audio fayl tashlang — u Mini App'da "
            "orqa fonda eshitiladi."
        )
        return

    lines = ["🎵 <b>Fon musiqasi</b>", ""]
    for index, row in enumerate(rows, start=1):
        minutes, seconds = divmod(int(row["duration"] or 0), 60)
        mark = "🟢" if row["is_active"] else "🔴"
        source = "havola" if row["audio_url"] else "Telegram fayli"
        lines.append(
            f"{index}. {mark} {html_escape(row['title'])} "
            f"({minutes}:{seconds:02d}, {source})\n"
            f"    o'chirish: /musiqa_del_{row['id']}   "
            f"holat: /musiqa_on_{row['id']}"
        )

    lines.append("")
    lines.append("Yangi qo'shish: menga audio tashlang.")
    await message.answer("\n".join(lines))


@router.message(F.text.regexp(r"^/musiqa_del_(\d+)$").as_("match"))
async def delete_track(message: Message, match) -> None:
    """Trekni o'chiradi."""
    track_id = int(match.group(1))
    row = await q.admin_get("music", track_id)
    if not row:
        await message.answer("Bu trek topilmadi.")
        return

    try:
        await q.admin_delete("music", track_id)
    except Exception as error:  # noqa: BLE001
        logger.warning("Musiqa o'chirilmadi: %s", error)
        await message.answer("❌ O'chirilmadi.")
        return

    try:
        from services import sync

        await sync.delete_catalog("music", track_id, row["title"])
    except Exception as error:  # noqa: BLE001
        logger.warning("Musiqa bulutdan o'chirilmadi: %s", error)

    await message.answer(f"🗑 «{html_escape(row['title'])}» o'chirildi.")


@router.message(F.text.regexp(r"^/musiqa_on_(\d+)$").as_("match"))
async def toggle_track(message: Message, match) -> None:
    """Trekni yoqadi/o'chiradi (o'chirmasdan yashirish)."""
    track_id = int(match.group(1))
    if not await q.admin_get("music", track_id):
        await message.answer("Bu trek topilmadi.")
        return

    state = await q.admin_toggle("music", track_id)

    try:
        from services import sync

        await sync.push_catalog("music", track_id)
    except Exception as error:  # noqa: BLE001
        logger.warning("Musiqa bulutga yozilmadi: %s", error)

    await message.answer("🟢 Yoqildi." if state else "🔴 O'chirildi.")
