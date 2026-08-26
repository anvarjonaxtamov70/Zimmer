/* ==========================================================================
   ZIMMER — ZAXIRA REJIMDAGI ADMIN PANELI (Render'siz)

   Nima uchun alohida fayl?
   `admin.js` dagi 16 ta amal Render'ning `/api/admin/*` ga boradi va u
   schema'ga tayanadi (`/api/admin/schema`). Render uxlaganda ularning
   birortasi ham ishlamaydi. Ishlayotgan panelni qayta yozish o'rniga —
   Render tiklanganda hech narsa buzilmasin — zaxira rejim uchun ALOHIDA,
   ixcham panel qilindi. Ikkisi bir-biriga tegmaydi.

   Bu panel Cloudflare Worker bilan gaplashadi (`ZimmerOffline.admin*`).
   Worker har chaqiruvda Telegram imzosini tekshirib, uid ni o'zidagi
   ADMIN_IDS bilan solishtiradi — ya'ni himoya BRAUZERDA emas. Shu sababli
   bu fayldagi kodni "aldash" bilan admin bo'lib olish mumkin emas.

   Nima qila oladi: yangi tovar qo'shish, narx/qoldiq o'zgartirish,
   tovarni yashirish, zaxira buyurtmalarni ko'rish va holatini o'zgartirish.

   Nima qila OLMAYDI (ataylab): statistika, banner/stories tahriri, rasm
   galereyadan yuklash — bular Render'ning bazasini talab qiladi. Ularni
   "ishlayotgandek" ko'rsatib qo'yish yolg'on bo'lardi.
   ========================================================================== */

