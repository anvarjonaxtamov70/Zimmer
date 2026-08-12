"""Mini App ichidagi admin panel API'si.

Nima uchun kerak?
-----------------
Ilgari katalogni faqat bot ichidagi tugmalar orqali tahrirlash mumkin edi.
Bu yerda esa Mini App'ning o'z admin paneli uchun REST API bor: mahsulot
qo'shish, Bi-LED linzalarni, ochkilarni, ranglarni va boshqa hamma
bo'limni brauzerda ko'rib, o'zgartirish mumkin.

Muhim tamoyil: **bitta manba**. Bo'limlar va maydonlar tavsifi
`handlers/admin_schema.py` dan olinadi (bot paneli ham shundan foydalanadi),
ma'lumotga kirish esa `database/queries.py` dagi oq ro'yxatli universal
so'rovlar orqali (`admin_list`, `admin_update`, `admin_insert`, ...).
Shuning uchun yangi maydon qo'shilsa — bot ham, Mini App ham darhol biladi.

Xavfsizlik:
  • har bir so'rov Telegram `initData` imzosi bilan tekshiriladi;
  • so'ngra `config.is_admin()` orqali adminlik tekshiriladi;
  • jadval/ustun nomlari faqat `queries.EDITABLE` oq ro'yxatidan olinadi.

Rasm/video yuklash:
  Serverda fayl saqlash joyi yo'q (Render'ning bepul tarifida disk
  saqlanmaydi). Shuning uchun yuklangan fayl bot orqali adminning o'z
  chatiga yuboriladi va Telegram bergan `file_id` bazaga yoziladi —
  keyin `/api/media/...` shu `file_id` bo'yicha oqim qilib uzatadi.
  Ya'ni Telegram o'zi bepul va ishonchli "fayl ombori" bo'lib qoladi.
"""

import logging

from aiogram.types import BufferedInputFile
from aiohttp import web

from api.auth import extract_init_data, validate_init_data
from api.errors import bad_request, forbidden, not_found, unauthorized
from api.media import media_url
from config import config, is_admin
from database import queries as q
from handlers.admin_schema import ENTITIES, HEX, Entity, Field, prepare_insert
from services import orders, sync
from utils.helpers import PERIODS, fmt_price, period_start, today_iso

logger = logging.getLogger(__name__)

admin_routes = web.RouteTableDef()

MAX_TEXT = 120
MAX_LONG = 1000
MAX_PHOTO_BYTES = 10 * 1024 * 1024
MAX_VIDEO_BYTES = 45 * 1024 * 1024
LIST_LIMIT = 200


# ------------------------------------------------------------------ yordamchilar


async def _admin_id(request: web.Request) -> int:
    """initData'ni tekshiradi va admin ID'sini qaytaradi (aks holda xato)."""
    verified = validate_init_data(extract_init_data(request.headers), config.bot_token)
    if not verified:
        raise unauthorized()
    user_id = int(verified["user"]["id"])
    if not is_admin(user_id):
        raise forbidden()
    return user_id


def _entity(request: web.Request) -> Entity:
    entity = ENTITIES.get(request.match_info["key"])
    if entity is None:
        raise not_found("Bunday bo'lim yo'q")
    return entity


def _row_id(request: web.Request) -> int:
    try:
        return int(request.match_info["row_id"])
    except (KeyError, ValueError) as error:
        raise bad_request("Noto'g'ri id") from error


async def _body(request: web.Request) -> dict:
    try:
        data = await request.json()
    except Exception as error:
        raise bad_request("JSON formatida ma'lumot kutilgan") from error
    if not isinstance(data, dict):
        raise bad_request("JSON obyekt kutilgan")
    return data


def _fields(entity: Entity) -> dict[str, Field]:
    return {field.column: field for field in entity.fields}


def _is_media(field: Field) -> bool:
    return field.kind in ("photo", "video")


def _media_kind(field: Field) -> str:
    return "photo" if field.kind == "photo" else "video"


