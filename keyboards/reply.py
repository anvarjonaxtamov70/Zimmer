from aiogram.types import (
    KeyboardButton,
    ReplyKeyboardMarkup,
    ReplyKeyboardRemove,
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
    """Asosiy menyu: bosh vazifa — foydalanuvchini Mini App'ga yo'naltirish.

    DIQQAT: «Do'konni ochish» tugmasi oddiy MATN tugmasi (web_app emas).
    Bosilganda bot chatga inline tugma yuboradi va ilova shundan ochiladi
    — bu ko'k «Open» tugmasi bilan bir xil, eng ishonchli yo'l.
    Klaviaturadagi web_app tugmasi ba'zi Telegram mijozlarida `initData`
    ni to'liq bermaydi, natijada «ma'lumotlar tasdiqlanmadi» xatosi
    chiqardi.
    """
    rows: list[list[KeyboardButton]] = []
    if config.has_mini_app:
        rows.append([KeyboardButton(text=BTN_APP)])
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
