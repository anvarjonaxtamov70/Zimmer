"""Admin panel: katalogni to'liq boshqarish (universal CRUD).

Bitta dvigatel barcha bo'limlarga xizmat qiladi: mashinalar, Bi-LED linzalar,
ochkilar, optika ranglari, mahsulotlar, kategoriyalar, xizmatlar, bannerlar,
stories va aksiyalar. Har bir maydonni alohida tahrirlash, rasm/video yuklash,
faol/o'chirilgan holatini almashtirish va o'chirish mumkin.

Callback sxemasi (64 baytga sig'adi):
    ael:<key>                 — ro'yxat
    aed:<key>:<id>            — element kartochkasi
    aef:<key>:<id>:<column>   — maydonni tahrirlash (matn/son/rang/media)
    aec:<key>:<id>:<column>:<value> — ro'yxatdan tanlash (choice)
    aet:<key>:<id>            — faol/o'chirilgan
    aem:<key>:<id>:<kind>     — rasm yoki videoni o'chirish
    aev:<key>:<id>:<kind>     — media'ni ko'rish
    aen:<key>                 — yangi qo'shish
    aex / aey                 — o'chirishni so'rash / tasdiqlash
"""

import logging
from collections.abc import Sequence

from aiogram import F, Router
from aiogram.filters import Command
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup
from aiogram.types import (
    CallbackQuery,
    InlineKeyboardButton,
    InlineKeyboardMarkup,
    Message,
)
from aiogram.utils.keyboard import InlineKeyboardBuilder

from database import queries as q
from handlers.admin_schema import ENTITIES, Entity, Field, parse_value, prepare_insert
from keyboards.reply import cancel_kb, main_menu
from utils.filters import IsAdmin
from utils.helpers import fmt_price
from utils.texts import BTN_CANCEL
from utils.ui import edit_or_send

logger = logging.getLogger(__name__)

router = Router(name="admin_crud")
# Jonli admin tekshiruvi (utils/filters.py) — import paytida "muzlatilmaydi"
router.message.filter(IsAdmin())
router.callback_query.filter(IsAdmin())


class EntityEdit(StatesGroup):
    value = State()


class EntityNew(StatesGroup):
    value = State()


# ----------------------------------------------------------------- menyular


def catalog_menu_kb() -> InlineKeyboardMarkup:
    kb = InlineKeyboardBuilder()
    for entity in ENTITIES.values():
        kb.button(text=f"{entity.icon} {entity.title}", callback_data=f"ael:{entity.key}")
    kb.adjust(2)
    kb.row(InlineKeyboardButton(text="⬅️ Admin menyu", callback_data="adm:menu"))
    return kb.as_markup()


def _list_kb(entity: Entity, rows: Sequence) -> InlineKeyboardMarkup:
    kb = InlineKeyboardBuilder()
    for row in rows:
        mark = "🟢" if _active(row) else "🔴"
        kb.button(text=f"{mark} {entity.label(row)}", callback_data=f"aed:{entity.key}:{row['id']}")
    kb.adjust(1)
    kb.row(InlineKeyboardButton(text="➕ Yangi qo'shish", callback_data=f"aen:{entity.key}"))
    kb.row(InlineKeyboardButton(text="⬅️ Katalog", callback_data="adm:catalog"))
    return kb.as_markup()


def _active(row) -> bool:
    return "is_active" not in row.keys() or bool(row["is_active"])


