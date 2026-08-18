# Firebase Products System — Admin Guide

## 📦 Yangi mahsulot qo'shish tizimi (Avto_A1 style)

Zimmer'ga Avto_A1'ning tovar qo'shish va ombor (inventory) tizimi joriy qilindi.

### ✨ Yangi imkoniyatlar

1. **Firebase Realtime Database** — mahsulotlar bulutda doimiy saqlanadi
2. **Excel/CSV Import** — bir necha yuz mahsulotni bir vaqtda yuklash
3. **Multi-image upload** — har bir mahsulotga ko'p rasmlar
4. **Draft system** — import qilingan mahsulotlarni tekshirib tasdiqlash
5. **Batch management** — guruh bo'yicha boshqarish
6. **Stock tracking** — ombor miqdorini kuzatish

---

## 🚀 Ishlatish

### 1️⃣ Bitta mahsulot qo'shish (dialog)

```
/add_product
```

Bot sizdan ketma-ket so'raydi:
- Mahsulot nomi
- Narx (so'mda)
- Ombor miqdori
- Tavsif (ixtiyoriy)
- Rasmlar (bir necha marta yuborishingiz mumkin)

Oxirida `/confirm` bilan tasdiqlang.

---

### 2️⃣ Excel/CSV import (ommaviy)

**Excel yoki CSV fayl tayyorlang:**

| name | price | stock | description | brand | model | code |
|------|-------|-------|-------------|-------|-------|------|
| Bi-LED linza Koito Q5 | 1500000 | 15 | Yaponiya optikasi | Koito | Q5 | KT-Q5-3.0 |
| Devil Eyes ochki | 450000 | 30 | Qizil halqa | - | - | DE-RED |

**Ustunlar (tartibsiz bo'lishi mumkin):**
- `name` / `nomi` / `mahsulot` — **majburiy**
- `price` / `narx` — **majburiy** (so'mda)
- `stock` / `ombor` / `miqdor` — ixtiyoriy (standart: 0)
- `description` / `tavsif` — ixtiyoriy
- `code` / `kod` / `artikul` — ixtiyoriy
- `brand` / `brend` — ixtiyoriy
- `model` — ixtiyoriy
- `unit` / `birlik` — ixtiyoriy ("dona", "komplekt")
- `old_price` / `eski_narx` — ixtiyoriy (chegirma uchun)
- `badge` / `teg` — ixtiyoriy ("TOP tanlov", "Yangi")

**Faylni botga yuboring** — avtomatik import boshlanadi.

Natija:
```
✅ Import yakunlandi

📦 Batch ID: import_20260818_143000_a1b2c3d4

Jami qatorlar: 156
✅ Qo'shildi: 150
⏭ O'tkazib yuborildi: 6

💡 Mahsulotlar QORALAMA holda qo'shildi.
Tekshirib, tasdiqlash uchun: /products_drafts
```

---

### 3️⃣ Qoralama mahsulotlarni tasdiqlash

Import qilingan mahsulotlar **qoralama (draft)** holda saqlanadi va do'konda ko'rinmaydi.

**Qoralama ro'yxatini ko'rish:**
```
/products_drafts
```

**Butun guruhni tasdiqlash:**
```
/approve_batch import_20260818_143000_a1b2c3d4
```

**Guruhni o'chirish (xato import bo'lsa):**
```
/delete_batch import_20260818_143000_a1b2c3d4
```

---

### 4️⃣ Mahsulotlar ro'yxati

```
/products_list
```

Barcha mahsulotlarni ko'rsatadi (faol/nofaol).

---

### 5️⃣ Mahsulot boshqarish

**Faollashtirish/o'chirish:**
```
/toggle_product 1001
```

**O'chirish:**
```
/delete_product 1001
```

**Ombor yangilash:**
```
/update_stock 1001 50
```

---

## 🔧 Texnik tafsilotlar

### Firebase struktura

```
zimmer/
  products/
    1001/
      id: 1001
      name: "Bi-LED linza Koito Q5"
      price: 1500000
      stock: 15
      description: "Yaponiya optikasi"
      brand: "Koito"
      model: "Q5"
      code: "KT-Q5-3.0"
      images: ["AgACAgIAAxkBAAIC...", "AgACAgIAAxkBAAID..."]
      is_active: true
      is_draft: false
      batch_id: null
      created_at: "2026-08-18T14:30:00Z"
      updated_at: "2026-08-18T14:30:00Z"
```

### Yangi maydonlar (Avto_A1'dan)

- `brand` — brend/ishlab chiqaruvchi
- `model` — model
- `code` — artikul/OEM kod
- `unit` — o'lchov birligi ("dona", "komplekt")
- `images` — array (ko'p rasmlar)
- `is_draft` — qoralama holati
- `batch_id` — import guruh ID'si

---

## 📝 Misol: Import faylni tayyorlash

**Excel (products.xlsx):**

| nomi | narx | ombor | tavsif | brend | kod |
|------|------|-------|--------|-------|-----|
| Gentra uchun H4 to'plami | 420000 | 10 | Gentra faralariga mos | OEM | GEN-H4-01 |
| DRL lenta COB | 180000 | 30 | Kunduzgi yurish chirog'i | Universal | DRL-COB-2 |
| Fara germetigi | 85000 | 40 | Issiqqa chidamli | Sealant | SEAL-BK-310 |

Faylni botga yuborasiz → bot o'qib, 3 ta mahsulotni qoralama holda qo'shadi → siz tekshirasiz → `/approve_batch ...` bilan tasdiqlaysiz → mahsulotlar do'konda paydo bo'ladi ✅

---

## ⚠️ Muhim

1. **Firebase token** — `SERVICE_ACCOUNT_JSON` .env'da to'g'ri sozlangan bo'lishi kerak
2. **Eski SQLite mahsulotlar** — hali SQLite'da saqlanadi, lekin YANGI mahsulotlar faqat Firebase'ga qo'shiladi
3. **Migratsiya** — eski mahsulotlarni Firebase'ga ko'chirish uchun alohida skript kerak (keyinroq)

---

## 🎨 UI/UX (Zimmer dizayni)

Bot'ning tovar qo'shish interfeysi Avto_A1'dan olingan, lekin ranglar Zimmer'ning qora-qizil (dark/red premium) breyn dizayniga moslashtirilgan.

---

**Muallif:** Kiro AI  
**Sana:** 2026-08-18  
**Branch:** feature/overhaul-product-inventory-system
