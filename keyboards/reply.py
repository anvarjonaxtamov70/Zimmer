from aiogram.types import (
    KeyboardButton,
    ReplyKeyboardMarkup,
    ReplyKeyboardRemove,
    WebAppInfo,
)

from config import config, is_admin
from utils.texts import (
    BTN_ADMIN,
    BTN_APP,
    BTN_CANCEL,
    BTN_CONTACT,
    BTN_PHONE,
)

remove_kb = ReplyKeyboardRemove()


def main_menu(user_id: int) -> ReplyKeyboardMarkup:
    """Asosiy menyu: bosh vazifa — foydalanuvchini Mini App'ga yo'naltirish."""
    rows: list[list[KeyboardButton]] = []
    if config.has_mini_app:
        rows.append(
            [KeyboardButton(text=BTN_APP, web_app=WebAppInfo(url=config.mini_app_url))]
        )
    rows.append([KeyboardButton(text=BTN_CONTACT)])
    if is_admin(user_id):
        rows.append([KeyboardButton(text=BTN_ADMIN)])
    return ReplyKeyboardMarkup(keyboard=rows, resize_keyboard=True)


def phone_kb() -> ReplyKeyboardMarkup:
    return ReplyKeyboardMarkup(
        keyboard=[[KeyboardButton(text=BTN_PHONE, request_contact=True)]],
        resize_keyboard=True,
        one_time_keyboard=True,
    )


def cancel_kb() -> ReplyKeyboardMarkup:
    return ReplyKeyboardMarkup(
        keyboard=[[KeyboardButton(text=BTN_CANCEL)]], resize_keyboard=True
    )
