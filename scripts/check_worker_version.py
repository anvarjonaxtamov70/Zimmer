#!/usr/bin/env python3
"""Cloudflare'da Worker'ning ESKI nusxasi turganini aniqlaydi.

MUAMMO. Cloudflare GitHub'dan o'zi yangilanmaydi — `cloudflare-worker.js`
qo'lda qo'yiladi. Shu sababli repoda yangi imkoniyat bo'lsa-da,
Cloudflare'da eski nusxa turishi mumkin. O'sha holatda ilova
JIMGINA yarim ishlaydi: admin paneli eski buyurtmalarni ko'rsatmaydi,
holat o'zgarganda mijozga xabar ketmaydi.

Bu skript repodagi `FEATURES` ro'yxatini `/health` javobidagi bilan
solishtiradi va YETISHMAYOTGAN belgilarni aytadi.

NEGA VERSIYA RAQAMI EMAS, BELGILAR. `version` — oddiy matn ("1.5.0"),
uni solishtirish uchun semver tahlili kerak. `features` esa aynan nima
ishlamayotganini aytadi va Mini App ham xuddi shu ro'yxatga qaraydi
(`docs/js/admin-shop.js: checkWorkerVersion`).

Ishlatish:
    python3 scripts/check_worker_version.py cloudflare-worker.js /tmp/w.json
Chiqish:
    yetishmayotgan belgilar vergul bilan (hammasi joyida bo'lsa — bo'sh)
Chiqish kodi:
    0 — nusxa yangi, 1 — eski nusxa, 2 — o'qilmadi
"""

import json
import re
import sys

# `const FEATURES = [ ... ];` bloki (izohlar bilan birga bo'lishi mumkin)
_FEATURES_RE = re.compile(r"const FEATURES\s*=\s*\[(.*?)\];", re.S)
_STRING_RE = re.compile(r'"([a-z0-9_]+)"')
_VERSION_RE = re.compile(r'const VERSION\s*=\s*"([^"]+)"')


def repo_features(source: str) -> list[str]:
    """Repodagi `cloudflare-worker.js` dan belgilar ro'yxatini oladi."""
    block = _FEATURES_RE.search(source)
    if not block:
        raise ValueError("`const FEATURES = [...]` topilmadi")
    # Izohlardagi so'zlar tasodifan tushmasligi uchun izohlar olib tashlanadi
    body = re.sub(r"//[^\n]*", "", block.group(1))
    found = _STRING_RE.findall(body)
    if not found:
        raise ValueError("FEATURES ro'yxati bo'sh")
    return found


def repo_version(source: str) -> str:
    match = _VERSION_RE.search(source)
    return match.group(1) if match else "?"


def main(argv: list[str]) -> int:
    if len(argv) < 3:
        print("ishlatish: check_worker_version.py <worker.js> <health.json>", file=sys.stderr)
        return 2
    try:
        source = open(argv[1], encoding="utf-8").read()
        wanted = repo_features(source)
        want_version = repo_version(source)
    except Exception as error:
        print(f"repo fayli o'qilmadi: {error}", file=sys.stderr)
        return 2

    try:
        payload = json.loads(open(argv[2], encoding="utf-8").read())
        if not isinstance(payload, dict):
            raise ValueError("JSON obyekt kutilgan")
    except Exception as error:
        print(f"javob o'qilmadi: {error}", file=sys.stderr)
        return 2

    # Eski nusxalarda `features` maydoni UMUMAN bo'lmasligi mumkin —
    # bu ham "eski" degani (bo'sh ro'yxat sifatida qaraladi).
    live = payload.get("features")
    live_set = set(live) if isinstance(live, list) else set()
    live_version = str(payload.get("version") or "?")

    gaps = [name for name in wanted if name not in live_set]

    print(f"repo: {want_version}  cloudflare: {live_version}", file=sys.stderr)
    if gaps:
        print(", ".join(gaps))
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
