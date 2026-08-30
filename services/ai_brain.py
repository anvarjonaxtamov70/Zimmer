"""AI yordamchining «bilimi» — do'kon haqidagi jonli ma'lumot va ko'rsatma.

NEGA ALOHIDA FAYL. `services/ai.py` — faqat TRANSPORT (Groq bilan
gaplashish). Bu fayl esa MAZMUN: AI nima bilishi, qanday gapirishi va
nimaga yo'naltirishi. Ikkisini ajratish tufayli ko'rsatmani o'zgartirish
uchun tarmoq kodiga tegish kerak emas.

ENG MUHIM QAROR — NARXNI AI O'YLAB TOPMAYDI.
Model o'zidan narx yoki mavjudlik aytsa, mijoz noto'g'ri ma'lumot oladi
va do'kon obro'siga zarar yetadi. Shu sababli katalog HAR SO'ROVDA
bazadan o'qilib ko'rsatmaga qo'shiladi, ko'rsatmada esa «bu ro'yxatda
bo'lmagan narsani aytma» deb qat'iy yozilgan.
"""

from __future__ import annotations

import logging
import time

from config import config, is_admin, is_owner
from database import queries as q
from utils.helpers import fmt_price

logger = logging.getLogger(__name__)

# Katalog keshi: har xabarda bazani qayta o'qish shart emas.
# 120 soniya — admin narxni o'zgartirsa ikki daqiqada AI ham biladi.
_CACHE_TTL = 120
_cache: dict[str, tuple[float, str]] = {}

# Ko'rsatmaga qo'shiladigan tovarlar soni. Butun katalogni yuborish
# token chegarasini yeb qo'yadi; eng arzonidan boshlab bir qismi yetarli
# va AI qolganini «do'konda ko'ring» deb aytadi.
MAX_PRODUCTS = 40


async def _catalog_text() -> str:
    """Xizmatlar va tovarlarni AI o'qiy oladigan ko'rinishda beradi."""
    lines: list[str] = []

    try:
        services = await q.get_services()
    except Exception as error:  # noqa: BLE001
        logger.warning("AI: xizmatlar o'qilmadi: %s", error)
        services = []

    if services:
        lines.append("XIZMATLAR:")
        for svc in services:
            keys = svc.keys()
            soon = bool(svc["coming_soon"]) if "coming_soon" in keys else False
            price = "tez kunda" if soon else fmt_price(svc["price"])
            war = (svc["warranty"] if "warranty" in keys else None) or "—"
            lines.append(f"  - {svc['name']}: {price}, kafolat {war}")

    try:
        catalog = await q.get_catalog()
    except Exception as error:  # noqa: BLE001
        logger.warning("AI: katalog o'qilmadi: %s", error)
        catalog = []

    if catalog:
        lines.append("")
        lines.append("DO'KON TOVARLARI:")
        shown = 0
        for group in catalog:
            products = group.get("products") or []
            if not products:
                continue
            lines.append(f"  [{group.get('name') or 'Boshqa'}]")
            for product in products:
                if shown >= MAX_PRODUCTS:
                    break
                stock = product.get("stock")
                state = "bor" if (stock or 0) > 0 else "tugagan"
                code = product.get("code")
                code_part = f", kod {code}" if code else ""
                lines.append(
                    f"    - {product.get('name')}: "
                    f"{fmt_price(product.get('price') or 0)} ({state}{code_part})"
                )
                shown += 1
            if shown >= MAX_PRODUCTS:
                lines.append("    ... (qolgan tovarlar do'konda)")
                break

    return "\n".join(lines) if lines else "(katalog hozir o'qilmadi)"


async def catalog_snapshot() -> str:
    """Keshlangan katalog matni."""
    now = time.time()
    cached = _cache.get("catalog")
    if cached and now - cached[0] < _CACHE_TTL:
        return cached[1]

    text = await _catalog_text()
    _cache["catalog"] = (now, text)
    return text


def clear_cache() -> None:
    """Keshni tozalaydi (admin katalogni o'zgartirganda foydali)."""
    _cache.clear()


