"""Admin mahsulot boshqaruvi — Firebase + multi-image upload.

Bu handler mahsulotlarni Firebase'da boshqaradi:
- Yangi mahsulot qo'shish (dialog orqali)
- Mahsulotga ko'p rasmlar yuklash (Telegram MediaGroup)
- Mahsulot tahrirlash
- O'chirish/faollashtirish
- Product Card display (Avto_A1 style)
"""

import asyncio
import logging

from aiogram import Bot, F, Router
from aiogram.filters import Command
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup
from aiogram.types import CallbackQuery, Message

from config import is_admin
from database import queries as q
from handlers.admin_schema import ENTITIES, prepare_insert
from services import firebase_products as fb_prod
from services import firebase_storage as fb_storage
from services import sync
from utils import product_card

# SQLite'da faqat 3 ustun juftligi bor: photo/photo2/photo3
# (`database/db.py`). Undan ortig'i saqlanmaydi, shuning uchun admin'ni
# jimgina emas, OCHIQ ogohlantiramiz.
MAX_PRODUCT_IMAGES = 3

logger = logging.getLogger(__name__)
router = Router()


class AddProductStates(StatesGroup):
    """Yangi mahsulot qo'shish dialog holatlari."""
    name = State()
    price = State()
    stock = State()
    description = State()
    images = State()
    confirm = State()


class EditProductStates(StatesGroup):
    """Mahsulot tahrirlash holatlari."""
    select_field = State()
    edit_value = State()


# Vaqtinchalik saqlash uchun (FSM data'ga sig'maydiganlari)
_temp_product_data = {}


# ============================================================================
# CALLBACK HANDLERS: Admin Menu Tugmalari
# ============================================================================

@router.callback_query(F.data == "adm:add_product")
async def callback_add_product(callback: CallbackQuery, state: FSMContext):
    """Admin menu'dan 'Mahsulot qo'shish' tugmasi bosilganda."""
    await callback.answer()
    await state.set_state(AddProductStates.name)
    await callback.message.answer(
        "📦 <b>Yangi mahsulot qo'shish</b>\n\n"
        "Mahsulot nomini yuboring:"
    )


@router.callback_query(F.data == "adm:products_list")
async def callback_products_list(callback: CallbackQuery):
    """Admin menu'dan 'Mahsulotlar' tugmasi bosilganda.

    DIQQAT: ilgari bu yerda `show_products_list(...)` chaqirilardi — bunday
    funksiya loyihada HECH QACHON mavjud bo'lmagan. Natijada tugma bosilganda
    `NameError: name 'show_products_list' is not defined` chiqib, admin panelda
    «Mahsulotlar» tugmasi umuman ishlamasdi (PR #52 dagi nosozlik).
    """
    await callback.answer()
    await list_products(callback.message)


@router.callback_query(F.data == "adm:products_drafts")
async def callback_products_drafts(callback: CallbackQuery):
    """Admin menu'dan 'Qoralamalar' tugmasi bosilganda."""
    await callback.answer()
    products = await fb_prod.get_all_products(is_draft=True)
    if not products:
        await callback.message.answer("📋 Qoralama mahsulotlar yo'q.")
        return

    text = f"📋 <b>Qoralama mahsulotlar ({len(products)} ta)</b>\n\n"
    for p in products[:10]:
        text += f"• ID {p['id']}: {p['name']}\n"

    await callback.message.answer(text)


@router.callback_query(F.data == "adm:import_products")
async def callback_import_products(callback: CallbackQuery):
    """Admin menu'dan 'Import' tugmasi bosilganda."""
    await callback.answer()
    await callback.message.answer(
        "📥 <b>Excel/CSV Import</b>\n\n"
        "Excel (.xlsx) yoki CSV faylni yuboring.\n"
        "Fayl quyidagi ustunlarni o'z ichiga olishi kerak:\n"
        "- name/nomi (majburiy)\n"
        "- price/narx (majburiy)\n"
        "- stock/ombor (ixtiyoriy)\n"
        "- description/tavsif (ixtiyoriy)\n"
        "- code/kod (ixtiyoriy)\n"
        "- brand/brend (ixtiyoriy)"
    )


# ============================================================================
# COMMAND HANDLERS
# ============================================================================

