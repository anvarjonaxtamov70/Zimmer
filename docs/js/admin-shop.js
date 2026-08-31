/* ==========================================================================
   ZIMMER — TOVAR BOSHQARUVI (Avto_A1 dizayni, bitta manba)

   NIMA UCHUN BITTA FAYL / BITTA YO'L
   Ilgari Zimmer'da uch xil tovar tizimi bor edi va ular chalkashardi:
     • Render (SQLite) -> catalog/products
     • fb_prod         -> zimmer/products   (mini app O'QIMAYDI — orfan)
     • offline panel   -> catalog/products
   Har safar boshqa yo'l ishlab, tovar goh ko'rinardi, goh yo'q.

   Endi Avto_A1 modeli: BRAUZER to'g'ridan Firebase'ga yozadi, o'sha joydan
   o'qiydi. Yagona manba — `zimmer/catalog/products`. Render bor yoki yo'q —
   farqi yo'q. Mini app admin paneli HAR DOIM shu modulni ishlatadi.

   DIZAYN Avto_A1 bilan 1ga 1 (addProductModal/editModal/adminInventory):
   rasmlar + foizli yuklash, jonli ko'rinish, asosiy ma'lumotlar, flash
   chegirma, ombor (qidiruv + filtr + ommaviy amallar). FARQ faqat bitta:
   Avto_A1 da "kategoriya" = mashina rusumi (gazel/chevy). Zimmer far
   do'koni bo'lgani uchun kategoriya = Lampalar/DRL/... (catalog/categories),
   mashina esa alohida (catalog/cars). Qolgani aynan bir xil.

   Yozuv maydonlari `services/sync.py: _catalog_payload` bilan MOS —
   shuning uchun Render uyg'onganda bot uni SQLite'ga o'zi ko'chiradi.
   ========================================================================== */

