/* ==========================================================================
   ZIMMER — BRAUZERDAN FIREBASE'GA TO'G'RIDAN YOZISH

   Model Avto_A1 bilan bir xil: mini app bazaga o'zi yozadi, shuning uchun
   Render ham, Cloudflare Worker ham kerak bo'lmaydi. Tovar qo'shish,
   tahrirlash, buyurtma — hammasi shu fayl orqali o'tadi.

   FARQ: Avto_A1 Firebase JS SDK (compat) yuklaydi — bu ~300 KB va
   `signInWithCustomToken` talab qiladi. Bizga ular kerak emas, chunki
   qoidalar ochiq: RTDB'ning REST API'si oddiy `fetch` bilan ishlaydi.
   Natija bir xil, ilova esa yengil qoladi.

   ID BERISH — MUHIM TAFSILOT
   Avto_A1 tovarni MASSIV INDEKSIGA yozadi (`products/0`, `products/1`...)
   va o'chirishda butun massivni qayta yozadi. Ikki admin bir vaqtda
   ishlasa ma'lumot yo'qoladi.

   Bizda SQLite ham bor va uning avto-inkrementi 1 dan o'sib boradi.
   Shuning uchun brauzer bergan id `ID_BASE` (900000) dan boshlanadi —
   SQLite hech qachon o'sha raqamlarga yetmaydi va ikki xil tovar bitta
   id ga tushib qolmaydi.

   Sanoqchi ETag (`if-match`) bilan oshiriladi: ikki admin bir vaqtda
   tovar qo'shsa ham ikkisi HAR XIL id oladi.
   ========================================================================== */