@router.message(Command("add_product"), F.from_user.id.func(is_admin))
async def start_add_product(message: Message, state: FSMContext):
    """Yangi mahsulot qo'shish dialogini boshlaydi."""
    await state.set_state(AddProductStates.name)
    await message.answer(
        "📦 <b>Yangi mahsulot qo'shish</b>\n\n"
        "1️⃣ Mahsulot nomini yuboring:\n\n"
        "<i>Bekor qilish uchun /cancel</i>",
        parse_mode="HTML"
    )


@router.message(AddProductStates.name, F.from_user.id.func(is_admin))
async def process_product_name(message: Message, state: FSMContext):
    """Mahsulot nomini qabul qiladi."""
    name = message.text.strip()

    if len(name) < 2:
        await message.answer("❌ Nom juda qisqa. Qayta kiriting:")
        return

    await state.update_data(name=name)
    await state.set_state(AddProductStates.price)

    await message.answer(
        f"✅ Nom: <b>{name}</b>\n\n"
        f"2️⃣ Narxni yuboring (so'mda, faqat son):\n\n"
        f"<i>Masalan: 150000</i>",
        parse_mode="HTML"
    )


@router.message(AddProductStates.price, F.from_user.id.func(is_admin))
async def process_product_price(message: Message, state: FSMContext):
    """Mahsulot narxini qabul qiladi."""
    try:
        price = int(message.text.strip().replace(" ", "").replace(",", ""))
        if price <= 0:
            raise ValueError()
    except ValueError:
        await message.answer("❌ Noto'g'ri narx. Faqat musbat son kiriting:")
        return

    await state.update_data(price=price)
    await state.set_state(AddProductStates.stock)

    await message.answer(
        f"✅ Narx: <b>{price:,} so'm</b>\n\n"
        f"3️⃣ Ombordagi miqdorni yuboring:\n\n"
        f"<i>O'tkazib yuborish uchun 0 yuboring yoki /skip</i>",
        parse_mode="HTML"
    )


@router.message(AddProductStates.stock, F.from_user.id.func(is_admin))
async def process_product_stock(message: Message, state: FSMContext):
    """Mahsulot ombor miqdorini qabul qiladi."""
    text = message.text.strip()

    if text == "/skip":
        stock = 0
    else:
        try:
            stock = int(text.replace(" ", "").replace(",", ""))
            if stock < 0:
                raise ValueError()
        except ValueError:
            await message.answer("❌ Noto'g'ri son. Qayta kiriting yoki /skip:")
            return

    await state.update_data(stock=stock)
    await state.set_state(AddProductStates.description)

    await message.answer(
        f"✅ Ombor: <b>{stock} dona</b>\n\n"
        f"4️⃣ Mahsulot tavsifini yuboring:\n\n"
        f"<i>O'tkazib yuborish uchun /skip</i>",
        parse_mode="HTML"
    )


@router.message(AddProductStates.description, F.from_user.id.func(is_admin))
async def process_product_description(message: Message, state: FSMContext):
    """Mahsulot tavsifini qabul qiladi."""
    text = message.text.strip()

    description = None if text == "/skip" else text[:500]

    await state.update_data(description=description)
    await state.set_state(AddProductStates.images)

    user_id = message.from_user.id
    # `media_group_id` SHU YERDA ham qo'yilishi SHART. Ilgari faqat
    # {"images": []} yozilardi va `process_product_images` o'sha kalitni
    # o'qiganda KeyError berardi — natijada telefondan bir necha rasmni
    # BIRGA (albom) yuborish umuman ishlamasdi va admin javob ham olmasdi.
    _temp_product_data[user_id] = {"images": [], "media_group_id": None}

    await message.answer(
        "✅ Tavsif saqlandi\n\n"
        "5️⃣ Mahsulot rasmlarini yuboring:\n\n"
        "• Bitta rasm yoki MediaGroup (bir necha rasm birga)\n"
        "• Bir necha marta yuborishingiz mumkin\n"
        "• Tugagach /done bosing\n\n"
        "<i>Rasmlar kerak bo'lmasa /skip</i>",
        parse_mode="HTML"
    )


