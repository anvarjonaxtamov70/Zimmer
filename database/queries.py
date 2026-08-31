"""Bazaga so'rovlar. Har bir funksiya aiosqlite.Row yoki oddiy tip qaytaradi."""

import hashlib
import json
import logging
import re
from collections.abc import AsyncIterator, Sequence
from contextlib import asynccontextmanager
from typing import Any

import aiosqlite

from config import config
from database.db import get_db, write_lock
from utils import stories as story_cfg

logger = logging.getLogger(__name__)


class SlotTaken(Exception):
    """Navbat vaqti band yoki tanlash uchun yaroqsiz."""


class IdempotencyConflict(Exception):
    """Bir idempotent kalit boshqa normalizatsiyalangan so'rovga tegishli."""


class DuplicateSizeLabel(ValueError):
    """Razmer nomi bo'shliq/harf registri normalizatsiyasidan keyin takrorlangan."""


MAX_SIZE_LEN = 40
MAX_ITEM_QTY = 1000


@asynccontextmanager
async def _write_transaction() -> AsyncIterator[aiosqlite.Connection]:
    """Ko'p qadamli yozuv uchun alohida SQLite ulanish/tranzaksiya beradi.

    Asosiy ulanish umumiy bo'lgani uchun boshqa coroutine'ning ``commit``i
    bizning tranzaksiyani erta yopib qo'yishi mumkin. Alohida ulanish bu
    xavfni yo'qotadi; ``BEGIN IMMEDIATE`` esa boshqa process yozuvlarini ham
    yakuniy commitgacha kutdiradi.
    """
    db = await aiosqlite.connect(config.db_path)
    db.row_factory = aiosqlite.Row
    try:
        await db.execute("PRAGMA foreign_keys = ON")
        await db.execute("PRAGMA busy_timeout = 5000")
        await db.execute("BEGIN IMMEDIATE")
        yield db
        await db.commit()
    except Exception:
        await db.rollback()
        raise
    finally:
        await db.close()


async def _fetch_product(db: aiosqlite.Connection, product_id: int):
    async with db.execute("SELECT * FROM products WHERE id = ?", (product_id,)) as cur:
        return await cur.fetchone()


async def _find_order_by_key(db: aiosqlite.Connection, key: str):
    async with db.execute("SELECT * FROM orders WHERE idempotency_key = ?", (key,)) as cur:
        return await cur.fetchone()


def _normalize_size(value: Any) -> str | None:
    text = " ".join(str(value or "").split())
    return text[:MAX_SIZE_LEN] or None


def _size_key(value: Any) -> str:
    return (_normalize_size(value) or "").casefold()


def normalize_product_sizes(
    raw: Any, *, reject_duplicates: bool = False
) -> list[dict[str, Any]]:
    """Razmer JSON'ini tozalaydi; mutationda normalizatsiyalangan dublikatni rad etadi."""
    try:
        values = json.loads(raw) if isinstance(raw, str) else raw
    except (TypeError, ValueError, json.JSONDecodeError):
        return []
    if not isinstance(values, list):
        return []

    result: list[dict[str, Any]] = []
    seen: set[str] = set()
    for item in values:
        if not isinstance(item, dict):
            continue
        size = _normalize_size(item.get("size"))
        if not size:
            continue
        key = _size_key(size)
        if key in seen:
            if reject_duplicates:
                raise DuplicateSizeLabel(f"Takroriy razmer: {size}")
            # Eski buzilgan yozuv ikki variant sifatida sotilmasin.
            continue
        seen.add(key)
        try:
            stock = max(0, int(item.get("stock") or 0))
        except (TypeError, ValueError):
            stock = 0
        result.append({"size": size, "stock": stock})
    return result


def _product_sizes(product) -> list[dict[str, Any]]:
    """Mahsulot razmerlarini xavfsiz, bir xil ko'rinishda qaytaradi."""
    try:
        raw = product["sizes"]
    except (KeyError, IndexError, TypeError):
        return []
    return normalize_product_sizes(raw)


def product_has_sizes(product) -> bool:
    """Botning razmer tanlay olmaydigan savat oqimi uchun variant belgisi."""
    return bool(_product_sizes(product))


def _fingerprint_text(value: Any, *, fold: bool = True) -> str:
    text = " ".join(str(value or "").split())
    return text.casefold() if fold else text


def _fingerprint_phone(value: Any) -> str:
    return "".join(ch for ch in str(value or "") if ch.isdigit())


def _order_request_fingerprint(
    user_id: int,
    items: dict[tuple[int, str | None], int],
    address: str,
    phone: str,
    delivery_method: str | None,
    delivery_info: str | None,
    payment_method: str | None,
) -> str:
    payload = {
        "user_id": int(user_id),
        "items": [
            [product_id, _size_key(size) or None, int(qty)]
            for (product_id, size), qty in sorted(
                items.items(), key=lambda entry: (entry[0][0], _size_key(entry[0][1]))
            )
        ],
        "address": _fingerprint_text(address),
        "phone": _fingerprint_phone(phone),
        "delivery_method": _fingerprint_text(delivery_method),
        "delivery_info": _fingerprint_text(delivery_info),
        "payment_method": _fingerprint_text(payment_method),
    }
    encoded = json.dumps(payload, ensure_ascii=False, separators=(",", ":"), sort_keys=True)
    return hashlib.sha256(encoded.encode("utf-8")).hexdigest()


async def _stored_order_fingerprint(db: aiosqlite.Connection, order) -> str:
    wanted: dict[tuple[int, str | None], int] = {}
    async with db.execute(
        "SELECT product_id, qty, size FROM order_items WHERE order_id = ?",
        (order["id"],),
    ) as cur:
        rows = await cur.fetchall()
    for row in rows:
        if row["product_id"] is None:
            continue
        key = (int(row["product_id"]), _normalize_size(row["size"]))
        wanted[key] = wanted.get(key, 0) + int(row["qty"] or 0)
    return _order_request_fingerprint(
        int(order["user_id"]),
        wanted,
        order["address"],
        order["phone"],
        order["delivery_method"],
        order["delivery_info"],
        order["payment_method"],
    )


async def _replay_order_id(
    db: aiosqlite.Connection, key: str, fingerprint: str
) -> int | None:
    existing = await _find_order_by_key(db, key)
    if existing is None:
        return None
    stored = existing["idempotency_fingerprint"]
    if not stored:
        stored = await _stored_order_fingerprint(db, existing)
        await db.execute(
            "UPDATE orders SET idempotency_fingerprint = ? WHERE id = ?",
            (stored, existing["id"]),
        )
    if stored != fingerprint:
        raise IdempotencyConflict(key)
    return int(existing["id"])


def _stock_problem(product_id: int, product, reason: str, available: int = 0, **extra):
    problem = {
        "product_id": product_id,
        "name": product["name"] if product is not None else "Tovar",
        "reason": reason,
        "available": max(0, int(available)),
    }
    problem.update(extra)
    return problem


async def _reserve_product_stock(
    db: aiosqlite.Connection,
    product,
    qty: int,
    size: str | None,
) -> tuple[bool, dict[str, Any] | None]:
    """Umumiy va razmer qoldig'ini bitta shartli UPDATE bilan kamaytiradi."""
    product_id = int(product["id"])
    size = _normalize_size(size)
    sizes = _product_sizes(product)

    if sizes:
        if not size:
            return False, _stock_problem(product_id, product, "size_required")
        variant = next(
            (item for item in sizes if _size_key(item["size"]) == _size_key(size)), None
        )
        if variant is None:
            return False, _stock_problem(
                product_id, product, "invalid_size", size=size
            )
        if int(variant["stock"]) < qty:
            return False, _stock_problem(
                product_id,
                product,
                "out_of_stock",
                int(variant["stock"]),
                size=size,
            )
        variant["stock"] = int(variant["stock"]) - qty
        raw_sizes = product["sizes"]
        cur = await db.execute(
            "UPDATE products SET stock = stock - ?, sizes = ?"
            " WHERE id = ? AND is_active = 1 AND stock >= ? AND sizes IS ?",
            (
                qty,
                json.dumps(sizes, ensure_ascii=False),
                product_id,
                qty,
                raw_sizes,
            ),
        )
    else:
        if size:
            return False, _stock_problem(
                product_id, product, "invalid_size", size=size
            )
        cur = await db.execute(
            "UPDATE products SET stock = stock - ?"
            " WHERE id = ? AND is_active = 1 AND stock >= ?",
            (qty, product_id, qty),
        )

    if int(cur.rowcount or 0) > 0:
        return True, None

    async with db.execute("SELECT * FROM products WHERE id = ?", (product_id,)) as cursor:
        fresh = await cursor.fetchone()
    if not fresh or not fresh["is_active"]:
        return False, _stock_problem(product_id, product, "not_found")
    fresh_sizes = _product_sizes(fresh)
    available = int(fresh["stock"] or 0)
    if size and fresh_sizes:
        fresh_variant = next((item for item in fresh_sizes if item["size"] == size), None)
        if fresh_variant is None:
            return False, _stock_problem(product_id, fresh, "invalid_size", size=size)
        available = int(fresh_variant["stock"])
    return False, _stock_problem(
        product_id, fresh, "out_of_stock", available, **({"size": size} if size else {})
    )


async def _restore_product_stock(
    db: aiosqlite.Connection, product_id: int, qty: int, size: str | None
) -> bool:
    """Bekor qilingan qatorning umumiy va variant qoldig'ini qaytaradi."""
    if qty <= 0:
        return False
    async with db.execute("SELECT * FROM products WHERE id = ?", (product_id,)) as cur:
        product = await cur.fetchone()
    if product is None:
        return False

    normalized = _normalize_size(size)
    sizes = _product_sizes(product)
    if normalized:
        variant = next(
            (item for item in sizes if _size_key(item["size"]) == _size_key(normalized)),
            None,
        )
        if variant is None:
            sizes.append({"size": normalized, "stock": qty})
        else:
            variant["stock"] = int(variant["stock"]) + qty
        await db.execute(
            "UPDATE products SET stock = stock + ?, sizes = ? WHERE id = ?",
            (qty, json.dumps(sizes, ensure_ascii=False), product_id),
        )
    else:
        await db.execute(
            "UPDATE products SET stock = stock + ? WHERE id = ?", (qty, product_id)
        )
    return True


# ------------------------------------------------------------------- ombor
#
#  Qoldiqni O'QIB, keyin kamaytirish XATO: ikki so'rov orasida boshqa mijoz
#  o'sha tovarni olib qo'yishi mumkin (TOCTOU). Quyidagi ikki funksiya
#  qoldiqni BITTA shartli SQL bilan o'zgartiradi — SQLite bu amalni
#  bo'linmas bajaradi, ya'ni oxirgi dona ikki kishiga sotilmaydi.


async def take_stock(product_id: int, qty: int) -> bool:
    """Omborni ATOMIK kamaytiradi. Yetarli bo'lmasa hech nima o'zgarmaydi.

    Qaytaradi: kamaytirildimi (False — qoldiq yetmadi).
    """
    if qty <= 0:
        return False
    db = get_db()
    cur = await db.execute(
        "UPDATE products SET stock = stock - ? WHERE id = ? AND stock >= ?",
        (qty, product_id, qty),
    )
    return int(cur.rowcount or 0) > 0


async def return_stock(product_id: int, qty: int) -> None:
    """Kamaytirilgan qoldiqni qaytaradi (buyurtma yaratilmasa — orqaga qadam)."""
    if qty <= 0:
        return
    db = get_db()
    await db.execute(
        "UPDATE products SET stock = stock + ? WHERE id = ?", (qty, product_id)
    )

# ---------------------------------------------------------------- foydalanuvchi


async def add_user(user_id: int, full_name: str, phone: str | None, username: str | None) -> None:
    db = get_db()
    await db.execute(
        "INSERT INTO users (user_id, full_name, phone, username) VALUES (?, ?, ?, ?)"
        " ON CONFLICT(user_id) DO UPDATE SET"
        " full_name = excluded.full_name,"
        " phone = COALESCE(excluded.phone, users.phone),"
        " username = excluded.username",
        (user_id, full_name, phone, username),
    )
    await db.commit()


