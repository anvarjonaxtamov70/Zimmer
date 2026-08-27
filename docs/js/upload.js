/* ==========================================================================
   ZIMMER — TELEFON GALEREYASIDAN RASM YUKLASH

   NEGA FIREBASE STORAGE EMAS?
   Firebase Cloud Storage 2026-yil 3-fevraldan boshlab pullik Blaze tarifini
   TALAB QILADI (standart `*.appspot.com` bucket ham). Bepul Spark tarifida
   bucket'ga kirish yo'qoladi. Shu sababli bot tomonidagi Storage yuklash
   jimgina `file_id` ga qaytadi va rasm ko'rsatish uchun Render yoki Worker
   proksisi kerak bo'lib qoladi.

   Shuning uchun Avto_A1 dagi yo'l tanlandi: ImgBB. U bepul, brauzerdan
   to'g'ridan ishlaydi va DOIMIY to'g'ridan havola beradi — ya'ni rasm
   Render'ga ham, Worker'ga ham, Firebase Storage'ga ham bog'liq bo'lmaydi.

   AVTO_A1 DAN FARQI — ikkita muhim yaxshilanish:

   1. QURILMADA SIQISH. Avto_A1 telefondagi rasmni O'ZGARTIRMASDAN yuklaydi
      (3-8 MB). Natijada yuklash sekin, mobil internet ko'p ketadi va
      keyinchalik har ko'rsatishda shu og'ir fayl tortiladi (Avto_A1 buni
      `images.weserv.nl` CDN proksisi bilan yamaydi). Bizda rasm avval
      `canvas` bilan kichraytiriladi va JPEG'ga siqiladi — odatda 3-8 MB
      dan ~150-350 KB ga tushadi.

   2. EXIF BURILISHI. Telefonda tik holatda olingan rasm EXIF belgisi bilan
      keladi. Oddiy `canvas` bu belgini e'tiborsiz qoldiradi va rasm
      YONBOSHLAB ketadi. `createImageBitmap(..., {imageOrientation:
      "from-image"})` bilan burilish to'g'ri qo'llanadi.
   ========================================================================== */

