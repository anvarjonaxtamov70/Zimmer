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

import asyncio
import json
import logging

from aiogram.types import BufferedInputFile
from aiohttp import web

from api.auth import extract_init_data, validate_init_data
from api.errors import bad_request, forbidden, not_found, unauthorized
from api.media import media_url
from config import config, is_admin, service_video_allowed
from database import queries as q
from handlers.admin_schema import ENTITIES, HEX, Entity, Field, prepare_insert
from services import firebase_storage as fb_storage
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


def db_error_text(error: Exception) -> str:
    """Baza xatosini ODAM TUSHUNADIGAN matnga o'giradi.

    Ilgari xato matni `f"Qo'shilmadi: {error}"` ko'rinishida to'g'ridan
    qaytarilardi — ya'ni javobda SQLite'ning ichki matni (jadval nomi,
    ustun nomi, cheklov nomi) ko'rinardi. Bu bazaning tuzilishini oshkor
    qiladi va foydalanuvchiga hech narsa tushuntirmaydi.

    To'liq tafsilot log'ga yoziladi (chaqiruvchi `logger.exception` qiladi),
    javobda esa faqat sabab turi qoladi.
    """
    text = str(error).lower()

    if "unique" in text:
        return "Bunday yozuv allaqachon bor"
    if "not null" in text:
        return "Majburiy maydon to'ldirilmagan"
    if "foreign key" in text:
        return "Bog'langan yozuv topilmadi (kategoriya yoki mashina)"
    if "no such column" in text or "no such table" in text:
        return "Baza tuzilishi mos kelmadi — administratorga xabar bering"
    if "datatype" in text or "type" in text:
        return "Qiymat turi mos kelmadi"
    if "locked" in text or "busy" in text:
        return "Baza band — bir necha soniyadan keyin qayta urinib ko'ring"
    return "Saqlanmadi — kiritilgan qiymatlarni tekshirib ko'ring"


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

    # Barcha variantlar SON bo'lsa (masalan «Tez kunda»: 0 / 1) — songa
    # o'giramiz. Aks holda INTEGER ustunga matn tushib, keyinchalik
    # `COALESCE(coming_soon, 0) = 0` kabi solishtirishlar kutilmagan
    # natija berishi mumkin edi.
    if allowed and all(str(item["value"]).lstrip("-").isdigit() for item in allowed):
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


# Mini App admin menyusida ko'rsatilmaydigan bo'limlar.
#   prd — «Ombor» va «Tovar qo'shish» oynalari bor;
#   sto — stories FAQAT Telegram bot orqali boshqariladi (video yuborish
#         bot ichida qulay va ishonchli: fayl Telegram'da saqlanadi).
MENU_HIDDEN = {"prd", "sto"}

# Ombor chegaralari: shu sondan kam qolsa "kam qoldi" deb belgilanadi
LOW_STOCK = 3


@admin_routes.get("/api/admin/summary")
async def admin_summary(request: web.Request) -> web.Response:
    """Panelning bosh menyusi: bo'limlar va ularning sonlari.

    Ataylab sodda: bu yerda raqamlar yo'q — statistika o'zining alohida
    oynasida, buyurtmalar va katalog ham alohida oynada ochiladi.
    """
    await _admin_id(request)

    sections = []
    for entity in ENTITIES.values():
        # «Mahsulotlar» bo'limi menyuda ko'rsatilmaydi — uning o'rniga
        # «Ombor» va «Tovar qo'shish» oynalari bor (tahrirlash shu entity
        # orqali ishlaydi, faqat menyudan yashirilgan).
        if entity.key in MENU_HIDDEN:
            continue
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
        logger.exception("«%s» ga qo'shishda xato", entity.table)
        raise bad_request(f"Qo'shilmadi. {db_error_text(error)}") from error

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

    # Bitta so'rovda tema va video BIRGA kelishi mumkin. Video cheklovi
    # YANGI tema bo'yicha tekshirilishi kerak, shuning uchun uni tsikldan
    # oldin hisoblab olamiz (payload'da bo'lsa — o'sha, aks holda bazadagi).
    effective_theme = (
        str(payload["theme"]).strip() if "theme" in payload else _row_theme(row)
    )

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
            # Video QO'YILAYOTGAN bo'lsa cheklovni tekshiramiz. Tozalash
            # (bo'sh qiymat) har doim ruxsat etiladi.
            if text:
                _guard_service_video(entity, kind, effective_theme)
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


def _row_theme(row) -> str | None:
    keys = row.keys()
    return row["theme"] if "theme" in keys else None