@router.message(AddProductStates.images, F.photo, F.from_user.id.func(is_admin))
async def process_product_images(message: Message, state: FSMContext, bot: Bot):
    """Mahsulot rasmlarini qabul qiladi (MediaGroup qo'llab-quvvatlaydi).

    Avto_A1 style: rasmlar Telegram file_id sifatida saqlanadi.
    Agar Firebase Storage sozlangan bo'lsa, Firebase'ga yuklanadi va
    doimiy URL qaytariladi.
    """
    user_id = message.from_user.id

    # `setdefault` — kalit yo'q bo'lsa ham yiqilmaydi. Ilgari bu yerda
    # `_temp_product_data[user_id]["media_group_id"]` to'g'ridan o'qilardi va
    # albom yuborilganda KeyError bilan yiqilardi.
    store = _temp_product_data.setdefault(
        user_id, {"images": [], "media_group_id": None}
    )
    store.setdefault("images", [])
    store.setdefault("media_group_id", None)

    # Eng katta o'lchamdagi rasmni olish
    file_id = message.photo[-1].file_id
    media_group_id = message.media_group_id

    # Albom (bir necha rasm birga): Telegram ularni ALOHIDA update sifatida
    # yuboradi. Birinchisiga javob beramiz, qolganlarini jimgina qo'shamiz —
    # aks holda 5 rasmga 5 marta javob ketardi.
    first_of_group = True
    if media_group_id:
        first_of_group = store["media_group_id"] != media_group_id
        store["media_group_id"] = media_group_id

    if len(store["images"]) >= MAX_PRODUCT_IMAGES:
        # 3 dan ortig'i jimgina tashlanardi — endi admin buni BILADI.
        if first_of_group:
            await message.answer(
                f"⚠️ Maksimum {MAX_PRODUCT_IMAGES} ta rasm.\n\n"
                f"Qo'shilganlari saqlanadi. Davom etish uchun /done bosing.",
                parse_mode="HTML",
            )
        return

    store["images"].append(file_id)

    if not first_of_group:
        # Albomning qolgan rasmlari — javob bermaymiz
        return

    if media_group_id:
        # Albom to'liq kelishini kutamiz, keyin haqiqiy sonni aytamiz
        await asyncio.sleep(1.2)

    count = len(store["images"])
    left = MAX_PRODUCT_IMAGES - count
    await message.answer(
        f"✅ Rasm qabul qilindi — jami <b>{count} ta</b>\n\n"
        + (
            f"Yana {left} ta qo'shish mumkin yoki /done bosing."
            if left > 0
            else "Chegara to'ldi. /done bosing."
        ),
        parse_mode="HTML",
    )


@router.message(AddProductStates.images, Command("done"), F.from_user.id.func(is_admin))
@router.message(AddProductStates.images, Command("skip"), F.from_user.id.func(is_admin))
async def finish_product_images(message: Message, state: FSMContext):
    """Rasm yuklashni tugatadi va tasdiqni so'raydi."""
    user_id = message.from_user.id
    images = _temp_product_data.get(user_id, {}).get("images", [])

    data = await state.get_data()
    await state.set_state(AddProductStates.confirm)

    # Xulosa
    text = (
        "📦 <b>Mahsulot ma'lumotlari</b>\n\n"
        f"Nomi: <b>{data['name']}</b>\n"
        f"Narx: <b>{data['price']:,} so'm</b>\n"
        f"Ombor: <b>{data.get('stock', 0)} dona</b>\n"
    )

    if data.get('description'):
        desc = data['description'][:100]
        if len(data['description']) > 100:
            desc += "..."
        text += f"Tavsif: <i>{desc}</i>\n"

    text += f"Rasmlar: <b>{len(images)} ta</b>\n\n"
    text += "Tasdiqlaysizmi?\n\n"
    text += "/confirm — Tasdiqlash va saqlash\n"
    text += "/cancel — Bekor qilish"

    await message.answer(text, parse_mode="HTML")


