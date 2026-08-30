"""Mini App uchun REST API.

Barcha so'rovlar `Authorization: tma <initData>` sarlavhasi bilan keladi —
foydalanuvchi kimligini Telegram imzosidan aniqlaymiz.
"""

import logging

from aiohttp import web

from api.auth import extract_init_data, validate_init_data
from api.errors import ApiError, bad_request, not_found, phone_required, unauthorized
from api.media import media_fields
from config import config, is_admin, service_video_allowed
from database import queries as q
from keyboards.inline import (
    admin_new_biled_kb,
    admin_new_booking_kb,
    admin_new_order_kb,
)
from services import identity, orders as order_flow, sync
from utils.helpers import (
    available_dates,
    date_label,
    fmt_price,
    free_slots,
    html_escape,
    normalize_phone,
    short_date_label,
    today_iso,
    user_link,
)
from utils.texts import BILED_STATUS, BOOKING_STATUS, ORDER_STATUS
from utils.ui import notify_admins

logger = logging.getLogger(__name__)

routes = web.RouteTableDef()

# Kirish ma'lumoti chegaralari. Ilgari `items` va `address` uchun YUQORI
# chegara yo'q edi — mijoz minglab qator yoki juda uzun matn yuborib
# serverni ortiqcha ishga majburlashi mumkin edi.
MAX_ORDER_ITEMS = 50
MAX_ITEM_QTY = 1000
MAX_ADDRESS_LEN = 400


# ------------------------------------------------------------------ yordamchilar


async def _current_user(request: web.Request, require_phone: bool = False):
    """initData'ni tekshiradi va (user_id, telegram_user, db_row) qaytaradi.

    Foydalanuvchi bazada bo'lmasa — Telegram ismi bilan AVTOMATIK yaratiladi.
    Ya'ni ilovaga kirish uchun hech qanday "ro'yxatdan o'tish to'sig'i" yo'q:
    katalog, konfigurator va narxlar hammaga darhol ko'rinadi.

    Telefon raqami faqat BUYURTMA berishda so'raladi (require_phone=True).
    """
    init_data = extract_init_data(request.headers)
    verified = validate_init_data(init_data, config.bot_token)
    if not verified:
        raise unauthorized()

    tg_user = verified["user"]
    user_id = int(tg_user["id"])

    # Ilovaga kirgan mijoz ham HAR SAFAR eslab qolinadi: bazada bo'lmasa
    # Firebase'dan tiklanadi, bo'lsa — profili bulutga yozib turiladi.
    # Ilgari bu yerda faqat mahalliy bazaga yozilardi va Firebase'ga
    # tushmasdi, shuning uchun qayta deployda mijoz yo'qolib ketardi.
    row = await identity.remember(
        user_id,
        identity.display_name(tg_user.get("first_name"), tg_user.get("last_name")),
        tg_user.get("username"),
    )
    if row is None:
        raise unauthorized()

    if require_phone and not row["phone"]:
        raise phone_required()
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


async def _bookable_service(service_id: int):
    """Navbat olish MUMKIN bo'lgan xizmatni qaytaradi.

    «Tez kunda» xizmatga navbat OLINMAYDI: uning narxi hali belgilanmagan,
    ya'ni buyurtma tushsa mijoz ham, admin ham qancha pul haqida gap
    ketayotganini bilmaydi. Ilova tugmani ko'rsatmaydi, lekin server ham
    tekshirishi SHART — aks holda eski keshdagi ilova yoki qo'lda
    yuborilgan so'rov orqali narxsiz navbat yaratilishi mumkin edi.
    """
    service = await q.get_service(service_id)
    if not service or not service["is_active"]:
        raise not_found("Xizmat topilmadi")
    keys = service.keys()
    if "coming_soon" in keys and service["coming_soon"]:
        raise ApiError(
            409,
            "coming_soon",
            f"«{service['name']}» xizmati tez kunda ishga tushadi. "
            "Hozircha navbat olinmaydi.",
        )
    return service


def _media_from_raw(table: str, row_id: int, raw_url, has_file: bool, kind: str) -> tuple:
    """(manzil, tashqimi): tashqi URL bo'lsa o'zi, aks holda media proksisi."""
    external = (raw_url or "").strip()
    if external.startswith("http"):
        return external, True
    if has_file:
        return f"/api/media/{table}/{row_id}/{kind}", False
    return None, False