def _guard_service_video(entity: Entity, kind: str, theme: str | None) -> None:
    """Xizmat videosi FAQAT uchta fara ishiga qo'yiladi.

    Qoida `config.VIDEO_SERVICE_THEMES` da (yagona manba). Tekshiruv IKKI
    joyda chaqiriladi — fayl yuklashda va URL yozishda — aks holda
    bittasi orqali chetlab o'tish mumkin bo'lardi.

    Tema bo'yicha tekshiriladi, nom bo'yicha emas: admin xizmat nomini
    o'zgartirsa ham qoida buzilmaydi.

    `theme` ARGUMENT sifatida keladi, chunki bitta so'rovda tema va video
    BIRGA o'zgarishi mumkin — bunda YANGI tema bo'yicha qaror qilinadi.
    """
    if entity.table != "services" or kind != "video":
        return
    if service_video_allowed(theme):
        return
    raise bad_request(
        "Videoni faqat fara xizmatlariga qo'yish mumkin: "
        "polirovka, ichini tozalash va shisha almashtirish. "
        "Kerak bo'lsa avval «Dizayn» maydonini shu turlardan biriga o'zgartiring."
    )


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
    # photo2/photo3 — mahsulotning qo'shimcha rasmlari
    if kind not in ("photo", "photo2", "photo3", "video"):
        raise bad_request("Faqat rasm yoki video")
    if f"{kind}_id" not in q.EDITABLE[entity.table]:
        raise bad_request("Bu bo'limga media qo'yilmaydi")

    row = await q.admin_get(entity.table, row_id)
    _guard_service_video(entity, kind, _row_theme(row))

    upload = form.get("file")
    if upload is None or not hasattr(upload, "file"):
        raise bad_request("Fayl tanlanmadi")

    limit = MAX_VIDEO_BYTES if kind == "video" else MAX_PHOTO_BYTES
    # DIQQAT: `upload.file.read()` BLOKLAYDI. Video uchun chegara 45 MB —
    # ya'ni shu qator ishlayotgan payt bot polling'i, Mini App API'si va
    # `/health` HAMMASI to'xtab turardi (hammasi bitta event loop'da).
    # `/health` javob bermasa Render xizmatni qayta ishga tushiradi va
    # SQLite fayli tozalanadi. Shuning uchun alohida ipda o'qiymiz.
    data = await asyncio.to_thread(upload.file.read, limit + 1)
    if not data:
        raise bad_request("Fayl bo'sh")
    if len(data) > limit:
        raise bad_request(f"Fayl juda katta ({limit // (1024 * 1024)} MB dan kichik bo'lsin)")

    filename = getattr(upload, "filename", None) or f"{kind}.bin"
    bot = request.app["bot"]
    document = BufferedInputFile(data, filename=filename)
    caption = f"{entity.icon} {entity.title} #{row_id} — {kind} yuklandi (ilova orqali)"

    try:
        if kind != "video":
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

    # ------------------------------------------------------------------
    #  Faylni Firebase Storage'ga ham ko'chiramiz — DOIMIY URL olish uchun.
    #
    #  Ilgari bu yerda `{kind}_url` MAJBURAN None qilinardi, ya'ni yagona
    #  manba Telegram `file_id` bo'lib qolardi. `file_id` ni esa faqat bot
    #  tokeni bilan ochish mumkin — demak rasm ko'rinishi Render'dagi
    #  `/api/media/...` proksisiga bog'liq edi. Render o'chsa, ilovada
    #  BARCHA rasmlar yo'qolardi.
    #
    #  Storage URL'i brauzerda to'g'ridan-to'g'ri ochiladi, shuning uchun
    #  Mini App'ning zaxira rejimi ham to'liq ko'rinadi. Storage sozlanmagan
    #  bo'lsa — eski xatti-harakat saqlanadi (url = None).
    # ------------------------------------------------------------------
    storage_url = None
    if fb_storage.is_storage_enabled():
        ext = "mp4" if kind == "video" else "jpg"
        candidate = await fb_storage.upload_telegram_file(
            bot,
            file_id,
            f"{entity.table}/{row_id}/{kind}.{ext}",
            content_type="video/mp4" if kind == "video" else "image/jpeg",
            max_bytes=limit,
        )
        # Muvaffaqiyatsizlikda funksiya file_id ni qaytaradi — uni URL deb
        # yozib qo'ymaymiz, aks holda rasm butunlay ochilmasdi.
        if candidate and str(candidate).startswith("http"):
            storage_url = candidate

    await q.admin_update(entity.table, row_id, f"{kind}_url", storage_url)
    await sync.push_catalog(entity.table, row_id)

    row = await q.admin_get(entity.table, row_id)
    return web.json_response({"ok": True, "item": _serialize(entity, row)})


@admin_routes.delete("/api/admin/section/{key}/{row_id}/media/{kind}")
async def section_media_clear(request: web.Request) -> web.Response:
    await _admin_id(request)
    entity = _entity(request)
    row_id = _row_id(request)
    kind = request.match_info["kind"]

    if kind not in ("photo", "photo2", "photo3", "video"):
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



