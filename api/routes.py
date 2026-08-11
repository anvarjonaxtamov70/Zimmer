"""Mini App uchun REST API.

Barcha so'rovlar `Authorization: tma <initData>` sarlavhasi bilan keladi —
foydalanuvchi kimligini Telegram imzosidan aniqlaymiz.
"""

import logging

from aiohttp import web

from api.auth import extract_init_data, validate_init_data
from api.errors import ApiError, bad_request, not_found, not_registered, unauthorized
from config import config
from database import queries as q
from keyboards.inline import admin_new_booking_kb, admin_new_order_kb
from utils.helpers import (
    available_dates,
    date_label,
    fmt_price,
    free_slots,
    normalize_phone,
    short_date_label,
    today_iso,
    user_link,
)
from utils.texts import BOOKING_STATUS, ORDER_STATUS
from utils.ui import notify_admins

logger = logging.getLogger(__name__)

routes = web.RouteTableDef()


# ------------------------------------------------------------------ yordamchilar


async def _current_user(request: web.Request, require_registration: bool = True):
    """initData'ni tekshiradi va (user_id, telegram_user, db_row) qaytaradi."""
    init_data = extract_init_data(request.headers)
    verified = validate_init_data(init_data, config.bot_token)
    if not verified:
        raise unauthorized()

    tg_user = verified["user"]
    user_id = int(tg_user["id"])
    row = await q.get_user(user_id)

    if require_registration and (row is None or not row["phone"]):
        raise not_registered()
    return user_id, tg_user, row


async def _json_body(request: web.Request) -> dict:
    try:
        body = await request.json()
    except Exception as error:
        raise bad_request("JSON formatida ma'lumot kutilgan") from error
    if not isinstance(body, dict):
        raise bad_request("JSON obyekt kutilgan")
    return body


async def _taken_slots(date_iso: str) -> list[tuple[str, int]]:
    rows = await q.get_day_bookings(date_iso)
    return [(row["time"], int(row["duration_min"])) for row in rows]


def _booking_json(row) -> dict:
    return {
        "id": row["id"],
        "service_name": row["service_name"],
        "date": row["date"],
        "date_label": date_label(row["date"]),
        "time": row["time"],
        "price": int(row["price"]),
        "price_label": fmt_price(row["price"]),
        "status": row["status"],
        "status_label": BOOKING_STATUS.get(row["status"], row["status"]),
        "is_past": row["date"] < today_iso(),
        "can_cancel": row["status"] in ("new", "confirmed") and row["date"] >= today_iso(),
    }


# ------------------------------------------------------------------- umumiy


@routes.get("/api/config")
async def api_config(_request: web.Request) -> web.Response:
    return web.json_response(
        {
            "shop_name": config.shop_name,
            "currency": config.currency,
            "work_start_hour": config.work_start_hour,
            "work_end_hour": config.work_end_hour,
            "slot_minutes": config.slot_minutes,
            "booking_days_ahead": config.booking_days_ahead,
        }
    )


@routes.get("/api/me")
async def api_me(request: web.Request) -> web.Response:
    user_id, tg_user, row = await _current_user(request, require_registration=False)
    registered = row is not None and bool(row["phone"])
    return web.json_response(
        {
            "registered": registered,
            "user_id": user_id,
            "first_name": tg_user.get("first_name"),
            "full_name": row["full_name"] if row else tg_user.get("first_name"),
            "phone": row["phone"] if row else None,
        }
    )


# -------------------------------------------------------------------- navbat


@routes.get("/api/services")
async def api_services(request: web.Request) -> web.Response:
    await _current_user(request)
    services = await q.get_services()
    return web.json_response(
        [
            {
                "id": svc["id"],
                "name": svc["name"],
                "duration_min": int(svc["duration_min"]),
                "price": int(svc["price"]),
                "price_label": fmt_price(svc["price"]),
            }
            for svc in services
        ]
    )


@routes.get("/api/dates")
async def api_dates(request: web.Request) -> web.Response:
    await _current_user(request)
    try:
        service_id = int(request.query.get("service_id", ""))
    except ValueError as error:
        raise bad_request("service_id ko'rsatilmagan") from error

    service = await q.get_service(service_id)
    if not service:
        raise not_found("Xizmat topilmadi")

    result = []
    for date_iso in available_dates():
        slots = free_slots(
            date_iso, int(service["duration_min"]), await _taken_slots(date_iso)
        )
        result.append(
            {
                "date": date_iso,
                "label": date_label(date_iso),
                "short_label": short_date_label(date_iso),
                "free_count": len(slots),
            }
        )
    return web.json_response(result)


