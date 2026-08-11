"""Inline klaviaturalar. callback_data ichida ':' ajratuvchi sifatida ishlatiladi."""

from collections.abc import Sequence

import aiosqlite
from aiogram.types import InlineKeyboardButton, InlineKeyboardMarkup, WebAppInfo
from aiogram.utils.keyboard import InlineKeyboardBuilder

from config import config
from utils.helpers import encode_time, fmt_price, short_date_label

# ------------------------------------------------------------------- navbat


def services_kb(services: Sequence[aiosqlite.Row]) -> InlineKeyboardMarkup:
    kb = InlineKeyboardBuilder()
    for svc in services:
        kb.button(
            text=f"{svc['name']} · {fmt_price(svc['price'])}",
            callback_data=f"svc:{svc['id']}",
        )
    kb.adjust(1)
    return kb.as_markup()


def dates_kb(service_id: int, dates: Sequence[str]) -> InlineKeyboardMarkup:
    kb = InlineKeyboardBuilder()
    for date_iso in dates:
        kb.button(text=short_date_label(date_iso), callback_data=f"dt:{service_id}:{date_iso}")
    kb.adjust(2)
    kb.row(InlineKeyboardButton(text="⬅️ Xizmatlar", callback_data="back:svc"))
    return kb.as_markup()


def times_kb(service_id: int, date_iso: str, slots: Sequence[str]) -> InlineKeyboardMarkup:
    kb = InlineKeyboardBuilder()
    for slot in slots:
        kb.button(
            text=slot,
            callback_data=f"tm:{service_id}:{date_iso}:{encode_time(slot)}",
        )
    kb.adjust(3)
    kb.row(InlineKeyboardButton(text="⬅️ Kunlar", callback_data=f"back:dates:{service_id}"))
    return kb.as_markup()


def booking_confirm_kb(service_id: int, date_iso: str, time_str: str) -> InlineKeyboardMarkup:
    kb = InlineKeyboardBuilder()
    kb.button(
        text="✅ Tasdiqlash",
        callback_data=f"bkok:{service_id}:{date_iso}:{encode_time(time_str)}",
    )
    kb.button(text="⬅️ Vaqtni o'zgartirish", callback_data=f"back:times:{service_id}:{date_iso}")
    kb.adjust(1)
    return kb.as_markup()


def my_bookings_kb(bookings: Sequence[aiosqlite.Row]) -> InlineKeyboardMarkup:
    kb = InlineKeyboardBuilder()
    for bk in bookings:
        kb.button(
            text=f"❌ Bekor qilish · {short_date_label(bk['date'])} {bk['time']}",
            callback_data=f"bkcancel:{bk['id']}",
        )
    kb.adjust(1)
    return kb.as_markup()


# -------------------------------------------------------------------- do'kon


def categories_kb(categories: Sequence[aiosqlite.Row]) -> InlineKeyboardMarkup:
    kb = InlineKeyboardBuilder()
    for cat in categories:
        kb.button(text=f"🗂 {cat['name']}", callback_data=f"cat:{cat['id']}")
    kb.adjust(1)
    kb.row(InlineKeyboardButton(text="🧺 Savatcha", callback_data="cart:show"))
    return kb.as_markup()


def products_kb(products: Sequence[aiosqlite.Row]) -> InlineKeyboardMarkup:
    kb = InlineKeyboardBuilder()
    for prod in products:
        kb.button(
            text=f"{prod['name']} · {fmt_price(prod['price'])}",
            callback_data=f"prod:{prod['id']}",
        )
    kb.adjust(1)
    kb.row(InlineKeyboardButton(text="⬅️ Kategoriyalar", callback_data="back:cats"))
    kb.row(InlineKeyboardButton(text="🧺 Savatcha", callback_data="cart:show"))
    return kb.as_markup()


def product_kb(product_id: int, category_id: int, in_stock: bool) -> InlineKeyboardMarkup:
    kb = InlineKeyboardBuilder()
    if in_stock:
        kb.button(text="➕ Savatchaga qo'shish", callback_data=f"add:{product_id}")
    kb.button(text="🧺 Savatcha", callback_data="cart:show")
    kb.button(text="⬅️ Orqaga", callback_data=f"back:prods:{category_id}")
    kb.adjust(1)
    return kb.as_markup()


def cart_kb(items: Sequence[aiosqlite.Row]) -> InlineKeyboardMarkup:
    kb = InlineKeyboardBuilder()
    for item in items:
        pid = item["product_id"]
        kb.row(
            InlineKeyboardButton(text="➖", callback_data=f"cart:minus:{pid}"),
            InlineKeyboardButton(text=f"{item['name']} ({item['qty']})", callback_data="noop"),
            InlineKeyboardButton(text="➕", callback_data=f"cart:plus:{pid}"),
            InlineKeyboardButton(text="🗑", callback_data=f"cart:del:{pid}"),
        )
    if items:
        kb.row(InlineKeyboardButton(text="✅ Buyurtma berish", callback_data="cart:checkout"))
        kb.row(InlineKeyboardButton(text="🧹 Savatchani bo'shatish", callback_data="cart:clear"))
    kb.row(InlineKeyboardButton(text="🛍 Do'konga qaytish", callback_data="back:cats"))
    return kb.as_markup()