@router.message(AddProductStates.confirm, Command("confirm"), F.from_user.id.func(is_admin))
async def confirm_add_product(message: Message, state: FSMContext, bot: Bot):
    """Mahsulotni tasdiqlaydi va saqlaydi.

    MUHIM (PR #48–#58 dagi asosiy nosozlik shu yerda edi):

    Ilgari bu handler mahsulotni FAQAT Firebase'ning `zimmer/products` tuguniga
    yozardi. Lekin ilovaning katalogi (`/api/home`, `/api/catalog`), botning
    «Do'kon» bo'limi (`handlers/shop.py`) va buyurtma yaratish
    (`create_order_from_items` → `get_product(product_id)`) — HAMMASI SQLite
    `products` jadvalidan o'qiydi. Natijada bot orqali qo'shilgan mahsulot
    hech qayerda ko'rinmasdi va uni buyurtma qilish ham mumkin emasdi.

    Endi tartib to'g'ri:
      1) SQLite `products` — ASOSIY manba (ilova, do'kon, buyurtma shu yerdan);
      2) `sync.push_catalog` — Firebase'ga zaxira nusxa (qayta deployda tiklanadi);
      3) `fb_prod` — Excel import qoralamalari uchun qo'shimcha qatlam.
    """
    user_id = message.from_user.id
    data = await state.get_data()
    images = _temp_product_data.get(user_id, {}).get("images", [])

    try:
        # ---- 1. SQLite'ga yozish (ASOSIY manba)
        #
        # TARTIB ATAYLAB O'ZGARTIRILDI. Ilgari rasmlar AVVAL Storage'ga
        # yuklanardi va `upload_telegram_photo(bot, file_id, 0, i)` ga
        # mahsulot id si o'rniga **0** uzatilardi. Yo'l esa
        # `products/{product_id}/image_{index}.jpg` — ya'ni BARCHA
        # mahsulotlarning rasmi `products/0/image_0.jpg` ga yozilardi va
        # har yangi tovar oldingi tovarning rasmini USTIDAN yozardi.
        # `delete_product_images(product_id)` ham hech qachon to'g'ri
        # papkani topmasdi.
        #
        # Endi avval qator yaratiladi (rasm sifatida Telegram `file_id`
        # bilan — ya'ni tovar HAR DOIM rasmli bo'ladi), so'ng haqiqiy
        # `product_id` bilan Storage'ga ko'chiriladi va `photo*_url`
        # yangilanadi. Storage yiqilsa `file_id` joyida qoladi.
        values: dict = {
            "name": str(data["name"])[:160],
            "price": int(data["price"]),
            "stock": int(data.get("stock") or 0),
            "unit": "dona",
            "product_type": "oddiy",
            "is_active": 1,
        }
        if data.get("description"):
            values["description"] = str(data["description"])[:2000]

        # Rasmlar: hozircha Telegram `file_id`. `/api/media/products/{id}/photo`
        # proksisi ularni to'g'ri ko'rsatadi, ya'ni tovar darhol rasmli.
        columns = (
            ("photo_url", "photo_id"),
            ("photo2_url", "photo2_id"),
            ("photo3_url", "photo3_id"),
        )
        for i, (_url_col, id_col) in enumerate(columns):
            if i < len(images):
                values[id_col] = images[i]

        values = await prepare_insert(ENTITIES["prd"], values)  # category_id + sort
        product_id = await q.admin_insert("products", values)

        # ---- 2. Rasmlarni Storage'ga ko'chirish — HAQIQIY product_id bilan.
        # Doimiy URL olingach `photo*_url` yangilanadi. Bu ixtiyoriy qadam:
        # yiqilsa tovar `file_id` bilan ishlashda davom etadi.
        uploaded_urls: list[str] = []
        if images and fb_storage.is_storage_enabled():
            progress_msg = await message.answer("📤 Rasmlar yuklanmoqda...")
            for i, file_id in enumerate(images):
                try:
                    image_url = await fb_storage.upload_telegram_photo(
                        bot, file_id, product_id, i
                    )
                except Exception:
                    logger.warning(
                        "Rasm #%s Storage'ga ko'chirilmadi (tovar #%s)",
                        i,
                        product_id,
                        exc_info=True,
                    )
                    image_url = None

                # Storage ishlamasa funksiya `file_id` ni qaytaradi — uni URL
                # deb hisoblamaymiz, `photo*_id` allaqachon yozilgan.
                if image_url and str(image_url).startswith("http"):
                    uploaded_urls.append(image_url)
                    url_col = columns[i][0]
                    await q.admin_update("products", product_id, url_col, image_url[:500])

            try:
                await progress_msg.delete()
            except Exception:  # xabar allaqachon o'chirilgan bo'lishi mumkin
                logger.debug("Progress xabari o'chirilmadi", exc_info=True)

        # ---- 3. Firebase'ga zaxira (rasm URL'lari yozilgandan KEYIN)
        await sync.push_catalog("products", product_id)

        # ---- 4. Qo'shimcha: Firebase products tuguniga ham yozamiz (multi-image)
        try:
            await fb_prod.add_product(
                name=values["name"],
                price=values["price"],
                stock=values["stock"],
                desc=data.get("description"),
                images=uploaded_urls or images,
                is_draft=False,
            )
        except Exception:
            logger.warning("Firebase products tuguniga yozilmadi", exc_info=True)

        # ---- 5. Adminga kartochka ko'rsatish
        row = await q.admin_get("products", product_id)
        if row is not None:
            try:
                await product_card.send_product_card(
                    bot=bot,
                    chat_id=message.chat.id,
                    product={
                        "id": product_id,
                        "name": row["name"],
                        "price": row["price"],
                        "stock": row["stock"],
                        "desc": row["description"],
                        "images": uploaded_urls or images,
                    },
                    admin_view=True,
                    show_purchase=False,
                )
            except Exception:
                logger.warning("Mahsulot kartochkasi yuborilmadi", exc_info=True)

        photo_note = (
            f"{len(uploaded_urls)} ta (doimiy URL)"
            if uploaded_urls
            else (f"{len(images)} ta (Telegram)" if images else "yo'q")
        )
        await message.answer(
            f"✅ <b>Mahsulot qo'shildi!</b>\n\n"
            f"ID: <code>{product_id}</code>\n"
            f"Nom: {values['name']}\n"
            f"Narx: {values['price']:,} so'm\n"
            f"Ombor: {values['stock']} dona\n"
            f"Rasmlar: {photo_note}\n\n"
            f"Mahsulot endi <b>botning «Do'kon»</b> bo'limida ham, "
            f"<b>Mini App katalogida</b> ham ko'rinadi va buyurtma qilinadi.",
            parse_mode="HTML",
        )

    except Exception as e:
        logger.error("Mahsulot qo'shilmadi: %s", e, exc_info=True)
        await message.answer(
            f"❌ Xato yuz berdi:\n\n<code>{e}</code>",
            parse_mode="HTML"
        )

    finally:
        await state.clear()
        if user_id in _temp_product_data:
            del _temp_product_data[user_id]