def _label(entity: Entity, row) -> str:
    try:
        return str(entity.label(row))
    except Exception:  # ustun yo'q yoki bo'sh bo'lsa panel yiqilmasin
        keys = row.keys()
        for column in ("name", "title"):
            if column in keys and row[column]:
                return str(row[column])
        return f"#{row['id']}"


async def _choice_values(field: Field) -> list[dict]:
    if field.choices is None:
        return []
    try:
        pairs = await field.choices()
    except Exception as error:
        logger.warning("«%s» uchun tanlovlar olinmadi: %s", field.label, error)
        return []
    return [{"value": value, "label": label} for value, label in pairs]


def _coerce(field: Field, value) -> object:
    """JSON qiymatni ustunga mos ko'rinishga keltiradi va tekshiradi."""
    empty = value is None or (isinstance(value, str) and not value.strip())
    if empty:
        if field.required:
            raise bad_request(f"«{field.label}» to'ldirilishi kerak")
        return None

    if field.kind in ("money", "int"):
        if isinstance(value, bool):
            raise bad_request(f"«{field.label}» — son kiriting")
        try:
            if isinstance(value, str):
                cleaned = value.replace(" ", "").replace("_", "").replace(",", "")
                number = int(float(cleaned))
            else:
                number = int(value)
        except (TypeError, ValueError) as error:
            raise bad_request(f"«{field.label}» — son kiriting. Masalan: 1900000") from error
        if number < 0:
            raise bad_request(f"«{field.label}» manfiy bo'lmasligi kerak")
        return number

    text = str(value).strip()

    if field.kind == "color":
        if not HEX.match(text):
            raise bad_request(f"«{field.label}» — rang #rrggbb ko'rinishida bo'lsin")
        return text.lower()

    if field.kind == "long":
        if len(text) > MAX_LONG:
            raise bad_request(f"«{field.label}» juda uzun ({MAX_LONG} belgidan kam bo'lsin)")
        return text

    if len(text) > MAX_TEXT:
        raise bad_request(f"«{field.label}» juda uzun ({MAX_TEXT} belgidan kam bo'lsin)")
    return text


async def _coerce_choice(field: Field, value) -> object:
    """Tanlov maydoni: qiymat ruxsat etilganlar ichida bo'lishi kerak."""
    allowed = await _choice_values(field)
    raw = "" if value is None else str(value).strip()

    if raw == "" or raw == "None":
        if field.required:
            raise bad_request(f"«{field.label}» tanlanishi kerak")
        return None

    if allowed and raw not in {str(item["value"]) for item in allowed}:
        raise bad_request(f"«{field.label}» uchun noto'g'ri qiymat tanlandi")

    if field.column.endswith("_id"):
        try:
            return int(raw)
        except ValueError as error:
            raise bad_request(f"«{field.label}» noto'g'ri") from error
    return raw


async def _value_for(field: Field, value) -> object:
    if field.kind == "choice":
        return await _coerce_choice(field, value)
    return _coerce(field, value)


def _media_state(table: str, row, kind: str) -> dict:
    """Media haqida panelga kerakli hamma narsa."""
    keys = row.keys()
    file_id = row[f"{kind}_id"] if f"{kind}_id" in keys else None
    raw_url = row[f"{kind}_url"] if f"{kind}_url" in keys else None
    url, external = media_url(table, row, kind)
    return {
        "url": url,
        "external": external,
        "raw_url": raw_url,
        "has_file": bool(file_id),
        "empty": not (file_id or raw_url),
    }


def _serialize(entity: Entity, row) -> dict:
    """Yozuvni panel uchun JSON ko'rinishiga keltiradi."""
    values = {key: row[key] for key in row.keys()}
    media = {}
    for field in entity.fields:
        if _is_media(field):
            kind = _media_kind(field)
            media[kind] = _media_state(entity.table, row, kind)

    return {
        "id": values.get("id"),
        "label": _label(entity, row),
        "is_active": int(values.get("is_active", 1) or 0),
        "values": values,
        "media": media,
        "price_label": fmt_price(values["price"]) if values.get("price") else None,
    }


# ------------------------------------------------------------------- dashboard


