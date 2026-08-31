"""Buyurtma holatlari va ular orasidagi RUXSAT ETILGAN o'tishlar.

Muammo nimada edi?
------------------
Holatni o'zgartirish hech qanday qoidaga bo'ysunmasdi: bekor qilingan
buyurtmani yana «Qabul qilindi» qilish, topshirilganini qaytarib «Ishda»
qilish, bir xil holatni ikki marta bosib mijozga ikki marta xabar
yuborish mumkin edi. Bundan tashqari do'kon buyurtmasi bekor qilinsa,
ombordan yechilgan tovar QAYTMASDI — ya'ni ombor soni tekinga kamayardi.

Qoidalar
--------
Har bir tur uchun bosqichlar ketma-ketligi bor:

    Bi-LED : 🆕 yangi → ✅ qabul → 🔧 ishda → ✨ topshirildi
    Do'kon : 🆕 yangi → ✅ qabul → 🚚 yetkazildi
    Navbat : 🆕 yangi → ✅ tasdiqlangan → ✔️ bajarilgan

Va ular ustidan uchta qoida ishlaydi:

  1. **Yopilgan buyurtma o'zgarmaydi.** Oxirgi bosqich (topshirildi /
     yetkazildi / bajarilgan) yoki «bekor qilingan» — bu YAKUNIY holat.
     Undan keyin hech qanday tugma ishlamaydi.
  2. **Orqaga qaytish yo'q.** Faqat oldinga (yoki bekor qilishga).
  3. **Bir xil holatni takrorlash yo'q** — mijozga takroriy xabar
     bormasligi uchun.

Bu modul yagona manba: bot paneli ham, Mini App paneli ham, tugmalarni
yasovchi klaviaturalar ham shu qoidalarni ishlatadi. Shuning uchun
ikki joyda boshqacha ishlab qolishi mumkin emas.
"""

import logging
from dataclasses import dataclass

from database import queries as q
from services import sync
from utils.texts import BILED_STATUS, BOOKING_STATUS, ORDER_STATUS

logger = logging.getLogger(__name__)

CANCELLED = "cancelled"

# Rad etish sabablari
SAME = "same"
CLOSED = "closed"
BACKWARD = "backward"
UNKNOWN = "unknown"


@dataclass(frozen=True)
class TransitionResult:
    applied: bool
    current: str | None
    reason: str = ""


@dataclass(frozen=True)
class Flow:
    kind: str
    title: str
    icon: str
    labels: dict[str, str]
    stages: tuple[str, ...]  # bosqichlar tartibi (bekor qilish bundan tashqari)
    buttons: dict[str, str]  # tugma yozuvlari (qisqartirilgan)


FLOWS: dict[str, Flow] = {
    "biled": Flow(
        kind="biled",
        title="Bi-LED buyurtmalar",
        icon="🔥",
        labels=BILED_STATUS,
        stages=("new", "accepted", "in_work", "done"),
        buttons={
            "accepted": "✅ Qabul",
            "in_work": "🔧 Ishda",
            "done": "✨ Topshirildi",
            CANCELLED: "❌ Bekor",
        },
    ),
    "order": Flow(
        kind="order",
        title="Do'kon buyurtmalari",
        icon="📦",
        labels=ORDER_STATUS,
        # `delivering` («yo'lda») Mini App panelida allaqachon ishlatilardi,
        # lekin bu ro'yxatda yo'q edi — natijada bot paneli o'sha holatni
        # tanimay buyurtmani «yopilgan» deb hisoblardi.
        stages=("new", "accepted", "delivering", "delivered"),
        buttons={
            "accepted": "✅ Qabul qilish",
            "delivering": "🚚 Yo'lga chiqdi",
            "delivered": "🎉 Yetkazildi",
            CANCELLED: "❌ Bekor qilish",
        },
    ),
    "booking": Flow(
        kind="booking",
        title="O'rnatish navbatlari",
        icon="🗓",
        labels=BOOKING_STATUS,
        stages=("new", "confirmed", "done"),
        buttons={
            "confirmed": "✅ Tasdiqlash",
            "done": "✔️ Bajarildi",
            CANCELLED: "❌ Bekor qilish",
        },
    ),
}

