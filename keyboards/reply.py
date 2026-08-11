from aiogram.types import KeyboardButton, ReplyKeyboardMarkup, ReplyKeyboardRemove

from config import is_admin
from utils.texts import (
    BTN_ADMIN,
    BTN_CANCEL,
    BTN_CART,
    BTN_CONTACT,
    BTN_MY_QUEUE,
    BTN_ORDERS,
    BTN_PHONE,
    BTN_QUEUE,
    BTN_SHOP,
)

remove_kb = ReplyKeyboardRemove()


def main_menu(user_id: int) -> ReplyKeyboardMarkup:
    rows = [
        [KeyboardButton(text=BTN_QUEUE), KeyboardButton(text=BTN_SHOP)],
        [KeyboardButton(text=BTN_MY_QUEUE), KeyboardButton(text=BTN_CART)],
        [KeyboardButton(text=BTN_ORDERS), KeyboardButton(text=BTN_CONTACT)],
    ]
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