def _detail_kb(entity: Entity, row) -> InlineKeyboardMarkup:
    kb = InlineKeyboardBuilder()
    rid = row["id"]

    for f in entity.fields:
        if f.kind in ("photo", "video"):
            continue
        kb.button(text=f"✏️ {f.label}", callback_data=f"aef:{entity.key}:{rid}:{f.column}")
    kb.adjust(2)

    for kind, icon, label in (("photo", "🖼", "Rasm"), ("video", "🎬", "Video")):
        if not any(f.kind == kind for f in entity.fields):
            continue
        has = bool(row[f"{kind}_id"] or row[f"{kind}_url"]) if f"{kind}_id" in row.keys() else False
        buttons = [
            InlineKeyboardButton(
                text=f"{icon} {label}" + (" almashtirish" if has else " qo'shish"),
                callback_data=f"aef:{entity.key}:{rid}:{kind}_id",
            )
        ]
        if has:
            buttons.append(
                InlineKeyboardButton(text="👁", callback_data=f"aev:{entity.key}:{rid}:{kind}")
            )
            buttons.append(
                InlineKeyboardButton(text="🗑", callback_data=f"aem:{entity.key}:{rid}:{kind}")
            )
        kb.row(*buttons)

    if "is_active" in row.keys():
        kb.row(
            InlineKeyboardButton(
                text="🔴 O'chirish (yashirish)" if _active(row) else "🟢 Yoqish",
                callback_data=f"aet:{entity.key}:{rid}",
            )
        )
    kb.row(
        InlineKeyboardButton(text="🗑 Butunlay o'chirish", callback_data=f"aex:{entity.key}:{rid}")
    )
    kb.row(InlineKeyboardButton(text="⬅️ Ro'yxat", callback_data=f"ael:{entity.key}"))
    return kb.as_markup()


def _choice_kb(entity: Entity, rid: int, column: str, choices, new_mode: bool = False):
    """Tanlov klaviaturasi. Yangi element yaratishda alohida prefiks ishlatiladi
    (`aecn:`) — mavjud elementni tahrirlash bilan aralashib ketmasligi uchun."""
    kb = InlineKeyboardBuilder()
    for value, label in choices:
        data = (
            f"aecn:{entity.key}:{column}:{value}"
            if new_mode
            else f"aec:{entity.key}:{rid}:{column}:{value}"
        )
        kb.button(text=label, callback_data=data)
    kb.adjust(1)
    if not new_mode:
        kb.row(
            InlineKeyboardButton(text="⬅️ Orqaga", callback_data=f"aed:{entity.key}:{rid}")
        )
    return kb.as_markup()


# ---------------------------------------------------------------- ko'rinish


def _value_text(f: Field, row) -> str:
    keys = row.keys()
    if f.kind in ("photo", "video"):
        kind = f.column.replace("_id", "")
        if f"{kind}_id" not in keys:
            return "—"
        if row[f"{kind}_id"]:
            return "✅ yuklangan"
        if row[f"{kind}_url"]:
            return f"🔗 {str(row[f'{kind}_url'])[:34]}…"
        return "—"

    if f.column not in keys:
        return "—"
    value = row[f.column]
    if value in (None, ""):
        return "—"
    if f.kind == "money":
        return fmt_price(value)
    if f.kind == "color":
        return f"{value} ⬛"
    if f.column == "category_id":
        return f"#{value}"
    if f.column == "car_id":
        return f"#{value}"
    text = str(value)
    return text if len(text) <= 60 else text[:57] + "…"


async def _detail_text(entity: Entity, row) -> str:
    lines = [f"{entity.icon} <b>{entity.title}</b> · #{row['id']}", ""]

    for f in entity.fields:
        value = _value_text(f, row)
        if f.column == "category_id" and row["category_id"]:
            cat = await q.get_category(row["category_id"])
            value = f"{cat['icon'] or '🗂'} {cat['name']}" if cat else value
        if f.column == "car_id":
            value = "🌐 Barcha mashinalar"
            if row["car_id"]:
                car = await q.get_car(row["car_id"])
                value = car["name"] if car else f"#{row['car_id']}"
        lines.append(f"<b>{f.label}:</b> {value}")

    if "is_active" in row.keys():
        lines.append("")
        lines.append("Holat: " + ("🟢 faol" if _active(row) else "🔴 o'chirilgan"))
    return "\n".join(lines)