# Eski/qisqa nomlar bilan moslik ("shop" — Mini App'da ishlatilgan)
ALIASES = {"shop": "order", "orders": "order", "bookings": "booking", "biled_orders": "biled"}


def resolve(kind: str) -> str:
    """Tur nomini standart ko'rinishga keltiradi."""
    return ALIASES.get(kind, kind)


def flow(kind: str) -> Flow | None:
    return FLOWS.get(resolve(kind))


def known(kind: str) -> bool:
    return resolve(kind) in FLOWS


def label(kind: str, status: str) -> str:
    got = flow(kind)
    return got.labels.get(status, status) if got else status


def is_final(kind: str, status: str) -> bool:
    """Yakuniy holatmi? (bekor qilingan yoki oxirgi bosqich)"""
    got = flow(kind)
    if not got:
        return False
    return status == CANCELLED or status == got.stages[-1]


def allowed_targets(kind: str, current: str) -> tuple[str, ...]:
    """Shu holatdan o'tish mumkin bo'lgan holatlar (tugmalar shundan yasaladi)."""
    got = flow(kind)
    if not got or is_final(kind, current):
        return ()

    try:
        position = got.stages.index(current)
    except ValueError:
        # Bazada notanish holat bo'lsa — hamma bosqichni taklif qilamiz
        return (*got.stages[1:], CANCELLED)

    return (*got.stages[position + 1 :], CANCELLED)


def check(kind: str, current: str, target: str) -> tuple[bool, str]:
    """(mumkinmi, sabab_kodi) qaytaradi."""
    got = flow(kind)
    if not got or target not in got.labels:
        return False, UNKNOWN
    if current == target:
        return False, SAME
    if is_final(kind, current):
        return False, CLOSED
    if target in allowed_targets(kind, current):
        return True, ""
    return False, BACKWARD


def reason_text(kind: str, current: str, target: str, reason: str) -> str:
    """Adminga ko'rsatiladigan tushunarli izoh."""
    current_label = label(kind, current)
    target_label = label(kind, target)

    if reason == SAME:
        return f"Bu buyurtma allaqachon «{current_label}» holatida."
    if reason == CLOSED:
        if current == CANCELLED:
            return (
                "Bu buyurtma bekor qilingan — uni qayta ochib bo'lmaydi.\n\n"
                "Mijoz yana xohlasa, yangi buyurtma berishi kerak."
            )
        return f"Bu buyurtma yopilgan («{current_label}») — holatini o'zgartirib bo'lmaydi."
    if reason == BACKWARD:
        return (
            f"«{current_label}» dan «{target_label}» ga qaytib bo'lmaydi — "
            "holat faqat oldinga siljiydi."
        )
    return "Bu holatni qo'yish mumkin emas."


async def apply(
    kind: str,
    order_id: int,
    status: str,
    *,
    expected_status: str,
) -> TransitionResult:
    """Holatni atomik CAS bilan saqlaydi va faqat g'olib natijani sync qiladi."""
    kind = resolve(kind)
    allowed, reason = check(kind, expected_status, status)
    if not allowed:
        return TransitionResult(False, expected_status, reason)

    applied, current, restored = await q.compare_and_set_status(
        kind, order_id, expected_status, status
    )
    if not applied:
        if current is None:
            return TransitionResult(False, None, UNKNOWN)
        _, conflict_reason = check(kind, current, status)
        return TransitionResult(False, current, conflict_reason or SAME)

    if restored:
        logger.info(
            "Buyurtma #%s bekor qilindi, omborga %s dona qaytdi", order_id, restored
        )
    await sync.push_status(kind, order_id, status)
    return TransitionResult(True, status)
