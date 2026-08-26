# =====================================================================
#  Zimmer bot — Docker image
#
#  Konteyner platformalarida ishlaydi: Koyeb, Fly.io, Railway, Render,
#  Google Cloud Run, o'z serveringiz.
#
#  MAXFIY QIYMATLAR IMAGE ICHIGA QO'YILMAYDI. `.env` va
#  `serviceAccount.json` `.dockerignore` orqali chiqarib tashlanadi —
#  ular platformaning "environment variables" bo'limidan beriladi.
#  Aks holda kalit image ichida qolib, registry'ga yuklanib ketardi.
# =====================================================================
FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PYTHONDONTWRITEBYTECODE=1

WORKDIR /app

# Avval FAQAT requirements — kod o'zgarganda pandas qayta o'rnatilmasin
# (Docker qatlam keshi). Bu qayta deployni bir necha daqiqa tezlashtiradi.
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Bot long-polling ishlatadi. PORT berilsa (barcha platformalar beradi)
# `/health` va Mini App API'si shu portda ochiladi — api/server.py:96.
# PORT bo'lmasa API server yoqilmaydi, bot esa baribir ishlaydi.
EXPOSE 8080

# Ildiz foydalanuvchi bo'lmasin (xavfsizlik amaliyoti)
RUN useradd --create-home --shell /bin/bash zimmer \
    && chown -R zimmer:zimmer /app
USER zimmer

CMD ["python", "bot.py"]