async def _show_detail(message: Message, entity: Entity, row_id: int) -> None:
    row = await q.admin_get(entity.table, row_id)
    if not row:
        await edit_or_send(message, "Element topilmadi.", catalog_menu_kb())
        return
    await edit_or_send(message, await _detail_text(entity, row), _detail_kb(entity, row))


# ------------------------------------------------------------------ kirish


@router.callback_query(F.data == "adm:catalog")
@router.message(Command("katalog"))
async def catalog_menu(event, state: FSMContext) -> None:
    await state.clear()
    text = (
        "🗂 <b>Katalogni boshqarish</b>\n\n"
        "Har bir bo'limda: maydonlarni tahrirlash, rasm/video qo'shish,\n"
        "yoqish–o'chirish va yangi element qo'shish mumkin."
    )
    if isinstance(event, Message):
        await event.answer(text, reply_markup=catalog_menu_kb())
    else:
        await edit_or_send(event.message, text, catalog_menu_kb())
        await event.answer()


@router.callback_query(F.data.startswith("ael:"))
async def entity_list(callback: CallbackQuery, state: FSMContext) -> None:
    await state.clear()
    entity = ENTITIES.get(callback.data.split(":")[1])
    if not entity:
        await callback.answer("Bo'lim topilmadi", show_alert=True)
        return

    rows = await q.admin_list(entity.table)
    text = (
        f"{entity.icon} <b>{entity.title}</b>\n\n"
        f"Jami: <b>{len(rows)}</b> ta. Tahrirlash uchun ustiga bosing.\n"
        "🟢 — faol, 🔴 — yashirilgan"
    )
    if not rows:
        text = f"{entity.icon} <b>{entity.title}</b>\n\nHozircha bo'sh. «Yangi qo'shish» ni bosing."
    await edit_or_send(callback.message, text, _list_kb(entity, rows))
    await callback.answer()


@router.callback_query(F.data.startswith("aed:"))
async def entity_detail(callback: CallbackQuery, state: FSMContext) -> None:
    await state.clear()
    _, key, rid = callback.data.split(":")
    entity = ENTITIES.get(key)
    if not entity:
        await callback.answer("Topilmadi", show_alert=True)
        return
    await _show_detail(callback.message, entity, int(rid))
    await callback.answer()


# --------------------------------------------------------- maydonni tahrirlash


@router.callback_query(F.data.startswith("aef:"))
async def field_edit(callback: CallbackQuery, state: FSMContext) -> None:
    _, key, rid, column = callback.data.split(":")
    entity = ENTITIES.get(key)
    if not entity:
        await callback.answer("Topilmadi", show_alert=True)
        return

    f = next((x for x in entity.fields if x.column == column), None)
    if not f:
        await callback.answer("Maydon topilmadi", show_alert=True)
        return

    if f.kind == "choice":
        choices = await f.choices()
        await edit_or_send(
            callback.message,
            f"{entity.icon} <b>{f.label}</b>\n\nKerakli variantni tanlang:",
            _choice_kb(entity, int(rid), column, choices),
        )
        await callback.answer()
        return

    await state.set_state(EntityEdit.value)
    await state.update_data(key=key, row_id=int(rid), column=column, kind=f.kind)

    prompts = {
        "photo": "🖼 Rasmni yuboring (yoki rasm URL manzilini yozing).",
        "video": "🎬 Videoni yuboring (yoki video URL manzilini yozing).\n"
        "<i>Telegram orqali maksimal 20 MB. Kattaroq video uchun URL ishlating.</i>",
        "money": "Narxni son ko'rinishida yuboring. Masalan: <code>1900000</code>",
        "int": "Butun son yuboring.",
        "color": "Rangni HEX ko'rinishida yuboring. Masalan: <code>#ff2d3a</code>",
        "long": "Matnni yuboring (bir necha qator bo'lishi mumkin).",
    }
    prompt = prompts.get(f.kind, "Yangi qiymatni yuboring.")
    hint = f"\n\n<i>{f.hint}</i>" if f.hint else ""

    await callback.message.answer(
        f"✏️ <b>{f.label}</b>\n\n{prompt}{hint}\n\n"
        "Tozalash uchun <code>-</code> yuboring.",
        reply_markup=cancel_kb(),
    )
    await callback.answer()