def checkout_confirm_kb() -> InlineKeyboardMarkup:
    kb = InlineKeyboardBuilder()
    kb.button(text="✅ Buyurtmani tasdiqlash", callback_data="order:confirm")
    kb.button(text="❌ Bekor qilish", callback_data="order:cancel")
    kb.adjust(1)
    return kb.as_markup()


# --------------------------------------------------------------------- admin


def admin_menu_kb() -> InlineKeyboardMarkup:
    kb = InlineKeyboardBuilder()
    kb.button(text="🔥 Bi-LED buyurtmalar", callback_data="adm:bileds:new")
    kb.button(text="📊 Statistika", callback_data="adm:stats")
    kb.button(text="🗓 Navbatlar", callback_data="adm:bookings:today")
    kb.button(text="📦 Do'kon buyurtmalari", callback_data="adm:orders:new")
    kb.button(text="🛠 Xizmatlar", callback_data="adm:services")
    kb.button(text="🗂 Kategoriya qo'shish", callback_data="adm:addcat")
    kb.button(text="🛍 Mahsulot qo'shish", callback_data="adm:addprod")
    kb.button(text="📣 Xabar yuborish", callback_data="adm:broadcast")
    kb.adjust(1, 1, 2, 2, 1, 1)
    return kb.as_markup()


def admin_back_kb() -> InlineKeyboardMarkup:
    kb = InlineKeyboardBuilder()
    kb.button(text="⬅️ Admin menyu", callback_data="adm:menu")
    return kb.as_markup()


def admin_bookings_kb(
    date_iso: str, bookings: Sequence[aiosqlite.Row], dates: Sequence[str]
) -> InlineKeyboardMarkup:
    kb = InlineKeyboardBuilder()
    for bk in bookings:
        kb.button(
            text=f"{bk['time']} · {bk['full_name']}",
            callback_data=f"adm:bk:{bk['id']}",
        )
    kb.adjust(1)
    day_row = [
        InlineKeyboardButton(
            text=("• " + short_date_label(d) if d == date_iso else short_date_label(d)),
            callback_data=f"adm:bookings:{d}",
        )
        for d in dates[:4]
    ]
    kb.row(*day_row)
    kb.row(InlineKeyboardButton(text="⬅️ Admin menyu", callback_data="adm:menu"))
    return kb.as_markup()


def admin_booking_actions_kb(booking_id: int, date_iso: str) -> InlineKeyboardMarkup:
    kb = InlineKeyboardBuilder()
    kb.button(text="✅ Tasdiqlash", callback_data=f"adm:bkst:{booking_id}:confirmed")
    kb.button(text="✔️ Bajarildi", callback_data=f"adm:bkst:{booking_id}:done")
    kb.button(text="❌ Bekor qilish", callback_data=f"adm:bkst:{booking_id}:cancelled")
    kb.button(text="⬅️ Orqaga", callback_data=f"adm:bookings:{date_iso}")
    kb.adjust(2, 1, 1)
    return kb.as_markup()


def admin_orders_kb(orders: Sequence[aiosqlite.Row], status: str) -> InlineKeyboardMarkup:
    kb = InlineKeyboardBuilder()
    for order in orders:
        kb.button(
            text=f"#{order['id']} · {order['full_name']} · {fmt_price(order['total'])}",
            callback_data=f"adm:ord:{order['id']}",
        )
    kb.adjust(1)
    filters = [
        ("🆕 Yangi", "new"),
        ("✅ Qabul", "accepted"),
        ("🚚 Yetkazilgan", "delivered"),
        ("📋 Hammasi", "all"),
    ]
    kb.row(
        *[
            InlineKeyboardButton(
                text=("• " + label if key == status else label),
                callback_data=f"adm:orders:{key}",
            )
            for label, key in filters
        ]
    )
    kb.row(InlineKeyboardButton(text="⬅️ Admin menyu", callback_data="adm:menu"))
    return kb.as_markup()


def admin_order_actions_kb(order_id: int, status: str) -> InlineKeyboardMarkup:
    kb = InlineKeyboardBuilder()
    kb.button(text="✅ Qabul qilish", callback_data=f"adm:ordst:{order_id}:accepted")
    kb.button(text="🚚 Yetkazildi", callback_data=f"adm:ordst:{order_id}:delivered")
    kb.button(text="❌ Bekor qilish", callback_data=f"adm:ordst:{order_id}:cancelled")
    kb.button(text="⬅️ Buyurtmalar", callback_data=f"adm:orders:{status}")
    kb.adjust(2, 1, 1)
    return kb.as_markup()