async def touch_user(user_id: int, full_name: str, username: str | None) -> None:
    """Foydalanuvchini "ko'rdim" deb belgilaydi (har bir xabarda chaqiriladi).

    `add_user`dan farqi: ro'yxatdan o'tgan mijozning (telefoni bor)
    ismini Telegram profilidagi nom bilan ALMASHTIRMAYDI. Ya'ni mijoz
    "Anvarjon Axtamov" deb yozgan bo'lsa, u shundayligicha qoladi.
    """
    db = get_db()
    await db.execute(
        "INSERT INTO users (user_id, full_name, username) VALUES (?, ?, ?)"
        " ON CONFLICT(user_id) DO UPDATE SET"
        " username = COALESCE(excluded.username, users.username),"
        " full_name = CASE"
        "   WHEN users.phone IS NULL AND excluded.full_name IS NOT NULL"
        "        AND TRIM(excluded.full_name) <> ''"
        "   THEN excluded.full_name ELSE users.full_name END",
        (user_id, full_name, username),
    )
    await db.commit()


async def get_user(user_id: int) -> aiosqlite.Row | None:
    db = get_db()
    async with db.execute("SELECT * FROM users WHERE user_id = ?", (user_id,)) as cur:
        return await cur.fetchone()


async def update_phone(user_id: int, phone: str) -> None:
    db = get_db()
    await db.execute("UPDATE users SET phone = ? WHERE user_id = ?", (phone, user_id))
    await db.commit()


async def get_user_with_car(user_id: int) -> aiosqlite.Row | None:
    """Foydalanuvchi + tanlagan mashinasi nomi bilan."""
    db = get_db()
    async with db.execute(
        "SELECT u.*, c.name AS car_name, c.slug AS car_slug, c.years AS car_years"
        " FROM users u LEFT JOIN cars c ON c.id = u.car_id"
        " WHERE u.user_id = ?",
        (user_id,),
    ) as cur:
        return await cur.fetchone()


async def get_all_user_ids() -> list[int]:
    db = get_db()
    async with db.execute("SELECT user_id FROM users WHERE is_blocked = 0") as cur:
        return [row["user_id"] async for row in cur]


# ------------------------------------------------------------------- adminlar


async def get_admins() -> list[aiosqlite.Row]:
    """Bot ichidan qo'shilgan adminlar (kod/env adminlari bu jadvalda yo'q)."""
    db = get_db()
    async with db.execute("SELECT * FROM admins ORDER BY created_at") as cur:
        return await cur.fetchall()


async def get_admin_ids() -> list[int]:
    db = get_db()
    async with db.execute("SELECT user_id FROM admins ORDER BY created_at") as cur:
        return [row["user_id"] async for row in cur]


async def add_admin(user_id: int, full_name: str | None, added_by: int | None) -> None:
    db = get_db()
    await db.execute(
        "INSERT INTO admins (user_id, full_name, added_by) VALUES (?, ?, ?)"
        " ON CONFLICT(user_id) DO UPDATE SET"
        " full_name = COALESCE(excluded.full_name, admins.full_name)",
        (user_id, full_name, added_by),
    )
    await db.commit()


async def remove_admin(user_id: int) -> bool:
    db = get_db()
    cur = await db.execute("DELETE FROM admins WHERE user_id = ?", (user_id,))
    await db.commit()
    return cur.rowcount > 0


# -------------------------------------------------------------------- xizmatlar

# =====================================================================
#  XIZMATLARNING KANONIK TARTIBI
#
#  Uchta GURUH bor va ular har doim shu ketma-ketlikda turadi:
#
#      0. Bi-LED konfigurator (`theme = 'config'`)  — HAR DOIM birinchi
#      1. Oddiy xizmatlar                          — `sort` bo'yicha
#      2. «Tez kunda» (`coming_soon = 1`)           — HAR DOIM oxirgi
#
#  NEGA GURUH KERAK. Ilgari faqat `ORDER BY sort, id` edi. Natijada:
#    * konfigurator jonli bazada O'RTADA qolib ketgan edi — u eng muhim
#      va eng katta plitka, lekin ro'yxatning o'rtasida turardi;
#    * «Tez kunda» xizmatlar oddiy xizmatlar orasiga aralashib ketardi —
#      mijoz tayyor xizmatni qidirib ularning ustidan o'tishga majbur.
#
#  Admin `sort` raqamini o'zgartirib GURUH ICHIDA tartibni boshqaradi,
#  lekin guruhlarning O'ZINI aralashtirib yubora olmaydi — bu yaxshi:
#  konfiguratorni tasodifan o'rtaga tushirib qo'yish mumkin emas.
#
#  DIQQAT: bu tartib `docs/js/app.js: sortServices()` bilan AYNAN bir
#  xil bo'lishi kerak. Ikki til, ikki amalga oshirish — shuning uchun
#  ular test bilan bog'langan (`verify_order.py`: bir xil kirishga bir
#  xil natija berishi tekshiriladi).
# =====================================================================

# Guruh raqamini beruvchi SQL ifodasi (0 / 1 / 2).
SERVICE_GROUP_SQL = """CASE
    WHEN COALESCE(coming_soon, 0) = 1 THEN 2
    WHEN LOWER(TRIM(COALESCE(theme, ''))) = 'config' THEN 0
    ELSE 1
END"""

# To'liq ORDER BY. `id` — oxirgi hal qiluvchi: `sort` takrorlansa ham
# tartib TASODIFIY bo'lmaydi (aks holda har so'rovda boshqacha kelardi).
SERVICES_ORDER = f"{SERVICE_GROUP_SQL}, sort, id"


def service_group(row) -> int:
    """Xizmatning guruh raqami — `SERVICE_GROUP_SQL` ning Python nusxasi.

    Python tomonda ham kerak: `resequence_sort()` va `admin_move()`
    qatorlarni guruhlab ishlaydi, ular esa SQL ifodasini emas, tayyor
    qatorlarni ko'radi.
    """
    keys = row.keys()
    if "coming_soon" in keys and row["coming_soon"]:
        return 2
    theme = row["theme"] if "theme" in keys else None
    if str(theme or "").strip().lower() == "config":
        return 0
    return 1


async def get_services(
    active_only: bool = True, bookable_only: bool = False
) -> list[aiosqlite.Row]:
    """Xizmatlar ro'yxati — KANONIK tartibda (`SERVICES_ORDER`).

    bookable_only -- «Tez kunda» xizmatlarni TASHLAB ketadi. Bot navbat
        olish ro'yxatida shu rejimni ishlatadi: narxi belgilanmagan
        xizmatni tanlab bo'lmaydi. Mini App esa hammasini oladi — u
        «Tez kunda» ni alohida ko'rinishda ko'rsatadi (mijoz yo'nalish
        borligini bilishi kerak).
    """
    db = get_db()
    where = []
    if active_only:
        where.append("is_active = 1")
    if bookable_only:
        where.append("COALESCE(coming_soon, 0) = 0")
    sql = "SELECT * FROM services"
    if where:
        sql += " WHERE " + " AND ".join(where)
    sql += f" ORDER BY {SERVICES_ORDER}"
    async with db.execute(sql) as cur:
        return await cur.fetchall()


async def get_bookable_service(service_id: int) -> aiosqlite.Row | None:
    """Navbat olish mumkin bo'lgan xizmat (yo'q yoki «tez kunda» -> None)."""
    row = await get_service(service_id)
    if row is None:
        return None
    keys = row.keys()
    if not row["is_active"]:
        return None
    if "coming_soon" in keys and row["coming_soon"]:
        return None
    return row


async def get_service(service_id: int) -> aiosqlite.Row | None:
    db = get_db()
    async with db.execute("SELECT * FROM services WHERE id = ?", (service_id,)) as cur:
        return await cur.fetchone()


async def add_service(name: str, duration_min: int, price: int) -> int:
    db = get_db()
    cur = await db.execute(
        "INSERT INTO services (name, duration_min, price) VALUES (?, ?, ?)",
        (name, duration_min, price),
    )
    await db.commit()
    return int(cur.lastrowid)


async def toggle_service(service_id: int) -> None:
    db = get_db()
    await db.execute(
        "UPDATE services SET is_active = 1 - is_active WHERE id = ?", (service_id,)
    )
    await db.commit()


# --------------------------------------------------------------------- navbatlar

ACTIVE_BOOKING_STATUSES = ("new", "confirmed")


async def get_day_bookings(date: str) -> list[aiosqlite.Row]:
    """Berilgan kundagi faol navbatlar (vaqt + davomiylik bilan)."""
    db = get_db()
    async with db.execute(
        "SELECT b.time, s.duration_min FROM bookings b"
        " JOIN services s ON s.id = b.service_id"
        " WHERE b.date = ? AND b.status IN ('new', 'confirmed')",
        (date,),
    ) as cur:
        return await cur.fetchall()


async def get_active_bookings(from_date: str | None = None) -> list[aiosqlite.Row]:
    """Faol navbatlar (bandlik jadvalini bulutga yozish uchun).

    `from_date` berilsa — o'sha kundan boshlab. `done`/`cancelled` tarixiy
    yozuvlar bandlikka kirmaydi va bo'shagan vaqtni qayta tanlash mumkin.
    """
    db = get_db()
    sql = (
        "SELECT b.id, b.date, b.time, b.status, s.duration_min"
        " FROM bookings b JOIN services s ON s.id = b.service_id"
        " WHERE b.status IN ('new', 'confirmed')"
    )
    params: list[Any] = []
    if from_date:
        sql += " AND b.date >= ?"
        params.append(from_date)
    sql += " ORDER BY b.date, b.time"
    async with db.execute(sql, params) as cur:
        return await cur.fetchall()


async def add_booking(user_id: int, service_id: int, date: str, time: str) -> int:
    """Navbatni sana, ish vaqti va interval to'qnashuvini atomik tekshirib yozadi."""
    from utils.helpers import available_dates, free_slots

    async with write_lock(), _write_transaction() as db:
        async with db.execute(
            "SELECT * FROM services"
            " WHERE id = ? AND is_active = 1 AND COALESCE(coming_soon, 0) = 0",
            (service_id,),
        ) as cur:
            service = await cur.fetchone()
        if service is None or date not in available_dates():
            raise SlotTaken(f"{date} {time} tanlash uchun yaroqsiz")

        async with db.execute(
            "SELECT b.time, s.duration_min FROM bookings b"
            " JOIN services s ON s.id = b.service_id"
            " WHERE b.date = ? AND b.status IN ('new', 'confirmed')",
            (date,),
        ) as cur:
            rows = await cur.fetchall()
        taken = [(str(row["time"]), int(row["duration_min"])) for row in rows]
        if time not in free_slots(date, int(service["duration_min"]), taken):
            raise SlotTaken(f"{date} {time} band")

        try:
            cur = await db.execute(
                "INSERT INTO bookings (user_id, service_id, date, time) VALUES (?, ?, ?, ?)",
                (user_id, service_id, date, time),
            )
        except aiosqlite.IntegrityError as error:
            raise SlotTaken(f"{date} {time} band") from error
        return int(cur.lastrowid)


async def get_booking(booking_id: int) -> aiosqlite.Row | None:
    db = get_db()
    async with db.execute(
        "SELECT b.*, s.name AS service_name, s.price, s.duration_min,"
        " u.full_name, u.phone, u.username"
        " FROM bookings b"
        " JOIN services s ON s.id = b.service_id"
        " JOIN users u ON u.user_id = b.user_id"
        " WHERE b.id = ?",
        (booking_id,),
    ) as cur:
        return await cur.fetchone()


async def get_user_bookings(user_id: int, only_active: bool = True) -> list[aiosqlite.Row]:
    db = get_db()
    sql = (
        "SELECT b.*, s.name AS service_name, s.price FROM bookings b"
        " JOIN services s ON s.id = b.service_id"
        " WHERE b.user_id = ?"
    )
    params: list[Any] = [user_id]
    if only_active:
        sql += " AND b.status IN ('new', 'confirmed')"
    sql += " ORDER BY b.date, b.time"
    async with db.execute(sql, params) as cur:
        return await cur.fetchall()


async def get_bookings_by_date(date: str) -> list[aiosqlite.Row]:
    """Admin uchun: kun bo'yicha barcha navbatlar."""
    db = get_db()
    async with db.execute(
        "SELECT b.*, s.name AS service_name, u.full_name, u.phone, u.username"
        " FROM bookings b"
        " JOIN services s ON s.id = b.service_id"
        " JOIN users u ON u.user_id = b.user_id"
        " WHERE b.date = ? ORDER BY b.time",
        (date,),
    ) as cur:
        return await cur.fetchall()