@router.callback_query(F.data.startswith("aec:"))
async def choice_set(callback: CallbackQuery) -> None:
    _, key, rid, column, value = callback.data.split(":", 4)
    entity = ENTITIES.get(key)
    if not entity:
        await callback.answer("Topilmadi", show_alert=True)
        return

    stored = None if value == "" else (int(value) if value.isdigit() else value)
    await q.admin_update(entity.table, int(rid), column, stored)
    await callback.answer("Saqlandi ✅")
    await _show_detail(callback.message, entity, int(rid))


@router.message(EntityEdit.value, F.photo)
async def field_photo(message: Message, state: FSMContext) -> None:
    data = await state.get_data()
    if data.get("kind") != "photo":
        await message.answer("Bu maydon uchun rasm kutilmayapti.")
        return
    await _save_media(message, state, "photo", message.photo[-1].file_id)


@router.message(EntityEdit.value, F.video)
async def field_video(message: Message, state: FSMContext) -> None:
    data = await state.get_data()
    if data.get("kind") != "video":
        await message.answer("Bu maydon uchun video kutilmayapti.")
        return
    await _save_media(message, state, "video", message.video.file_id)


@router.message(EntityEdit.value, F.animation)
async def field_animation(message: Message, state: FSMContext) -> None:
    """GIF ham video sifatida qabul qilinadi."""
    data = await state.get_data()
    if data.get("kind") != "video":
        return
    await _save_media(message, state, "video", message.animation.file_id)


async def _save_media(message: Message, state: FSMContext, kind: str, file_id: str) -> None:
    data = await state.get_data()
    entity = ENTITIES[data["key"]]
    row_id = data["row_id"]

    await q.admin_update(entity.table, row_id, f"{kind}_id", file_id)
    await q.admin_update(entity.table, row_id, f"{kind}_url", None)
    await state.clear()

    await message.answer(
        f"✅ {'Rasm' if kind == 'photo' else 'Video'} saqlandi.",
        reply_markup=main_menu(message.from_user.id),
    )
    row = await q.admin_get(entity.table, row_id)
    await message.answer(await _detail_text(entity, row), reply_markup=_detail_kb(entity, row))


@router.message(EntityEdit.value, F.text)
async def field_text(message: Message, state: FSMContext) -> None:
    raw = message.text.strip()
    if raw == BTN_CANCEL:
        await state.clear()
        await message.answer("❌ Bekor qilindi.", reply_markup=main_menu(message.from_user.id))
        return

    data = await state.get_data()
    entity = ENTITIES[data["key"]]
    row_id, column, kind = data["row_id"], data["column"], data["kind"]

    value, error = parse_value(kind, raw)
    if error:
        await message.answer(f"⚠️ {error}")
        return

    if kind in ("photo", "video"):
        # URL kelsa *_url ga, tozalash bo'lsa ikkisiga ham yoziladi
        if value is None:
            await q.admin_update(entity.table, row_id, f"{kind}_id", None)
            await q.admin_update(entity.table, row_id, f"{kind}_url", None)
        else:
            await q.admin_update(entity.table, row_id, f"{kind}_url", value)
            await q.admin_update(entity.table, row_id, f"{kind}_id", None)
    else:
        await q.admin_update(entity.table, row_id, column, value)

    await state.clear()
    await message.answer("✅ Saqlandi.", reply_markup=main_menu(message.from_user.id))
    row = await q.admin_get(entity.table, row_id)
    await message.answer(await _detail_text(entity, row), reply_markup=_detail_kb(entity, row))


# ------------------------------------------------------------------ media


