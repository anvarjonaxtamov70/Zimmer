"""AI yordamchi — Groq API bilan ishlash.

NEGA GROQ. Bepul tarifi bor, tez ishlaydi va OpenAI bilan bir xil
so'rov ko'rinishini qabul qiladi (`/chat/completions`). Avto_A1 loyihasi
ham shu xizmatdan foydalanadi, ya'ni bitta kalit ikkisiga yetadi.

NEGA YANGI KUTUBXONA QO'SHILMADI. Loyihada `aiohttp` allaqachon bor
(API server shunda ishlaydi). `groq` yoki `openai` paketini qo'shish
Render'dagi build vaqtini uzaytirardi va yangi bog'liqlik keltirardi —
holbuki bizga bitta HTTP so'rov kerak.

ASOSIY QOIDALAR
  * Bu modul HECH QACHON xato ko'tarmaydi. AI — qo'shimcha imkoniyat;
    u ishlamasa bot oldingidek ishlashda davom etishi kerak. Xato
    o'rniga `AiReply(ok=False, ...)` qaytariladi.
  * Hech narsa BLOKLAMAYDI: barcha so'rovlar `aiohttp` bilan asinxron.
  * Model nomlari `config` dan keladi (env) — Groq modellarni
    vaqti-vaqti bilan o'chiradi.
"""

from __future__ import annotations

import asyncio
import base64
import logging
from dataclasses import dataclass, field

import aiohttp

from config import config

logger = logging.getLogger(__name__)

GROQ_URL = "https://api.groq.com/openai/v1/chat/completions"

# So'rov uchun kutish vaqti. Telegram foydalanuvchisi 30 soniya kutmaydi —
# undan uzoq javobni kutgandan ko'ra «keyinroq urinib ko'ring» deymiz.
TIMEOUT_SECONDS = 25

# Javobning maksimal uzunligi (token). Telegram xabari 4096 belgi;
# 700 token ~ 2000-2500 belgi — yetarli va tez.
MAX_TOKENS = 700

# Rasm hajmi chegarasi. Groq base64 rasmni so'rov ichida qabul qiladi,
# lekin katta fayl so'rovni sekinlashtiradi va limitdan oshib ketadi.
MAX_IMAGE_BYTES = 4 * 1024 * 1024


@dataclass(frozen=True)
class AiReply:
    """AI javobi. `ok=False` bo'lsa `text` — mijozga ko'rsatiladigan sabab."""

    ok: bool
    text: str
    # Xatoning texnik turi (jurnal uchun): "no_key" | "rate" | "timeout" |
    # "http" | "empty" | "network" | "no_vision"
    reason: str = ""


@dataclass
class Conversation:
    """Bitta foydalanuvchi bilan suhbat tarixi.

    Xotirada saqlanadi (bazada emas): suhbat tarixi qimmatli ma'lumot
    emas va Render qayta ishga tushganda yo'qolishi muammo emas. Bazaga
    yozish har xabarda disk yozuvini talab qilardi.
    """

    messages: list[dict] = field(default_factory=list)
    # Oxirgi murojaat vaqti — eski suhbatlarni tozalash uchun
    touched: float = 0.0


# Suhbatda saqlanadigan xabarlar soni (foydalanuvchi + AI juftliklari).
# Uzun tarix har so'rovda ko'proq token yeydi va bepul tarif chegarasiga
# tezroq olib boradi.
HISTORY_TURNS = 6


def is_enabled() -> bool:
    """AI ishlaydimi (kalit sozlanganmi)."""
    return config.ai_enabled


def is_vision_enabled() -> bool:
    """Rasmni tahlil qilish mumkinmi."""
    return bool(config.ai_enabled and config.groq_vision_model)


def image_data_url(data: bytes, mime: str = "image/jpeg") -> str:
    """Rasmni Groq qabul qiladigan `data:` manzilga aylantiradi."""
    return f"data:{mime};base64," + base64.b64encode(data).decode("ascii")