# ==========================================================================
# OMBOR (inventory) va YANGI TOVAR QO'SHISH
#
# «Mahsulotlar» bo'limi o'rniga ikki alohida oyna:
#   • Ombor — qoldiqni tez ko'rish va o'zgartirish (kam qolgan/tugagan);
#   • Tovar qo'shish — to'liq forma (rasmlar, nom, narx, aksiya, razmerlar).
#
# Razmerli tovarda qoldiq `sizes` (JSON) ichida saqlanadi:
#     [{"size": "92.5", "stock": 4}, ...]
# Bunda `stock` ustuni razmerlar yig'indisiga teng bo'lib turadi — savat va
# buyurtma mantig'i o'zgarmaydi (u faqat `stock` bilan ishlaydi).
# ==========================================================================


def _parse_sizes(raw) -> list[dict]:
    """Razmerlar ro'yxatini tozalab qaytaradi (bo'sh qatorlar tashlanadi)."""
    if isinstance(raw, str):
        try:
            raw = json.loads(raw)
        except Exception:
            return []
    if not isinstance(raw, list):
        return []
    out = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        size = str(item.get("size") or "").strip()[:40]
        if not size:
            continue
        try:
            stock = max(0, int(item.get("stock") or 0))
        except (TypeError, ValueError):
            stock = 0
        out.append({"size": size, "stock": stock})
    return out[:40]


def _sizes_of(row) -> list[dict]:
    keys = row.keys()
    return _parse_sizes(row["sizes"]) if "sizes" in keys else []


def _inventory_item(row) -> dict:
    keys = row.keys()
    sizes = _sizes_of(row)
    stock = int(row["stock"] or 0)
    photo, _ = media_url("products", row, "photo")
    return {
        "id": row["id"],
        "name": row["name"],
        "code": row["code"] if "code" in keys else None,
        "price": int(row["price"] or 0),
        "price_label": fmt_price(row["price"] or 0),
        "old_price": int(row["old_price"]) if ("old_price" in keys and row["old_price"]) else None,
        "stock": stock,
        "unit": (row["unit"] if "unit" in keys else None) or "dona",
        "product_type": (row["product_type"] if "product_type" in keys else None) or "oddiy",
        "sizes": sizes,
        "is_active": bool(row["is_active"]),
        "photo_url": photo,
        "low": 0 < stock <= LOW_STOCK,
        "out": stock <= 0,
    }


@admin_routes.get("/api/admin/inventory")
async def admin_inventory(request: web.Request) -> web.Response:
    """Ombor: barcha tovar + xulosa (jami / kam qolgan / tugagan / qiymat)."""
    await _admin_id(request)

    rows = await q.admin_list("products", limit=500)
    items = [_inventory_item(row) for row in rows]

    # Tartib: tugagan → kam qolgan → yetarli (eng muhimi tepada)
    items.sort(key=lambda i: 0 if i["out"] else (1 if i["low"] else 2))

    total_value = sum(i["price"] * i["stock"] for i in items)
    return web.json_response(
        {
            "items": items,
            "summary": {
                "total": len(items),
                "low": sum(1 for i in items if i["low"]),
                "out": sum(1 for i in items if i["out"]),
                "hidden": sum(1 for i in items if not i["is_active"]),
                "value": total_value,
                "value_label": fmt_price(total_value),
            },
            "low_stock": LOW_STOCK,
        }
    )


@admin_routes.post("/api/admin/inventory/{row_id}/stock")
async def admin_inventory_stock(request: web.Request) -> web.Response:
    """Qoldiqni tez saqlash. Oddiy tovar: {stock}. Razmerli: {sizes:[...]}."""
    admin_id = await _admin_id(request)
    try:
        row_id = int(request.match_info["row_id"])
    except ValueError as error:
        raise bad_request("Noto'g'ri id") from error

    row = await q.admin_get("products", row_id)
    if not row:
        raise not_found("Tovar topilmadi")

    body = await _body(request)

    if "sizes" in body:
        sizes = _parse_sizes(body.get("sizes"))
        total = sum(s["stock"] for s in sizes)
        payload = {
            "sizes": json.dumps(sizes, ensure_ascii=False),
            "product_type": "razmerli",
            "stock": total,
        }
    else:
        try:
            payload = {"stock": max(0, int(body.get("stock") or 0))}
        except (TypeError, ValueError) as error:
            raise bad_request("Qoldiq noto'g'ri") from error

    try:
        for column, value in payload.items():
            await q.admin_update("products", row_id, column, value)
    except Exception as error:
        logger.exception("Qoldiq saqlanmadi (#%s)", row_id)
        raise bad_request(db_error_text(error)) from error

    await sync.push_catalog("products", row_id)

    fresh = await q.admin_get("products", row_id)
    logger.info("Admin %s #%s qoldig'ini yangiladi", admin_id, row_id)
    return web.json_response({"ok": True, "item": _inventory_item(fresh)})


