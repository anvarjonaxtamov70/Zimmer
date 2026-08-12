"""Loyiha sozlamalari (.env faylidan o'qiladi)."""

import logging
import os
import re
from collections.abc import Iterable
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent
load_dotenv(BASE_DIR / ".env")

logger = logging.getLogger(__name__)


# =====================================================================
#  ADMINLAR — "hech qachon yoddan chiqmaydigan" ro'yxat
#
#  Avto_A1 loyihasidagi adminlar Zimmer uchun ham ASOSIY adminlar.
#  Bu ro'yxat KOD ichida turadi, shuning uchun:
#    • Render'da ADMINS o'zgaruvchisi o'chib ketsa ham,
#    • baza (SQLite) tozalansa ham,
#    • Firebase ulanmasa ham
#  shu ID'lar HAR DOIM admin bo'lib qoladi. Ularni o'chirishning
#  yagona yo'li — shu qatorni tahrirlash.
# =====================================================================
CORE_ADMINS: tuple[int, ...] = (5105291033, 483425630, 5302078)

# Eski kod bilan moslik uchun (matn ko'rinishi)
DEFAULT_ADMINS = ",".join(str(admin_id) for admin_id in CORE_ADMINS)

# Admin ID'lari o'qib olinadigan env o'zgaruvchilari (barchasi birlashtiriladi)
ADMIN_ENV_KEYS = ("ADMINS", "ADMINS_EXTRA", "ADMIN_IDS", "ADMIN_ID")

# Telegram foydalanuvchi ID'si kamida 5 xonali bo'ladi. Bu chegara
# "user123" kabi matnlardan tasodifan "123" ni admin qilib olmaslik uchun.
MIN_TELEGRAM_ID = 10_000

_NUMBER_RE = re.compile(r"-?\d+")


def parse_ids(raw: str | None) -> list[int]:
    """Matndan Telegram ID'larini ajratib oladi — ajratgich qanday bo'lsa ham.

    Quyidagilarning hammasi to'g'ri o'qiladi:
        "5105291033,483425630"        "5105291033, 483425630"
        "5105291033 483425630"        "5105291033;483425630"
        "[5105291033, 483425630]"     '"5105291033","483425630"'
        "ID: 5105291033\\n483425630"   "@anvar 5105291033"

    Ilgari bu joyda faqat bo'sh joy olib tashlanib, vergul bilan bo'linardi.
    Shu sababli qatorning oxiridagi ko'rinmas belgi (\\r), yangi qator yoki
    qo'shtirnoq bo'lsa — admin ID'si JIMGINA tashlab ketilardi. Aynan shu
    "admin tanilmaydi" muammosining asosiy sababi edi.
    """
    if not raw:
        return []

    ids: list[int] = []
    skipped: list[str] = []
    for match in _NUMBER_RE.findall(raw):
        value = int(match)
        if abs(value) < MIN_TELEGRAM_ID:
            skipped.append(match)
            continue
        if value not in ids:
            ids.append(value)

    if skipped:
        logger.warning(
            "Admin ro'yxatida ID'ga o'xshamagan son(lar) e'tiborsiz qoldirildi: %s",
            ", ".join(skipped),
        )
    return ids


def _parse_admins(raw: str) -> list[int]:
    """Eski nom — moslik uchun saqlangan."""
    return parse_ids(raw)


def _admins_from_env() -> list[int]:
    """Asosiy adminlar + env'dagi barcha adminlar (birlashtirib).

    MUHIM: asosiy (CORE_ADMINS) ro'yxat HAR DOIM qo'shiladi. Ilgari
    ADMINS berilgan bo'lsa asosiy ro'yxat butunlay tashlab ketilardi —
    natijada ADMINS'da bitta ID xato yozilsa, qolgan adminlar ham
    panelni ocholmay qolardi.
    """
    admins: list[int] = list(CORE_ADMINS)
    for key in ADMIN_ENV_KEYS:
        for admin_id in parse_ids(os.getenv(key)):
            if admin_id not in admins:
                admins.append(admin_id)
    return admins


def _int_env(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, default))
    except (TypeError, ValueError):
        return default


@dataclass(frozen=True)
class Config:
    bot_token: str
    admins: list[int]
    shop_name: str
    db_path: str
    timezone: str
    work_start_hour: int
    work_end_hour: int
    slot_minutes: int
    booking_days_ahead: int
    currency: str
    mini_app_url: str
    firebase_db_url: str
    firebase_root: str
    service_account_file: str
    init_data_max_age_hours: int

    @property
    def has_mini_app(self) -> bool:
        return self.mini_app_url.startswith("https://")

    @property
    def has_firebase(self) -> bool:
        return bool(self.firebase_db_url)

    @property
    def init_data_max_age(self) -> int:
        """Mini App `initData` qancha soniya amal qiladi (0 — cheklamasdan)."""
        return max(0, self.init_data_max_age_hours) * 3600


