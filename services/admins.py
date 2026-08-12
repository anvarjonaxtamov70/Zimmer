"""Adminlar registri — "kim admin" savoliga bitta ishonchli javob.

Uch qatlam birlashtiriladi:

  1. `config.CORE_ADMINS` — kodda yozilgan asosiy adminlar (Avto_A1 dagi
     bilan bir xil). Hech qanday holatda o'chmaydi: env yo'q bo'lsa ham,
     baza tozalansa ham, Firebase ulanmasa ham admin bo'lib qoladi.
  2. `ADMINS` / `ADMINS_EXTRA` env o'zgaruvchilari — Render panelidan.
  3. Bot ichidan qo'shilganlar — SQLite `admins` jadvali + Firebase.
     Bulutda saqlangani uchun qayta deploydan keyin ham tiklanadi.

Tekshiruv har safar shu registrdan o'qiladi (`config.is_admin`), shuning
uchun yangi admin qo'shilganda xizmatni qayta ishga tushirish kerak emas.
"""

import logging

from config import (
    CORE_ADMINS,
    add_runtime_admin,
    admin_source,
    all_admins,
    config,
    is_admin,
    is_env_admin,
    remove_runtime_admin,
    set_runtime_admins,
)
from database import queries as q
from services import sync

logger = logging.getLogger(__name__)


async def load() -> list[int]:
    """Bazadagi adminlarni registrga yuklaydi (bot ishga tushganda)."""
    try:
        stored = await q.get_admin_ids()
    except Exception as error:  # baza hali tayyor bo'lmasa ham bot ishlasin
        logger.warning("Adminlar bazadan o'qilmadi: %s", error)
        stored = []

    set_runtime_admins(stored)
    admins = all_admins()
    logger.info(
        "Adminlar (%s ta): %s | asosiy: %s ta, env: %s ta, bazadan: %s ta",
        len(admins),
        ", ".join(str(admin_id) for admin_id in admins),
        len(CORE_ADMINS),
        len(config.admins) - len(CORE_ADMINS),
        len(stored),
    )
    return admins


async def grant(user_id: int, full_name: str | None = None, added_by: int | None = None) -> bool:
    """Yangi admin qo'shadi (baza + Firebase + jonli registr).

    Qaytaradi: True — yangi qo'shildi, False — allaqachon admin edi.
    """
    already = is_admin(user_id)
    await q.add_admin(user_id, full_name, added_by)
    add_runtime_admin(user_id)
    await sync.push_admin(user_id, full_name, added_by)
    if not already:
        logger.info("Yangi admin qo'shildi: %s (%s)", full_name or "-", user_id)
    return not already


async def revoke(user_id: int) -> tuple[bool, str]:
    """Adminni olib tashlaydi.

    Qaytaradi: (bajarildimi, sabab). Kod/env adminlarini bot ichidan
    o'chirib bo'lmaydi — ular ataylab "o'chmas" qilingan.
    """
    if is_env_admin(user_id):
        return False, "protected"
    removed_db = await q.remove_admin(user_id)
    removed_mem = remove_runtime_admin(user_id)
    if not (removed_db or removed_mem):
        return False, "not_admin"
    await sync.remove_admin(user_id)
    logger.info("Admin olib tashlandi: %s", user_id)
    return True, "ok"


def source_label(user_id: int) -> str:
    """Admin qayerdan kelganini o'zbekcha yozadi."""
    return {
        "core": "asosiy (kodda)",
        "env": "env (Render)",
        "runtime": "bot ichidan",
    }.get(admin_source(user_id), "admin emas")


async def describe() -> str:
    """Adminlar ro'yxatini matn ko'rinishida qaytaradi."""
    stored = {row["user_id"]: row["full_name"] for row in await q.get_admins()}
    lines = [f"👑 <b>Adminlar</b> — {len(all_admins())} ta\n"]
    for admin_id in all_admins():
        name = stored.get(admin_id)
        title = f"{name} · " if name else ""
        lines.append(f"• <code>{admin_id}</code> — {title}{source_label(admin_id)}")
    lines.append(
        "\nQo'shish: <code>/admin_add ID</code>\n"
        "Olib tashlash: <code>/admin_del ID</code>\n"
        "<i>Asosiy va env adminlarini bot ichidan o'chirib bo'lmaydi.</i>"
    )
    return "\n".join(lines)
