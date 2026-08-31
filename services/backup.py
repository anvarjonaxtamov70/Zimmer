"""To'liq zaxira nusxa: SQLite -> Firebase RTDB.

NEGA BU KERAK
Render'ning bepul tarifida disk saqlanmaydi — qayta deployda SQLite fayli
tozalanadi. `services/sync.py` alohida yozuvlarni (mijoz, buyurtma, katalog)
bulutga ko'chirib turadi, lekin bu qism-qism sinxron. Bu modul esa BUTUN
bazani bir lahzalik NUSXA qilib Firebase'ga yozadi:

    backups/latest       — eng oxirgi nusxa (doim ustiga yoziladi);
    backups/{YYYYMMDD}    — kunlik nusxa (tarix; tasodifiy buzilishdan tiklash).

Yozuv `services/sync._write` orqali ketadi — ya'ni Firebase hozir javob
bermasa nusxa DOIMIY navbatga (outbox) tushadi va keyin yuboriladi.

DIQQAT: bu modul HECH QACHON botni yiqitmaydi — barcha xatolar yutiladi.
"""

import asyncio
import logging
from datetime import UTC, datetime

from config import config
from database.db import get_db
from services import firebase, sync

logger = logging.getLogger(__name__)


async def export_all() -> dict:
    """Bazadagi BARCHA jadvallarni JSON'ga aylantiriladigan lug'atga dump qiladi.

    Qaytadi:
        {
          "_exported_at": "<UTC ISO8601>",
          "counts": {"users": 12, "orders": 34, ...},
          "tables": {"users": [ {..row..}, ... ], ...},
        }

    Jadvallar `sqlite_master` dan olinadi — ya'ni ro'yxatda AYNAN o'sha
    paytda bazada bor jadvallar bo'ladi (users, admins, categories, cars,
    products, banners, stories, orders, order_items, bookings, biled_orders
    va boshqalari). Har bir jadval alohida `try` bilan o'qiladi: bittasi
    yiqilsa qolganlari baribir nusxaga tushadi.
    """
    db = get_db()

    try:
        async with db.execute(
            "SELECT name FROM sqlite_master WHERE type = 'table'"
            " AND name NOT LIKE 'sqlite_%' ORDER BY name"
        ) as cur:
            names = [row["name"] for row in await cur.fetchall()]
    except Exception as error:
        logger.warning("Zaxira: jadvallar ro'yxati o'qilmadi: %s", error)
        names = []

    tables: dict[str, list[dict]] = {}
    counts: dict[str, int] = {}
    for name in names:
        try:
            async with db.execute(f"SELECT * FROM {name}") as cur:
                rows = await cur.fetchall()
            tables[name] = [{key: row[key] for key in row.keys()} for row in rows]
            counts[name] = len(rows)
        except Exception as error:
            logger.warning("Zaxira: «%s» jadvali o'qilmadi: %s", name, error)

    return {
        "_exported_at": datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "counts": counts,
        "tables": tables,
    }


async def backup_to_firebase() -> bool:
    """Bazaning to'liq nusxasini Firebase'ga yozadi (latest + kunlik).

    Faqat Firebase sozlangan bo'lsa ishlaydi. `sync._write` ishlatilgani
    uchun Firebase hozir javob bermasa nusxa doimiy navbatga tushadi.

    Qaytadi: nusxa (hech bo'lmasa navbatga) qabul qilindimi.
    """
    if not config.has_firebase:
        return False

    try:
        data = await export_all()
    except Exception as error:
        logger.warning("Zaxira nusxa tayyorlanmadi: %s", error)
        return False

    day = datetime.now(UTC).strftime("%Y%m%d")
    try:
        # `latest` DOIM yoziladi. Kunlik nusxa (`backups/{day}`) esa FAQAT
        # `latest` hoziroq (navbatga tushmasdan) yetib borgan bo'lsa
        # yoziladi — aks holda Firebase o'chganda BUTUN baza ikki marta
        # doimiy navbatga (outbox) tushib, uni to'ldirib yuborardi.
        latest = await sync._write("backups/latest", data, method="put")
        daily = False
        if latest:
            daily = await sync._write(f"backups/{day}", data, method="put")
    except Exception as error:
        logger.warning("Zaxira nusxa yozilmadi: %s", error)
        return False

    if daily:
        await _prune_old_backups()

    total = sum(data.get("counts", {}).values())
    if latest:
        logger.info(
            "To'liq zaxira nusxa Firebase'ga yozildi (backups/latest%s) — %s ta yozuv",
            f", backups/{day}" if daily else "",
            total,
        )
    else:
        logger.info(
            "To'liq zaxira nusxa navbatga qo'yildi (Firebase hozir javob bermadi) — "
            "%s ta yozuv",
            total,
        )
    return latest


async def _prune_old_backups() -> None:
    """`backups/{YYYYMMDD}` nusxalaridan eng so'nggi N kunini qoldiradi.

    `config.backup_keep_days` = 0 bo'lsa hech narsa o'chirilmaydi. Xatolar
    yutiladi — tozalash asosiy zaxirani to'xtatmasin.
    """
    keep = config.backup_keep_days
    if keep <= 0:
        return
    try:
        node = await firebase.get("backups")
    except Exception as error:
        logger.debug("Eski zaxiralar ro'yxati o'qilmadi: %s", error)
        return
    if not isinstance(node, dict):
        return

    # Faqat kunlik (8 xonali) kalitlar; `latest` tegilmaydi.
    days = sorted(k for k in node if isinstance(k, str) and len(k) == 8 and k.isdigit())
    for old in days[:-keep]:
        try:
            await sync._write(f"backups/{old}", None, method="delete")
        except Exception as error:
            logger.debug("Eski zaxira o'chirilmadi (%s): %s", old, error)


async def backup_worker(interval_seconds: int | None = None) -> None:
    """Fon vazifasi: vaqti-vaqti bilan to'liq zaxira nusxa yozadi.

    `interval_seconds` berilmasa `config.backup_interval_hours` dan olinadi
    (standart 24 soat). 0 yoki manfiy bo'lsa — vazifa o'chiq.
    """
    if interval_seconds is None:
        interval_seconds = max(0, config.backup_interval_hours) * 3600

    if interval_seconds <= 0:
        logger.info("Zaxira vazifasi o'chiq (BACKUP_INTERVAL_HOURS=0).")
        return

    # Ishga tushishni tiqilib qoldirmaslik uchun birinchi nusxani biroz
    # kutib qilamiz (server to'liq ko'tarilsin, boshlang'ich sinxron tugasin).
    await asyncio.sleep(min(interval_seconds, 300))

    logger.info("Zaxira vazifasi yoqildi: har %s soatda", interval_seconds // 3600)
    while True:
        try:
            await backup_to_firebase()
        except asyncio.CancelledError:
            raise
        except Exception as error:  # fon vazifasi to'xtamasligi kerak
            logger.warning("Zaxira nusxa vazifasi xatosi: %s", error)
        await asyncio.sleep(interval_seconds)