@router.message(Command("cancel"))
async def cancel_handler(message: Message, state: FSMContext):
    """Har qanday dialogni bekor qiladi."""
    current_state = await state.get_state()
    if current_state is None:
        return

    user_id = message.from_user.id
    if user_id in _temp_product_data:
        del _temp_product_data[user_id]

    await state.clear()
    await message.answer(
        "❌ Bekor qilindi.",
        parse_mode="HTML"
    )


async def _sqlite_products() -> list[dict]:
    """SQLite `products` jadvalidan mahsulotlar (ASOSIY manba).

    Ilgari bu ro'yxat Firebase'dan o'qilardi, shuning uchun ilovada ko'rinadigan
    mahsulotlar bilan botdagi ro'yxat MOS KELMASDI. Endi ikkisi bir manbadan.
    """
    rows = await q.admin_list("products", limit=500)
    return [
        {
            "id": row["id"],
            "name": row["name"],
            "price": int(row["price"] or 0),
            "stock": int(row["stock"] or 0),
            "is_active": bool(row["is_active"]),
        }
        for row in rows
    ]


@router.message(Command("products_list"), F.from_user.id.func(is_admin))
async def list_products(message: Message):
    """Barcha mahsulotlar ro'yxatini ko'rsatadi."""
    products = await _sqlite_products()

    if not products:
        await message.answer(
            "📦 <b>Mahsulotlar yo'q</b>\n\n"
            "Mahsulot qo'shish uchun:\n"
            "• /add_product - dialog orqali\n"
            "• Excel/CSV fayl yuborish",
            parse_mode="HTML"
        )
        return

    # Faol va nofaol bo'lib guruhlash
    active = [p for p in products if p.get("is_active", True)]
    inactive = [p for p in products if not p.get("is_active", True)]

    text = "📦 <b>Mahsulotlar</b>\n\n"
    text += f"Jami: {len(products)} ta\n"
    text += f"✅ Faol: {len(active)} ta\n"
    text += f"⏸ Nofaol: {len(inactive)} ta\n\n"

    # Oxirgi 10 ta mahsulot
    text += "<b>Oxirgi mahsulotlar:</b>\n"
    for prod in products[:10]:
        status = "✅" if prod.get("is_active", True) else "⏸"
        stock = prod.get("stock", 0)
        stock_text = f"{stock} dona" if stock > 0 else "❌ Tugagan"

        text += (
            f"\n{status} <b>{prod.get('name', 'No name')}</b>\n"
            f"  ID: <code>{prod.get('id')}</code>\n"
            f"  Narx: {prod.get('price', 0):,} so'm\n"
            f"  Ombor: {stock_text}\n"
        )

    if len(products) > 10:
        text += f"\n... va yana {len(products) - 10} ta\n"

    text += (
        "\n<i>Mahsulot boshqarish:</i>\n"
        "<code>/edit_product {id}</code> - tahrirlash\n"
        "<code>/toggle_product {id}</code> - yoqish/o'chirish\n"
        "<code>/delete_product {id}</code> - o'chirish"
    )

    await message.answer(text, parse_mode="HTML")