def _decorate_catalog(catalog: list[dict]) -> None:
    """Narx yozuvlari, rasm va video manzillarini to'ldiradi."""
    for category in catalog:
        for product in category["products"]:
            product["price_label"] = fmt_price(product["price"])
            product["old_price_label"] = (
                fmt_price(product["old_price"]) if product["old_price"] else None
            )
            photo, photo_ext = _media_from_raw(
                "products",
                product["id"],
                product.pop("photo_url_raw", None),
                product.pop("has_photo", False),
                "photo",
            )
            video, video_ext = _media_from_raw(
                "products",
                product["id"],
                product.pop("video_url_raw", None),
                product.pop("has_video", False),
                "video",
            )
            product["photo_url"] = photo
            product["photo_external"] = photo_ext
            product["video_url"] = video
            product["video_external"] = video_ext
            product["has_media"] = bool(photo or video)

            # Mahsulot modalidagi galereya uchun barcha rasmlar (1–3 ta).
            images = [photo]
            for slot, kind in (("2", "photo2"), ("3", "photo3")):
                extra, _ = _media_from_raw(
                    "products",
                    product["id"],
                    product.pop(f"photo{slot}_url_raw", None),
                    product.pop(f"has_photo{slot}", False),
                    kind,
                )
                images.append(extra)
            product["images"] = [url for url in images if url]


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
async def api_config(request: web.Request) -> web.Response:
    """Do'kon sozlamalari va to'lov rekvizitlari.

    IMZO TALAB QILINADI. Ilgari bu endpoint himoyasiz edi — ya'ni istalgan
    odam brauzerdan ochib karta raqamini, karta egasining ismini va admin
    username'ini ko'ra olardi. Mini App bu so'rovni allaqachon imzo bilan
    yuboradi (`api()` -> `Authorization: tma ...`), shuning uchun tekshiruv
    qo'shilishi ilova ishiga ta'sir qilmaydi.
    """
    await _current_user(request)
    return web.json_response(
        {
            "shop_name": config.shop_name,
            "currency": config.currency,
            "work_start_hour": config.work_start_hour,
            "work_end_hour": config.work_end_hour,
            "slot_minutes": config.slot_minutes,
            "booking_days_ahead": config.booking_days_ahead,
            # To'lov (karta) rekvizitlari va yetkazib berish shahri —
            # savatchadagi to'lov oynasi shulardan foydalanadi.
            "pay_card_number": config.pay_card_number,
            "pay_card_holder": config.pay_card_holder,
            "pay_admin_username": config.pay_admin_username,
            "delivery_city": config.delivery_city,
        }
    )


@routes.get("/api/me")
async def api_me(request: web.Request) -> web.Response:
    user_id, tg_user, row = await _current_user(request)

    car = None
    full = await q.get_user_with_car(user_id)
    if full and full["car_id"]:
        car = {
            "id": full["car_id"],
            "name": full["car_name"],
            "years": full["car_years"],
            "slug": full["car_slug"],
        }

    return web.json_response(
        {
            # ilovaga kirish har doim ochiq; faqat telefon yetishmasligi mumkin
            "registered": True,
            "needs_phone": not bool(row["phone"]),
            "user_id": user_id,
            "first_name": tg_user.get("first_name"),
            "full_name": row["full_name"],
            "phone": row["phone"],
            "car": car,
            # Ilova shu belgiga qarab admin bo'limini ko'rsatadi
            "is_admin": is_admin(user_id),
        }
    )


