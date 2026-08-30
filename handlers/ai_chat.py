"""AI yordamchi — mijoz bilan suhbat, muammoni aniqlash va rasm tahlili.

BU ROUTER ENG OXIRIDAN BITTA OLDIN TURADI (`fallback` dan oldin).
Sabab: `fallback` — «Tushunmadim» javobi, ya'ni hech kim ushlamagan
xabar. AI aynan o'sha xabarlarni ushlashi kerak, lekin BOSHQA HECH
NARSANI olmasligi kerak.

NIMANI USHLAMAYDI (va nega):

  * FSM holatidagi xabarlar — `StateFilter(None)`. Mijoz ro'yxatdan
    o'tayotgan, buyurtma rasmiylashtirayotgan yoki admin forma
    to'ldirayotgan bo'lsa, AI aralashsa oqim BUZILADI.

  * Buyruqlar (`/...`) — aiogram ularni o'zi ajratmaydi. Bu tekshiruv
    bo'lmasa AI noma'lum buyruqlarga, eng yomoni admin buyruqlariga
    (mijoz `/katalog` yozsa) javob berib ketardi.

  * Menyu tugmalari — matni AYNAN tugma yozuvi bo'lsa tegmaymiz.
    Ular uchun o'z handler'lari bor va ular ODATDA oldinroq turadi;
    bu — qo'shimcha himoya (masalan mijozning telefonida eski
    klaviatura keshlanib qolgan bo'lsa).

  * Ro'yxatdan o'tmagan mijoz — avval `/start` kerak, aks holda
    buyurtma ham, navbat ham olib bo'lmaydi.
"""

from __future__ import annotations

import asyncio
import html
import logging
import time

from aiogram import F, Router
from aiogram.filters import StateFilter
from aiogram.types import Message
from aiogram.utils.keyboard import InlineKeyboardBuilder

from config import config
from database import queries as q
from services import ai, ai_brain
from utils import texts

logger = logging.getLogger(__name__)

router = Router(name="ai_chat")

# Menyu tugmalari — AI ularga javob bermaydi.
# `utils/texts.py` dan olinadi: qayta yozilsa apostrof farqi tufayli
# solishtirish jimgina ishlamay qolardi.
BUTTON_LABELS = frozenset(
    value
    for name, value in vars(texts).items()
    if name.startswith("BTN_") and isinstance(value, str)
)

# ---- so'rovlar chegarasi ----
#
# Groq bepul tarifda daqiqada cheklangan so'rov beradi va loyihada
# anti-flood middleware YO'Q. Shu sababli chegara shu yerda:
#   * bir foydalanuvchi ketma-ket so'rovlar orasida kutishi kerak;
#   * bir vaqtda bitta so'rovi bo'lishi mumkin (ikki marta bosib
#     ikkita so'rov yuborilmasin).
COOLDOWN_SECONDS = 3
_last_call: dict[int, float] = {}
_busy: set[int] = set()

# Suhbat tarixi: foydalanuvchi -> Conversation
_talks: dict[int, ai.Conversation] = {}
# Xotira cheksiz o'smasligi uchun: shu vaqtdan eski suhbatlar tashlanadi
_TALK_TTL = 30 * 60
_TALK_MAX = 200

# Rasm tahlili uchun eng katta fayl (Telegram'dan yuklab olinadi)
_MAX_PHOTO_BYTES = ai.MAX_IMAGE_BYTES


def _shop_kb():
    """«Do'konni ochish» tugmasi — AI javobining maqsadi shu."""
    kb = InlineKeyboardBuilder()
    if config.has_mini_app:
        kb.button(text=texts.BTN_OPEN_APP, web_app={"url": config.mini_app_url})
    if config.pay_admin_username:
        kb.button(text="✍️ Ustaga yozish", url=f"https://t.me/{config.pay_admin_username}")
    kb.adjust(1)
    return kb.as_markup() if kb.buttons else None


