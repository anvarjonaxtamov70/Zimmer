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

  // Zaxira rejimda narx yozuvlarini server'siz shakllantirish uchun
  // (`/api/config` javob bermaydi).
  CURRENCY: "so'm",

  /* Zaxira rejimda buyurtma berish mumkin emas (ombor kamaytirish va
     adminga xabar serverni talab qiladi). Shu sababli mijozga to'g'ridan
     aloqa yo'li ko'rsatiladi. */
  SHOP_TELEGRAM: "anvaraxtamov2004",
  SHOP_PHONE: "+998 88 289 30 30",
};
