/* ==========================================================================
   ZIMMER — OFFLINE (zaxira) REJIM

   MUAMMO
   Mini App'ning HAR BIR ekrani Render'dagi API'ga (`/api/*`) bog'langan edi.
   Render bepul tarifda uxlaydi yoki kvota tugasa butunlay to'xtaydi — o'sha
   payt ilova "Server javob bermadi" ekranida qotib qolardi. Ya'ni do'kon
   umuman ochilmasdi.

   Avto_A1 da bunday emas: uning ilovasi Firebase'ni TO'G'RIDAN-TO'G'RI
   o'qiydi, Render esa faqat botni ishlatadi. Shuning uchun bot o'chsa ham
   do'kon ishlaydi.

   YECHIM
   Zimmer boti allaqachon butun katalogni Firebase'ga ko'chirib turadi
   (`services/sync.py` -> `{root}/catalog/{jadval}/{id}`). Demak ma'lumot
   BULUTDA MAVJUD — faqat brauzer uni o'qiy olmasdi.

   Bu modul Firebase RTDB'ning REST interfeysidan katalogni o'qiydi va
   `/api/home` javobining AYNAN SHAKLIDA qaytaradi. Shu sababli
   `renderCatalog()`, `renderBanners()`, stories — hech biri o'zgarmaydi.

   NEGA firebase SDK EMAS?
   Bizga faqat O'QISH kerak. SDK ~300 KB qo'shadi va autentifikatsiya
   talab qiladi. Oddiy `fetch` bilan bitta GET yetarli — ilova og'irlashmaydi.

   CHEKLOVLAR (ataylab)
   • Faqat O'QISH. Buyurtma/navbat serverni talab qiladi (ombor kamaytirish,
     adminga xabar) — ular offline'da bloklanadi va mijozga aniq aytiladi.
   • Telegram `file_id` bilan saqlangan rasmlar ko'rinmaydi: ularni faqat
     Render'dagi `/api/media/...` proksisi bera oladi. Tashqi URL'li
     (Firebase Storage) rasmlar normal ko'rinadi.
   ========================================================================== */