window.ZimmerShop = (function () {
  "use strict";

  const app = () => window.ZIMMER_APP || {};
  const fb = () => window.ZimmerFB;
  const up = () => window.ZimmerUpload;
  const $ = (id) => document.getElementById(id);

  const esc = (v) => (app().esc ? app().esc(v) : String(v == null ? "" : v));
  const toast = (m) => (app().toast ? app().toast(m) : void 0);
  const haptic = (k) => (app().haptic ? app().haptic(k) : void 0);
  const ask = (m) => (app().ask ? app().ask(m) : Promise.resolve(window.confirm(m)));

  const P = "catalog/products";
  const MAX_PHOTOS = 3;

  /* ==================================================================
     DO'KON KO'RINISHINI ESKIRTIRISH

     Ilgari har o'zgarishdan keyin faqat shu qator bajarilardi:

         if (app().state) app().state.home = null;

     U esa faqat XOTIRADAGI nusxani tozalaydi. Katalog bundan tashqari
     `localStorage["zimmer_home_cache"]` da 30 KUN saqlanadi. Natijada
     admin tovarni o'chiradi, ilovani yopib qayta ochadi — va o'chirilgan
     tovar bosh menyuda YANA turadi (kesh o'qildi).

     Endi ikkisi ham tozalanadi.
     ================================================================== */
  function freshenShop() {
    if (app().state) app().state.home = null;
    try {
      if (window.ZimmerOffline && window.ZimmerOffline.clearCache) {
        window.ZimmerOffline.clearCache();
      }
    } catch (_) {}
  }

  const S = {
    view: null, // menu | add | edit | inventory
    cats: [], // [{name, icon}]
    cars: [], // [{id, name}]
    items: [], // ombor ro'yxati
    editing: null, // tahrirlanayotgan tovar id si
    // Yuklanayotgan rasmlar (VAQTINCHA). Tayyor havolalar bu yerda EMAS —
    // ular formadagi uchta `shop-imgN` maydonida turadi (yagona manba).
    jobs: [], // [{file, localUrl, pct, phase, error, node}]
    workerChecked: false, // Worker versiyasi sessiyada bir marta tekshiriladi
    ordKind: "order", // qaysi buyurtma bo'limi ochiq: order | biled | booking
    ordKindPrev: null, // filtr almashinuvini kuzatish uchun
    ordFilter: "all", // all | new | run | done | cancelled
    catSel: null, // tanlangan kategoriya nomi
    /* Tanlangan mashinalar — KO'P TANLOV (id lar massivi).
       Ilgari bu `carSel` degan BITTA qiymat edi va shu sababli «Damas»
       bilan «Labo» ga bir vaqtda mos tovarni kiritish MUMKIN EMASDI:
       admin ikkinchisini bosganda birinchisi o'chib ketardi. Amalda esa
       ko'p ehtiyot qism o'nlab mashinaga birdek to'g'ri keladi. */
    carSels: [], // ["12","7"] — bo'sh bo'lsa UNIVERSAL
    /* Tovar turi — Avto_A1 dagi mantiq.
         oddiy     -> bitta umumiy qoldiq (`stock`)
         razmerli  -> har razmerning O'Z qoldig'i (`sizes`) */
    typeSel: "oddiy", // oddiy | razmerli
    sizes: [], // [{size:"H4", stock:3}] — faqat `razmerli` uchun
    query: "", // ombor qidiruvi (nom / kod / kategoriya / mashina)
    selected: {}, // ombor ommaviy tanlovi {id:true}
    // ---- ombor (zaxira nazorati)
    invFilter: "all", // all | low | out | hidden | sale
    invSort: "alert", // alert | new | price | stock | name
    invDir: "desc", // desc | asc
    invLimit: 30, // ekranda nechta kartochka
    invBulkOpen: false, // ommaviy amallar yoyilganmi (⚙)
    invTimers: {}, // qoldiqni saqlash taymerlari {id: timeoutId}
    invTyping: null, // qidiruv debounce taymeri
    invIO: null, // IntersectionObserver (cheksiz skroll)
    orders: [],
    // Bosh sahifa boshqaruvi: fon musiqasi va bannerlar ro'yxati
    music: [], // [{key, id, title, sort, is_active, ...}]
    banners: [], // [{key, id, title, subtitle, tag, photo_url, sort, ...}]
    busy: false,
  };

  const body = () => $("admin-body");
  function setHead(t, s) {
    if ($("admin-title")) $("admin-title").textContent = t;
    if ($("admin-sub")) $("admin-sub").textContent = s || "";
  }

  /** "320 000 so'm" (utils/helpers.py: fmt_price bilan bir xil — oddiy bo'shliq). */
  function money(v) {
    const n = Math.round(Number(v) || 0);
    return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, " ") + " so'm";
  }
  /** "320 000" / "320000" -> 320000 (bo'sh -> null). */
  function parseNum(raw) {
    const d = String(raw == null ? "" : raw).replace(/[^\d]/g, "");
    return d ? parseInt(d, 10) : null;
  }
  function loading(t) {
    body().innerHTML = '<div class="adm-loading">' + esc(t || "Yuklanmoqda...") + "</div>";
  }
  function fail(err, retry) {
    const code = (err && err.code) || "";
    let msg = (err && err.message) || "Xatolik yuz berdi";
    let hint = "";
    if (code === "rules")
      hint =
        "Firebase Console -> Realtime Database -> Rules bo'limiga " +
        "database.rules.json matnini qo'yib «Publish» bosing.";
    else if (code === "no_db") hint = "docs/config.js da FIREBASE_DB_URL ko'rsatilmagan.";
    body().innerHTML =
      '<div class="adm-fail"><div class="adm-fail-icon">⚠️</div><p>' +
      esc(msg) +
      "</p>" +
      (hint ? '<p class="adm-hint">' + esc(hint) + "</p>" : "") +
      '<button class="btn btn-ghost btn-sm" id="shop-retry">Qayta urinish</button></div>';
    if ($("shop-retry")) $("shop-retry").onclick = retry || open;
  }

  /* ==================================================================
     KATALOG YORDAMCHILARI — kategoriya va mashina ro'yxati
     ================================================================== */
  function rowsOf(node) {
    const out = [];
    if (node && typeof node === "object") {
      Object.keys(node).forEach((k) => {
        const v = node[k];
        if (v && typeof v === "object" && !v.deleted) {
          if (v.id === undefined) v.id = isNaN(+k) ? k : +k;
          out.push(v);
        }
      });
    }
    return out;
  }

  async function loadCatalogMeta() {
    if (!fb() || !fb().available()) throw { code: "no_db", message: "Baza sozlanmagan" };
    const [cats, cars] = await Promise.all([fb().get("catalog/categories"), fb().get("catalog/cars")]);
    S.cats = rowsOf(cats).map((c) => ({ name: String(c.name || c._key || ""), icon: c.icon || "" }));
    S.cars = rowsOf(cars).map((c) => ({ id: c.id, name: String(c.name || c._key || "") }));
  }

  /* ==================================================================
     MENYU
     ================================================================== */
  /** Tepadagi «orqaga» va «yangilash» tugmalarini ZimmerShop egallaydi.
   *  DOM'da bitta topbar bor; admin.js ham unga bog'lanadi, lekin ZimmerShop
   *  open() da qayta bog'laydi va oxirgi bog'lash g'olib bo'ladi. */
  function bindTopbar() {
    const backBtn = $("admin-back");
    const reloadBtn = $("admin-reload");
    if (backBtn)
      backBtn.onclick = () => {
        haptic();
        if (!back() && app().show) app().show("home");
      };
    if (reloadBtn)
      reloadBtn.onclick = () => {
        haptic();
        reload();
      };
  }

  async function open() {
    S.view = "menu";
    /* Panel qaytadan ochildi — boshqa modul ekranni egallab turgan
       bo'lsa uni bo'shatamiz. Aks holda `isActive()` yolg'on «ha»
       qaytarib, «orqaga» tugmasi yo'q oynaga yo'nalardi. */
    if (adm() && adm().close) adm().close();
    if (crm() && crm().close) crm().close();
    if (stories() && stories().close) stories().close();
    clearPhotos();
    S.selected = {};
    // Qidiruv va filtr har ochilishda tozalanadi — aks holda oldingi
    // sessiyaning qidiruvi qolib, ombor bo'sh ko'rinardi.
    S.query = "";
    S.invFilter = "all";
    bindTopbar();
    setHead("Boshqaruv", "Tovar va buyurtmalar");
    loading("Tekshirilmoqda...");
    try {
      await loadCatalogMeta();
    } catch (err) {
      return fail(err, open);
    }
    renderMenu();
    checkWorkerVersion(); // fonda — menyuni kutib turmaydi
  }

  /* ==================================================================
     CLOUDFLARE'DA ESKI NUSXA TURGANINI ANIQLASH

     Cloudflare GitHub'dan O'ZI yangilanmaydi — `cloudflare-worker.js`
     qo'lda qo'yiladi. Shu sababli repoda yangi imkoniyat bo'lsa-da,
     Cloudflare'da eski nusxa turishi mumkin. O'sha holatda buyurtmalar
     bo'limi jimgina yarim ishlaydi:

        • do'kon buyurtmalarining SQLite nusxasi (`orders`) ko'rinmaydi —
          admin «buyurtmalarim qayerda?» deb o'ylaydi;
        • Bi-LED va navbat holatini o'zgartirganda mijozga xabar ketmaydi.

     Worker `/health` da `features` ro'yxatini beradi. Shu ro'yxatda
     `admin_orders_merged` bo'lmasa — nusxa eski, va buni ANIQ aytamiz.
     ================================================================== */
  async function checkWorkerVersion() {
    const off = window.ZimmerOffline;
    if (!off || !off.workerReady || !off.workerReady() || !off.workerSupports) return;
    if (S.workerChecked) return; // sessiyada bir marta
    S.workerChecked = true;
    try {
      const out = await off.workerSupports("admin_orders_merged");
      if (out && out.ok === false) {
        toast(
          "⚠️ Cloudflare'da Worker'ning ESKI nusxasi (" +
            out.version +
            ") turibdi. Eski buyurtmalar ko'rinmaydi — cloudflare-worker.js ni qayta qo'ying.",
          8000
        );
      }
    } catch (_) {
      // Tekshiruv ixtiyoriy — yiqilsa e'tibor bermaymiz.
    }
  }

  /* ==================================================================
     MENYU — har bo'lim ALOHIDA tugma va ALOHIDA oyna

     Ilgari uchta tugma bor edi: «Yangi tovar», «Ombor», «Buyurtmalar».
     Oxirgisi FAQAT do'kon buyurtmalarini bitta uzun ro'yxatda ko'rsatardi,
     Bi-LED buyurtmasi va navbat esa panelda UMUMAN yo'q edi — vaholanki
     mijozning kabinetida uchtasi ham bor.

     Endi beshta tugma, har biri o'z oynasini ochadi (orqaga menyuga
     qaytaradi). Buyurtma bo'limlarida tugmada YANGI yozuvlar soni qizil
     belgi bilan turadi — admin nimaga qarash kerakligini darhol ko'radi.
     ================================================================== */
  function renderMenu() {
    S.view = "menu";
    // Forma yopildi — mahalliy rasm URL'larini bo'shatamiz (xotira).
    clearPhotos();
    setHead("Boshqaruv", "Tovar va buyurtmalar");

    const tile = (id, cls, icon, title, sub, badge) =>
      '<button class="shop-hero-card ' + cls + '" id="' + id + '">' +
      '<span class="shop-hero-ic">' + icon + "</span>" +
      '<span class="shop-hero-tx"><b>' + esc(title) + "</b><i>" + esc(sub) + "</i></span>" +
      (badge ? '<span class="shop-hero-badge hidden" id="' + badge + '"></span>' : "") +
      "</button>";

    body().innerHTML =
      // --- tovar
      '<div class="shop-hero shop-hero-2">' +
      tile("shop-add", "shop-hero-add", "＋", "Yangi tovar", "Mahsulot qo'shish") +
      tile("shop-inv", "shop-hero-inv", "📦", "Ombor", "Zaxira nazorati") +
      "</div>" +
      // --- buyurtmalar
      '<div class="apx-sub">Buyurtmalar</div>' +
      '<div class="shop-hero">' +
      tile("shop-ord", "shop-hero-ord", KINDS.order.icon, KINDS.order.title, KINDS.order.sub, "shop-badge-order") +
      tile("shop-biled", "shop-hero-biled", KINDS.biled.icon, KINDS.biled.title, KINDS.biled.sub, "shop-badge-biled") +
      tile("shop-book", "shop-hero-book", KINDS.booking.icon, KINDS.booking.title, KINDS.booking.sub, "shop-badge-booking") +
      "</div>" +
      /* --- mijozlar va hisobot (Avto_A1 dagi kabi alohida guruh)
         Ilgari panelda mijozlar bazasi UMUMAN yo'q edi: admin kim nima
         sotib olganini faqat buyurtmalarni varaqlab topardi. Endi
         «Mijozlar» — kim, qancha sarflagan, nechta xarid; «Statistika» —
         tushum, o'rtacha chek va xit savdolar. */
      '<div class="apx-sub">Mijozlar va hisobot</div>' +
      '<div class="shop-hero shop-hero-2">' +
      tile("shop-cust", "shop-hero-cust", "👥", "Mijozlar", "Foydalanuvchilar bazasi") +
      tile("shop-stats", "shop-hero-stats", "📊", "Statistika", "Savdo va hisobot") +
      "</div>" +
      /* --- stories
         Ilgari story qo'shishning YAKKA yo'li Telegram boti edi
         (rasmni `#bugun matn` izohi bilan yuborish). Panelda stories
         bo'limi umuman yo'q edi va kim ko'rgani ham ko'rinmasdi. */
      '<div class="apx-sub">Stories</div>' +
      '<div class="shop-hero shop-hero-2">' +
      tile("shop-story", "shop-hero-story", "📸", "Stories", "Qo'shish va statistika") +
      tile("shop-story-add", "shop-hero-add", "＋", "Tez story", "Rasm + sarlavha") +
      "</div>" +
      /* --- xizmatlar
         Ilgari bu bo'lim panelda UMUMAN yo'q edi: admin xizmat narxini
         faqat Telegram boti orqali (`/admin` -> Xizmatlar) o'zgartira
         olardi va Mini App'dan buni topa olmasdi. Ro'yxat va forma
         ZimmerAdmin'da tayyor — shuning uchun shu yerda qaytadan
         yozmaymiz, o'sha bo'limni ochamiz (`openEmbedded`). */
      '<div class="apx-sub">Xizmatlar</div>' +
      '<div class="shop-hero shop-hero-1">' +
      tile(
        "shop-srv",
        "shop-hero-srv",
        "🔧",
        "Xizmatlar va narxlar",
        "Narx, kafolat, video va «Tez kunda»"
      ) +
      "</div>" +
      /* --- bosh sahifa ko'rinishi
         Ilgari bannerlar va fon musiqasi panelda UMUMAN yo'q edi: banner
         faqat Telegram boti orqali, musiqa esa faqat `/musiqa_del_12`
         degan buyruq bilan boshqarilardi. Tartibini almashtirish imkoni
         esa hech qayerda yo'q edi. */
      '<div class="apx-sub">Bosh sahifa</div>' +
      '<div class="shop-hero shop-hero-2">' +
      tile("shop-banners", "shop-hero-ban", "🖼", "Bannerlar", "Rasm, tartib, o'chirish") +
      tile("shop-music", "shop-hero-music", "🎵", "Fon musiqasi", "Tartib va o'chirish") +
      "</div>";

    const bind = (id, fn) => {
      const el = $(id);
      if (el)
        el.onclick = () => {
          haptic();
          fn();
        };
    };
    bind("shop-add", openAdd);
    bind("shop-inv", openInventory);
    bind("shop-ord", openOrders);
    bind("shop-biled", openBiled);
    bind("shop-book", openBookings);

    /* Mijozlar/statistika alohida modulda (admin-crm.js). Ochilganda
       ZimmerShop o'z ko'rinishini bo'shatadi — topbar «orqaga» va
       «yangilash» tugmalari CRM oynasiga ishlaydi. */
    const goCrm = (fn) => () => {
      const m = crm();
      if (!m) return toast("Bo'lim yuklanmadi — ilovani yangilang");
      S.view = null;
      m[fn]();
    };
    bind("shop-cust", goCrm("openCustomers"));
    bind("shop-stats", goCrm("openStats"));

    /* Stories alohida modulda (admin-stories.js) — CRM bilan bir xil
       tartibda: ochilganda ZimmerShop o'z ko'rinishini bo'shatadi. */
    const goStory = (fn) => () => {
      const m = stories();
      if (!m) return toast("Bo'lim yuklanmadi — ilovani yangilang");
      S.view = null;
      m[fn]();
    };
    bind("shop-story", goStory("open"));
    bind("shop-story-add", goStory("openAdd"));

    /* Xizmatlar — ZimmerAdmin ning `srv` bo'limi. CRM va Stories bilan
       bir xil tartib: ochilganda ZimmerShop o'z ko'rinishini bo'shatadi,
       shunda tepadagi «orqaga»/«yangilash» o'sha oynaga ishlaydi. */
    bind("shop-srv", () => {
      const m = adm();
      if (!m || !m.openEmbedded) return toast("Bo'lim yuklanmadi — ilovani yangilang");
      S.view = null;
      m.openEmbedded("srv");
    });

    bind("shop-banners", openBanners);
    bind("shop-music", openMusic);

    // Sanoqchilar FONDA yuklanadi — menyu darhol ochiladi.
    refreshBadges();
  }

  /* ==================================================================
     BUYURTMALAR — UCH ALOHIDA BO'LIM, HAR BIRI O'Z OYNASIDA

     Ilgari bitta «Buyurtmalar» tugmasi bor edi va u faqat do'kon
     buyurtmalarini bitta uzun ro'yxatda ko'rsatardi. Mijozning
     kabinetida esa UCHTA bo'lim bor:

         🛍 Mahsulot buyurtmalari   (catalog/orders + pending_orders)
         🔥 Bi-LED buyurtmalari     (biled_orders)
         🗓 Navbatlar               (bookings)

     Ya'ni admin mijoz ko'rgan narsaning uchdan bir qismini ko'rardi:
     Bi-LED buyurtmasi va navbat panelda UMUMAN yo'q edi.

     Endi «Ombor» va «Yangi tovar» kabi — har bo'lim alohida tugma va
     alohida oyna. Har oynada holat bo'yicha filtr chiplari bor.

     MA'LUMOT QAYERDAN
       • do'kon buyurtmalari — Worker `/admin/orders` (ikki tugunni
         birlashtiradi, yopiq `orders` tugunini ham o'qiydi);
       • Bi-LED va navbat — TO'G'RIDAN Firebase'dan, chunki
         `database.rules.json` da ular o'qishga ochiq. Shu sababli
         Worker o'chgan bo'lsa ham ro'yxat ko'rinadi.
       • holatni o'zgartirish — Worker orqali (mijozga Telegram xabari
         uchun bot tokeni kerak, u faqat Worker'da).
     ================================================================== */

  /** Har bir tur: tuguni, holatlari, keyingi qadamlari, kartochka tanasi. */
  const KINDS = {
    order: {
      icon: "🛍",
      title: "Mahsulot buyurtmalari",
      sub: "Do'kondan berilgan buyurtmalar",
      empty: "Hali buyurtma tushmagan. Mijoz do'kondan buyurtma berganda shu yerda ko'rinadi.",
      statuses: {
        new: { label: "Yangi", icon: "🆕" },
        accepted: { label: "Qabul qilindi", icon: "✅" },
        delivering: { label: "Yo'lda", icon: "🚚" },
        delivered: { label: "Yetkazildi", icon: "🎉" },
        cancelled: { label: "Bekor qilingan", icon: "✕" },
      },
      next: {
        new: [["accepted", "✅ Qabul qilish"], ["cancelled", "✕ Bekor qilish"]],
        accepted: [["delivering", "🚚 Yo'lga chiqdi"], ["cancelled", "✕ Bekor qilish"]],
        delivering: [["delivered", "🎉 Yetkazildi"]],
      },
      // «Jarayonda» filtri uchun
      running: ["accepted", "delivering"],
    },
    biled: {
      icon: "🔥",
      title: "Bi-LED buyurtmalari",
      sub: "Linza va o'rnatish buyurtmalari",
      empty: "Bi-LED buyurtmasi yo'q. Mijoz konfiguratordan buyurtma berganda shu yerda ko'rinadi.",
      statuses: {
        new: { label: "Yangi", icon: "🆕" },
        accepted: { label: "Qabul qilindi", icon: "✅" },
        in_work: { label: "Ish jarayonida", icon: "🔧" },
        done: { label: "Topshirildi", icon: "✨" },
        cancelled: { label: "Bekor qilingan", icon: "✕" },
      },
      next: {
        new: [["accepted", "✅ Qabul qilish"], ["cancelled", "✕ Bekor qilish"]],
        accepted: [["in_work", "🔧 Ishga oldim"], ["cancelled", "✕ Bekor qilish"]],
        in_work: [["done", "✨ Topshirildi"]],
      },
      running: ["accepted", "in_work"],
    },
    booking: {
      icon: "🗓",
      title: "Navbatlar",
      sub: "O'rnatish va tozalash navbatlari",
      empty: "Navbat yo'q. Mijoz vaqt band qilganda shu yerda ko'rinadi.",
      statuses: {
        new: { label: "Yangi", icon: "🆕" },
        confirmed: { label: "Tasdiqlangan", icon: "✅" },
        done: { label: "Bajarilgan", icon: "✔️" },
        cancelled: { label: "Bekor qilingan", icon: "✕" },
      },
      next: {
        new: [["confirmed", "✅ Tasdiqlash"], ["cancelled", "✕ Bekor qilish"]],
        confirmed: [["done", "✔️ Bajarildi"], ["cancelled", "✕ Bekor qilish"]],
      },
      running: ["confirmed"],
    },
  };

  /** Do'kon buyurtmasidagi eski nomlarni yagona lug'atga keltiradi.
   *  `done`/`shipped` — Mini App va mijoz profilida ishlatilgan eski
   *  nomlar; SQLite'da esa `delivered`/`delivering`. */
  function normStatus(v, kind) {
    const s = String(v || "new").toLowerCase();
    const set = (KINDS[kind || "order"] || KINDS.order).statuses;
    if (set[s]) return s;
    if (kind === "order" || !kind) {
      if (s === "done") return "delivered";
      if (s === "shipped") return "delivering";
    }
    return "new";
  }

  /* ------------------------------------------------------------ o'qish */

  async function loadKind(kind) {
    const off = window.ZimmerOffline;

    if (kind === "biled") {
      const rows = off && off.adminBiledOrders ? await off.adminBiledOrders() : [];
      return rows.map((r) => ({
        kind: "biled",
        key: String(r._key != null ? r._key : r.id),
        code: "#" + (r.id != null ? r.id : r._key),
        uid: r.uid || null,
        name: r.name || "",
        phone: r.phone || "",
        status: normStatus(r.status, "biled"),
        total: Number(r.total) || 0,
        total_label: money(Number(r.total) || 0),
        created_at: Number(r.createdAt) || 0,
        // Bi-LED tafsiloti
        lines: [
          ["🚗", r.car],
          ["💡", r.biled],
          ["🕶", r.shroud],
          ["🎨", r.color],
          ["💬", r.comment],
        ],
      }));
    }

    if (kind === "booking") {
      const rows = off && off.adminBookings ? await off.adminBookings() : [];
      return rows.map((r) => ({
        kind: "booking",
        key: String(r._key != null ? r._key : r.id),
        code: "#" + (r.id != null ? r.id : r._key),
        uid: r.uid || null,
        name: r.name || "",
        phone: r.phone || "",
        status: normStatus(r.status, "booking"),
        total: 0,
        total_label: "",
        created_at: Number(r.createdAt) || 0,
        lines: [
          ["🛠", r.service],
          ["📅", r.date],
          ["🕐", r.time],
        ],
      }));
    }

    // ---- do'kon buyurtmalari
    if (off && off.workerReady && off.workerReady() && off.adminOrders) {
      try {
        const res = await off.adminOrders();
        return (res.orders || []).map((o) => shopOrder(o));
      } catch (err) {
        console.warn("[shop] Worker buyurtmalarni bermadi:", err);
        if (err && (err.code === "forbidden" || /admin/i.test(err.message || ""))) {
          toast("⚠️ Worker'da ADMIN_IDS sozlanmagan — faqat yangi buyurtmalar ko'rinadi", 6000);
        }
      }
    }
    /* Zaxira: to'g'ridan `pending_orders`.
       DIQQAT: bu tugun endi qoidalarda O'QISH UCHUN YOPIQ — unda mijozning
       ismi, telefoni va manzili bor va ilgari hammaga ochiq turardi.
       Ro'yxatni faqat Worker beradi (imzoni tekshiradi). Shu sababli bu
       yerda xatoni YASHIRMAYMIZ — adminga nima qilish kerakligini aytamiz. */
    let node = null;
    try {
      node = await fb().get("pending_orders");
    } catch (err) {
      if (err && (err.code === "rules" || err.status === 401 || err.status === 403)) {
        toast(
          "🔒 Buyurtmalar ro'yxati uchun WORKER_URL sozlanishi kerak " +
            "(maxfiylik uchun baza yopiq)",
          7000
        );
        return [];
      }
      throw err;
    }
    const out = [];
    if (node && typeof node === "object") {
      Object.keys(node).forEach((key) => {
        const r = node[key];
        if (!r || typeof r !== "object") return;
        out.push(
          shopOrder({
            key: key,
            source: "pending",
            code: r.code || key,
            uid: r.uid,
            name: r.customer_name || r.name,
            phone: r.phone,
            address: r.address,
            delivery_info: r.delivery_info,
            payment_method: r.payment_method,
            total: r.total,
            status: r.status,
            // `items` LUG'AT ham bo'lishi mumkin (RTDB siyrak massiv) —
            // ilgari `Array.isArray()` tekshiruvi tovarlarni jimgina yo'q
            // qilardi va admin nima sotilganini ko'rmasdi.
            items: off && off.itemRows ? off.itemRows(r.items) : r.items,
            created_at: r.createdAt,
          })
        );
      });
    }
    out.sort((a, b) => b.created_at - a.created_at);
    return out;
  }

  function shopOrder(o) {
    const total = Number(o.total) || 0;
    return {
      kind: "order",
      key: String(o.key),
      source: o.source || "pending",
      code: o.code || (o.id != null ? "#" + o.id : String(o.key)),
      uid: o.uid || null,
      name: o.name || "",
      phone: o.phone || "",
      status: normStatus(o.status, "order"),
      total: total,
      total_label: o.total_label || money(total),
      created_at: Number(o.created_at) || 0,
      items: Array.isArray(o.items) ? o.items : [],
      lines: [
        ["📍", o.address],
        ["🚚", o.delivery_info],
        ["💳", o.payment_method],
      ],
    };
  }

  /* ------------------------------------------------------------ oynalar */

  /** Bo'limni ochadi (o'z oynasi, o'z sarlavhasi, orqaga menyuga). */
  async function openKind(kind) {
    const cfg = KINDS[kind];
    if (!cfg) return;
    S.view = "orders";
    S.ordKind = kind;
    S.ordFilter = S.ordFilter && S.ordKindPrev === kind ? S.ordFilter : "all";
    S.ordKindPrev = kind;
    setHead(cfg.title, cfg.sub);
    loading("O'qilmoqda...");
    try {
      S.orders = await loadKind(kind);
      renderOrders();
    } catch (err) {
      fail(err, () => openKind(kind));
    }
  }

  const openOrders = () => openKind("order");
  const openBiled = () => openKind("biled");
  const openBookings = () => openKind("booking");

  /** Filtr chiplari: Hammasi · Yangi · Jarayonda · Yakunlangan · Bekor */
  function filterOf(kind) {
    const cfg = KINDS[kind];
    const finals = Object.keys(cfg.statuses).filter(
      (s) => s !== "new" && s !== "cancelled" && cfg.running.indexOf(s) === -1
    );
    return {
      all: () => true,
      new: (o) => o.status === "new",
      run: (o) => cfg.running.indexOf(o.status) !== -1,
      done: (o) => finals.indexOf(o.status) !== -1,
      cancelled: (o) => o.status === "cancelled",
    };
  }

  const FILTER_CHIPS = [
    ["all", "Hammasi"],
    ["new", "🆕 Yangi"],
    ["run", "⏳ Jarayonda"],
    ["done", "✅ Yakunlangan"],
    ["cancelled", "✕ Bekor"],
  ];

  function renderOrders() {
    const kind = S.ordKind || "order";
    const cfg = KINDS[kind];
    const tests = filterOf(kind);
    const all = S.orders || [];

    if (!all.length) {
      body().innerHTML = '<div class="adm-hint-block">' + esc(cfg.empty) + "</div>";
      return;
    }

    const list = all.filter(tests[S.ordFilter] || tests.all);

    // Filtr chiplari — har birida soni ko'rinadi
    const chips = FILTER_CHIPS.map(([key, label]) => {
      const n = all.filter(tests[key]).length;
      if (key !== "all" && !n) return ""; // bo'sh filtrni ko'rsatmaymiz
      return (
        '<button class="ord-fchip' +
        (S.ordFilter === key ? " selected" : "") +
        '" data-f="' +
        key +
        '">' +
        esc(label) +
        ' <i>' + n + "</i></button>"
      );
    }).join("");

    body().innerHTML =
      '<div class="ord-filters">' + chips + "</div>" +
      (list.length
        ? list.map((o) => orderCard(o, cfg)).join("")
        : '<div class="adm-hint">Bu bo\'limda yozuv yo\'q.</div>');

    document.querySelectorAll(".ord-fchip").forEach((b) => {
      b.onclick = () => {
        haptic();
        S.ordFilter = b.dataset.f;
        renderOrders();
      };
    });

    list.forEach((o) => {
      (cfg.next[o.status] || []).forEach(([status]) => {
        const btn = $("shop-o-" + o.key + "-" + status);
        if (btn) btn.onclick = () => setOrderStatus(o, status);
      });
      const tel = $("shop-tel-" + o.key);
      if (tel && o.phone) tel.onclick = () => callPhone(o.phone);
    });
  }

  /** Telefon raqamini ochadi. */
  function callPhone(phone) {
    haptic();
    try {
      window.open("tel:" + String(phone).replace(/\s/g, ""), "_blank");
    } catch (_) {}
  }

  /** «Bugun 14:38» yoki «26.08 14:38». */
  function timeLabel(ms) {
    if (!ms) return "";
    const d = new Date(Number(ms));
    if (isNaN(d.getTime())) return "";
    const two = (n) => (n < 10 ? "0" + n : String(n));
    const now = new Date();
    const sameDay =
      d.getDate() === now.getDate() &&
      d.getMonth() === now.getMonth() &&
      d.getFullYear() === now.getFullYear();
    const time = two(d.getHours()) + ":" + two(d.getMinutes());
    return sameDay ? "Bugun " + time : two(d.getDate()) + "." + two(d.getMonth() + 1) + " " + time;
  }

  /* Kartochka — uch tur uchun BITTA uslub (iOS):
       tepada  : kod · vaqt              + holat belgisi
       mijoz   : ism · telefon (bosiladi)
       tovarlar: nom × son = summa       (faqat do'kon buyurtmasida)
       tafsilot: turga qarab (manzil / mashina / xizmat va vaqt)
       pastda  : JAMI + amal tugmalari */
  function orderCard(o, cfg) {
    const st = cfg.statuses[o.status] || cfg.statuses.new;

    const goods = (o.items || [])
      .map((it) => {
        const qty = Number(it.qty) || 1;
        const sum = (Number(it.price) || 0) * qty;
        return (
          '<div class="ord-good"><span>' +
          esc(it.name || "Tovar") +
          /* Razmerli tovar: admin javondan to'g'ri razmerni topishi uchun
             nom yonida turadi. Razmersizda satr o'zgarmaydi. */
          (it.size ? ' <em class="ord-size">' + esc(it.size) + "</em>" : "") +
          "</span><i>×" +
          qty +
          "</i>" +
          (sum ? "<b>" + esc(money(sum)) + "</b>" : "") +
          "</div>"
        );
      })
      .join("");

    const meta = (o.lines || [])
      .filter((pair) => pair && pair[1])
      .map((pair) => '<div class="ord-meta-row">' + pair[0] + " " + esc(pair[1]) + "</div>")
      .join("");

    const acts = (cfg.next[o.status] || [])
      .map(
        ([status, label]) =>
          '<button class="ord-act' +
          (status === "cancelled" ? " is-danger" : "") +
          '" id="shop-o-' +
          esc(o.key) +
          "-" +
          status +
          '">' +
          esc(label) +
          "</button>"
      )
      .join("");

    const when = timeLabel(o.created_at);

    return (
      '<div class="ord is-' + o.status + '">' +
      '<div class="ord-top">' +
      '<span class="ord-code">' + esc(o.code) + (when ? ' <i>· ' + esc(when) + "</i>" : "") + "</span>" +
      '<span class="ord-pill is-' + o.status + '">' + st.icon + " " + esc(st.label) + "</span>" +
      "</div>" +
      (o.name || o.phone
        ? '<div class="ord-who">' +
          (o.name ? "<b>" + esc(o.name) + "</b>" : "") +
          (o.phone
            ? '<button class="ord-tel" id="shop-tel-' + esc(o.key) + '">📞 ' + esc(o.phone) + "</button>"
            : "") +
          "</div>"
        : "") +
      (goods ? '<div class="ord-goods">' + goods + "</div>" : "") +
      (meta ? '<div class="ord-meta">' + meta + "</div>" : "") +
      (o.total
        ? '<div class="ord-foot"><span>Jami</span><b>' + esc(o.total_label) + "</b></div>"
        : "") +
      (acts ? '<div class="ord-acts">' + acts + "</div>" : "") +
      "</div>"
    );
  }

  async function setOrderStatus(order, status) {
    if (S.busy) return;
    S.busy = true;
    const cfg = KINDS[order.kind] || KINDS.order;
    const label = (cfg.statuses[status] || {}).label || status;

    /* 1-yo'l: Worker. U TO'G'RI tugunga yozadi (`pending_orders`, `orders`,
       `biled_orders`, `bookings`) va mijozga Telegram xabarini yuboradi
       (bot tokeni faqat o'sha yerda). */
    const off = window.ZimmerOffline;
    if (off && off.workerReady && off.workerReady() && off.adminOrderStatus) {
      try {
        await off.adminOrderStatus(order.key, status, order.source, order.kind);
        haptic("ok");
        toast("✅ " + label + " — mijozga xabar ketdi");
        S.busy = false;
        return openKind(order.kind);
      } catch (err) {
        console.warn("[shop] Worker holatni o'zgartirmadi:", err);
      }
    }

    /* 2-yo'l: to'g'ridan Firebase. Qoidalarda `pending_orders`,
       `biled_orders` va `bookings` yozishga ochiq; `orders` esa YOPIQ —
       SQLite buyurtmasi uchun Worker shart. */
    const NODE = { biled: "biled_orders", booking: "bookings" };
    const node = order.kind === "order" ? "pending_orders" : NODE[order.kind];
    if (order.kind === "order" && order.source === "db") {
      S.busy = false;
      return toast("❌ Bu buyurtma uchun Worker kerak (config.js -> WORKER_URL)", 5000);
    }
    try {
      await fb().patch(node + "/" + order.key, { status: status, status_at: Date.now() });
      haptic("ok");
      toast("✅ " + label + " (mijozga xabar ketmadi)");
      S.busy = false;
      return openKind(order.kind);
    } catch (err) {
      toast((err && err.message) || "Holat o'zgarmadi");
      S.busy = false;
    }
  }

  /* ==================================================================
     MENYU SANOQCHILARI — har tugmada nechta YANGI yozuv borligi

     Menyu ochilganda uch bo'lim fonda o'qiladi va tugmalarga qizil
     belgi qo'yiladi. Bloklamaydi: ro'yxat kelmasa tugma shunchaki
     belgisiz qoladi.
     ================================================================== */
  async function refreshBadges() {
    const jobs = [
      ["order", loadKind("order")],
      ["biled", loadKind("biled")],
      ["booking", loadKind("booking")],
    ];
    await Promise.all(
      jobs.map(async ([kind, p]) => {
        let rows = [];
        try {
          rows = await p;
        } catch (_) {
          return;
        }
        const fresh = rows.filter((o) => o.status === "new").length;
        const badge = $("shop-badge-" + kind);
        if (!badge) return; // menyu yopilgan
        if (fresh) {
          badge.textContent = fresh > 99 ? "99+" : String(fresh);
          badge.classList.remove("hidden");
        } else {
          badge.classList.add("hidden");
        }
      })
    );
  }

  /* ==================================================================
     RASMLAR — AVTO_A1 MODELI: uchta havola maydoni = YAGONA MANBA

     NEGA QAYTA YOZILDI
     Ilgari bu yerda IKKI xil ro'yxat bor edi: yuklangan rasmlar (`S.photos`)
     va qo'lda yozilgan havolalar (uchta matn maydoni). Ular alohida
     hisoblanardi:
        • tartib aralashardi (yuklangani avval, qo'lda yozilgani keyin);
        • «asosiy rasm» qaysi biri ekani tushunarsiz edi;
        • 3 ta chegara ikki joyda tekshirilardi;
        • bittasini o'chirsangiz ikkinchi ro'yxat siljib ketardi.

     Avto_A1 da bunday chalkashlik YO'Q. Rasmlarning yagona manbasi —
     formadagi uchta havola maydoni:

         galereyadan yuklash -> ImgBB -> havola MAYDONGA yoziladi
         qo'lda havola yozish -> ayni o'sha maydon

     Shundan keyin hammasi bitta joydan o'qiladi (`readImgUrls`): eskizlar
     ham, jonli kartochka ham, saqlash ham. Maydon soni 3 — ya'ni chegara
     o'z-o'zidan hosil bo'ladi, alohida hisoblash kerak emas.

     Boshqarish tugmalari ham Avto_A1 dagidek:
         ⭐   — shu rasmni ASOSIY qilish (birinchi o'ringa suradi)
         ◀ ▶ — tartibni almashtirish
         ✕   — o'chirish

     Yuklash paytidagi foizli ko'rinish (Zimmer'ning qulayligi) saqlanadi:
     yuklanayotgan rasm eskizlar ORASIDA vaqtincha «ish» sifatida turadi va
     havola kelgach oddiy eskizga aylanadi.

     ESLATMA — `onchange` dagi tuzoq saqlanadi: `ev.target.files` TIRIK
     `FileList`, `input.value = ""` uni JOYIDA bo'shatadi. Shu sababli avval
     massivga nusxa olinadi, keyin input tozalanadi.
     ================================================================== */

  const IMG_IDS = ["shop-img1", "shop-img2", "shop-img3"];

  /* ---------------------------------------------- havola maydonlari */

  function imgInputs() {
    return IMG_IDS.map((id) => $(id));
  }

  /** Havolalar ro'yxati. Bo'sh maydonlar TASHLANADI (ro'yxat siqiladi). */
  function readImgUrls() {
    return imgInputs()
      .map((el) => (el ? String(el.value || "").trim() : ""))
      .filter(Boolean);
  }

  /** Ro'yxatni maydonlarga yozadi (ortiqcha maydonlar tozalanadi). */
  function setImgUrls(list) {
    imgInputs().forEach((el, i) => {
      if (el) el.value = (list && list[i]) || "";
    });
  }

  function removeImg(i) {
    const a = readImgUrls();
    a.splice(i, 1);
    setImgUrls(a);
    renderThumbs();
  }

  function moveImg(i, dir) {
    const a = readImgUrls();
    const j = i + dir;
    if (j < 0 || j >= a.length) return;
    const t = a[i];
    a[i] = a[j];
    a[j] = t;
    setImgUrls(a);
    renderThumbs();
  }

  /** Tanlangan rasmni birinchi o'ringa suradi — u ASOSIY bo'ladi. */
  function setMainImg(i) {
    const a = readImgUrls();
    if (i <= 0 || i >= a.length) return;
    a.unshift(a.splice(i, 1)[0]);
    setImgUrls(a);
    renderThumbs();
  }

  /** SAQLANADIGAN havolalar (max 3, takrorlanmaydi). */
  function photoUrls() {
    const out = readImgUrls();
    return out.filter((u, i) => out.indexOf(u) === i).slice(0, MAX_PHOTOS);
  }

  /** Nechta yuklash hali ketmoqda. */
  function busyPhotos() {
    return (S.jobs || []).filter((j) => !j.error).length;
  }

  /* ------------------------------------------------------ forma bloki */

  function photoBlock() {
    const ready = up() && up().available();
    let html =
      '<div class="admin-form-group"><div class="apx-head">' +
      '<div class="apx-ic">🖼</div>' +
      "<div class=\"apx-tx\"><b>Rasmlar</b><span>Birinchi qadam · 1–" +
      MAX_PHOTOS +
      " ta</span></div></div>";

    if (ready) {
      // Fayl input'i yuklash zonasini TO'LIQ qoplaydi (shaffof). `hidden`
      // input + `label for` ba'zi Telegram WebView'larida ochilmaydi.
      html +=
        '<div class="apx-upload" id="shop-drop">' +
        '<div class="apx-up-ic">⬆️</div>' +
        '<div class="apx-up-t">Galereyadan rasm yuklash</div>' +
        '<div class="apx-up-s">Havola pastdagi maydonga o\'zi tushadi</div>' +
        '<input type="file" id="shop-file" accept="image/*" multiple>' +
        "</div>";
    } else {
      html +=
        '<div class="adm-hint-block">Galereyadan yuklash uchun ImgBB kaliti kerak ' +
        "(config.js -> IMGBB_KEY). Hozircha havolani qo'lda qo'ying.</div>";
    }

    html +=
      '<div class="shop-thumbs" id="shop-thumbs"></div>' +
      '<div class="up-status" id="shop-up-status"></div>' +
      '<div class="apx-sub">Rasm havolalari — 1-si ASOSIY</div>' +
      '<input type="text" class="admin-input" id="shop-img1" placeholder="1-rasm havolasi (asosiy)">' +
      '<input type="text" class="admin-input" id="shop-img2" placeholder="2-rasm havolasi (ixtiyoriy)">' +
      '<input type="text" class="admin-input" id="shop-img3" placeholder="3-rasm havolasi (ixtiyoriy)">' +
      "</div>";
    return html;
  }

  function bindPhotos() {
    const inp = $("shop-file");
    if (inp)
      inp.onchange = (ev) => {
        const picked = Array.prototype.slice.call(ev.target.files || []);
        ev.target.value = "";
        handleFiles(picked);
      };

    // Zaxira: qoplama input bosilmasa, zonaning o'zi ochadi.
    const zone = $("shop-drop");
    if (zone && inp)
      zone.onclick = (ev) => {
        if (ev.target !== inp) {
          haptic();
          inp.click();
        }
      };

    // Havola maydonlari: jonli kartochka DARHOL, eskiz esa yozib bo'lgach
    // (aks holda har harfda chala havola bilan buzuq rasm miltillaydi).
    let linkTimer = null;
    IMG_IDS.forEach((id) => {
      const el = $(id);
      if (!el) return;
      el.oninput = () => {
        livePreview();
        clearTimeout(linkTimer);
        linkTimer = setTimeout(renderThumbs, 700);
      };
      el.onchange = () => {
        clearTimeout(linkTimer);
        renderThumbs();
      };
    });
  }

  /* ------------------------------------------------------ yuklash ishi */

  function objectUrl(file) {
    try {
      return URL.createObjectURL(file);
    } catch (_) {
      return null;
    }
  }

  function makeJob(file) {
    return {
      file: file,
      localUrl: objectUrl(file), // internet kutmasdan ko'rsatish uchun
      pct: 0,
      phase: "compress", // compress | upload
      error: null,
      node: null,
    };
  }

  function releaseJob(job) {
    if (job && job.localUrl) {
      try {
        URL.revokeObjectURL(job.localUrl);
      } catch (_) {}
      job.localUrl = null;
    }
  }

  function clearPhotos() {
    (S.jobs || []).forEach(releaseJob);
    S.jobs = [];
  }

  async function handleFiles(picked) {
    if (!up() || !up().available()) return;
    const files = (picked || []).filter(Boolean);
    if (!files.length) return;

    const room = MAX_PHOTOS - readImgUrls().length - (S.jobs || []).length;
    if (room <= 0) {
      return toast("Maksimum " + MAX_PHOTOS + " ta rasm. Avval birortasini o'chiring.");
    }
    const list = files.slice(0, room);
    if (files.length > room) {
      toast("Faqat " + room + " ta qo'shildi (chegara " + MAX_PHOTOS + " ta)");
    }

    const jobs = list.map(makeJob);
    S.jobs = (S.jobs || []).concat(jobs);
    renderThumbs(); // eskiz DARHOL chiqadi
    haptic();

    let ok = 0;
    for (const job of jobs) {
      const url = await runJob(job);
      if (url) {
        dropJob(job);
        // Havola MAYDONGA tushadi — bundan keyin u oddiy havola, xolos.
        setImgUrls(readImgUrls().concat([url]).slice(0, MAX_PHOTOS));
        ok++;
      }
      renderThumbs();
    }

    if (ok) {
      haptic("ok");
      toast("✅ " + ok + " ta rasm yuklandi");
    }
  }

  function dropJob(job) {
    const i = (S.jobs || []).indexOf(job);
    if (i >= 0) S.jobs.splice(i, 1);
    releaseJob(job);
  }

  /** Bitta faylni siqib yuklaydi va HAVOLA qaytaradi (xato bo'lsa null).
   *
   *  `try` faqat yuklashni o'raydi: ilgari muvaffaqiyat kodi ham ichida edi
   *  va bezashdagi har qanday nosozlik allaqachon yuklangan rasmni
   *  «yuklanmadi» deb ko'rsatardi. */
  async function runJob(job) {
    job.error = null;
    job.pct = 0;
    job.phase = "compress";
    paintJob(job);
    paintStatus();

    let res = null;
    try {
      res = await up().uploadFile(job.file, (pct, phase) => {
        job.pct = pct;
        job.phase = phase === "siqish" ? "compress" : "upload";
        paintJob(job);
      });
    } catch (err) {
      job.error = (err && err.message) || "Yuklanmadi";
      if (err && err.code === "bad_key") job.error = "ImgBB kaliti xato (config.js)";
      if (err && err.code === "no_key") job.error = "ImgBB kaliti yo'q (config.js)";
      paintJob(job);
      paintStatus();
      haptic("err");
      toast("❌ " + job.error);
      return null;
    }
    return res.url;
  }

  /* --------------------------------------------------------- eskizlar */

  /** Tayyor havola uchun eskiz: ⭐ asosiy · ◀ ▶ tartib · ✕ o'chirish. */
  function thumbNode(url, i, total) {
    const wrap = document.createElement("div");
    wrap.className = "img-thumb-wrap up-slot is-ready" + (i === 0 ? " is-main" : "");

    const img = document.createElement("img");
    img.alt = "";
    img.onerror = () => wrap.classList.add("up-broken");
    img.onload = () => wrap.classList.remove("up-broken");
    img.src = url;
    wrap.appendChild(img);

    const badge = document.createElement("span");
    badge.className = "img-main-badge";
    badge.textContent = "Asosiy";
    wrap.appendChild(badge);

    const del = document.createElement("button");
    del.className = "img-del";
    del.type = "button";
    del.textContent = "✕";
    del.title = "O'chirish";
    del.onclick = (ev) => {
      ev.stopPropagation();
      haptic();
      removeImg(i);
    };
    wrap.appendChild(del);

    // ⭐ — asosiy qilish (birinchisida shunchaki belgi)
    const star = document.createElement("button");
    star.className = "img-star" + (i === 0 ? " on" : "");
    star.type = "button";
    star.textContent = "⭐";
    star.title = i === 0 ? "Asosiy rasm" : "Asosiy qilish";
    star.onclick = (ev) => {
      ev.stopPropagation();
      haptic();
      setMainImg(i);
    };
    wrap.appendChild(star);

    // ◀ ▶ — tartibni almashtirish
    const row = document.createElement("div");
    row.className = "img-move-row";
    if (i > 0) {
      const left = document.createElement("button");
      left.type = "button";
      left.className = "img-move";
      left.textContent = "◀";
      left.onclick = (ev) => {
        ev.stopPropagation();
        haptic();
        moveImg(i, -1);
      };
      row.appendChild(left);
    }
    if (i < total - 1) {
      const right = document.createElement("button");
      right.type = "button";
      right.className = "img-move";
      right.textContent = "▶";
      right.onclick = (ev) => {
        ev.stopPropagation();
        haptic();
        moveImg(i, 1);
      };
      row.appendChild(right);
    }
    if (row.children.length) wrap.appendChild(row);

    return wrap;
  }

  /** Yuklanayotgan rasm uchun eskiz (mahalliy rasm + foiz qatlami). */
  function jobNode(job) {
    const wrap = document.createElement("div");
    wrap.className = "img-thumb-wrap up-slot";

    const img = document.createElement("img");
    img.alt = "";
    img.onerror = () => wrap.classList.add("up-broken");
    if (job.localUrl) img.src = job.localUrl;
    else wrap.classList.add("up-broken");
    wrap.appendChild(img);

    const ov = document.createElement("div");
    ov.className = "up-ov";
    ov.innerHTML =
      '<span class="up-spin"></span><span class="up-pct"></span><span class="up-bar"></span>';
    wrap.appendChild(ov);

    const del = document.createElement("button");
    del.className = "img-del";
    del.type = "button";
    del.textContent = "✕";
    del.onclick = (ev) => {
      ev.stopPropagation();
      haptic();
      dropJob(job);
      renderThumbs();
    };
    wrap.appendChild(del);

    const retry = document.createElement("button");
    retry.className = "up-retry";
    retry.type = "button";
    retry.textContent = "↻";
    retry.title = "Qayta urinish";
    retry.onclick = async (ev) => {
      ev.stopPropagation();
      haptic();
      const url = await runJob(job);
      if (url) {
        dropJob(job);
        setImgUrls(readImgUrls().concat([url]).slice(0, MAX_PHOTOS));
        haptic("ok");
        toast("✅ Rasm yuklandi");
      }
      renderThumbs();
    };
    wrap.appendChild(retry);

    job.node = wrap;
    paintJob(job);
    return wrap;
  }

  /** Yuklash holatini JOYIDA yangilaydi (rasmni qayta yuklamasdan).
   *  Bezash HECH QACHON yuklashni buzmasligi kerak — himoyalangan. */
  function paintJob(job) {
    try {
      paintJobUnsafe(job);
    } catch (_) {}
  }

  function paintJobUnsafe(job) {
    const wrap = job && job.node;
    if (!wrap) return;
    const pctEl = wrap.querySelector(".up-pct");
    const barEl = wrap.querySelector(".up-bar");

    wrap.classList.remove("is-compress", "is-upload", "is-error");

    if (job.error) {
      wrap.classList.add("is-error");
      if (pctEl) pctEl.textContent = "❌";
      if (barEl) barEl.style.width = "100%";
      wrap.title = job.error;
      return;
    }
    wrap.title = "";
    if (job.phase === "compress") {
      wrap.classList.add("is-compress");
      if (pctEl) pctEl.textContent = "siqilmoqda";
      if (barEl) barEl.style.width = "8%";
    } else {
      wrap.classList.add("is-upload");
      if (pctEl) pctEl.textContent = job.pct + "%";
      if (barEl) barEl.style.width = Math.max(3, job.pct) + "%";
    }
  }

  /** Eskizlarni qayta yasaydi: tayyor havolalar + yuklanayotganlar. */
  function renderThumbs() {
    const box = $("shop-thumbs");
    if (!box) return;
    box.innerHTML = "";

    const urls = readImgUrls();
    urls.forEach((url, i) => box.appendChild(thumbNode(url, i, urls.length)));
    (S.jobs || []).forEach((job) => {
      job.node = null;
      box.appendChild(jobNode(job));
    });

    paintStatus();
    livePreview();
  }

  /** Eskizlar ostidagi holat qatori. */
  function paintStatus() {
    const el = $("shop-up-status");
    if (!el) return;
    const busy = busyPhotos();
    const bad = (S.jobs || []).filter((j) => j.error).length;
    const ready = readImgUrls().length;

    if (busy) {
      el.className = "up-status is-busy";
      el.textContent = "⏳ " + busy + " ta rasm yuklanmoqda — sahifadan chiqmang";
    } else if (bad) {
      el.className = "up-status is-bad";
      el.textContent = "❌ " + bad + " ta rasm yuklanmadi — ↻ bosib qayta urinib ko'ring";
    } else if (ready) {
      el.className = "up-status is-ok";
      el.textContent = "✅ " + ready + " ta rasm tayyor · 1-si asosiy";
    } else {
      el.className = "up-status";
      el.textContent = "";
    }
  }

  /* ==================================================================
     NARX MAYDONI — raqamlar ajratib yoziladi (Avto_A1 formatPriceInput)

     Admin «150000» deb yozganda maydonda «150 000» ko'rinadi. Bu shunchaki
     chiroylilik emas: nollarni ko'z bilan sanash kerak bo'lmaydi, ya'ni
     «1 500 000» o'rniga «150 000» yozib qo'yish xatosi kamayadi.
     ================================================================== */
  function moneyInput(el) {
    if (!el) return;
    const digits = String(el.value || "").replace(/\D/g, "");
    el.value = digits ? digits.replace(/\B(?=(\d{3})+(?!\d))/g, " ") : "";
  }

  /** Narx maydonlarini bog'laydi: raqam ajratish + berilgan ish. */
  function bindMoney(ids, after) {
    ids.forEach((id) => {
      const el = $(id);
      if (!el) return;
      el.oninput = () => {
        moneyInput(el);
        if (after) after();
      };
    });
  }

  /* ==================================================================
     AKSIYA — Avto_A1 modeli: ESKI NARX yoziladi, chegirma O'ZI hisoblanadi

     ILGARI NIMA BUZILGAN EDI
     Forma «Flash chegirma» deb so'rardi va IKKI maydon MAJBURIY edi:
     chegirma narxi VA necha soat. Saqlash sharti quyidagicha edi:

         if (flash && flash < price && flashH > 0) { ... }

     Ya'ni soatni to'ldirmasangiz chegirma UMUMAN yozilmasdi — admin narx
     kiritadi, «saqlandi» xabarini ko'radi, lekin do'konda chegirma yo'q.
     Buning ustiga maydonlar TESKARI edi: «narx» maydoniga ASL narx,
     «chegirma» maydoniga sotuv narxi yozilardi.

     Do'kon esa ODDIY mantiq bilan ishlaydi (`app.js: discountPercent`):

         old_price > price  ->  chegirma = (old_price − price) / old_price

     Shu sababli forma ham shunday bo'ldi: «Narxi» — hozirgi sotuv narxi,
     «Eski narx» — undan KATTA son. Chegirma foizi darhol ko'rinadi.
     Soat — IXTIYORIY: to'ldirilsa `flashUntil` yoziladi (taymer), bo'sh
     qoldirilsa chegirma muddatsiz turadi.
     ================================================================== */
  function saleNote() {
    const el = $("shop-sale-note");
    if (!el) return;
    const price = parseNum($("shop-price") && $("shop-price").value);
    const oldp = parseNum($("shop-old") && $("shop-old").value);

    if (!oldp) {
      el.className = "apx-sale-note";
      el.textContent = "Bo'sh qoldirilsa — aksiya yo'q.";
      return;
    }
    if (!price) {
      el.className = "apx-sale-note is-warn";
      el.textContent = "Avval hozirgi narxni kiriting.";
      return;
    }
    if (oldp <= price) {
      el.className = "apx-sale-note is-warn";
      el.textContent = "⚠️ Eski narx hozirgi narxdan KATTA bo'lishi kerak.";
      return;
    }
    const off = Math.round(((oldp - price) / oldp) * 100);
    el.className = "apx-sale-note is-ok";
    el.textContent = "🔥 Chegirma −" + off + "% · " + money(oldp) + " → " + money(price);
  }

  /* ==================================================================
     TAVSIF — tayyor shablonlar (Avto_A1 addDescTemplate)
     ================================================================== */
  const DESC_TPL = [
    ["✅ Original", "✅ Original mahsulot, sifat kafolatlanadi."],
    ["🛡 Kafolat", "🛡 1 yil kafolat beriladi."],
    ["🚚 Yetkazish", "🚚 Samarqand bo'ylab yetkazib berish mavjud."],
    ["🔧 O'rnatish", "🔧 O'rnatish xizmati mavjud."],
    ["💡 5500K", "💡 Yorug'lik harorati 5500K — kunduzgi oq nur."],
  ];

  function descTplChips() {
    return DESC_TPL.map(
      (t, i) => '<button type="button" class="apx-tpl-chip" data-tpl="' + i + '">' + esc(t[0]) + "</button>"
    ).join("");
  }

  function bindDesc() {
    const area = $("shop-desc");
    const count = $("shop-desc-count");
    const paint = () => {
      if (count && area) count.textContent = String((area.value || "").length);
    };
    if (area) area.oninput = paint;
    paint();

    document.querySelectorAll("#shop-tpl .apx-tpl-chip").forEach((btn) => {
      btn.onclick = () => {
        haptic();
        const t = DESC_TPL[Number(btn.dataset.tpl)];
        if (!t || !area) return;
        // Ikki marta bosilsa takrorlanmasin
        if (area.value.indexOf(t[1]) !== -1) return toast("Bu matn allaqachon bor");
        area.value = area.value.trim() ? area.value.trim() + "\n" + t[1] : t[1];
        paint();
      };
    });

    const mic = $("shop-mic");
    if (mic) mic.onclick = () => startVoice("shop-desc");
  }

  /** Ovozdan yozish (qurilma qo'llasa). */
  function startVoice(targetId) {
    const Rec = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Rec) return toast("Bu telefonda ovozli kiritish yo'q");
    const el = $(targetId);
    if (!el) return;
    try {
      const rec = new Rec();
      rec.lang = "uz-UZ";
      rec.interimResults = false;
      rec.maxAlternatives = 1;
      toast("🎤 Gapiring...");
      haptic("medium");
      rec.onresult = (e) => {
        const text = ((e.results[0] && e.results[0][0] && e.results[0][0].transcript) || "").trim();
        if (!text) return;
        el.value = el.value.trim() ? el.value.trim() + " " + text : text;
        if ($("shop-desc-count")) $("shop-desc-count").textContent = String(el.value.length);
        haptic("ok");
        toast("✅ Yozildi");
      };
      rec.onerror = () => toast("Ovoz tushunilmadi, qaytaring");
      rec.start();
    } catch (_) {
      toast("Ovozli kiritish ishlamadi");
    }
  }

  /* ==================================================================
     JONLI KO'RINISH (Avto_A1 lp-card — do'kon kartochkasi)
     ================================================================== */
  function livePreview() {
    const box = $("shop-live");
    if (!box) return;
    const name = ($("shop-name") && $("shop-name").value.trim()) || "";
    const price = parseNum($("shop-price") && $("shop-price").value);
    const oldp = parseNum($("shop-old") && $("shop-old").value);
    const code = ($("shop-code") && $("shop-code").value.trim()) || "";
    const badge = ($("shop-badge") && $("shop-badge").value.trim()) || "";
    const warranty = ($("shop-warranty") && $("shop-warranty").value.trim()) || "";
    // Yuklanayotgan rasm ham ko'rinadi — kartochka ImgBB javobini kutmaydi.
    const firstJob = (S.jobs || []).filter((j) => j.localUrl && !j.error)[0];
    const img = readImgUrls()[0] || (firstJob && firstJob.localUrl) || "";

    saleNote();

    if (!name && !price && !img) {
      box.innerHTML =
        '<div class="lp-empty">Maydonlarni to\'ldiring — bu yerda mijozga qanday ko\'rinishi chiqadi</div>';
      return;
    }
    const main = String(name || "Tovar nomi").split("·")[0].trim();
    const hasSale = oldp && price && oldp > price;
    const off = hasSale ? Math.round(((oldp - price) / oldp) * 100) : 0;

    box.innerHTML =
      '<div class="lp-card">' +
      (img ? '<img src="' + esc(img) + '" alt="">' : '<div class="lp-noimg">💡</div>') +
      '<div style="flex:1;min-width:0;">' +
      '<div class="lp-name">' +
      esc(main) +
      "</div>" +
      (code ? '<div class="lp-code">🔖 ' + esc(code) + "</div>" : "") +
      '<div class="lp-price">' +
      esc(money(price || 0)) +
      (hasSale ? ' <s class="lp-was">' + esc(money(oldp)) + "</s>" : "") +
      (off ? ' <span class="lp-off">-' + off + "%</span>" : "") +
      "</div>" +
      (warranty ? '<div class="lp-war">🛡 ' + esc(warranty) + " kafolat</div>" : "") +
      /* Razmerlar — mijoz kartochkani ochganda AYNAN shu chiplarni ko'radi.
         Nomi yozilmagan qatorlar chizilmaydi (hali to'ldirilmoqda). */
      (S.typeSel === "razmerli" && S.sizes.some((s) => s.size)
        ? '<div class="lp-sizes">' +
          S.sizes
            .filter((s) => s.size)
            .map(
              (s) =>
                '<span class="lp-size' + (Number(s.stock) > 0 ? "" : " is-out") + '">' +
                esc(s.size) + "</span>"
            )
            .join("") +
          "</div>"
        : "") +
      /* Mos mashinalar — ko'p tanlangan bo'lsa mijoz shu satrni ko'radi */
      (selectedCarNames().length
        ? '<div class="lp-cars">🚗 ' + esc(selectedCarNames().join(", ")) + "</div>"
        : "") +
      "</div>" +
      (badge ? '<span class="lp-badge">' + esc(badge) + "</span>" : "") +
      "</div>";
  }

  /* ==================================================================
     KATEGORIYA VA MASHINA CHIPLARI (Zimmer)
     ================================================================== */
  function chipsBlock() {
    let html =
      '<div class="admin-form-group"><div class="apx-head">' +
      '<div class="apx-ic" style="color:#30d158;">🗂</div>' +
      '<div class="apx-tx"><b>Kategoriya</b><span>Do\'kondagi bo\'lim</span></div></div>' +
      '<div class="shop-chips" id="shop-cats">';
    if (!S.cats.length) {
      html += '<div class="adm-hint">Kategoriya topilmadi.</div>';
    } else {
      html += S.cats
        .map(
          (c) =>
            '<button type="button" class="cat-chip shop-cat" data-cat="' +
            esc(c.name) +
            '">' +
            (c.icon ? esc(c.icon) + " " : "") +
            esc(c.name) +
            "</button>"
        )
        .join("");
    }
    html += "</div>";

    /* ---- TOVAR TURI (kategoriyadan KEYIN so'raladi)
       Tartib ataylab shunday: admin avval «qaysi bo'limga» deb o'ylaydi,
       keyin «bu razmerli tovarmi?» degan savolga javob beradi. Ikki savol
       aralashib ketmasin. */
    html +=
      '<div class="apx-sub">Tovar turi</div>' +
      '<div class="shop-chips" id="shop-types">' +
      '<button type="button" class="cat-chip shop-type" data-type="oddiy">📦 Razmersiz</button>' +
      '<button type="button" class="cat-chip shop-type" data-type="razmerli">📐 Razmerli</button>' +
      "</div>" +
      '<div class="apx-sale-note" id="shop-type-note"></div>';

    html += "</div>"; // kategoriya + tur guruhi yopiladi

    /* ---- RAZMERLAR — alohida guruh, faqat «razmerli» da ko'rinadi */
    html += sizesBlock();

    /* ---- MASHINALAR — KO'P TANLOV */
    if (S.cars.length) {
      html +=
        '<div class="admin-form-group"><div class="apx-head">' +
        '<div class="apx-ic apx-ic-blue">🚗</div>' +
        '<div class="apx-tx"><b>Mos mashinalar</b>' +
        "<span>Nechtasini xohlasangiz belgilang</span></div></div>" +
        '<div class="shop-chips" id="shop-cars">' +
        '<button type="button" class="cat-chip shop-car is-all" data-car="">🌐 Universal (hammasi)</button>' +
        S.cars
          .map(
            (c) =>
              '<button type="button" class="cat-chip shop-car" data-car="' +
              esc(String(c.id)) +
              '">' +
              esc(c.name) +
              "</button>"
          )
          .join("") +
        "</div>" +
        '<div class="apx-sale-note" id="shop-car-note"></div>' +
        "</div>";
    }
    return html;
  }

  /* ==================================================================
     RAZMERLI TOVAR (Avto_A1 modeli)

     NEGA KERAK
     Bitta «Bi-LED linza» nomi ostida 2.5" va 3" turadi; lampa H4, H7,
     H11 bo'ladi. Ilgari admin ularni ALOHIDA tovar qilib kiritishga
     majbur edi: bir xil rasm, bir xil tavsif, bir xil narx — faqat
     nomining oxiri boshqa. Natijada do'konda bir xil kartochka besh
     marta turardi va qoldiqni beshta joyda alohida yuritish kerak edi.

     ENDI: bitta tovar, ichida razmerlar ro'yxati va HAR RAZMERNING O'Z
     QOLDIG'I. Umumiy `stock` — razmer qoldiqlarining YIG'INDISI, shuning
     uchun savat, buyurtma va «tugagan» belgisi hech qanday o'zgarishsiz
     ishlashda davom etadi.
     ================================================================== */

  /* ------------------------------------------------------------------
     RTDB MASSIVLARINI O'QISH

     Realtime Database bo'sh kataklari bor massivni LUG'AT qilib qaytaradi
     (`{"0": {...}, "2": {...}}`). Shuning uchun `Array.isArray()` bilan
     tekshirish yetarli emas — ikki shaklni ham tekislaymiz. Bir joyda,
     bir marta: bu xato turdagi ma'lumot butun panelni yiqitishi mumkin.
     ------------------------------------------------------------------ */
  function rowsOfAny(raw) {
    if (Array.isArray(raw)) return raw;
    if (raw && typeof raw === "object") return Object.values(raw);
    return [];
  }

  /** `[{size:"H4", stock:3}]` — nomsiz qatorlar tashlab ketiladi. */
  function normSizes(raw) {
    return rowsOfAny(raw)
      .filter((s) => s && typeof s === "object" && String(s.size || "").trim())
      .map((s) => ({
        size: String(s.size).trim().slice(0, 40),
        stock: Math.max(0, Number(s.stock) || 0),
      }));
  }

  /** `["Damas","Labo"]` — eski yozuvdagi bitta `carName` ham qabul qilinadi. */
  function normCars(raw, single) {
    const list = rowsOfAny(raw)
      .map((v) => String(v == null ? "" : v).trim())
      .filter(Boolean);
    if (list.length) return list;
    const one = String(single == null ? "" : single).trim();
    return one ? [one] : [];
  }

  /** Tez tanlash uchun tipik razmerlar (ro'yxat CHEKLOV emas — qo'lda
   *  xohlagan matnni yozish mumkin: «2.5 dyuym», «46-48» va h.k.). */
  const SIZE_TPL = [
    "H1", "H3", "H4", "H7", "H11", "HB3", "HB4",
    "D2S", "D4S", '2.5"', '3"',
    "S", "M", "L", "XL", "XXL",
  ];

  function sizesBlock() {
    return (
      '<div class="admin-form-group' +
      (S.typeSel === "razmerli" ? "" : " hidden") +
      '" id="shop-sizes-group"><div class="apx-head">' +
      '<div class="apx-ic apx-ic-gold">📐</div>' +
      '<div class="apx-tx"><b>Razmerlar va qoldiq</b>' +
      "<span>Har razmerning soni alohida</span></div></div>" +
      '<div class="apx-tpl" id="shop-size-tpl">' +
      SIZE_TPL.map(
        (s) =>
          '<button type="button" class="apx-tpl-chip shop-size-tpl" data-size="' +
          esc(s) + '">' + esc(s) + "</button>"
      ).join("") +
      "</div>" +
      '<div class="shop-sizes" id="shop-sizes-list"></div>' +
      '<button type="button" class="apx-voice" id="shop-size-add">＋ Razmer qo\'shish</button>' +
      '<div class="apx-sale-note" id="shop-size-note"></div>' +
      "</div>"
    );
  }

  /** Ekrandagi qatorlardan `S.sizes` ni yangilaydi (qayta chizishdan OLDIN
   *  chaqiriladi — aks holda admin yozgan qiymat yo'qoladi). */
  function readSizeRows() {
    const box = $("shop-sizes-list");
    if (!box) return;
    S.sizes = [...box.querySelectorAll(".shop-size-row")].map((row) => ({
      size: (row.querySelector(".shop-size-name").value || "").trim(),
      stock: Math.max(0, parseNum(row.querySelector(".shop-size-stock").value) || 0),
    }));
  }

  /** Razmer qatorlarini chizadi va izohni yangilaydi. */
  function renderSizeRows() {
    const box = $("shop-sizes-list");
    if (!box) return;
    box.innerHTML = S.sizes.length
      ? S.sizes
          .map(
            (s, i) =>
              '<div class="shop-size-row" data-i="' + i + '">' +
              '<input type="text" class="admin-input shop-size-name" maxlength="40" ' +
              'placeholder="Razmer (mas: H4)" value="' + esc(s.size || "") + '">' +
              '<input type="text" inputmode="numeric" class="admin-input shop-size-stock" ' +
              'placeholder="Soni" value="' + (Number(s.stock) || 0) + '">' +
              '<button type="button" class="shop-size-del" data-i="' + i + '" ' +
              'aria-label="O\'chirish">✕</button>' +
              "</div>"
          )
          .join("")
      : '<div class="adm-hint">Hali razmer qo\'shilmadi — tepadagi chiplardan tanlang yoki «＋ Razmer qo\'shish».</div>';

    bindSizeRows();
    sizeNote();
  }

  function bindSizeRows() {
    const box = $("shop-sizes-list");
    if (!box) return;
    box.querySelectorAll(".shop-size-del").forEach((btn) => {
      btn.onclick = () => {
        haptic("light");
        readSizeRows();
        S.sizes.splice(Number(btn.dataset.i), 1);
        renderSizeRows();
      };
    });
    // Yozilganda faqat IZOH yangilanadi — qatorlar qayta chizilmaydi,
    // aks holda har harfda kursor maydondan uchib ketardi.
    box.querySelectorAll(".shop-size-name, .shop-size-stock").forEach((inp) => {
      inp.oninput = () => {
        readSizeRows();
        sizeNote();
        livePreview();
      };
    });
  }

  /** «Jami: 7 dona · 3 razmer» — admin yig'indini ko'rib turadi. */
  function sizeNote() {
    const note = $("shop-size-note");
    if (!note) return;
    const filled = S.sizes.filter((s) => s.size);
    const total = filled.reduce((sum, s) => sum + (Number(s.stock) || 0), 0);
    note.textContent = filled.length
      ? "Jami: " + total + " dona · " + filled.length + " razmer"
      : "Kamida bitta razmer nomi kerak.";
  }

  function addSizeRow(name) {
    readSizeRows();
    // Ayni razmer allaqachon bor bo'lsa takrorlamaymiz — faqat belgilaymiz
    const exists = S.sizes.findIndex(
      (s) => s.size.toLowerCase() === String(name || "").toLowerCase() && s.size
    );
    if (name && exists !== -1) {
      toast("«" + name + "» allaqachon ro'yxatda");
      return;
    }
    if (S.sizes.length >= 40) return toast("40 tadan ko'p razmer bo'lmasin");
    S.sizes.push({ size: name || "", stock: 0 });
    renderSizeRows();
    // Bo'sh qator qo'shilgan bo'lsa darhol yozishga tayyor turadi
    if (!name) {
      const rows = $("shop-sizes-list").querySelectorAll(".shop-size-name");
      const last = rows[rows.length - 1];
      if (last) last.focus();
    }
  }

  /** Tur o'zgarganda: razmer bloki va umumiy «Qoldiq» maydoni
   *  bir-birini ALMASHTIRADI (ikkisi birga turmaydi — chalkashtiradi). */
  function paintType() {
    document.querySelectorAll("#shop-types .shop-type").forEach((b) => {
      b.classList.toggle("selected", b.dataset.type === S.typeSel);
    });
    const sized = S.typeSel === "razmerli";
    const group = $("shop-sizes-group");
    if (group) group.classList.toggle("hidden", !sized);
    const stockWrap = $("shop-stock-wrap");
    if (stockWrap) stockWrap.classList.toggle("hidden", sized);
    const note = $("shop-type-note");
    if (note) {
      note.textContent = sized
        ? "Razmerli: har razmerning soni alohida yoziladi, umumiy qoldiq o'zi hisoblanadi."
        : "Razmersiz: bitta umumiy qoldiq (yuqoridagi «Qoldiq» maydoni).";
    }
    if (sized) renderSizeRows();
    livePreview();
  }

  /** «🌐 Universal» yoki «Damas, Labo va yana 3 ta» izohi. */
  function carNote() {
    const note = $("shop-car-note");
    if (!note) return;
    const names = selectedCarNames();
    if (!names.length) {
      note.textContent = "Universal — do'konda hamma mashina egasiga ko'rinadi.";
      return;
    }
    const head = names.slice(0, 4).join(", ");
    note.textContent =
      "Tanlandi (" + names.length + "): " +
      head +
      (names.length > 4 ? " va yana " + (names.length - 4) + " ta" : "");
  }

  function selectedCarNames() {
    return S.carSels
      .map((id) => (S.cars.find((c) => String(c.id) === String(id)) || {}).name)
      .filter(Boolean);
  }

  function paintCars() {
    document.querySelectorAll("#shop-cars .shop-car").forEach((btn) => {
      const id = btn.dataset.car || "";
      if (!id) {
        // «Universal» — hech biri tanlanmaganda yonadi
        btn.classList.toggle("selected", S.carSels.length === 0);
        return;
      }
      btn.classList.toggle("selected", S.carSels.some((x) => String(x) === id));
    });
    carNote();
  }

  function bindChips() {
    document.querySelectorAll("#shop-cats .shop-cat").forEach((btn) => {
      btn.onclick = () => {
        haptic();
        S.catSel = btn.dataset.cat;
        document.querySelectorAll("#shop-cats .shop-cat").forEach((b) => b.classList.remove("selected"));
        btn.classList.add("selected");
      };
      if (btn.dataset.cat === S.catSel) btn.classList.add("selected");
    });

    // ---- tovar turi
    document.querySelectorAll("#shop-types .shop-type").forEach((btn) => {
      btn.onclick = () => {
        haptic();
        S.typeSel = btn.dataset.type === "razmerli" ? "razmerli" : "oddiy";
        // Razmerliga o'tildi, lekin ro'yxat bo'sh — bitta bo'sh qator
        // beramiz, aks holda admin nima qilishini bilmay turadi.
        if (S.typeSel === "razmerli" && !S.sizes.length) S.sizes = [{ size: "", stock: 0 }];
        paintType();
      };
    });

    // ---- razmer chiplari va «＋ qo'shish»
    document.querySelectorAll("#shop-size-tpl .shop-size-tpl").forEach((chip) => {
      chip.onclick = () => {
        haptic("light");
        addSizeRow(chip.dataset.size);
      };
    });
    if ($("shop-size-add")) {
      $("shop-size-add").onclick = () => {
        haptic("light");
        addSizeRow("");
      };
    }

    /* ---- MASHINALAR: KO'P TANLOV
       «Universal» — alohida mantiq: u tanlovni TOZALAYDI. Qolganlari
       oddiy kalit (bosildi — yondi, yana bosildi — o'chdi). */
    document.querySelectorAll("#shop-cars .shop-car").forEach((btn) => {
      btn.onclick = () => {
        haptic("light");
        const id = btn.dataset.car || "";
        if (!id) {
          S.carSels = [];
        } else {
          const at = S.carSels.findIndex((x) => String(x) === id);
          if (at === -1) S.carSels.push(id);
          else S.carSels.splice(at, 1);
        }
        paintCars();
        livePreview();
      };
    });

    paintType();
    paintCars();
  }

  /* ==================================================================
     ASOSIY MA'LUMOTLAR bloki (nom/narx/kod/flash/qoldiq)
     ================================================================== */
  function mainBlock() {
    return (
      /* ---- asosiy ma'lumotlar ---- */
      '<div class="admin-form-group"><div class="apx-head">' +
      '<div class="apx-ic">🏷</div>' +
      "<div class=\"apx-tx\"><b>Asosiy ma'lumotlar</b><span>Nomi · narxi · qoldiq</span></div></div>" +
      '<input type="text" class="admin-input" id="shop-name" placeholder="Tovar nomi (mas: Bi-LED linza)">' +
      '<input type="text" inputmode="numeric" class="admin-input" id="shop-price" placeholder="Narxi — hozirgi sotuv narxi (so\'m)">' +
      '<input type="text" class="admin-input" id="shop-code" placeholder="Artikul / OEM kod (ixtiyoriy)">' +
      '<input type="text" class="admin-input" id="shop-badge" placeholder="Belgi — mas: Yangi, TOP (ixtiyoriy)">' +
      /* Umumiy qoldiq — FAQAT «razmersiz» tovar uchun. Razmerliga
         o'tilganda bu maydon yashiriladi (`paintType`) va qoldiq razmerlar
         yig'indisidan hisoblanadi: ikkita qarama-qarshi raqam bir ekranda
         turmasin. */
      '<div id="shop-stock-wrap">' +
      '<input type="number" inputmode="numeric" class="admin-input" id="shop-stock" placeholder="Qoldiq (dona)" value="10">' +
      "</div>" +
      "</div>" +
      /* ---- aksiya ---- */
      '<div class="admin-form-group apx-sale"><div class="apx-head">' +
      '<div class="apx-ic apx-ic-red">🔥</div>' +
      "<div class=\"apx-tx\"><b>Aksiya (ixtiyoriy)</b><span>Eski narxni yozing — chegirma o'zi hisoblanadi</span></div></div>" +
      '<input type="text" inputmode="numeric" class="admin-input" id="shop-old" placeholder="Eski narx — hozirgi narxdan KATTA">' +
      '<div class="apx-sale-note" id="shop-sale-note">Bo\'sh qoldirilsa — aksiya yo\'q.</div>' +
      '<input type="number" class="admin-input" id="shop-flash-h" placeholder="Necha soat (bo\'sh = muddatsiz)" step="0.5" min="0">' +
      "</div>" +
      /* ---- kafolat ---- */
      warrantyBlock() +
      /* ---- tavsif ---- */
      '<div class="admin-form-group"><div class="apx-head">' +
      '<div class="apx-ic apx-ic-blue">💬</div>' +
      '<div class="apx-tx"><b>Tavsif</b><span>Mijoz uchun qisqa izoh</span></div></div>' +
      '<div class="apx-desc-box">' +
      '<textarea class="apx-desc" id="shop-desc" rows="5" maxlength="500" ' +
      'placeholder="Masalan: original linza, 5500K, 1 yil kafolat..."></textarea>' +
      '<div class="apx-desc-foot"><span id="shop-desc-count">0</span> / 500</div>' +
      "</div>" +
      '<div class="apx-tpl" id="shop-tpl">' +
      descTplChips() +
      "</div>" +
      '<button type="button" class="apx-voice" id="shop-mic">🎤 Ovoz bilan ayting</button>' +
      "</div>"
    );
  }

  /* ==================================================================
     KAFOLAT MUDDATI — har tovar uchun ALOHIDA

     NEGA KERAK
     Ilgari do'kon kartochkasida «🛡 14 kun kafolat» degan QATTIQ matn
     turardi — barcha tovarlar uchun bir xil va noto'g'ri. Linzaga 1 yil,
     lampaga 3 oy, mayda ehtiyot qismga esa umuman kafolat bermaslik
     mumkin. Endi muddatni admin har tovarga o'zi qo'yadi.

     Chiplar — faqat tez tanlash uchun. Maydonga xohlagan matnni yozish
     mumkin («19 kun», «2 yil 6 oy»), ya'ni ro'yxat cheklov emas.
     Bo'sh qoldirilsa — kartochkada kafolat satri UMUMAN chiqmaydi.
     ================================================================== */
  const WARRANTY_TPL = ["1 yil", "6 oy", "3 oy", "1 oy", "14 kun", "7 kun"];

  function warrantyBlock() {
    return (
      '<div class="admin-form-group"><div class="apx-head">' +
      '<div class="apx-ic apx-ic-gold">🛡</div>' +
      '<div class="apx-tx"><b>Kafolat muddati</b>' +
      "<span>Mijoz tovar kartochkasida ko'radi</span></div></div>" +
      '<div class="apx-tpl" id="shop-war-tpl">' +
      WARRANTY_TPL.map(
        (w) =>
          '<button type="button" class="apx-tpl-chip shop-war" data-war="' +
          esc(w) + '">' + esc(w) + "</button>"
      ).join("") +
      '<button type="button" class="apx-tpl-chip is-clear" data-war="">✕ Yo\'q</button>' +
      "</div>" +
      '<input type="text" class="admin-input" id="shop-warranty" maxlength="40" ' +
      "placeholder=\"Yoki o'zingiz yozing: 19 kun, 2 yil 6 oy...\">" +
      '<div class="apx-sale-note" id="shop-war-note">' +
      "Bo'sh qoldirilsa — kafolat ko'rsatilmaydi.</div>" +
      "</div>"
    );
  }

  /** Kafolat maydoni: chiplar, jonli izoh va tanlangan chipni belgilash. */
  function bindWarranty() {
    const input = $("shop-warranty");
    const note = $("shop-war-note");
    const chips = document.querySelectorAll("#shop-war-tpl .apx-tpl-chip");

    const paint = () => {
      const v = ((input && input.value) || "").trim();
      if (note) {
        note.textContent = v
          ? "Kartochkada: 🛡 " + v + " kafolat"
          : "Bo'sh qoldirilsa — kafolat ko'rsatilmaydi.";
      }
      // Qo'lda yozilgan muddat chiplardan biriga to'g'ri kelsa — u yonadi
      chips.forEach((c) =>
        c.classList.toggle("selected", !!v && (c.dataset.war || "") === v)
      );
      livePreview();
    };

    chips.forEach((chip) => {
      chip.onclick = () => {
        haptic();
        if (input) input.value = chip.dataset.war || "";
        paint();
      };
    });
    if (input) input.oninput = paint;
    paint();
  }

  /** Add va Edit formalari uchun UMUMIY bog'lashlar. */
  function bindForm() {
    bindPhotos();
    bindChips();
    bindDesc();
    bindWarranty();
    // Narx maydonlari: raqamlar ajratiladi + jonli kartochka yangilanadi
    bindMoney(["shop-price", "shop-old"], livePreview);
    ["shop-name", "shop-code", "shop-badge"].forEach((id) => {
      if ($(id)) $(id).oninput = livePreview;
    });
    if ($("shop-flash-h")) $("shop-flash-h").oninput = saleNote;
    renderThumbs(); // ichida livePreview() ham bor
  }

  /* ==================================================================
     YANGI TOVAR
     ================================================================== */
  function openAdd() {
    S.view = "add";
    S.editing = null;
    clearPhotos();
    S.catSel = null;
    S.carSels = [];
    S.typeSel = "oddiy";
    S.sizes = [];
    setHead("Yangi tovar", "Rasm · nom · narx · kategoriya");
    body().innerHTML =
      '<div class="adm-form">' +
      photoBlock() +
      '<div class="admin-form-group" style="padding-top:16px;">' +
      '<div class="apx-sub" style="margin-top:0;">Mijozga qanday ko\'rinadi</div>' +
      '<div id="shop-live" class="live-preview-box"></div></div>' +
      mainBlock() +
      chipsBlock() +
      "</div>" +
      '<div class="shop-footer"><button class="btn btn-primary" id="shop-save">💾 Saqlash</button></div>';

    bindForm();
    $("shop-save").onclick = () => saveProduct(null);
  }

  /** Formadan tovar obyektini yig'adi (add va edit uchun umumiy). */
  function collect() {
    const name = ($("shop-name").value || "").trim();
    const price = parseNum($("shop-price").value);
    const stock = parseNum($("shop-stock").value);
    const code = ($("shop-code").value || "").trim();
    const badge = ($("shop-badge") && $("shop-badge").value.trim()) || "";
    const desc = ($("shop-desc") && $("shop-desc").value.trim()) || "";
    const warranty = ($("shop-warranty") && $("shop-warranty").value.trim()) || "";
    const photos = photoUrls();
    const oldp = parseNum($("shop-old") && $("shop-old").value);
    const flashH =
      parseFloat(String(($("shop-flash-h") && $("shop-flash-h").value) || "").replace(",", ".")) || 0;

    if (name.length < 2) return { err: "Tovar nomini kiriting" };
    if (name.length > 160) return { err: "Nom juda uzun (160 belgigacha)" };
    if (!price) return { err: "Narxni kiriting" };
    if (!S.catSel) return { err: "Kategoriyani tanlang" };

    /* ---- TUR VA QOLDIQ
       Razmerli tovarda umumiy «Qoldiq» maydoni yashirin, shuning uchun
       uni TEKSHIRMAYMIZ — qoldiq razmerlar yig'indisidan chiqadi. */
    const sized = S.typeSel === "razmerli";
    let sizes = [];
    let total = stock;

    if (sized) {
      readSizeRows();
      sizes = S.sizes
        .map((s) => ({ size: String(s.size || "").trim().slice(0, 40), stock: Math.max(0, Number(s.stock) || 0) }))
        .filter((s) => s.size);
      if (!sizes.length) return { err: "Kamida bitta razmer nomini yozing" };
      if (sizes.length > 40) return { err: "40 tadan ko'p razmer bo'lmasin" };
      // Bir razmer ikki marta yozilib qolsa, do'konda ikkita bir xil chip
      // chiqadi va mijoz qaysi biri to'g'ri ekanini bilmaydi.
      const seen = {};
      for (const s of sizes) {
        const key = s.size.toLowerCase();
        if (seen[key]) return { err: "«" + s.size + "» razmeri ikki marta yozilgan" };
        seen[key] = true;
      }
      total = sizes.reduce((sum, s) => sum + s.stock, 0);
    } else if (stock === null) {
      return { err: "Qoldiqni kiriting (0 bo'lishi mumkin)" };
    }

    // Avto_A1 da kamida 1 rasm MAJBURIY — rasmsiz tovar do'konda bo'sh
    // kvadrat bo'lib turadi va hech kim bosmaydi.
    if (!photos.length) return { err: "Kamida 1 ta rasm kerak" };
    for (const u of photos) {
      if (!/^https?:\/\/[^\s]+$/i.test(u)) return { err: "Rasm havolasi http(s) bo'lishi kerak" };
    }
    // Aksiya: eski narx berilgan bo'lsa u hozirgidan KATTA bo'lishi shart.
    // Ilgari bu jimgina e'tiborsiz qoldirilardi — admin chegirma qo'ydim
    // deb o'ylardi, do'konda esa hech narsa o'zgarmasdi.
    if (oldp && oldp <= price) {
      return { err: "Eski narx hozirgi narxdan KATTA bo'lishi kerak" };
    }
    // Yuklanish tugamagan bo'lsa saqlamaymiz — aks holda tovar RASMSIZ
    // qolib ketadi (havola hali kelmagan).
    if (busyPhotos()) return { err: "⏳ Rasm yuklanmoqda — bir lahza kuting" };

    /* ---- MASHINALAR
       `carNames` — HAQIQIY ro'yxat (ko'p tanlov). `carName` esa BIRINCHISI:
       u `services/sync.py: _catalog_payload` orqali SQLite'ning bitta
       `car_id` ustuniga tushadi. Ya'ni eski server tomoni hech narsani
       sezmaydi, do'kon esa to'liq ro'yxatni ko'radi. */
    const carNames = selectedCarNames();

    // Maydonlar `services/sync.py: _catalog_payload` bilan MOS.
    const rec = {
      _key: name,
      name: name,
      description: desc || null,
      price: price,
      old_price: null,
      stock: total,
      code: code || null,
      badge: badge || null,
      photo_url: photos[0] || null,
      photo_id: null,
      photo2_url: photos[1] || null,
      photo2_id: null,
      photo3_url: photos[2] || null,
      photo3_id: null,
      is_active: 1,
      deleted: false,
      categoryName: S.catSel,
      carName: carNames[0] || null,
      /* Ko'p mashina. Bo'sh massiv ATAYLAB `null`: RTDB bo'sh massivni
         saqlamaydi (kalitni o'chiradi) va `patch` bilan tahrirlashda eski
         ro'yxat qolib ketardi — «Universal» ga qaytarish ishlamasdi. */
      carNames: carNames.length ? carNames : null,
      /* Tovar turi va razmerlar. Razmersiz tovarda `sizes` ATAYLAB `null` —
         tur «razmerli» dan «razmersiz» ga o'zgartirilganda eski razmerlar
         bulutda qolib ketmasin (`patch` faqat berilgan kalitni yozadi). */
      product_type: sized ? "razmerli" : "oddiy",
      sizes: sized ? sizes : null,
      /* Kafolat muddati — erkin matn («1 yil», «3 oy», «19 kun»).
         Bo'sh bo'lsa ATAYLAB `null` yoziladi (bo'sh matn emas): mijoz
         tomonida `p.warranty` tekshiruvi bitta bo'lib qoladi va tahrirlashda
         kafolatni O'CHIRISH ham ishlaydi (`patch` null bilan ustiga yozadi). */
      warranty: warranty || null,
      updatedAt: Date.now(),
      source: "miniapp",
    };

    /* AKSIYA — Avto_A1 modeli. `price` = hozirgi sotuv narxi (o'zgarmaydi),
       `old_price` = undan katta eski narx. Do'kon chegirmani shu ikkisidan
       o'zi hisoblaydi (`app.js: discountPercent`). Soat IXTIYORIY: berilsa
       taymer (`flashUntil`), berilmasa chegirma muddatsiz turadi. */
    if (oldp && oldp > price) {
      rec.old_price = oldp;
      rec.flashUntil = flashH > 0 ? Date.now() + Math.round(flashH * 3600000) : null;
    } else {
      rec.old_price = null;
      rec.flashUntil = null;
    }
    return { rec: rec };
  }

  async function saveProduct(existingId) {
    if (S.busy) return;
    const out = collect();
    if (out.err) return toast(out.err);

    S.busy = true;
    const btn = $("shop-save");
    if (btn) {
      btn.disabled = true;
      btn.textContent = "Saqlanmoqda...";
    }
    try {
      let id = existingId;
      if (id == null) {
        id = await fb().nextProductId();
        out.rec.id = id;
        out.rec.createdAt = Date.now();
        await fb().put(P + "/" + id, out.rec);
      } else {
        out.rec.id = Number(id) || id;
        // Tahrir: PATCH — createdAt va boshqa server maydonlariga tegmaymiz.
        await fb().patch(P + "/" + id, out.rec);
      }
      haptic("ok");
      freshenShop(); // bosh sahifa VA localStorage keshi eskirdi

      const seen = await ask(
        existingId == null ? "✅ Tovar qo'shildi.\n\nDo'konda ko'rasizmi?" : "✅ Saqlandi.\n\nDo'konda ko'rasizmi?"
      );
      if (seen && app().show) {
        app().show("home");
        if (app().loadHome) await app().loadHome();
        return;
      }
      openInventory();
    } catch (err) {
      toast((err && err.message) || "Saqlanmadi");
      if (btn) {
        btn.disabled = false;
        btn.textContent = "💾 Saqlash";
      }
    } finally {
      S.busy = false;
    }
  }

  /* ==================================================================
     OMBOR — ZAXIRA NAZORATI

     NEGA QAYTA YOZILDI
     Eski ombor ishlardi, lekin telefonda boshqarish og'ir edi:
       • har harfda BUTUN ro'yxat qayta chizilardi va kursor qo'lda joyiga
         qaytarilardi — ko'p tovarda qidiruv sakraydi va sekinlashadi;
       • faqat ikki filtr bor edi (Hammasi / Kam qolgan). «Tugagan» va
         «Yashirin» sonlari ko'rinardi-yu, ularni BOSIB filtrlash mumkin
         emasdi — ya'ni raqam bor, foydasi yo'q;
       • saralash UMUMAN yo'q edi: qimmat tovarni yoki tugaganini topish
         uchun ro'yxatni ko'z bilan varaqlash kerak edi;
       • qoldiqni bir donaga oshirish uchun ham raqamni qo'lda yozib, ✓ ni
         bosish kerak edi;
       • zaxiraning UMUMIY QIYMATI ko'rsatilmasdi — do'kon uchun eng muhim
         raqam panelda yo'q edi;
       • tovarni yashirish/ko'rsatish uchun tahrirlash oynasini ochish
         kerak edi;
       • ommaviy amallar paneli ro'yxat TEPASIDA turardi: pastga tushsangiz
         ko'rinmasdi va nima belgilaganingiz esdan chiqardi.

     ENDI
       • qidiruv va boshqaruv BIR MARTA chiziladi, faqat ro'yxat yangilanadi
         (kursor sakramaydi); qidiruv nom, kod, kategoriya va mashina bo'yicha;
       • 4 ta bosiladigan hisob kartochkasi = filtr (jami / kam / tugagan /
         yashirin) + «chegirmali» filtri;
       • saralash: ⚠️ diqqat · yangi · narx · qoldiq · nom, yo'nalishi almashadi;
       • qoldiq − va + tugmalari bilan o'zgaradi va O'ZI saqlanadi (✓ kerak
         emas); xato bo'lsa eski qiymat qaytariladi va sabab aytiladi;
       • tepada zaxira qiymati (narx × qoldiq yig'indisi) — sanaladigan raqam;
       • har kartochkada 👁 bilan darhol yashirish/ko'rsatish;
       • ommaviy panel pastga YOPISHADI, «Hammasi» tanlovi bor, amallar
         ⚙ bilan yoyiladi (panel joy egallab turmaydi);
       • uzun ro'yxat 30 talab yuklanadi (pastga tushganda o'zi).
     ================================================================== */

  const INV_PAGE = 30; // bir marta chiziladigan kartochka soni
  const LOW_STOCK = 3; // «kam qoldi» chegarasi
  const INV_SAVE_DELAY = 650; // qoldiqni saqlashdan oldin kutish (ms)

  /** Hisob kartochkalari — bosilganda filtr bo'lib ishlaydi. */
  const INV_FILTERS = [
    { key: "all", icon: "📦", label: "Jami", tone: "" },
    { key: "low", icon: "⚠️", label: "Kam qoldi", tone: "is-low" },
    { key: "out", icon: "✕", label: "Tugagan", tone: "is-out" },
    { key: "hidden", icon: "👁", label: "Yashirin", tone: "is-hidden" },
  ];

  const INV_TESTS = {
    all: () => true,
    low: (p) => p.stock > 0 && p.stock <= LOW_STOCK,
    out: (p) => p.stock <= 0,
    hidden: (p) => !p.is_active,
    sale: (p) => !!p.old_price && p.old_price > p.price,
  };

  /** Qoldiq bo'yicha «shoshilinchlik»: tugagan → kam → yetarli. */
  function stockRank(s) {
    return s <= 0 ? 0 : s <= LOW_STOCK ? 1 : 2;
  }

  const INV_SORTS = [
    { key: "alert", label: "⚠️ Diqqat", cmp: (a, b) => stockRank(a.stock) - stockRank(b.stock) },
    { key: "new", label: "🆕 Yangi", cmp: (a, b) => Number(b.id) - Number(a.id) },
    { key: "price", label: "💰 Narx", cmp: (a, b) => b.price - a.price },
    { key: "stock", label: "📦 Qoldiq", cmp: (a, b) => b.stock - a.stock },
    { key: "name", label: "🔤 Nom", cmp: (a, b) => a.name.localeCompare(b.name, "uz") },
  ];

  const itemOf = (id) => S.items.find((x) => String(x.id) === String(id));

  /* ------------------------------------------------------------ o'qish */

  async function openInventory() {
    S.view = "inventory";
    S.selected = {};
    S.invLimit = INV_PAGE;
    S.invTimers = {};
    S.invBulkOpen = false;
    invStopScroll();
    setHead("📦 Ombor", "Zaxira nazorati");
    body().innerHTML = invSkeleton();

    try {
      const node = await fb().get(P);
      S.items = [];
      if (node && typeof node === "object") {
        Object.keys(node).forEach((k) => {
          const r = node[k];
          if (!r || typeof r !== "object" || r.deleted) return;
          const stock = Number(r.stock) || 0;
          S.items.push({
            id: r.id == null ? k : r.id,
            name: String(r.name || "Nomsiz"),
            price: Number(r.price) || 0,
            old_price: Number(r.old_price) || 0,
            stock: stock,
            _saved: stock, // serverdagi oxirgi tasdiqlangan qiymat
            code: r.code || "",
            is_active: r.is_active !== 0 && r.is_active !== false,
            photo_url: r.photo_url || null,
            photo_id: r.photo_id || null,
            categoryName: r.categoryName || "",
            carName: r.carName || "",
            /* Qidiruv ko'p mashina bo'yicha ham ishlashi kerak: admin
               «labo» deb yozganda Damas+Labo tovari ham chiqsin. */
            carNames: normCars(r.carNames).join(", "),
            /* Razmerli tovarda umumiy qoldiqni QO'LDA o'zgartirish
               yig'indi qoidasini buzadi (`stock` = razmerlar yig'indisi).
               Shu sababli omborda stepper o'chiriladi va admin ✏️ orqali
               razmer qoldig'ini o'zgartiradi. */
            sized: r.product_type === "razmerli" || normSizes(r.sizes).length > 0,
            sizes: normSizes(r.sizes),
            _raw: r,
          });
        });
      }
      renderInventory(true);
    } catch (err) {
      fail(err, openInventory);
    }
  }

  /** Yuklanish paytidagi «suyak» kartochkalar — bo'sh ekran ko'rsatmaydi. */
  function invSkeleton() {
    let rows = "";
    for (let i = 0; i < 5; i++) rows += '<div class="inv-skel"></div>';
    return '<div class="inv-skel-hero"></div><div class="inv-skel-stats"></div>' + rows;
  }

  /* ------------------------------------------------------- hisob-kitob */

  /** Filtr va qidiruvdan o'tgan, saralangan ro'yxat. */
  function invVisible() {
    const q = String(S.query || "").trim().toLowerCase();
    const test = INV_TESTS[S.invFilter] || INV_TESTS.all;
    let list = S.items.filter(test);

    if (q) {
      list = list.filter((p) =>
        [p.name, p.code, p.categoryName, p.carName]
          .join(" ")
          .toLowerCase()
          .indexOf(q) !== -1
      );
    }

    const sort = INV_SORTS.find((s) => s.key === S.invSort) || INV_SORTS[0];
    const dir = S.invDir === "asc" ? -1 : 1;
    list.sort((a, b) => {
      const primary = sort.cmp(a, b) * dir;
      if (primary) return primary;
      return Number(b.id) - Number(a.id); // barqaror tartib
    });
    return list;
  }

  const invValue = (list) =>
    list.reduce((sum, p) => sum + p.price * Math.max(0, p.stock), 0);

  /* --------------------------------------------------------- chizish */

  /** Boshqaruv qismi BIR MARTA chiziladi.
   *  Sabab: ilgari har harfda butun panel qayta chizilib, qidiruv maydoni
   *  fokusdan chiqardi va kursor qo'lda joyiga qaytarilardi. Endi faqat
   *  ro'yxat (`#inv-list`) yangilanadi. */
  function renderInventory(animate) {
    setHead("📦 Ombor", S.items.length + " ta tovar");

    body().innerHTML =
      // ---- zaxira qiymati
      '<div class="inv-hero">' +
      '<span class="inv-hero-lb">Zaxira qiymati</span>' +
      '<b id="inv-hero-val">0</b>' +
      '<i id="inv-hero-sub"></i>' +
      "</div>" +
      // ---- bosiladigan hisob kartochkalari
      '<div class="inv-stats" id="inv-stats"></div>' +
      // ---- qidiruv
      '<div class="inv-search">' +
      '<span class="inv-search-ic">🔍</span>' +
      '<input type="text" id="inv-q" class="inv-search-in" autocomplete="off" ' +
      'placeholder="Nom, kod, kategoriya yoki mashina..." value="' +
      esc(S.query || "") +
      '">' +
      '<button class="inv-search-x hidden" id="inv-qx" aria-label="Tozalash">✕</button>' +
      "</div>" +
      // ---- saralash
      '<div class="inv-sortbar">' +
      INV_SORTS.map(
        (s) => '<button class="inv-sort" data-s="' + s.key + '">' + esc(s.label) + "</button>"
      ).join("") +
      '<button class="inv-dir" id="inv-dir" aria-label="Yo\'nalish"></button>' +
      "</div>" +
      // ---- chegirmali filtri (alohida — hisob kartochkasi emas)
      '<div class="inv-extra" id="inv-extra"></div>' +
      '<div id="inv-list"></div>' +
      '<div id="inv-more"></div>' +
      '<div id="inv-bulk"></div>';

    // ---- qidiruv (debounce: har harfda ro'yxat qayta chizilmaydi)
    const input = $("inv-q");
    if (input) {
      input.oninput = () => {
        clearTimeout(S.invTyping);
        S.invTyping = setTimeout(() => {
          S.query = input.value;
          S.invLimit = INV_PAGE;
          paintInventory();
        }, 130);
      };
    }
    if ($("inv-qx"))
      $("inv-qx").onclick = () => {
        haptic();
        S.query = "";
        S.invLimit = INV_PAGE;
        if ($("inv-q")) $("inv-q").value = "";
        paintInventory();
      };

    // ---- saralash tugmalari
    document.querySelectorAll(".inv-sort").forEach((b) => {
      b.onclick = () => {
        haptic();
        // Ayni tugma qayta bosilsa — yo'nalish almashadi.
        if (S.invSort === b.dataset.s) S.invDir = S.invDir === "asc" ? "desc" : "asc";
        else {
          S.invSort = b.dataset.s;
          S.invDir = "desc";
        }
        S.invLimit = INV_PAGE;
        paintInventory();
      };
    });
    if ($("inv-dir"))
      $("inv-dir").onclick = () => {
        haptic();
        S.invDir = S.invDir === "asc" ? "desc" : "asc";
        paintInventory();
      };

    paintInventory(animate);
  }

  function paintInventory(animate) {
    if (S.view !== "inventory") return;

    // ---- hisob kartochkalari (filtr sifatida)
    const counts = {};
    INV_FILTERS.forEach((f) => (counts[f.key] = S.items.filter(INV_TESTS[f.key]).length));
    $("inv-stats").innerHTML = INV_FILTERS.map(
      (f) =>
        '<button class="inv-stat ' +
        f.tone +
        (S.invFilter === f.key ? " on" : "") +
        '" data-f="' +
        f.key +
        '"><span>' +
        f.icon +
        "</span><b>" +
        counts[f.key] +
        "</b><i>" +
        esc(f.label) +
        "</i></button>"
    ).join("");
    document.querySelectorAll("#inv-stats .inv-stat").forEach((b) => {
      b.onclick = () => {
        haptic();
        // Ayni filtr qayta bosilsa — hammasiga qaytadi.
        S.invFilter = S.invFilter === b.dataset.f ? "all" : b.dataset.f;
        S.invLimit = INV_PAGE;
        paintInventory();
      };
    });

    // ---- chegirmali tovarlar filtri (bo'lsa ko'rsatiladi)
    const saleCount = S.items.filter(INV_TESTS.sale).length;
    $("inv-extra").innerHTML = saleCount
      ? '<button class="ord-fchip' +
        (S.invFilter === "sale" ? " selected" : "") +
        '" id="inv-f-sale">🔥 Chegirmali <i>' +
        saleCount +
        "</i></button>"
      : "";
    if ($("inv-f-sale"))
      $("inv-f-sale").onclick = () => {
        haptic();
        S.invFilter = S.invFilter === "sale" ? "all" : "sale";
        S.invLimit = INV_PAGE;
        paintInventory();
      };

    // ---- saralash holati
    document.querySelectorAll(".inv-sort").forEach((b) =>
      b.classList.toggle("on", b.dataset.s === S.invSort)
    );
    /* Yo'nalish ko'rsatkichi KONTEKSTLI. Narx/qoldiq uchun ↓ «kattadan
       kichikka», nom uchun esa o'sha strelka «A dan Z ga» degani bo'lardi —
       ikki xil ma'no bitta belgida chalkashtiradi. Shuning uchun nomda
       to'g'ridan «A-Z» / «Z-A» yoziladi. */
    const dirBtn = $("inv-dir");
    if (dirBtn) {
      const isName = S.invSort === "name";
      dirBtn.textContent = isName
        ? S.invDir === "asc"
          ? "Z-A"
          : "A-Z"
        : S.invDir === "asc"
          ? "↑"
          : "↓";
      dirBtn.classList.toggle("wide", isName);
    }
    if ($("inv-qx")) $("inv-qx").classList.toggle("hidden", !S.query);

    // ---- zaxira qiymati
    refreshTotals(animate);

    // ---- ro'yxat
    const list = invVisible();
    const shown = list.slice(0, S.invLimit);

    if (!list.length) {
      $("inv-list").innerHTML = invEmpty();
      $("inv-more").innerHTML = "";
      invStopScroll();
      const add = $("inv-empty-add");
      if (add) add.onclick = openAdd;
      const clear = $("inv-empty-clear");
      if (clear)
        clear.onclick = () => {
          S.query = "";
          S.invFilter = "all";
          if ($("inv-q")) $("inv-q").value = "";
          paintInventory();
        };
      renderBulk();
      return;
    }

    $("inv-list").innerHTML =
      '<div class="inv-list' + (animate ? " enter" : "") + '">' +
      shown.map(invCard).join("") +
      "</div>";
    bindCards(shown);

    // ---- «yana yuklash»
    const rest = list.length - shown.length;
    $("inv-more").innerHTML = rest
      ? '<div class="inv-more" id="inv-sentinel">Yana ' + rest + " ta tovar · pastga tushiring</div>"
      : list.length > INV_PAGE
        ? '<div class="inv-end">Ro\'yxat tugadi · ' + list.length + " ta</div>"
        : "";
    if (rest) {
      invWatchScroll(() => {
        S.invLimit += INV_PAGE;
        paintInventory();
      });
    } else invStopScroll();

    renderBulk();
  }

  /** Zaxira qiymati va ostidagi izoh. */
  function refreshTotals(animate) {
    const list = invVisible();
    const total = invValue(list);
    const units = list.reduce((s, p) => s + Math.max(0, p.stock), 0);
    const hero = $("inv-hero-val");
    const sub = $("inv-hero-sub");
    if (sub) {
      sub.textContent =
        list.length + " ta tovar · " + units + " dona" +
        (S.invFilter !== "all" || S.query ? " (filtr bo'yicha)" : "");
    }
    if (!hero) return;
    if (animate) countTo(hero, total);
    else hero.textContent = money(total);
  }

  /** Raqamni noldan yuqoriga sanaydi (bir martalik, faqat ombor ochilganda). */
  function countTo(node, end) {
    const target = Math.round(Number(end) || 0);
    const reduced =
      window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced || target <= 0) {
      node.textContent = money(target);
      return;
    }
    const dur = 800;
    let t0 = null;
    function step(ts) {
      if (t0 === null) t0 = ts;
      const p = Math.min((ts - t0) / dur, 1);
      node.textContent = money(Math.round((1 - Math.pow(1 - p, 3)) * target));
      if (p < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }

  function invEmpty() {
    if (S.query || S.invFilter !== "all") {
      return (
        '<div class="inv-empty"><div class="inv-empty-ic">🔍</div>' +
        "<b>Tovar topilmadi</b><p>Qidiruv yoki filtrga mos tovar yo'q.</p>" +
        '<button class="btn btn-ghost btn-sm" id="inv-empty-clear">Filtrni tozalash</button></div>'
      );
    }
    return (
      '<div class="inv-empty"><div class="inv-empty-ic">📦</div>' +
      "<b>Ombor bo'sh</b><p>Birinchi tovarni qo'shsangiz, u shu yerda va do'konda paydo bo'ladi.</p>" +
      '<button class="btn btn-primary btn-sm" id="inv-empty-add">＋ Yangi tovar</button></div>'
    );
  }

  /* ---------------------------------------------------------- kartochka */

  const stateClass = (p) =>
    !p.is_active ? " is-off" : p.stock <= 0 ? " is-out" : p.stock <= LOW_STOCK ? " is-low" : "";

  function flagHtml(p) {
    if (!p.is_active) return '<span class="inv-flag inv-flag-off">Yashirin</span>';
    if (p.stock <= 0) return '<span class="inv-flag inv-flag-out">Tugagan</span>';
    if (p.stock <= LOW_STOCK) return '<span class="inv-flag inv-flag-low">Kam qoldi</span>';
    return "";
  }

  function invThumb(p) {
    const url =
      p.photo_url ||
      (p.photo_id && window.ZimmerOffline && window.ZimmerOffline.mediaUrl
        ? window.ZimmerOffline.mediaUrl(p.photo_id)
        : null);
    return url
      ? '<img src="' + esc(url) + '" alt="" loading="lazy">'
      : '<span class="inv-thumb-empty">📦</span>';
  }

  function invCard(p) {
    const id = esc(p.id);
    const meta = [];
    if (p.code) meta.push("🔖 " + esc(p.code));
    if (p.categoryName) meta.push(esc(p.categoryName));
    // Ko'p mashina bo'lsa hammasini yozamiz (ilgari faqat bittasi ko'rinardi)
    if (p.carNames) meta.push("🚗 " + esc(p.carNames));
    else if (p.carName) meta.push("🚗 " + esc(p.carName));
    if (p.sized) meta.push("📐 " + p.sizes.length + " razmer");
    const sale = p.old_price && p.old_price > p.price;

    return (
      '<div class="inv-card' +
      stateClass(p) +
      (S.selected[p.id] ? " is-picked" : "") +
      '" id="inv-card-' + id + '" data-id="' + id + '">' +
      '<div class="inv-card-top">' +
      '<button class="inv-pick" data-id="' + id + '" aria-label="Belgilash">✓</button>' +
      '<div class="inv-thumb">' + invThumb(p) + "</div>" +
      '<div class="inv-mid">' +
      "<b>" + esc(p.name) + "</b>" +
      (meta.length ? '<div class="inv-meta">' + meta.map((m) => "<span>" + m + "</span>").join("") + "</div>" : "") +
      '<div class="inv-price">' +
      esc(money(p.price)) +
      (sale ? "<s>" + esc(money(p.old_price)) + "</s><em>🔥</em>" : "") +
      "</div>" +
      "</div>" +
      '<div class="inv-right">' +
      '<span id="inv-flag-' + id + '">' + flagHtml(p) + "</span>" +
      '<span class="inv-val" id="inv-val-' + id + '">' + esc(money(p.price * Math.max(0, p.stock))) + "</span>" +
      "</div>" +
      "</div>" +
      '<div class="inv-card-bot">' +
      /* RAZMERLI TOVAR — stepper YO'Q.
         Sabab: `stock` bu yerda mustaqil raqam emas, razmer qoldiqlarining
         YIG'INDISI. Uni qo'lda 10 qilib qo'yish qoidani buzadi: do'kon
         «10 dona bor» deydi, razmerlar yig'indisi esa 3 bo'lib qoladi va
         mijoz buyurtma bergach «yetarli emas» xatosiga tushadi.
         Shuning uchun taqsimot KO'RSATILADI, o'zgartirish esa ✏️ orqali. */
      (p.sized
        ? '<div class="inv-sizes">' +
          p.sizes
            .map(
              (s) =>
                '<span class="inv-size' + (s.stock > 0 ? "" : " is-out") + '">' +
                esc(s.size) + "<b>" + s.stock + "</b></span>"
            )
            .join("") +
          "</div>"
        : '<div class="inv-step">' +
          '<button data-id="' + id + '" data-d="-1" aria-label="Kamaytirish">−</button>' +
          '<input type="text" inputmode="numeric" id="inv-st-' + id + '" value="' + p.stock + '">' +
          '<button data-id="' + id + '" data-d="1" aria-label="Ko\'paytirish">+</button>' +
          "</div>") +
      '<div class="inv-acts">' +
      '<button class="inv-mini inv-eye" data-id="' + id + '" aria-label="Yashirish">' +
      (p.is_active ? "👁" : "🙈") +
      "</button>" +
      '<button class="inv-mini inv-edit" data-id="' + id + '" aria-label="Tahrirlash">✏️</button>' +
      "</div>" +
      "</div>" +
      "</div>"
    );
  }

  function bindCards(list) {
    document.querySelectorAll(".inv-pick").forEach((b) => {
      b.onclick = () => {
        const id = b.dataset.id;
        haptic("light");
        if (S.selected[id]) delete S.selected[id];
        else S.selected[id] = true;
        syncCard(id);
        renderBulk();
      };
    });

    document.querySelectorAll(".inv-step button").forEach((b) => {
      b.onclick = () => {
        stepStock(b.dataset.id, Number(b.dataset.d));
      };
    });

    document.querySelectorAll(".inv-step input").forEach((el) => {
      // Qo'lda yozilgan qiymat: yozib bo'lgach saqlanadi.
      el.oninput = () => {
        const id = el.id.replace("inv-st-", "");
        const it = itemOf(id);
        if (!it) return;
        const val = parseNum(el.value);
        if (val === null) return; // bo'sh maydon — hali yozilmoqda
        it.stock = Math.max(0, val);
        touchRow(id, false);
      };
      el.onblur = () => {
        const id = el.id.replace("inv-st-", "");
        const it = itemOf(id);
        if (!it) return;
        if (parseNum(el.value) === null) el.value = it.stock; // bo'sh qoldirilsa tiklaymiz
      };
    });

    document.querySelectorAll(".inv-eye").forEach((b) => {
      b.onclick = () => toggleActive(b.dataset.id);
    });
    document.querySelectorAll(".inv-edit").forEach((b) => {
      b.onclick = () => {
        const p = list.find((x) => String(x.id) === String(b.dataset.id)) || itemOf(b.dataset.id);
        if (p) openEdit(p);
      };
    });
  }

  /* ---------------------------------------------- qoldiqni o'zgartirish */

  /** − / + tugmasi. Ekranda DARHOL o'zgaradi, saqlash keyin (debounce). */
  function stepStock(id, delta) {
    const it = itemOf(id);
    if (!it) return;
    const next = Math.max(0, it.stock + delta);
    if (next === it.stock && delta < 0) return haptic("warning");
    it.stock = next;
    haptic("light");
    const input = $("inv-st-" + id);
    if (input) input.value = next;
    touchRow(id, true);
  }

  /** Kartochkadagi raqamlarni yangilaydi va saqlashni rejalashtiradi.
   *  Butun ro'yxat qayta chizilmaydi — aks holda qoldiq yozayotgan maydon
   *  fokusdan chiqib ketardi. */
  function touchRow(id, pop) {
    syncCard(id, pop);
    refreshTotals(false);
    scheduleStockSave(id);
  }

  /** Bitta kartochkaning o'zgargan qismlarini yangilaydi. */
  function syncCard(id, pop) {
    const it = itemOf(id);
    const card = $("inv-card-" + id);
    if (!it || !card) return;
    card.className =
      "inv-card" + stateClass(it) + (S.selected[it.id] ? " is-picked" : "");
    const val = $("inv-val-" + id);
    if (val) val.textContent = money(it.price * Math.max(0, it.stock));
    const flag = $("inv-flag-" + id);
    if (flag) flag.innerHTML = flagHtml(it);
    const input = $("inv-st-" + id);
    if (input && document.activeElement !== input) input.value = it.stock;
    if (pop && input) {
      input.classList.remove("pop");
      // reflow — animatsiya qayta ishga tushsin
      void input.offsetWidth;
      input.classList.add("pop");
    }
  }

  function scheduleStockSave(id) {
    clearTimeout(S.invTimers[id]);
    S.invTimers[id] = setTimeout(() => saveStock(id), INV_SAVE_DELAY);
  }

  /** Qoldiqni bulutga yozadi. Xato bo'lsa ESKI qiymat qaytariladi —
   *  admin saqlanmaganini bilmay qolmasligi kerak. */
  async function saveStock(id) {
    const it = itemOf(id);
    if (!it || it.stock === it._saved) return;
    const target = it.stock;
    try {
      await fb().patch(P + "/" + id, { stock: target, updatedAt: Date.now() });
      it._saved = target;
      freshenShop();
      flashCard(id, "ok");
    } catch (err) {
      it.stock = it._saved;
      syncCard(id);
      refreshTotals(false);
      flashCard(id, "err");
      toast((err && err.message) || "Qoldiq saqlanmadi");
    }
  }

  function flashCard(id, kind) {
    const card = $("inv-card-" + id);
    if (!card) return;
    const cls = kind === "ok" ? "flash-ok" : "flash-err";
    card.classList.remove("flash-ok", "flash-err");
    void card.offsetWidth;
    card.classList.add(cls);
    setTimeout(() => card.classList.remove(cls), 700);
  }

  /** 👁 — tovarni do'konda yashiradi yoki qaytaradi (tahrirlashni ochmasdan). */
  async function toggleActive(id) {
    const it = itemOf(id);
    if (!it) return;
    const next = !it.is_active;
    it.is_active = next;
    haptic();
    syncCard(id);
    const eye = document.querySelector('.inv-eye[data-id="' + String(id).replace(/"/g, '\\"') + '"]');
    if (eye) eye.textContent = next ? "👁" : "🙈";
    try {
      await fb().patch(P + "/" + id, { is_active: next ? 1 : 0, updatedAt: Date.now() });
      freshenShop();
      flashCard(id, "ok");
      toast(next ? "👁 Do'konda ko'rinadi" : "🙈 Do'kondan yashirildi");
      paintInventory(); // «Yashirin» sanoqchisi o'zgardi
    } catch (err) {
      it.is_active = !next;
      syncCard(id);
      flashCard(id, "err");
      toast((err && err.message) || "Saqlanmadi");
    }
  }

  /* -------------------------------------------------- cheksiz skroll */

  function invWatchScroll(onHit) {
    invStopScroll();
    const node = $("inv-sentinel");
    if (!node) return;
    if (!window.IntersectionObserver) {
      node.textContent = "Yana ko'rsatish";
      node.onclick = onHit;
      return;
    }
    S.invIO = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          invStopScroll();
          onHit();
        }
      },
      { rootMargin: "260px 0px" }
    );
    S.invIO.observe(node);
  }

  function invStopScroll() {
    if (S.invIO) {
      S.invIO.disconnect();
      S.invIO = null;
    }
  }

  /* ------------------------------------------------- ommaviy amallar */

  /** Pastga yopishgan panel. Ilgari u ro'yxat TEPASIDA turardi va pastga
   *  tushganda ko'rinmasdi — admin nima belgilaganini eslay olmasdi. */
  function renderBulk() {
    const box = $("inv-bulk");
    if (!box) return;
    const ids = Object.keys(S.selected);
    if (!ids.length) {
      box.innerHTML = "";
      return;
    }
    const visible = invVisible();
    const allPicked = visible.length && visible.every((p) => S.selected[p.id]);

    box.innerHTML =
      /* Panel `position: fixed` — shuning uchun oqimda joy egallamaydi va
         oxirgi kartochkani yopib qo'yardi. Balandligiga teng bo'sh joy
         qo'shamiz (yoyilgan holatda kattaroq). */
      '<div class="inv-bulk-spacer" style="height:' +
      (S.invBulkOpen ? 214 : 66) +
      'px"></div>' +
      '<div class="inv-bulk">' +
      '<div class="inv-bulk-head">' +
      "<b>" + ids.length + " ta belgilandi</b>" +
      '<button class="inv-bulk-lnk" id="inv-bulk-all">' +
      (allPicked ? "Bekor qilish" : "Hammasi") +
      "</button>" +
      '<button class="inv-bulk-lnk" id="inv-bulk-clear">Tozalash</button>' +
      '<button class="inv-bulk-gear' + (S.invBulkOpen ? " on" : "") + '" id="inv-bulk-gear">⚙</button>' +
      "</div>" +
      (S.invBulkOpen
        ? '<div class="inv-bulk-body">' +
          '<div class="inv-bulk-row">' +
          '<input type="text" inputmode="numeric" class="inv-input wide" id="inv-b-price" placeholder="Yangi narx">' +
          '<button class="inv-btn" id="inv-b-setprice">💰 Qo\'yish</button>' +
          "</div>" +
          '<div class="inv-bulk-row">' +
          '<input type="number" class="inv-input" id="inv-b-pct" placeholder="%">' +
          '<button class="inv-btn ok" id="inv-b-plus">＋%</button>' +
          '<button class="inv-btn warn" id="inv-b-minus">−%</button>' +
          '<input type="number" class="inv-input" id="inv-b-stock" placeholder="Qoldiq">' +
          '<button class="inv-btn" id="inv-b-setstock">📦</button>' +
          "</div>" +
          '<div class="inv-bulk-row">' +
          '<button class="inv-btn ghost" id="inv-b-hide">🙈 Yashirish</button>' +
          '<button class="inv-btn ghost" id="inv-b-show">👁 Ko\'rsatish</button>' +
          '<button class="inv-btn danger" id="inv-b-del">🗑 O\'chirish</button>' +
          "</div></div>"
        : "") +
      "</div>";

    $("inv-bulk-gear").onclick = () => {
      haptic();
      S.invBulkOpen = !S.invBulkOpen;
      renderBulk();
    };
    $("inv-bulk-clear").onclick = () => {
      haptic();
      S.selected = {};
      paintInventory();
    };
    $("inv-bulk-all").onclick = () => {
      haptic();
      if (allPicked) S.selected = {};
      else visible.forEach((p) => (S.selected[p.id] = true));
      paintInventory();
    };

    if (!S.invBulkOpen) return;

    bindMoney(["inv-b-price"]);
    $("inv-b-setprice").onclick = async () => {
      const np = parseNum($("inv-b-price").value);
      if (!np) return toast("Yangi narx kiriting");
      await bulkApply(() => ({ price: np }), null, "narx");
    };
    $("inv-b-plus").onclick = () => bulkPercent(1);
    $("inv-b-minus").onclick = () => bulkPercent(-1);
    $("inv-b-setstock").onclick = async () => {
      const ns = parseNum($("inv-b-stock").value);
      if (ns === null) return toast("Qoldiqni kiriting");
      await bulkApply(() => ({ stock: Math.max(0, ns) }), null, "qoldiq");
    };
    $("inv-b-hide").onclick = () => bulkApply(() => ({ is_active: 0 }), null, "yashirildi");
    $("inv-b-show").onclick = () => bulkApply(() => ({ is_active: 1 }), null, "ko'rsatildi");
    $("inv-b-del").onclick = async () => {
      const ids2 = Object.keys(S.selected);
      if (!ids2.length) return;
      const ok = await ask(ids2.length + " ta tovarni o'chirasizmi?");
      if (!ok) return;
      await bulkApply(null, true);
    };
  }

  async function bulkPercent(sign) {
    const pct = parseFloat($("inv-b-pct").value);
    if (!pct || pct <= 0) return toast("Foiz kiriting");
    await bulkApply(
      (it) => ({ price: Math.max(0, Math.round(it.price * (1 + (sign * pct) / 100))) }),
      null,
      "narx"
    );
  }

  /** mutate(it) -> patch obyekti; del=true bo'lsa o'chiradi.
   *
   *  Ilgari yozuvlar BIRIN-KETIN yuborilardi (`for` + `await`) — 30 ta
   *  tovarda bu bir necha soniya kutish edi. Endi 6 talik guruhlarda
   *  parallel ketadi (bulutni ham bo'g'maydi). */
  async function bulkApply(mutate, del, word) {
    const ids = Object.keys(S.selected);
    if (!ids.length || S.busy) return;
    S.busy = true;

    const CHUNK = 6;
    let done = 0;
    let failed = 0;
    try {
      for (let i = 0; i < ids.length; i += CHUNK) {
        const part = ids.slice(i, i + CHUNK);
        await Promise.all(
          part.map(async (id) => {
            const it = itemOf(id);
            try {
              if (del) {
                // Bulutda «o'chirilgan» belgisi (bot import qilmasin) —
                // butunlay o'chirmaymiz, chunki bot restore uchun `_key`
                // kerak bo'lishi mumkin.
                await fb().patch(P + "/" + id, { deleted: true, updatedAt: Date.now() });
              } else if (mutate && it) {
                const patch = mutate(it);
                patch.updatedAt = Date.now();
                await fb().patch(P + "/" + id, patch);
                // Mahalliy nusxani ham yangilaymiz — qayta o'qimasdan.
                Object.keys(patch).forEach((k) => {
                  if (k === "updatedAt") return;
                  if (k === "is_active") it.is_active = patch[k] === 1;
                  else it[k] = patch[k];
                });
                if (patch.stock !== undefined) it._saved = it.stock;
              }
              done++;
            } catch (_) {
              failed++;
            }
          })
        );
      }

      haptic(failed ? "warning" : "success");
      if (del) {
        S.items = S.items.filter((x) => !S.selected[x.id]);
        toast(done + " ta o'chirildi" + (failed ? " · " + failed + " tasi saqlanmadi" : ""));
      } else {
        toast(
          done + " ta tovar " + (word || "yangilandi") +
            (failed ? " · " + failed + " tasi saqlanmadi" : "")
        );
      }
      freshenShop();
      S.selected = {};
      S.invBulkOpen = false;
      renderInventory();
    } catch (err) {
      toast((err && err.message) || "Xatolik");
    } finally {
      S.busy = false;
    }
  }

  /* ==================================================================
     TAHRIRLASH — add formasi + to'ldirilgan qiymatlar + o'chirish
     ================================================================== */
  function openEdit(p) {
    const r = p._raw || p;
    S.view = "edit";
    S.editing = p.id;
    clearPhotos();
    S.catSel = r.categoryName || null;

    /* MASHINALAR — `carNames` (ko'p) bo'lsa u, bo'lmasa eski `carName`
       (bitta). Eski tovarlar bulutda `carNames` siz turadi va ular ham
       to'g'ri ochilishi shart. */
    S.carSels = normCars(r.carNames, r.carName)
      .map((nm) => (S.cars.find((c) => c.name === nm) || {}).id)
      .filter((v) => v != null)
      .map(String);

    /* TUR VA RAZMERLAR. `product_type` bo'lmasa ham `sizes` to'la bo'lishi
       mumkin (eski yozuv) — shu holatda ham razmerli deb ochamiz, aks holda
       admin tahrirlab saqlashi bilan razmerlar jimgina yo'qolardi. */
    S.sizes = normSizes(r.sizes);
    S.typeSel = r.product_type === "razmerli" || S.sizes.length ? "razmerli" : "oddiy";

    setHead("Tahrirlash", p.name);

    body().innerHTML =
      '<div class="adm-form">' +
      photoBlock() +
      '<div class="admin-form-group" style="padding-top:16px;">' +
      '<div class="apx-sub" style="margin-top:0;">Mijozga qanday ko\'rinadi</div>' +
      '<div id="shop-live" class="live-preview-box"></div></div>' +
      mainBlock() +
      chipsBlock() +
      "</div>" +
      '<div class="shop-footer">' +
      '<button class="btn btn-primary" id="shop-save">💾 Yangilash</button>' +
      '<button class="btn btn-ghost" id="shop-hide">' +
      (r.is_active === 0 || r.is_active === false ? "Ko'rsatish" : "Yashirish") +
      "</button>" +
      '<button class="btn btn-ghost shop-del-btn" id="shop-del">🗑 O\'chirish</button>' +
      "</div>";

    /* MAVJUD QIYMATLAR — bog'lashdan OLDIN to'ldiriladi, shunda `bindForm()`
       ichidagi `renderThumbs()` va `livePreview()` darhol to'g'ri chiqadi.
       Mavjud rasmlar to'g'ridan havola maydonlariga tushadi — bundan keyin
       ular yuklangan rasmdan hech qanday farq qilmaydi (yagona manba). */
    const imgs = [r.photo_url, r.photo2_url, r.photo3_url].filter(Boolean);
    setImgUrls(imgs);

    $("shop-name").value = r.name || "";
    // Narx maydoni — HOZIRGI narx (aksiya bo'lsa ham o'zgarmaydi).
    // Ilgari flash aktiv bo'lsa bu maydonga ASL narx yozilardi va admin
    // «nega narx boshqa?» deb hayron bo'lardi.
    $("shop-price").value = money(r.price).replace(" so'm", "");
    if ($("shop-old")) {
      $("shop-old").value = r.old_price ? money(r.old_price).replace(" so'm", "") : "";
    }
    if ($("shop-flash-h")) {
      const left = r.flashUntil ? (Number(r.flashUntil) - Date.now()) / 3600000 : 0;
      $("shop-flash-h").value = left > 0 ? Math.round(left * 10) / 10 : "";
    }
    $("shop-code").value = r.code || "";
    if ($("shop-badge")) $("shop-badge").value = r.badge || "";
    $("shop-stock").value = Number(r.stock) || 0;
    if ($("shop-desc")) $("shop-desc").value = r.description || "";
    // Kafolat maydoni `bindForm()` dan OLDIN to'ldiriladi — `bindWarranty()`
    // izoh va tanlangan chipni shu qiymatga qarab chizadi.
    if ($("shop-warranty")) $("shop-warranty").value = r.warranty || "";

    bindForm();

    $("shop-save").onclick = () => saveProduct(p.id);
    $("shop-hide").onclick = async () => {
      const next = !(r.is_active === 0 || r.is_active === false);
      try {
        await fb().patch(P + "/" + p.id, { is_active: next ? 0 : 1, updatedAt: Date.now() });
        haptic("success");
        toast(next ? "✅ Yashirildi" : "✅ Ko'rsatiladi");
        freshenShop();
        openInventory();
      } catch (err) {
        toast((err && err.message) || "Saqlanmadi");
      }
    };
    $("shop-del").onclick = async () => {
      const ok = await ask("«" + p.name + "» o'chirilsinmi?");
      if (!ok) return;
      try {
        // «o'chirilgan» belgisi — do'kondan yo'qoladi, tarix qoladi.
        await fb().patch(P + "/" + p.id, { deleted: true, updatedAt: Date.now() });
        haptic("success");
        toast("🗑 O'chirildi");
        freshenShop();
        openInventory();
      } catch (err) {
        toast((err && err.message) || "Saqlanmadi");
      }
    };
  }

  /* ==================================================================
     BANNERLAR — RASM, TARTIB, O'CHIRISH

     NEGA PANELGA QO'SHILDI
     Banner bosh sahifaning eng ko'zga tashlanadigan bloki (stories ostida,
     katalog ustida), lekin uni boshqarishning YAKKA yo'li Telegram boti
     yoki Render'ning universal CRUD paneli edi. Ikkisi ham RENDER'ga
     bog'liq: bepul tarifda server uxlab yotsa admin bannerni umuman
     o'zgartira olmasdi. Bundan tashqari rasm o'sha yo'lda Telegram
     `file_id` bilan saqlanardi va uni brauzer O'ZI ko'rsata olmaydi —
     Render uxlagan payt banner RASMSIZ, faqat gradient bo'lib turardi.

     Endi tovar va stories bilan bir xil model: brauzerdan to'g'ridan
     `catalog/banners` ga yoziladi, rasm esa ImgBB'ga (doimiy https
     havola). Render bor yoki yo'q — farqi yo'q.

     RASM SIFATI
     Banner to'liq kenglikda yoyiladi va ustiga matn tushadi, shuning
     uchun `ZimmerUpload` ning «banner» sozlamasi ishlatiladi (uzun tomon
     1920px, JPEG 0.90) — tovar rasmidan yuqoriroq. Tafsilot:
     `docs/js/upload.js: PRESETS`.
     ================================================================== */

  const BAN_P = "catalog/banners";

  /** Bannerlar uchun tavsiya etilgan o'lcham — formada ham ko'rsatiladi.
   *  Blok `calc(100vw - 48px)` kenglikda va `min-height: 128px`, ya'ni
   *  nisbat ~8:3. Katta telefonda (DPR 3) ~1150px kerak — 1600 zaxira
   *  bilan yetadi. */
  const BAN_W = 1600;
  const BAN_H = 600;

  async function loadBannerRows() {
    const node = await fb().get(BAN_P);
    const out = [];
    if (node && typeof node === "object") {
      Object.keys(node).forEach((k) => {
        const r = node[k];
        if (!r || typeof r !== "object" || r.deleted) return;
        out.push({
          key: k, // RTDB kaliti — yozish yo'li shu bo'yicha quriladi
          id: r.id == null ? k : r.id,
          title: String(r.title || ""),
          subtitle: String(r.subtitle || ""),
          tag: String(r.tag || ""),
          color_from: String(r.color_from || "#c1121f"),
          color_to: String(r.color_to || "#101215"),
          photo_url: String(r.photo_url || ""),
          photo_id: String(r.photo_id || ""),
          sort: Number(r.sort) || 0,
          is_active: r.is_active !== 0 && r.is_active !== false,
        });
      });
    }
    out.sort((a, b) => a.sort - b.sort || Number(a.id) - Number(b.id));
    return out;
  }

  async function openBanners() {
    S.view = "banners";
    setHead("🖼 Bannerlar", "Yuklanmoqda...");
    body().innerHTML = '<div class="inv-skel"></div><div class="inv-skel"></div>';
    try {
      S.banners = await loadBannerRows();
      renderBannerList();
    } catch (err) {
      fail(err, openBanners);
    }
  }

  function renderBannerList() {
    const list = S.banners || [];
    S.view = "banners";
    setHead("🖼 Bannerlar", list.length ? list.length + " ta banner" : "Banner yo'q");

    body().innerHTML =
      '<div class="adm-hint-block">' +
      "Bannerlar bosh sahifada SHU TARTIBDA aylanadi. Tavsiya etilgan " +
      "rasm o'lchami: <b>" + BAN_W + "×" + BAN_H + " px</b> (nisbat 8:3). " +
      "Rasm chetlari qirqilishi mumkin — muhim narsani markazga joylang." +
      "</div>" +
      '<button class="apx-voice" id="ban-add">＋ Yangi banner</button>' +
      '<div class="ban-list" id="ban-list">' +
      (list.length
        ? list.map(banCard).join("")
        : '<div class="adm-hint">Hali banner yo\'q — «＋ Yangi banner» ni bosing.</div>') +
      "</div>";

    $("ban-add").onclick = () => {
      haptic();
      openBannerForm(null);
    };
    bindBannerList();
  }

  function banCard(b, i) {
    const list = S.banners || [];
    const pic = b.photo_url || "";
    return (
      '<div class="ban-card' + (b.is_active ? "" : " is-off") + '">' +
      /* Kichik ko'rinish — bosh sahifadagi bilan BIR XIL qurilgan
         (gradient + rasm + qorayish + matn), shunda admin natijani
         taxmin qilmaydi, KO'RADI. */
      '<div class="ban-prev" style="background:linear-gradient(135deg,' +
      esc(b.color_from) + "," + esc(b.color_to) + ')">' +
      (pic ? '<img src="' + esc(pic) + '" alt="" loading="lazy">' : "") +
      (pic ? '<span class="ban-prev-shade"></span>' : "") +
      (b.tag ? '<span class="ban-prev-tag">' + esc(b.tag) + "</span>" : "") +
      '<span class="ban-prev-t">' + esc(b.title || "Sarlavha yo'q") + "</span>" +
      (b.subtitle ? '<span class="ban-prev-s">' + esc(b.subtitle) + "</span>" : "") +
      "</div>" +
      '<div class="ban-acts">' +
      '<span class="ban-num">' + (i + 1) + "</span>" +
      '<button class="mus-btn" data-bmv="up" data-key="' + esc(b.key) + '"' +
      (i === 0 ? " disabled" : "") + ' aria-label="Yuqoriga">↑</button>' +
      '<button class="mus-btn" data-bmv="down" data-key="' + esc(b.key) + '"' +
      (i === list.length - 1 ? " disabled" : "") + ' aria-label="Pastga">↓</button>' +
      '<button class="mus-btn" data-beye="' + esc(b.key) + '" aria-label="Yashirish">' +
      (b.is_active ? "👁" : "🙈") + "</button>" +
      '<button class="mus-btn" data-bedit="' + esc(b.key) + '" aria-label="Tahrirlash">✏️</button>' +
      '<button class="mus-btn mus-del" data-bdel="' + esc(b.key) + '" aria-label="O\'chirish">🗑</button>' +
      "</div>" +
      "</div>"
    );
  }

  function bindBannerList() {
    document.querySelectorAll("#ban-list [data-bmv]").forEach((btn) => {
      btn.onclick = () => moveBanner(btn.dataset.key, btn.dataset.bmv === "up" ? -1 : 1);
    });
    document.querySelectorAll("#ban-list [data-beye]").forEach((btn) => {
      btn.onclick = () => toggleBanner(btn.dataset.beye);
    });
    document.querySelectorAll("#ban-list [data-bedit]").forEach((btn) => {
      btn.onclick = () => {
        haptic();
        openBannerForm((S.banners || []).find((x) => x.key === btn.dataset.bedit) || null);
      };
    });
    document.querySelectorAll("#ban-list [data-bdel]").forEach((btn) => {
      btn.onclick = () => deleteBanner(btn.dataset.bdel);
    });
  }

  /* ---- tartib / yashirish / o'chirish (musiqa bilan bir xil mantiq) ---- */

  async function moveBanner(key, delta) {
    if (S.busy) return;
    const list = S.banners || [];
    const at = list.findIndex((b) => b.key === key);
    const to = at + delta;
    if (at === -1 || to < 0 || to >= list.length) return;

    haptic("light");
    const before = list.slice();
    const next = list.slice();
    next[at] = list[to];
    next[to] = list[at];
    next.forEach((b, i) => (b.sort = i * 10));
    S.banners = next;
    renderBannerList();

    S.busy = true;
    try {
      const writes = next
        .map((b, i) => ({ b: b, sort: i * 10 }))
        .filter((w) => {
          const old = before.find((x) => x.key === w.b.key);
          return !old || old.sort !== w.sort;
        });
      for (const w of writes) {
        await fb().patch(BAN_P + "/" + w.b.key, { sort: w.sort, updatedAt: Date.now() });
      }
      freshenShop(); // bosh sahifa keshi eskirdi
    } catch (err) {
      S.banners = before;
      renderBannerList();
      toast((err && err.message) || "Tartib saqlanmadi");
    } finally {
      S.busy = false;
    }
  }

  async function toggleBanner(key) {
    const b = (S.banners || []).find((x) => x.key === key);
    if (!b || S.busy) return;
    const next = !b.is_active;
    haptic();
    S.busy = true;
    try {
      await fb().patch(BAN_P + "/" + key, { is_active: next ? 1 : 0, updatedAt: Date.now() });
      b.is_active = next;
      renderBannerList();
      freshenShop();
      toast(next ? "✅ Ko'rsatiladi" : "🙈 Yashirildi");
    } catch (err) {
      toast((err && err.message) || "Saqlanmadi");
    } finally {
      S.busy = false;
    }
  }

  async function deleteBanner(key) {
    const b = (S.banners || []).find((x) => x.key === key);
    if (!b || S.busy) return;
    const ok = await ask("«" + (b.title || "Banner") + "» o'chirilsinmi?");
    if (!ok) return;
    S.busy = true;
    try {
      await fb().patch(BAN_P + "/" + key, { deleted: true, updatedAt: Date.now() });
      S.banners = (S.banners || []).filter((x) => x.key !== key);
      haptic("success");
      renderBannerList();
      freshenShop();
      toast("🗑 O'chirildi");
    } catch (err) {
      toast((err && err.message) || "O'chirilmadi");
    } finally {
      S.busy = false;
    }
  }

  /* ------------------------------- banner formasi (qo'shish / tahrirlash) */

  /** Bosh sahifa fonining tayyor juftliklari — qo'lda hex yozish shart emas. */
  const BAN_THEMES = [
    ["🔴 Qizil", "#c1121f", "#101215"],
    ["🟠 Kehribar", "#e08a1e", "#14100a"],
    ["🟢 Yashil", "#1f8a4c", "#0b1410"],
    ["🔵 Ko'k", "#1e5fd0", "#0a0f1a"],
    ["🟣 Siyoh", "#6b3fd4", "#100c1a"],
    ["⚫️ Qora", "#3a3f4b", "#0c0d11"],
  ];

  function openBannerForm(b) {
    S.view = "banner-form";
    const editing = !!b;
    S.banEdit = b || null;
    // Yuklangan rasm havolasi shu maydonda turadi (yagona manba)
    S.banPhoto = (b && b.photo_url) || "";
    S.banFrom = (b && b.color_from) || BAN_THEMES[0][1];
    S.banTo = (b && b.color_to) || BAN_THEMES[0][2];

    setHead(editing ? "Bannerni tahrirlash" : "Yangi banner", BAN_W + "×" + BAN_H + " px");

    body().innerHTML =
      '<div class="adm-form">' +
      /* ---- rasm */
      '<div class="admin-form-group"><div class="apx-head">' +
      '<div class="apx-ic apx-ic-blue">🖼</div>' +
      '<div class="apx-tx"><b>Rasm</b><span>' + BAN_W + "×" + BAN_H +
      " px · nisbat 8:3</span></div></div>" +
      '<div class="ban-drop" id="ban-drop"></div>' +
      '<input type="file" id="ban-file" accept="image/*" class="hidden">' +
      '<div class="apx-sale-note">Telefondagi katta rasm o\'zi kichraytiriladi ' +
      "(uzun tomon " + (up() ? up().PRESETS.banner.maxSide : 1920) +
      " px, yuqori sifat). Rasm chetlari qirqilishi mumkin — muhim " +
      "narsani markazga joylang.</div>" +
      "</div>" +
      /* ---- jonli ko'rinish */
      '<div class="admin-form-group"><div class="apx-sub" style="margin-top:0;">' +
      "Bosh sahifada qanday ko'rinadi</div>" +
      '<div id="ban-live"></div></div>' +
      /* ---- matn */
      '<div class="admin-form-group"><div class="apx-head">' +
      '<div class="apx-ic">🏷</div>' +
      "<div class=\"apx-tx\"><b>Matn</b><span>Sarlavha · tavsif · yorliq</span></div></div>" +
      '<input type="text" class="admin-input" id="ban-title" maxlength="80" ' +
      'placeholder="Sarlavha (mas: Bi-LED aksiya)" value="' + esc((b && b.title) || "") + '">' +
      '<input type="text" class="admin-input" id="ban-sub" maxlength="120" ' +
      'placeholder="Tavsif (ixtiyoriy)" value="' + esc((b && b.subtitle) || "") + '">' +
      '<input type="text" class="admin-input" id="ban-tag" maxlength="40" ' +
      'placeholder="Yorliq — mas: -15% shu hafta (ixtiyoriy)" value="' +
      esc((b && b.tag) || "") + '">' +
      "</div>" +
      /* ---- rang */
      '<div class="admin-form-group"><div class="apx-head">' +
      '<div class="apx-ic apx-ic-gold">🎨</div>' +
      '<div class="apx-tx"><b>Fon rangi</b>' +
      "<span>Rasm bo'lmasa yoki chetlarda ko'rinadi</span></div></div>" +
      '<div class="shop-chips" id="ban-themes">' +
      BAN_THEMES.map(
        (t) =>
          '<button type="button" class="cat-chip ban-theme" data-from="' + t[1] +
          '" data-to="' + t[2] + '">' + esc(t[0]) + "</button>"
      ).join("") +
      "</div></div>" +
      "</div>" +
      '<div class="shop-footer">' +
      '<button class="btn btn-primary" id="ban-save">💾 ' +
      (editing ? "Yangilash" : "Saqlash") + "</button>" +
      '<button class="btn btn-ghost" id="ban-cancel">Bekor qilish</button>' +
      "</div>";

    bindBannerForm();
  }

  function bindBannerForm() {
    const paint = () => {
      renderBanDrop();
      renderBanLive();
    };

    ["ban-title", "ban-sub", "ban-tag"].forEach((id) => {
      if ($(id)) $(id).oninput = renderBanLive;
    });

    document.querySelectorAll("#ban-themes .ban-theme").forEach((chip) => {
      chip.onclick = () => {
        haptic("light");
        S.banFrom = chip.dataset.from;
        S.banTo = chip.dataset.to;
        document
          .querySelectorAll("#ban-themes .ban-theme")
          .forEach((c) => c.classList.remove("selected"));
        chip.classList.add("selected");
        renderBanLive();
      };
      if (chip.dataset.from === S.banFrom) chip.classList.add("selected");
    });

    $("ban-file").onchange = async (e) => {
      const file = (e.target.files || [])[0];
      e.target.value = ""; // ayni faylni qayta tanlash imkoni qolsin
      if (!file) return;
      await uploadBanner(file);
    };

    $("ban-save").onclick = saveBanner;
    $("ban-cancel").onclick = () => {
      haptic();
      renderBannerList();
    };

    paint();
  }

  function renderBanDrop() {
    const box = $("ban-drop");
    if (!box) return;
    if (S.banBusy) {
      box.className = "ban-drop is-busy";
      box.innerHTML =
        '<div class="ban-prog"><b>' + (S.banPct || 0) + "%</b><span>" +
        esc(S.banPhase || "yuklanmoqda") + "</span></div>";
      return;
    }
    if (S.banPhoto) {
      box.className = "ban-drop has-img";
      box.innerHTML =
        '<img src="' + esc(S.banPhoto) + '" alt="">' +
        '<button type="button" class="ban-drop-x" id="ban-x" aria-label="Rasmni o\'chirish">✕</button>' +
        '<button type="button" class="ban-drop-swap" id="ban-swap">🔄 Boshqa rasm</button>';
      $("ban-x").onclick = () => {
        haptic("light");
        S.banPhoto = "";
        renderBanDrop();
        renderBanLive();
      };
      $("ban-swap").onclick = () => $("ban-file").click();
      return;
    }
    box.className = "ban-drop";
    box.innerHTML =
      '<span class="ban-drop-ic">🖼</span>' +
      "<b>Rasm tanlash</b>" +
      "<i>" + BAN_W + "×" + BAN_H + " px tavsiya etiladi</i>";
    box.onclick = () => $("ban-file").click();
  }

  async function uploadBanner(file) {
    if (!up() || !up().available()) {
      return toast("Rasm yuklash sozlanmagan (IMGBB_KEY yo'q)");
    }
    S.banBusy = true;
    S.banPct = 0;
    S.banPhase = "siqish";
    renderBanDrop();
    try {
      /* «banner» sozlamasi — tovar rasmidan yuqori sifat (izohni
         `docs/js/upload.js: PRESETS` da ko'ring). */
      const res = await up().uploadFile(
        file,
        (pct, phase) => {
          S.banPct = Math.round(pct);
          S.banPhase = phase;
          renderBanDrop();
        },
        "banner"
      );
      S.banPhoto = res.url;
      haptic("success");
      const kb = Math.round((res.bytes || 0) / 1024);
      toast("✅ Rasm yuklandi" + (res.width ? " · " + res.width + "×" + res.height : "") +
        (kb ? " · " + kb + " KB" : ""));
    } catch (err) {
      haptic("err");
      toast((err && err.message) || "Rasm yuklanmadi");
    } finally {
      S.banBusy = false;
      renderBanDrop();
      renderBanLive();
    }
  }

  function renderBanLive() {
    const box = $("ban-live");
    if (!box) return;
    const title = (($("ban-title") && $("ban-title").value) || "").trim();
    const sub = (($("ban-sub") && $("ban-sub").value) || "").trim();
    const tag = (($("ban-tag") && $("ban-tag").value) || "").trim();
    box.innerHTML =
      '<div class="ban-prev is-live" style="background:linear-gradient(135deg,' +
      esc(S.banFrom) + "," + esc(S.banTo) + ')">' +
      (S.banPhoto ? '<img src="' + esc(S.banPhoto) + '" alt="">' : "") +
      (S.banPhoto ? '<span class="ban-prev-shade"></span>' : "") +
      (tag ? '<span class="ban-prev-tag">' + esc(tag) + "</span>" : "") +
      '<span class="ban-prev-t">' + esc(title || "Sarlavha") + "</span>" +
      (sub ? '<span class="ban-prev-s">' + esc(sub) + "</span>" : "") +
      "</div>";
  }

  async function saveBanner() {
    if (S.busy) return;
    if (S.banBusy) return toast("⏳ Rasm yuklanmoqda — bir lahza kuting");

    const title = ($("ban-title").value || "").trim();
    const sub = ($("ban-sub").value || "").trim();
    const tag = ($("ban-tag").value || "").trim();

    if (title.length < 2) return toast("Sarlavhani kiriting");
    if (title.length > 80) return toast("Sarlavha juda uzun (80 belgigacha)");
    /* Rasm MAJBURIY emas: faqat gradient + matndan iborat banner ham
       chiroyli chiqadi va admin shoshilinch aksiyani rasm izlamasdan
       e'lon qila oladi. Lekin havola bo'lsa u https bo'lishi SHART —
       Firebase qoidalari boshqasini rad etadi va xato tushunarsiz
       bo'lardi («Bazaga yozilmadi (400)»). */
    if (S.banPhoto && !/^https:\/\/[^\s]+$/i.test(S.banPhoto)) {
      return toast("Rasm havolasi https bo'lishi kerak");
    }

    const editing = S.banEdit;
    const rec = {
      _key: title,
      title: title,
      subtitle: sub || null,
      tag: tag || null,
      color_from: S.banFrom,
      color_to: S.banTo,
      /* Bo'sh matn EMAS, `null`: mijoz tomonida bitta tekshiruv qoladi
         (`b.photo_url ? ...`) va tahrirlashda rasmni O'CHIRISH ishlaydi
         (`patch` null bilan ustiga yozadi). */
      photo_url: S.banPhoto || null,
      photo_id: null,
      is_active: 1,
      deleted: false,
      updatedAt: Date.now(),
      source: "miniapp",
    };

    S.busy = true;
    const btn = $("ban-save");
    if (btn) {
      btn.disabled = true;
      btn.textContent = "Saqlanmoqda...";
    }
    try {
      if (editing) {
        rec.id = Number(editing.id) || editing.id;
        rec.sort = editing.sort;
        rec.is_active = editing.is_active ? 1 : 0;
        await fb().patch(BAN_P + "/" + editing.key, rec);
      } else {
        const id = await fb().nextBannerId();
        rec.id = id;
        rec.createdAt = Date.now();
        // Yangi banner OXIRIGA tushadi — mavjud tartib buzilmaydi
        const last = (S.banners || []).reduce((m, b) => Math.max(m, b.sort), -10);
        rec.sort = last + 10;
        await fb().put(BAN_P + "/" + id, rec);
      }
      haptic("ok");
      freshenShop();
      toast(editing ? "✅ Saqlandi" : "✅ Banner qo'shildi");
      S.banners = await loadBannerRows();
      renderBannerList();
    } catch (err) {
      toast((err && err.message) || "Saqlanmadi");
      if (btn) {
        btn.disabled = false;
        btn.textContent = editing ? "💾 Yangilash" : "💾 Saqlash";
      }
    } finally {
      S.busy = false;
    }
  }

  /* ==================================================================
     FON MUSIQASI — TARTIB VA O'CHIRISH

     NEGA PANELGA KO'CHIRILDI
     Ilgari musiqani boshqarishning YAKKA yo'li Telegram boti edi:
     `/musiqa` ro'yxatni chiqarardi, o'chirish uchun esa `/musiqa_del_12`
     degan buyruqni QO'LDA yozish kerak edi. Tartibni o'zgartirish imkoni
     UMUMAN yo'q edi — trek qo'shilgan ketma-ketligida qolib ketardi va
     birinchi eshitiladigan qo'shiqni almashtirish uchun hammasini
     o'chirib, yangi tartibda qaytadan tashlash kerak bo'lardi.

     TREK QO'SHISH BOTDA QOLADI — bu ataylab. Audio faylni Telegram
     allaqachon o'zida saqlaydi va bot uni bir bosishda qabul qiladi;
     brauzerdan 5-10 MB audio yuklash esa sekin va ishonchsiz.

     MANBA — FIREBASE (`catalog/music`), tovar va stories bilan bir xil
     model: panel brauzerdan to'g'ridan yozadi, mijoz tomoni shu holatni
     o'qiydi (`app.js: fetchMusicTracks`).
     ================================================================== */

  const MUSIC_P = "catalog/music";

  /** Bulutdagi treklar — panel uchun XOM ro'yxat (o'chirilganlar chiqmaydi,
   *  YASHIRILGANLAR esa chiqadi: adminga ularni qaytarish imkoni kerak). */
  async function loadMusicRows() {
    const node = await fb().get(MUSIC_P);
    const out = [];
    if (node && typeof node === "object") {
      Object.keys(node).forEach((k) => {
        const r = node[k];
        if (!r || typeof r !== "object" || r.deleted) return;
        out.push({
          key: k, // RTDB kaliti — yozish yo'li shu bo'yicha quriladi
          id: r.id == null ? k : r.id,
          title: String(r.title || "Fon musiqasi"),
          duration: Number(r.duration) || 0,
          sort: Number(r.sort) || 0,
          audio_url: String(r.audio_url || ""),
          audio_id: String(r.audio_id || ""),
          is_active: r.is_active !== 0 && r.is_active !== false,
        });
      });
    }
    // Ekrandagi tartib mijoz eshitadigan tartib bilan BIR XIL bo'lishi shart
    out.sort((a, b) => a.sort - b.sort || Number(a.id) - Number(b.id));
    return out;
  }

  async function openMusic() {
    S.view = "music";
    setHead("🎵 Fon musiqasi", "Yuklanmoqda...");
    body().innerHTML = '<div class="inv-skel"></div><div class="inv-skel"></div>';
    try {
      S.music = await loadMusicRows();
      renderMusic();
    } catch (err) {
      fail(err, openMusic);
    }
  }

  const mmss = (sec) => {
    const s = Math.max(0, Math.round(Number(sec) || 0));
    return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
  };

  function renderMusic() {
    const list = S.music || [];
    setHead("🎵 Fon musiqasi", list.length ? list.length + " ta trek" : "Trek yo'q");

    if (!list.length) {
      body().innerHTML =
        '<div class="adm-hint-block">' +
        "<b>Hali trek qo'shilmagan.</b><br><br>" +
        "Qo'shish uchun botga audio faylni yuboring — u o'zi ro'yxatga " +
        "tushadi. Keyin bu yerda tartibini o'zgartirishingiz va " +
        "o'chirishingiz mumkin.<br><br>" +
        "Trek yo'q bo'lsa mijozda 🔇 tugmasi UMUMAN ko'rinmaydi." +
        "</div>";
      return;
    }

    body().innerHTML =
      '<div class="adm-hint-block">' +
      "Mijoz treklarni SHU TARTIBDA eshitadi. Yangi trek qo'shish — " +
      "botga audio yuborish orqali." +
      "</div>" +
      '<div class="mus-list" id="mus-list">' +
      list.map(musCard).join("") +
      "</div>";

    bindMusic();
  }

  function musCard(t, i) {
    const list = S.music || [];
    /* Brauzerda ochilmaydigan trek — bot orqali qo'shilgan va Firebase
       Storage o'chiq bo'lgan holat: bunda faqat Telegram `file_id` bor.
       Render uyg'oq bo'lsa u proksi bilan eshittiradi, uxlagan bo'lsa esa
       trek jimgina o'tkazib yuboriladi. Admin buni BILISHI kerak. */
    const proxied = !/^https?:\/\//i.test(t.audio_url);
    return (
      '<div class="mus-card' + (t.is_active ? "" : " is-off") + '" data-key="' + esc(t.key) + '">' +
      '<span class="mus-num">' + (i + 1) + "</span>" +
      '<div class="mus-mid">' +
      "<b>" + esc(t.title) + "</b>" +
      '<div class="mus-meta">' +
      (t.duration ? "<span>⏱ " + mmss(t.duration) + "</span>" : "") +
      (proxied ? '<span class="mus-warn">☁️ server orqali</span>' : "<span>🔗 to'g'ridan</span>") +
      (t.is_active ? "" : '<span class="mus-warn">🙈 yashirin</span>') +
      "</div></div>" +
      '<div class="mus-acts">' +
      '<button class="mus-btn" data-mv="up" data-key="' + esc(t.key) + '"' +
      (i === 0 ? " disabled" : "") + ' aria-label="Yuqoriga">↑</button>' +
      '<button class="mus-btn" data-mv="down" data-key="' + esc(t.key) + '"' +
      (i === list.length - 1 ? " disabled" : "") + ' aria-label="Pastga">↓</button>' +
      '<button class="mus-btn" data-eye="' + esc(t.key) + '" aria-label="Yashirish">' +
      (t.is_active ? "👁" : "🙈") + "</button>" +
      '<button class="mus-btn mus-del" data-del="' + esc(t.key) + '" aria-label="O\'chirish">🗑</button>' +
      "</div>" +
      "</div>"
    );
  }

  function bindMusic() {
    document.querySelectorAll("#mus-list [data-mv]").forEach((btn) => {
      btn.onclick = () => moveTrack(btn.dataset.key, btn.dataset.mv === "up" ? -1 : 1);
    });
    document.querySelectorAll("#mus-list [data-eye]").forEach((btn) => {
      btn.onclick = () => toggleTrack(btn.dataset.eye);
    });
    document.querySelectorAll("#mus-list [data-del]").forEach((btn) => {
      btn.onclick = () => deleteTrack(btn.dataset.del);
    });
  }

  /** Mijoz tomonidagi ro'yxatni ham yangilaydi (tugma holati bilan). */
  function freshenMusic() {
    if (app().reloadMusic) app().reloadMusic();
  }

  /* Tartibni o'zgartirish: ikki trekni almashtirib, `sort` ni QAYTADAN
     raqamlaymiz (0, 10, 20...). Nega qayta raqamlash: bulutdagi eski
     yozuvlarda `sort` ning hammasi 0 bo'lishi mumkin — o'sha holatda
     joyini almashtirish HECH NARSA o'zgartirmasdi. Bo'sh oraliq (10)
     kelajakda oraga qo'shish uchun joy qoldiradi. */
  async function moveTrack(key, delta) {
    if (S.busy) return;
    const list = S.music || [];
    const at = list.findIndex((t) => t.key === key);
    const to = at + delta;
    if (at === -1 || to < 0 || to >= list.length) return;

    haptic("light");
    const next = list.slice();
    next[at] = list[to];
    next[to] = list[at];

    // Ekranda DARHOL ko'rinadi — tarmoq javobini kutib turmaydi
    const before = list.slice();
    next.forEach((t, i) => (t.sort = i * 10));
    S.music = next;
    renderMusic();

    S.busy = true;
    try {
      // Faqat `sort` haqiqatan o'zgargan yozuvlar yoziladi
      const writes = next
        .map((t, i) => ({ t: t, sort: i * 10 }))
        .filter((w) => {
          const old = before.find((b) => b.key === w.t.key);
          return !old || old.sort !== w.sort;
        });
      for (const w of writes) {
        await fb().patch(MUSIC_P + "/" + w.t.key, { sort: w.sort });
      }
      freshenMusic();
    } catch (err) {
      // Yozilmadi — ekranni ESKI holatga qaytaramiz, aks holda admin
      // tartib saqlangan deb o'ylab qolardi.
      S.music = before;
      renderMusic();
      toast((err && err.message) || "Tartib saqlanmadi");
    } finally {
      S.busy = false;
    }
  }

  /** 👁 — trekni vaqtincha o'chiradi (yozuv qoladi, keyin qaytarish mumkin). */
  async function toggleTrack(key) {
    const t = (S.music || []).find((x) => x.key === key);
    if (!t || S.busy) return;
    const next = !t.is_active;
    haptic();
    S.busy = true;
    try {
      await fb().patch(MUSIC_P + "/" + key, { is_active: next ? 1 : 0 });
      t.is_active = next;
      renderMusic();
      freshenMusic();
      toast(next ? "✅ Yoqildi" : "🙈 Yashirildi");
    } catch (err) {
      toast((err && err.message) || "Saqlanmadi");
    } finally {
      S.busy = false;
    }
  }

  /** 🗑 — «o'chirilgan» belgisi qo'yiladi (yozuv qoladi, tarix buzilmaydi).
   *  Tovarlar bilan bir xil mantiq: `deleted: true`. */
  async function deleteTrack(key) {
    const t = (S.music || []).find((x) => x.key === key);
    if (!t || S.busy) return;
    const ok = await ask("«" + t.title + "» o'chirilsinmi?");
    if (!ok) return;
    S.busy = true;
    try {
      await fb().patch(MUSIC_P + "/" + key, { deleted: true });
      S.music = (S.music || []).filter((x) => x.key !== key);
      haptic("success");
      renderMusic();
      freshenMusic();
      toast("🗑 O'chirildi");
    } catch (err) {
      toast((err && err.message) || "O'chirilmadi");
    } finally {
      S.busy = false;
    }
  }

  /* ==================================================================
     TASHQI INTERFEYS (app.js va admin.js ko'prigi)
     ================================================================== */
  const crm = () => window.ZimmerCRM;
  const stories = () => window.ZimmerStories;
  /* ZimmerAdmin — universal CRUD paneli. Bu yerda faqat «Xizmatlar»
     bo'limi uchun ishlatiladi (`openEmbedded("srv")`). */
  const adm = () => window.ZimmerAdmin;

  function isActive() {
    return (
      S.view !== null ||
      (crm() && crm().isActive()) ||
      (stories() && stories().isActive()) ||
      (adm() && adm().isActive && adm().isActive())
    );
  }
  function close() {
    S.view = null;
    if (crm()) crm().close();
    if (stories()) stories().close();
    if (adm() && adm().close) adm().close();
  }
  function back() {
    /* Xizmatlar oynasi ochiq bo'lsa — avval uning ichki qadami
       (forma -> ro'yxat), keyin ZimmerShop menyusiga. */
    if (adm() && adm().isActive && adm().isActive()) {
      if (adm().embedBack()) return true;
      adm().close();
      renderMenu();
      return true;
    }
    // Stories oynasi ochiq bo'lsa — avval uning ichki qadami
    if (stories() && stories().isActive()) {
      if (stories().back()) return true;
      stories().close();
      renderMenu();
      return true;
    }
    /* Mijozlar/statistika oynasi ochiq bo'lsa — avval CRM o'zining ichki
       qadamini qaytaradi (mijoz tafsiloti -> ro'yxat). Ro'yxatning o'zida
       turgan bo'lsa `false` qaytaradi va biz menyuga chiqamiz. */
    if (crm() && crm().isActive()) {
      if (crm().back()) return true;
      crm().close();
      renderMenu();
      return true;
    }
    if (
      S.view === "add" ||
      S.view === "edit" ||
      S.view === "inventory" ||
      S.view === "orders" ||
      S.view === "music" ||
      S.view === "banners" ||
      S.view === "banner-form"
    ) {
      renderMenu();
      return true;
    }
    S.view = null;
    return false;
  }
  function reload() {
    if (adm() && adm().isActive && adm().isActive()) return adm().embedReload();
    if (stories() && stories().isActive()) return stories().reload();
    if (crm() && crm().isActive()) return crm().reload();
    if (S.view === "inventory") return openInventory();
    // Buyurtma oynasi: AYNI bo'limni qayta o'qiydi (ilgari har doim
    // do'kon buyurtmalariga qaytarib yuborardi).
    if (S.view === "orders") return openKind(S.ordKind || "order");
    if (S.view === "music") return openMusic();
    if (S.view === "banners" || S.view === "banner-form") return openBanners();
    if (S.view === "add") return openAdd();
    return open();
  }

  return {
    open: open,
    back: back,
    reload: reload,
    isActive: isActive,
    close: close,

    /* ---------------------------------------------------------------
       CRM MODULI UCHUN (docs/js/admin-crm.js)

       Mijozlar ro'yxati va statistika AYNI buyurtma quvurini ishlatadi.
       Agar ular o'zining nusxasini yozsa, ertaga bu yerda holat nomi yoki
       tugun o'zgarsa — hisobot jimgina noto'g'ri raqam ko'rsatardi. Shu
       sababli quvur va lug'atlar shu yerdan BERILADI, ko'chirilmaydi.
       --------------------------------------------------------------- */
    loadKind: loadKind, // buyurtmalarni o'qish (order | biled | booking)
    KINDS: KINDS, // holat lug'atlari va sarlavhalar
    money: money, // "320 000 so'm"
    timeLabel: timeLabel, // "Bugun 14:38" / "26.08 14:38"
    orderCard: orderCard, // buyurtma kartochkasi (mijoz tafsilotida)
    menu: renderMenu, // menyuga qaytish
    setHead: setHead, // topbar sarlavhasi
  };
})();