async def set_booking_status(booking_id: int, status: str) -> None:
    db = get_db()
    await db.execute("UPDATE bookings SET status = ? WHERE id = ?", (status, booking_id))
    await db.commit()


async def is_slot_taken(date: str, time: str) -> bool:
    db = get_db()
    async with db.execute(
        "SELECT 1 FROM bookings WHERE date = ? AND time = ? AND status != 'cancelled'",
        (date, time),
    ) as cur:
        return await cur.fetchone() is not None


# ------------------------------------------------------------------ kategoriyalar


async def get_categories(active_only: bool = True) -> list[aiosqlite.Row]:
    db = get_db()
    sql = "SELECT * FROM categories"
    if active_only:
        sql += " WHERE is_active = 1"
    sql += " ORDER BY id"
    async with db.execute(sql) as cur:
        return await cur.fetchall()


async def get_category(category_id: int) -> aiosqlite.Row | None:
    db = get_db()
    async with db.execute("SELECT * FROM categories WHERE id = ?", (category_id,)) as cur:
        return await cur.fetchone()


async def add_category(name: str) -> int:
    db = get_db()
    cur = await db.execute("INSERT INTO categories (name) VALUES (?)", (name,))
    await db.commit()
    return int(cur.lastrowid)


async def default_category_id() -> int:
    """Yagona (yashirin) kategoriya id'si — bo'lmasa yaratadi.

    Kategoriyalar UX'dan olib tashlangan (mahsulotlar random chiqadi), lekin
    DB'da `products.category_id` NOT NULL. Shuning uchun barcha mahsulot shu
    bitta standart kategoriyaga bog'lanadi.
    """
    db = get_db()
    async with db.execute("SELECT id FROM categories ORDER BY id LIMIT 1") as cur:
        row = await cur.fetchone()
    if row:
        return int(row["id"])
    cur = await db.execute("INSERT INTO categories (name) VALUES (?)", ("Mahsulotlar",))
    await db.commit()
    return int(cur.lastrowid)


# -------------------------------------------------------------------- mahsulotlar


async def get_products(
    category_id: int,
    active_only: bool = True,
    car_id: int | None = None,
) -> list[aiosqlite.Row]:
    """Kategoriya mahsulotlari. car_id berilsa — shu mashinaga mos + universal."""
    db = get_db()
    sql = "SELECT * FROM products WHERE category_id = ?"
    params: list[Any] = [category_id]
    if active_only:
        sql += " AND is_active = 1"
    if car_id is not None:
        sql += " AND (car_id IS NULL OR car_id = ?)"
        params.append(car_id)
    sql += " ORDER BY (car_id IS NULL), id"
    async with db.execute(sql, params) as cur:
        return await cur.fetchall()


async def get_product(product_id: int) -> aiosqlite.Row | None:
    db = get_db()
    async with db.execute("SELECT * FROM products WHERE id = ?", (product_id,)) as cur:
        return await cur.fetchone()


async def add_product(
    category_id: int,
    name: str,
    description: str | None,
    price: int,
    stock: int,
    photo_id: str | None,
) -> int:
    db = get_db()
    cur = await db.execute(
        "INSERT INTO products (category_id, name, description, price, stock, photo_id)"
        " VALUES (?, ?, ?, ?, ?, ?)",
        (category_id, name, description, price, stock, photo_id),
    )
    await db.commit()
    return int(cur.lastrowid)


async def toggle_product(product_id: int) -> None:
    db = get_db()
    await db.execute(
        "UPDATE products SET is_active = 1 - is_active WHERE id = ?", (product_id,)
    )
    await db.commit()


# ---------------------------------------------------------------------- savatcha


async def add_to_cart(user_id: int, product_id: int, qty: int = 1) -> None:
    db = get_db()
    await db.execute(
        "INSERT INTO cart_items (user_id, product_id, qty) VALUES (?, ?, ?)"
        " ON CONFLICT(user_id, product_id) DO UPDATE SET qty = qty + excluded.qty",
        (user_id, product_id, qty),
    )
    await db.commit()


async def get_cart(user_id: int) -> list[aiosqlite.Row]:
    db = get_db()
    async with db.execute(
        "SELECT c.product_id, c.qty, p.name, p.price, p.stock,"
        " p.product_type, p.sizes,"
        " (c.qty * p.price) AS subtotal"
        " FROM cart_items c JOIN products p ON p.id = c.product_id"
        " WHERE c.user_id = ? ORDER BY p.name",
        (user_id,),
    ) as cur:
        return await cur.fetchall()


async def change_cart_qty(user_id: int, product_id: int, delta: int) -> None:
    db = get_db()
    await db.execute(
        "UPDATE cart_items SET qty = qty + ? WHERE user_id = ? AND product_id = ?",
        (delta, user_id, product_id),
    )
    await db.execute(
        "DELETE FROM cart_items WHERE user_id = ? AND product_id = ? AND qty < 1",
        (user_id, product_id),
    )
    await db.commit()


async def remove_from_cart(user_id: int, product_id: int) -> None:
    db = get_db()
    await db.execute(
        "DELETE FROM cart_items WHERE user_id = ? AND product_id = ?", (user_id, product_id)
    )
    await db.commit()


async def clear_cart(user_id: int) -> None:
    db = get_db()
    await db.execute("DELETE FROM cart_items WHERE user_id = ?", (user_id,))
    await db.commit()


async def cart_total(user_id: int) -> int:
    db = get_db()
    async with db.execute(
        "SELECT COALESCE(SUM(c.qty * p.price), 0) AS total FROM cart_items c"
        " JOIN products p ON p.id = c.product_id WHERE c.user_id = ?",
        (user_id,),
    ) as cur:
        row = await cur.fetchone()
    return int(row["total"])


# --------------------------------------------------------------------- buyurtma


async def create_order(
    user_id: int,
    address: str,
    phone: str,
    *,
    delivery_method: str | None = None,
    delivery_info: str | None = None,
    payment_method: str | None = None,
    idempotency_key: str | None = None,
) -> tuple[int | None, list[dict[str, Any]], bool]:
    """Joriy savatdan idempotent buyurtma yaratadi."""
    problems: list[dict[str, Any]] = []

    async with write_lock(), _write_transaction() as db:
        async with db.execute(
            "SELECT product_id, qty FROM cart_items WHERE user_id = ? ORDER BY product_id",
            (user_id,),
        ) as cur:
            items = await cur.fetchall()

        # Muvaffaqiyatli birinchi urinish savatni tozalaydi. Shu sababli bot
        # callback replayida mavjud kalit + bo'sh savat aynan oldingi natija.
        if not items:
            if idempotency_key:
                existing = await _find_order_by_key(db, idempotency_key)
                if existing is not None:
                    return int(existing["id"]), [], False
            return None, [], False

        wanted = {(int(item["product_id"]), None): int(item["qty"]) for item in items}
        for (product_id, _), qty in wanted.items():
            if qty < 1 or qty > MAX_ITEM_QTY:
                problems.append(
                    {
                        "product_id": product_id,
                        "reason": "max_qty" if qty > MAX_ITEM_QTY else "bad_qty",
                        "max_qty": MAX_ITEM_QTY,
                    }
                )
        if problems:
            return None, problems, False

        fingerprint = _order_request_fingerprint(
            user_id,
            wanted,
            address,
            phone,
            delivery_method,
            delivery_info,
            payment_method,
        )
        if idempotency_key:
            replay_id = await _replay_order_id(db, idempotency_key, fingerprint)
            if replay_id is not None:
                return replay_id, [], False

        prepared: list[tuple[aiosqlite.Row, int, str | None]] = []
        reserved: list[tuple[int, int, str | None]] = []
        for (product_id, size), qty in wanted.items():
            product = await _fetch_product(db, product_id)
            if product is None or not product["is_active"]:
                problems.append(_stock_problem(product_id, product, "not_found"))
                continue
            ok, problem = await _reserve_product_stock(db, product, qty, size)
            if not ok:
                problems.append(problem or _stock_problem(product_id, product, "out_of_stock"))
                continue
            prepared.append((product, qty, size))
            reserved.append((product_id, qty, size))

        if problems or not prepared:
            for product_id, qty, size in reserved:
                await _restore_product_stock(db, product_id, qty, size)
            return None, problems, False

        total = sum(int(product["price"]) * qty for product, qty, _ in prepared)
        try:
            cur = await db.execute(
                "INSERT INTO orders (user_id, total, address, phone,"
                " delivery_method, delivery_info, payment_method, idempotency_key,"
                " idempotency_fingerprint) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    user_id,
                    total,
                    address,
                    phone,
                    delivery_method,
                    delivery_info,
                    payment_method,
                    idempotency_key,
                    fingerprint if idempotency_key else None,
                ),
            )
            order_id = int(cur.lastrowid)
            rows: Sequence[tuple] = [
                (
                    order_id,
                    product["id"],
                    product["name"],
                    int(product["price"]),
                    qty,
                    size,
                )
                for product, qty, size in prepared
            ]
            await db.executemany(
                "INSERT INTO order_items (order_id, product_id, name, price, qty, size)"
                " VALUES (?, ?, ?, ?, ?, ?)",
                rows,
            )
            await db.execute("DELETE FROM cart_items WHERE user_id = ?", (user_id,))
        except aiosqlite.IntegrityError:
            await db.rollback()
            if idempotency_key:
                replay_id = await _replay_order_id(db, idempotency_key, fingerprint)
                if replay_id is not None:
                    return replay_id, [], False
            raise

        return order_id, [], True


async def get_order(order_id: int) -> aiosqlite.Row | None:
    db = get_db()
    async with db.execute(
        "SELECT o.*, u.full_name, u.username FROM orders o"
        " JOIN users u ON u.user_id = o.user_id WHERE o.id = ?",
        (order_id,),
    ) as cur:
        return await cur.fetchone()


async def get_order_items(order_id: int) -> list[aiosqlite.Row]:
    db = get_db()
    async with db.execute(
        "SELECT * FROM order_items WHERE order_id = ? ORDER BY id", (order_id,)
    ) as cur:
        return await cur.fetchall()


async def get_user_orders(user_id: int, limit: int = 10) -> list[aiosqlite.Row]:
    db = get_db()
    async with db.execute(
        "SELECT * FROM orders WHERE user_id = ? ORDER BY id DESC LIMIT ?",
        (user_id, limit),
    ) as cur:
        return await cur.fetchall()


async def get_orders(status: str | None = None, limit: int = 15) -> list[aiosqlite.Row]:
    db = get_db()
    sql = (
        "SELECT o.*, u.full_name, u.username FROM orders o"
        " JOIN users u ON u.user_id = o.user_id"
    )
    params: list[Any] = []
    if status:
        sql += " WHERE o.status = ?"
        params.append(status)
    sql += " ORDER BY o.id DESC LIMIT ?"
    params.append(limit)
    async with db.execute(sql, params) as cur:
        return await cur.fetchall()


async def compare_and_set_status(
    kind: str,
    row_id: int,
    expected_status: str,
    target_status: str,
) -> tuple[bool, str | None, int]:
    """Holatni CAS bilan almashtiradi; order bekorida stockni aynan bir marta qaytaradi."""
    tables = {"order": "orders", "booking": "bookings", "biled": "biled_orders"}
    table = tables.get(kind)
    if table is None:
        raise ValueError(f"Noma'lum buyurtma turi: {kind}")

    async with write_lock(), _write_transaction() as db:
        cur = await db.execute(
            f"UPDATE {table} SET status = ? WHERE id = ? AND status = ?",
            (target_status, row_id, expected_status),
        )
        if int(cur.rowcount or 0) == 0:
            async with db.execute(
                f"SELECT status FROM {table} WHERE id = ?", (row_id,)
            ) as cursor:
                row = await cursor.fetchone()
            return False, str(row["status"]) if row else None, 0

        restored = 0
        if kind == "order" and target_status == "cancelled":
            async with db.execute(
                "SELECT product_id, qty, size FROM order_items"
                " WHERE order_id = ? AND product_id IS NOT NULL"
                " AND COALESCE(stock_reserved, 1) = 1",
                (row_id,),
            ) as cursor:
                rows = await cursor.fetchall()
            for row in rows:
                qty = int(row["qty"] or 0)
                if qty > 0 and await _restore_product_stock(
                    db, int(row["product_id"]), qty, row["size"]
                ):
                    restored += qty
        return True, target_status, restored