@admin_routes.post("/api/admin/products")
async def admin_create_product(request: web.Request) -> web.Response:
    """Yangi tovar (to'liq forma: rasmlar, nom, narx, aksiya, razmerlar).

    Rasmlar ikki yo'l bilan keladi:
      • URL — shu yerda saqlanadi (photo_url / photo2_url / photo3_url);
      • telefondan fayl — element yaratilgandan keyin `.../media` orqali
        yuklanadi (mavjud oqim, Telegram file_id sifatida saqlanadi).
    """
    admin_id = await _admin_id(request)
    body = await _body(request)

    name = str(body.get("name") or "").strip()[:160]
    if len(name) < 2:
        raise bad_request("Tovar nomini yozing")

    def money(key: str) -> int | None:
        raw = body.get(key)
        if raw in (None, "", "null"):
            return None
        digits = "".join(ch for ch in str(raw) if ch.isdigit())
        return int(digits) if digits else None

    price = money("price")
    if not price:
        raise bad_request("Narxni kiriting")

    old_price = money("old_price")
    if old_price is not None and old_price <= price:
        # Aksiya narxi asl narxdan past bo'lishi kerak — aks holda chegirma yo'q
        old_price = None

    product_type = "razmerli" if str(body.get("product_type") or "") == "razmerli" else "oddiy"
    sizes = _parse_sizes(body.get("sizes")) if product_type == "razmerli" else []
    if product_type == "razmerli" and not sizes:
        raise bad_request("Kamida bitta razmer va uning soni kerak")

    if product_type == "razmerli":
        stock = sum(s["stock"] for s in sizes)
    else:
        try:
            stock = max(0, int(body.get("stock") or 0))
        except (TypeError, ValueError):
            stock = 0

    unit = "komplekt" if str(body.get("unit") or "") == "komplekt" else "dona"

    # Mashina: bo'sh yoki noto'g'ri bo'lsa — universal tovar (barcha mashinaga).
    # Mavjudligini tekshiramiz, aks holda FOREIGN KEY xatosi chiqadi.
    car_id = None
    raw_car = body.get("car_id")
    if raw_car not in (None, "", "null"):
        try:
            car_id = int(raw_car)
        except (TypeError, ValueError):
            car_id = None
        if car_id is not None and await q.admin_get("cars", car_id) is None:
            logger.info("Tovar qo'shishda mashina #%s topilmadi — universal qilindi", car_id)
            car_id = None

    values: dict = {
        "name": name,
        "price": price,
        "stock": stock,
        "unit": unit,
        "product_type": product_type,
        "sizes": json.dumps(sizes, ensure_ascii=False) if sizes else None,
        "description": str(body.get("description") or "").strip()[:2000] or None,
        "code": str(body.get("code") or "").strip()[:60] or None,
        "badge": str(body.get("badge") or "").strip()[:40] or None,
        "old_price": old_price,
        "car_id": car_id,
    }

    # Rasm manzillari (ixtiyoriy)
    for column, key in (
        ("photo_url", "photo_url"),
        ("photo2_url", "photo2_url"),
        ("photo3_url", "photo3_url"),
    ):
        url = str(body.get(key) or "").strip()
        if url.startswith("http"):
            values[column] = url[:500]

    values = {column: value for column, value in values.items() if value is not None}
    entity = ENTITIES["prd"]

    # Butun yozish jarayonini o'rab olamiz: kutilmagan xato bo'lsa ham mijoz
    # «Serverda xatolik» emas, ANIQ sababni ko'radi (log'da to'liq traceback).
    try:
        values = await prepare_insert(entity, values)  # standart kategoriya + tartib
        row_id = await q.admin_insert("products", values)
    except Exception as error:
        logger.exception("Tovar qo'shilmadi (values=%s)", values)
        raise bad_request(f"Qo'shilmadi. {db_error_text(error)}") from error

    # Bulutga yozish — nosozlik bo'lsa ham tovar allaqachon saqlangan
    await sync.push_catalog("products", row_id)

    try:
        row = await q.admin_get("products", row_id)
        item = _inventory_item(row)
    except Exception as error:
        logger.exception("Tovar #%s o'qilmadi", row_id)
        raise bad_request(
            f"Tovar qo'shildi (#{row_id}), lekin ro'yxatda ko'rinmadi. "
            "Ombor bo'limini yangilang."
        ) from error

    logger.info("Admin %s yangi tovar qo'shdi: #%s «%s»", admin_id, row_id, name)
    return web.json_response({"ok": True, "item": item}, status=201)