def admin_services_kb(services: Sequence[aiosqlite.Row]) -> InlineKeyboardMarkup:
    kb = InlineKeyboardBuilder()
    for svc in services:
        mark = "🟢" if svc["is_active"] else "🔴"
        kb.button(
            text=f"{mark} {svc['name']} · {fmt_price(svc['price'])}",
            callback_data=f"adm:svctoggle:{svc['id']}",
        )
    kb.adjust(1)
    kb.row(InlineKeyboardButton(text="➕ Xizmat qo'shish", callback_data="adm:addsvc"))
    kb.row(InlineKeyboardButton(text="⬅️ Admin menyu", callback_data="adm:menu"))
    return kb.as_markup()


def admin_pick_category_kb(categories: Sequence[aiosqlite.Row]) -> InlineKeyboardMarkup:
    kb = InlineKeyboardBuilder()
    for cat in categories:
        kb.button(text=cat["name"], callback_data=f"adm:pickcat:{cat['id']}")
    kb.adjust(1)
    kb.row(InlineKeyboardButton(text="⬅️ Admin menyu", callback_data="adm:menu"))
    return kb.as_markup()


def admin_new_booking_kb(booking_id: int) -> InlineKeyboardMarkup:
    kb = InlineKeyboardBuilder()
    kb.button(text="✅ Tasdiqlash", callback_data=f"adm:bkst:{booking_id}:confirmed")
    kb.button(text="❌ Bekor qilish", callback_data=f"adm:bkst:{booking_id}:cancelled")
    kb.adjust(2)
    return kb.as_markup()


def admin_new_order_kb(order_id: int) -> InlineKeyboardMarkup:
    kb = InlineKeyboardBuilder()
    kb.button(text="✅ Qabul qilish", callback_data=f"adm:ordst:{order_id}:accepted")
    kb.button(text="❌ Bekor qilish", callback_data=f"adm:ordst:{order_id}:cancelled")
    kb.adjust(2)
    return kb.as_markup()



# ------------------------------------------------------------------- Mini App


def open_app_kb(text: str = "🚀 Ilovani ochish") -> InlineKeyboardMarkup:
    """Mini App'ni ochadigan inline tugma."""
    kb = InlineKeyboardBuilder()
    kb.button(text=text, web_app=WebAppInfo(url=config.mini_app_url))
    return kb.as_markup()



# ------------------------------------------------------- Bi-LED buyurtmalari


def admin_new_biled_kb(order_id: int) -> InlineKeyboardMarkup:
    kb = InlineKeyboardBuilder()
    kb.button(text="✅ Qabul qilish", callback_data=f"adm:bilst:{order_id}:accepted")
    kb.button(text="🔧 Ishga olish", callback_data=f"adm:bilst:{order_id}:in_work")
    kb.button(text="❌ Bekor qilish", callback_data=f"adm:bilst:{order_id}:cancelled")
    kb.adjust(2, 1)
    return kb.as_markup()


def admin_biled_orders_kb(
    orders: Sequence[aiosqlite.Row], status: str
) -> InlineKeyboardMarkup:
    kb = InlineKeyboardBuilder()
    for order in orders:
        kb.button(
            text=f"#{order['id']} · {order['car_name']} · {fmt_price(order['total'])}",
            callback_data=f"adm:bil:{order['id']}",
        )
    kb.adjust(1)
    filters = [
        ("🆕 Yangi", "new"),
        ("🔧 Ishda", "in_work"),
        ("✨ Topshirilgan", "done"),
        ("📋 Hammasi", "all"),
    ]
    kb.row(
        *[
            InlineKeyboardButton(
                text=("• " + label if key == status else label),
                callback_data=f"adm:bileds:{key}",
            )
            for label, key in filters
        ]
    )
    kb.row(InlineKeyboardButton(text="⬅️ Admin menyu", callback_data="adm:menu"))
    return kb.as_markup()


def admin_biled_actions_kb(order_id: int, status: str) -> InlineKeyboardMarkup:
    kb = InlineKeyboardBuilder()
    kb.button(text="✅ Qabul", callback_data=f"adm:bilst:{order_id}:accepted")
    kb.button(text="🔧 Ishda", callback_data=f"adm:bilst:{order_id}:in_work")
    kb.button(text="✨ Topshirildi", callback_data=f"adm:bilst:{order_id}:done")
    kb.button(text="❌ Bekor", callback_data=f"adm:bilst:{order_id}:cancelled")
    kb.button(text="⬅️ Ro'yxat", callback_data=f"adm:bileds:{status}")
    kb.adjust(2, 2, 1)
    return kb.as_markup()