@routes.post("/api/register")
async def api_register(request: web.Request) -> web.Response:
    """Ilova ichida ro'yxatdan o'tish: ism + telefon. Botga qaytish shart emas."""
    user_id, tg_user, row = await _current_user(request)
    body = await _json_body(request)

    full_name = str(body.get("full_name", "")).strip()
    if not full_name:
        full_name = row["full_name"] or tg_user.get("first_name") or "Mijoz"
    if len(full_name) < 2 or len(full_name) > 64:
        raise bad_request("Ismni to'g'ri kiriting")

    phone = normalize_phone(str(body.get("phone", "")))
    if not phone:
        raise bad_request("Telefon raqam noto'g'ri. Masalan: +998901234567")

    await q.add_user(user_id, full_name, phone, tg_user.get("username"))
    identity.forget_cache(user_id)
    await identity.push_profile(user_id)

    bot = request.app["bot"]
    await notify_admins(
        bot,
        "👤 <b>Yangi mijoz</b> (ilova orqali)\n\n"
        f"Ism: <b>{full_name}</b>\n"
        f"📞 {phone}\n"
        f"ID: <code>{user_id}</code>",
    )
    try:
        await bot.send_message(
            user_id,
            f"✅ Rahmat, <b>{full_name}</b>! Ma'lumotlaringiz saqlandi.\n"
            f"📞 {phone}\n\nEndi buyurtma berishingiz mumkin. 🔧",
        )
    except Exception as error:
        logger.warning("Ro'yxat tasdiqi yuborilmadi: %s", error)

    return web.json_response(
        {"ok": True, "full_name": full_name, "phone": phone, "needs_phone": False}
    )


@routes.get("/api/favorites")
async def api_favorites(request: web.Request) -> web.Response:
    """Saqlangan tovarlar (Kabinetdagi «Saqlanganlar» bo'limi)."""
    user_id, _, _ = await _current_user(request)
    products = await q.get_favorites(user_id)

    # Narx yorliqlari va rasm manzillarini katalog kabi to'ldiramiz
    wrapper = [{"products": products}]
    _decorate_catalog(wrapper)

    return web.json_response({"items": products, "count": len(products)})


@routes.post("/api/favorites")
async def api_favorite_toggle(request: web.Request) -> web.Response:
    """Tovarni saqlaydi yoki saqlanganlardan oladi (bitta tugma)."""
    user_id, _, _ = await _current_user(request)
    body = await _json_body(request)
    try:
        product_id = int(body.get("product_id"))
    except (TypeError, ValueError) as error:
        raise bad_request("product_id noto'g'ri") from error

    product = await q.get_product(product_id)
    if not product:
        raise not_found("Tovar topilmadi")

    saved = await q.toggle_favorite(user_id, product_id)
    # Bulutga yozamiz — qayta deployda saqlanganlar yo'qolmasin
    await sync.push_favorites(user_id)

    return web.json_response({"ok": True, "saved": saved, "product_id": product_id})


@routes.post("/api/me/car")
async def api_set_car(request: web.Request) -> web.Response:
    user_id, _, _ = await _current_user(request)
    body = await _json_body(request)
    try:
        car_id = int(body.get("car_id"))
    except (TypeError, ValueError) as error:
        raise bad_request("car_id noto'g'ri") from error

    car = await q.get_car(car_id)
    if not car or not car["is_active"]:
        raise not_found("Mashina topilmadi")

    await q.set_user_car(user_id, car_id)
    identity.forget_cache(user_id)
    await identity.push_profile(user_id)

    return web.json_response(
        {"ok": True, "car": {"id": car["id"], "name": car["name"], "years": car["years"]}}
    )


# ==================================================================== tuning


@routes.get("/api/cars")
async def api_cars(request: web.Request) -> web.Response:
    await _current_user(request)
    cars = await q.get_cars()
    return web.json_response(
        [
            {
                "id": car["id"],
                "name": car["name"],
                "slug": car["slug"],
                "years": car["years"],
                "note": car["note"],
                # Rasm bo'lsa Mini App SVG siluet o'rniga uni ko'rsatadi.
                # Ilgari media maydonlari berilmagani uchun bazaga qo'yilgan
                # mashina rasmi umuman ishlatilmasdi.
                **media_fields("cars", car),
            }
            for car in cars
        ]
    )