async def set_order_status(order_id: int, status: str) -> None:
    """Eski ichki yordamchi; yangi oqim `compare_and_set_status`dan foydalanadi."""
    db = get_db()
    await db.execute("UPDATE orders SET status = ? WHERE id = ?", (status, order_id))
    await db.commit()


async def restore_order_stock(order_id: int) -> int:
    """Buyurtma qoldig'ini variantlari bilan qaytaradi (qo'lda tiklash uchun).

    Faqat HAQIQATAN rezerv qilingan (`stock_reserved=1`) qatorlar qaytariladi —
    tashqi/bulutdan tiklangan buyurtmalar (`stock_reserved=0`) qoldiqni
    ikki marta oshirib yubormasin.
    """
    db = get_db()
    restored = 0
    async with write_lock():
        async with db.execute(
            "SELECT product_id, qty, size FROM order_items"
            " WHERE order_id = ? AND product_id IS NOT NULL"
            " AND COALESCE(stock_reserved, 1) = 1",
            (order_id,),
        ) as cur:
            rows = await cur.fetchall()
        for row in rows:
            qty = int(row["qty"] or 0)
            if qty > 0 and await _restore_product_stock(
                db, int(row["product_id"]), qty, row["size"]
            ):
                restored += qty
        if restored:
            await db.commit()
    return restored


# -------------------------------------------------------------------- statistika


async def _scalar(sql: str, params: Sequence[Any] = ()) -> int:
    db = get_db()
    async with db.execute(sql, tuple(params)) as cur:
        row = await cur.fetchone()
    return int(row[0] or 0) if row else 0


async def product_stats(since: str | None = None) -> dict[str, Any]:
    """TOVARLAR savdosi statistikasi (do'kon buyurtmalari).

    Bi-LED o'rnatish ishlari bu hisobga KIRMAYDI — ular alohida.
    Bekor qilingan buyurtmalar tushumga qo'shilmaydi.
    """
    where = " AND created_at >= ?" if since else ""
    args = [since] if since else []

    revenue = await _scalar(
        f"SELECT COALESCE(SUM(total), 0) FROM orders WHERE status != 'cancelled'{where}", args
    )
    total_orders = await _scalar(f"SELECT COUNT(*) FROM orders WHERE 1=1{where}", args)
    paid_orders = await _scalar(
        f"SELECT COUNT(*) FROM orders WHERE status != 'cancelled'{where}", args
    )
    delivered = await _scalar(
        f"SELECT COUNT(*) FROM orders WHERE status = 'delivered'{where}", args
    )
    cancelled = await _scalar(
        f"SELECT COUNT(*) FROM orders WHERE status = 'cancelled'{where}", args
    )
    new_orders = await _scalar(f"SELECT COUNT(*) FROM orders WHERE status = 'new'{where}", args)

    item_where = " AND o.created_at >= ?" if since else ""
    units = await _scalar(
        "SELECT COALESCE(SUM(oi.qty), 0) FROM order_items oi"
        " JOIN orders o ON o.id = oi.order_id"
        f" WHERE o.status != 'cancelled'{item_where}",
        args,
    )

    db = get_db()
    async with db.execute(
        "SELECT oi.name AS name, SUM(oi.qty) AS units,"
        " SUM(oi.qty * oi.price) AS total"
        " FROM order_items oi JOIN orders o ON o.id = oi.order_id"
        f" WHERE o.status != 'cancelled'{item_where}"
        " GROUP BY lower(TRIM(oi.name)) ORDER BY units DESC, total DESC LIMIT 5",
        tuple(args),
    ) as cur:
        top = await cur.fetchall()

    return {
        "revenue": revenue,
        "orders": total_orders,
        "paid_orders": paid_orders,
        "delivered": delivered,
        "cancelled": cancelled,
        "new": new_orders,
        "units": units,
        "average": int(revenue / paid_orders) if paid_orders else 0,
        "top": [
            {"name": row["name"], "units": int(row["units"]), "total": int(row["total"] or 0)}
            for row in top
        ],
    }


async def biled_stats(since: str | None = None) -> dict[str, Any]:
    """Bi-LED O'RNATISH statistikasi — faqat topshirilgan ishlar.

    Ya'ni usta ishni tugatib, buyurtma «✨ Topshirildi» bo'lganda
    hisoblanadi. Tovar sotilishi bu hisobga kirmaydi.
    """
    where = " AND created_at >= ?" if since else ""
    args = [since] if since else []

    revenue = await _scalar(
        f"SELECT COALESCE(SUM(total), 0) FROM biled_orders WHERE status = 'done'{where}", args
    )
    done = await _scalar(f"SELECT COUNT(*) FROM biled_orders WHERE status = 'done'{where}", args)
    in_work = await _scalar(
        f"SELECT COUNT(*) FROM biled_orders WHERE status = 'in_work'{where}", args
    )
    waiting = await _scalar(
        f"SELECT COUNT(*) FROM biled_orders WHERE status IN ('new', 'accepted'){where}", args
    )
    cancelled = await _scalar(
        f"SELECT COUNT(*) FROM biled_orders WHERE status = 'cancelled'{where}", args
    )

    db = get_db()
    top_where = " AND b.created_at >= ?" if since else ""
    async with db.execute(
        "SELECT t.name AS name, COUNT(*) AS units, COALESCE(SUM(b.total), 0) AS total"
        " FROM biled_orders b JOIN biled_types t ON t.id = b.biled_id"
        f" WHERE b.status = 'done'{top_where}"
        " GROUP BY t.id ORDER BY units DESC, total DESC LIMIT 5",
        tuple(args),
    ) as cur:
        lenses = await cur.fetchall()

    async with db.execute(
        "SELECT c.name AS name, COUNT(*) AS units, COALESCE(SUM(b.total), 0) AS total"
        " FROM biled_orders b JOIN cars c ON c.id = b.car_id"
        f" WHERE b.status = 'done'{top_where}"
        " GROUP BY c.id ORDER BY units DESC LIMIT 5",
        tuple(args),
    ) as cur:
        cars = await cur.fetchall()

    def rows(items):
        return [
            {"name": row["name"], "units": int(row["units"]), "total": int(row["total"] or 0)}
            for row in items
        ]

    return {
        "revenue": revenue,
        "done": done,
        "in_work": in_work,
        "waiting": waiting,
        "cancelled": cancelled,
        "average": int(revenue / done) if done else 0,
        "top": rows(lenses),
        "cars": rows(cars),
    }


async def get_stats(today: str) -> dict[str, int]:
    db = get_db()
    queries = {
        "users": ("SELECT COUNT(*) FROM users", ()),
        "bookings_total": ("SELECT COUNT(*) FROM bookings", ()),
        "bookings_today": ("SELECT COUNT(*) FROM bookings WHERE date = ?", (today,)),
        "bookings_new": ("SELECT COUNT(*) FROM bookings WHERE status = 'new'", ()),
        "orders_total": ("SELECT COUNT(*) FROM orders", ()),
        "orders_new": ("SELECT COUNT(*) FROM orders WHERE status = 'new'", ()),
        "revenue": (
            "SELECT COALESCE(SUM(total), 0) FROM orders WHERE status != 'cancelled'",
            (),
        ),
        "products": ("SELECT COUNT(*) FROM products WHERE is_active = 1", ()),
        "biled_total": ("SELECT COUNT(*) FROM biled_orders", ()),
        "biled_new": ("SELECT COUNT(*) FROM biled_orders WHERE status = 'new'", ()),
        "biled_revenue": (
            "SELECT COALESCE(SUM(total), 0) FROM biled_orders WHERE status != 'cancelled'",
            (),
        ),
    }
    stats: dict[str, int] = {}
    for key, (sql, params) in queries.items():
        async with db.execute(sql, params) as cur:
            row = await cur.fetchone()
        stats[key] = int(row[0])
    return stats



# --------------------------------------------------------- Mini App uchun qo'shimcha


def product_json(product: aiosqlite.Row) -> dict[str, Any]:
    keys = product.keys()
    return {
        "id": product["id"],
        "name": product["name"],
        "description": product["description"],
        "price": int(product["price"]),
        "old_price": int(product["old_price"])
        if "old_price" in keys and product["old_price"]
        else None,
        "badge": product["badge"] if "badge" in keys else None,
        "stock": int(product["stock"]),
        "unit": product["unit"] if "unit" in keys else None,
        "product_type": product["product_type"] if "product_type" in keys else None,
        "sizes": _product_sizes(product),
        "car_id": product["car_id"] if "car_id" in keys else None,
        # media: xom qiymatlar — yakuniy manzillar API qatlamida yasaladi
        "has_photo": bool(product["photo_id"]),
        "photo_url_raw": product["photo_url"] if "photo_url" in keys else None,
        "has_video": bool(product["video_id"]) if "video_id" in keys else False,
        "video_url_raw": product["video_url"] if "video_url" in keys else None,
        # 2- va 3-rasm: mahsulot modalidagi swipe galereya uchun. Ilgari bu
        # maydonlar API'ga chiqmasdi, shuning uchun «galereya» har doim bitta
        # rasmdan iborat bo'lib, surish (swipe) mantig'i behuda turardi.
        "has_photo2": bool(product["photo2_id"]) if "photo2_id" in keys else False,
        "photo2_url_raw": product["photo2_url"] if "photo2_url" in keys else None,
        "has_photo3": bool(product["photo3_id"]) if "photo3_id" in keys else False,
        "photo3_url_raw": product["photo3_url"] if "photo3_url" in keys else None,
    }


async def get_catalog(car_id: int | None = None) -> list[dict[str, Any]]:
    """Kategoriyalar va mahsulotlar — Mini App uchun (mashinaga qarab filtrlangan)."""
    categories = await get_categories()
    catalog: list[dict[str, Any]] = []
    for category in categories:
        products = await get_products(category["id"], car_id=car_id)
        if not products:
            continue
        keys = category.keys()
        catalog.append(
            {
                "id": category["id"],
                "name": category["name"],
                "icon": category["icon"] if "icon" in keys else None,
                # Mini App filtr chiplari SHU tartibda chiziladi (alifbo
                # bo'yicha emas) — admin bo'limlar ketma-ketligini
                # `sort` bilan boshqaradi.
                "sort": int(category["sort"] or 0) if "sort" in keys else 0,
                "products": [product_json(product) for product in products],
            }
        )
    return catalog


# ---------------------------------------------------------- saqlanganlar


async def toggle_favorite(user_id: int, product_id: int) -> bool:
    """Tovarni saqlaydi yoki saqlanganlardan oladi. Qaytaradi: yangi holat."""
    db = get_db()
    cur = await db.execute(
        "DELETE FROM favorites WHERE user_id = ? AND product_id = ?", (user_id, product_id)
    )
    if cur.rowcount > 0:
        await db.commit()
        return False

    await db.execute(
        "INSERT OR IGNORE INTO favorites (user_id, product_id) VALUES (?, ?)",
        (user_id, product_id),
    )
    await db.commit()
    return True


async def get_favorite_ids(user_id: int) -> list[int]:
    """Saqlangan tovar ID'lari (ilovada yurakni bo'yash uchun)."""
    db = get_db()
    async with db.execute(
        "SELECT product_id FROM favorites WHERE user_id = ?", (user_id,)
    ) as cur:
        return [row["product_id"] async for row in cur]


async def get_favorites(user_id: int) -> list[dict[str, Any]]:
    """Saqlangan tovarlar — yangi saqlangani birinchi bo'lib."""
    db = get_db()
    async with db.execute(
        "SELECT p.* FROM favorites f JOIN products p ON p.id = f.product_id"
        " WHERE f.user_id = ? AND p.is_active = 1"
        " ORDER BY f.created_at DESC, f.product_id DESC",
        (user_id,),
    ) as cur:
        rows = await cur.fetchall()
    return [product_json(row) for row in rows]


async def get_favorite_names(user_id: int) -> list[str]:
    """Saqlangan tovar NOMLARI — bulutga yozish uchun (ID'lar o'zgaradi)."""
    db = get_db()
    async with db.execute(
        "SELECT p.name FROM favorites f JOIN products p ON p.id = f.product_id"
        " WHERE f.user_id = ?",
        (user_id,),
    ) as cur:
        return [row["name"] async for row in cur]