@router.message(Command("toggle_product"), F.from_user.id.func(is_admin))
async def toggle_product_handler(message: Message):
    """Mahsulotni faollashtirish/o'chirish."""
    args = message.text.split(maxsplit=1)
    if len(args) < 2:
        await message.answer(
            "❌ Mahsulot ID berilmadi.\n\n"
            "Foydalanish: <code>/toggle_product 1001</code>",
            parse_mode="HTML"
        )
        return

    try:
        product_id = int(args[1].strip())
    except ValueError:
        await message.answer("❌ Noto'g'ri ID")
        return

    row = await q.admin_get("products", product_id)
    if row is None:
        await message.answer(f"❌ Mahsulot topilmadi (ID: {product_id})")
        return

    new_state = 0 if row["is_active"] else 1
    await q.admin_update("products", product_id, "is_active", new_state)
    await sync.push_catalog("products", product_id)

    status = "faollashtirildi ✅" if new_state else "o'chirildi ⏸"
    await message.answer(
        f"✅ Mahsulot {status}\n\n<b>{row['name']}</b>",
        parse_mode="HTML",
    )


@router.message(Command("delete_product"), F.from_user.id.func(is_admin))
async def delete_product_handler(message: Message):
    """Mahsulotni o'chiradi."""
    args = message.text.split(maxsplit=1)
    if len(args) < 2:
        await message.answer(
            "❌ Mahsulot ID berilmadi.\n\n"
            "Foydalanish: <code>/delete_product 1001</code>",
            parse_mode="HTML"
        )
        return

    try:
        product_id = int(args[1].strip())
    except ValueError:
        await message.answer("❌ Noto'g'ri ID")
        return

    row = await q.admin_get("products", product_id)
    if row is None:
        await message.answer(f"❌ Mahsulot topilmadi (ID: {product_id})")
        return

    name = row["name"]
    key_value = row[q.CATALOG_KEY["products"]] if "products" in q.CATALOG_KEY else None
    await q.admin_delete("products", product_id)
    await sync.delete_catalog("products", product_id, key_value)
    # Firebase products tugunidagi nusxasini ham olib tashlaymiz (bo'lsa)
    try:
        await fb_prod.delete_product(product_id)
    except Exception:
        logger.debug("Firebase products'dan o'chirilmadi", exc_info=True)

    await message.answer(
        f"🗑 <b>Mahsulot o'chirildi</b>\n\n{name}\nID: {product_id}",
        parse_mode="HTML",
    )


@router.message(Command("update_stock"), F.from_user.id.func(is_admin))
async def update_stock_handler(message: Message, bot: Bot):
    """Mahsulot ombor miqdorini yangilaydi."""
    args = message.text.split()
    if len(args) < 3:
        await message.answer(
            "❌ Noto'g'ri format.\n\n"
            "Foydalanish: <code>/update_stock {id} {miqdor}</code>\n"
            "Masalan: <code>/update_stock 1001 50</code>",
            parse_mode="HTML"
        )
        return

    try:
        product_id = int(args[1])
        quantity = int(args[2])
    except ValueError:
        await message.answer("❌ ID va miqdor raqam bo'lishi kerak")
        return

    if quantity < 0:
        await message.answer("❌ Miqdor manfiy bo'lishi mumkin emas")
        return

    row = await q.admin_get("products", product_id)
    if row is None:
        await message.answer(f"❌ Mahsulot topilmadi (ID: {product_id})")
        return

    await q.admin_update("products", product_id, "stock", quantity)
    await sync.push_catalog("products", product_id)

    try:
        await product_card.send_product_card(
            bot=bot,
            chat_id=message.chat.id,
            product={
                "id": product_id,
                "name": row["name"],
                "price": int(row["price"] or 0),
                "stock": quantity,
                "desc": row["description"],
                "images": [],
            },
            admin_view=True,
            show_purchase=False,
        )
    except Exception:
        logger.debug("Kartochka yuborilmadi", exc_info=True)

    await message.answer(
        f"✅ <b>Ombor yangilandi</b>\n\n"
        f"{row['name']}\n"
        f"Yangi miqdor: <b>{quantity} dona</b>",
        parse_mode="HTML",
    )