async def ask(
    messages: list[dict],
    *,
    model: str | None = None,
    max_tokens: int = MAX_TOKENS,
    temperature: float = 0.5,
) -> AiReply:
    """Groq'ga so'rov yuboradi va javob matnini qaytaradi.

    `messages` — OpenAI ko'rinishidagi ro'yxat:
        [{"role": "system", "content": "..."},
         {"role": "user", "content": "..."}]

    Rasm uchun `content` ro'yxat bo'ladi (`type: text` va
    `type: image_url`) — `vision_content()` shu ko'rinishni yasaydi.
    """
    if not config.ai_enabled:
        return AiReply(False, "AI yordamchi hozircha sozlanmagan.", "no_key")

    payload = {
        "model": model or config.groq_text_model,
        "messages": messages,
        "max_tokens": max_tokens,
        "temperature": temperature,
    }
    headers = {
        "Authorization": f"Bearer {config.groq_api_key}",
        "Content-Type": "application/json",
    }

    timeout = aiohttp.ClientTimeout(total=TIMEOUT_SECONDS)
    try:
        async with aiohttp.ClientSession(timeout=timeout) as session:
            async with session.post(GROQ_URL, json=payload, headers=headers) as response:
                # Chegaradan oshdik — bepul tarifda tez-tez uchraydi
                if response.status == 429:
                    retry = response.headers.get("retry-after", "")
                    logger.warning("AI: chegaradan oshdi (429), retry-after=%s", retry)
                    return AiReply(
                        False,
                        "Hozir juda ko'p so'rov keldi. Bir daqiqadan keyin "
                        "qayta yozib ko'ring.",
                        "rate",
                    )
                if response.status >= 400:
                    body = (await response.text())[:400]
                    logger.warning("AI: HTTP %s — %s", response.status, body)
                    # 404 — model o'chirilgan bo'lishi mumkin (Groq shunday qiladi)
                    if response.status == 404:
                        logger.warning(
                            "AI: «%s» modeli topilmadi. Groq modelni o'chirgan "
                            "bo'lishi mumkin — GROQ_TEXT_MODEL / GROQ_VISION_MODEL "
                            "ni yangilang.",
                            payload["model"],
                        )
                    return AiReply(False, _friendly_error(), "http")

                data = await response.json()
    except asyncio.TimeoutError:
        logger.warning("AI: javob %s soniyada kelmadi", TIMEOUT_SECONDS)
        return AiReply(False, "Javob kechikdi. Qayta yozib ko'ring.", "timeout")
    except Exception as error:  # noqa: BLE001 — AI bot ishini to'xtatmasligi kerak
        logger.warning("AI: so'rov yuborilmadi: %s", error)
        return AiReply(False, _friendly_error(), "network")

    text = _extract_text(data)
    if not text:
        logger.warning("AI: bo'sh javob keldi")
        return AiReply(False, _friendly_error(), "empty")

    return AiReply(True, text)


def _extract_text(data: dict) -> str:
    """Javobdan matnni ehtiyotkorlik bilan oladi.

    Ko'rinish o'zgarishi mumkin, shuning uchun har qadamda tekshiriladi —
    `data["choices"][0]["message"]["content"]` ni to'g'ridan-to'g'ri
    o'qish `KeyError` bilan yiqilishi mumkin edi.
    """
    choices = data.get("choices") if isinstance(data, dict) else None
    if not isinstance(choices, list) or not choices:
        return ""
    message = choices[0].get("message") if isinstance(choices[0], dict) else None
    content = message.get("content") if isinstance(message, dict) else None
    if isinstance(content, str):
        return content.strip()
    # Ba'zi modellar bo'laklar ro'yxatini qaytaradi
    if isinstance(content, list):
        parts = [p.get("text", "") for p in content if isinstance(p, dict)]
        return " ".join(part for part in parts if part).strip()
    return ""


def _friendly_error() -> str:
    """Mijozga ko'rsatiladigan xabar. Texnik tafsilot BERILMAYDI —
    u mijozga hech narsa anglatmaydi va ishonchni kamaytiradi."""
    return (
        "Hozir javob bera olmadim 😔 Bir oz keyin qayta yozib ko'ring "
        "yoki pastdagi tugma bilan do'konni ochib, o'zingiz ko'rib chiqing."
    )


def vision_content(text: str, data_url: str) -> list[dict]:
    """Rasm + matn uchun `content` ro'yxatini yasaydi."""
    return [
        {"type": "text", "text": text},
        {"type": "image_url", "image_url": {"url": data_url}},
    ]


def trim_history(messages: list[dict], turns: int = HISTORY_TURNS) -> list[dict]:
    """Suhbat tarixini oxirgi N juftlikka qisqartiradi.

    Rasmli xabarlar tarixdan OLIB TASHLANADI: ular base64 bo'lgani uchun
    juda katta va har so'rovda qayta yuborilsa chegaradan oshib ketadi.
    O'rniga qisqa izoh qoldiriladi.
    """
    keep = turns * 2
    trimmed = messages[-keep:] if len(messages) > keep else list(messages)

    out: list[dict] = []
    for item in trimmed:
        content = item.get("content")
        if isinstance(content, list):
            # Rasmni matn izohi bilan almashtiramiz
            texts = [p.get("text", "") for p in content if isinstance(p, dict)]
            note = " ".join(t for t in texts if t).strip() or "(rasm yuborildi)"
            out.append({"role": item.get("role", "user"), "content": note})
        else:
            out.append(item)
    return out