async def add_favorite_by_name(user_id: int, name: str) -> bool:
    """Bulutdan tiklash: tovarni nomi bo'yicha topib saqlanganlarga qo'shadi."""
    product_id = await catalog_find("products", name)
    if product_id is None:
        return False
    db = get_db()
    cur = await db.execute(
        "INSERT OR IGNORE INTO favorites (user_id, product_id) VALUES (?, ?)",
        (user_id, product_id),
    )
    await db.commit()
    return cur.rowcount > 0


async def create_order_from_items(
    user_id: int,
    items: list[tuple[int, int] | tuple[int, int, str | None]],
    address: str,
    phone: str,
    delivery_method: str | None = None,
    delivery_info: str | None = None,
    payment_method: str | None = None,
    idempotency_key: str | None = None,
) -> tuple[int | None, list[dict[str, Any]], bool]:
    """Mini App ro'yxatidan razmer va fingerprint bilan idempotent order yaratadi."""
    problems: list[dict[str, Any]] = []
    aggregated: dict[tuple[int, str | None], int] = {}
    labels: dict[tuple[int, str | None], str | None] = {}
    for item in items:
        product_id, qty = int(item[0]), int(item[1])
        size = _normalize_size(item[2]) if len(item) > 2 else None
        if qty < 1:
            problems.append({"product_id": product_id, "reason": "bad_qty"})
            continue
        key = (product_id, _size_key(size) or None)
        aggregated[key] = aggregated.get(key, 0) + qty
        labels.setdefault(key, size)

    # Bir mahsulot/razmer bir necha qatorda kelsa limit HAR QATORGA emas,
    # normalizatsiyadan keyingi jami songa qo'llanadi.
    for (product_id, size_key), qty in aggregated.items():
        if qty > MAX_ITEM_QTY:
            problems.append(
                {
                    "product_id": product_id,
                    "size": labels[(product_id, size_key)],
                    "reason": "max_qty",
                    "max_qty": MAX_ITEM_QTY,
                }
            )
    if problems:
        return None, problems, False

    wanted = {
        (product_id, labels[(product_id, size_key)]): qty
        for (product_id, size_key), qty in aggregated.items()
    }
    fingerprint = _order_request_fingerprint(
        user_id,
        wanted,
        address,
        phone,
        delivery_method,
        delivery_info,
        payment_method,
    )

    async with write_lock(), _write_transaction() as db:
        if idempotency_key:
            replay_id = await _replay_order_id(db, idempotency_key, fingerprint)
            if replay_id is not None:
                logger.info(
                    "Takroriy buyurtma so'rovi (%s) — mavjud #%s qaytarildi",
                    idempotency_key,
                    replay_id,
                )
                return replay_id, [], False

        prepared: list[tuple[aiosqlite.Row, int, str | None]] = []
        reserved: list[tuple[int, int, str | None]] = []
        for (product_id, size), qty in wanted.items():
            product = await _fetch_product(db, product_id)
            if product is None or not product["is_active"]:
                problems.append(_stock_problem(product_id, product, "not_found"))
                continue
            ok, problem = await _reserve_product_stock(db, product, qty, size)
            if not ok:
                problems.append(problem or _stock_problem(product_id, product, "out_of_stock"))
                continue
            prepared.append((product, qty, size))
            reserved.append((product_id, qty, size))

        if problems or not prepared:
            for product_id, qty, size in reserved:
                await _restore_product_stock(db, product_id, qty, size)
            return None, problems, False

        total = sum(int(product["price"]) * qty for product, qty, _ in prepared)
        try:
            cur = await db.execute(
                "INSERT INTO orders"
                " (user_id, total, address, phone, delivery_method, delivery_info,"
                "  payment_method, idempotency_key, idempotency_fingerprint)"
                " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    user_id,
                    total,
                    address,
                    phone,
                    delivery_method,
                    delivery_info,
                    payment_method,
                    idempotency_key,
                    fingerprint if idempotency_key else None,
                ),
            )
            order_id = int(cur.lastrowid)
            await db.executemany(
                "INSERT INTO order_items (order_id, product_id, name, price, qty, size)"
                " VALUES (?, ?, ?, ?, ?, ?)",
                [
                    (
                        order_id,
                        product["id"],
                        product["name"],
                        int(product["price"]),
                        qty,
                        size,
                    )
                    for product, qty, size in prepared
                ],
            )
        except aiosqlite.IntegrityError:
            await db.rollback()
            if idempotency_key:
                replay_id = await _replay_order_id(db, idempotency_key, fingerprint)
                if replay_id is not None:
                    return replay_id, [], False
            raise

        return order_id, [], True


async def get_order_by_idempotency_key(key: str) -> aiosqlite.Row | None:
    db = get_db()
    async with db.execute(
        "SELECT * FROM orders WHERE idempotency_key = ?", (key,)
    ) as cur:
        return await cur.fetchone()



# ========================================================================
#                        Bi-LED TUNING (asosiy yo'nalish)
# ========================================================================

# ------------------------------------------------------------------ mashinalar


async def get_cars(active_only: bool = True) -> list[aiosqlite.Row]:
    db = get_db()
    sql = "SELECT * FROM cars"
    if active_only:
        sql += " WHERE is_active = 1"
    sql += " ORDER BY sort, id"
    async with db.execute(sql) as cur:
        return await cur.fetchall()


async def get_car(car_id: int) -> aiosqlite.Row | None:
    db = get_db()
    async with db.execute("SELECT * FROM cars WHERE id = ?", (car_id,)) as cur:
        return await cur.fetchone()


async def add_car(name: str, slug: str, years: str | None, note: str | None) -> int:
    db = get_db()
    cur = await db.execute(
        "INSERT INTO cars (name, slug, years, note) VALUES (?, ?, ?, ?)",
        (name, slug, years, note),
    )
    await db.commit()
    return int(cur.lastrowid)


async def set_user_car(user_id: int, car_id: int) -> None:
    db = get_db()
    await db.execute("UPDATE users SET car_id = ? WHERE user_id = ?", (car_id, user_id))
    await db.commit()


# ------------------------------------------------------- konfigurator variantlari


async def get_biled_types(active_only: bool = True) -> list[aiosqlite.Row]:
    db = get_db()
    sql = "SELECT * FROM biled_types"
    if active_only:
        sql += " WHERE is_active = 1"
    sql += " ORDER BY sort, id"
    async with db.execute(sql) as cur:
        return await cur.fetchall()


async def get_biled_type(biled_id: int) -> aiosqlite.Row | None:
    db = get_db()
    async with db.execute("SELECT * FROM biled_types WHERE id = ?", (biled_id,)) as cur:
        return await cur.fetchone()


async def get_shrouds(active_only: bool = True) -> list[aiosqlite.Row]:
    db = get_db()
    sql = "SELECT * FROM shrouds"
    if active_only:
        sql += " WHERE is_active = 1"
    sql += " ORDER BY sort, id"
    async with db.execute(sql) as cur:
        return await cur.fetchall()


async def get_shroud(shroud_id: int) -> aiosqlite.Row | None:
    db = get_db()
    async with db.execute("SELECT * FROM shrouds WHERE id = ?", (shroud_id,)) as cur:
        return await cur.fetchone()


async def get_optic_colors(active_only: bool = True) -> list[aiosqlite.Row]:
    db = get_db()
    sql = "SELECT * FROM optic_colors"
    if active_only:
        sql += " WHERE is_active = 1"
    sql += " ORDER BY sort, id"
    async with db.execute(sql) as cur:
        return await cur.fetchall()


async def get_optic_color(color_id: int) -> aiosqlite.Row | None:
    db = get_db()
    async with db.execute(
        "SELECT * FROM optic_colors WHERE id = ?", (color_id,)
    ) as cur:
        return await cur.fetchone()


# ------------------------------------------------------- Bi-LED buyurtmalari


async def create_biled_order(
    user_id: int,
    car_id: int,
    biled_id: int,
    shroud_id: int | None,
    color_id: int | None,
    phone: str,
    comment: str | None,
) -> tuple[int | None, int]:
    """Konfiguratsiya buyurtmasini yaratadi. Qaytaradi: (order_id, total)."""
    biled = await get_biled_type(biled_id)
    if not biled or not biled["is_active"]:
        return None, 0

    total = int(biled["price"])
    if shroud_id:
        shroud = await get_shroud(shroud_id)
        if shroud:
            total += int(shroud["price"])
    if color_id:
        color = await get_optic_color(color_id)
        if color:
            total += int(color["price"])

    db = get_db()
    cur = await db.execute(
        "INSERT INTO biled_orders (user_id, car_id, biled_id, shroud_id, color_id,"
        " total, phone, comment) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        (user_id, car_id, biled_id, shroud_id, color_id, total, phone, comment),
    )
    await db.commit()
    return int(cur.lastrowid), total


BILED_ORDER_SELECT = """
SELECT b.*, c.name AS car_name, c.years AS car_years,
       t.name AS biled_name, t.brand AS biled_brand, t.price AS biled_price,
       s.name AS shroud_name, s.price AS shroud_price,
       o.name AS color_name, o.price AS color_price,
       u.full_name, u.username
  FROM biled_orders b
  JOIN cars c        ON c.id = b.car_id
  JOIN biled_types t ON t.id = b.biled_id
  LEFT JOIN shrouds s      ON s.id = b.shroud_id
  LEFT JOIN optic_colors o ON o.id = b.color_id
  JOIN users u       ON u.user_id = b.user_id
"""


async def get_biled_order(order_id: int) -> aiosqlite.Row | None:
    db = get_db()
    async with db.execute(BILED_ORDER_SELECT + " WHERE b.id = ?", (order_id,)) as cur:
        return await cur.fetchone()


async def get_user_biled_orders(user_id: int, limit: int = 20) -> list[aiosqlite.Row]:
    db = get_db()
    async with db.execute(
        BILED_ORDER_SELECT + " WHERE b.user_id = ? ORDER BY b.id DESC LIMIT ?",
        (user_id, limit),
    ) as cur:
        return await cur.fetchall()


async def get_biled_orders(status: str | None = None, limit: int = 15) -> list[aiosqlite.Row]:
    db = get_db()
    sql = BILED_ORDER_SELECT
    params: list[Any] = []
    if status:
        sql += " WHERE b.status = ?"
        params.append(status)
    sql += " ORDER BY b.id DESC LIMIT ?"
    params.append(limit)
    async with db.execute(sql, params) as cur:
        return await cur.fetchall()


async def set_biled_order_status(order_id: int, status: str) -> None:
    db = get_db()
    await db.execute("UPDATE biled_orders SET status = ? WHERE id = ?", (status, order_id))
    await db.commit()


# ------------------------------------------------ kontent: banner, story, aksiya


async def get_banners(car_id: int | None = None) -> list[aiosqlite.Row]:
    db = get_db()
    sql = "SELECT * FROM banners WHERE is_active = 1"
    params: list[Any] = []
    if car_id is not None:
        sql += " AND (car_id IS NULL OR car_id = ?)"
        params.append(car_id)
    sql += " ORDER BY sort, id"
    async with db.execute(sql, params) as cur:
        return await cur.fetchall()


async def get_stories() -> list[aiosqlite.Row]:
    db = get_db()
    async with db.execute(
        "SELECT * FROM stories WHERE is_active = 1 ORDER BY sort, id"
    ) as cur:
        return await cur.fetchall()


async def add_story_item(
    category: str,
    title: str,
    heading: str,
    emoji: str,
    color_from: str,
    color_to: str,
    photo_id: str | None = None,
    video_id: str | None = None,
) -> int:
    """Halqa ichiga yangi element qo'shadi (bot orqali yuborilgan media)."""
    db = get_db()
    async with db.execute("SELECT COALESCE(MAX(sort), 0) + 1 AS s FROM stories") as cur:
        row = await cur.fetchone()
    sort = int(row["s"]) if row else 1

    cur = await db.execute(
        "INSERT INTO stories (category, title, emoji, heading, color_from, color_to,"
        " photo_id, video_id, sort) VALUES (?,?,?,?,?,?,?,?,?)",
        (
            story_cfg.normalize(category),
            title[:120],
            emoji,
            heading[:160],
            color_from,
            color_to,
            photo_id,
            video_id,
            sort,
        ),
    )
    await db.commit()
    return int(cur.lastrowid)