@router.callback_query(F.data.startswith("aev:"))
async def media_view(callback: CallbackQuery) -> None:
    _, key, rid, kind = callback.data.split(":")
    entity = ENTITIES.get(key)
    row = await q.admin_get(entity.table, int(rid)) if entity else None
    if not row:
        await callback.answer("Topilmadi", show_alert=True)
        return

    file_id, url = q.media_of(row, kind)
    try:
        if file_id and kind == "photo":
            await callback.message.answer_photo(file_id, caption=entity.label(row))
        elif file_id:
            await callback.message.answer_video(file_id, caption=entity.label(row))
        elif url:
            await callback.message.answer(f"🔗 {url}")
        else:
            await callback.answer("Media yo'q", show_alert=True)
            return
    except Exception as error:
        logger.warning("Media ko'rsatilmadi: %s", error)
        await callback.answer("Media ochilmadi", show_alert=True)
        return
    await callback.answer()


@router.callback_query(F.data.startswith("aem:"))
async def media_clear(callback: CallbackQuery) -> None:
    _, key, rid, kind = callback.data.split(":")
    entity = ENTITIES.get(key)
    if not entity:
        await callback.answer("Topilmadi", show_alert=True)
        return
    await q.admin_update(entity.table, int(rid), f"{kind}_id", None)
    await q.admin_update(entity.table, int(rid), f"{kind}_url", None)
    await callback.answer("O'chirildi")
    await _show_detail(callback.message, entity, int(rid))


# ------------------------------------------------------------- holat / o'chirish


@router.callback_query(F.data.startswith("aet:"))
async def entity_toggle(callback: CallbackQuery) -> None:
    _, key, rid = callback.data.split(":")
    entity = ENTITIES.get(key)
    if not entity:
        await callback.answer("Topilmadi", show_alert=True)
        return
    value = await q.admin_toggle(entity.table, int(rid))
    await callback.answer("🟢 Yoqildi" if value else "🔴 O'chirildi")
    await _show_detail(callback.message, entity, int(rid))


@router.callback_query(F.data.startswith("aex:"))
async def entity_delete_ask(callback: CallbackQuery) -> None:
    _, key, rid = callback.data.split(":")
    entity = ENTITIES.get(key)
    row = await q.admin_get(entity.table, int(rid)) if entity else None
    if not row:
        await callback.answer("Topilmadi", show_alert=True)
        return

    kb = InlineKeyboardBuilder()
    kb.button(text="🗑 Ha, o'chirilsin", callback_data=f"aey:{key}:{rid}")
    kb.button(text="⬅️ Yo'q, qaytish", callback_data=f"aed:{key}:{rid}")
    kb.adjust(1)
    await edit_or_send(
        callback.message,
        f"⚠️ <b>{entity.label(row)}</b> butunlay o'chiriladi.\n\n"
        "Buyurtmalar tarixi saqlanib qoladi, lekin element ro'yxatlardan yo'qoladi.\n"
        "Vaqtincha yashirish uchun «O'chirish (yashirish)» dan foydalanish yaxshiroq.",
        kb.as_markup(),
    )
    await callback.answer()


@router.callback_query(F.data.startswith("aey:"))
async def entity_delete(callback: CallbackQuery) -> None:
    _, key, rid = callback.data.split(":")
    entity = ENTITIES.get(key)
    if not entity:
        await callback.answer("Topilmadi", show_alert=True)
        return
    try:
        await q.admin_delete(entity.table, int(rid))
    except Exception as error:
        logger.warning("O'chirishda xato: %s", error)
        await callback.answer("O'chirilmadi — element boshqa joyda ishlatilyapti", show_alert=True)
        return

    await callback.answer("O'chirildi")
    rows = await q.admin_list(entity.table)
    await edit_or_send(
        callback.message,
        f"{entity.icon} <b>{entity.title}</b>\n\nJami: <b>{len(rows)}</b> ta.",
        _list_kb(entity, rows),
    )


# ------------------------------------------------------------ yangi qo'shish


