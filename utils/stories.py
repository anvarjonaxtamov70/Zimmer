"""Stories kategoriyalari — YAGONA MANBA.

Avto_A1 dagi mantiq: kategoriyalar (halqalar) KODDA belgilanadi, ularning
ichidagi video/rasmlar esa bazada saqlanadi. Bitta halqa ichida bir nechta
element bo'lishi mumkin — Instagram kabi ketma-ket o'ynaydi.

Bot admin paneli ham, Mini App ham shu ro'yxatdan foydalanadi, shuning uchun
ikkisi doim bir xil ko'rsatadi.

DIQQAT: `key` qiymatlari bazada saqlanadi — ularni o'zgartirmang (aks holda
eski yozuvlar halqasiz qolib ketadi). Faqat nom/emoji/rangni o'zgartirish
xavfsiz.
"""

# (key, nom, emoji, rang_boshi, rang_oxiri)
STORY_CATEGORIES: tuple[tuple[str, str, str, str, str], ...] = (
    ("aksiyalar", "Aksiyalar", "🔥", "#ff2d3a", "#6d0a10"),
    ("bugun", "Bugun", "⚡️", "#ff6b3d", "#3a0f00"),
    ("mijozlar", "Mijozlar", "💬", "#e01020", "#2a0006"),
    # «Yetkazib berish» o'rniga — bajarilgan ishlar
    ("natijalar", "Natijalar", "🏆", "#ff4b3e", "#1a0508"),
    ("kafolat", "Kafolat", "🛡", "#c1121f", "#101215"),
    ("lokatsiya", "Manzil", "📍", "#ff8f3d", "#2b1200"),
    ("tolov", "To'lov", "💳", "#ff2d55", "#25040c"),
    ("aloqa", "Aloqa", "📞", "#ff5f6d", "#20060a"),
)

# Tez izlash uchun
STORY_ORDER: tuple[str, ...] = tuple(key for key, *_ in STORY_CATEGORIES)
STORY_MAP: dict[str, dict[str, str]] = {
    key: {"key": key, "title": title, "emoji": emoji, "color_from": c1, "color_to": c2}
    for key, title, emoji, c1, c2 in STORY_CATEGORIES
}

DEFAULT_CATEGORY = "bugun"


def normalize(category: str | None) -> str:
    """Noto'g'ri yoki bo'sh kategoriyani standart qiymatga keltiradi."""
    key = str(category or "").strip().lower()
    return key if key in STORY_MAP else DEFAULT_CATEGORY


def title_of(category: str | None) -> str:
    info = STORY_MAP.get(normalize(category))
    return f"{info['emoji']} {info['title']}" if info else category or ""


def choices() -> list[tuple[str, str]]:
    """Admin paneldagi tanlov ro'yxati."""
    return [(key, f"{info['emoji']} {info['title']}") for key, info in STORY_MAP.items()]
