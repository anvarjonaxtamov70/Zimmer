/**
 * Mini App sozlamalari.
 *
 * API_BASE — bot ishlab turgan Render manzili (oxirida / bo'lmasin).
 * Render'da xizmat nomi boshqa bo'lsa, shu qatorni o'zgartiring.
 *
 * Vaqtincha boshqa manzilni sinash uchun ilovani shunday ochish mumkin:
 *   https://anvarjonaxtamov70.github.io/Zimmer/?api=https://boshqa.onrender.com
 */
window.ZIMMER_CONFIG = {
  API_BASE: "https://zimmer-bot.onrender.com",

  /* ====================================================================
     ZAXIRA (OFFLINE) REJIM — Render o'chganda do'kon ishlashi uchun
     ====================================================================
     Render bepul tarifda uxlaydi yoki oylik kvota tugasa butunlay
     to'xtaydi. O'sha paytda ilova katalogni TO'G'RIDAN-TO'G'RI
     Firebase'dan o'qiydi (bot uni doim ko'chirib turadi).

     Bu ishlashi uchun Firebase qoidalarida `{ROOT}/catalog` ochiq
     o'qishga ruxsat etilgan bo'lishi kerak — `database.rules.json`
     faylini Firebase Console'ga qo'ying (repo ildizida).

     Bo'sh qoldirsangiz zaxira rejim o'chadi va Render o'chganda ilova
     avvalgidek "Server javob bermadi" deb ko'rsatadi.
     ==================================================================== */
  FIREBASE_DB_URL: "https://zimmer-42840-default-rtdb.firebaseio.com",
  FIREBASE_ROOT: "zimmer",

  /* ====================================================================
     CLOUDFLARE WORKER — Render o'chganda BUYURTMA QABUL QILISH
     ====================================================================
     Worker uxlamaydi va bepul. U quyidagilarni bajaradi:
       • buyurtma yaratish (summa katalogdan, server tomonda hisoblanadi)
       • mijozni tanib qolish (profil: ism, telefon, mashina)
       • adminga va mijozga Telegram xabari
       • `file_id` rasmlarni ko'rsatish (/media proksisi)

     Ya'ni Render faqat BOTNI ishlatadi — do'kon va buyurtma bundan
     mustaqil, Avto_A1 dagi kabi.

     Deploy: `cloudflare-worker.js` faylini Cloudflare Workers'ga qo'yib,
     Secret'larni kiritish. To'liq ko'rsatma: WORKER_SETUP.md
     Bo'sh qoldirilsa — zaxira rejimda faqat KO'RISH ishlaydi.
     ==================================================================== */
  WORKER_URL: "https://zimmer-worker.anvaraxtamov70.workers.dev",

  /* ====================================================================
     TELEFON GALEREYASIDAN RASM YUKLASH (ImgBB)

     Admin panelda «Rasm yuklash» tugmasi ishlashi uchun shu kalit kerak.
     Bepul olinadi: https://api.imgbb.com/ -> «Get API key» (ro'yxatdan
     o'tish talab qilinadi, karta kerak emas, cheklovsiz bepul).

     NEGA FIREBASE STORAGE EMAS: u 2026-yil 3-fevraldan pullik Blaze
     tarifini talab qiladi (standart `*.appspot.com` bucket ham). Bepul
     tarifda ishlamaydi.

     Kalit bo'sh bo'lsa panel yiqilmaydi — «Rasm yuklash» tugmasi o'rniga
     havola qo'yish maydoni ko'rsatiladi va nima qilish kerakligi aytiladi.

     DIQQAT: bu kalit brauzerda ko'rinadi (Avto_A1 da ham shunday). Uni
     bilgan odam sizning ImgBB akkauntingizga rasm yuklashi mumkin —
     boshqa zarar yo'q, bazaga va do'konga ta'sir qilmaydi.
     ==================================================================== */
  // Bu kalit Avto_A1 loyihasida allaqachon ishlatilayotgan — ya'ni sizning
  // o'z kalitingiz. Shu sababli qo'shimcha ro'yxatdan o'tish kerak emas.
  // Xohlasangiz Zimmer uchun alohida kalit olib shu yerga qo'yasiz.
  IMGBB_KEY: "956de2d2a33ae1bcc56d5ada6fd8788d",

  // Zaxira rejimda narx yozuvlarini server'siz shakllantirish uchun
  // (`/api/config` javob bermaydi).
  CURRENCY: "so'm",

  /* Zaxira rejimda buyurtma berish mumkin emas (ombor kamaytirish va
     adminga xabar serverni talab qiladi). Shu sababli mijozga to'g'ridan
     aloqa yo'li ko'rsatiladi. */
  SHOP_TELEGRAM: "anvaraxtamov2004",
  SHOP_PHONE: "+998 88 289 30 30",
};