@routes.get("/api/tuning")
async def api_tuning(request: web.Request) -> web.Response:
    """Konfigurator uchun barcha variantlar: linzalar, ochkilar, ranglar."""
    await _current_user(request)

    biled = await q.get_biled_types()
    shrouds = await q.get_shrouds()
    colors = await q.get_optic_colors()

    return web.json_response(
        {
            "biled_types": [
                {
                    "id": row["id"],
                    "name": row["name"],
                    "brand": row["brand"],
                    "size": row["size"],
                    "kelvin": row["kelvin"],
                    "lumen": row["lumen"],
                    "warranty": row["warranty"],
                    "description": row["description"],
                    "price": int(row["price"]),
                    "price_label": fmt_price(row["price"]),
                    "badge": row["badge"],
                    "glow": row["glow"],
                    **media_fields("biled_types", row),
                }
                for row in biled
            ],
            "shrouds": [
                {
                    "id": row["id"],
                    "name": row["name"],
                    "style": row["style"],
                    "ring_color": row["ring_color"],
                    "description": row["description"],
                    "price": int(row["price"]),
                    "price_label": fmt_price(row["price"]),
                    **media_fields("shrouds", row),
                }
                for row in shrouds
            ],
            "colors": [
                {
                    "id": row["id"],
                    "name": row["name"],
                    "hex_from": row["hex_from"],
                    "hex_to": row["hex_to"],
                    "description": row["description"],
                    "price": int(row["price"]),
                    "price_label": fmt_price(row["price"]),
                    **media_fields("optic_colors", row),
                }
                for row in colors
            ],
        }
    )


def _biled_order_json(row) -> dict:
    parts = [row["biled_name"]]
    if row["shroud_name"]:
        parts.append(row["shroud_name"])
    if row["color_name"]:
        parts.append(row["color_name"])
    return {
        "id": row["id"],
        "car_name": row["car_name"],
        "biled_name": row["biled_name"],
        "biled_brand": row["biled_brand"],
        "shroud_name": row["shroud_name"],
        "color_name": row["color_name"],
        "summary": " · ".join(parts),
        "total": int(row["total"]),
        "total_label": fmt_price(row["total"]),
        "status": row["status"],
        "status_label": BILED_STATUS.get(row["status"], row["status"]),
        "comment": row["comment"],
        "created_at": row["created_at"],
    }


@routes.post("/api/biled-orders")
async def api_create_biled_order(request: web.Request) -> web.Response:
    user_id, _, row = await _current_user(request, require_phone=True)
    body = await _json_body(request)

    def _int_or_none(key: str) -> int | None:
        value = body.get(key)
        if value in (None, "", 0):
            return None
        try:
            return int(value)
        except (TypeError, ValueError) as error:
            raise bad_request(f"{key} noto'g'ri") from error

    car_id = _int_or_none("car_id")
    biled_id = _int_or_none("biled_id")
    if not car_id or not biled_id:
        raise bad_request("Mashina va Bi-LED linza tanlanishi shart")

    car = await q.get_car(car_id)
    if not car:
        raise not_found("Mashina topilmadi")

    shroud_id = _int_or_none("shroud_id")
    color_id = _int_or_none("color_id")
    comment = str(body.get("comment", "")).strip()[:400] or None
    phone = normalize_phone(str(body.get("phone", ""))) or row["phone"]

    order_id, total = await q.create_biled_order(
        user_id, car_id, biled_id, shroud_id, color_id, phone, comment
    )
    if order_id is None:
        raise not_found("Bi-LED linza topilmadi")

    # tanlangan mashina profilga eslab qolinadi
    await q.set_user_car(user_id, car_id)

    order = await q.get_biled_order(order_id)
    await sync.push_biled_order(order)
    details = [
        f"🚗 Mashina: <b>{order['car_name']}</b>",
        f"💡 Linza: <b>{order['biled_name']}</b> — {fmt_price(order['biled_price'])}",
    ]
    if order["shroud_name"]:
        details.append(
            f"🕶 Ochki: <b>{order['shroud_name']}</b> — {fmt_price(order['shroud_price'])}"
        )
    if order["color_name"]:
        details.append(
            f"🎨 Optika rangi: <b>{order['color_name']}</b> — {fmt_price(order['color_price'])}"
        )
    if comment:
        details.append(f"📝 Izoh: {comment}")

    bot = request.app["bot"]
    await notify_admins(
        bot,
        "🔥 <b>Yangi Bi-LED buyurtma</b>\n\n"
        f"🆔 #{order_id}\n"
        f"👤 {user_link(row['full_name'], row['username'], user_id)}\n"
        f"📞 {phone}\n\n" + "\n".join(details) + f"\n\n💰 Jami: <b>{fmt_price(total)}</b>",
        admin_new_biled_kb(order_id),
    )
    try:
        await bot.send_message(
            user_id,
            "✅ <b>Buyurtmangiz qabul qilindi!</b>\n\n"
            f"🆔 #{order_id}\n" + "\n".join(details) + f"\n\n💰 Jami: <b>{fmt_price(total)}</b>\n\n"
            "Mutaxassisimiz tez orada bog'lanib, o'rnatish vaqtini kelishadi. 🔧",
        )
    except Exception as error:
        logger.warning("Bi-LED tasdiqi yuborilmadi: %s", error)

    return web.json_response({"ok": True, "order": _biled_order_json(order)}, status=201)


