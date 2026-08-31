"""Vaqt, narx va navbat slotlari bilan ishlash uchun yordamchilar."""

from datetime import UTC, datetime, timedelta
from zoneinfo import ZoneInfo

from config import config
from utils.texts import MONTHS, WEEKDAYS

TZ = ZoneInfo(config.timezone)


def now() -> datetime:
    return datetime.now(TZ)


# Statistika davrlari (admin panelda tanlanadi)
PERIODS = (
    ("today", "Bugun"),
    ("week", "7 kun"),
    ("month", "30 kun"),
    ("all", "Hammasi"),
)


def period_start(period: str) -> str | None:
    """Davr boshlanishini UTC matn ko'rinishida qaytaradi.

    Baza `created_at` ni UTC da saqlaydi (`datetime('now')`), do'kon esa
    Toshkent vaqtida yashaydi. Shuning uchun chegara mahalliy vaqtda
    hisoblanib, so'ng UTC ga o'giriladi — «bugun» haqiqatan bugun bo'ladi.

    "all" yoki notanish davr uchun None (cheklamasdan).
    """
    days = {"today": 0, "week": 6, "month": 29}.get(period)
    if days is None:
        return None
    start = (now() - timedelta(days=days)).replace(hour=0, minute=0, second=0, microsecond=0)
    return start.astimezone(UTC).strftime("%Y-%m-%d %H:%M:%S")


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


# =====================================================================
#  HTML XAVFSIZLIGI
#
#  Bot barcha xabarlarni `parse_mode=HTML` bilan yuboradi. Mijoz kiritgan
#  matn (ism, manzil, izoh) xabarga TO'G'RIDAN qo'yilsa va ichida `<`
#  bo'lsa — Telegram butun xabarni RAD ETADI. Natijada:
#
#     • adminga «yangi buyurtma» xabari YETIB BORMAYDI;
#     • `notify_admins` xato ko'taradi va buyurtma jimgina yo'qoladi.
#
#  Frontend'da bu to'g'ri qilingan (`esc()` har joyda), backend'da esa
#  unutilgan edi. Shu funksiya orqali barcha mijoz matni tozalanadi.
# =====================================================================


def html_escape(value) -> str:
    """Mijoz matnini HTML xabarga qo'yish uchun xavfsiz qiladi."""
    if value is None:
        return ""
    return (
        str(value)
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
    )


def esc(value) -> str:
    """`html_escape` ning qisqa nomi (frontend'dagi `esc()` bilan bir xil)."""
    return html_escape(value)


def size_tag(item) -> str:
    """Buyurtma qatorining razmer yorlig'i: `" [H4]"` yoki bo'sh satr.

    NEGA ALOHIDA FUNKSIYA
    Razmerli tovarlar buyurtma qatorlari BEShTA joyda chiziladi (bot admin
    paneli, mijozning buyurtmalari, Mini App API, sinxron xabari). Har
    birida shartni qaytadan yozsak, bittasi qolib ketadi va admin aynan
    o'sha ekranda razmerni ko'rmay qoladi. Shu sababli yagona joyda.

    `item` — `aiosqlite.Row` yoki lug'at bo'lishi mumkin: ikkisi ham
    `item["size"]` ni qo'llaydi, lekin Row'da yo'q ustun IndexError beradi
    (lug'atda esa KeyError), shuning uchun ikkisini ham tutamiz.
    """
    try:
        value = item["size"]
    except (KeyError, IndexError, TypeError):
        return ""
    text = str(value).strip() if value else ""
    return f" <b>[{html_escape(text)}]</b>" if text else ""


def user_link(full_name: str, username: str | None, user_id: int) -> str:
    """Mijozga havola. Ism HTML uchun tozalanadi."""
    name = html_escape(full_name) or "Mijoz"
    if username:
        return f"{name} (@{html_escape(username)})"
    return f'<a href="tg://user?id={user_id}">{name}</a>'


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