async def get_story_items(category: str) -> list[aiosqlite.Row]:
    """Bitta halqa ichidagi elementlar."""
    db = get_db()
    async with db.execute(
        "SELECT * FROM stories WHERE category = ? AND is_active = 1 ORDER BY sort, id",
        (story_cfg.normalize(category),),
    ) as cur:
        return await cur.fetchall()


async def get_story_rings() -> list[dict[str, Any]]:
    """Storieslarni KATEGORIYALAR (halqalar) bo'yicha guruhlaydi.

    Avto_A1 mantiqi: halqa — kategoriya, uning ichida bir nechta element
    ketma-ket o'ynaydi. Bo'sh halqa ko'rsatilmaydi.
    """
    rows = await get_stories()
    grouped: dict[str, list[aiosqlite.Row]] = {}
    for row in rows:
        keys = row.keys()
        category = story_cfg.normalize(row["category"] if "category" in keys else None)
        grouped.setdefault(category, []).append(row)

    rings = []
    for key in story_cfg.STORY_ORDER:
        items = grouped.get(key)
        if not items:
            continue  # bo'sh halqa chiqmaydi
        info = story_cfg.STORY_MAP[key]
        rings.append({"info": info, "items": items})
    return rings


async def get_promos() -> list[aiosqlite.Row]:
    db = get_db()
    async with db.execute(
        "SELECT * FROM promos WHERE is_active = 1 ORDER BY sort, id"
    ) as cur:
        return await cur.fetchall()


# ------------------------------------------------------------- fon musiqasi


async def get_music(active_only: bool = True) -> list[aiosqlite.Row]:
    """Mini App'dagi fon musiqasi ro'yxati (tartib bo'yicha)."""
    db = get_db()
    sql = "SELECT * FROM music"
    if active_only:
        sql += " WHERE is_active = 1"
    sql += " ORDER BY sort, id"
    async with db.execute(sql) as cur:
        return await cur.fetchall()


async def add_music(
    title: str,
    audio_id: str | None = None,
    audio_url: str | None = None,
    duration: int = 0,
) -> int:
    """Yangi trek qo'shadi va uni ro'yxat OXIRIGA qo'yadi."""
    db = get_db()
    sort = await admin_next_sort("music")
    cur = await db.execute(
        "INSERT INTO music (title, audio_id, audio_url, duration, sort)"
        " VALUES (?, ?, ?, ?, ?)",
        (title, audio_id, audio_url, int(duration or 0), sort),
    )
    await db.commit()
    return int(cur.lastrowid)


async def add_banner(
    title: str, subtitle: str | None, tag: str | None, photo_id: str | None
) -> int:
    db = get_db()
    cur = await db.execute(
        "INSERT INTO banners (title, subtitle, tag, photo_id) VALUES (?, ?, ?, ?)",
        (title, subtitle, tag, photo_id),
    )
    await db.commit()
    return int(cur.lastrowid)


async def add_story(
    title: str, emoji: str, heading: str | None, body: str | None, photo_id: str | None
) -> int:
    db = get_db()
    cur = await db.execute(
        "INSERT INTO stories (title, emoji, heading, body, photo_id)"
        " VALUES (?, ?, ?, ?, ?)",
        (title, emoji, heading, body, photo_id),
    )
    await db.commit()
    return int(cur.lastrowid)



# --------------------------------------------------- Firebase'dan import qilish


# Rasm ustunlari FAQAT qiymat kelganda yoziladi (pastdagi izohga qarang).
_EXTERNAL_KEEP_IF_EMPTY = (
    "code",
    "photo_id",
    "photo_url",
    "photo2_id",
    "photo2_url",
    "photo3_id",
    "photo3_url",
)


async def upsert_external_product(
    external_id: str,
    category_id: int,
    car_id: int | None,
    name: str,
    description: str | None,
    price: int,
    old_price: int | None,
    stock: int,
    photo_url: str | None,
    badge: str | None,
    is_active: int = 1,
    *,
    photo_id: str | None = None,
    photo2_url: str | None = None,
    photo2_id: str | None = None,
    photo3_url: str | None = None,
    photo3_id: str | None = None,
    code: str | None = None,
) -> int:
    """Firebase'dagi tovarni mahalliy bazaga yozadi (bor bo'lsa yangilaydi).

    RASM IKKI XIL BO'LADI va har biri O'Z ustuniga tushishi kerak:
      • `*_url` — tashqi havola (`https://i.ibb.co/…`), brauzer to'g'ridan oladi;
      • `*_id`  — Telegram `file_id`, media proksisi orqali ko'rsatiladi
                  (`api/media.py` yoki Cloudflare Worker `/media`).

    `file_id` ni `photo_url` ga yozib qo'yish — do'kondagi buzuq rasmning
    eng keng tarqalgan sababi: `<img src="AgACAgIAAxk…">` hech qachon
    yuklanmaydi.

    NEGA BO'SH QIYMAT USTIDAN YOZILMAYDI
    Bu funksiya bot ishga tushganda HAR SAFAR chaqiriladi. Rasm ustunlari
    shartsiz yozilsa, quyidagi holat ma'lumotni yo'qotadi:
      1. tovar Excel'dan import qilingan — Firebase'da rasm yo'q;
      2. admin bot panelida rasm qo'ygan — rasm faqat SQLite'da;
      3. bot qayta ishga tushdi -> `photo_id = NULL` -> rasm YO'Q bo'ldi.
    Shu sababli rasm va artikul ustunlari faqat yangi qiymat kelganda
    yangilanadi. Nom, narx, qoldiq esa har doim Firebase'dagidek bo'ladi —
    import aynan shular uchun kerak.
    """
    fields: dict[str, object] = {
        "category_id": category_id,
        "car_id": car_id,
        "name": name,
        "description": description,
        "price": price,
        "old_price": old_price,
        "stock": stock,
        "badge": badge,
        "is_active": is_active,
        "code": code,
        "photo_id": photo_id,
        "photo_url": photo_url,
        "photo2_id": photo2_id,
        "photo2_url": photo2_url,
        "photo3_id": photo3_id,
        "photo3_url": photo3_url,
    }

    db = get_db()
    async with db.execute(
        "SELECT id FROM products WHERE external_id = ?", (external_id,)
    ) as cur:
        row = await cur.fetchone()

    if row:
        updates = {
            column: value
            for column, value in fields.items()
            if value is not None or column not in _EXTERNAL_KEEP_IF_EMPTY
        }
        assignments = ", ".join(f"{column} = ?" for column in updates)
        await db.execute(
            f"UPDATE products SET {assignments} WHERE id = ?",
            (*updates.values(), row["id"]),
        )
        await db.commit()
        return int(row["id"])

    fields["external_id"] = external_id
    columns = ", ".join(fields)
    holders = ", ".join("?" for _ in fields)
    cur = await db.execute(
        f"INSERT INTO products ({columns}) VALUES ({holders})",
        tuple(fields.values()),
    )
    await db.commit()
    return int(cur.lastrowid)



# ========================================================================
#         ADMIN CRUD uchun universal so'rovlar (jadval/ustun oq ro'yxati)
# ========================================================================

# Xavfsizlik: jadval va ustun nomlari faqat shu ro'yxatdan olinadi.
EDITABLE: dict[str, set[str]] = {
    "cars": {
        "name", "slug", "years", "note", "sort", "is_active",
        "photo_id", "photo_url", "video_id", "video_url",
    },
    "biled_types": {
        "name", "brand", "size", "kelvin", "lumen", "warranty", "description",
        "price", "badge", "glow", "sort", "is_active",
        "photo_id", "photo_url", "video_id", "video_url",
    },
    "shrouds": {
        "name", "style", "ring_color", "description", "price", "sort", "is_active",
        "photo_id", "photo_url", "video_id", "video_url",
    },
    "optic_colors": {
        "name", "hex_from", "hex_to", "description", "price", "sort", "is_active",
        "photo_id", "photo_url", "video_id", "video_url",
    },
    "products": {
        "category_id", "car_id", "name", "description", "price", "old_price",
        "stock", "badge", "sort", "is_active",
        "code", "unit", "product_type", "sizes",
        "photo_id", "photo_url", "video_id", "video_url",
        "photo2_id", "photo2_url", "photo3_id", "photo3_url",
    },
    "categories": {"name", "icon", "sort", "is_active"},
    "services": {
        "name", "duration_min", "price", "warranty", "description",
        "theme", "sort", "is_active",
        # Xizmat videosi va «Tez kunda» holati.
        # DIQQAT: bu ro'yxat Firebase'ga saqlanadigan ustunlarni ham
        # belgilaydi (`catalog_columns`) — yangi maydon shu yerga
        # qo'shilmasa, bulutga tushmaydi va qayta deployda yo'qoladi.
        "photo_id", "photo_url", "video_id", "video_url",
        "coming_soon",
    },
    "banners": {
        "title", "subtitle", "tag", "color_from", "color_to", "car_id",
        "sort", "is_active", "photo_id", "photo_url", "video_id", "video_url",
    },
    "stories": {
        "category", "title", "emoji", "heading", "body", "color_from", "color_to",
        "sort", "is_active", "photo_id", "photo_url", "video_id", "video_url",
        # Havola bulutga ham yozilishi kerak, aks holda `_catalog_payload`
        # uni tashlab ketadi va Mini App'dagi CTA tugmasi yo'qoladi.
        "link",
    },
    "promos": {"title", "text", "discount", "until_date", "sort", "is_active"},
    # Fon musiqasi. `audio_id` — Telegram file_id, `audio_url` — tashqi manzil.
    "music": {"title", "audio_id", "audio_url", "duration", "sort", "is_active"},
}


def _check(table: str, column: str | None = None) -> None:
    if table not in EDITABLE:
        raise ValueError(f"Ruxsat berilmagan jadval: {table}")
    if column is not None and column not in EDITABLE[table]:
        raise ValueError(f"Ruxsat berilmagan ustun: {table}.{column}")


# Ba'zi jadvallarda tartib oddiy `sort` dan murakkabroq. Admin paneli
# mijoz ko'radigan ketma-ketlikni AYNAN ko'rsatishi kerak — aks holda
# «yuqoriga ko'chirish» tugmasi tushunarsiz ishlaydi: panelda yozuv
# ko'tariladi, do'konda esa joyi o'zgarmaydi.
TABLE_ORDER: dict[str, str] = {"services": SERVICES_ORDER}


def table_order(table: str) -> str:
    """Jadval uchun ORDER BY ifodasi (admin paneli va mijoz bir xil ko'rsin)."""
    if table in TABLE_ORDER:
        return TABLE_ORDER[table]
    return "sort, id" if "sort" in EDITABLE.get(table, ()) else "id"


async def admin_list(table: str, limit: int = 60) -> list[aiosqlite.Row]:
    _check(table)
    db = get_db()
    order = table_order(table)
    async with db.execute(f"SELECT * FROM {table} ORDER BY {order} LIMIT ?", (limit,)) as cur:
        return await cur.fetchall()


async def admin_get(table: str, row_id: int) -> aiosqlite.Row | None:
    _check(table)
    db = get_db()
    async with db.execute(f"SELECT * FROM {table} WHERE id = ?", (row_id,)) as cur:
        return await cur.fetchone()


async def admin_update(table: str, row_id: int, column: str, value) -> None:
    _check(table, column)
    db = get_db()
    await db.execute(f"UPDATE {table} SET {column} = ? WHERE id = ?", (value, row_id))
    await db.commit()


async def admin_toggle(table: str, row_id: int, column: str = "is_active") -> int:
    """Faol/o'chirilgan holatini almashtiradi va yangi qiymatni qaytaradi."""
    _check(table, column)
    db = get_db()
    await db.execute(
        f"UPDATE {table} SET {column} = 1 - COALESCE({column}, 0) WHERE id = ?", (row_id,)
    )
    await db.commit()
    row = await admin_get(table, row_id)
    return int(row[column]) if row else 0


async def admin_insert(table: str, data: dict[str, Any]) -> int:
    _check(table)
    for column in data:
        _check(table, column)
    if not data:
        raise ValueError("Bo'sh ma'lumot")

    db = get_db()
    columns = ", ".join(data)
    marks = ", ".join("?" for _ in data)
    cur = await db.execute(
        f"INSERT INTO {table} ({columns}) VALUES ({marks})", tuple(data.values())
    )
    await db.commit()
    return int(cur.lastrowid)