def _talk(user_id: int) -> ai.Conversation:
    """Foydalanuvchining suhbatini oladi va eskilarini tozalaydi."""
    now = time.time()

    # Eski suhbatlarni tashlaymiz (xotira o'sib ketmasin)
    if len(_talks) > _TALK_MAX:
        stale = [uid for uid, talk in _talks.items() if now - talk.touched > _TALK_TTL]
        for uid in stale:
            _talks.pop(uid, None)
        # Hali ham ko'p bo'lsa — eng eskilarini olib tashlaymiz
        if len(_talks) > _TALK_MAX:
            oldest = sorted(_talks.items(), key=lambda item: item[1].touched)
            for uid, _ in oldest[: len(_talks) - _TALK_MAX]:
                _talks.pop(uid, None)

    talk = _talks.get(user_id)
    if talk is None or now - talk.touched > _TALK_TTL:
        talk = ai.Conversation()
        _talks[user_id] = talk
    talk.touched = now
    return talk


def reset_talk(user_id: int) -> None:
    """Suhbatni boshidan boshlaydi (`/start` da chaqiriladi)."""
    _talks.pop(user_id, None)


def _cooldown_left(user_id: int) -> float:
    last = _last_call.get(user_id, 0.0)
    return max(0.0, COOLDOWN_SECONDS - (time.time() - last))


async def _user_name(message: Message, db_user) -> str:
    """Mijozning ismi — bazadagi ism ustun (u aniqroq)."""
    if db_user is not None:
        try:
            name = db_user["full_name"]
        except (KeyError, TypeError, IndexError):
            name = None
        if name:
            return str(name).strip()
    return (message.from_user.first_name or "").strip()


async def _registered(message: Message, db_user):
    """Ro'yxatdan o'tganmi. O'tmagan bo'lsa `None` qaytaradi."""
    user = db_user if db_user is not None else await q.get_user(message.from_user.id)
    if user is None:
        return None
    try:
        phone = user["phone"]
    except (KeyError, TypeError, IndexError):
        phone = None
    return user if phone else None


async def _reply(message: Message, text: str) -> None:
    """Javobni yuboradi.

    DIQQAT: botda standart `parse_mode=HTML` (`bot.py`). AI matnida `<`,
    `>` yoki `&` bo'lsa Telegram so'rovni RAD ETADI va mijoz javob
    ko'rmaydi. Shu sababli matn qochiriladi.
    """
    safe = html.escape(text)
    # Telegram chegarasi 4096 belgi — uzun javobni qirqamiz
    if len(safe) > 3900:
        safe = safe[:3900].rstrip() + "…"
    await message.answer(safe, reply_markup=_shop_kb())


async def _run(message: Message, db_user, content) -> None:
    """AI'ga so'rov yuboradi va javobni yozadi (umumiy qism)."""
    user_id = message.from_user.id
    name = await _user_name(message, db_user)

    talk = _talk(user_id)
    history = ai.trim_history(talk.messages)

    prompt = await ai_brain.system_prompt(user_id, name)
    messages = [{"role": "system", "content": prompt}, *history, {"role": "user", "content": content}]

    # Rasmli so'rov — «ko'radigan» modelga
    is_image = isinstance(content, list)
    model = config.groq_vision_model if is_image else config.groq_text_model

    reply = await ai.ask(messages, model=model)

    if not reply.ok:
        # Xatoda tarixga hech narsa yozmaymiz — keyingi urinish toza boshlanadi
        await _reply(message, reply.text)
        return

    talk.messages.append({"role": "user", "content": content})
    talk.messages.append({"role": "assistant", "content": reply.text})
    talk.messages = ai.trim_history(talk.messages)

    await _reply(message, reply.text)


async def _typing(message: Message, stop: asyncio.Event) -> None:
    """«Yozmoqda...» belgisini javob kelguncha ushlab turadi.

    Telegram bu belgini 5 soniyada o'chiradi, shuning uchun takrorlanadi.
    AI javobi 10-20 soniya kelishi mumkin — belgisiz mijoz bot
    javob bermayapti deb o'ylaydi."""
    try:
        while not stop.is_set():
            try:
                await message.bot.send_chat_action(message.chat.id, "typing")
            except Exception:  # noqa: BLE001 — belgi ko'rsatilmasa ham ish davom etadi
                return
            try:
                await asyncio.wait_for(stop.wait(), timeout=4.0)
            except asyncio.TimeoutError:
                continue
    except asyncio.CancelledError:
        return


