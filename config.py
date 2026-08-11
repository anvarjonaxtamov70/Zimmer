"""Loyiha sozlamalari (.env faylidan o'qiladi)."""

import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent
load_dotenv(BASE_DIR / ".env")


def _parse_admins(raw: str) -> list[int]:
    admins: list[int] = []
    for part in raw.replace(" ", "").split(","):
        if part.lstrip("-").isdigit():
            admins.append(int(part))
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

    @property
    def has_mini_app(self) -> bool:
        return self.mini_app_url.startswith("https://")

    @property
    def has_firebase(self) -> bool:
        return bool(self.firebase_db_url)


def _db_path() -> str:
    raw = os.getenv("DB_PATH", "zimmer.db")
    path = Path(raw)
    if not path.is_absolute():
        path = BASE_DIR / path
    return str(path)


config = Config(
    bot_token=os.getenv("BOT_TOKEN", "").strip(),
    admins=_parse_admins(os.getenv("ADMINS", "")),
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
)


def is_admin(user_id: int) -> bool:
    return user_id in config.admins
