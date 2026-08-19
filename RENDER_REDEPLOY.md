# 🚀 RENDER.COM SERVERINI YANGILASH

## ⚠️ Muhim: PR#48 va PR#49 o'zgarishlarini qo'llash

**Muammo:** Kod GitHub'da yangilangan, lekin Render.com server eski versiyani ishlatyapti.

## 📋 Kerakli qadamlar:

### 1. Render Environment o'zgaruvchilarini yangilash

Render.com → **zimmer-bot** → **Environment** → quyidagi o'zgaruvchini qo'shing:

```
FIREBASE_STORAGE_BUCKET=zimmer-42840.appspot.com
```

> **Izoh:** Bu Firebase Storage'dan rasmlarni yuklash va ko'rsatish uchun zarur.

### 2. Manual Redeploy

Render panelida:

1. **Manual Deploy** tugmasini bosing
2. **Deploy latest commit** tanlang
3. Deploy tugashini kuting (2-4 daqiqa)

### 3. Tekshirish

Deploy tugagach, botga quyidagi buyruqlarni yuboring:

```
/start
/admin
```

Admin panelda yangi imkoniyatlar ko'rinishi kerak:
- 📦 **Mahsulot qo'shish** (rasm bilan)
- 📥 **Import qilish** (Excel/CSV)
- 🔄 **Firebase Products tizimi**

### 4. Log'larni tekshirish

Render Logs'da quyidagi xabarlar ko'rinishi kerak:

```
Firebase Products tizimi yoqildi
Firebase Storage ulandi: zimmer-42840.appspot.com
```

## 🔧 Agar muammo davom etsa:

1. **Cache tozalash:** Render panelida **Clear Build Cache** → qayta deploy
2. **Dependencies tekshirish:** Logs'da `pip install` qismi xatosiz o'tganini ko'ring
3. **Firebase sozlamalar:** `.env.example` dagi barcha Firebase o'zgaruvchilari Render'da mavjudligini tekshiring

## ✅ Muvaffaqiyatli deploy belgilari:

- [ ] Bot javob berayapti
- [ ] Admin panel ochiladi
- [ ] Mahsulot qo'shish tugmasi mavjud
- [ ] Rasm yuklash ishlaydi
- [ ] Firebase Products tizimi aktiv

---

**Yaratildi:** 2026-08-19
**Sabab:** PR#48 va PR#49 merge qilindi, lekin server qayta deploy qilinmagan
