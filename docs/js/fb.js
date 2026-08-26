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

  /** Brauzer bergan id'lar shu raqamdan boshlanadi (SQLite bilan urishmasin). */
  var ID_BASE = 900000;

  function available() {
    return !!DB;
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

  /* ------------------------------------------------------- asosiy amallar */

  async function get(path) {
    return (await request("GET", path)).body;
  }

  async function put(path, value) {
    return (await request("PUT", path, value)).body;
  }

  async function patch(path, value) {
    return (await request("PATCH", path, value)).body;
  }

  async function remove(path) {
    return (await request("DELETE", path)).body;
  }

  /** RTDB o'zi kalit yasaydi (push id). */
  async function push(path, value) {
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

  /* ------------------------------------------------- id berish (ETag CAS)
     Sanoqchini o'qib, ETag bilan qaytarib yozamiz. Oradа boshqa admin
     o'zgartirgan bo'lsa Firebase 412 qaytaradi va qaytadan urinamiz.
     Shu sababli ikki admin bir vaqtda tovar qo'shsa ham id'lar har xil.
     -------------------------------------------------------------------- */
  async function nextProductId() {
    for (var attempt = 0; attempt < 6; attempt++) {
      var cur = await request("GET", "products_counter/n", undefined, {
        "X-Firebase-ETag": "true",
      });

      var value = Number(cur.body);
      if (!Number.isFinite(value) || value < ID_BASE) value = ID_BASE;
      var next = value + 1;

      try {
        await request("PUT", "products_counter/n", next, {
          "if-match": cur.etag || "null_etag",
        });
        return next;
      } catch (err) {
        // 412 — oradа boshqa admin oshirgan. Qaytadan urinamiz.
        if (err.status !== 412) throw err;
      }
    }
    // Juda kam uchraydigan holat: 6 marta ham o'tmadi. Vaqt asosida
    // id beramiz — takrorlanish ehtimoli amalda nolga teng.
    return ID_BASE + (Date.now() % 1000000);
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
    ID_BASE: ID_BASE,
    _url: url,
  };
})();