window.ZimmerAdminOffline = (function () {
  "use strict";

  const app = () => window.ZIMMER_APP || {};
  const off = () => window.ZimmerOffline || {};
  const $ = (id) => document.getElementById(id);

  const esc = (v) => (app().esc ? app().esc(v) : String(v == null ? "" : v));
  const toast = (m) => (app().toast ? app().toast(m) : void 0);
  const haptic = (k) => (app().haptic ? app().haptic(k) : void 0);
  const ask = (m) => (app().ask ? app().ask(m) : Promise.resolve(window.confirm(m)));

  const S = {
    view: null, // null | menu | add | inventory | orders
    items: [],
    drafts: [],
    orders: [],
    query: "",
    busy: false,
  };

  const body = () => $("admin-body");

  function setHead(title, sub) {
    const t = $("admin-title");
    const s = $("admin-sub");
    if (t) t.textContent = title;
    if (s) s.textContent = sub || "";
  }

  /** Narxni "320 000 so'm" ko'rinishida. */
  function money(v) {
    const n = Math.round(Number(v) || 0);
    return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, " ") + " so'm";
  }

  /** Foydalanuvchi kiritgan "320 000" / "320000" -> 320000. */
  function parseNum(raw) {
    const digits = String(raw == null ? "" : raw).replace(/[^\d]/g, "");
    return digits ? parseInt(digits, 10) : null;
  }

  function loading(text) {
    body().innerHTML = '<div class="adm-loading">' + esc(text || "Yuklanmoqda...") + "</div>";
  }

  /** Xatoni YASHIRMAYMIZ — sababini va nima qilishni aytamiz. */
  function fail(err, retry) {
    const code = (err && err.code) || "";
    let msg = (err && err.message) || "Xatolik yuz berdi";
    let hint = "";

    if (code === "forbidden" || code === "http_403") {
      hint = "Sizning Telegram ID raqamingiz Worker'dagi ADMIN_IDS ro'yxatida yo'q.";
    } else if (code === "no_worker") {
      hint = "Worker manzili sozlanmagan (config.js -> WORKER_URL).";
    } else if (code === "no_init_data") {
      hint = "Ilovani Telegram bot ichidan oching — imzo faqat o'sha yerda beriladi.";
    } else if (code === "network") {
      hint = "Internet aloqasini tekshiring.";
    } else if (String(code).indexOf("http_5") === 0) {
      hint = "Worker Firebase'ga ulanmadi. /health?deep=1 ni tekshirib ko'ring.";
    }

    body().innerHTML =
      '<div class="adm-fail">' +
      '<div class="adm-fail-icon">⚠️</div>' +
      "<p>" +
      esc(msg) +
      "</p>" +
      (hint ? '<p class="adm-hint">' + esc(hint) + "</p>" : "") +
      '<button class="btn btn-ghost btn-sm" id="admo-retry">Qayta urinish</button>' +
      "</div>";
    const btn = $("admo-retry");
    if (btn) btn.onclick = retry || openMenu;
  }

  /* ==================================================================
     MENYU
     ================================================================== */
  function openMenu() {
    S.view = "menu";
    setHead("Boshqaruv", "Zaxira rejim — Render'siz");
    body().innerHTML =
      '<div class="adm-hint-block">' +
      "Server hozir uxlagan. Shunga qaramay <b>tovar qo'shish</b>, " +
      "<b>narx va qoldiqni o'zgartirish</b> hamda <b>buyurtmalarni ko'rish</b> " +
      "ishlaydi — hammasi bulutga saqlanadi va server uyg'onganda " +
      "avtomatik katalogga o'tadi." +
      "</div>" +
      '<div class="adm-tiles">' +
      tile("admo-add", "➕", "Yangi tovar") +
      tile("admo-inv", "📦", "Ombor") +
      tile("admo-ord", "📋", "Buyurtmalar") +
      "</div>" +
      '<div class="adm-notes">' +
      '<div class="adm-note-row">Statistika, bannerlar va stories — server uyg\'onganda.</div>' +
      "</div>";

    $("admo-add").onclick = () => {
      haptic();
      openAdd();
    };
    $("admo-inv").onclick = () => {
      haptic();
      openInventory();
    };
    $("admo-ord").onclick = () => {
      haptic();
      openOrders();
    };
  }

  function tile(id, icon, title) {
    return (
      '<button class="adm-tile" id="' +
      id +
      '"><span class="adm-tile-ico">' +
      icon +
      "</span><b>" +
      esc(title) +
      "</b></button>"
    );
  }

  /* ==================================================================
     YANGI TOVAR
     ================================================================== */
  function openAdd() {
    S.view = "add";
    setHead("Yangi tovar", "Zaxira rejim");
    body().innerHTML =
      '<div class="adm-form">' +
      field("admo-name", "Tovar nomi", "text", "Masalan: Ochki L200", true) +
      field("admo-price", "Narxi (so'm)", "text", "320 000", true) +
      field("admo-stock", "Qoldiq (dona)", "text", "6", true) +
      field("admo-photo", "Rasm havolasi", "text", "https://...") +
      '<div class="adm-hint">Rasmni galereyadan yuklash server uyg\'onganda ishlaydi. ' +
      "Hozircha tayyor havola qo'ying yoki bo'sh qoldiring.</div>" +
      areaField("admo-desc", "Tavsif") +
      '<button class="btn btn-primary" id="admo-save">Saqlash</button>' +
      "</div>";

    $("admo-save").onclick = saveProduct;
  }

  function field(id, label, type, ph, req) {
    return (
      '<label class="adm-field"><span>' +
      esc(label) +
      (req ? ' <b class="adm-req">*</b>' : "") +
      '</span><input class="field" id="' +
      id +
      '" type="' +
      type +
      '" inputmode="' +
      (id === "admo-price" || id === "admo-stock" ? "numeric" : "text") +
      '" placeholder="' +
      esc(ph || "") +
      '"></label>'
    );
  }

  function areaField(id, label) {
    return (
      '<label class="adm-field"><span>' +
      esc(label) +
      '</span><textarea class="field" id="' +
      id +
      '" rows="3"></textarea></label>'
    );
  }

  async function saveProduct() {
    if (S.busy) return;

    const name = ($("admo-name").value || "").trim();
    const price = parseNum($("admo-price").value);
    const stock = parseNum($("admo-stock").value);
    const photo = ($("admo-photo").value || "").trim();
    const desc = ($("admo-desc").value || "").trim();

    // Tekshiruvni SHU YERDA ham qilamiz — mijoz Worker javobini kutmasin.
    // (Worker baribir qayta tekshiradi, bu faqat qulaylik uchun.)
    if (name.length < 2) return toast("Tovar nomini kiriting");
    if (!price) return toast("Narxni kiriting");
    if (stock === null) return toast("Qoldiqni kiriting (0 bo'lishi mumkin)");
    if (photo && photo.indexOf("https://") !== 0) {
      return toast("Rasm havolasi https:// bilan boshlanishi kerak");
    }

    S.busy = true;
    const btn = $("admo-save");
    btn.disabled = true;
    btn.textContent = "Saqlanmoqda...";

    try {
      // `client_key` — tarmoq uzilib qayta bosilsa ikkinchi nusxa yaralmaydi.
      const res = await off().adminAddProduct({
        name: name,
        price: price,
        stock: stock,
        photo_url: photo || null,
        description: desc,
        client_key: name + ":" + price + ":" + stock,
      });
      haptic("success");
      toast(res && res.duplicate ? "Bu tovar allaqachon saqlangan" : "✅ Tovar saqlandi");
      openInventory();
    } catch (err) {
      // Xato matnini AYNAN ko'rsatamiz — "saqlanmadi" deb qo'yish foydasiz.
      toast((err && err.message) || "Saqlanmadi");
      btn.disabled = false;
      btn.textContent = "Saqlash";
    } finally {
      S.busy = false;
    }
  }

  /* ==================================================================
     OMBOR
     ================================================================== */
  async function openInventory() {
    S.view = "inventory";
    setHead("Ombor", "Zaxira rejim");
    loading("Ombor o'qilmoqda...");
    try {
      const res = await off().adminCatalog();
      S.items = res.items || [];
      S.drafts = res.drafts || [];
      renderInventory();
    } catch (err) {
      fail(err, openInventory);
    }
  }

  function renderInventory() {
    const q = S.query.toLowerCase();
    const list = q
      ? S.items.filter((p) => String(p.name).toLowerCase().indexOf(q) !== -1)
      : S.items;

    let html =
      '<label class="adm-field"><input class="field" id="admo-q" placeholder="🔍 Tovar nomi" value="' +
      esc(S.query) +
      '"></label>';

    if (S.drafts.length) {
      html +=
        '<div class="adm-list-title">Kutilmoqda — ' +
        S.drafts.length +
        " ta</div>" +
        '<div class="adm-hint">Bu tovarlar bulutda saqlangan. Server uyg\'onganda katalogga o\'tadi.</div>' +
        S.drafts.map(draftRow).join("");
    }

    html += '<div class="adm-list-title">Katalog — ' + list.length + " ta</div>";
    html += list.length
      ? list.map(itemRow).join("")
      : '<div class="adm-hint">Tovar topilmadi.</div>';

    body().innerHTML = html;

    const qEl = $("admo-q");
    qEl.oninput = () => {
      S.query = qEl.value;
      const pos = qEl.selectionStart;
      renderInventory();
      const again = $("admo-q");
      again.focus();
      again.setSelectionRange(pos, pos);
    };

    list.forEach((p) => {
      const btn = $("admo-edit-" + p.id);
      if (btn) btn.onclick = () => openEdit(p);
    });
  }

  function draftRow(d) {
    return (
      '<div class="adm-row">' +
      '<div class="adm-thumb-empty">🆕</div>' +
      '<div class="adm-row-mid"><b>' +
      esc(d.name) +
      "</b><span>" +
      money(d.price) +
      " · " +
      d.stock +
      " dona</span></div>" +
      '<div class="adm-row-act"><span class="adm-status">kutilmoqda</span></div>' +
      "</div>"
    );
  }

  function itemRow(p) {
    const thumb = p.photo_url
      ? '<img class="adm-thumb" src="' + esc(p.photo_url) + '" alt="">'
      : p.photo_id && off().mediaUrl
        ? '<img class="adm-thumb" src="' + esc(off().mediaUrl(p.photo_id)) + '" alt="">'
        : '<div class="adm-thumb-empty">📦</div>';

    const marks = [];
    if (p.pending) marks.push('<span class="adm-status">tuzatilgan</span>');
    if (!p.is_active) marks.push('<span class="adm-status">yashirilgan</span>');
    if (!p.stock) marks.push('<span class="adm-status">tugagan</span>');

    return (
      '<div class="adm-row">' +
      thumb +
      '<div class="adm-row-mid"><b>' +
      esc(p.name) +
      "</b><span>" +
      money(p.price) +
      " · " +
      p.stock +
      " dona</span>" +
      (marks.length ? '<span class="adm-mini">' + marks.join(" ") + "</span>" : "") +
      "</div>" +
      '<div class="adm-row-act"><button class="btn btn-ghost btn-sm" id="admo-edit-' +
      esc(p.id) +
      '">Tahrir</button></div>' +
      "</div>"
    );
  }

  /* ==================================================================
     TAHRIRLASH
     ================================================================== */
  function openEdit(p) {
    S.view = "inventory"; // orqaga ombor'ga qaytadi
    setHead("Tahrir", p.name);
    body().innerHTML =
      '<div class="adm-form">' +
      '<div class="adm-hint-block">' +
      esc(p.name) +
      "</div>" +
      '<label class="adm-field"><span>Narxi (so\'m)</span><input class="field" id="admo-e-price" inputmode="numeric" value="' +
      esc(String(p.price)) +
      '"></label>' +
      '<label class="adm-field"><span>Qoldiq (dona)</span><input class="field" id="admo-e-stock" inputmode="numeric" value="' +
      esc(String(p.stock)) +
      '"></label>' +
      '<button class="btn btn-primary" id="admo-e-save">Saqlash</button>' +
      '<button class="btn btn-ghost" id="admo-e-hide">' +
      (p.is_active ? "Yashirish" : "Ko'rsatish") +
      "</button>" +
      '<div class="adm-hint">O\'zgarish bulutga yoziladi va server uyg\'onganda ' +
      "katalogga qo'llanadi. Katalogning o'zi hozir o'zgartirilmaydi — aks holda " +
      "keyingi sinxronda tuzatma o'chib ketardi.</div>" +
      "</div>";

    $("admo-e-save").onclick = async () => {
      const price = parseNum($("admo-e-price").value);
      const stock = parseNum($("admo-e-stock").value);
      if (!price) return toast("Narxni kiriting");
      if (stock === null) return toast("Qoldiqni kiriting");
      await applyEdit({ id: p.id, price: price, stock: stock }, "✅ Saqlandi");
    };

    $("admo-e-hide").onclick = async () => {
      const next = !p.is_active;
      const okGo = await ask(
        next ? "Tovar mijozlarga ko'rinadigan bo'ladimi?" : "Tovar mijozlardan yashirilsinmi?"
      );
      if (!okGo) return;
      await applyEdit(
        { id: p.id, is_active: next },
        next ? "✅ Ko'rinadigan bo'ldi" : "✅ Yashirildi"
      );
    };
  }

  async function applyEdit(fields, okMsg) {
    if (S.busy) return;
    S.busy = true;
    try {
      await off().adminEdit(fields);
      haptic("success");
      toast(okMsg);
      openInventory();
    } catch (err) {
      toast((err && err.message) || "Saqlanmadi");
    } finally {
      S.busy = false;
    }
  }

  /* ==================================================================
     BUYURTMALAR
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
    setHead("Buyurtmalar", "Zaxira rejim");
    loading("Buyurtmalar o'qilmoqda...");
    try {
      const res = await off().adminOrders();
      S.orders = res.orders || [];
      renderOrders();
    } catch (err) {
      fail(err, openOrders);
    }
  }

  function renderOrders() {
    if (!S.orders.length) {
      body().innerHTML =
        '<div class="adm-hint-block">Zaxira rejimda hali buyurtma tushmagan. ' +
        "Server uxlagan paytda mijoz bergan buyurtmalar shu yerda ko'rinadi.</div>";
      return;
    }
    body().innerHTML = S.orders.map(orderCard).join("");
    S.orders.forEach((o) => {
      (NEXT_STEPS[o.status] || []).forEach(([status]) => {
        const btn = $("admo-o-" + o.key + "-" + status);
        if (btn) btn.onclick = () => setStatus(o, status);
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
          '<button class="btn btn-ghost btn-sm" id="admo-o-' +
          esc(o.key) +
          "-" +
          status +
          '">' +
          esc(label) +
          "</button>"
      )
      .join("");

    return (
      '<div class="adm-order">' +
      '<div class="adm-order-head"><b>' +
      esc(o.code) +
      '</b><span class="adm-status">' +
      esc(STATUS_TEXT[o.status] || o.status) +
      "</span></div>" +
      '<div class="adm-order-body">' +
      (o.name ? "<div>" + esc(o.name) + "</div>" : "") +
      (o.phone ? '<div class="adm-phone">' + esc(o.phone) + "</div>" : "") +
      (o.address ? "<div>" + esc(o.address) + "</div>" : "") +
      (items ? "<div>" + items + "</div>" : "") +
      "</div>" +
      '<div class="adm-order-total">' +
      esc(o.total_label || money(o.total)) +
      "</div>" +
      (acts ? '<div class="adm-order-acts">' + acts + "</div>" : "") +
      "</div>"
    );
  }

  async function setStatus(order, status) {
    if (S.busy) return;
    S.busy = true;
    try {
      await off().adminOrderStatus(order.key, status);
      haptic("success");
      toast("✅ Holat o'zgardi — mijozga xabar ketdi");
      openOrders();
    } catch (err) {
      toast((err && err.message) || "O'zgarmadi");
    } finally {
      S.busy = false;
    }
  }

  /* ==================================================================
     TASHQI INTERFEYS
     ================================================================== */
  function open() {
    S.query = "";
    openMenu();
  }

  /** Panel hozir ishlayaptimi — `admin.js` va `goBack` shuni so'raydi. */
  function isActive() {
    return S.view !== null;
  }

  function close() {
    S.view = null;
  }

  /** Ichki qatlamdan orqaga. `true` — o'zi hal qildi. */
  function back() {
    if (S.view === "add" || S.view === "inventory" || S.view === "orders") {
      openMenu();
      return true;
    }
    S.view = null;
    return false;
  }

  function reload() {
    if (S.view === "inventory") return openInventory();
    if (S.view === "orders") return openOrders();
    if (S.view === "add") return openAdd();
    return openMenu();
  }

  return {
    open: open,
    back: back,
    reload: reload,
    isActive: isActive,
    close: close,
  };
})();