@admin_routes.get("/api/admin/summary")
async def admin_summary(request: web.Request) -> web.Response:
    """Panelning bosh menyusi: bo'limlar va ularning sonlari.

    Ataylab sodda: bu yerda raqamlar yo'q — statistika o'zining alohida
    oynasida, buyurtmalar va katalog ham alohida oynada ochiladi.
    """
    await _admin_id(request)

    sections = []
    for entity in ENTITIES.values():
        try:
            count = await q.admin_count(entity.table)
        except Exception as error:
            logger.warning("«%s» soni olinmadi: %s", entity.title, error)
            count = 0
        sections.append(
            {
                "key": entity.key,
                "title": entity.title,
                "icon": entity.icon,
                "count": count,
            }
        )

    stats = await q.get_stats(today_iso())
    return web.json_response(
        {
            "sections": sections,
            # Bosh menyudagi kichik belgilar (nechta yangi buyurtma bor)
            "badges": {
                "orders_new": int(stats["orders_new"]),
                "biled_new": int(stats["biled_new"]),
                "bookings_new": int(stats["bookings_new"]),
                "catalog": sum(section["count"] for section in sections),
            },
        }
    )


STAT_KINDS = ("products", "biled")


@admin_routes.get("/api/admin/stats/{kind}")
async def admin_stats(request: web.Request) -> web.Response:
    """Statistika. Ikki turi bir-biriga ARALASHMAYDI:

      • products — faqat do'kon (tovar) savdosi;
      • biled    — faqat topshirilgan Bi-LED o'rnatish ishlari
                   (usta ishni tugatgach hisoblanadi).
    """
    await _admin_id(request)

    kind = request.match_info["kind"]
    if kind not in STAT_KINDS:
        raise not_found("Bunday statistika yo'q")

    period = request.query.get("period") or "month"
    if period not in {key for key, _ in PERIODS}:
        period = "month"
    since = period_start(period)

    data = await (q.product_stats(since) if kind == "products" else q.biled_stats(since))

    if kind == "products":
        cards = [
            {"label": "Tushum", "value": fmt_price(data["revenue"]), "wide": True},
            {"label": "Buyurtma", "value": str(data["orders"])},
            {"label": "Sotilgan", "value": f"{data['units']} dona"},
            {"label": "O'rtacha", "value": fmt_price(data["average"])},
            {"label": "Yetkazildi", "value": str(data["delivered"])},
        ]
        notes = [
            {"label": "🆕 Yangi", "value": data["new"]},
            {"label": "❌ Bekor qilingan", "value": data["cancelled"]},
        ]
        lists = [{"title": "Eng ko'p sotilgan", "items": data["top"]}]
    else:
        cards = [
            {"label": "Tushum", "value": fmt_price(data["revenue"]), "wide": True},
            {"label": "O'rnatilgan", "value": str(data["done"])},
            {"label": "O'rtacha", "value": fmt_price(data["average"])},
        ]
        notes = [
            {"label": "🔧 Ish jarayonida", "value": data["in_work"]},
            {"label": "⏳ Navbatda", "value": data["waiting"]},
            {"label": "❌ Bekor qilingan", "value": data["cancelled"]},
        ]
        lists = [
            {"title": "Eng ko'p tanlangan linza", "items": data["top"]},
            {"title": "Mashinalar", "items": data["cars"]},
        ]

    for block in lists:
        for item in block["items"]:
            item["total_label"] = fmt_price(item["total"])

    return web.json_response(
        {
            "kind": kind,
            "title": "Tovarlar savdosi" if kind == "products" else "Bi-LED o'rnatish",
            "hint": (
                "Faqat do'kon buyurtmalari. Bekor qilinganlar tushumga kirmaydi."
                if kind == "products"
                else "Faqat topshirilgan ishlar — usta tugatgandan keyin hisoblanadi."
            ),
            "period": period,
            "periods": [{"value": key, "label": label} for key, label in PERIODS],
            "cards": cards,
            "notes": notes,
            "lists": lists,
        }
    )


