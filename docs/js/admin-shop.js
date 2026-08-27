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

  const S = {
    view: null, // menu | add | edit | inventory
    cats: [], // [{name, icon}]
    cars: [], // [{id, name}]
    items: [], // ombor ro'yxati
    editing: null, // tahrirlanayotgan tovar id si
    photos: [], // [{url, pct, phase, error}]
    catSel: null, // tanlangan kategoriya nomi
    carSel: null, // tanlangan mashina id si (ixtiyoriy)
    query: "",
    filter: "all", // all | low
    selected: {}, // ombor ommaviy tanlovi {id:true}
    orders: [],
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
    clearPhotos();
    S.selected = {};
    // Qidiruv va filtr har ochilishda tozalanadi — aks holda oldingi
    // sessiyaning qidiruvi qolib, ombor bo'sh ko'rinardi.
    S.query = "";
    S.filter = "all";
    bindTopbar();
    setHead("Boshqaruv", "Tovarlar — bitta manba");
    loading("Tekshirilmoqda...");
    try {
      await loadCatalogMeta();
    } catch (err) {
      return fail(err, open);
    }
    renderMenu();
  }

  function renderMenu() {
    S.view = "menu";
    // Forma yopildi — mahalliy rasm URL'larini bo'shatamiz (xotira).
    clearPhotos();
    setHead("Boshqaruv", "Tovarlar — bitta manba");
    body().innerHTML =
      '<div class="shop-hero">' +
      '<button class="shop-hero-card shop-hero-add" id="shop-add">' +
      '<span class="shop-hero-ic">＋</span>' +
      "<span class=\"shop-hero-tx\"><b>Yangi tovar</b><i>Mahsulot qo'shish</i></span>" +
      "</button>" +
      '<button class="shop-hero-card shop-hero-inv" id="shop-inv">' +
      '<span class="shop-hero-ic">📦</span>' +
      "<span class=\"shop-hero-tx\"><b>Ombor</b><i>Zaxira nazorati</i></span>" +
      "</button>" +
      '<button class="shop-hero-card shop-hero-ord" id="shop-ord">' +
      '<span class="shop-hero-ic">📋</span>' +
      "<span class=\"shop-hero-tx\"><b>Buyurtmalar</b><i>Mijoz buyurtmalari</i></span>" +
      "</button>" +
      "</div>";
    $("shop-add").onclick = () => {
      haptic();
      openAdd();
    };
    $("shop-inv").onclick = () => {
      haptic();
      openInventory();
    };
    $("shop-ord").onclick = () => {
      haptic();
      openOrders();
    };
  }

  /* ==================================================================
     BUYURTMALAR (pending_orders — brauzerdan to'g'ridan)
     ================================================================== */
  const STATUS_TEXT = {
    new: "yangi",
    accepted: "qabul qilindi",
    delivering: "yo'lda",
    done: "yetkazildi",
    cancelled: "bekor",
  };
  const NEXT_STEPS = {
    new: [["accepted", "Qabul qilish"], ["cancelled", "Bekor qilish"]],
    accepted: [["delivering", "Yo'lga chiqdi"], ["cancelled", "Bekor qilish"]],
    delivering: [["done", "Yetkazildi"]],
  };

  async function openOrders() {
    S.view = "orders";
    setHead("Buyurtmalar", "Mijoz buyurtmalari");
    loading("Buyurtmalar o'qilmoqda...");
    try {
      const node = await fb().get("pending_orders");
      S.orders = [];
      if (node && typeof node === "object") {
        Object.keys(node).forEach((key) => {
          const r = node[key];
          if (!r || typeof r !== "object") return;
          const total = Number(r.total) || 0;
          S.orders.push({
            key: key,
            code: r.code || key,
            uid: r.uid || null,
            name: r.customer_name || r.name || "",
            phone: r.phone || "",
            address: r.address || "",
            total: total,
            total_label: money(total),
            status: r.status || "new",
            items: Array.isArray(r.items) ? r.items : [],
            created_at: r.createdAt || null,
          });
        });
        S.orders.sort((a, b) => Number(b.created_at || 0) - Number(a.created_at || 0));
      }
      renderOrders();
    } catch (err) {
      fail(err, openOrders);
    }
  }

  function renderOrders() {
    if (!S.orders.length) {
      body().innerHTML =
        '<div class="adm-hint-block">Hali buyurtma tushmagan. Mijoz do\'kondan ' +
        "buyurtma berganda shu yerda ko'rinadi.</div>";
      return;
    }
    body().innerHTML = S.orders.map(orderCard).join("");
    S.orders.forEach((o) => {
      (NEXT_STEPS[o.status] || []).forEach(([status]) => {
        const btn = $("shop-o-" + o.key + "-" + status);
        if (btn) btn.onclick = () => setOrderStatus(o, status);
      });
    });
  }

  function orderCard(o) {
    const items = (o.items || [])
      .map((it) => "· " + esc(it.name || "") + " × " + (it.qty || 1))
      .join("<br>");
    const acts = (NEXT_STEPS[o.status] || [])
      .map(
        ([status, label]) =>
          '<button class="btn btn-ghost btn-sm" id="shop-o-' +
          esc(o.key) +
          "-" +
          status +
          '">' +
          esc(label) +
          "</button>"
      )
      .join("");
    return (
      '<div class="adm-order"><div class="adm-order-head"><b>' +
      esc(o.code) +
      '</b><span class="adm-status">' +
      esc(STATUS_TEXT[o.status] || o.status) +
      "</span></div><div class=\"adm-order-body\">" +
      (o.name ? "<div>" + esc(o.name) + "</div>" : "") +
      (o.phone ? '<div class="adm-phone">' + esc(o.phone) + "</div>" : "") +
      (o.address ? "<div>" + esc(o.address) + "</div>" : "") +
      (items ? "<div>" + items + "</div>" : "") +
      '</div><div class="adm-order-total">' +
      esc(o.total_label) +
      "</div>" +
      (acts ? '<div class="adm-order-acts">' + acts + "</div>" : "") +
      "</div>"
    );
  }

  async function setOrderStatus(order, status) {
    if (S.busy) return;
    S.busy = true;
    try {
      await fb().patch("pending_orders/" + order.key, { status: status, status_at: Date.now() });
      haptic("success");
      // Mijozga Telegram xabari Worker orqali (bot tokeni faqat o'sha yerda).
      let notified = false;
      try {
        const off = window.ZimmerOffline;
        if (off && off.adminOrderStatus) {
          await off.adminOrderStatus(order.key, status);
          notified = true;
        }
      } catch (_) {
        notified = false;
      }
      toast(notified ? "✅ Holat o'zgardi — mijozga xabar ketdi" : "✅ Holat o'zgardi (xabar ketmadi)");
      openOrders();
    } catch (err) {
      toast((err && err.message) || "O'zgarmadi");
    } finally {
      S.busy = false;
    }
  }

  /* ==================================================================
     RASMLAR — galereyadan yuklash (ImgBB) + JONLI progress

     ================== NIMA UCHUN ISHLAMAY QOLGAN EDI ==================
     Admin galereyadan rasm tanlaydi — va HECH NARSA bo'lmaydi. Eskiz
     chiqmaydi, foiz chiqmaydi, xato ham chiqmaydi. Sababi bitta qatorda:

         inp.onchange = async (ev) => {
           const files = ev.target.files;   // havola olindi
           ev.target.value = "";            // <-- input tozalandi
           await handleFiles(files);        // files ALLAQACHON BO'SH
         };

     `input.files` — TIRIK (live) `FileList`. Brauzer har chaqiruvda AYNI
     o'sha obyektni qaytaradi, `input.value = ""` esa o'sha obyektni
     JOYIDA bo'shatadi. Ya'ni `files` o'zgaruvchisi ham bo'sh bo'lib
     qoladi va `handleFiles` ning birinchi qatori jimgina chiqib ketardi:

         if (!up() || !files || !files.length) return;   // <- shu yer

     Input `value` ni tozalash O'ZI KERAK — aks holda admin ayni o'sha
     faylni ikkinchi marta tanlasa `onchange` umuman ishlamaydi. Yechim:
     ro'yxatni AVVAL haqiqiy massivga ko'chirib olish, KEYIN tozalash.
     Avto_A1 aynan shunday qiladi (`Array.from(event.target.files)`) —
     shuning uchun u yerda rasm yuklash bexato ishlaydi.

     ================== JONLI KO'RINISH (yangi) ==================
     Ilgari yuklanish paytida faqat bo'sh kvadratcha ichida «siqilmoqda»
     yozuvi turardi — admin o'zi tanlagan rasmni ko'rmasdi va nima
     bo'layotganini tushunmasdi. Endi Avto_A1 dan bir qadam oldinga:

       • rasm DARHOL ko'rinadi (`URL.createObjectURL` — internet kutilmaydi)
       • ustida qorong'i qatlam + halqa + foiz: «siqilmoqda…» -> «37%»
       • tugagach ✅ chaqnaydi va qatlam so'nadi, «Asosiy» belgisi chiqadi
       • xato bo'lsa qizil ❌ + «↻ Qayta» tugmasi (fayl saqlanib turadi)

     Yana bir farq: progress har tick'da butun ro'yxatni QAYTA YASAMAYDI.
     Ilgari `renderThumbs()` `innerHTML` ni to'liq almashtirardi va `<img>`
     har foizda qaytadan yuklanib miltillardi. Endi faqat foiz matni va
     chiziq kengligi o'zgaradi.
     ================================================================== */

  /** Slot fazalari. `up().uploadFile` "siqish"/"yuklash" deb xabar beradi. */
  const PH = { COMPRESS: "compress", UPLOAD: "upload", DONE: "done", ERROR: "error" };

  function photoBlock() {
    const ready = up() && up().available();
    let html =
      '<div class="admin-form-group"><div class="apx-head">' +
      '<div class="apx-ic">🖼</div>' +
      "<div class=\"apx-tx\"><b>Rasmlar</b><span>Birinchi qadam · 1–" +
      MAX_PHOTOS +
      " ta</span></div></div>";

    if (ready) {
      // DIQQAT: fayl input'i yuklash zonasini TO'LIQ qoplaydi (shaffof).
      // Ilgari `<label for>` + `hidden` input ishlatilgan edi — ko'p
      // brauzerda ishlaydi, lekin ba'zi Telegram WebView'larida `hidden`
      // input `label` bosilganda ochilmaydi. Qoplama input — eng ishonchli
      // usul: bosish to'g'ridan input'ning o'ziga tushadi.
      html +=
        '<div class="apx-upload" id="shop-drop">' +
        '<div class="apx-up-ic">⬆️</div>' +
        '<div class="apx-up-t">Galereyadan rasm yuklash</div>' +
        '<div class="apx-up-s">Rasm tanlang — yuklanishi shu yerda ko\'rinadi</div>' +
        '<input type="file" id="shop-file" accept="image/*" multiple>' +
        "</div>";
    } else {
      html +=
        '<div class="adm-hint-block">Galereyadan yuklash uchun ImgBB kaliti kerak ' +
        "(config.js -> IMGBB_KEY). Hozircha havola qo'ying.</div>";
    }
    html +=
      '<div class="shop-thumbs" id="shop-thumbs"></div>' +
      '<div class="up-status" id="shop-up-status"></div>' +
      '<input type="text" class="admin-input" id="shop-img1" placeholder="Yoki rasm linki (ixtiyoriy)">' +
      '<input type="text" class="admin-input" id="shop-img2" placeholder="2-rasm linki (ixtiyoriy)">' +
      '<input type="text" class="admin-input" id="shop-img3" placeholder="3-rasm linki (ixtiyoriy)">' +
      "</div>";
    return html;
  }

  function bindPhotos() {
    const inp = $("shop-file");
    if (inp)
      inp.onchange = (ev) => {
        // 1) NUSXA OLAMIZ — `ev.target.files` tirik obyekt, tozalashdan
        //    keyin bo'shab qoladi. `slice` haqiqiy massiv yasaydi.
        const picked = Array.prototype.slice.call(ev.target.files || []);
        // 2) endi tozalash xavfsiz (ayni fayl qayta tanlansa ham ishlaydi)
        ev.target.value = "";
        // 3) `onchange` ni bloklamaymiz — yuklash fonda ketadi
        handleFiles(picked);
      };

    // Zaxira: agar biror WebView'da qoplama input bosilmasa, zonaning
    // o'zi input'ni majburan ochadi.
    const zone = $("shop-drop");
    if (zone && inp)
      zone.onclick = (ev) => {
        if (ev.target !== inp) {
          haptic();
          inp.click();
        }
      };

    // Qo'lda kiritilgan havola: jonli kartochka DARHOL yangilanadi, eskiz
    // esa yozib bo'lgandan keyin. Aks holda har harfda chala havola bilan
    // `<img>` yaratilib, buzuq rasm belgisi miltillab turadi.
    let linkTimer = null;
    ["shop-img1", "shop-img2", "shop-img3"].forEach((id) => {
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

  /* -------------------------------------------------------- slot hayoti */

  function objectUrl(file) {
    try {
      return URL.createObjectURL(file);
    } catch (_) {
      return null;
    }
  }

  function makeSlot(file) {
    return {
      file: file,
      localUrl: objectUrl(file), // internet kutmasdan ko'rsatish uchun
      url: null, // ImgBB havolasi (saqlanadigan qiymat)
      pct: 0,
      phase: PH.COMPRESS,
      error: null,
      node: null, // DOM tugun (joyida yangilash uchun)
      settled: false, // ✅ chaqnashi ko'rsatilganmi
    };
  }

  /** Object URL'ni bo'shatamiz — aks holda har rasm xotirada qolib ketadi. */
  function releaseSlot(slot) {
    if (slot && slot.localUrl) {
      try {
        URL.revokeObjectURL(slot.localUrl);
      } catch (_) {}
      slot.localUrl = null;
    }
  }

  function clearPhotos() {
    S.photos.forEach(releaseSlot);
    S.photos = [];
  }

  /* -------------------------------------------------------- havolalar */

  /** Faqat qo'lda kiritilgan havolalar. */
  function manualUrls() {
    const out = [];
    ["shop-img1", "shop-img2", "shop-img3"].forEach((id) => {
      const v = $(id) && $(id).value.trim();
      if (v) out.push(v);
    });
    return out;
  }

  /** SAQLANADIGAN havolalar: yuklab bo'lingan + qo'lda kiritilgan (max 3). */
  function photoUrls() {
    const out = S.photos.filter((p) => p.url).map((p) => p.url).concat(manualUrls());
    return out.filter((u, i) => out.indexOf(u) === i).slice(0, MAX_PHOTOS);
  }

  /** KO'RSATISH uchun: yuklanmagan slotlar ham mahalliy rasmni beradi. */
  function previewUrls() {
    const out = S.photos
      .map((p) => p.url || p.localUrl)
      .filter(Boolean)
      .concat(manualUrls());
    return out.filter((u, i) => out.indexOf(u) === i).slice(0, MAX_PHOTOS);
  }

  /** Nechta o'rin band (slot + qo'lda kiritilgan havola). */
  function usedCount() {
    return S.photos.length + manualUrls().length;
  }

  function busyPhotos() {
    return S.photos.filter((p) => p.phase === PH.COMPRESS || p.phase === PH.UPLOAD).length;
  }

  /* -------------------------------------------------------- yuklash */

  async function handleFiles(picked) {
    if (!up() || !up().available()) return;
    const files = (picked || []).filter(Boolean);
    if (!files.length) return;

    const room = MAX_PHOTOS - usedCount();
    if (room <= 0) return toast("Maksimum " + MAX_PHOTOS + " ta rasm");

    const list = files.slice(0, room);
    if (files.length > room) {
      toast("Faqat " + room + " ta qo'shildi (chegara " + MAX_PHOTOS + " ta)");
    }

    const slots = list.map(makeSlot);
    slots.forEach((s) => S.photos.push(s));
    // Eskizlar DARHOL chiqadi — admin tanlagan rasmini ko'radi.
    renderThumbs();
    haptic();

    let ok = 0;
    for (const slot of slots) {
      if (await runSlot(slot)) ok++;
    }

    if (ok) {
      haptic("success");
      toast("✅ " + ok + " ta rasm yuklandi");
    }
    paintStatus();
  }

  /** Bitta slotni siqib yuklaydi. «↻ Qayta» tugmasi ham shu funksiyani
   *  chaqiradi — shuning uchun holat har chaqiruvda noldan tiklanadi.
   *
   *  DIQQAT: `try` faqat YUKLASHNI o'raydi. Ilgari muvaffaqiyat kodi ham
   *  `try` ichida edi va u yerdagi har qanday nosozlik (masalan DOM
   *  yangilashdagi kutilmagan xato) `catch` ga tushib, ALLAQACHON yuklab
   *  bo'lingan rasmni «yuklanmadi» deb ko'rsatardi. */
  async function runSlot(slot) {
    slot.error = null;
    slot.pct = 0;
    slot.phase = PH.COMPRESS;
    paintSlot(slot);
    paintStatus();

    let res = null;
    try {
      res = await up().uploadFile(slot.file, (pct, phase) => {
        slot.pct = pct;
        slot.phase = phase === "siqish" ? PH.COMPRESS : PH.UPLOAD;
        paintSlot(slot);
      });
    } catch (err) {
      slot.phase = PH.ERROR;
      slot.error = (err && err.message) || "Yuklanmadi";
      if (err && err.code === "bad_key") slot.error = "ImgBB kaliti xato (config.js)";
      if (err && err.code === "no_key") slot.error = "ImgBB kaliti yo'q (config.js)";
      paintSlot(slot);
      paintStatus();
      haptic("error");
      toast("❌ " + slot.error);
      return false;
    }

    slot.url = res.url;
    slot.pct = 100;
    slot.phase = PH.DONE;
    // Eskiz mahalliy `blob:` dan ImgBB havolasiga o'tadi, mahalliy nusxa
    // esa bo'shatiladi (xotira).
    paintSlot(slot);
    releaseSlot(slot);
    livePreview();
    paintStatus();
    return true;
  }

  /* -------------------------------------------------------- ko'rinish */

  /** Slot uchun DOM tugun yasaydi (bir marta) va `slot.node` ga saqlaydi. */
  function slotNode(slot) {
    const wrap = document.createElement("div");
    wrap.className = "img-thumb-wrap up-slot";

    const img = document.createElement("img");
    img.alt = "";
    // Havola buzuq bo'lsa BO'SH kvadrat qolmasin — belgi ko'rsatamiz.
    img.onerror = () => wrap.classList.add("up-broken");
    img.onload = () => wrap.classList.remove("up-broken");
    const src = slot.url || slot.localUrl;
    // `img.src = ""` brauzerda SAHIFANING o'zini yuklashga urinadi —
    // shuning uchun bo'sh bo'lsa umuman qo'ymaymiz.
    if (src) {
      img.src = src;
      slot.shownUrl = src;
    } else {
      wrap.classList.add("up-broken");
    }
    wrap.appendChild(img);

    const ov = document.createElement("div");
    ov.className = "up-ov";
    ov.innerHTML =
      '<span class="up-spin"></span><span class="up-pct"></span><span class="up-bar"></span>';
    wrap.appendChild(ov);

    const badge = document.createElement("span");
    badge.className = "img-main-badge";
    badge.textContent = "Asosiy";
    wrap.appendChild(badge);

    const del = document.createElement("button");
    del.className = "img-del";
    del.type = "button";
    del.textContent = "✕";
    del.onclick = (ev) => {
      ev.stopPropagation();
      haptic();
      // Indeks bilan emas, OBYEKT bilan izlaymiz: bir nechta rasm bir
      // vaqtda yuklanayotganda indekslar siljib ketadi.
      const k = S.photos.indexOf(slot);
      if (k >= 0) S.photos.splice(k, 1);
      releaseSlot(slot);
      renderThumbs();
    };
    wrap.appendChild(del);

    const retry = document.createElement("button");
    retry.className = "up-retry";
    retry.type = "button";
    retry.textContent = "↻";
    retry.title = "Qayta urinish";
    retry.onclick = (ev) => {
      ev.stopPropagation();
      haptic();
      runSlot(slot);
    };
    wrap.appendChild(retry);

    slot.node = wrap;
    paintSlot(slot);
    return wrap;
  }

  /** Slotning HOLATINI joyida yangilaydi (rasmni qayta yuklamasdan).
   *  Bezash NIKAKDA yuklashni buzmasligi kerak — shu sababli butun tanasi
   *  himoyalangan. */
  function paintSlot(slot) {
    try {
      paintSlotUnsafe(slot);
    } catch (_) {}
  }

  function paintSlotUnsafe(slot) {
    const wrap = slot && slot.node;
    if (!wrap) return;

    const pctEl = wrap.querySelector(".up-pct");
    const barEl = wrap.querySelector(".up-bar");
    const imgEl = wrap.querySelector("img");

    wrap.classList.remove("is-compress", "is-upload", "is-done", "is-error");

    if (slot.phase === PH.ERROR) {
      wrap.classList.add("is-error");
      if (pctEl) pctEl.textContent = "❌";
      if (barEl) barEl.style.width = "100%";
      wrap.title = slot.error || "Yuklanmadi";
      return;
    }

    if (slot.phase === PH.DONE) {
      wrap.classList.add("is-done");
      if (pctEl) pctEl.textContent = "✅";
      if (barEl) barEl.style.width = "100%";
      wrap.title = "";
      // Bulut havolasiga o'tamiz (mahalliy `blob:` bo'shatilgach yo'qoladi).
      // `slot.shownUrl` ni o'zimiz yuritamiz: `imgEl.src` brauzerda MUTLAQ
      // manzil bo'lib qaytadi, ya'ni to'g'ridan solishtirish ishonchsiz —
      // rasm har bo'yashda qaytadan yuklanib miltillashi mumkin.
      if (imgEl && slot.url && slot.shownUrl !== slot.url) {
        slot.shownUrl = slot.url;
        imgEl.src = slot.url;
      }
      // ✅ bir lahza chaqnaydi, keyin qatlam so'nadi. `settled` — bu
      // chaqnash BIR MARTA bo'lishi uchun: ro'yxat qayta yasalganda
      // (masalan yangi rasm qo'shilganda) eski eskiz yana chaqnamasin.
      if (slot.settled) {
        wrap.classList.add("is-clean");
      } else {
        setTimeout(() => {
          slot.settled = true;
          if (slot.phase === PH.DONE && slot.node) slot.node.classList.add("is-clean");
        }, 450);
      }
      return;
    }

    wrap.classList.remove("is-clean");
    if (slot.phase === PH.COMPRESS) {
      wrap.classList.add("is-compress");
      if (pctEl) pctEl.textContent = "siqilmoqda";
      if (barEl) barEl.style.width = "8%";
    } else {
      wrap.classList.add("is-upload");
      if (pctEl) pctEl.textContent = slot.pct + "%";
      if (barEl) barEl.style.width = Math.max(3, slot.pct) + "%";
    }
  }

  /** Qo'lda kiritilgan havola uchun oddiy eskiz. */
  function linkNode(url) {
    const wrap = document.createElement("div");
    wrap.className = "img-thumb-wrap up-slot is-done is-clean up-link";

    const img = document.createElement("img");
    img.alt = "";
    img.src = url;
    img.onerror = () => wrap.classList.add("up-broken");
    wrap.appendChild(img);

    const badge = document.createElement("span");
    badge.className = "img-main-badge";
    badge.textContent = "Asosiy";
    wrap.appendChild(badge);
    return wrap;
  }

  /** Butun ro'yxatni qayta yasaydi (slot qo'shilganda/o'chirilganda). */
  function renderThumbs() {
    const box = $("shop-thumbs");
    if (!box) return;

    box.innerHTML = "";
    S.photos.forEach((slot) => {
      slot.node = null;
      box.appendChild(slotNode(slot));
    });
    // Qo'lda kiritilgan havolalar ham ko'rinadi. Ilgari `photoUrls()`
    // hisoblanardi-yu, natijasi ishlatilmasdi — link qo'ygan admin
    // eskizni ko'rmasdi va rasm tushgan-tushmaganini bilmasdi.
    manualUrls().forEach((u) => box.appendChild(linkNode(u)));

    // «Asosiy» belgisi faqat BIRINCHI eskizda turadi.
    const first = box.querySelector(".up-slot");
    Array.prototype.forEach.call(box.querySelectorAll(".up-slot"), (n) => {
      n.classList.toggle("is-main", n === first);
    });

    paintStatus();
    livePreview();
  }

  /** Eskizlar ostidagi holat qatori: nechta tayyor, nechta ketmoqda. */
  function paintStatus() {
    const el = $("shop-up-status");
    if (!el) return;
    const busy = busyPhotos();
    const bad = S.photos.filter((p) => p.phase === PH.ERROR).length;
    const ready = photoUrls().length;

    if (busy) {
      el.className = "up-status is-busy";
      el.textContent = "⏳ " + busy + " ta rasm yuklanmoqda — sahifadan chiqmang";
    } else if (bad) {
      el.className = "up-status is-bad";
      el.textContent = "❌ " + bad + " ta rasm yuklanmadi — ↻ bosib qayta urinib ko'ring";
    } else if (ready) {
      el.className = "up-status is-ok";
      el.textContent = "✅ " + ready + " ta rasm tayyor";
    } else {
      el.className = "up-status";
      el.textContent = "";
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
    const oldp = parseNum($("shop-flash") && $("shop-flash").value);
    const code = ($("shop-code") && $("shop-code").value.trim()) || "";
    // KO'RSATISH uchun mahalliy rasm ham yaraydi — kartochka ImgBB javobini
    // kutib turmasin. Saqlashda esa faqat `photoUrls()` (haqiqiy havolalar).
    const img = previewUrls()[0] || "";

    if (!name && !price && !img) {
      box.innerHTML =
        '<div class="lp-empty">Maydonlarni to\'ldiring — bu yerda mijozga qanday ko\'rinishi chiqadi</div>';
      return;
    }
    const main = String(name || "Tovar nomi").split("·")[0].trim();
    // flash: oldp asl narxdan kichik bo'lsa chegirma sifatida ko'rsatamiz
    const hasFlash = oldp && price && oldp < price;
    const off = hasFlash ? Math.round(((price - oldp) / price) * 100) : 0;
    box.innerHTML =
      '<div class="lp-card">' +
      (img
        ? '<img src="' + esc(img) + '" alt="">'
        : '<div class="lp-noimg">💡</div>') +
      '<div style="flex:1;min-width:0;">' +
      '<div class="lp-name">' +
      esc(main) +
      "</div>" +
      (code ? '<div class="lp-code">🔖 ' + esc(code) + "</div>" : "") +
      '<div class="lp-price">' +
      esc(money(hasFlash ? oldp : price || 0)) +
      (off ? ' <span class="lp-off">-' + off + "%</span>" : "") +
      "</div></div></div>";
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

    if (S.cars.length) {
      html +=
        '<div class="apx-sub">Mashina (ixtiyoriy)</div><div class="shop-chips" id="shop-cars">' +
        '<button type="button" class="cat-chip shop-car" data-car="">🌐 Universal</button>' +
        S.cars
          .map(
            (c) =>
              '<button type="button" class="cat-chip shop-car" data-car="' +
              esc(String(c.id)) +
              '">' +
              esc(c.name) +
              "</button>"
          )
          .join("");
      html += "</div>";
    }
    html += "</div>";
    return html;
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
    document.querySelectorAll("#shop-cars .shop-car").forEach((btn) => {
      btn.onclick = () => {
        haptic();
        S.carSel = btn.dataset.car || null;
        document.querySelectorAll("#shop-cars .shop-car").forEach((b) => b.classList.remove("selected"));
        btn.classList.add("selected");
      };
      const cur = S.carSel == null ? "" : String(S.carSel);
      if ((btn.dataset.car || "") === cur) btn.classList.add("selected");
    });
  }

  /* ==================================================================
     ASOSIY MA'LUMOTLAR bloki (nom/narx/kod/flash/qoldiq)
     ================================================================== */
  function mainBlock() {
    return (
      '<div class="admin-form-group"><div class="apx-head">' +
      '<div class="apx-ic">🏷</div>' +
      "<div class=\"apx-tx\"><b>Asosiy ma'lumotlar</b><span>Nomi · narxi · artikul</span></div></div>" +
      '<input type="text" class="admin-input" id="shop-name" placeholder="Tovar nomi (mas: Bi-LED linza)">' +
      '<input type="text" inputmode="numeric" class="admin-input" id="shop-price" placeholder="Narxi (so\'mda, mas: 150 000)">' +
      '<input type="text" class="admin-input" id="shop-code" placeholder="Artikul / kod (ixtiyoriy)">' +
      '<div class="apx-flash"><div class="apx-sub" style="color:#ff6b61;margin-top:0;">Flash chegirma (ixtiyoriy)</div>' +
      '<input type="text" inputmode="numeric" class="admin-input" id="shop-flash" placeholder="Chegirma narxi (asl narxdan kam)">' +
      '<input type="number" class="admin-input" id="shop-flash-h" placeholder="Necha soat davom etadi (mas: 24)" step="0.5" min="0">' +
      "<div class=\"adm-hint\">Bo'sh qoldirilsa — chegirma yo'q.</div></div>" +
      '<input type="number" inputmode="numeric" class="admin-input" id="shop-stock" placeholder="Qoldiq (dona)" value="10">' +
      '<textarea class="admin-input" id="shop-desc" style="height:90px;resize:none;" placeholder="Tavsif (ixtiyoriy)"></textarea>' +
      "</div>"
    );
  }

  /* ==================================================================
     YANGI TOVAR
     ================================================================== */
  function openAdd() {
    S.view = "add";
    S.editing = null;
    clearPhotos();
    S.catSel = null;
    S.carSel = null;
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

    bindPhotos();
    bindChips();
    ["shop-name", "shop-price", "shop-code", "shop-flash"].forEach((id) => {
      if ($(id)) $(id).oninput = livePreview;
    });
    renderThumbs();
    $("shop-save").onclick = () => saveProduct(null);
  }

  /** Formadan tovar obyektini yig'adi (add va edit uchun umumiy). */
  function collect() {
    const name = ($("shop-name").value || "").trim();
    const price = parseNum($("shop-price").value);
    const stock = parseNum($("shop-stock").value);
    const code = ($("shop-code").value || "").trim();
    const desc = ($("shop-desc") && $("shop-desc").value.trim()) || "";
    const photos = photoUrls();
    const flash = parseNum($("shop-flash") && $("shop-flash").value);
    const flashH = parseFloat(String(($("shop-flash-h") && $("shop-flash-h").value) || "").replace(",", ".")) || 0;

    if (name.length < 2) return { err: "Tovar nomini kiriting" };
    if (name.length > 160) return { err: "Nom juda uzun (160 belgigacha)" };
    if (!price) return { err: "Narxni kiriting" };
    if (stock === null) return { err: "Qoldiqni kiriting (0 bo'lishi mumkin)" };
    if (!S.catSel) return { err: "Kategoriyani tanlang" };
    for (const u of photos) {
      if (!/^https?:\/\/[^\s]+$/i.test(u)) return { err: "Rasm havolasi http(s) bo'lishi kerak" };
    }
    // Yuklanish tugamagan bo'lsa saqlamaymiz — aks holda tovar RASMSIZ
    // qolib ketadi (havola hali kelmagan).
    if (busyPhotos()) return { err: "⏳ Rasm yuklanmoqda — bir lahza kuting" };

    const carName = S.carSel
      ? (S.cars.find((c) => String(c.id) === String(S.carSel)) || {}).name || null
      : null;

    // Maydonlar `services/sync.py: _catalog_payload` bilan MOS.
    const rec = {
      _key: name,
      name: name,
      description: desc || null,
      price: price,
      old_price: null,
      stock: stock,
      code: code || null,
      badge: null,
      photo_url: photos[0] || null,
      photo_id: null,
      photo2_url: photos[1] || null,
      photo2_id: null,
      photo3_url: photos[2] || null,
      photo3_id: null,
      is_active: 1,
      deleted: false,
      categoryName: S.catSel,
      carName: carName,
      updatedAt: Date.now(),
      source: "miniapp",
    };

    // Flash chegirma: chegirma narx asl narxdan kichik + soat > 0.
    // price = ASL narx maydoni; flash < price bo'lsa: price=flash, old_price=asl.
    if (flash && flash < price && flashH > 0) {
      rec.old_price = price;
      rec.price = flash;
      rec.flashUntil = Date.now() + Math.round(flashH * 3600000);
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
      haptic("success");
      if (app().state) app().state.home = null; // bosh sahifa keshi eskirdi

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
     OMBOR
     ================================================================== */
  async function openInventory() {
    S.view = "inventory";
    S.selected = {};
    setHead("Ombor", "Zaxira nazorati");
    loading("Ombor o'qilmoqda...");
    try {
      const node = await fb().get(P);
      S.items = [];
      if (node && typeof node === "object") {
        Object.keys(node).forEach((k) => {
          const r = node[k];
          if (!r || typeof r !== "object" || r.deleted) return;
          S.items.push({
            id: r.id == null ? k : r.id,
            name: String(r.name || "Nomsiz"),
            price: Number(r.price) || 0,
            stock: Number(r.stock) || 0,
            code: r.code || "",
            is_active: r.is_active !== 0 && r.is_active !== false,
            photo_url: r.photo_url || null,
            photo_id: r.photo_id || null,
            categoryName: r.categoryName || "",
            carName: r.carName || "",
            _raw: r,
          });
        });
        S.items.sort((a, b) => Number(b.id) - Number(a.id));
      }
      renderInventory();
    } catch (err) {
      fail(err, openInventory);
    }
  }

  function stockRank(s) {
    return s <= 0 ? 0 : s <= 3 ? 1 : 2;
  }

  function renderInventory() {
    const q = S.query.toLowerCase();
    let list = S.items.slice();
    if (S.filter === "low") list = list.filter((p) => p.stock <= 3);
    if (q) list = list.filter((p) => p.name.toLowerCase().indexOf(q) !== -1 || String(p.code).toLowerCase().indexOf(q) !== -1);
    list.sort((a, b) => stockRank(a.stock) - stockRank(b.stock));

    const low = S.items.filter((p) => p.stock > 0 && p.stock <= 3).length;
    const out = S.items.filter((p) => p.stock <= 0).length;

    let html =
      '<input type="text" class="search-box" id="shop-q" placeholder="🔍 Tovar nomi yoki kod" value="' +
      esc(S.query) +
      '">' +
      '<div class="shop-filters">' +
      '<button class="chip shop-fchip' +
      (S.filter === "all" ? " selected" : "") +
      '" data-f="all">Hammasi</button>' +
      '<button class="chip shop-fchip' +
      (S.filter === "low" ? " selected" : "") +
      '" data-f="low" style="color:#ff9f0a;">⚠️ Kam qolgan</button>' +
      "</div>" +
      '<div class="inv2-summary">' +
      '<div class="inv2-stat"><b>' +
      S.items.length +
      "</b><span>Jami tovar</span></div>" +
      '<div class="inv2-stat inv2-stat-low"><b>' +
      low +
      "</b><span>Kam qoldi</span></div>" +
      '<div class="inv2-stat inv2-stat-out"><b>' +
      out +
      "</b><span>Tugagan</span></div></div>";

    // Ommaviy amallar paneli
    const selIds = Object.keys(S.selected);
    if (selIds.length) {
      html +=
        '<div class="shop-bulk"><div class="shop-bulk-top"><b>' +
        selIds.length +
        ' ta belgilandi</b><span id="shop-bulk-clear">Bekor</span></div>' +
        '<div class="shop-bulk-row">' +
        '<input type="text" inputmode="numeric" class="inv-input" id="shop-bulk-price" placeholder="Yangi narx" style="width:100px">' +
        '<button class="inv-btn" id="shop-bulk-setprice">Narx qo\'yish</button>' +
        '<input type="number" class="inv-input" id="shop-bulk-pct" placeholder="%" style="width:54px">' +
        '<button class="inv-btn" id="shop-bulk-plus" style="background:#30d158">＋%</button>' +
        '<button class="inv-btn" id="shop-bulk-minus" style="background:#ff9f0a">−%</button>' +
        '<button class="inv-btn" id="shop-bulk-del" style="background:#ff453a;color:#fff">🗑</button>' +
        "</div></div>";
    }

    html += list.length ? list.map(itemRow).join("") : '<div class="adm-hint">Tovar topilmadi.</div>';
    body().innerHTML = html;

    const qEl = $("shop-q");
    qEl.oninput = () => {
      S.query = qEl.value;
      const pos = qEl.selectionStart;
      renderInventory();
      const again = $("shop-q");
      again.focus();
      again.setSelectionRange(pos, pos);
    };
    document.querySelectorAll(".shop-fchip").forEach((b) => {
      b.onclick = () => {
        haptic();
        S.filter = b.dataset.f;
        renderInventory();
      };
    });
    bindInventoryRows(list);
    bindBulk();
  }

  function itemRow(p) {
    const thumb = p.photo_url
      ? '<img class="adm-thumb" src="' + esc(p.photo_url) + '" alt="">'
      : p.photo_id && window.ZimmerOffline && window.ZimmerOffline.mediaUrl
        ? '<img class="adm-thumb" src="' + esc(window.ZimmerOffline.mediaUrl(p.photo_id)) + '" alt="">'
        : '<div class="adm-thumb-empty">📦</div>';
    const flag =
      p.stock <= 0
        ? '<span class="inv-flag inv-flag-out">Tugagan</span>'
        : p.stock <= 3
          ? '<span class="inv-flag inv-flag-low">Kam qoldi</span>'
          : "";
    const marks = [];
    if (!p.is_active) marks.push('<span class="inv-flag inv-flag-out">Yashirin</span>');
    const sel = S.selected[p.id] ? " shop-sel" : "";

    return (
      '<div class="shop-item' +
      sel +
      '">' +
      '<input type="checkbox" class="shop-check" data-id="' +
      esc(p.id) +
      '"' +
      (S.selected[p.id] ? " checked" : "") +
      ">" +
      thumb +
      '<div class="shop-item-mid"><b>' +
      esc(p.name) +
      "</b>" +
      (p.code ? '<span class="inv-code">🔖 ' + esc(p.code) + "</span>" : "") +
      '<div class="shop-item-sub">' +
      esc(money(p.price)) +
      " " +
      flag +
      marks.join(" ") +
      "</div></div>" +
      '<div class="shop-item-act">' +
      '<input type="number" class="inv-input" id="shop-st-' +
      esc(p.id) +
      '" value="' +
      p.stock +
      '">' +
      '<button class="inv-btn shop-savestock" data-id="' +
      esc(p.id) +
      '">✓</button>' +
      '<button class="btn btn-ghost btn-sm shop-edit" data-id="' +
      esc(p.id) +
      '">✏️</button>' +
      "</div></div>"
    );
  }

  function bindInventoryRows(list) {
    document.querySelectorAll(".shop-check").forEach((el) => {
      el.onchange = () => {
        const id = el.dataset.id;
        if (el.checked) S.selected[id] = true;
        else delete S.selected[id];
        renderInventory();
      };
    });
    document.querySelectorAll(".shop-savestock").forEach((b) => {
      b.onclick = () => fastStock(b.dataset.id);
    });
    document.querySelectorAll(".shop-edit").forEach((b) => {
      b.onclick = () => {
        const p = list.find((x) => String(x.id) === String(b.dataset.id));
        if (p) openEdit(p);
      };
    });
  }

  async function fastStock(id) {
    const el = $("shop-st-" + id);
    const val = parseNum(el && el.value);
    if (val === null) return toast("Qoldiqni to'g'ri kiriting");
    try {
      await fb().patch(P + "/" + id, { stock: val, updatedAt: Date.now() });
      haptic("success");
      toast("✅ Qoldiq yangilandi");
      if (app().state) app().state.home = null;
      const it = S.items.find((x) => String(x.id) === String(id));
      if (it) it.stock = val;
    } catch (err) {
      toast((err && err.message) || "Saqlanmadi");
    }
  }

  /* ---- ommaviy amallar ---- */
  function bindBulk() {
    if ($("shop-bulk-clear"))
      $("shop-bulk-clear").onclick = () => {
        S.selected = {};
        renderInventory();
      };
    if ($("shop-bulk-setprice"))
      $("shop-bulk-setprice").onclick = async () => {
        const np = parseNum($("shop-bulk-price").value);
        if (!np) return toast("Yangi narx kiriting");
        await bulkApply((it) => ({ price: np }));
      };
    if ($("shop-bulk-plus"))
      $("shop-bulk-plus").onclick = () => bulkPercent(1);
    if ($("shop-bulk-minus"))
      $("shop-bulk-minus").onclick = () => bulkPercent(-1);
    if ($("shop-bulk-del"))
      $("shop-bulk-del").onclick = async () => {
        const ids = Object.keys(S.selected);
        if (!ids.length) return;
        const ok = await ask(ids.length + " ta tovarni o'chirasizmi?");
        if (!ok) return;
        await bulkApply(null, true);
      };
  }

  async function bulkPercent(sign) {
    const pct = parseFloat($("shop-bulk-pct").value);
    if (!pct || pct <= 0) return toast("Foiz kiriting");
    await bulkApply((it) => ({ price: Math.max(0, Math.round(it.price * (1 + (sign * pct) / 100))) }));
  }

  /** mutate(it)->patch obyekti; del=true bo'lsa o'chiradi. */
  async function bulkApply(mutate, del) {
    const ids = Object.keys(S.selected);
    if (!ids.length) return;
    if (S.busy) return;
    S.busy = true;
    try {
      for (const id of ids) {
        const it = S.items.find((x) => String(x.id) === String(id));
        if (del) {
          // Bulutda «o'chirilgan» belgisi (bot import qilmasin) — put null EMAS,
          // chunki bot restore uchun _key kerak bo'lishi mumkin. deleted:true.
          await fb().patch(P + "/" + id, { deleted: true, updatedAt: Date.now() });
        } else if (mutate && it) {
          const patch = mutate(it);
          patch.updatedAt = Date.now();
          await fb().patch(P + "/" + id, patch);
        }
      }
      haptic("success");
      toast(del ? ids.length + " ta o'chirildi" : ids.length + " ta yangilandi");
      if (app().state) app().state.home = null;
      S.selected = {};
      openInventory();
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
    S.carSel = null;
    if (r.carName) {
      const car = S.cars.find((c) => c.name === r.carName);
      if (car) S.carSel = String(car.id);
    }
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

    bindPhotos();

    // Mavjud qiymatlarni to'ldiramiz
    const imgs = [r.photo_url, r.photo2_url, r.photo3_url].filter(Boolean);
    ["shop-img1", "shop-img2", "shop-img3"].forEach((id, i) => {
      if ($(id)) $(id).value = imgs[i] || "";
    });
    $("shop-name").value = r.name || "";
    // flash aktiv bo'lsa narx maydonida ASL narx
    const now = Date.now();
    if (r.flashUntil && r.flashUntil > now && r.old_price && Number(r.old_price) > Number(r.price)) {
      $("shop-price").value = money(r.old_price).replace(" so'm", "");
      $("shop-flash").value = money(r.price).replace(" so'm", "");
      $("shop-flash-h").value = Math.max(0, Math.round(((r.flashUntil - now) / 3600000) * 10) / 10);
    } else {
      $("shop-price").value = money(r.price).replace(" so'm", "");
    }
    $("shop-code").value = r.code || "";
    $("shop-stock").value = Number(r.stock) || 0;
    if ($("shop-desc")) $("shop-desc").value = r.description || "";

    bindChips();
    ["shop-name", "shop-price", "shop-code", "shop-flash"].forEach((id) => {
      if ($(id)) $(id).oninput = livePreview;
    });
    // Mavjud rasmlar ham eskiz sifatida chiqadi. Ilgari `renderThumbs()`
    // tahrir formasida umuman chaqirilmasdi — admin tovarning rasmi bor
    // yoki yo'qligini faqat pastdagi «jonli ko'rinish»dan taxmin qilardi.
    renderThumbs();

    $("shop-save").onclick = () => saveProduct(p.id);
    $("shop-hide").onclick = async () => {
      const next = !(r.is_active === 0 || r.is_active === false);
      try {
        await fb().patch(P + "/" + p.id, { is_active: next ? 0 : 1, updatedAt: Date.now() });
        haptic("success");
        toast(next ? "✅ Yashirildi" : "✅ Ko'rsatiladi");
        if (app().state) app().state.home = null;
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
        if (app().state) app().state.home = null;
        openInventory();
      } catch (err) {
        toast((err && err.message) || "Saqlanmadi");
      }
    };
  }

  /* ==================================================================
     TASHQI INTERFEYS (app.js va admin.js ko'prigi)
     ================================================================== */
  function isActive() {
    return S.view !== null;
  }
  function close() {
    S.view = null;
  }
  function back() {
    if (S.view === "add" || S.view === "edit" || S.view === "inventory" || S.view === "orders") {
      renderMenu();
      return true;
    }
    S.view = null;
    return false;
  }
  function reload() {
    if (S.view === "inventory") return openInventory();
    if (S.view === "orders") return openOrders();
    if (S.view === "add") return openAdd();
    return open();
  }

  return {
    open: open,
    back: back,
    reload: reload,
    isActive: isActive,
    close: close,
  };
})();