@routes.get("/api/slots")
async def api_slots(request: web.Request) -> web.Response:
    await _current_user(request)
    try:
        service_id = int(request.query.get("service_id", ""))
    except ValueError as error:
        raise bad_request("service_id ko'rsatilmagan") from error
    date_iso = request.query.get("date", "")
    if date_iso not in available_dates():
        raise bad_request("Sana noto'g'ri yoki juda uzoq")

    service = await q.get_service(service_id)
    if not service:
        raise not_found("Xizmat topilmadi")

    slots = free_slots(date_iso, int(service["duration_min"]), await _taken_slots(date_iso))
    return web.json_response({"date": date_iso, "label": date_label(date_iso), "slots": slots})


@routes.post("/api/bookings")
async def api_create_booking(request: web.Request) -> web.Response:
    user_id, _, row = await _current_user(request)
    body = await _json_body(request)

    try:
        service_id = int(body.get("service_id"))
    except (TypeError, ValueError) as error:
        raise bad_request("service_id noto'g'ri") from error

    date_iso = str(body.get("date", ""))
    time_str = str(body.get("time", ""))

    service = await q.get_service(service_id)
    if not service or not service["is_active"]:
        raise not_found("Xizmat topilmadi")
    if date_iso not in available_dates():
        raise bad_request("Sana noto'g'ri")

    slots = free_slots(date_iso, int(service["duration_min"]), await _taken_slots(date_iso))
    if time_str not in slots:
        raise ApiError(
            409,
            "slot_taken",
            "Bu vaqt band bo'lib qoldi. Boshqa vaqtni tanlang.",
            {"slots": slots},
        )

    booking_id = await q.add_booking(user_id, service_id, date_iso, time_str)
    booking = await q.get_booking(booking_id)

    bot = request.app["bot"]
    await notify_admins(
        bot,
        "🔔 <b>Yangi navbat</b> (Mini App)\n\n"
        f"🆔 #{booking_id}\n"
        f"👤 {user_link(row['full_name'], row['username'], user_id)}\n"
        f"📞 {row['phone']}\n"
        f"🛠 {service['name']}\n"
        f"📅 {date_label(date_iso)}\n"
        f"🕐 {time_str}",
        admin_new_booking_kb(booking_id),
    )
    try:
        await bot.send_message(
            user_id,
            "✅ <b>Navbatingiz band qilindi!</b>\n\n"
            f"🆔 #{booking_id}\n"
            f"🛠 {service['name']}\n"
            f"📅 {date_label(date_iso)}\n"
            f"🕐 <b>{time_str}</b>\n"
            f"💰 {fmt_price(service['price'])}",
        )
    except Exception as error:
        logger.warning("Tasdiq xabari yuborilmadi: %s", error)

    return web.json_response({"ok": True, "booking": _booking_json(booking)}, status=201)


@routes.get("/api/bookings")
async def api_my_bookings(request: web.Request) -> web.Response:
    user_id, _, _ = await _current_user(request)
    rows = await q.get_user_bookings(user_id, only_active=False)
    return web.json_response([_booking_json(row) for row in reversed(rows)])


@routes.post("/api/bookings/{booking_id}/cancel")
async def api_cancel_booking(request: web.Request) -> web.Response:
    user_id, _, _ = await _current_user(request)
    try:
        booking_id = int(request.match_info["booking_id"])
    except ValueError as error:
        raise bad_request("Noto'g'ri id") from error

    booking = await q.get_booking(booking_id)
    if not booking or booking["user_id"] != user_id:
        raise not_found("Navbat topilmadi")
    if booking["status"] == "cancelled":
        raise bad_request("Bu navbat allaqachon bekor qilingan")

    await q.set_booking_status(booking_id, "cancelled")
    await notify_admins(
        request.app["bot"],
        "⚠️ <b>Navbat bekor qilindi</b> (Mini App)\n\n"
        f"🆔 #{booking_id}\n"
        f"👤 {booking['full_name']} ({booking['phone']})\n"
        f"🛠 {booking['service_name']}\n"
        f"📅 {date_label(booking['date'])} 🕐 {booking['time']}",
    )
    updated = await q.get_booking(booking_id)
    return web.json_response({"ok": True, "booking": _booking_json(updated)})


# -------------------------------------------------------------------- do'kon


@routes.get("/api/catalog")
async def api_catalog(request: web.Request) -> web.Response:
    await _current_user(request)
    catalog = await q.get_catalog()
    for category in catalog:
        for product in category["products"]:
            product["price_label"] = fmt_price(product["price"])
            product["photo_url"] = (
                f"/api/photo/{product['id']}" if product["has_photo"] else None
            )
    return web.json_response(catalog)