@admin_routes.get("/api/admin/schema")
async def admin_schema(request: web.Request) -> web.Response:
    """Bo'limlar va ularning maydonlari — panel formani shu asosda yasaydi."""
    await _admin_id(request)

    sections = []
    for entity in ENTITIES.values():
        fields = []
        for field in entity.fields:
            item = {
                "column": field.column,
                "label": field.label,
                "kind": field.kind,
                "required": field.required,
                "hint": field.hint,
            }
            if field.kind == "choice":
                item["choices"] = await _choice_values(field)
            if _is_media(field):
                item["media_kind"] = _media_kind(field)
            fields.append(item)

        sections.append(
            {
                "key": entity.key,
                "title": entity.title,
                "icon": entity.icon,
                "create": list(entity.create),
                "fields": fields,
            }
        )

    return web.json_response({"sections": sections})


# --------------------------------------------------------------- katalog CRUD


@admin_routes.get("/api/admin/section/{key}")
async def section_list(request: web.Request) -> web.Response:
    await _admin_id(request)
    entity = _entity(request)
    rows = await q.admin_list(entity.table, limit=LIST_LIMIT)
    return web.json_response(
        {
            "key": entity.key,
            "title": entity.title,
            "icon": entity.icon,
            "items": [_serialize(entity, row) for row in rows],
        }
    )


@admin_routes.get("/api/admin/section/{key}/{row_id}")
async def section_get(request: web.Request) -> web.Response:
    await _admin_id(request)
    entity = _entity(request)
    row = await q.admin_get(entity.table, _row_id(request))
    if not row:
        raise not_found("Element topilmadi")
    return web.json_response({"item": _serialize(entity, row)})


@admin_routes.post("/api/admin/section/{key}")
async def section_create(request: web.Request) -> web.Response:
    admin_id = await _admin_id(request)
    entity = _entity(request)
    body = await _body(request)
    payload = body.get("values") if isinstance(body.get("values"), dict) else body

    fields = _fields(entity)
    values: dict[str, object] = {}
    media_urls: dict[str, str] = {}

    for column, field in fields.items():
        if _is_media(field):
            # Yaratishda media faqat URL bilan beriladi; fayl keyin yuklanadi
            given = payload.get(column) or payload.get(f"{_media_kind(field)}_url")
            if isinstance(given, str) and given.strip():
                url = given.strip()
                if not url.startswith("http"):
                    raise bad_request(f"«{field.label}» uchun https:// manzil yozing")
                media_urls[f"{_media_kind(field)}_url"] = url
            continue

        if column in payload:
            values[column] = await _value_for(field, payload[column])
        elif field.required or column in entity.create:
            values[column] = await _value_for(field, None)

    # Majburiy maydonlar tekshiruvi
    for column in entity.create:
        field = fields.get(column)
        if field and field.required and values.get(column) in (None, ""):
            raise bad_request(f"«{field.label}» to'ldirilishi kerak")

    values = {column: value for column, value in values.items() if value is not None}
    values.update(media_urls)
    values = await prepare_insert(entity, values)

    try:
        row_id = await q.admin_insert(entity.table, values)
    except Exception as error:
        logger.warning("«%s» ga qo'shishda xato: %s", entity.table, error)
        raise bad_request(f"Qo'shilmadi: {error}") from error

    row = await q.admin_get(entity.table, row_id)
    # Bulutga yozamiz — qayta deployda yo'qolmasin
    await sync.push_catalog(entity.table, row_id)
    logger.info("Admin %s «%s» ga yangi element qo'shdi: #%s", admin_id, entity.table, row_id)
    return web.json_response({"ok": True, "item": _serialize(entity, row)})