@routes.get("/api/biled-orders")
async def api_my_biled_orders(request: web.Request) -> web.Response:
    user_id, _, _ = await _current_user(request)
    orders = await q.get_user_biled_orders(user_id)
    return web.json_response([_biled_order_json(row) for row in orders])


# ================================================================ asosiy menyu


@routes.get("/api/home")
async def api_home(request: web.Request) -> web.Response:
    """Asosiy menyu uchun: stories, bannerlar, aksiyalar va mahsulotlar."""
    user_id, _, row = await _current_user(request)

    car_id = None
    raw_car = request.query.get("car_id")
    if raw_car:
        try:
            car_id = int(raw_car)
        except ValueError as error:
            raise bad_request("car_id noto'g'ri") from error
    else:
        full = await q.get_user_with_car(user_id)
        car_id = full["car_id"] if full else None

    banners = await q.get_banners(car_id)
    stories = await q.get_story_rings()
    catalog = await q.get_catalog(car_id)

    _decorate_catalog(catalog)

    return web.json_response(
        {
            "car_id": car_id,
            "banners": [
                {
                    "id": b["id"],
                    "title": b["title"],
                    "subtitle": b["subtitle"],
                    "tag": b["tag"],
                    "color_from": b["color_from"],
                    "color_to": b["color_to"],
                    **media_fields("banners", b),
                }
                for b in banners
            ],
            # Stories HALQALARGA (kategoriyalarga) guruhlangan: bitta halqa
            # ichida bir nechta video/rasm ketma-ket o'ynaydi (Avto_A1 kabi).
            "stories": [
                {
                    "key": ring["info"]["key"],
                    "title": ring["info"]["title"],
                    "emoji": ring["info"]["emoji"],
                    "color_from": ring["info"]["color_from"],
                    "color_to": ring["info"]["color_to"],
                    "count": len(ring["items"]),
                    "items": [
                        {
                            "id": s["id"],
                            "heading": s["heading"] or s["title"],
                            "body": s["body"],
                            "emoji": s["emoji"] or ring["info"]["emoji"],
                            "color_from": s["color_from"] or ring["info"]["color_from"],
                            "color_to": s["color_to"] or ring["info"]["color_to"],
                            # Story ko'ruvchisi uchun CTA havolasi.
                            # `in s.keys()` — migratsiya hali o'tmagan
                            # bazada ustun yo'q bo'lsa yiqilmasligi uchun.
                            "link": (s["link"] if "link" in s.keys() else "") or "",
                            "title": s["title"],
                            **media_fields("stories", s),
                        }
                        for s in ring["items"]
                    ],
                }
                for ring in stories
            ],
            # Aksiyalar bo'limi olib tashlandi — chegirma tovarning o'zida
            # (eski narx + belgi), Avto A1 dagi kabi.
            "catalog": catalog,
            # Saqlangan tovarlar — yuraklarni darhol to'g'ri ko'rsatish uchun
            "favorite_ids": await q.get_favorite_ids(user_id),
        }
    )


# -------------------------------------------------------------------- navbat


@routes.get("/api/services")
async def api_services(request: web.Request) -> web.Response:
    await _current_user(request)
    services = await q.get_services()
    return web.json_response([_service_json(svc) for svc in services])


