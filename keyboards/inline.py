"""Inline klaviaturalar. callback_data ichida ':' ajratuvchi sifatida ishlatiladi."""

from collections.abc import Sequence

import aiosqlite
from aiogram.types import InlineKeyboardButton, InlineKeyboardMarkup, WebAppInfo
from aiogram.utils.keyboard import InlineKeyboardBuilder

from config import config
from services import orders
from utils.helpers import encode_time, fmt_price, short_date_label
from utils.texts import BTN_OPEN_APP

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


def delivery_method_kb(city: str = "Toshkent") -> InlineKeyboardMarkup:
    kb = InlineKeyboardBuilder()
    kb.button(
        text=f"🚖 Kuryer — {city} shahar ichida",
        callback_data="dlv:courier",
    )
    kb.button(
        text="📦 BTS Pochta — butun O'zbekiston",
        callback_data="dlv:bts",
    )
    kb.button(text="❌ Bekor qilish", callback_data="order:cancel")
    kb.adjust(1)
    return kb.as_markup()


def payment_method_kb(is_courier: bool = True) -> InlineKeyboardMarkup:
    kb = InlineKeyboardBuilder()
    kb.button(text="💳 Karta orqali o'tkazma", callback_data="pay:card")
    kb.button(text="📱 Ilova orqali (Payme/Click)", callback_data="pay:app")
    if is_courier:
        kb.button(text="💵 Naqd pul (yetkazilganda)", callback_data="pay:cash")
    kb.button(text="❌ Bekor qilish", callback_data="order:cancel")
    kb.adjust(1)
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
    kb.button(text="🗂 Katalogni boshqarish", callback_data="adm:catalog")
    kb.button(text="📊 Statistika", callback_data="adm:stats")
    kb.button(text="🗓 Navbatlar", callback_data="adm:bookings:today")
    kb.button(text="📦 Do'kon buyurtmalari", callback_data="adm:orders:new")
    kb.button(text="📣 Xabar yuborish", callback_data="adm:broadcast")
    kb.button(text="👑 Adminlar", callback_data="adm:admins")
    kb.adjust(1, 1, 2, 1, 1, 1)
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


def admin_booking_actions_kb(
    booking_id: int, date_iso: str, status: str = "new"
) -> InlineKeyboardMarkup:
    kb = InlineKeyboardBuilder()
    count = _status_buttons(kb, "adm:bkst", "booking", booking_id, status)
    kb.button(text="⬅️ Orqaga", callback_data=f"adm:bookings:{date_iso}")
    kb.adjust(*([2] * (count // 2) + [1] * (count % 2) + [1]))
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
    count = _status_buttons(kb, "adm:ordst", "order", order_id, status)
    kb.button(text="⬅️ Buyurtmalar", callback_data=f"adm:orders:{status}")
    kb.adjust(*([2] * (count // 2) + [1] * (count % 2) + [1]))
    return kb.as_markup()






def admin_new_booking_kb(booking_id: int) -> InlineKeyboardMarkup:
    kb = InlineKeyboardBuilder()
    _status_buttons(kb, "adm:bkst", "booking", booking_id, "new")
    kb.adjust(2)
    return kb.as_markup()


def admin_new_order_kb(order_id: int) -> InlineKeyboardMarkup:
    kb = InlineKeyboardBuilder()
    _status_buttons(kb, "adm:ordst", "order", order_id, "new")
    kb.adjust(2)
    return kb.as_markup()



# ------------------------------------------------------------------- Mini App


def open_app_kb(text: str = BTN_OPEN_APP) -> InlineKeyboardMarkup:
    """Mini App'ni ochadigan inline tugma.

    Ilovani ochishning eng ishonchli yo'li: inline `web_app` tugmasi.
    Ko'k «Open» menyu tugmasi bilan bir xil ishlaydi — `initData` imzosi
    to'liq keladi, shuning uchun foydalanuvchi ID'si har doim taniladi.
    """
    kb = InlineKeyboardBuilder()
    kb.button(text=text, web_app=WebAppInfo(url=config.mini_app_url))
    return kb.as_markup()



# ------------------------------------------------------- Bi-LED buyurtmalari


def _status_buttons(kb: InlineKeyboardBuilder, prefix: str, kind: str, row_id: int, status: str):
    """Faqat RUXSAT ETILGAN holat tugmalarini qo'shadi.

    Ya'ni bekor qilingan buyurtmada «Qabul» tugmasi umuman chiqmaydi —
    bosib bo'lmaydigan tugma ko'rsatmaymiz.
    """
    targets = orders.allowed_targets(kind, status)
    flow = orders.flow(kind)
    for target in targets:
        kb.button(
            text=flow.buttons.get(target, flow.labels.get(target, target)),
            callback_data=f"{prefix}:{row_id}:{target}",
        )
    return len(targets)


def admin_new_biled_kb(order_id: int) -> InlineKeyboardMarkup:
    kb = InlineKeyboardBuilder()
    _status_buttons(kb, "adm:bilst", "biled", order_id, "new")
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
    count = _status_buttons(kb, "adm:bilst", "biled", order_id, status)
    kb.button(text="⬅️ Ro'yxat", callback_data=f"adm:bileds:{status}")
    kb.adjust(*([2] * (count // 2) + [1] * (count % 2) + [1]))
    return kb.as_markup()