@admin_routes.patch("/api/admin/section/{key}/{row_id}")
async def section_update(request: web.Request) -> web.Response:
    admin_id = await _admin_id(request)
    entity = _entity(request)
    row_id = _row_id(request)

    row = await q.admin_get(entity.table, row_id)
    if not row:
        raise not_found("Element topilmadi")

    body = await _body(request)
    payload = body.get("values") if isinstance(body.get("values"), dict) else body
    if not isinstance(payload, dict) or not payload:
        raise bad_request("O'zgartirish uchun ma'lumot yuborilmadi")

    fields = _fields(entity)
    changed = 0

    for column, value in payload.items():
        field = fields.get(column)
        if field is None:
            continue  # tavsifda yo'q maydonlar e'tiborsiz qoldiriladi

        if _is_media(field):
            # Media: URL yozilsa *_url ga tushadi va file_id tozalanadi,
            # bo'sh yuborilsa ikkisi ham tozalanadi (bot paneli kabi).
            kind = _media_kind(field)
            text = "" if value is None else str(value).strip()
            if text and not text.startswith("http"):
                raise bad_request(f"«{field.label}» uchun https:// manzil yozing")
            await q.admin_update(entity.table, row_id, f"{kind}_url", text or None)
            await q.admin_update(entity.table, row_id, f"{kind}_id", None)
            changed += 1
            continue

        await q.admin_update(entity.table, row_id, column, await _value_for(field, value))
        changed += 1

    if not changed:
        raise bad_request("Hech qanday maydon o'zgartirilmadi")

    updated = await q.admin_get(entity.table, row_id)
    await sync.push_catalog(entity.table, row_id)
    logger.info(
        "Admin %s «%s» #%s da %s maydonni o'zgartirdi", admin_id, entity.table, row_id, changed
    )
    return web.json_response({"ok": True, "item": _serialize(entity, updated)})


@admin_routes.post("/api/admin/section/{key}/{row_id}/toggle")
async def section_toggle(request: web.Request) -> web.Response:
    await _admin_id(request)
    entity = _entity(request)
    row_id = _row_id(request)

    if "is_active" not in q.EDITABLE[entity.table]:
        raise bad_request("Bu bo'limda yoqish/o'chirish yo'q")
    if not await q.admin_get(entity.table, row_id):
        raise not_found("Element topilmadi")

    state = await q.admin_toggle(entity.table, row_id)
    row = await q.admin_get(entity.table, row_id)
    await sync.push_catalog(entity.table, row_id)
    return web.json_response({"ok": True, "is_active": state, "item": _serialize(entity, row)})


@admin_routes.delete("/api/admin/section/{key}/{row_id}")
async def section_delete(request: web.Request) -> web.Response:
    admin_id = await _admin_id(request)
    entity = _entity(request)
    row_id = _row_id(request)

    row = await q.admin_get(entity.table, row_id)
    if not row:
        raise not_found("Element topilmadi")
    # Nomni o'chirishdan OLDIN olib qolamiz — bulutda ham belgilash uchun
    key_value = row[q.CATALOG_KEY[entity.table]] if entity.table in q.CATALOG_KEY else None

    try:
        await q.admin_delete(entity.table, row_id)
    except Exception as error:
        # Masalan mashinaga bog'langan mahsulotlar bo'lsa (foreign key)
        logger.warning("«%s» #%s o'chirilmadi: %s", entity.table, row_id, error)
        raise bad_request(
            "O'chirilmadi — bu element boshqa yozuvlarga bog'langan bo'lishi mumkin. "
            "Uni o'chirish o'rniga «yashirish» tugmasini ishlatib ko'ring."
        ) from error

    await sync.delete_catalog(entity.table, row_id, key_value)
    logger.info("Admin %s «%s» #%s ni o'chirdi", admin_id, entity.table, row_id)
    return web.json_response({"ok": True})


# -------------------------------------------------------------- rasm va video


