"""Telegram Mini App'dan kelgan `initData` ni tekshirish.

Telegram hujjatlari bo'yicha algoritm:
  secret_key       = HMAC_SHA256(key="WebAppData", msg=<bot_token>)
  data_check_string = "key=value" qatorlari (hash'dan tashqari) alifbo
                      tartibida "\n" bilan birlashtiriladi
  hash             = HMAC_SHA256(key=secret_key, msg=data_check_string)

Bu tekshiruv foydalanuvchi ma'lumotini o'zgartirib yubora olmasligini
kafolatlaydi — ya'ni boshqa odam nomidan navbat/buyurtma bermaydi.
"""

import hashlib
import hmac
import json
import logging
import time
from urllib.parse import parse_qsl

logger = logging.getLogger(__name__)

# initData qancha vaqt amal qiladi (24 soat)
MAX_AGE_SECONDS = 24 * 60 * 60


def validate_init_data(
    init_data: str,
    bot_token: str,
    max_age: int = MAX_AGE_SECONDS,
) -> dict | None:
    """To'g'ri bo'lsa {"user": {...}, "auth_date": int} qaytaradi, aks holda None."""
    if not init_data or not bot_token:
        return None

    try:
        pairs = parse_qsl(init_data, keep_blank_values=True, strict_parsing=True)
    except ValueError:
        logger.debug("initData formati buzilgan")
        return None

    data = dict(pairs)
    received_hash = data.pop("hash", "")
    if not received_hash:
        return None

    check_string = "\n".join(f"{key}={data[key]}" for key in sorted(data))
    secret_key = hmac.new(b"WebAppData", bot_token.encode(), hashlib.sha256).digest()
    expected = hmac.new(secret_key, check_string.encode(), hashlib.sha256).hexdigest()

    if not hmac.compare_digest(expected, received_hash):
        logger.warning("initData imzosi mos kelmadi")
        return None

    try:
        auth_date = int(data.get("auth_date", "0"))
    except ValueError:
        return None

    if max_age > 0 and time.time() - auth_date > max_age:
        logger.info("initData muddati o'tgan (auth_date=%s)", auth_date)
        return None

    try:
        user = json.loads(data.get("user", "{}"))
    except json.JSONDecodeError:
        return None

    if not isinstance(user, dict) or "id" not in user:
        return None

    return {"user": user, "auth_date": auth_date, "query_id": data.get("query_id")}


def extract_init_data(headers) -> str:
    """`Authorization: tma <initData>` yoki `X-Telegram-Init-Data` sarlavhasi."""
    raw = headers.get("Authorization", "")
    if raw.lower().startswith("tma "):
        return raw[4:].strip()
    return headers.get("X-Telegram-Init-Data", "").strip()