async def admin_delete(table: str, row_id: int) -> None:
    _check(table)
    db = get_db()
    await db.execute(f"DELETE FROM {table} WHERE id = ?", (row_id,))
    await db.commit()


async def admin_next_sort(table: str) -> int:
    _check(table)
    if "sort" not in EDITABLE[table]:
        return 0
    db = get_db()
    async with db.execute(f"SELECT COALESCE(MAX(sort), 0) + 1 FROM {table}") as cur:
        row = await cur.fetchone()
    return int(row[0])


# =====================================================================
#  TARTIBNI BOSHQARISH: QAYTA RAQAMLASH VA KO'CHIRISH
#
#  MUAMMO. `sort` — oddiy son va admin uni QO'LDA yozardi. Vaqt o'tib
#  u ishonchsiz bo'lib qoladi:
#
#    * yangi yozuv `MAX(sort) + 1` oladi, o'chirilganda esa raqam
#      BO'SHLIQ bo'lib qoladi: 1, 2, 4, 7, 8 ...
#    * ikki yozuvga bir xil raqam yozilsa tartib `id` ga tushib qoladi
#      va admin nima uchun shunday turganini tushunmaydi;
#    * o'rtaga bitta yozuv qo'shish uchun keyingi HAMMASINI qo'lda
#      qayta raqamlash kerak edi.
#
#  YECHIM. Ikkita amal:
#
#    `resequence_sort()` — tartibni 10, 20, 30 ... qilib qayta yozadi.
#        KO'RINADIGAN ketma-ketlik SAQLANADI, faqat raqamlar tozalanadi.
#        Har qo'shish/o'chirish/ko'chirishdan keyin chaqiriladi, ya'ni
#        bo'shliq va takror hech qachon yig'ilib qolmaydi.
#        10 qadam ATAYLAB: admin xohlasa qo'lda 15 yozib ikki yozuv
#        orasiga qo'shishi mumkin.
#
#    `admin_move()` — yozuvni bir pog'ona yuqori/pastga suradi. Admin
#        raqam o'ylab o'tirmaydi, ↑/↓ bosadi.
#
#  IKKISI HAM GURUHNI HISOBGA OLADI (`service_group`). Ya'ni
#  konfiguratorni «pastga» bosib oddiy xizmatlar orasiga tushirib
#  bo'lmaydi va «Tez kunda» xizmatni yuqoriga chiqarib bo'lmaydi —
#  guruh chegarasida ko'chirish shunchaki TO'XTAYDI.
# =====================================================================

_SORT_STEP = 10


def row_group(table: str, row) -> int:
    """Qatorning guruhi. Guruhlash faqat `services` da bor, qolganlarida
    hammasi bitta guruh (0) — ya'ni oddiy ro'yxat.

    Admin paneli ham shu funksiyaga tayanadi: ro'yxatda guruh sarlavhasi
    chizish va ↑/↓ tugmalarini guruh chetida o'chirish uchun."""
    return service_group(row) if table == "services" else 0


async def _ordered_rows(table: str) -> list[aiosqlite.Row]:
    """Jadvalning BARCHA qatorlari ko'rinadigan tartibda (limitsiz)."""
    db = get_db()
    async with db.execute(f"SELECT * FROM {table} ORDER BY {table_order(table)}") as cur:
        return await cur.fetchall()


async def resequence_sort(table: str) -> int:
    """`sort` ni 10, 20, 30 ... qilib qayta yozadi. Tartib O'ZGARMAYDI.

    Nechta qator yangilanganini qaytaradi. Hech narsa o'zgarmasa 0 —
    ya'ni bekorga `commit()` qilinmaydi.
    """
    _check(table)
    if "sort" not in EDITABLE.get(table, ()):
        return 0

    rows = await _ordered_rows(table)
    db = get_db()
    changed = 0
    for index, row in enumerate(rows, start=1):
        want = index * _SORT_STEP
        if int(row["sort"] or 0) == want:
            continue
        await db.execute(f"UPDATE {table} SET sort = ? WHERE id = ?", (want, row["id"]))
        changed += 1

    if changed:
        await db.commit()
    return changed


async def admin_move(table: str, row_id: int, direction: str) -> dict[str, Any]:
    """Yozuvni bir pog'ona yuqori (`up`) yoki pastga (`down`) suradi.

    Qaytaradi: `{"moved": bool, "reason": str | None}`. `moved=False`
    bo'lsa sabab aytiladi — chegaraga yetgan yoki guruh tugagan.
    Bu xato EMAS: panel shunchaki «yuqoriga chiqmaydi» deb ko'rsatadi.
    """
    _check(table)
    if "sort" not in EDITABLE.get(table, ()):
        raise ValueError("Bu bo'limda tartib yo'q")
    if direction not in ("up", "down"):
        raise ValueError("Yo'nalish 'up' yoki 'down' bo'lishi kerak")

    rows = await _ordered_rows(table)
    index = next((i for i, row in enumerate(rows) if int(row["id"]) == int(row_id)), None)
    if index is None:
        return {"moved": False, "reason": "Element topilmadi"}

    target = index - 1 if direction == "up" else index + 1
    if target < 0 or target >= len(rows):
        return {"moved": False, "reason": "Bu chetiga yetgan"}

    # Guruh chegarasidan o'tmaymiz: konfigurator har doim tepada,
    # «Tez kunda» har doim oxirida turishi kerak.
    if row_group(table, rows[index]) != row_group(table, rows[target]):
        return {"moved": False, "reason": "Bu guruhning chetiga yetgan"}

    # Ro'yxatni almashtirib, butun tartibni qaytadan yozamiz. `sort`
    # qiymatlarini shunchaki almashtirish YETARLI EMAS: ular teng yoki
    # bo'sh bo'lsa almashtirish hech narsani o'zgartirmaydi.
    rows = list(rows)
    rows[index], rows[target] = rows[target], rows[index]

    db = get_db()
    for position, row in enumerate(rows, start=1):
        await db.execute(
            f"UPDATE {table} SET sort = ? WHERE id = ?", (position * _SORT_STEP, row["id"])
        )
    await db.commit()
    return {"moved": True, "reason": None}


async def admin_count(table: str) -> int:
    _check(table)
    db = get_db()
    async with db.execute(f"SELECT COUNT(*) FROM {table}") as cur:
        row = await cur.fetchone()
    return int(row[0])


# ========================================================================
#      KATALOGNI BULUTGA SAQLASH VA TIKLASH
#
# Admin panelda qo'shilgan tovar/linza/ochki va boshqalar ilgari FAQAT
# vaqtinchalik bazada qolardi — qayta deployda hammasi yo'qolib, o'rniga
# demo katalog qaytardi. Endi har bir o'zgarish bulutga yoziladi va
# bot ishga tushganda qaytariladi.
#
# ID'lar tozalangandan keyin o'zgaradi, shuning uchun moslash NOM bo'yicha
# bo'ladi (har bir jadvalning "nom" ustuni quyida).
# ========================================================================

CATALOG_KEY: dict[str, str] = {
    "categories": "name",
    "cars": "name",
    "biled_types": "name",
    "shrouds": "name",
    "optic_colors": "name",
    "services": "name",
    "products": "name",
    "banners": "title",
    "stories": "title",
    "promos": "title",
    "music": "title",
}

# Boshqa jadvalga bog'langan ustunlar: ustun -> (jadval, bulutdagi nom kaliti).
# Bulutda ID emas, NOM saqlanadi — ID'lar o'zgargani uchun.
CATALOG_LINKS: dict[str, dict[str, tuple[str, str]]] = {
    "products": {
        "category_id": ("categories", "categoryName"),
        "car_id": ("cars", "carName"),
    },
    "banners": {"car_id": ("cars", "carName")},
}

# Bulutga yozilmaydigan ustunlar (o'zi yasaladi / to'qnashuv keltiradi)
CATALOG_SKIP = {"slug", "external_id"}

# Jadvallarni tiklash tartibi: avval bog'lanadiganlar
CATALOG_ORDER = (
    "categories",
    "cars",
    "biled_types",
    "shrouds",
    "optic_colors",
    "services",
    "products",
    "banners",
    "stories",
    "promos",
    # Fon musiqasi ham bulutga ko'chiriladi: qayta deployda yo'qolmasin
    # va zaxira rejimda (tashqi URL bo'lsa) eshitilishda davom etsin.
    "music",
)


def catalog_columns(table: str) -> list[str]:
    """Bulutga saqlanadigan ustunlar ro'yxati."""
    return sorted(column for column in EDITABLE.get(table, ()) if column not in CATALOG_SKIP)


async def get_row_name(table: str, row_id) -> str | None:
    """Bog'langan yozuvning nomini qaytaradi (bulutda ID o'rniga saqlash uchun)."""
    if table not in CATALOG_KEY or row_id in (None, ""):
        return None
    try:
        row_id = int(row_id)
    except (TypeError, ValueError):
        return None
    db = get_db()
    column = CATALOG_KEY[table]
    async with db.execute(f"SELECT {column} AS label FROM {table} WHERE id = ?", (row_id,)) as cur:
        row = await cur.fetchone()
    return str(row["label"]) if row and row["label"] else None


async def catalog_find(table: str, key_value: str) -> int | None:
    """Nom bo'yicha yozuvni topadi (katta-kichik harfga e'tibor bermaydi)."""
    if table not in CATALOG_KEY:
        raise ValueError(f"Ruxsat berilmagan jadval: {table}")
    if key_value is None or not str(key_value).strip():
        return None
    db = get_db()
    column = CATALOG_KEY[table]
    async with db.execute(
        f"SELECT id FROM {table} WHERE lower(TRIM({column})) = lower(TRIM(?))"
        " ORDER BY id LIMIT 1",
        (str(key_value),),
    ) as cur:
        row = await cur.fetchone()
    return int(row["id"]) if row else None


async def ensure_category(name: str | None) -> int | None:
    """Kategoriyani topadi, bo'lmasa yaratadi (tovar unga bog'lanishi shart)."""
    if not name or not str(name).strip():
        return None
    found = await catalog_find("categories", name)
    if found:
        return found
    db = get_db()
    cur = await db.execute("INSERT INTO categories (name) VALUES (?)", (str(name).strip(),))
    await db.commit()
    logger.info("Bulutdan tiklashda kategoriya yaratildi: %s", name)
    return int(cur.lastrowid)


async def catalog_upsert(table: str, values: dict[str, Any]) -> tuple[int, bool]:
    """Nom bo'yicha yangilaydi yoki yangi qo'shadi.

    Qaytaradi: (id, yangi_qo'shildimi).
    """
    if table not in CATALOG_KEY:
        raise ValueError(f"Ruxsat berilmagan jadval: {table}")

    allowed = set(catalog_columns(table))
    data = {column: value for column, value in values.items() if column in allowed}
    key_column = CATALOG_KEY[table]
    key_value = data.get(key_column)
    if key_value is None or not str(key_value).strip():
        raise ValueError(f"«{table}» uchun nom berilmagan")

    db = get_db()
    existing = await catalog_find(table, key_value)

    if existing is not None:
        updates = {c: v for c, v in data.items() if c != key_column}
        if updates:
            assignments = ", ".join(f"{c} = ?" for c in updates)
            await db.execute(
                f"UPDATE {table} SET {assignments} WHERE id = ?",
                (*updates.values(), existing),
            )
            await db.commit()
        return existing, False

    if table == "cars":
        data["slug"] = await _unique_car_slug(str(key_value))

    columns = ", ".join(data)
    marks = ", ".join("?" for _ in data)
    cur = await db.execute(
        f"INSERT INTO {table} ({columns}) VALUES ({marks})", tuple(data.values())
    )
    await db.commit()
    return int(cur.lastrowid), True


async def catalog_delete_by_key(table: str, key_value: str) -> bool:
    """Bulutda o'chirilgan yozuvni mahalliy bazadan ham olib tashlaydi.

    O'chirib bo'lmasa (boshqa yozuvlar bog'langan bo'lsa) — yashiradi.
    """
    if table not in CATALOG_KEY:
        raise ValueError(f"Ruxsat berilmagan jadval: {table}")
    row_id = await catalog_find(table, key_value)
    if row_id is None:
        return False

    db = get_db()
    try:
        await db.execute(f"DELETE FROM {table} WHERE id = ?", (row_id,))
        await db.commit()
    except Exception as error:
        logger.info("«%s» #%s o'chirilmadi (%s) — yashirildi", table, row_id, error)
        await db.execute(f"UPDATE {table} SET is_active = 0 WHERE id = ?", (row_id,))
        await db.commit()
    return True