@admin_routes.post("/api/admin/section/{key}/{row_id}/media")
async def section_media_upload(request: web.Request) -> web.Response:
    """Rasm/video yuklash. Fayl Telegram'da saqlanadi, bazaga file_id yoziladi."""
    admin_id = await _admin_id(request)
    entity = _entity(request)
    row_id = _row_id(request)

    if not await q.admin_get(entity.table, row_id):
        raise not_found("Element topilmadi")

    try:
        form = await request.post()
    except Exception as error:
        raise bad_request("Fayl yuborilmadi") from error

    kind = str(form.get("kind") or "photo")
    if kind not in ("photo", "video"):
        raise bad_request("Faqat rasm yoki video")
    if f"{kind}_id" not in q.EDITABLE[entity.table]:
        raise bad_request("Bu bo'limga media qo'yilmaydi")

    upload = form.get("file")
    if upload is None or not hasattr(upload, "file"):
        raise bad_request("Fayl tanlanmadi")

    limit = MAX_PHOTO_BYTES if kind == "photo" else MAX_VIDEO_BYTES
    data = upload.file.read(limit + 1)
    if not data:
        raise bad_request("Fayl bo'sh")
    if len(data) > limit:
        raise bad_request(f"Fayl juda katta ({limit // (1024 * 1024)} MB dan kichik bo'lsin)")

    filename = getattr(upload, "filename", None) or f"{kind}.bin"
    bot = request.app["bot"]
    document = BufferedInputFile(data, filename=filename)
    caption = f"{entity.icon} {entity.title} #{row_id} — {kind} yuklandi (ilova orqali)"

    try:
        if kind == "photo":
            message = await bot.send_photo(admin_id, document, caption=caption)
            file_id = message.photo[-1].file_id
        else:
            message = await bot.send_video(admin_id, document, caption=caption)
            file_id = (message.video or message.document).file_id
    except Exception as error:
        logger.warning("Media Telegram'ga yuklanmadi: %s", error)
        raise bad_request(
            "Fayl yuklanmadi. Telegram rad etdi — hajmi yoki formatini tekshirib ko'ring."
        ) from error

    await q.admin_update(entity.table, row_id, f"{kind}_id", file_id)
    await q.admin_update(entity.table, row_id, f"{kind}_url", None)
    await sync.push_catalog(entity.table, row_id)

    row = await q.admin_get(entity.table, row_id)
    return web.json_response({"ok": True, "item": _serialize(entity, row)})


@admin_routes.delete("/api/admin/section/{key}/{row_id}/media/{kind}")
async def section_media_clear(request: web.Request) -> web.Response:
    await _admin_id(request)
    entity = _entity(request)
    row_id = _row_id(request)
    kind = request.match_info["kind"]

    if kind not in ("photo", "video"):
        raise bad_request("Faqat rasm yoki video")
    if f"{kind}_id" not in q.EDITABLE[entity.table]:
        raise bad_request("Bu bo'limga media qo'yilmaydi")
    if not await q.admin_get(entity.table, row_id):
        raise not_found("Element topilmadi")

    await q.admin_update(entity.table, row_id, f"{kind}_id", None)
    await q.admin_update(entity.table, row_id, f"{kind}_url", None)
    await sync.push_catalog(entity.table, row_id)

    row = await q.admin_get(entity.table, row_id)
    return web.json_response({"ok": True, "item": _serialize(entity, row)})


# ------------------------------------------------------------------ buyurtmalar

def _order_kind(request: web.Request) -> str:
    raw = request.match_info.get("kind") or request.query.get("kind") or "biled"
    kind = orders.resolve(raw)
    if not orders.known(kind):
        raise bad_request("Noto'g'ri buyurtma turi")
    return kind