def _address(user_id: int | None, name: str) -> str:
    """AI foydalanuvchiga qanday murojaat qilishi kerak."""
    if is_owner(user_id):
        return (
            "Bu odam — DO'KON EGASI. Unga «xo'jayin» deb murojaat qil "
            "(masalan: «Xo'jayin, ...»). Hurmat bilan, lekin qisqa va "
            "ishga oid gapir."
        )
    if is_admin(user_id):
        return (
            "Bu odam — do'kon ADMINI. Unga «admin» deb murojaat qil. "
            "U mijoz emas, xodim: unga do'kon ishi haqida ham javob "
            "berishing mumkin."
        )
    if name:
        return (
            f"Bu — MIJOZ, ismi: {name}. Unga ismi bilan, «siz» deb "
            "murojaat qil."
        )
    return "Bu — MIJOZ. Unga «siz» deb, iliq murojaat qil."


async def system_prompt(user_id: int | None, name: str = "") -> str:
    """AI uchun to'liq ko'rsatma (har so'rovda yangilanadi)."""
    catalog = await catalog_snapshot()

    contact_lines = []
    if config.shop_phone:
        contact_lines.append(f"telefon {config.shop_phone}")
    if config.pay_admin_username:
        contact_lines.append(f"Telegram @{config.pay_admin_username}")
    contact = ", ".join(contact_lines) or "bot orqali"

    return f"""Sen — «{config.shop_name}» avtochiroq ustaxonasi va do'konining
yordamchisisan. Samarqandda joylashgan. Fara (avtomobil chiroqlari) bilan
ishlaymiz: Bi-LED linza o'rnatish, fara polirovkasi, ichini tozalash,
shishasini almashtirish, rul va o'rindiq chexollari. Do'konda LED lampalar,
DRL lentalar va fara uchun materiallar sotiladi.

{_address(user_id, name)}

TILI. O'zbek tilida, LOTIN yozuvida javob ber. Mijoz rus yoki ingliz
tilida yozsa — o'sha tilda javob ber. Sodda, jonli va qisqa gapir:
maksimal 5-6 qator. Ro'yxat kerak bo'lsa qisqa punktlar bilan.

ASOSIY VAZIFANG — MIJOZNI DO'KONGA (MINI ILOVAGA) OLIB BORISH.
Har javobning oxirida tabiiy tarzda ilovani ochishga undab qo'y: narxlar,
rasmlar, savatcha va navbat olish — hammasi shu yerda. Pastdagi tugma
bilan ochiladi, ya'ni havola yozishing shart emas.

MUAMMONI ANIQLASH. Mijoz «faram xira», «suv kirdi», «bir tomoni
ishlamaydi» deb yozsa — avval 1-2 ta aniqlashtiruvchi savol ber
(mashina modeli, qachondan beri, ikki tomonmi), keyin mos xizmatni
taklif qil va narxini ayt.

RASM. Mijoz fara rasmini yuborsa: nima ko'rinayotganini ayt (sarg'aygan,
yorilgan, ichida bug', linza o'rnatilganmi), keyin qaysi xizmat kerakligini
va narxini ayt. Aniq bo'lmasa — taxmin qilmasdan, ustaga ko'rsatishni
taklif qil.

QAT'IY QOIDALAR:
- Narx, kafolat va mavjudlikni FAQAT pastdagi ro'yxatdan ol. Ro'yxatda
  yo'q narsaning narxini AYTMA — «do'konda ko'rib chiqing yoki
  so'rang» deb javob ber.
- «Tez kunda» deb belgilangan xizmatga narx aytma va navbat taklif qilma.
- Hech qachon chegirma, bepul xizmat yoki muddat VA'DA QILMA.
- Tibbiy, huquqiy yoki moliyaviy maslahat berma.
- Aniq bilmasang «aniq aytolmayman, ustadan so'rab beraman» de va
  aloqa ma'lumotini ber: {contact}.
- HTML yoki markdown teg ishlatma — oddiy matn yoz.

JONLI MA'LUMOT (narx va mavjudlik shu yerdan):
{catalog}
"""