window.ZimmerUpload = (function () {
  "use strict";

  var CFG = window.ZIMMER_CONFIG || {};
  var IMGBB_KEY = (CFG.IMGBB_KEY || "").trim();

  /** Uzun tomoni shu o'lchamdan oshmaydi. Karta ~180px, to'liq ekran
   *  ~1080px — 1600 zaxira bilan yetadi va sifat sezilmaydi. */
  var MAX_SIDE = 1600;
  var JPEG_QUALITY = 0.82;
  /** Siqilgandan keyin ham shundan katta bo'lsa — rad etamiz (ImgBB 32 MB
   *  qabul qiladi, lekin bunday fayl deyarli har doim xato belgisi). */
  var MAX_BYTES = 8 * 1024 * 1024;

  function available() {
    return !!IMGBB_KEY;
  }

  function err(code, message) {
    var e = new Error(message);
    e.code = code;
    return e;
  }

  /* ------------------------------------------------------------ siqish */

  /** Faylni `ImageBitmap` ga aylantiradi, EXIF burilishini QO'LLAB. */
  async function toBitmap(file) {
    if (typeof createImageBitmap === "function") {
      try {
        return await createImageBitmap(file, { imageOrientation: "from-image" });
      } catch (_) {
        // Ba'zi brauzerlar `imageOrientation` ni bilmaydi — belgisiz urinamiz
        try {
          return await createImageBitmap(file);
        } catch (_) {}
      }
    }
    // Eng eski zaxira: <img> orqali
    return await new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        URL.revokeObjectURL(url);
        resolve(img);
      };
      img.onerror = function () {
        URL.revokeObjectURL(url);
        reject(err("decode", "Rasmni o'qib bo'lmadi"));
      };
      img.src = url;
    });
  }

  /**
   * Rasmni kichraytirib JPEG base64 qaytaradi (prefiksisiz).
   * Telefon rasmi 3-8 MB dan ~150-350 KB ga tushadi.
   */
  async function compress(file) {
    if (!file) throw err("no_file", "Fayl tanlanmadi");
    if (!/^image\//.test(file.type || "")) {
      throw err("not_image", "Bu rasm fayli emas");
    }

    var bmp = await toBitmap(file);
    var w = bmp.width || bmp.naturalWidth;
    var h = bmp.height || bmp.naturalHeight;
    if (!w || !h) throw err("decode", "Rasm o'lchami aniqlanmadi");

    var scale = Math.min(1, MAX_SIDE / Math.max(w, h));
    var tw = Math.max(1, Math.round(w * scale));
    var th = Math.max(1, Math.round(h * scale));

    var canvas = document.createElement("canvas");
    canvas.width = tw;
    canvas.height = th;
    var ctx = canvas.getContext("2d");
    // Shaffof PNG JPEG'da qora bo'lib chiqadi — oq fon qo'yamiz.
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, tw, th);
    ctx.drawImage(bmp, 0, 0, tw, th);
    if (bmp.close) bmp.close();

    var dataUrl = canvas.toDataURL("image/jpeg", JPEG_QUALITY);
    var base64 = dataUrl.split(",")[1] || "";
    if (!base64) throw err("encode", "Rasm siqilmadi");

    // base64 hajmi ~ 4/3 * bayt
    var bytes = Math.round((base64.length * 3) / 4);
    if (bytes > MAX_BYTES) throw err("too_big", "Rasm juda katta");

    return { base64: base64, bytes: bytes, width: tw, height: th };
  }

  /* ------------------------------------------------------------ yuklash */

  /**
   * ImgBB'ga yuklaydi. `onProgress(0..100)` chaqiriladi.
   * XHR ishlatiladi — `fetch` yuklash jarayonini bermaydi.
   */
  function uploadBase64(base64, onProgress) {
    return new Promise(function (resolve, reject) {
      if (!IMGBB_KEY) {
        return reject(
          err(
            "no_key",
            "Rasm yuklash sozlanmagan (config.js -> IMGBB_KEY)"
          )
        );
      }

      var fd = new FormData();
      fd.append("key", IMGBB_KEY);
      fd.append("image", base64);

      var xhr = new XMLHttpRequest();
      xhr.open("POST", "https://api.imgbb.com/1/upload");
      xhr.timeout = 120000;

      if (xhr.upload && onProgress) {
        xhr.upload.onprogress = function (e) {
          if (e.lengthComputable) {
            onProgress(Math.round((e.loaded / e.total) * 100));
          }
        };
      }

      xhr.onload = function () {
        var body = null;
        try {
          body = JSON.parse(xhr.responseText);
        } catch (_) {}

        if (!body || body.success !== true || !body.data || !body.data.url) {
          var reason =
            (body && body.error && body.error.message) ||
            "ImgBB rad etdi (" + xhr.status + ")";
          // 400 + "Invalid API v1 key" -> kalit xato
          if (/api\s*v1\s*key|invalid key/i.test(reason)) {
            return reject(err("bad_key", "ImgBB kaliti xato"));
          }
          return reject(err("rejected", reason));
        }
        resolve(String(body.data.url));
      };

      xhr.onerror = function () {
        reject(err("network", "Internetga ulanmadi"));
      };
      xhr.ontimeout = function () {
        reject(err("timeout", "Yuklash juda uzoq davom etdi"));
      };

      xhr.send(fd);
    });
  }

  /**
   * Bitta faylni siqib yuklaydi va havolani qaytaradi.
   * `onProgress(pct, faza)` — faza: "siqish" | "yuklash"
   */
  async function uploadFile(file, onProgress) {
    var report = onProgress || function () {};
    report(0, "siqish");
    var out = await compress(file);
    report(0, "yuklash");
    var url = await uploadBase64(out.base64, function (pct) {
      report(pct, "yuklash");
    });
    report(100, "yuklash");
    return { url: url, bytes: out.bytes, width: out.width, height: out.height };
  }

  return {
    available: available,
    compress: compress,
    uploadBase64: uploadBase64,
    uploadFile: uploadFile,
    MAX_SIDE: MAX_SIDE,
    MAX_BYTES: MAX_BYTES,
  };
})();
