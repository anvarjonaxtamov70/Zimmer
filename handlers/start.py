"""/start, ro'yxatdan o'tish va asosiy menyu."""

from aiogram import F, Router
from aiogram.filters import Command, CommandStart
from aiogram.fsm.context import FSMContext
from aiogram.types import Message

from config import config, is_admin
from database import queries as q
from keyboards.inline import open_app_kb
from keyboards.reply import cancel_kb, main_menu, phone_kb
from services import sync
from states import Register
from utils.helpers import normalize_phone
from utils.texts import APP_INTRO, BTN_CANCEL, BTN_CONTACT, CONTACT_TEXT, greeting

router = Router(name="start")


@router.message(CommandStart())
async def cmd_start(message: Message, state: FSMContext) -> None:
    await state.clear()
    user = await q.get_user(message.from_user.id)
    if user and user["phone"]:
        await message.answer(
            greeting(user["full_name"]), reply_markup=main_menu(message.from_user.id)
        )
        await _send_app_button(message)
        return

    await message.answer(
        "Assalomu alaykum! 👋\n\n"
        "Ro'yxatdan o'tish uchun <b>ism va familiyangizni</b> yuboring.\n"
        "Masalan: <i>Anvarjon Axtamov</i>",
        reply_markup=cancel_kb(),
    )
    await state.set_state(Register.full_name)


@router.message(Register.full_name, F.text)
async def reg_full_name(message: Message, state: FSMContext) -> None:
    name = message.text.strip()
    if name == BTN_CANCEL:
        await state.clear()
        await message.answer("Bekor qilindi.", reply_markup=main_menu(message.from_user.id))
        return
    if len(name) < 3 or len(name) > 64:
        await message.answer("Ism juda qisqa yoki uzun. Iltimos, qaytadan yuboring.")
        return

    await state.update_data(full_name=name)
    await message.answer(
        f"Rahmat, <b>{name}</b>! 👌\n\n"
        "Endi telefon raqamingizni yuboring — pastdagi tugmani bosing "
        "yoki qo'lda yozing (masalan: <i>+998901234567</i>).",
        reply_markup=phone_kb(),
    )
    await state.set_state(Register.phone)


@router.message(Register.phone, F.contact)
async def reg_phone_contact(message: Message, state: FSMContext) -> None:
    await _finish_registration(message, state, message.contact.phone_number)


@router.message(Register.phone, F.text)
async def reg_phone_text(message: Message, state: FSMContext) -> None:
    phone = normalize_phone(message.text)
    if not phone:
        await message.answer(
            "Raqam noto'g'ri ko'rinishda. Masalan: <b>+998901234567</b>\n"
            "Yoki tugma orqali yuboring.",
            reply_markup=phone_kb(),
        )
        return
    await _finish_registration(message, state, phone)


async def _finish_registration(message: Message, state: FSMContext, raw_phone: str) -> None:
    data = await state.get_data()
    full_name = data.get("full_name") or message.from_user.full_name
    phone = normalize_phone(raw_phone) or raw_phone
    await q.add_user(message.from_user.id, full_name, phone, message.from_user.username)

    # Firebase'ga yozamiz — qayta deploydan keyin ham saqlanib qoladi
    full = await q.get_user_with_car(message.from_user.id)
    await sync.push_user(
        message.from_user.id,
        {
            "full_name": full_name,
            "phone": phone,
            "username": message.from_user.username,
            "car_id": full["car_id"] if full else None,
            "car_name": full["car_name"] if full else None,
        },
    )
    await state.clear()
    await message.answer(
        f"✅ Ro'yxatdan o'tdingiz!\n📞 Raqam: <b>{phone}</b>",
        reply_markup=main_menu(message.from_user.id),
    )
    await message.answer(greeting(full_name))
    await _send_app_button(message)


async def _send_app_button(message: Message) -> None:
    """Mini App'ni ochish taklifi. Ilova sozlanmagan bo'lsa — buyruqlarni eslatadi."""
    if config.has_mini_app:
        await message.answer(
            APP_INTRO.format(shop=config.shop_name), reply_markup=open_app_kb()
        )
        return
    await message.answer(
        "⚠️ Ilova manzili sozlanmagan (<code>MINI_APP_URL</code>).\n"
        "Shu vaqtda /navbat va /dokon buyruqlaridan foydalanishingiz mumkin."
    )


@router.message(Command("app"))
async def cmd_app(message: Message, state: FSMContext) -> None:
    await state.clear()
    user = await q.get_user(message.from_user.id)
    if not user or not user["phone"]:
        await message.answer("Avval ro'yxatdan o'tishingiz kerak. /start yuboring.")
        return
    await _send_app_button(message)


@router.message(Command("menu"))
async def cmd_menu(message: Message, state: FSMContext) -> None:
    await state.clear()
    await message.answer("🏠 Asosiy menyu", reply_markup=main_menu(message.from_user.id))


@router.message(Command("id"))
async def cmd_id(message: Message) -> None:
    user_id = message.from_user.id
    if is_admin(user_id):
        await message.answer(
            f"🆔 Sizning Telegram ID: <code>{user_id}</code>\n\n"
            "👑 Siz <b>adminsiz</b>. Panelni ochish: /admin\n"
            "Katalogni boshqarish: /katalog",
            reply_markup=main_menu(user_id),
        )
        return

    await message.answer(
        f"🆔 Sizning Telegram ID: <code>{user_id}</code>\n\n"
        "Siz hozircha admin emassiz. Admin bo'lish uchun shu ID'ni "
        "Render panelidagi <code>ADMINS</code> (yoki <code>ADMINS_EXTRA</code>) "
        "o'zgaruvchisiga qo'shish kerak."
    )


@router.message(Command("admin"), ~F.from_user.id.in_(config.admins))
async def cmd_admin_denied(message: Message) -> None:
    """Admin bo'lmaganlar uchun tushunarli javob (jim turmaslik uchun)."""
    await message.answer(
        "🔒 Admin panel faqat adminlar uchun.\n\n"
        f"Sizning ID: <code>{message.from_user.id}</code>\n"
        "Agar bu siz bo'lsangiz, ID'ni Render panelidagi "
        "<code>ADMINS</code> ro'yxatiga qo'shing va xizmatni qayta ishga tushiring."
    )


@router.message(F.text == BTN_CANCEL)
async def cancel_any(message: Message, state: FSMContext) -> None:
    await state.clear()
    await message.answer("❌ Bekor qilindi.", reply_markup=main_menu(message.from_user.id))


@router.message(F.text == BTN_CONTACT)
async def contact_info(message: Message, state: FSMContext) -> None:
    await state.clear()
    await message.answer(CONTACT_TEXT, reply_markup=main_menu(message.from_user.id))