(function () {
  "use strict";

  var CFG = window.ZIMMER_CONFIG || {};
  var DB = (CFG.FIREBASE_DB_URL || "").replace(/\/$/, "");
  var ROOT = (CFG.FIREBASE_ROOT || "zimmer").replace(/^\/|\/$/g, "");
  var CURRENCY = CFG.CURRENCY || "so'm";
  // Cloudflare Worker — Render o'chganda buyurtma, profil va rasm proksisi
  var WORKER = (CFG.WORKER_URL || "").replace(/\/$/, "");

  /* Stories halqalari KODDA belgilanadi — `utils/stories.py` dagi
     STORY_CATEGORIES bilan bir xil bo'lishi SHART. Aks holda offline'da
     halqalar boshqacha ko'rinadi. */
  var STORY_RINGS = [
    ["aksiyalar", "Aksiyalar", "🔥", "#ff2d3a", "#6d0a10"],
    ["bugun", "Bugun", "⚡️", "#ff6b3d", "#3a0f00"],
    ["mijozlar", "Mijozlar", "💬", "#e01020", "#2a0006"],
    ["natijalar", "Natijalar", "🏆", "#ff4b3e", "#1a0508"],
    ["kafolat", "Kafolat", "🛡", "#c1121f", "#101215"],
    ["lokatsiya", "Manzil", "📍", "#ff8f3d", "#2b1200"],
    ["tolov", "To'lov", "💳", "#ff2d55", "#25040c"],
    ["aloqa", "Aloqa", "📞", "#ff5f6d", "#20060a"],
  ];

  /* ------------------------------------------------------------------
     3-QATLAM: MAHALLIY KESH

     Firebase ham javob bermasligi mumkin (qoidalar hali qo'yilmagan,
     internet yo'q, baza manzili xato). O'sha holatda ham BIR MARTA
     muvaffaqiyatli kirgan mijoz do'konni ko'rishi kerak — aks holda u
     to'siq ekranini ko'radi va bu juda yoqimsiz.

     Shuning uchun har muvaffaqiyatli yuklashdan keyin katalog
     localStorage'ga yoziladi va oxirgi chora sifatida shu ishlatiladi.
     ------------------------------------------------------------------ */
  var CACHE_KEY = "zimmer_home_cache";
  var CACHE_MAX_AGE = 30 * 24 * 3600 * 1000; // 30 kun

  /* ------------------------------------------------------------------
     4-QATLAM: STATIK NUSXA (catalog.json)

     Kesh ham bo'sh bo'lishi mumkin — mijoz ilovaga BIRINCHI MARTA
     kirganda. Aynan shu holat 2026-08-26 da yuz berdi:
        Render  -> 503 (bepul kvota tugagan)
        Firebase-> 401 (qoidalar hali Console'ga qo'yilmagan)
        kesh    -> bo'sh (birinchi kirish)
     Natijada mijoz «Ulanish yo'q» devoriga urildi.

     `catalog.json` ilovaning O'ZI bilan BIR MANZILDAN (GitHub Pages)
     beriladi. Shuning uchun u:
        • Render'ga bog'liq emas;
        • Firebase'ga bog'liq emas (so'rov paytida);
        • qoidalar talab qilmaydi;
        • CORS muammosi bermaydi;
        • birinchi kirishda ham ishlaydi.

     Fayl `scripts/build_catalog_snapshot.py` bilan yasaladi; workflow uni
     Firebase'dan (ochiq bo'lganda) yangilab turadi.
     ------------------------------------------------------------------ */
  var SNAPSHOT_URL = "catalog.json";
  var _snapshot; // undefined = hali so'ralmagan, null = yo'q

  async function snapshot() {
    if (_snapshot !== undefined) return _snapshot;
    try {
      // Nisbiy manzil — ilova qaysi papkada bo'lsa, fayl ham shu yerda.
      var res = await fetch(SNAPSHOT_URL, { cache: "no-cache" });
      if (!res.ok) throw new Error("catalog.json -> " + res.status);
      var data = await res.json();
      if (!data || !data.catalog || !data.catalog.length) throw new Error("bo'sh");
      data._offline = true;
      _snapshot = data;
    } catch (err) {
      console.error("[offline] statik nusxa o'qilmadi:", err);
      _snapshot = null;
    }
    return _snapshot;
  }

  function available() {
    return !!DB;
  }

  /** Muvaffaqiyatli yuklangan katalogni keshga yozadi. */
  function save(home) {
    if (!home || !home.catalog || !home.catalog.length) return;
    try {
      localStorage.setItem(
        CACHE_KEY,
        JSON.stringify({ at: Date.now(), home: home })
      );
    } catch (_) {
      // Kvota tugagan bo'lishi mumkin — kesh ixtiyoriy, e'tibor bermaymiz
    }
  }

  /** Keshdagi katalog (yoki null). Juda eski bo'lsa ishlatilmaydi. */
  function cached() {
    try {
      var raw = JSON.parse(localStorage.getItem(CACHE_KEY) || "null");
      if (!raw || !raw.home || !raw.home.catalog) return null;
      if (Date.now() - (raw.at || 0) > CACHE_MAX_AGE) return null;
      var home = raw.home;
      home._offline = true;
      home._cached = true;
      home._cachedAt = raw.at;
      return home;
    } catch (_) {
      return null;
    }
  }

  /** Kesh, bo'lmasa statik nusxa. Kesh ustuvor: u JONLI serverdan kelgan. */
  async function cachedOrSnapshot() {
    return cached() || (await snapshot());
  }

  async function cachedOrSnapshotCars() {
    var list = cachedCars();
    if (list.length) return list;
    var snap = await snapshot();
    return (snap && snap.cars) || [];
  }

  /** Ko'rsatishga ARZIYDIGAN ma'lumot bormi? (kesh yoki statik nusxa) */
  async function hasAnyData() {
    return !!(await cachedOrSnapshot());
  }

  function hasCache() {
    return !!cached();
  }

  /** `{root}/catalog/{jadval}` tugunini o'qiydi. Xato bo'lsa null. */
  async function readNode(table) {
    var url = DB + "/" + ROOT + "/catalog/" + table + ".json";
    var res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error("Firebase " + table + " -> " + res.status);
    return await res.json();
  }

  /** RTDB tuguni dict yoki massiv bo'lishi mumkin — ikkisini ham tekislaydi. */
  function rows(node) {
    if (!node) return [];
    var out = [];
    if (Array.isArray(node)) {
      node.forEach(function (v) {
        if (v && typeof v === "object") out.push(v);
      });
    } else if (typeof node === "object") {
      Object.keys(node).forEach(function (k) {
        var v = node[k];
        if (v && typeof v === "object") {
          if (v.id === undefined) v.id = isNaN(+k) ? k : +k;
          out.push(v);
        }
      });
    }
    // O'chirilgan va nofaol yozuvlar ko'rinmasin
    return out.filter(function (r) {
      return !r.deleted && r.is_active !== 0 && r.is_active !== false;
    });
  }

  /** `utils/helpers.py:fmt_price` bilan AYNAN bir xil: 120000 -> "120 000 so'm"
   *
   *  DIQQAT: `toLocaleString("ru-RU")` ishlatilmaydi — u ajratgich sifatida
   *  ODDIY BO'SHLIQ emas, UZILMAS BO'SHLIQ (U+00A0) qo'yadi. Server esa
   *  `f"{n:,}".replace(",", " ")` bilan oddiy bo'shliq beradi. Ko'z bilan
   *  farq sezilmaydi, lekin matn taqqoslash va qidirishda ular boshqa-boshqa
   *  satr bo'lib qoladi. Shuning uchun qo'lda guruhlaymiz.
   */
  function priceLabel(v) {
    var n = Math.round(Number(v) || 0);
    var sign = n < 0 ? "-" : "";
    var digits = String(Math.abs(n)).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
    return sign + digits + " " + CURRENCY;
  }

  function externalUrl(raw) {
    var s = (raw == null ? "" : String(raw)).trim();
    return /^https?:\/\//.test(s) ? s : null;
  }

  /** Telegram `file_id` ni Worker media proksisining manziliga aylantiradi.
   *
   *  Ilgari `file_id` bilan saqlangan rasmlar zaxira rejimda UMUMAN
   *  ko'rinmasdi: ularni faqat bot tokeni bilan ochish mumkin, ya'ni
   *  Render'dagi `/api/media/...` proksisi kerak edi. Worker o'sha ishni
   *  bajaradi va u uxlamaydi — shuning uchun endi ESKI rasmlar ham
   *  Render'siz ko'rinadi.
   */
  function mediaUrl(fileId) {
    var id = (fileId == null ? "" : String(fileId)).trim();
    if (!id || !WORKER) return null;
    return WORKER + "/media?id=" + encodeURIComponent(id);
  }

  /** Rasm manzili: avval tashqi URL, bo'lmasa Worker orqali `file_id`. */
  function photo(urlValue, fileId) {
    return externalUrl(urlValue) || mediaUrl(fileId);
  }

  /** SQLite qatorini `/api/home` dagi mahsulot shakliga keltiradi. */
  function toProduct(r) {
    var images = [
      photo(r.photo_url, r.photo_id),
      photo(r.photo2_url, r.photo2_id),
      photo(r.photo3_url, r.photo3_id),
    ].filter(Boolean);

    return {
      id: r.id,
      name: r.name || "",
      description: r.description || null,
      price: Number(r.price) || 0,
      old_price: r.old_price ? Number(r.old_price) : null,
      badge: r.badge || null,
      stock: Number(r.stock) || 0,
      car_id: r.car_id == null ? null : r.car_id,
      price_label: priceLabel(r.price),
      old_price_label: r.old_price ? priceLabel(r.old_price) : null,
      photo_url: images[0] || null,
      photo_external: !!images[0],
      video_url: photo(r.video_url, r.video_id),
      video_external: true,
      has_media: !!images[0],
      images: images,
      _offline: true,
    };
  }

  function toBanner(r) {
    var pic = photo(r.photo_url, r.photo_id);
    return {
      id: r.id,
      title: r.title || "",
      subtitle: r.subtitle || "",
      tag: r.tag || "",
      color_from: r.color_from || "#c1121f",
      color_to: r.color_to || "#101215",
      photo_url: pic,
      photo_external: !!pic,
      video_url: photo(r.video_url, r.video_id),
      video_external: true,
      has_media: !!pic,
    };
  }

  /** Stories'ni halqalarga guruhlaydi (`/api/home` dagi tuzilish). */
  function toStoryRings(storyRows) {
    return STORY_RINGS.map(function (def) {
      var key = def[0];
      var items = storyRows
        .filter(function (r) {
          return String(r.category || "bugun") === key;
        })
        .sort(function (a, b) {
          return (a.sort || 0) - (b.sort || 0) || (a.id || 0) - (b.id || 0);
        })
        .map(function (r) {
          var pic = photo(r.photo_url, r.photo_id);
          return {
            id: r.id,
            heading: r.heading || r.title || "",
            body: r.body || "",
            emoji: r.emoji || def[2],
            color_from: r.color_from || def[3],
            color_to: r.color_to || def[4],
            photo_url: pic,
            photo_external: !!pic,
            video_url: photo(r.video_url, r.video_id),
            video_external: true,
            has_media: !!pic,
          };
        });

      return {
        key: key,
        title: def[1],
        emoji: def[2],
        color_from: def[3],
        color_to: def[4],
        count: items.length,
        items: items,
      };
    }).filter(function (ring) {
      return ring.count > 0;
    });
  }

  /**
   * `/api/home` javobining zaxira nusxasi.
   * Katalog o'qilmasa null qaytaradi (chaqiruvchi asl xatoni ko'rsatadi).
   */
  async function home() {
    // Firebase sozlanmagan bo'lsa — to'g'ridan keshga
    if (!available()) return (await cachedOrSnapshot());

    var products, categories, banners, stories;
    try {
      // Mahsulot va kategoriya MAJBURIY — do'kon shulardan iborat.
      var pair = await Promise.all([readNode("products"), readNode("categories")]);
      products = rows(pair[0]);
      categories = rows(pair[1]);
    } catch (err) {
      // Eng ko'p uchraydigan sabab: `database.rules.json` hali Firebase
      // Console'ga qo'yilmagan, shuning uchun o'qish rad etiladi (401/403).
      console.error("[offline] Firebase katalogi o'qilmadi:", err);
      return await cachedOrSnapshot();
    }

    if (!products.length) {
      console.warn("[offline] Firebase'da mahsulot yo'q — keshga o'tilyapti.");
      return await cachedOrSnapshot();
    }

    // Bannerlar va stories — ixtiyoriy, yiqilsa e'tibor bermaymiz.
    try {
      banners = rows(await readNode("banners"));
    } catch (_) {
      banners = [];
    }
    try {
      stories = rows(await readNode("stories"));
    } catch (_) {
      stories = [];
    }

    // Mahsulotlarni kategoriyalarga taqsimlaymiz. Bulutda bog'lanish NOM
    // bilan saqlanadi (`categoryName`) — ID'lar deploy orasida o'zgargani uchun.
    var byName = {};
    categories.forEach(function (c) {
      byName[String(c.name || c._key || "").toLowerCase()] = c;
    });

    var groups = [];
    var index = {};
    function bucket(cat) {
      var key = String(cat.name || cat._key || "Mahsulotlar");
      if (!index[key]) {
        index[key] = {
          id: cat.id != null ? cat.id : key,
          name: key,
          icon: cat.icon || null,
          products: [],
        };
        groups.push(index[key]);
      }
      return index[key];
    }

    products
      .sort(function (a, b) {
        return (b.id || 0) - (a.id || 0);
      })
      .forEach(function (r) {
        var name = String(r.categoryName || r._categoryName || "").toLowerCase();
        var cat = byName[name] || categories[0] || { name: "Mahsulotlar" };
        bucket(cat).products.push(toProduct(r));
      });

    return {
      car_id: null,
      banners: banners.sort(function (a, b) {
        return (a.sort || 0) - (b.sort || 0);
      }).map(toBanner),
      stories: toStoryRings(stories),
      catalog: groups.filter(function (g) {
        return g.products.length > 0;
      }),
      // Saqlanganlar serverda turadi; offline'da mahalliy nusxa ishlatiladi.
      favorite_ids: [],
      _offline: true,
    };
  }

  /* Mashinalar alohida keshlanadi: ular `/api/home` javobiga kirmaydi,
     lekin konfigurator va «mashinamga mos» filtri uchun kerak. */
  var CARS_KEY = "zimmer_cars_cache";

  function saveCars(list) {
    if (!list || !list.length) return;
    try {
      localStorage.setItem(CARS_KEY, JSON.stringify({ at: Date.now(), cars: list }));
    } catch (_) {}
  }

  function cachedCars() {
    try {
      var raw = JSON.parse(localStorage.getItem(CARS_KEY) || "null");
      if (!raw || !Array.isArray(raw.cars)) return [];
      if (Date.now() - (raw.at || 0) > CACHE_MAX_AGE) return [];
      return raw.cars;
    } catch (_) {
      return [];
    }
  }

  /** Mashinalar ro'yxati (`/api/cars` ning zaxirasi). */
  async function cars() {
    if (!available()) return await cachedOrSnapshotCars();
    try {
      var list = rows(await readNode("cars"))
        .sort(function (a, b) {
          return (a.sort || 0) - (b.sort || 0);
        })
        .map(function (r) {
          var pic = photo(r.photo_url, r.photo_id);
          return {
            id: r.id,
            name: r.name || "",
            years: r.years || null,
            note: r.note || null,
            photo_url: pic,
            has_media: !!pic,
          };
        });
      return list.length ? list : await cachedOrSnapshotCars();
    } catch (err) {
      console.error("[offline] mashinalar o'qilmadi — keshga o'tilyapti:", err);
      return await cachedOrSnapshotCars();
    }
  }

  /** SQLite qatorini `/api/tuning` dagi linza shakliga keltiradi. */
  function toBiled(r) {
    var pic = photo(r.photo_url, r.photo_id);
    return {
      id: r.id,
      name: r.name || "",
      brand: r.brand || null,
      size: r.size || null,
      kelvin: r.kelvin || null,
      lumen: r.lumen || null,
      warranty: r.warranty || null,
      description: r.description || null,
      price: Number(r.price) || 0,
      price_label: priceLabel(r.price),
      badge: r.badge || null,
      glow: r.glow || null,
      photo_url: pic,
      photo_external: !!pic,
      video_url: photo(r.video_url, r.video_id),
      video_external: true,
      has_media: !!pic,
    };
  }

  function toShroud(r) {
    var pic = photo(r.photo_url, r.photo_id);
    return {
      id: r.id,
      name: r.name || "",
      style: r.style || null,
      ring_color: r.ring_color || null,
      description: r.description || null,
      price: Number(r.price) || 0,
      price_label: priceLabel(r.price),
      photo_url: pic,
      photo_external: !!pic,
      video_url: photo(r.video_url, r.video_id),
      video_external: true,
      has_media: !!pic,
    };
  }

  function toColor(r) {
    var pic = photo(r.photo_url, r.photo_id);
    return {
      id: r.id,
      name: r.name || "",
      hex_from: r.hex_from || null,
      hex_to: r.hex_to || null,
      description: r.description || null,
      price: Number(r.price) || 0,
      price_label: priceLabel(r.price),
      photo_url: pic,
      photo_external: !!pic,
      video_url: photo(r.video_url, r.video_id),
      video_external: true,
      has_media: !!pic,
    };
  }

  /** `/api/tuning` zaxirasi — konfigurator variantlari.
   *
   *  MUHIM: `biled_types`, `shrouds`, `optic_colors` jadvallari ALLAQACHON
   *  bulutga ko'chiriladi (`database/queries.py: CATALOG_KEY` da bor,
   *  `services/sync.py: push_all_catalog` ularni yuboradi). Ya'ni ma'lumot
   *  bor edi — shu paytgacha faqat frontend uni O'QIMASDI va konfigurator
   *  Render'siz ishlamasdi. Backendga o'zgartirish KERAK EMAS.
   */
  async function tuning() {
    try {
      var three = await Promise.all([
        readNode("biled_types"),
        readNode("shrouds"),
        readNode("optic_colors"),
      ]);
      var out = {
        biled_types: rows(three[0]).map(toBiled),
        shrouds: rows(three[1]).map(toShroud),
        colors: rows(three[2]).map(toColor),
      };
      // Linzalar bo'lmasa konfigurator ma'nosiz — keshga tayanamiz.
      if (out.biled_types.length) {
        saveBlob(TUNING_KEY, out);
        return out;
      }
      return cachedOr(TUNING_KEY, out);
    } catch (err) {
      console.error("[offline] tuning o'qilmadi — keshga o'tilyapti:", err);
      return cachedOr(TUNING_KEY, { biled_types: [], shrouds: [], colors: [] });
    }
  }

  /** `/api/services` zaxirasi — navbat uchun xizmatlar.
   *  `services` jadvali ham bulutga ko'chiriladi (CATALOG_KEY da bor). */
  async function services() {
    try {
      var list = rows(await readNode("services")).map(function (r) {
        return {
          id: r.id,
          name: r.name || "",
          duration_min: Number(r.duration_min) || 0,
          price: Number(r.price) || 0,
          price_label: priceLabel(r.price),
        };
      });
      if (list.length) {
        saveBlob(SERVICES_KEY, list);
        return list;
      }
      return cachedOr(SERVICES_KEY, list);
    } catch (err) {
      console.error("[offline] xizmatlar o'qilmadi — keshga o'tilyapti:", err);
      return cachedOr(SERVICES_KEY, []);
    }
  }

  /* ---- Umumiy kesh (bosh sahifa keshi alohida — u `save`/`cached`) ----
     Firebase ham o'qilmagan holat uchun: mijoz ilgari ko'rgan variantlar
     saqlanib qoladi, ya'ni konfigurator butunlay bo'sh chiqmaydi. */
  var TUNING_KEY = "zimmer_tuning_cache";
  var SERVICES_KEY = "zimmer_services_cache";
  var BLOB_MAX_AGE = 30 * 24 * 3600 * 1000; // 30 kun

  function saveBlob(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify({ at: Date.now(), v: value }));
    } catch (_) {
      // Kvota tugagan bo'lishi mumkin — kesh ixtiyoriy
    }
  }

  function readBlob(key) {
    try {
      var raw = JSON.parse(localStorage.getItem(key) || "null");
      if (!raw || raw.v == null) return null;
      if (Date.now() - (raw.at || 0) > BLOB_MAX_AGE) return null;
      return raw.v;
    } catch (_) {
      return null;
    }
  }

  /** Keshda saqlangan nusxa bo'lsa uni, aks holda berilgan zaxirani qaytaradi. */
  function cachedOr(key, fallback) {
    var hit = readBlob(key);
    return hit || fallback;
  }

  /* ==================================================================
     WORKER — Render o'chganda buyurtma va profil

     Cloudflare Worker uxlamaydi va bepul. U service-account tokeni
     bilan Firebase'ga yozadi, shuning uchun brauzerga RTDB huquqi
     berish KERAK EMAS (Avto_A1 da beriladi va natijada mijoz soxta
     summa yozib qo'ya oladi).

     Barcha chaqiruvlar `initData` bilan ketadi — Worker imzoni HMAC
     bilan tekshiradi. Xatolar YASHIRILMAYDI, chaqiruvchiga qaytariladi.
     ================================================================== */

  function workerReady() {
    return !!WORKER;
  }

  /** Worker'ning `/health` javobi — versiya va qo'llaydigan amallar ro'yxati.
   *
   *  NEGA KERAK: Cloudflare GitHub'dan O'ZI yangilanmaydi — kod qo'lda
   *  qo'yiladi. Shu sababli repoda yangi endpoint bo'lsa-da, Cloudflare'da
   *  eski nusxa turishi mumkin. O'sha holatda `/admin/catalog` 404 qaytaradi
   *  va foydalanuvchi «Bunday manzil yo'q» degan tushunarsiz xatoni ko'radi.
   *
   *  Bu funksiya `features` ro'yxatini beradi, shunda panel muammoni O'ZI
   *  aniqlab, «Worker eski — yangilash kerak» deb aniq aytadi.
   *
   *  `initData` KERAK EMAS — `/health` maxfiy ma'lumot bermaydi.
   */
  async function workerHealth() {
    if (!WORKER) return null;
    try {
      var res = await fetch(WORKER + "/health", { cache: "no-store" });
      if (!res.ok) return null;
      return await res.json();
    } catch (_) {
      return null;
    }
  }

  /** Worker berilgan amalni qo'llaydimi. Aniqlab bo'lmasa `null`. */
  async function workerSupports(feature) {
    var h = await workerHealth();
    if (!h || !Array.isArray(h.features)) return null;
    return { ok: h.features.indexOf(feature) !== -1, version: h.version || "?" };
  }

  function initData() {
    try {
      return (window.Telegram && window.Telegram.WebApp && window.Telegram.WebApp.initData) || "";
    } catch (_) {
      return "";
    }
  }

  async function callWorker(path, payload) {
    if (!WORKER) throw { code: "no_worker", message: "WORKER_URL sozlanmagan" };
    var data = initData();
    if (!data) throw { code: "no_init_data", message: "Telegram imzosi yo'q" };

    var res;
    try {
      res = await fetch(WORKER + path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(Object.assign({ initData: data }, payload || {})),
      });
    } catch (_) {
      throw { code: "network", message: "Internetga ulanmadi" };
    }

    var body = null;
    try {
      body = await res.json();
    } catch (_) {}

    if (!res.ok || !body || body.ok !== true) {
      throw {
        code: (body && body.error) || "http_" + res.status,
        message: (body && (body.message || body.error)) || "Xatolik",
        problems: body && body.problems,
      };
    }
    return body;
  }

  /** Mijoz profili + buyurtma tarixi (`/api/me` va `/api/orders` zaxirasi). */
  function me() {
    return callWorker("/me", {});
  }

  /** Profilni saqlash — telefon, ism, mashina. */
  function saveProfile(fields) {
    return callWorker("/profile", fields || {});
  }

  /** Buyurtma yaratish. Summa Worker tomonida KATALOGDAN hisoblanadi.
   *  `client_key` — idempotent kalit: ikki marta bosilsa bitta buyurtma. */
  function createOrder(order) {
    return callWorker("/order", order);
  }

  /* ==================================================================
     ADMIN — Render'siz katalog boshqaruvi

     Worker har chaqiruvda imzoni tekshirib, uid ni ADMIN_IDS bilan
     solishtiradi. Ya'ni bu funksiyalarni oddiy mijoz chaqirsa 403
     oladi — himoya brauzerda emas, Worker tomonida.

     Yangi tovar `pending_products` ga tushadi (katalogga EMAS): bot
     katalogni to'liq qayta yozadi, shu sababli to'g'ridan yozilgan
     tovar keyingi sinxronda o'chib ketardi.
     ================================================================== */

  /** Ombor ko'rinishi: katalog + kutilayotgan tuzatishlar + qoralamalar. */
  function adminCatalog() {
    return callWorker("/admin/catalog", {});
  }

  /** Yangi tovar qo'shish. `client_key` — ikki marta bosilsa bitta yozuv. */
  function adminAddProduct(product) {
    return callWorker("/admin/product", product || {});
  }

  /** Mavjud tovarning narx / qoldiq / ko'rinishini o'zgartirish. */
  function adminEdit(fields) {
    return callWorker("/admin/edit", fields || {});
  }

  /** Zaxira rejimda tushgan buyurtmalar. */
  function adminOrders() {
    return callWorker("/admin/orders", {});
  }

  /** Buyurtma holatini o'zgartirish — mijozga xabar Worker yuboradi. */
  function adminOrderStatus(key, status) {
    return callWorker("/admin/order-status", { key: key, status: status });
  }

  window.ZimmerOffline = {
    available: available,
    home: home,
    cars: cars,
    tuning: tuning,
    services: services,
    // Worker
    workerReady: workerReady,
    workerHealth: workerHealth,
    workerSupports: workerSupports,
    me: me,
    saveProfile: saveProfile,
    createOrder: createOrder,
    // Worker — admin
    adminCatalog: adminCatalog,
    adminAddProduct: adminAddProduct,
    adminEdit: adminEdit,
    adminOrders: adminOrders,
    adminOrderStatus: adminOrderStatus,
    mediaUrl: mediaUrl,
    save: save,
    cached: cached,
    hasCache: hasCache,
    hasAnyData: hasAnyData,
    snapshot: snapshot,
    saveCars: saveCars,
  };
})();