@routes.get("/api/photo/{product_id}")
async def api_photo(request: web.Request) -> web.Response:
    """Mahsulot rasmini Telegram serveridan olib beradi (file_id brauzerda ochilmaydi)."""
    try:
        product_id = int(request.match_info["product_id"])
    except ValueError as error:
        raise bad_request("Noto'g'ri id") from error

    product = await q.get_product(product_id)
    if not product or not product["photo_id"]:
        raise not_found("Rasm yo'q")

    bot = request.app["bot"]
    try:
        buffer = await bot.download(product["photo_id"])
        data = buffer.read()
    except Exception as error:
        logger.warning("Rasm yuklanmadi (%s): %s", product_id, error)
        raise not_found("Rasm yuklanmadi") from error

    return web.Response(
        body=data,
        content_type="image/jpeg",
        headers={"Cache-Control": "public, max-age=86400"},
    )


@routes.post("/api/orders")
async def api_create_order(request: web.Request) -> web.Response:
    user_id, _, row = await _current_user(request)
    body = await _json_body(request)

    raw_items = body.get("items")
    if not isinstance(raw_items, list) or not raw_items:
        raise bad_request("Savatcha bo'sh")

    items: list[tuple[int, int]] = []
    for entry in raw_items:
        if not isinstance(entry, dict):
            raise bad_request("items formati noto'g'ri")
        try:
            items.append((int(entry["product_id"]), int(entry["qty"])))
        except (KeyError, TypeError, ValueError) as error:
            raise bad_request("items ichida product_id va qty bo'lishi kerak") from error

    address = str(body.get("address", "")).strip()
    if len(address) < 5:
        raise bad_request("Manzilni to'liqroq kiriting")

    phone = normalize_phone(str(body.get("phone", ""))) or row["phone"]
    if not phone:
        raise bad_request("Telefon raqam noto'g'ri")

    order_id, problems = await q.create_order_from_items(user_id, items, address, phone)
    if order_id is None:
        raise ApiError(
            409,
            "order_failed",
            "Ba'zi mahsulotlar yetarli emas. Savatchani yangilang.",
            {"problems": problems},
        )

    order = await q.get_order(order_id)
    order_items = await q.get_order_items(order_id)
    lines = [
        f"• {item['name']} × {item['qty']} = {fmt_price(int(item['price']) * int(item['qty']))}"
        for item in order_items
    ]

    bot = request.app["bot"]
    await notify_admins(
        bot,
        "🔔 <b>Yangi buyurtma</b> (Mini App)\n\n"
        f"🆔 #{order_id}\n"
        f"👤 {user_link(row['full_name'], row['username'], user_id)}\n"
        f"📞 {phone}\n"
        f"📍 {address}\n\n" + "\n".join(lines) + f"\n\n💰 Jami: <b>{fmt_price(order['total'])}</b>",
        admin_new_order_kb(order_id),
    )
    try:
        await bot.send_message(
            user_id,
            f"✅ <b>Buyurtmangiz qabul qilindi!</b>\n\n🆔 #{order_id}\n"
            + "\n".join(lines)
            + f"\n\n💰 Jami: <b>{fmt_price(order['total'])}</b>\n"
            f"📍 {address}\n\nOperator tez orada bog'lanadi.",
        )
    except Exception as error:
        logger.warning("Buyurtma tasdiqi yuborilmadi: %s", error)

    return web.json_response(
        {
            "ok": True,
            "order": {
                "id": order_id,
                "total": int(order["total"]),
                "total_label": fmt_price(order["total"]),
            },
        },
        status=201,
    )


@routes.get("/api/orders")
async def api_my_orders(request: web.Request) -> web.Response:
    user_id, _, _ = await _current_user(request)
    orders = await q.get_user_orders(user_id, limit=20)
    result = []
    for order in orders:
        items = await q.get_order_items(order["id"])
        result.append(
            {
                "id": order["id"],
                "total": int(order["total"]),
                "total_label": fmt_price(order["total"]),
                "status": order["status"],
                "status_label": ORDER_STATUS.get(order["status"], order["status"]),
                "address": order["address"],
                "created_at": order["created_at"],
                "items": [
                    {
                        "name": item["name"],
                        "qty": int(item["qty"]),
                        "price": int(item["price"]),
                        "price_label": fmt_price(item["price"]),
                    }
                    for item in items
                ],
            }
        )
    return web.json_response(result)