def _service_json(svc) -> dict:
    """Mini App uchun bitta xizmat.

    VIDEO. Faqat uchta fara xizmatiga qo'yiladi (`VIDEO_SERVICE_THEMES`).
    Qoida SERVER tomonida hisoblanadi va `video_allowed` sifatida
    yuboriladi — shunda frontend qoidani TAKRORLAMAYDI (ikki joyda
    saqlansa ular albatta bir-biridan ajralib ketadi).

    «TEZ KUNDA». `coming_soon = 1` bo'lsa narx yuborilmaydi: mijoz
    tayyor bo'lmagan narxni ko'rmasligi kerak. Frontend narx o'rniga
    «Tez kunda» yozadi va navbat tugmasini ko'rsatmaydi.
    """
    keys = svc.keys()
    theme = svc["theme"] if "theme" in keys else None
    soon = bool(svc["coming_soon"]) if "coming_soon" in keys else False
    allowed = service_video_allowed(theme)

    video_url = None
    video_external = False
    if allowed:
        raw = svc["video_url"] if "video_url" in keys else None
        has_file = bool(svc["video_id"]) if "video_id" in keys else False
        video_url, video_external = _media_from_raw(
            "services", svc["id"], raw, has_file, "video"
        )

    return {
        "id": svc["id"],
        "name": svc["name"],
        "duration_min": int(svc["duration_min"]),
        # «Tez kunda» xizmatda narx YO'Q (0 emas — yo'q). Frontend `null`
        # ni «Tez kunda» deb ko'rsatadi, `0` esa «bepul» degan ma'no
        # berib qolishi mumkin edi.
        "price": None if soon else int(svc["price"]),
        "price_label": None if soon else fmt_price(svc["price"]),
        # Mini App «Xizmatlar» bo'limi uchun: kafolat, tavsif va
        # kartochka dizayni kaliti (`app.js: SERVICE_THEMES`).
        "warranty": svc["warranty"],
        "description": svc["description"],
        "theme": theme,
        "sort": int(svc["sort"] or 0),
        "coming_soon": soon,
        # Videoni ko'rsatish/yuklash mumkinmi (qoida serverda)
        "video_allowed": allowed,
        "video_url": video_url,
        "video_external": video_external,
        "has_video": bool(video_url),
    }


@routes.get("/api/dates")
async def api_dates(request: web.Request) -> web.Response:
    await _current_user(request)
    try:
        service_id = int(request.query.get("service_id", ""))
    except ValueError as error:
        raise bad_request("service_id ko'rsatilmagan") from error

    service = await _bookable_service(service_id)

    result = []
    for date_iso in available_dates():
        slots = free_slots(date_iso, int(service["duration_min"]), await _taken_slots(date_iso))
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

    service = await _bookable_service(service_id)

    slots = free_slots(date_iso, int(service["duration_min"]), await _taken_slots(date_iso))
    return web.json_response({"date": date_iso, "label": date_label(date_iso), "slots": slots})


