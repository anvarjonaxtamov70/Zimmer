"""Vaqt, narx va navbat slotlari bilan ishlash uchun yordamchilar."""

from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from config import config
from utils.texts import MONTHS, WEEKDAYS

TZ = ZoneInfo(config.timezone)


def now() -> datetime:
    return datetime.now(TZ)


def today_iso() -> str:
    return now().strftime("%Y-%m-%d")


def fmt_price(value: int | float) -> str:
    """120000 -> '120 000 so'm'"""
    return f"{int(value):,}".replace(",", " ") + f" {config.currency}"


def date_label(date_iso: str) -> str:
    """'2026-08-12' -> '12-avgust, Chorshanba'"""
    dt = datetime.strptime(date_iso, "%Y-%m-%d")
    return f"{dt.day}-{MONTHS[dt.month - 1]}, {WEEKDAYS[dt.weekday()]}"


def short_date_label(date_iso: str) -> str:
    """Tugma uchun qisqa ko'rinish: 'Bugun', 'Ertaga' yoki '12-avg (Chor)'."""
    dt = datetime.strptime(date_iso, "%Y-%m-%d").date()
    today = now().date()
    if dt == today:
        return "Bugun"
    if dt == today + timedelta(days=1):
        return "Ertaga"
    return f"{dt.day}-{MONTHS[dt.month - 1][:3]} ({WEEKDAYS[dt.weekday()][:3]})"


def available_dates() -> list[str]:
    """Navbat olish mumkin bo'lgan kunlar ro'yxati (ISO formatda)."""
    start = now().date()
    return [
        (start + timedelta(days=i)).strftime("%Y-%m-%d")
        for i in range(config.booking_days_ahead)
    ]


def encode_time(time_str: str) -> str:
    """'09:30' -> '09-30' (callback_data ichida ':' ishlatmaslik uchun)."""
    return time_str.replace(":", "-")


def decode_time(encoded: str) -> str:
    """'09-30' -> '09:30'"""
    return encoded.replace("-", ":")


def _to_minutes(time_str: str) -> int:
    hour, minute = time_str.split(":")
    return int(hour) * 60 + int(minute)


def _to_time(minutes: int) -> str:
    return f"{minutes // 60:02d}:{minutes % 60:02d}"


def free_slots(
    date_iso: str,
    duration_min: int,
    taken: list[tuple[str, int]],
) -> list[str]:
    """Bo'sh vaqtlarni hisoblaydi.

    date_iso  -- kun (YYYY-MM-DD)
    duration_min -- tanlangan xizmat davomiyligi
    taken -- band vaqtlar: [(boshlanish 'HH:MM', davomiylik minut), ...]
    """
    work_start = config.work_start_hour * 60
    work_end = config.work_end_hour * 60
    step = max(config.slot_minutes, 5)
    duration = max(duration_min, step)

    busy = [(_to_minutes(t), _to_minutes(t) + max(d, step)) for t, d in taken]

    min_start = work_start
    if date_iso == today_iso():
        current = now()
        # bugungi kun uchun: hozirgi vaqtdan kamida 30 daqiqa keyin
        lead = current.hour * 60 + current.minute + 30
        rounded = ((lead + step - 1) // step) * step
        min_start = max(min_start, rounded)

    slots: list[str] = []
    start = work_start
    while start + duration <= work_end:
        if start >= min_start:
            overlaps = any(start < b_end and b_start < start + duration for b_start, b_end in busy)
            if not overlaps:
                slots.append(_to_time(start))
        start += step
    return slots


def user_link(full_name: str, username: str | None, user_id: int) -> str:
    if username:
        return f"{full_name} (@{username})"
    return f'<a href="tg://user?id={user_id}">{full_name}</a>'


def normalize_phone(raw: str) -> str | None:
    """Foydalanuvchi kiritgan raqamni tekshiradi va tozalaydi."""
    digits = "".join(ch for ch in raw if ch.isdigit())
    if len(digits) == 9:
        digits = "998" + digits
    elif len(digits) == 12 and digits.startswith("998"):
        pass
    elif len(digits) == 13 and digits.startswith("0998"):
        digits = digits[1:]
    else:
        return None
    return "+" + digits
