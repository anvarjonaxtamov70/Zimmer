# 🚀 Zimmer Mini App - Mahsulot Tizimi Migratsiyasi

## Maqsad
Avto_A1'ning Mini App mahsulot tizimini Zimmerga 1-ga-1 ko'chirish.

## Bajarilgan Ishlar
- ✅ Branch yaratildi: `feature/miniapp-full-product-overhaul`
- ✅ Avto_A1 va Zimmer strukturasi o'rganildi
- ✅ Zimmer allaqachon mahsulot katalogi (#catalog-sec) bor

## Qo'shish Kerak Bo'lgan Komponentlar

### 1. Frontend (docs/ papkasi)

#### A. Mahsulot Tafsilot Modali (`#productModal`)
**Manzil:** `docs/index.html` va `docs/styles.css`

Qo'shilishi kerak:
- [ ] Modal HTML struktura (rasm karuseli, tavsif, narx, stock)
- [ ] Modal CSS (Zimmer qora-qizil ranglarida)
- [ ] Modal JavaScript (ochish/yopish, rasm galereya)
- [ ] "Savatga qo'shish" tugmasi
- [ ] "Yoqtirgan" (❤️) funksiyasi

#### B. Admin Mahsulot CRUD
**Manzil:** `docs/js/admin.js`

Qo'shilishi kerak:
- [ ] Mahsulot yaratish forması
- [ ] Mahsulot tahrirlash forması
- [ ] Ko'p rasm yuklash (drag-drop + progress)
- [ ] Mahsulot o'chirish
- [ ] Stock (ombor) boshqaruvi

#### C. Mahsulot Kartochka Yaxshilash
**Manzil:** `docs/js/app.js` -> `renderProducts` funksiyasi

Yaxshilanishi kerak:
- [ ] Stock badge qo'shish
- [ ] Yangi/Aksiya belgilari
- [ ] "Yoqtirgan" tugmasi
- [ ] Mahsulot modal ochish

### 2. Backend API (api/ papkasi)

Mavjud endpointlar:
- ✅ GET `/api/products` - bor
- ✅ POST `/api/products` - bor 
- ✅ PUT `/api/products/<id>` - bor
- ✅ DELETE `/api/products/<id>` - bor

Qo'shilishi kerak:
- [ ] POST `/api/upload-image` - rasm yuklash endpoint
- [ ] GET `/api/products/<id>` - bitta mahsulot tafsiloti

### 3. Services (services/ papkasi)

Mavjud:
- ✅ `firebase_products.py` - mahsulotlar CRUD
- ✅ `firebase_storage.py` - Firebase Storage bilan ishlash

## Ranglar Moslashtirish

**Avto_A1 (tilla-qora):**
```css
--luxury-gold: #d4af37
--bg-dark: #0a0a0c
```

**Zimmer (qizil-qora):**
```css
--red: #ff2d3a
--red-2: #e01020
--bg: #08080a
--gold: #d4a853  /* Aksent uchun */
```

**O'zgartirish kerak:**
- Tilla → Qizil (asosiy tugmalar)
- Tilla aksent → Zimmer gold (#d4a853)
- Avto_A1 gradient → Zimmer qizil gradient

## Bajarish Tartibi

### PHASE 1: Modal HTML/CSS (30 min)
1. `docs/index.html` ga `#productModal` qo'shish
2. `docs/styles.css` ga modal CSS qo'shish (Zimmer ranglarida)

### PHASE 2: Modal JavaScript (30 min)
1. `docs/js/app.js` ga modal funksiyalari qo'shish
2. Rasm galereyasi (swipe, dots)
3. Savatga qo'shish integratsiyasi

### PHASE 3: Admin CRUD (40 min)
1. `docs/js/admin.js` ga mahsulot CRUD qo'shish
2. Ko'p rasm yuklash UI
3. Stock boshqaruvi

### PHASE 4: Backend (20 min)
1. `api/media.py` rasm yuklash endpoint
2. Test va debug

### PHASE 5: Commit & PR (10 min)
1. Test
2. git add/commit/push
3. PR yaratish

## Xatolarga Bardosh

- Agar API xatoligi bo'lsa → `onError()` ishlatish
- Rasm yuklanmasa → fallback placeholder
- Stock 0 bo'lsa → "Buyurtma asosida" badge

## Muvaffaqiyat Mezonlari

✅ Mahsulot kartochkasini bosish → tafsilot modali ochiladi
✅ Rasm galereyasi ishla ydi (swipe, dots)
✅ "Savatga qo'shish" ishlaydi
✅ Admin mahsulot yaratishi mumkin
✅ Ko'p rasm yuklash ishlaydi
✅ Barcha ranglar Zimmer temasida
