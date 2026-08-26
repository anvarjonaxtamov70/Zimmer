"""Stories qo'shish — Telegram bot orqali (Avto_A1 mantiqi 1:1).

Qanday ishlaydi:
    Admin rasm yoki videoni tanlaydi va IZOHIGA (caption) bo'lim hashtegini
    yozadi, masalan `#natijalar`. Bot uni shu halqaga qo'shadi.

Nima uchun shunday:
    • eng tez yo'l — telefondagi galereyadan to'g'ridan-to'g'ri yuborish;
    • fayl Telegram serverida qoladi (`file_id`), link hech qachon eskirmaydi;
    • `file_id` Firebase'ga sinxronlanadi — qayta deployda yo'qolmaydi;
    • media Firebase Storage'ga ham KO'CHIRILADI (doimiy URL) — shu tufayli
      Render o'chganda ham ilovada stories ko'rinadi. `file_id` ni faqat bot
      tokeni bilan ochish mumkin, ya'ni u Render'dagi proksiga bog'liq.

O'chirish esa ilovada: storyni ochib 🗑 tugmasini bosish (admin ko'radi).
"""

import logging

from aiogram import Bot, F, Router
from aiogram.filters import Command
from aiogram.types import Message

from database import queries as q
from services import firebase_storage as fb_storage
from services import sync
from utils import stories as story_cfg
from utils.filters import IsAdmin

logger = logging.getLogger(__name__)

router = Router(name="stories")
# Butun router faqat adminlar uchun (jonli registrdan tekshiriladi)
router.message.filter(IsAdmin())

# Telegram bot orqali fayl chegarasi
MAX_MB = 20


def _caption_is_tag(caption: str | None) -> bool:
    """Izoh `#` bilan boshlanadimi (bo'sh joylarni hisobga olib)."""
    return bool(caption and caption.strip().startswith("#"))


@router.message(Command("stories"))
async def stories_help(message: Message) -> None:
    """Bo'limlar ro'yxati — admin hashteglarni yodlab olmasligi uchun."""
    await message.answer(story_cfg.categories_text())


@router.message((F.photo | F.video | F.animation) & F.caption.func(_caption_is_tag))
async def add_story(message: Message, bot: Bot) -> None:
    """`#bo'lim` izohi bilan yuborilgan rasm/videoni storyga qo'shadi."""
    caption = (message.caption or "").strip()
    # Faqat birinchi so'z — hashteg; qolgani sarlavha bo'lib ishlatiladi
    parts = caption.lstrip("#").split(maxsplit=1)
    category = (parts[0] if parts else "").strip().lower()
    heading = parts[1].strip() if len(parts) > 1 else ""

    if category not in story_cfg.STORY_MAP:
        await message.reply(
            f"❌ Bunday bo'lim yo'q: <b>#{category or '(bo`sh)'}</b>\n\n"
            + story_cfg.categories_text()
        )
        return

    info = story_cfg.STORY_MAP[category]

    # Media turini aniqlaymiz. Videoning muqovasi (thumbnail) rasm sifatida
    # saqlanadi — shunda ilovada qora ekran o'rniga birinchi kadr ko'rinadi.
    photo_id = None
    video_id = None
    if message.photo:
        photo_id = message.photo[-1].file_id
        kind = "rasm"
    else:
        media = message.video or message.animation
        video_id = media.file_id
        kind = "video"
        thumb = getattr(media, "thumbnail", None) or getattr(media, "thumb", None)
        if thumb:
            photo_id = thumb.file_id

    note = await message.reply("⏳ Story tayyorlanmoqda...")

    try:
        # Faylni tekshiramiz: 20 MB dan katta bo'lsa Telegram shu yerda xato beradi
        await bot.get_file(video_id or photo_id)

        story_id = await q.add_story_item(
            category=category,
            title=heading or info["title"],
            heading=heading or info["title"],
            emoji=info["emoji"],
            color_from=info["color_from"],
            color_to=info["color_to"],
            photo_id=photo_id,
            video_id=video_id,
        )

        # ----------------------------------------------------------------
        #  Media'ni Firebase Storage'ga KO'CHIRAMIZ (doimiy URL olish uchun)
        #
        #  Telegram `file_id` ni faqat bot tokeni bilan ochish mumkin, ya'ni
        #  ilovada ko'rsatish uchun Render'dagi `/api/media/...` proksisi
        #  kerak. Render o'chsa — stories bo'sh ko'rinadi. Storage URL'i esa
        #  brauzerda to'g'ridan-to'g'ri ochiladi, shuning uchun Mini App'ning
        #  zaxira rejimida ham stories normal ishlaydi.
        #
        #  Storage sozlanmagan bo'lsa `upload_telegram_file` file_id ni
        #  qaytaradi — biz uni URL deb yozmaymiz, ya'ni eski xatti-harakat
        #  saqlanadi va hech narsa buzilmaydi.
        # ----------------------------------------------------------------
        if fb_storage.is_storage_enabled():
            if photo_id:
                url = await fb_storage.upload_telegram_file(
                    bot, photo_id, f"stories/{story_id}/photo.jpg"
                )
                if url and str(url).startswith("http"):
                    await q.admin_update("stories", story_id, "photo_url", url)
            if video_id:
                url = await fb_storage.upload_telegram_file(
                    bot,
                    video_id,
                    f"stories/{story_id}/video.mp4",
                    content_type="video/mp4",
                    max_bytes=MAX_MB * 1024 * 1024,
                )
                if url and str(url).startswith("http"):
                    await q.admin_update("stories", story_id, "video_url", url)

        # Bulutga yozamiz — qayta deployda yo'qolmasin.
        # DIQQAT: Storage URL'lari yozilgandan KEYIN chaqiriladi, aks holda
        # bulutdagi nusxada `photo_url` bo'sh qolib, zaxira rejimda rasm
        # ko'rinmasdi.
        await sync.push_catalog("stories", story_id)

        total = len(await q.get_story_items(category))
        await note.edit_text(
            f"✅ Bu {kind} <b>{info['emoji']} {info['title']}</b> bo'limiga qo'shildi.\n\n"
            f"🆔 #{story_id}\n"
            f"📚 Bo'limda hozir: <b>{total} ta</b>\n\n"
            "Ilovada halqani ochib ko'rishingiz mumkin. "
            "O'chirish uchun storyni ochib 🗑 tugmasini bosing."
        )
        logger.info(
            "Admin %s «%s» bo'limiga story qo'shdi: #%s", message.from_user.id, category, story_id
        )
    except Exception as error:
        logger.warning("Story qo'shilmadi: %s", error)
        await note.edit_text(
            f"❌ Qo'shilmadi: {error}\n\n"
            f"Eslatma: bot orqali fayl <b>{MAX_MB} MB</b> gacha yuklanadi. "
            "Kattaroq videoni siqib (compress) qayta yuboring."
        )
