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
    ["🚚 Yetkazish", "🚚 Toshkent bo'ylab yetkazib berish mavjud."],
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
      "</div></div>" +
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
      /* ---- asosiy ma'lumotlar ---- */
      '<div class="admin-form-group"><div class="apx-head">' +
      '<div class="apx-ic">🏷</div>' +
      "<div class=\"apx-tx\"><b>Asosiy ma'lumotlar</b><span>Nomi · narxi · qoldiq</span></div></div>" +
      '<input type="text" class="admin-input" id="shop-name" placeholder="Tovar nomi (mas: Bi-LED linza)">' +
      '<input type="text" inputmode="numeric" class="admin-input" id="shop-price" placeholder="Narxi — hozirgi sotuv narxi (so\'m)">' +
      '<input type="text" class="admin-input" id="shop-code" placeholder="Artikul / OEM kod (ixtiyoriy)">' +
      '<input type="text" class="admin-input" id="shop-badge" placeholder="Belgi — mas: Yangi, TOP (ixtiyoriy)">' +
      '<input type="number" inputmode="numeric" class="admin-input" id="shop-stock" placeholder="Qoldiq (dona)" value="10">' +
      "</div>" +
      /* ---- aksiya ---- */
      '<div class="admin-form-group apx-sale"><div class="apx-head">' +
      '<div class="apx-ic apx-ic-red">🔥</div>' +
      "<div class=\"apx-tx\"><b>Aksiya (ixtiyoriy)</b><span>Eski narxni yozing — chegirma o'zi hisoblanadi</span></div></div>" +
      '<input type="text" inputmode="numeric" class="admin-input" id="shop-old" placeholder="Eski narx — hozirgi narxdan KATTA">' +
      '<div class="apx-sale-note" id="shop-sale-note">Bo\'sh qoldirilsa — aksiya yo\'q.</div>' +
      '<input type="number" class="admin-input" id="shop-flash-h" placeholder="Necha soat (bo\'sh = muddatsiz)" step="0.5" min="0">' +
      "</div>" +
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

  /** Add va Edit formalari uchun UMUMIY bog'lashlar. */
  function bindForm() {
    bindPhotos();
    bindChips();
    bindDesc();
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
    const photos = photoUrls();
    const oldp = parseNum($("shop-old") && $("shop-old").value);
    const flashH =
      parseFloat(String(($("shop-flash-h") && $("shop-flash-h").value) || "").replace(",", ".")) || 0;

    if (name.length < 2) return { err: "Tovar nomini kiriting" };
    if (name.length > 160) return { err: "Nom juda uzun (160 belgigacha)" };
    if (!price) return { err: "Narxni kiriting" };
    if (stock === null) return { err: "Qoldiqni kiriting (0 bo'lishi mumkin)" };
    if (!S.catSel) return { err: "Kategoriyani tanlang" };
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
      carName: carName,
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
      freshenShop();
      const it = S.items.find((x) => String(x.id) === String(id));
      if (it) it.stock = val;
    } catch (err) {
      toast((err && err.message) || "Saqlanmadi");
    }
  }

  /* ---- ommaviy amallar ---- */
  function bindBulk() {
    // Ommaviy narx maydonida ham raqamlar ajratiladi
    bindMoney(["shop-bulk-price"]);
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
      freshenShop();
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