@router.callback_query(F.data.startswith("aen:"))
async def entity_new(callback: CallbackQuery, state: FSMContext) -> None:
    entity = ENTITIES.get(callback.data.split(":")[1])
    if not entity:
        await callback.answer("Topilmadi", show_alert=True)
        return

    await state.set_state(EntityNew.value)
    await state.update_data(key=entity.key, left=list(entity.create), values={})
    await callback.answer()
    await _ask_next(callback.message, state)


async def _ask_next(message: Message, state: FSMContext) -> None:
    data = await state.get_data()
    entity = ENTITIES[data["key"]]
    left = data["left"]

    if not left:
        await _create_entity(message, state)
        return

    f = next(x for x in entity.fields if x.column == left[0])
    total = len(entity.create)
    step = total - len(left) + 1

    if f.kind == "choice":
        choices = await f.choices()
        await message.answer(
            f"➕ <b>{entity.title}</b> — {step}/{total}\n\n<b>{f.label}</b> ni tanlang:",
            reply_markup=_choice_kb(entity, 0, f.column, choices, new_mode=True),
        )
        return

    hint = f"\n<i>{f.hint}</i>" if f.hint else ""
    skip = "" if f.required else "\n\nO'tkazib yuborish uchun <code>-</code> yuboring."
    await message.answer(
        f"➕ <b>{entity.title}</b> — {step}/{total}\n\n<b>{f.label}</b> ni yuboring:{hint}{skip}",
        reply_markup=cancel_kb(),
    )


@router.callback_query(F.data.startswith("aecn:"))
async def new_choice(callback: CallbackQuery, state: FSMContext) -> None:
    _, key, column, value = callback.data.split(":", 3)
    data = await state.get_data()
    if data.get("key") != key:
        await callback.answer("Bu forma yopilgan — qaytadan boshlang", show_alert=True)
        return

    values = data["values"]
    values[column] = None if value == "" else (int(value) if value.isdigit() else value)
    left = [c for c in data["left"] if c != column]
    await state.update_data(values=values, left=left)
    await callback.answer("Tanlandi")
    await _ask_next(callback.message, state)


@router.message(EntityNew.value, F.text)
async def new_value(message: Message, state: FSMContext) -> None:
    raw = message.text.strip()
    if raw == BTN_CANCEL:
        await state.clear()
        await message.answer("❌ Bekor qilindi.", reply_markup=main_menu(message.from_user.id))
        return

    data = await state.get_data()
    entity = ENTITIES[data["key"]]
    column = data["left"][0]
    f = next(x for x in entity.fields if x.column == column)

    if raw == "-" and f.required:
        await message.answer("⚠️ Bu maydon majburiy — qiymat yuboring.")
        return

    value, error = parse_value(f.kind, raw)
    if error:
        await message.answer(f"⚠️ {error}")
        return

    values = data["values"]
    values[column] = value
    await state.update_data(values=values, left=data["left"][1:])
    await _ask_next(message, state)


async def _create_entity(message: Message, state: FSMContext) -> None:
    data = await state.get_data()
    entity = ENTITIES[data["key"]]
    values = {k: v for k, v in data["values"].items() if v is not None}
    # sort va cars.slug — Mini App admin paneli bilan umumiy mantiq
    values = await prepare_insert(entity, values)

    try:
        row_id = await q.admin_insert(entity.table, values)
    except Exception as error:
        logger.warning("Qo'shishda xato: %s", error)
        await state.clear()
        await message.answer(
            f"⚠️ Qo'shilmadi: {error}", reply_markup=main_menu(message.from_user.id)
        )
        return

    await state.clear()
    await message.answer(
        f"✅ <b>{entity.title}</b> ro'yxatiga qo'shildi (#{row_id}).\n"
        "Endi rasm/video va boshqa maydonlarni to'ldirishingiz mumkin.",
        reply_markup=main_menu(message.from_user.id),
    )
    row = await q.admin_get(entity.table, row_id)
    await message.answer(await _detail_text(entity, row), reply_markup=_detail_kb(entity, row))
