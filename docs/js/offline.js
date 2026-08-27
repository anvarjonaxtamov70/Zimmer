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
      // Nusxa ham filtrlanadi: u kuniga bir marta yasaladi, ya'ni admin
      // o'chirgan tovar ertagacha ichida qolib turishi mumkin.
      pruneHome(data);
      if (!data.catalog.length) throw new Error("bo'sh (hammasi o'chirilgan)");
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

  /** Keshni O'CHIRADI. Admin tovar o'chirgan/qo'shgandan keyin chaqiriladi.
   *
   *  Ilgari `app.state.home = null` qilinardi — u faqat XOTIRADAGI nusxani
   *  tozalardi. localStorage'dagi 30 kunlik kesh joyida qolardi va ilova
   *  qayta ochilganda o'chirilgan tovar YANA ko'rinardi. */
  function clearCache() {
    try {
      localStorage.removeItem(CACHE_KEY);
    } catch (_) {}
  }

  /** Tirik yozuvmi? (`rows()` dagi shart bilan bir xil) */
  function isLive(p) {
    return !!p && !p.deleted && p.is_active !== 0 && p.is_active !== false;
  }

  /** Kesh/statik nusxadagi katalogdan o'chirilgan tovarlarni olib tashlaydi.
   *
   *  Kesh — bu eski `/api/home` javobining aynan nusxasi. U server tomonda
   *  allaqachon filtrlangan, LEKIN o'shandan keyin admin tovar o'chirgan
   *  bo'lishi mumkin. Shu sababli har safar qaytarishdan oldin filtrlaymiz. */
  function pruneHome(home) {
    if (!home || !Array.isArray(home.catalog)) return home;
    home.catalog = home.catalog
      .map(function (group) {
        var copy = {};
        Object.keys(group).forEach(function (k) {
          copy[k] = group[k];
        });
        copy.products = (group.products || []).filter(isLive);
        return copy;
      })
      .filter(function (group) {
        return group.products.length > 0;
      });
    return home;
  }

  /** Keshdagi katalog (yoki null). Juda eski bo'lsa ishlatilmaydi. */
  function cached() {
    try {
      var raw = JSON.parse(localStorage.getItem(CACHE_KEY) || "null");
      if (!raw || !raw.home || !raw.home.catalog) return null;
      if (Date.now() - (raw.at || 0) > CACHE_MAX_AGE) return null;
      var home = pruneHome(raw.home);
      if (!home.catalog.length) return null; // hammasi o'chirilgan — kesh foydasiz
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

  /* ==================================================================
     BIR TOVARNING IKKI NUSXASI (bulutda eski kalit qolgani uchun)

     QANDAY PAYDO BO'LADI
     Mini App tovarni bulutga O'ZI yozadi va kalit sifatida o'z id sini
     qo'yadi (900001 — `docs/js/fb.js: ID_BASE`). Render uyg'onganda
     `services/sync.py: restore_catalog` uni SQLite'ga ko'chiradi, lekin
     `id` ustuni ko'chirilmaydi (`EDITABLE["products"]` da yo'q) — SQLite
     o'zining id sini beradi, masalan 47. So'ng `push_all_catalog` bulutga
     PATCH bilan `47` kalitini QO'SHADI (PATCH ortiqcha kalitni o'chirmaydi).

     Natijada bulutda AYNI tovar ikki kalit ostida turadi (900001 va 47) va
     do'konda IKKI MARTA ko'rinadi. `app.js: buildShopProducts` bunga
     yordam bermaydi — u `id` bo'yicha takrorni tekshiradi, bu ikkisining
     esa id si BOSHQA.

     NEGA BU YERDA HAM TEKSHIRAMIZ
     Asosiy tuzatish server tomonida (eski kalit endi haqiqatan o'chiriladi),
     lekin u faqat Render UYG'ONGANDA ishlaydi. Bepul tarifda Render
     uxlab yotgan bo'lishi mumkin, bulutda esa allaqachon yig'ilib qolgan
     takrorlar bor. Shuning uchun ko'rsatishdan oldin shu yerda ham
     filtrlaymiz — mijoz bir tovarni ikki marta ko'rmaydi.

     QANDAY ANIQLANADI
     Nom + mashina + kategoriya bir xil bo'lsa VA nusxalarning biri server
     makonidan (id < 900000), ikkinchisi Mini App makonidan (id >= 900000)
     bo'lsa — bu bitta tovar. Serverdagisini qoldiramiz: uning id si
     buyurtma, savat va saqlanganlarda ishlatiladi.

     ATAYLAB EHTIYOTKOR: faqat nom bo'yicha birlashtirmaymiz. Bir xil nomli
     tovar turli mashina yoki kategoriya uchun bo'lishi mumkin — u HAQIQATAN
     ikki xil tovar va yashirilishi mumkin emas (yashirsak, sotuvchi
     sababini bilmay tovarini yo'qotardi).
     ================================================================== */
  var MINIAPP_ID_BASE = 900000; // docs/js/fb.js: ID_BASE bilan bir xil

  function twinKey(r) {
    var norm = function (v) {
      return String(v == null ? "" : v).trim().toLowerCase().replace(/\s+/g, " ");
    };
    return [norm(r.name || r._key), norm(r.carName), norm(r.categoryName)].join("|");
  }

  function dropTwins(list) {
    var groups = {};
    var order = [];
    list.forEach(function (r) {
      var k = twinKey(r);
      if (!groups[k]) {
        groups[k] = [];
        order.push(k);
      }
      groups[k].push(r);
    });

    var out = [];
    var hidden = 0;
    order.forEach(function (k) {
      var group = groups[k];
      if (group.length < 2) {
        out.push(group[0]);
        return;
      }
      var server = [];
      var mini = [];
      group.forEach(function (r) {
        var id = Number(r.id);
        if (isFinite(id) && id >= MINIAPP_ID_BASE) mini.push(r);
        else server.push(r);
      });
      // Ikki makonda ham nusxa bor -> Mini App nusxasi eskirgan.
      if (server.length && mini.length) {
        hidden += mini.length;
        server.forEach(function (r) {
          out.push(r);
        });
        return;
      }
      // Aks holda bular haqiqatan boshqa-boshqa tovar — hammasi qoladi.
      group.forEach(function (r) {
        out.push(r);
      });
    });

    if (hidden) {
      console.warn(
        "[offline] " +
          hidden +
          " ta takror tovar yashirildi: bulutda eski kalit qolgan. " +
          "Render uyg'onganda `restore_catalog` uni o'chiradi."
      );
    }
    return out;
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
            /* Story ko'ruvchisi uchun: "qancha vaqt oldin" yozuvi va
               tovarga o'tish havolasi. Ilgari bu maydonlar tashlanib
               ketardi va sarlavhada vaqt ko'rsatib bo'lmasdi. */
            title: r.title || "",
            link: r.link || "",
            createdAt: Number(r.createdAt) || 0,
            updatedAt: Number(r.updatedAt) || 0,
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
  /* ==================================================================
     DIQQAT — O'CHIRILGAN TOVAR QAYTIB KELISHI (tuzatildi)

     Ilgari shu yerda quyidagi qator turardi:

         if (!products.length) return await cachedOrSnapshot();

     Ya'ni «Firebase'da tovar yo'q» -> keshga yoki `catalog.json` ga qayt.
     Admin omborda HAMMA tovarni o'chirsa, `rows()` ularni filtrlaydi va
     tirik tovar 0 bo'lib qoladi -> kod 30 kunlik keshni yoki repodagi
     DEMO (seed) nusxani ko'rsatadi. Natijada admin hammasini o'chirgan,
     lekin bosh menyuda tovarlar (yoki «LED lampa H4» kabi demo tovarlar)
     turaveradi.

     Endi uch holat AJRATILADI:

       1. o'qish YIQILDI (401/403/internet)  -> kesh yoki statik nusxa
          (mijoz to'siq ekranini ko'rmasin — bu zaxiraning asl maqsadi);
       2. tugun UMUMAN yo'q (null)           -> kesh yoki statik nusxa
          (baza hali to'ldirilmagan, birinchi o'rnatish);
       3. tugun BOR, lekin tirik tovar 0     -> DO'KON BO'SH ko'rsatiladi.
          Bu HAQIQAT: admin hammasini o'chirgan. Keshga qaytish — yolg'on.
     ================================================================== */
  async function home(opts) {
    // `strict: true` — kesh va statik nusxaga QAYTMAYDI, faqat Firebase.
    // Onlayn holatda shu rejim ishlatiladi: Firebase o'qilmasa `/api/home`
    // ga o'tish kerak, eski keshni ko'rsatish emas.
    var strict = !!(opts && opts.strict);
    var fallback = function () {
      return strict ? null : cachedOrSnapshot();
    };

    // Firebase sozlanmagan bo'lsa — to'g'ridan keshga
    if (!available()) return await fallback();

    var products, categories, banners, stories, rawProducts, rawCategories;
    try {
      // Mahsulot va kategoriya MAJBURIY — do'kon shulardan iborat.
      var pair = await Promise.all([readNode("products"), readNode("categories")]);
      rawProducts = pair[0];
      rawCategories = pair[1];
    } catch (err) {
      // Eng ko'p uchraydigan sabab: `database.rules.json` hali Firebase
      // Console'ga qo'yilmagan, shuning uchun o'qish rad etiladi (401/403).
      console.error("[offline] Firebase katalogi o'qilmadi:", err);
      return await fallback();
    }

    // 2-holat: tugun umuman yo'q — baza hali to'ldirilmagan.
    if (!rawProducts) {
      console.warn("[offline] Firebase'da `catalog/products` tuguni yo'q — zaxiraga o'tilyapti.");
      return await fallback();
    }

    // Bulutda bir tovarning ikki kaliti qolgan bo'lishi mumkin — bittasini
    // qoldiramiz (izohni `dropTwins` ustida ko'ring).
    products = dropTwins(rows(rawProducts));
    categories = rows(rawCategories);

    // 3-holat: tugun bor, lekin hammasi o'chirilgan/yashirilgan.
    // Pastda `catalog: []` bilan davom etamiz — kesh/nusxaga QAYTMAYMIZ.
    if (!products.length) {
      console.warn("[offline] Tirik tovar yo'q — do'kon BO'SH ko'rsatiladi (o'chirilgan).");
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
     NAVBAT VA BI-LED — bazaga to'g'ridan

     Bo'sh vaqtlarni hisoblash mantig'i `utils/helpers.py` dan AYNAN
     ko'chirilgan (`available_dates`, `free_slots`), shuning uchun brauzer
     va server bir xil natija beradi:
        ish vaqti 09:00–18:00, qadam 30 daqiqa, 7 kun oldinga,
        bugungi kun uchun hozirdan kamida 30 daqiqa keyin.
     ================================================================== */
  var WORK_START_H = 9;
  var WORK_END_H = 18;
  var SLOT_MIN = 30;
  var DAYS_AHEAD = 7;
  var TZ_OFFSET_MIN = 5 * 60; // Asia/Tashkent (config.py: TIMEZONE)

  var WEEKDAYS = ["Dushanba", "Seshanba", "Chorshanba", "Payshanba", "Juma", "Shanba", "Yakshanba"];
  var MONTHS = ["yanvar", "fevral", "mart", "aprel", "may", "iyun",
                "iyul", "avgust", "sentabr", "oktabr", "noyabr", "dekabr"];

  /** Do'kon vaqti (mijoz telefonidagi mintaqaga BOG'LIQ EMAS). */
  function shopNow() {
    var d = new Date();
    return new Date(d.getTime() + (TZ_OFFSET_MIN + d.getTimezoneOffset()) * 60000);
  }

  function isoOf(d) {
    var m = String(d.getMonth() + 1);
    var day = String(d.getDate());
    return d.getFullYear() + "-" + (m.length < 2 ? "0" + m : m) + "-" + (day.length < 2 ? "0" + day : day);
  }

  /** `utils/helpers.py: date_label` bilan bir xil: "12-avgust, Chorshanba" */
  function dateLabel(iso) {
    var p = iso.split("-");
    var d = new Date(+p[0], +p[1] - 1, +p[2]);
    return d.getDate() + "-" + MONTHS[d.getMonth()] + ", " + WEEKDAYS[(d.getDay() + 6) % 7];
  }

  /** `short_date_label`: "Bugun" / "Ertaga" / "12-avg (Chor)" */
  function shortDateLabel(iso) {
    var today = isoOf(shopNow());
    if (iso === today) return "Bugun";
    var t = shopNow();
    t.setDate(t.getDate() + 1);
    if (iso === isoOf(t)) return "Ertaga";
    var p = iso.split("-");
    var d = new Date(+p[0], +p[1] - 1, +p[2]);
    return d.getDate() + "-" + MONTHS[d.getMonth()].slice(0, 3) +
           " (" + WEEKDAYS[(d.getDay() + 6) % 7].slice(0, 3) + ")";
  }

  function availableDates() {
    var out = [];
    var base = shopNow();
    for (var i = 0; i < DAYS_AHEAD; i++) {
      var d = new Date(base.getTime());
      d.setDate(d.getDate() + i);
      out.push(isoOf(d));
    }
    return out;
  }

  function toMinutes(t) {
    var p = String(t).split(":");
    return (+p[0] || 0) * 60 + (+p[1] || 0);
  }
  function toTime(m) {
    var h = Math.floor(m / 60), mm = m % 60;
    return (h < 10 ? "0" + h : h) + ":" + (mm < 10 ? "0" + mm : mm);
  }

  /** `utils/helpers.py: free_slots` ning aynan nusxasi. */
  function freeSlots(iso, durationMin, taken) {
    var workStart = WORK_START_H * 60;
    var workEnd = WORK_END_H * 60;
    var step = Math.max(SLOT_MIN, 5);
    var duration = Math.max(durationMin || 0, step);

    var busy = (taken || []).map(function (x) {
      var s = toMinutes(x[0]);
      return [s, s + Math.max(x[1] || 0, step)];
    });

    var minStart = workStart;
    if (iso === isoOf(shopNow())) {
      var n = shopNow();
      var lead = n.getHours() * 60 + n.getMinutes() + 30;
      minStart = Math.max(minStart, Math.ceil(lead / step) * step);
    }

    var out = [];
    for (var start = workStart; start + duration <= workEnd; start += step) {
      if (start < minStart) continue;
      var clash = busy.some(function (b) {
        return start < b[1] && b[0] < start + duration;
      });
      if (!clash) out.push(toTime(start));
    }
    return out;
  }

  /** Bazadagi band vaqtlar: [["09:30", 60], ...] */
  async function takenSlots(iso) {
    if (!window.ZimmerFB) return [];
    try {
      var node = await window.ZimmerFB.get("bookings");
      if (!node || typeof node !== "object") return [];
      var out = [];
      Object.keys(node).forEach(function (k) {
        var b = node[k];
        if (!b || typeof b !== "object") return;
        if (b.date !== iso) return;
        if (b.status === "cancelled") return;
        out.push([String(b.time || "00:00"), Number(b.duration_min) || SLOT_MIN]);
      });
      return out;
    } catch (_) {
      return [];
    }
  }

  /** `/api/dates` zaxirasi. */
  async function bookingDates(durationMin) {
    var list = availableDates();
    var out = [];
    for (var i = 0; i < list.length; i++) {
      var iso = list[i];
      var slots = freeSlots(iso, durationMin, await takenSlots(iso));
      out.push({
        date: iso,
        label: dateLabel(iso),
        short_label: shortDateLabel(iso),
        free_count: slots.length,
      });
    }
    return out;
  }

  /** `/api/slots` zaxirasi. */
  async function bookingSlots(iso, durationMin) {
    return {
      date: iso,
      label: dateLabel(iso),
      slots: freeSlots(iso, durationMin, await takenSlots(iso)),
    };
  }

  /** Navbatni band qilish. Vaqt bandligini YOZISHDAN OLDIN qayta
   *  tekshiramiz — oradа boshqa mijoz olib qo'ygan bo'lishi mumkin. */
  async function createBooking(payload) {
    var fb = window.ZimmerFB;
    if (!fb) throw { code: "no_db", message: "Baza sozlanmagan" };

    var iso = payload.date;
    var free = freeSlots(iso, payload.duration_min, await takenSlots(iso));
    if (free.indexOf(payload.time) === -1) {
      throw { code: "slot_taken", message: "Bu vaqt band qilingan — boshqasini tanlang" };
    }

    var key = "b_" + payload.uid + "_" + iso.replace(/-/g, "") + "_" + payload.time.replace(":", "");
    await fb.put("bookings/" + key, {
      uid: payload.uid,
      service_id: payload.service_id,
      service_name: payload.service_name || "",
      date: iso,
      time: payload.time,
      duration_min: payload.duration_min || SLOT_MIN,
      price: payload.price || 0,
      name: payload.name || "",
      phone: payload.phone || "",
      status: "new",
      createdAt: Date.now(),
      imported: false,
      source: "miniapp",
    });
    return { booking: { id: key, date: iso, time: payload.time, label: dateLabel(iso) } };
  }

  /** Bi-LED buyurtmasi. */
  async function createBiledOrder(payload) {
    var fb = window.ZimmerFB;
    if (!fb) throw { code: "no_db", message: "Baza sozlanmagan" };

    var key = "bl_" + payload.uid + "_" + Date.now();
    var total =
      (Number(payload.biled_price) || 0) +
      (Number(payload.shroud_price) || 0) +
      (Number(payload.color_price) || 0);

    await fb.put("biled_orders/" + key, {
      uid: payload.uid,
      car_id: payload.car_id || null,
      car_name: payload.car_name || "",
      biled_id: payload.biled_id || null,
      biled_name: payload.biled_name || "",
      shroud_id: payload.shroud_id || null,
      shroud_name: payload.shroud_name || "",
      color_id: payload.color_id || null,
      color_name: payload.color_name || "",
      comment: payload.comment || "",
      total: total,
      name: payload.name || "",
      phone: payload.phone || "",
      status: "new",
      createdAt: Date.now(),
      imported: false,
      source: "miniapp",
    });
    return {
      order: {
        id: key,
        code: "BL-" + String(Date.now()).slice(-6),
        total: total,
        total_label: priceLabel(total),
      },
    };
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

  /** Story'ga javob yuboradi (Instagram'dagi "Reply to story" kabi).
   *
   *  Worker imzoni tekshirib, adminning Telegram'iga QAYSI bo'lim va
   *  QAYSI story ekanini yozib yuboradi, hamda `story_replies` tuguniga
   *  saqlaydi (admin paneli shu yerdan o'qiydi).
   *
   *  Brauzerdan to'g'ridan yuborib bo'lmaydi: bot tokeni Worker'da va
   *  mijozning kim ekani faqat server tomonda ishonchli aniqlanadi. */
  function storyReply(payload) {
    return callWorker("/story-reply", payload);
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

  /** Do'kon buyurtmalari — Worker `pending_orders` VA `orders` ni birlashtirib
   *  beradi (faqat tasdiqlangan admin). Batafsil: cloudflare-worker.js. */
  function adminOrders() {
    return callWorker("/admin/orders", {});
  }

  /* ==================================================================
     MENING BUYURTMALARIM (Worker qabul qilganlari)

     `pending_orders` qoidalarda o'qishga OCHIQ va `uid` bo'yicha
     indekslangan (`database.rules.json`). Shu sababli mijoz o'z
     buyurtmalarini to'g'ridan-to'g'ri o'qiy oladi — Worker ham, Render
     ham kerak bo'lmaydi.

     Bu KERAK, chunki bot Worker buyurtmasini SQLite'ga faqat ishga
     tushganda (yoki 2 daqiqalik tekshiruvda) ko'chiradi. Ya'ni mijoz
     buyurtma bergandan keyin uni `/api/orders` da darhol topmaydi va
     «buyurtmam yo'qoldi» deb o'ylaydi.
     ================================================================== */
  async function myOrders(uid) {
    var id = Number(uid) || 0;
    if (!DB || !id) return [];
    // `orderBy` + `equalTo` — faqat O'Z buyurtmalarini tortadi.
    var url =
      DB +
      "/" +
      ROOT +
      '/pending_orders.json?orderBy="uid"&equalTo=' +
      id +
      "&limitToLast=30";
    var node;
    try {
      var res = await fetch(url, { cache: "no-store" });
      if (!res.ok) throw new Error("pending_orders -> " + res.status);
      node = await res.json();
    } catch (err) {
      console.warn("[offline] buyurtmalar o'qilmadi:", err);
      return [];
    }
    if (!node || typeof node !== "object") return [];

    var out = [];
    Object.keys(node).forEach(function (key) {
      var r = node[key];
      if (!r || typeof r !== "object") return;
      var total = Number(r.total) || 0;
      out.push({
        id: r.code || key, // profil kartochkasida ko'rinadigan belgi
        code: r.code || key,
        sqlite_id: r.sqlite_id || null,
        total: total,
        total_label: priceLabel(total),
        status: r.status || "new",
        items: itemRows(r.items),
        delivery_info: r.delivery_info || "",
        payment_method: r.payment_method || "",
        createdAt: Number(r.createdAt) || 0,
        _worker: true,
      });
    });
    out.sort(function (a, b) {
      return b.createdAt - a.createdAt;
    });
    return out;
  }

  /** `items` ro'yxat yoki lug'at bo'lishi mumkin — ikkisini ham tekislaydi.
   *  RTDB siyrak massivni LUG'AT qilib saqlaydi, shuning uchun ilgari
   *  `Array.isArray()` tekshiruvi tovarlarni jimgina yo'q qilardi. */
  function itemRows(raw) {
    if (!raw || typeof raw !== "object") return [];
    var list = Array.isArray(raw) ? raw : Object.keys(raw).map(function (k) { return raw[k]; });
    return list
      .filter(function (i) { return i && typeof i === "object"; })
      .map(function (i) {
        return {
          product_id: i.product_id == null ? null : i.product_id,
          name: String(i.name || ""),
          price: Number(i.price) || 0,
          qty: Number(i.qty) || 1,
        };
      });
  }

  /** Buyurtma holatini o'zgartirish — mijozga xabar Worker yuboradi.
   *  `kind`   : "order" | "biled" | "booking"
   *  `source` : do'kon buyurtmasi uchun "pending" yoki "db". */
  function adminOrderStatus(key, status, source, kind) {
    return callWorker("/admin/order-status", {
      key: key,
      status: status,
      source: source || "pending",
      kind: kind || "order",
    });
  }

  /* ==================================================================
     BI-LED BUYURTMALARI VA NAVBATLAR (admin panel uchun)

     Bu ikki tugun qoidalarda o'qishga OCHIQ (`database.rules.json`:
     `biled_orders` va `bookings` -> `.read: true`). Shu sababli ularni
     Worker'siz, to'g'ridan o'qiymiz — Worker o'chgan bo'lsa ham admin
     ro'yxatni ko'radi.

     Holatni o'zgartirish esa Worker orqali bo'ladi: mijozga Telegram
     xabarini yuborish uchun bot tokeni kerak, u faqat Worker'da.
     ================================================================== */
  async function adminBiledOrders() {
    return await readOrderNode("biled_orders");
  }

  async function adminBookings() {
    return await readOrderNode("bookings");
  }

  async function readOrderNode(node) {
    if (!DB) return [];
    var url = DB + "/" + ROOT + "/" + node + ".json";
    var raw;
    try {
      var res = await fetch(url, { cache: "no-store" });
      if (!res.ok) throw new Error(node + " -> " + res.status);
      raw = await res.json();
    } catch (err) {
      console.warn("[offline] " + node + " o'qilmadi:", err);
      return [];
    }
    if (!raw || typeof raw !== "object") return [];

    var out = [];
    Object.keys(raw).forEach(function (key) {
      var r = raw[key];
      if (!r || typeof r !== "object") return;
      r._key = key;
      if (r.id === undefined) r.id = isNaN(+key) ? key : +key;
      out.push(r);
    });
    out.sort(function (a, b) {
      return (Number(b.createdAt) || 0) - (Number(a.createdAt) || 0);
    });
    return out;
  }

  window.ZimmerOffline = {
    available: available,
    home: home,
    cars: cars,
    tuning: tuning,
    services: services,
    // Navbat va Bi-LED — bazaga to'g'ridan
    bookingDates: bookingDates,
    bookingSlots: bookingSlots,
    createBooking: createBooking,
    createBiledOrder: createBiledOrder,
    freeSlots: freeSlots,
    dateLabel: dateLabel,
    shortDateLabel: shortDateLabel,
    availableDates: availableDates,
    // Worker
    workerReady: workerReady,
    workerHealth: workerHealth,
    workerSupports: workerSupports,
    me: me,
    saveProfile: saveProfile,
    createOrder: createOrder,
    storyReply: storyReply,
    /** Stories bo'limlari (admin paneli shu ro'yxatdan tanlaydi).
     *  `utils/stories.py: STORY_CATEGORIES` bilan bir xil bo'lishi SHART. */
    storyRings: function () {
      return STORY_RINGS.map(function (d) {
        return { key: d[0], title: d[1], emoji: d[2], color_from: d[3], color_to: d[4] };
      });
    },
    // Worker — admin
    adminCatalog: adminCatalog,
    adminAddProduct: adminAddProduct,
    adminEdit: adminEdit,
    adminOrders: adminOrders,
    adminBiledOrders: adminBiledOrders,
    adminBookings: adminBookings,
    myOrders: myOrders,
    itemRows: itemRows,
    adminOrderStatus: adminOrderStatus,
    mediaUrl: mediaUrl,
    save: save,
    cached: cached,
    clearCache: clearCache,
    isLive: isLive,
    hasCache: hasCache,
    hasAnyData: hasAnyData,
    snapshot: snapshot,
    saveCars: saveCars,
  };
})();