@routes.post("/api/bookings")
async def api_create_booking(request: web.Request) -> web.Response:
    user_id, _, row = await _current_user(request, require_phone=True)
    body = await _json_body(request)

    try:
        service_id = int(body.get("service_id"))
    except (TypeError, ValueError) as error:
        raise bad_request("service_id noto'g'ri") from error

    date_iso = str(body.get("date", ""))
    time_str = str(body.get("time", ""))

    service = await _bookable_service(service_id)
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

    # Yuqoridagi `free_slots` tekshiruvi bilan bu yozuv orasida boshqa mijoz
    # o'sha vaqtni olib qo'yishi mumkin. Bazadagi yagona indeks shuni
    # to'xtatadi va biz mijozga yangilangan ro'yxatni qaytaramiz.
    try:
        booking_id = await q.add_booking(user_id, service_id, date_iso, time_str)
    except q.SlotTaken as error:
        slots = free_slots(
            date_iso, int(service["duration_min"]), await _taken_slots(date_iso)
        )
        raise ApiError(
            409,
            "slot_taken",
            "Bu vaqt shu lahzada band bo'ldi. Boshqa vaqtni tanlang.",
            {"slots": slots},
        ) from error

    booking = await q.get_booking(booking_id)
    await sync.push_booking(booking)

    bot = request.app["bot"]
    safe_service = html_escape(service["name"])
    try:
        await notify_admins(
            bot,
            "🔔 <b>Yangi navbat</b> (Mini App)\n\n"
            f"🆔 #{booking_id}\n"
            f"👤 {user_link(row['full_name'], row['username'], user_id)}\n"
            f"📞 {html_escape(row['phone'])}\n"
            f"🛠 {safe_service}\n"
            f"📅 {date_label(date_iso)}\n"
            f"🕐 {time_str}",
            admin_new_booking_kb(booking_id),
        )
    except Exception as error:
        logger.error("Navbat #%s haqida adminga xabar yuborilmadi: %s", booking_id, error)
    try:
        await bot.send_message(
            user_id,
            "✅ <b>Navbatingiz band qilindi!</b>\n\n"
            f"🆔 #{booking_id}\n"
            f"🛠 {safe_service}\n"
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

    # Holat mexanizmi orqali: tekshiradi, bazaga yozadi, bulutga uzatadi va
    # ochiq bandlik jadvalidan o'chiradi. Ilgari `set_booking_status` TO'G'RIDAN
    # chaqirilardi — natijada tugagan navbatni ham "bekor qilish" mumkin edi va
    # Firebase'dagi holat abadiy «new» bo'lib qolardi (bo'shagan vaqt boshqa
    # mijozga BAND ko'rinardi).
    allowed, reason = order_flow.check("booking", booking["status"], "cancelled")
    if not allowed:
        raise bad_request(
            order_flow.reason_text("booking", booking["status"], "cancelled", reason),
            {
                "status": booking["status"],
                "status_label": order_flow.label("booking", booking["status"]),
            },
        )

    await order_flow.apply("booking", booking_id, "cancelled")
    try:
        await notify_admins(
            request.app["bot"],
            "⚠️ <b>Navbat bekor qilindi</b> (Mini App)\n\n"
            f"🆔 #{booking_id}\n"
            f"👤 {html_escape(booking['full_name'])} ({html_escape(booking['phone'])})\n"
            f"🛠 {html_escape(booking['service_name'])}\n"
            f"📅 {date_label(booking['date'])} 🕐 {booking['time']}",
        )
    except Exception as error:
        logger.error("Navbat #%s bekori haqida xabar yuborilmadi: %s", booking_id, error)
    updated = await q.get_booking(booking_id)
    return web.json_response({"ok": True, "booking": _booking_json(updated)})


# -------------------------------------------------------------------- do'kon


@routes.get("/api/catalog")
async def api_catalog(request: web.Request) -> web.Response:
    user_id, _, _ = await _current_user(request)

    car_id = None
    raw_car = request.query.get("car_id")
    if raw_car:
        try:
            car_id = int(raw_car)
        except ValueError as error:
            raise bad_request("car_id noto'g'ri") from error
    else:
        full = await q.get_user_with_car(user_id)
        car_id = full["car_id"] if full else None

    catalog = await q.get_catalog(car_id)
    _decorate_catalog(catalog)
    return web.json_response(catalog)


@routes.get("/api/photo/{product_id}")
async def api_photo(request: web.Request) -> web.Response:
    """Eski manzil — yangi media proksisiga yo'naltiradi (kesh uchun mos)."""
    try:
        product_id = int(request.match_info["product_id"])
    except ValueError as error:
        raise bad_request("Noto'g'ri id") from error
    raise web.HTTPFound(location=f"/api/media/products/{product_id}/photo")


@routes.post("/api/orders")
async def api_create_order(request: web.Request) -> web.Response:
    user_id, _, row = await _current_user(request, require_phone=True)
    body = await _json_body(request)

    raw_items = body.get("items")
    if not isinstance(raw_items, list) or not raw_items:
        raise bad_request("Savatcha bo'sh")
    # Yuqori chegara: ilgari cheklov yo'q edi va mijoz minglab qator yuborib
    # har biri uchun alohida baza so'rovi bajarilishiga majburlashi mumkin edi.
    if len(raw_items) > MAX_ORDER_ITEMS:
        raise bad_request(f"Savatchada {MAX_ORDER_ITEMS} turdan ko'p tovar bo'lmasin")

    items: list[tuple[int, int]] = []
    for entry in raw_items:
        if not isinstance(entry, dict):
            raise bad_request("items formati noto'g'ri")
        try:
            product_id = int(entry["product_id"])
            qty = int(entry["qty"])
        except (KeyError, TypeError, ValueError) as error:
            raise bad_request("items ichida product_id va qty bo'lishi kerak") from error
        if qty < 1 or qty > MAX_ITEM_QTY:
            raise bad_request(f"Har bir tovar soni 1 dan {MAX_ITEM_QTY} gacha bo'lsin")
        items.append((product_id, qty))

    address = str(body.get("address", "")).strip()
    if len(address) < 5:
        raise bad_request("Manzilni to'liqroq kiriting")
    if len(address) > MAX_ADDRESS_LEN:
        raise bad_request(f"Manzil {MAX_ADDRESS_LEN} belgidan qisqa bo'lsin")

    # Idempotentlik kaliti: mijoz ikki marta bossa yoki tarmoq uzilib so'rov
    # qaytarilsa — ikkinchi urinishda YANGI buyurtma yaratilmaydi, birinchisi
    # qaytariladi. Kalit mijozdan keladi, lekin foydalanuvchiga BOG'LANADI,
    # ya'ni boshqa odamning kaliti bilan uning buyurtmasini ko'rib bo'lmaydi.
    raw_key = str(body.get("client_key", "")).strip()[:64]
    idempotency_key = f"{user_id}:{raw_key}" if raw_key else None

    phone = normalize_phone(str(body.get("phone", ""))) or row["phone"]
    if not phone:
        raise bad_request("Telefon raqam noto'g'ri")

    # Yetkazib berish va to'lov usuli (Mini App'dagi savatcha oqimidan).
    delivery_method = str(body.get("delivery_method", "")).strip().lower()
    if delivery_method not in ("courier", "bts", ""):
        raise bad_request("Yetkazib berish usuli noto'g'ri")
    delivery_method = delivery_method or None
    delivery_info = str(body.get("delivery_info", "")).strip()[:400] or None
    payment_method = str(body.get("payment_method", "")).strip()[:120] or None

    order_id, problems = await q.create_order_from_items(
        user_id,
        items,
        address,
        phone,
        delivery_method=delivery_method,
        delivery_info=delivery_info,
        payment_method=payment_method,
        idempotency_key=idempotency_key,
    )
    if order_id is None:
        raise ApiError(
            409,
            "order_failed",
            "Ba'zi mahsulotlar yetarli emas. Savatchani yangilang.",
            {"problems": problems},
        )

    order = await q.get_order(order_id)
    order_items = await q.get_order_items(order_id)
    await sync.push_order(order, order_items)
    lines = [
        f"• {html_escape(item['name'])} × {item['qty']}"
        f" = {fmt_price(int(item['price']) * int(item['qty']))}"
        for item in order_items
    ]

    # Yetkazib berish/to'lov qatorlari (bo'lsa) — xabarlarga qo'shiladi.
    # Mijoz kiritgan matn HTML uchun tozalanadi: ichida `<` bo'lsa Telegram
    # xabarni rad etadi va ADMIN buyurtmani ko'rmay qolardi.
    safe_address = html_escape(address)
    meta_lines = []
    if delivery_info:
        meta_lines.append(f"🚚 {html_escape(delivery_info)}")
    if payment_method:
        meta_lines.append(f"💳 To'lov: <b>{html_escape(payment_method)}</b>")
    meta_block = ("\n" + "\n".join(meta_lines)) if meta_lines else ""

    bot = request.app["bot"]
    # DIQQAT: adminga xabar `try` ichida — ilgari bu yerda xato chiqsa butun
    # so'rov 500 bilan yiqilardi. Buyurtma esa BAZAGA ALLAQACHON yozilgan
    # bo'lardi, ya'ni mijoz "xato" ko'rib qaytadan buyurtma berardi.
    try:
        await notify_admins(
            bot,
            "🔔 <b>Yangi buyurtma</b> (Mini App)\n\n"
            f"🆔 #{order_id}\n"
            f"👤 {user_link(row['full_name'], row['username'], user_id)}\n"
            f"📞 {html_escape(phone)}\n"
            f"📍 {safe_address}"
            f"{meta_block}\n\n"
            + "\n".join(lines)
            + f"\n\n💰 Jami: <b>{fmt_price(order['total'])}</b>",
            admin_new_order_kb(order_id),
        )
    except Exception as error:
        logger.error("Buyurtma #%s haqida adminga xabar yuborilmadi: %s", order_id, error)
    try:
        await bot.send_message(
            user_id,
            f"✅ <b>Buyurtmangiz qabul qilindi!</b>\n\n🆔 #{order_id}\n"
            + "\n".join(lines)
            + f"\n\n💰 Jami: <b>{fmt_price(order['total'])}</b>\n"
            f"📍 {safe_address}"
            f"{meta_block}\n\nOperator tez orada bog'lanadi.",
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
                "delivery_method": order["delivery_method"],
                "delivery_info": order["delivery_info"],
                "payment_method": order["payment_method"],
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
