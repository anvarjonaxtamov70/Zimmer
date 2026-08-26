#!/usr/bin/env python3
"""Worker `/health` javobini tekshiradi: qaysi sozlama kiritilmagan?

Tashxis workflow'i (`.github/workflows/diagnose.yml`) shu skriptni chaqiradi.

NEGA ALOHIDA FAYL
Ilgari bu tekshiruv workflow ichida `python3 -c "..."` bo'lib yozilgan edi.
YAML blok skalyari + bash + Python qo'shtirnoqlari birga kelganda escape
qilish deyarli imkonsiz bo'lib qoladi (heredoc esa YAML'ni buzadi). Alohida
fayl ancha soddaroq va uni sinovdan ham o'tkazish mumkin.

Ishlatish:
    python3 scripts/check_worker_health.py /tmp/w.json
Chiqish:
    yetishmayotgan sozlamalar vergul bilan (hammasi joyida bo'lsa — bo'sh)
Chiqish kodi:
    0 — hammasi joyida, 1 — biror narsa yetishmaydi, 2 — javob o'qilmadi
"""

import json
import sys

# `configured` kalitlari -> foydalanuvchi ko'radigan o'zgaruvchi nomi
REQUIRED = [
    ("bot_token", "BOT_TOKEN"),
    ("firebase_key", "FIREBASE_CLIENT_EMAIL + FIREBASE_PRIVATE_KEY"),
    ("db_url", "FIREBASE_DB_URL"),
]


def missing(payload: dict) -> list[str]:
    configured = payload.get("configured") or {}
    gaps = [name for key, name in REQUIRED if not configured.get(key)]
    # `admins` — son (nechta admin kiritilgan), 0 bo'lsa xabar bormaydi
    if not configured.get("admins"):
        gaps.append("ADMIN_IDS")
    return gaps


def main(argv: list[str]) -> int:
    path = argv[1] if len(argv) > 1 else "-"
    try:
        raw = sys.stdin.read() if path == "-" else open(path, encoding="utf-8").read()
        payload = json.loads(raw)
        if not isinstance(payload, dict):
            raise ValueError("JSON obyekt kutilgan")
    except Exception as error:
        print(f"javob o'qilmadi: {error}", file=sys.stderr)
        return 2

    gaps = missing(payload)
    print(", ".join(gaps))
    return 1 if gaps else 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