# ========================================================================
#      TARIXNI BULUTDAN TIKLASH (buyurtmalar, navbatlar)
#
# Firebase'da buyurtmalar katalog ID'lari bilan emas, NOMLAR bilan
# saqlanadi ("Cobalt", "Aozoom A5+"). Sababi: baza tozalangandan keyin
# katalog qaytadan ekiladi va ID'lar o'zgarib ketadi — nom esa o'zgarmaydi.
#
# Shuning uchun tiklashda nom bo'yicha ID topamiz. Agar element o'chirilgan
# bo'lsa, uni YASHIRIN (is_active = 0) holda qayta yaratamiz: shunda
# buyurtma tarixi to'liq ko'rinadi, lekin mijozga katalogda ko'rinmaydi.
# ========================================================================

_NAME_TABLES = {"cars", "biled_types", "shrouds", "optic_colors", "services"}


async def find_by_name(table: str, name: str) -> int | None:
    """Nom bo'yicha ID topadi (katta-kichik harf va bo'shliqqa e'tibor bermaydi)."""
    if table not in _NAME_TABLES:
        raise ValueError(f"Ruxsat berilmagan jadval: {table}")
    if not name or not str(name).strip():
        return None
    db = get_db()
    async with db.execute(
        f"SELECT id FROM {table} WHERE lower(TRIM(name)) = lower(TRIM(?)) ORDER BY id LIMIT 1",
        (str(name),),
    ) as cur:
        row = await cur.fetchone()
    return int(row["id"]) if row else None


async def _unique_car_slug(name: str) -> str:
    """Mashina nomidan takrorlanmaydigan slug yasaydi (ustun UNIQUE)."""
    base = re.sub(r"[^a-z0-9]+", "", str(name).lower()) or "car"
    existing = {row["slug"] for row in await get_cars(active_only=False)}
    slug, index = base, 1
    while slug in existing:
        index += 1
        slug = f"{base}{index}"
    return slug


async def ensure_car(name: str | None) -> int | None:
    """Mashinani nom bo'yicha topadi, bo'lmasa yashirin holda yaratadi."""
    if not name or not str(name).strip():
        return None
    found = await find_by_name("cars", name)
    if found:
        return found

    slug = await _unique_car_slug(str(name))
    db = get_db()
    cur = await db.execute(
        "INSERT INTO cars (name, slug, is_active) VALUES (?, ?, 0)", (str(name).strip(), slug)
    )
    await db.commit()
    logger.info("Tarix uchun yashirin mashina yaratildi: %s", name)
    return int(cur.lastrowid)


async def _ensure_simple(table: str, name: str | None) -> int | None:
    """Nomi bor jadvallar uchun umumiy "topib ol yoki yashirin yarat"."""
    if not name or not str(name).strip():
        return None
    found = await find_by_name(table, name)
    if found:
        return found
    db = get_db()
    cur = await db.execute(
        f"INSERT INTO {table} (name, is_active) VALUES (?, 0)", (str(name).strip(),)
    )
    await db.commit()
    logger.info("Tarix uchun yashirin yozuv yaratildi: %s.%s", table, name)
    return int(cur.lastrowid)


async def ensure_biled(name: str | None) -> int | None:
    return await _ensure_simple("biled_types", name)


async def ensure_shroud(name: str | None) -> int | None:
    return await _ensure_simple("shrouds", name)


async def ensure_color(name: str | None) -> int | None:
    return await _ensure_simple("optic_colors", name)


async def ensure_service(name: str | None) -> int | None:
    return await _ensure_simple("services", name)


async def ensure_user(user_id: int, full_name: str | None, phone: str | None) -> None:
    """Buyurtma egasini yaratadi (agar hali bazada bo'lmasa).

    Buyurtmalar `users` ga bog'langan, shuning uchun tarixni tiklashdan
    oldin mijoz qatori bo'lishi kerak. Mavjud ma'lumot ustidan YOZMAYDI.
    """
    db = get_db()
    await db.execute(
        "INSERT INTO users (user_id, full_name, phone) VALUES (?, ?, ?)"
        " ON CONFLICT(user_id) DO NOTHING",
        (user_id, (full_name or "Mijoz").strip(), phone),
    )
    await db.commit()


async def restore_biled_order(data: dict[str, Any]) -> bool:
    """Bi-LED buyurtmasini asl ID'si bilan tiklaydi. True — yangi qo'shildi."""
    db = get_db()
    cur = await db.execute(
        "INSERT OR IGNORE INTO biled_orders"
        " (id, user_id, car_id, biled_id, shroud_id, color_id, total, phone,"
        "  comment, status, created_at)"
        " VALUES (:id, :user_id, :car_id, :biled_id, :shroud_id, :color_id, :total,"
        "         :phone, :comment, :status, COALESCE(:created_at, datetime('now')))",
        data,
    )
    await db.commit()
    return cur.rowcount > 0


async def import_external_order(data: dict[str, Any], items: Sequence[dict]) -> int | None:
    """Worker orderini alohida BEGIN IMMEDIATE tranzaksiyada dedupe/import qiladi.

    Qoldiq faqat muvaffaqiyatli rezerv qilingan qator uchun qaytarilishi
    mumkin (`stock_reserved=1`). Allaqachon bekor order umuman rezerv qilmaydi.
    """
    code = str(data.get("external_code") or "").strip() or None
    status = str(data.get("status") or "new")
    prepared: list[dict[str, Any]] = []
    for item in items:
        try:
            qty = max(1, int(item.get("qty") or 1))
            product_id = int(item.get("product_id") or 0) or None
        except (TypeError, ValueError):
            continue
        prepared.append(
            {
                "product_id": product_id,
                "name": str(item.get("name") or "Tovar")[:200],
                "price": int(item.get("price") or 0),
                "qty": qty,
                "size": _normalize_size(item.get("size")),
            }
        )

    total = int(data.get("total") or 0)
    if total <= 0:
        total = sum(item["price"] * item["qty"] for item in prepared)

    async with write_lock(), _write_transaction() as db:
        if code:
            async with db.execute(
                "SELECT id FROM orders WHERE external_code = ?", (code,)
            ) as cur:
                if await cur.fetchone():
                    return None

        try:
            cur = await db.execute(
                "INSERT INTO orders"
                " (user_id, total, address, phone, delivery_method, delivery_info,"
                "  payment_method, status, created_at, external_code)"
                " VALUES (?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, datetime('now')), ?)",
                (
                    int(data["user_id"]),
                    total,
                    data.get("address"),
                    data.get("phone"),
                    data.get("delivery_method"),
                    data.get("delivery_info"),
                    data.get("payment_method"),
                    status,
                    data.get("created_at"),
                    code,
                ),
            )
        except aiosqlite.IntegrityError:
            # Boshqa process shu external_code'ni oldin yozgan bo'lishi mumkin.
            if code:
                async with db.execute(
                    "SELECT id FROM orders WHERE external_code = ?", (code,)
                ) as cursor:
                    if await cursor.fetchone():
                        return None
            raise

        order_id = int(cur.lastrowid)
        rows: list[tuple[Any, ...]] = []
        for item in prepared:
            reserved = False
            product_id = item["product_id"]
            if status != "cancelled" and product_id is not None:
                product = await _fetch_product(db, product_id)
                if product is not None:
                    reserved, problem = await _reserve_product_stock(
                        db, product, item["qty"], item["size"]
                    )
                    if not reserved:
                        logger.warning(
                            "Worker order %s qatori rezerv qilinmadi: product=%s reason=%s",
                            code or order_id,
                            product_id,
                            (problem or {}).get("reason"),
                        )
            rows.append(
                (
                    order_id,
                    product_id,
                    item["name"],
                    item["price"],
                    item["qty"],
                    item["size"],
                    int(reserved),
                )
            )

        if rows:
            await db.executemany(
                "INSERT INTO order_items"
                " (order_id, product_id, name, price, qty, size, stock_reserved)"
                " VALUES (?, ?, ?, ?, ?, ?, ?)",
                rows,
            )
        return order_id


async def restore_shop_order(data: dict[str, Any], items: Sequence[dict]) -> bool:
    """Do'kon buyurtmasini va tarkibini bulutdan tiklaydi. True — yangi qo'shildi.

    Sarlavha va tarkib BITTA tranzaksiyada yoziladi — ilgari ular alohida
    commit qilinardi va jarayon ular orasida uzilsa buyurtma tarkibsiz
    qolib, keyingi tiklashda `False` qaytib, detallar abadiy tiklanmasdi.
    Endi tarkibi yo'q eski sarlavha ham TA'MIRLANADI.

    Razmer bulutdagi nusxada saqlanadi va tiklanadi. Tovar ID'si mavjud
    bo'lsa bog'lanadi, lekin `stock_reserved=0` — bu bulut nusxasi bo'lgani
    uchun bekor qilinganda qoldiq QAYTARILMAYDI (aks holda sotuvda
    kamaygan qoldiq ikki marta hisoblanib shishardi).
    """
    order_id = int(data["id"])

    def _prepared_rows() -> list[tuple[Any, ...]]:
        rows: list[tuple[Any, ...]] = []
        for item in items:
            if not isinstance(item, dict):
                continue
            try:
                pid_raw = item.get("productId")
                product_id = int(pid_raw) if pid_raw is not None else None
            except (TypeError, ValueError):
                product_id = None
            rows.append(
                (
                    order_id,
                    product_id,
                    str(item.get("name") or "Tovar")[:200],
                    int(item.get("price") or 0),
                    max(1, int(item.get("qty") or 1)),
                    _normalize_size(item.get("size")),
                )
            )
        return rows

    async with write_lock(), _write_transaction() as db:
        cur = await db.execute(
            "INSERT OR IGNORE INTO orders"
            " (id, user_id, total, address, phone, delivery_method, delivery_info,"
            "  payment_method, status, created_at)"
            " VALUES (:id, :user_id, :total, :address, :phone, :delivery_method,"
            "         :delivery_info, :payment_method, :status,"
            "         COALESCE(:created_at, datetime('now')))",
            data,
        )
        created = cur.rowcount > 0

        if not created:
            # Sarlavha bor — tarkibi ham bormi? Bo'lsa hech narsa qilmaymiz.
            async with db.execute(
                "SELECT 1 FROM order_items WHERE order_id = ? LIMIT 1", (order_id,)
            ) as check:
                if await check.fetchone() is not None:
                    return False
            # Tarkibsiz sarlavha — ta'mirlaymiz (pastda item yoziladi).

        rows = _prepared_rows()
        if rows:
            # Tovar ID mavjud bo'lmasa bog'lamaymiz (qayta qurilgan bazada
            # ID'lar siljigan bo'lishi mumkin) — noto'g'ri tovarga bog'lanib
            # qolmasin.
            existing = {
                int(r[0])
                for r in await (
                    await db.execute("SELECT id FROM products")
                ).fetchall()
            }
            normalized = [
                (
                    oid,
                    (pid if pid in existing else None),
                    name,
                    price,
                    qty,
                    size,
                )
                for (oid, pid, name, price, qty, size) in rows
            ]
            await db.executemany(
                "INSERT INTO order_items"
                " (order_id, product_id, name, price, qty, size, stock_reserved)"
                " VALUES (?, ?, ?, ?, ?, ?, 0)",
                normalized,
            )
        return created


async def restore_booking(data: dict[str, Any]) -> bool:
    """Navbatni asl ID'si bilan tiklaydi. True — yangi qo'shildi."""
    db = get_db()
    cur = await db.execute(
        "INSERT OR IGNORE INTO bookings"
        " (id, user_id, service_id, date, time, status, created_at)"
        " VALUES (:id, :user_id, :service_id, :date, :time, :status,"
        "         COALESCE(:created_at, datetime('now')))",
        data,
    )
    await db.commit()
    return cur.rowcount > 0


def media_of(row: aiosqlite.Row, kind: str = "photo") -> tuple[str | None, str | None]:
    """(file_id, url) juftligini qaytaradi — mavjud bo'lganini."""
    keys = row.keys()
    file_id = row[f"{kind}_id"] if f"{kind}_id" in keys else None
    url = row[f"{kind}_url"] if f"{kind}_url" in keys else None
    return file_id, url