def _db_path() -> str:
    raw = os.getenv("DB_PATH", "zimmer.db")
    path = Path(raw)
    if not path.is_absolute():
        path = BASE_DIR / path
    return str(path)


config = Config(
    bot_token=os.getenv("BOT_TOKEN", "").strip(),
    admins=_admins_from_env(),
    shop_name=os.getenv("SHOP_NAME", "Zimmer").strip(),
    db_path=_db_path(),
    timezone=os.getenv("TIMEZONE", "Asia/Tashkent").strip(),
    work_start_hour=_int_env("WORK_START_HOUR", 9),
    work_end_hour=_int_env("WORK_END_HOUR", 18),
    slot_minutes=_int_env("SLOT_MINUTES", 30),
    booking_days_ahead=_int_env("BOOKING_DAYS_AHEAD", 7),
    currency=os.getenv("CURRENCY", "so'm").strip(),
    mini_app_url=os.getenv(
        "MINI_APP_URL", "https://anvarjonaxtamov70.github.io/Zimmer/"
    ).strip(),
    # Firebase Realtime Database — mijozlar va tovarlarni doimiy saqlash uchun
    firebase_db_url=os.getenv("FIREBASE_DB_URL", "").strip().rstrip("/"),
    firebase_root=os.getenv("FIREBASE_ROOT", "zimmer").strip(),
    service_account_file=os.getenv(
        "SERVICE_ACCOUNT_FILE", str(BASE_DIR / "serviceAccount.json")
    ).strip(),
    # Mini App imzosi (initData) necha soat amal qiladi. Standart 7 kun:
    # Telegram ilova sahifasini keshlaydi va eski imzoni yuboradi, 24 soat
    # kam edi — mijoz "tasdiqlanmadi" ekranida qolib ketardi. 0 — cheksiz.
    init_data_max_age_hours=_int_env("INIT_DATA_MAX_AGE_HOURS", 24 * 7),
)


# =====================================================================
#  ADMIN REGISTRI (jonli)
#
#  `config.admins` — kod + env'dan olingan o'zgarmas ro'yxat.
#  `_runtime_admins` — bot ishlab turganda qo'shilgan adminlar; ular
#  bazada (admins jadvali) va Firebase'da saqlanadi, shuning uchun
#  qayta ishga tushgandan keyin ham yo'qolmaydi.
#
#  Tekshirish HAR SAFAR shu registrdan o'qiladi. Ilgari aiogram filtri
#  `F.from_user.id.in_(config.admins)` ko'rinishida import paytida
#  "muzlatilgan" ro'yxatga bog'lanib qolar edi — yangi admin qo'shish
#  uchun butun xizmatni qayta ishga tushirish kerak bo'lardi.
# =====================================================================
_runtime_admins: list[int] = []
_admin_index: set[int] = set(config.admins)


def _rebuild_index() -> None:
    _admin_index.clear()
    _admin_index.update(config.admins)
    _admin_index.update(_runtime_admins)


def all_admins() -> list[int]:
    """Barcha adminlar: asosiy + env + ishlash vaqtida qo'shilganlar."""
    admins = list(config.admins)
    admins.extend(admin_id for admin_id in _runtime_admins if admin_id not in admins)
    return admins


def is_admin(user_id: int | None) -> bool:
    return user_id is not None and user_id in _admin_index


def is_core_admin(user_id: int) -> bool:
    """Kodda yozilgan (o'chirilmaydigan) adminmi?"""
    return user_id in CORE_ADMINS


def is_env_admin(user_id: int) -> bool:
    """Env yoki kod orqali berilgan adminmi (bot ichidan o'chirilmaydi)?"""
    return user_id in config.admins


def admin_source(user_id: int) -> str:
    """"core" | "env" | "runtime" | "" — admin qayerdan kelgani."""
    if user_id in CORE_ADMINS:
        return "core"
    if user_id in config.admins:
        return "env"
    if user_id in _runtime_admins:
        return "runtime"
    return ""


def set_runtime_admins(user_ids: Iterable[int]) -> list[int]:
    """Bazadan/Firebase'dan yuklangan adminlar ro'yxatini o'rnatadi."""
    _runtime_admins.clear()
    for user_id in user_ids:
        try:
            value = int(user_id)
        except (TypeError, ValueError):
            continue
        if value in config.admins or value in _runtime_admins:
            continue
        _runtime_admins.append(value)
    _rebuild_index()
    return list(_runtime_admins)


def add_runtime_admin(user_id: int) -> bool:
    """Yangi admin qo'shadi. False — allaqachon admin bo'lsa."""
    if is_admin(user_id):
        return False
    _runtime_admins.append(int(user_id))
    _rebuild_index()
    return True


def remove_runtime_admin(user_id: int) -> bool:
    """Adminni olib tashlaydi. Asosiy/env adminlarni o'chirib bo'lmaydi."""
    if user_id in _runtime_admins:
        _runtime_admins.remove(user_id)
        _rebuild_index()
        return True
    return False