async def _guarded(message: Message, db_user, content) -> None:
    """Chegara va «yozmoqda» belgisi bilan bajaradi."""
    user_id = message.from_user.id

    if user_id in _busy:
        return  # oldingi so'rov hali tugamagan — jim turamiz

    left = _cooldown_left(user_id)
    if left > 0:
        await message.answer(f"Bir soniya… ({left:.0f}s) 🙂")
        return

    _busy.add(user_id)
    _last_call[user_id] = time.time()
    stop = asyncio.Event()
    typing = asyncio.create_task(_typing(message, stop))
    try:
        await _run(message, db_user, content)
    except Exception as error:  # noqa: BLE001 — AI bot ishini to'xtatmasin
        logger.exception("AI javobida xato: %s", error)
        try:
            await message.answer(
                "Kechirasiz, javob bera olmadim. Pastdagi tugma bilan "
                "do'konni ochib ko'rishingiz mumkin.",
                reply_markup=_shop_kb(),
            )
        except Exception:  # noqa: BLE001
            pass
    finally:
        stop.set()
        typing.cancel()
        _busy.discard(user_id)


# =====================================================================
#  MATNLI XABAR
# =====================================================================
@router.message(StateFilter(None), F.text)
async def ai_text(message: Message, db_user=None, is_admin: bool = False) -> None:
    text = (message.text or "").strip()

    # Buyruq — AI'ga tegishli emas (aiogram o'zi ajratmaydi)
    if text.startswith("/"):
        return await _pass_through(message, db_user)
    # Menyu tugmasi — o'z handler'i bor
    if text in BUTTON_LABELS:
        return await _pass_through(message, db_user)
    if not text:
        return await _pass_through(message, db_user)

    if not ai.is_enabled():
        return await _pass_through(message, db_user)

    if await _registered(message, db_user) is None:
        return await _pass_through(message, db_user)

    await _guarded(message, db_user, text)


# =====================================================================
#  RASM
# =====================================================================
@router.message(StateFilter(None), F.photo)
async def ai_photo(message: Message, db_user=None) -> None:
    if not ai.is_vision_enabled():
        return await _pass_through(message, db_user)
    if await _registered(message, db_user) is None:
        return await _pass_through(message, db_user)

    user_id = message.from_user.id
    if user_id in _busy:
        return
    left = _cooldown_left(user_id)
    if left > 0:
        await message.answer(f"Bir soniya… ({left:.0f}s) 🙂")
        return

    # Eng katta o'lchamdagi nusxa — tahlil uchun aniqrog'i kerak,
    # lekin chegaradan oshmasligi ham kerak.
    photo = message.photo[-1]
    for candidate in reversed(message.photo):
        if (candidate.file_size or 0) <= _MAX_PHOTO_BYTES:
            photo = candidate
            break

    try:
        buffer = await message.bot.download(photo.file_id)
        data = buffer.read()
    except Exception as error:  # noqa: BLE001
        logger.warning("AI: rasm yuklab olinmadi: %s", error)
        await message.answer(
            "Rasmni ocholmadim. Qaytadan yuboring yoki muammoni "
            "so'z bilan yozib bering."
        )
        return

    if not data or len(data) > _MAX_PHOTO_BYTES:
        await message.answer(
            "Rasm juda katta. Kichikroq qilib yoki muammoni so'z bilan "
            "yozib yuboring."
        )
        return

    caption = (message.caption or "").strip()
    ask_text = caption or (
        "Bu faraning rasmi. Nima ko'rinayotganini ayt va qaysi xizmat "
        "kerakligini narxi bilan tushuntir."
    )
    content = ai.vision_content(ask_text, ai.image_data_url(data))

    await _guarded(message, db_user, content)


# =====================================================================
#  AI ISHLAMAGANDA — ESKI «TUSHUNMADIM» JAVOBI
# =====================================================================
async def _pass_through(message: Message, db_user) -> None:
    """AI javob bermaydigan holat: eski xatti-harakatni takrorlaymiz.

    NEGA `return` YETARLI EMAS. aiogram handler ishga tushgan bo'lsa
    xabarni HAL QILINGAN deb hisoblaydi va keyingi routerlarga
    (`fallback`) O'TKAZMAYDI. Ya'ni shunchaki `return` qilsak mijoz
    HECH QANDAY javob olmasdi.

    `fallback` ni takrorlamaslik uchun uning funksiyasi chaqiriladi —
    javob matni bir joyda qoladi.
    """
    from handlers.fallback import unknown_message

    await unknown_message(message, db_user=db_user)