def _order_row(kind: str, row) -> dict:
    values = {key: row[key] for key in row.keys()}
    status = values.get("status")
    item = {
        "id": values.get("id"),
        "status": status,
        "status_label": orders.label(kind, status),
        # Faqat shu holatdan o'tish MUMKIN bo'lgan tugmalar yuboriladi.
        # Ya'ni bekor qilingan buyurtmada «Qabul qilish» tugmasi umuman
        # ko'rinmaydi (ilgari ko'rinardi va bosilardi).
        "next": [
            {"value": target, "label": orders.flow(kind).buttons.get(target, target)}
            for target in orders.allowed_targets(kind, status)
        ],
        "closed": orders.is_final(kind, status),
        "user_id": values.get("user_id"),
        "name": values.get("full_name"),
        "phone": values.get("phone"),
        "username": values.get("username"),
        "created_at": values.get("created_at"),
    }

    if kind == "biled":
        item.update(
            {
                "total": values.get("total"),
                "total_label": fmt_price(values.get("total") or 0),
                "summary": " · ".join(
                    str(values[column])
                    for column in ("car_name", "biled_name", "shroud_name", "color_name")
                    if values.get(column)
                ),
                "comment": values.get("comment"),
            }
        )
    elif kind == "order":
        # Yetkazib berish va to'lov usulini admin ko'rishi uchun izohga qo'shamiz
        note_parts = []
        if values.get("delivery_info"):
            note_parts.append(f"🚚 {values['delivery_info']}")
        if values.get("payment_method"):
            note_parts.append(f"💳 {values['payment_method']}")
        item.update(
            {
                "total": values.get("total"),
                "total_label": fmt_price(values.get("total") or 0),
                "summary": values.get("address") or "",
                "comment": "\n".join(note_parts) or None,
                "delivery_method": values.get("delivery_method"),
                "payment_method": values.get("payment_method"),
            }
        )
    else:
        item.update(
            {
                "total": values.get("price"),
                "total_label": fmt_price(values.get("price") or 0),
                "summary": f"{values.get('service_name') or ''} · {values.get('time') or ''}",
                "date": values.get("date"),
                "time": values.get("time"),
            }
        )
    return item


@admin_routes.get("/api/admin/orders")
async def admin_orders(request: web.Request) -> web.Response:
    await _admin_id(request)
    kind = _order_kind(request)
    status = request.query.get("status") or None

    if kind == "biled":
        rows = await q.get_biled_orders(status, limit=40)
    elif kind == "order":
        rows = await q.get_orders(status, limit=40)
    else:
        date_iso = request.query.get("date") or today_iso()
        rows = await q.get_bookings_by_date(date_iso)
        if status:
            rows = [row for row in rows if row["status"] == status]

    flow = orders.flow(kind)
    return web.json_response(
        {
            "kind": kind,
            "title": flow.title,
            "icon": flow.icon,
            # Filtrlar uchun barcha holatlar
            "statuses": [
                {"value": value, "label": label} for value, label in flow.labels.items()
            ],
            "items": [_order_row(kind, row) for row in rows],
        }
    )


@admin_routes.post("/api/admin/orders/{kind}/{row_id}/status")
async def admin_order_status(request: web.Request) -> web.Response:
    admin_id = await _admin_id(request)
    kind = _order_kind(request)
    row_id = _row_id(request)

    body = await _body(request)
    status = str(body.get("status") or "").strip()
    flow = orders.flow(kind)
    if status not in flow.labels:
        raise bad_request("Noto'g'ri holat")

    if kind == "biled":
        order = await q.get_biled_order(row_id)
    elif kind == "order":
        order = await q.get_order(row_id)
    else:
        order = await q.get_booking(row_id)
    if not order:
        raise not_found("Buyurtma topilmadi")

    # Bekor qilingan yoki yopilgan buyurtmani qayta ochib bo'lmaydi
    allowed, reason = orders.check(kind, order["status"], status)
    if not allowed:
        raise bad_request(
            orders.reason_text(kind, order["status"], status, reason),
            {"status": order["status"], "status_label": orders.label(kind, order["status"])},
        )

    # Baza + ombor (bekor qilinsa tovar qaytadi) + Firebase
    await orders.apply(kind, row_id, status)

    # Mijozga xabar beramiz — holat o'zgargani bilinib turishi kerak
    bot = request.app["bot"]
    try:
        await bot.send_message(
            order["user_id"],
            f"{flow.icon} <b>#{row_id}</b> holati yangilandi:\n{flow.labels[status]}",
        )
    except Exception as error:
        logger.info("Mijozga (%s) holat xabari yuborilmadi: %s", order["user_id"], error)

    logger.info("Admin %s %s #%s holatini «%s» qildi", admin_id, kind, row_id, status)
    return web.json_response(
        {
            "ok": True,
            "status": status,
            "status_label": flow.labels[status],
            "next": [
                {"value": target, "label": flow.buttons.get(target, target)}
                for target in orders.allowed_targets(kind, status)
            ],
            "closed": orders.is_final(kind, status),
        }
    )
