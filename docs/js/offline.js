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

  function available() {
    return !!DB;
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

  /** Faqat TASHQI (http) rasm offline'da ishlaydi — `file_id` ni tashlaymiz. */
  function externalUrl(raw) {
    var s = (raw == null ? "" : String(raw)).trim();
    return /^https?:\/\//.test(s) ? s : null;
  }

  /** SQLite qatorini `/api/home` dagi mahsulot shakliga keltiradi. */
  function toProduct(r) {
    var images = [
      externalUrl(r.photo_url),
      externalUrl(r.photo2_url),
      externalUrl(r.photo3_url),
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
      video_url: externalUrl(r.video_url),
      video_external: true,
      has_media: !!images[0],
      images: images,
      _offline: true,
    };
  }

  function toBanner(r) {
    var photo = externalUrl(r.photo_url);
    return {
      id: r.id,
      title: r.title || "",
      subtitle: r.subtitle || "",
      tag: r.tag || "",
      color_from: r.color_from || "#c1121f",
      color_to: r.color_to || "#101215",
      photo_url: photo,
      photo_external: !!photo,
      video_url: externalUrl(r.video_url),
      video_external: true,
      has_media: !!photo,
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
          var photo = externalUrl(r.photo_url);
          return {
            id: r.id,
            heading: r.heading || r.title || "",
            body: r.body || "",
            emoji: r.emoji || def[2],
            color_from: r.color_from || def[3],
            color_to: r.color_to || def[4],
            photo_url: photo,
            photo_external: !!photo,
            video_url: externalUrl(r.video_url),
            video_external: true,
            has_media: !!photo,
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
    if (!available()) return null;

    var products, categories, banners, stories;
    try {
      // Mahsulot va kategoriya MAJBURIY — do'kon shulardan iborat.
      var pair = await Promise.all([readNode("products"), readNode("categories")]);
      products = rows(pair[0]);
      categories = rows(pair[1]);
    } catch (err) {
      console.error("[offline] katalog o'qilmadi:", err);
      return null;
    }

    if (!products.length) {
      console.warn("[offline] Firebase'da mahsulot yo'q.");
      return null;
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

  /** Mashinalar ro'yxati (`/api/cars` ning zaxirasi). */
  async function cars() {
    if (!available()) return [];
    try {
      return rows(await readNode("cars"))
        .sort(function (a, b) {
          return (a.sort || 0) - (b.sort || 0);
        })
        .map(function (r) {
          var photo = externalUrl(r.photo_url);
          return {
            id: r.id,
            name: r.name || "",
            years: r.years || null,
            note: r.note || null,
            photo_url: photo,
            has_media: !!photo,
          };
        });
    } catch (err) {
      console.error("[offline] mashinalar o'qilmadi:", err);
      return [];
    }
  }

  window.ZimmerOffline = {
    available: available,
    home: home,
    cars: cars,
  };
})();