window.ZimmerFB = (function () {
  "use strict";

  var CFG = window.ZIMMER_CONFIG || {};
  var DB = (CFG.FIREBASE_DB_URL || "").replace(/\/$/, "");
  var ROOT = (CFG.FIREBASE_ROOT || "zimmer").replace(/^\/|\/$/g, "");
  var WORKER = (CFG.WORKER_URL || "").replace(/\/$/, "");

  /** Brauzer bergan id'lar shu raqamdan boshlanadi (SQLite bilan urishmasin). */
  var ID_BASE = 900000;

  function available() {
    return !!DB;
  }

  /* Worker feature flag'lari qisqa muddatga keshlanadi. Katalog yozuvidan
     OLDIN Worker'ning `admin_catalog_write` ni qo'llashini tekshirish uchun
     (item 7): eski Worker `/admin/catalog-write` ni 404 bilan rad etadi va
     xato tushunarsiz bo'lardi. */
  var _featCache = null; // { at, features, version }

  async function workerFeatures() {
    if (!WORKER) return null;
    if (_featCache && Date.now() - _featCache.at < 60000) return _featCache;
    try {
      var res = await fetch(WORKER + "/health", { cache: "no-store" });
      if (!res.ok) return null;
      var h = await res.json();
      _featCache = {
        at: Date.now(),
        features: h && Array.isArray(h.features) ? h.features : [],
        version: (h && h.version) || "?",
      };
      return _featCache;
    } catch (_) {
      return null;
    }
  }

  function url(path, query) {
    var p = String(path).replace(/^\/+/, "");
    return DB + "/" + ROOT + "/" + p + ".json" + (query ? "?" + query : "");
  }

  /** Xatoni YASHIRMAYMIZ — chaqiruvchi sababni ko'rsata olishi kerak. */
  function boom(res, body) {
    var code = "http_" + res.status;
    var msg = "Bazaga yozilmadi (" + res.status + ")";
    if (res.status === 401 || res.status === 403) {
      code = "rules";
      msg = "Baza qoidalari ruxsat bermadi";
    } else if (res.status === 404) {
      msg = "Baza manzili topilmadi";
    }
    var err = new Error(msg);
    err.code = code;
    err.status = res.status;
    err.detail = body;
    throw err;
  }

  async function request(method, path, value, headers, query) {
    if (!DB) {
      var e = new Error("FIREBASE_DB_URL sozlanmagan");
      e.code = "no_db";
      throw e;
    }
    var init = { method: method, cache: "no-store", headers: headers || {} };
    if (value !== undefined) {
      init.headers = Object.assign({ "Content-Type": "application/json" }, init.headers);
      init.body = JSON.stringify(value);
    }

    var res;
    try {
      res = await fetch(url(path, query), init);
    } catch (_) {
      var ne = new Error("Internetga ulanmadi");
      ne.code = "network";
      throw ne;
    }

    var text = await res.text();
    var body = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch (_) {
      body = text;
    }
    if (!res.ok) boom(res, body);
    return { body: body, etag: res.headers.get("ETag") };
  }

  function telegramInitData() {
    try {
      return (window.Telegram && window.Telegram.WebApp && window.Telegram.WebApp.initData) || "";
    } catch (_) {
      return "";
    }
  }

  function isCatalogPath(path) {
    return /^catalog\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+$/.test(String(path || ""));
  }

  function protectedWrite(path) {
    return /^(catalog|slots|bookings|biled_orders|pending_orders)(\/|$)/.test(String(path || ""));
  }

  function blockedWriteError() {
    var err = new Error("Bu yozuv faqat xavfsiz Worker endpointi orqali bajariladi");
    err.code = "secure_endpoint_required";
    return err;
  }

  /** Katalog yozuvlari faqat admin imzosini tekshiradigan Worker orqali. */
  async function secureCatalogWrite(method, path, value, table) {
    if (!WORKER) {
      var we = new Error("WORKER_URL sozlanmagan — xavfsiz yozish imkonsiz");
      we.code = "no_worker";
      throw we;
    }
    /* Item 7: `/admin/catalog-write` ga murojaatdan OLDIN Worker feature
       flag'ini tekshiramiz. Worker eski bo'lsa (feature yo'q) — endpoint
       tushunarsiz 404 qaytarishidan oldin aniq xabar beramiz. Health'ni
       aniqlab bo'lmasa (tarmoq) bloklamaymiz: haqiqiy xato quyida chiqadi.
       Chaqiruvchi (masalan story o'chirish) bu xatoni ushlab, autentifikatsiya
       qilingan Render zaxirasiga o'tishi mumkin. */
    var feat = await workerFeatures();
    if (feat && feat.features.indexOf("admin_catalog_write") === -1) {
      var oe = new Error("Worker eski (" + feat.version + ") — katalog yozish uchun yangilash kerak");
      oe.code = "worker_outdated";
      throw oe;
    }
    var initData = telegramInitData();
    if (!initData) {
      var ie = new Error("Telegram imzosi yo'q");
      ie.code = "no_init_data";
      throw ie;
    }
    var res;
    try {
      res = await fetch(WORKER + "/admin/catalog-write", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          initData: initData,
          method: method,
          path: path || null,
          table: table || null,
          value: value === undefined ? null : value,
        }),
      });
    } catch (_) {
      var ne = new Error("Internetga ulanmadi");
      ne.code = "network";
      throw ne;
    }
    var body = null;
    try {
      body = await res.json();
    } catch (_) {}
    if (!res.ok || !body || body.ok !== true) {
      var err = new Error((body && (body.message || body.error)) || "Xavfsiz yozish bajarilmadi");
      err.code = (body && body.error) || "http_" + res.status;
      err.status = res.status;
      throw err;
    }
    return body;
  }

  /* ------------------------------------------------------- asosiy amallar */

  async function get(path) {
    return (await request("GET", path)).body;
  }

  async function put(path, value) {
    if (isCatalogPath(path)) return (await secureCatalogWrite("put", path, value)).value;
    if (protectedWrite(path)) throw blockedWriteError();
    return (await request("PUT", path, value)).body;
  }

  async function patch(path, value) {
    if (isCatalogPath(path)) return (await secureCatalogWrite("patch", path, value)).value;
    if (protectedWrite(path)) throw blockedWriteError();
    return (await request("PATCH", path, value)).body;
  }

  async function remove(path) {
    if (isCatalogPath(path)) return (await secureCatalogWrite("delete", path)).value;
    if (protectedWrite(path)) throw blockedWriteError();
    return (await request("DELETE", path)).body;
  }

  /** RTDB o'zi kalit yasaydi (push id).
   *  Himoyalangan tugunlar (catalog, slots, bookings, biled_orders,
   *  pending_orders) push orqali HAM to'g'ridan yozilmaydi — aks holda
   *  imzolangan Worker endpointi jimgina chetlab o'tilardi (item 9). */
  async function push(path, value) {
    if (protectedWrite(path)) throw blockedWriteError();
    var out = (await request("POST", path, value)).body;
    return out && out.name ? out.name : null;
  }

  /** Server vaqti — mijoz soatiga ISHONMAYMIZ (u xato bo'lishi mumkin). */
  function serverTime() {
    return { ".sv": "timestamp" };
  }

  /** Atomik o'zgartirish (qoldiqni kamaytirish kabi). */
  function increment(by) {
    return { ".sv": { increment: by } };
  }

  /* ------------------------------------------------- id berish (Worker CAS)
     Sanoqchi ham public yozilmaydi. Worker admin imzosini tekshiradi va
     ETag/If-Match bilan oshiradi; direct Firebase fallback yo'q.
     -------------------------------------------------------------------- */
  async function nextId(counter) {
    var table = {
      products_counter: "products",
      stories_counter: "stories",
      banners_counter: "banners",
      cars_counter: "cars",
    }[counter];
    if (!table) throw new Error("Noma'lum sanoqchi");
    var out = await secureCatalogWrite("allocate", null, null, table);
    return Number(out.id);
  }

  /** Tovar uchun id (`products_counter`). */
  function nextProductId() {
    return nextId("products_counter");
  }

  /** Story uchun id (`stories_counter`).
   *  ALOHIDA sanoqchi: tovar va story id'lari bir-biriga aralashmasligi
   *  kerak — ikkisi ham SQLite'ga ko'chiriladi va o'z jadvalida yashaydi. */
  function nextStoryId() {
    return nextId("stories_counter");
  }

  /** Banner uchun id (`banners_counter`). */
  function nextBannerId() {
    return nextId("banners_counter");
  }

  /** Mashina uchun id (`cars_counter`).
   *
   *  MUHIM — GRATSIOZ TUSHISH. Mashina sanoqchisi Worker'ga keyin qo'shildi
   *  (`CATALOG_COUNTERS`). Cloudflare GitHub'dan O'ZI yangilanmagani uchun
   *  eski Worker turgan bo'lsa `allocate` ni «Sanoqchi ruxsat etilmagan»
   *  (400) bilan rad etadi. Bunday holatda `null` qaytaramiz — chaqiruvchi
   *  (admin-shop.js: saveCar) mavjud ro'yxatdan `max+1` hisoblab, baribir
   *  ishlaydi. Mashina kamdan-kam qo'shilgani uchun bu xavfsiz. Worker
   *  yangilangach — avtomatik ravishda ishonchli sanoqchiga o'tadi. */
  async function nextCarId() {
    try {
      return await nextId("cars_counter");
    } catch (err) {
      var code = String((err && err.code) || "");
      var msg = String((err && err.message) || "");
      if (code.indexOf("http_4") === 0 || /sanoqchi|counter|ruxsat/i.test(msg)) {
        return null;
      }
      throw err;
    }
  }

  return {
    available: available,
    get: get,
    put: put,
    patch: patch,
    post: push,
    remove: remove,
    serverTime: serverTime,
    increment: increment,
    nextProductId: nextProductId,
    nextStoryId: nextStoryId,
    nextBannerId: nextBannerId,
    nextCarId: nextCarId,
    ID_BASE: ID_BASE,
    _url: url,
  };
})();
