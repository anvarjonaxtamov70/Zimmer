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
  const fb = () => window.ZimmerFB;
  const $ = (id) => document.getElementById(id);

  /** Katalogdagi tovarlar yo'li. */
  const P_PRODUCTS = "catalog/products";

  const esc = (v) => (app().esc ? app().esc(v) : String(v == null ? "" : v));
  const toast = (m) => (app().toast ? app().toast(m) : void 0);
  const haptic = (k) => (app().haptic ? app().haptic(k) : void 0);
  const ask = (m) => (app().ask ? app().ask(m) : Promise.resolve(window.confirm(m)));

  /** SQLite'da 3 ustun juftligi bor (photo/photo2/photo3). */
  const MAX_PHOTOS = 3;

  const S = {
    view: null, // null | menu | add | inventory | orders
    items: [],
    drafts: [],
    orders: [],
    query: "",
    busy: false,
    photos: [], // [{url, pct, phase, error}]
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
    } else if (code === "rules") {
      // Eng ko'p uchraydigan sabab: qoidalar Firebase Console'ga qo'yilmagan.
      hint =
        "Firebase Console -> Realtime Database -> Rules bo'limiga " +
        "database.rules.json faylidagi matnni qo'yib «Publish» bosing.";
    } else if (code === "no_db") {
      hint = "docs/config.js da FIREBASE_DB_URL ko'rsatilmagan.";
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
  /* ==================================================================
     WORKER TEKSHIRUVI — «na ombor ishlayapti na tovar qo'shish» sababi

     Cloudflare GitHub'dan O'ZI yangilanmaydi: kod qo'lda qo'yiladi.
     Repoda `/admin/*` endpointlari bo'lsa ham, Cloudflare'da eski nusxa
     turgan bo'lishi mumkin — o'sha holatda har chaqiruv 404 qaytaradi.

     Ilgari bunda tushunarsiz «Bunday manzil yo'q» xatosi chiqardi va
     sababni faqat men topa olardim. Endi panel o'zi aniqlab, ANIQ nima
     qilish kerakligini ko'rsatadi.
     ================================================================== */
  /** Baza sozlanmagan bo'lsa ko'rsatma chizadi va `true` qaytaradi. */
  function blockedNoDb() {
    if (fb() && fb().available()) return false;
    setHead("Baza sozlanmagan", "");
    body().innerHTML =
      '<div class="adm-fail">' +
      '<div class="adm-fail-icon">⚙️</div>' +
      "<p><b>FIREBASE_DB_URL sozlanmagan.</b></p>" +
      '<p class="adm-hint">docs/config.js faylida baza manzilini ko\'rsatish kerak.</p>' +
      "</div>";
    return true;
  }

  function openMenu() {
    S.view = "menu";
    setHead("Boshqaruv", "Bazaga to'g'ridan ulangan");
    if (blockedNoDb()) return;
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
    S.photos = [];
    body().innerHTML =
      '<div class="adm-form">' +
      photoBlock() +
      field("admo-name", "Tovar nomi", "text", "Masalan: Ochki L200", true) +
      field("admo-price", "Narxi (so'm)", "text", "320 000", true) +
      field("admo-stock", "Qoldiq (dona)", "text", "6", true) +
      areaField("admo-desc", "Tavsif") +
      // Mijozga qanday ko'rinishini DARHOL ko'rsatamiz — rasm to'g'ri
      // yuklanganini tekshirishning eng ishonchli yo'li.
      '<div class="adm-group"><span>Mijozga qanday ko\'rinadi</span>' +
      '<div id="admo-preview"></div></div>' +
      '<button class="btn btn-primary" id="admo-save">Saqlash</button>' +
      "</div>";

    bindPhotos();
    ["admo-name", "admo-price", "admo-stock", "admo-photo"].forEach((id) => {
      const elx = $(id);
      if (elx) elx.oninput = livePreview;
    });
    livePreview();
    $("admo-save").onclick = saveProduct;
  }

  /** Do'kon kartochkasining AYNAN o'zi (`app.js: renderProducts` bilan bir
   *  xil `.prod` klasslari). Shu sababli admin rasm va narx qanday
   *  ko'rinishini saqlashdan OLDIN ko'radi. */
  function livePreview() {
    const box = $("admo-preview");
    if (!box) return;

    const name = ($("admo-name") && $("admo-name").value.trim()) || "";
    const price = parseNum($("admo-price") && $("admo-price").value);
    const stock = parseNum($("admo-stock") && $("admo-stock").value);
    const photo = photoUrls()[0] || null;

    if (!name && !price && !photo) {
      box.innerHTML =
        '<div class="adm-hint">Maydonlarni to\'ldiring — bu yerda mijozga ' +
        "qanday ko'rinishi chiqadi.</div>";
      return;
    }

    const main = String(name || "Tovar nomi").split("·")[0].trim();
    const low = stock !== null && stock > 0 && stock <= 5;

    box.innerHTML =
      '<div class="prod" style="max-width:190px">' +
      '<div class="prod-art' +
      (photo ? "" : " empty") +
      '">' +
      (photo
        ? '<img src="' + esc(photo) + '" alt="" loading="lazy">'
        : '<span class="prod-art-ph">💡</span>') +
      "</div>" +
      '<div class="prod-body">' +
      '<div class="prod-name">' +
      esc(main) +
      "</div>" +
      (low ? '<div class="prod-meta"><span class="prod-low">📦 ' + stock + " ta qoldi</span></div>" : "") +
      '<div class="prod-price">' +
      esc(price ? money(price) : "— so'm") +
      "</div>" +
      (stock === 0 ? '<div class="adm-mini">Tugagan — mijoz buyurtma bermaydi</div>' : "") +
      "</div></div>";
  }

  /* ------------------------------------------------------------ rasmlar */

  /** Telefon galereyasidan yuklash bloki. Kalit sozlanmagan bo'lsa —
   *  havola qo'yish maydoni va nima qilish kerakligi. */
  function photoBlock() {
    const up = window.ZimmerUpload;
    const ready = up && up.available();

    let html = '<div class="adm-group"><span>Rasmlar (' + MAX_PHOTOS + " tagacha)</span>";

    if (ready) {
      html +=
        '<label class="btn btn-ghost" for="admo-file" id="admo-pick">' +
        "📷 Telefondan rasm tanlash</label>" +
        '<input type="file" id="admo-file" accept="image/*" multiple hidden>' +
        '<div class="adm-figures" id="admo-thumbs"></div>' +
        '<div class="adm-hint">Rasm telefonda kichraytirilib yuboriladi — ' +
        "mobil internet tejaladi va do'kon tez ochiladi.</div>";
    } else {
      html +=
        '<div class="adm-hint-block">Galereyadan yuklash uchun bir marta ' +
        "ImgBB kaliti kerak (bepul, karta talab qilinmaydi):<br><br>" +
        '<span class="adm-mini">api.imgbb.com → Get API key</span><br><br>' +
        "keyin uni <b>docs/config.js</b> dagi <b>IMGBB_KEY</b> ga qo'ying." +
        "</div>";
    }

    // Havola qo'yish har doim mumkin — zaxira yo'l.
    html +=
      '<label class="adm-field"><span>Yoki rasm havolasi</span>' +
      '<input class="field" id="admo-photo" type="text" placeholder="https://..."></label>' +
      "</div>";
    return html;
  }

  function bindPhotos() {
    const input = $("admo-file");
    if (!input) return;
    input.onchange = () => handleFiles(input.files);
  }

  async function handleFiles(files) {
    const up = window.ZimmerUpload;
    if (!up || !files || !files.length) return;

    const room = MAX_PHOTOS - S.photos.length;
    if (room <= 0) return toast("Maksimum " + MAX_PHOTOS + " ta rasm");

    const list = Array.prototype.slice.call(files, 0, room);
    if (files.length > room) {
      toast("Faqat " + room + " ta rasm qo'shildi (chegara " + MAX_PHOTOS + ")");
    }

    for (let i = 0; i < list.length; i++) {
      const slot = { url: null, pct: 0, phase: "siqish", error: null };
      S.photos.push(slot);
      renderThumbs();
      try {
        const res = await up.uploadFile(list[i], (pct, phase) => {
          slot.pct = pct;
          slot.phase = phase;
          renderThumbs();
        });
        slot.url = res.url;
        slot.bytes = res.bytes;
      } catch (err) {
        // Xatoni AYNAN ko'rsatamiz — «yuklanmadi» foydasiz.
        slot.error = (err && err.message) || "Yuklanmadi";
        if (err && err.code === "bad_key") {
          slot.error = "ImgBB kaliti xato — config.js ni tekshiring";
        }
        toast(slot.error);
      }
      renderThumbs();
    }
    // Bir xil faylni qayta tanlash mumkin bo'lsin
    const input = $("admo-file");
    if (input) input.value = "";
  }

  function renderThumbs() {
    const box = $("admo-thumbs");
    if (!box) return;
    box.innerHTML = S.photos
      .map((p, i) => {
        if (p.error) {
          return (
            '<div class="adm-figure"><div class="adm-thumb-empty">⚠️</div>' +
            '<button class="btn btn-ghost btn-sm" id="admo-rm-' +
            i +
            '">O\'chirish</button></div>'
          );
        }
        if (!p.url) {
          const label = p.phase === "siqish" ? "siqilmoqda" : p.pct + "%";
          return (
            '<div class="adm-figure"><div class="adm-thumb-empty">' +
            esc(label) +
            "</div></div>"
          );
        }
        return (
          '<div class="adm-figure"><img class="adm-thumb" src="' +
          esc(p.url) +
          '" alt="">' +
          '<button class="btn btn-ghost btn-sm" id="admo-rm-' +
          i +
          '">O\'chirish</button></div>'
        );
      })
      .join("");

    S.photos.forEach((_, i) => {
      const btn = $("admo-rm-" + i);
      if (btn)
        btn.onclick = () => {
          haptic();
          S.photos.splice(i, 1);
          renderThumbs();
          livePreview();
        };
    });

    // Rasm o'zgardi — kartochka ko'rinishini ham yangilaymiz.
    livePreview();
  }

  /** Yuklangan havolalar (xato va tugallanmaganlar tashlanadi). */
  function photoUrls() {
    const out = S.photos.filter((p) => p.url).map((p) => p.url);
    const manual = ($("admo-photo") && $("admo-photo").value.trim()) || "";
    if (manual) out.push(manual);
    return out.slice(0, MAX_PHOTOS);
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
    const desc = ($("admo-desc").value || "").trim();
    const photos = photoUrls();

    if (name.length < 2) return toast("Tovar nomini kiriting");
    if (name.length > 160) return toast("Nom juda uzun (160 belgigacha)");
    if (!price) return toast("Narxni kiriting");
    if (stock === null) return toast("Qoldiqni kiriting (0 bo'lishi mumkin)");

    // Qo'lda kiritilgan havola tekshiriladi (yuklanganlar ImgBB'dan keladi).
    const manual = ($("admo-photo") && $("admo-photo").value.trim()) || "";
    if (manual && !/^https?:\/\/[^\s]+$/i.test(manual)) {
      return toast("Rasm havolasi http:// yoki https:// bilan boshlanishi kerak");
    }

    // Yuklanish tugamagan rasm bo'lsa kutamiz — aks holda tovar rasmsiz
    // saqlanib, admin buni sezmasdi.
    if (S.photos.some((p) => !p.url && !p.error)) {
      return toast("Rasm yuklanmoqda — bir soniya kuting");
    }

    S.busy = true;
    const btn = $("admo-save");
    btn.disabled = true;
    btn.textContent = "Saqlanmoqda...";

    try {
      // Id ni sanoqchidan olamiz (ETag bilan) — ikki admin bir vaqtda
      // qo'shsa ham id'lar har xil bo'ladi.
      const id = await fb().nextProductId();

      // Maydonlar `services/sync.py: _catalog_payload` bilan bir xil, shuning
      // uchun bot uyg'onganda `restore_catalog()` bu tovarni SQLite ga
      // O'ZI ko'chiradi — ya'ni tovar yo'qolmaydi va botga ham yetib boradi.
      //   `_key`        -> CATALOG_KEY["products"] = "name"
      //   `categoryName`-> CATALOG_LINKS orqali category_id ga aylanadi
      await fb().put(P_PRODUCTS + "/" + id, {
        id: id,
        _key: name,
        name: name,
        description: desc || null,
        price: price,
        old_price: null,
        stock: stock,
        badge: null,
        // Uchta rasm ustuni — SQLite bilan bir xil (`database/db.py`).
        photo_url: photos[0] || null,
        photo_id: null,
        photo2_url: photos[1] || null,
        photo2_id: null,
        photo3_url: photos[2] || null,
        photo3_id: null,
        is_active: 1,
        deleted: false,
        categoryName: "Boshqa",
        carName: null,
        updatedAt: Date.now(),
        source: "miniapp",
      });

      haptic("success");

      // Bosh sahifa keshi eskirdi — yangi tovar darhol chiqishi kerak.
      // `S.home = null` qo'yilsa `loadHome()` katalogni Firebase'dan
      // QAYTA o'qiydi (`app.js`: nav bosilganda `if (!S.home) loadHome()`).
      if (app().state) app().state.home = null;

      // Rasm haqiqatan joyiga tushganini ko'rsatish uchun to'g'ridan
      // do'konga o'tishni taklif qilamiz — «rasm ko'rinmayapti» degan
      // shubha qolmasin.
      const seen = await ask("✅ Tovar qo'shildi.\n\nDo'konda ko'rasizmi?");
      if (seen && app().show) {
        app().show("home");
        // Katalogni Firebase'dan QAYTA o'qiymiz — `show()` buni o'zi
        // qilmaydi, shu sababli yangi tovar ko'rinmay qolardi.
        if (app().loadHome) await app().loadHome();
        return;
      }
      toast("✅ Saqlandi");
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
      // To'g'ridan katalogdan o'qiymiz — Worker ham, Render ham qatnashmaydi.
      const node = await fb().get(P_PRODUCTS);
      S.items = [];
      S.drafts = [];
      if (node && typeof node === "object") {
        Object.keys(node).forEach((key) => {
          const r = node[key];
          if (!r || typeof r !== "object" || r.deleted) return;
          S.items.push({
            id: r.id == null ? key : r.id,
            name: String(r.name || "Nomsiz"),
            price: Number(r.price) || 0,
            stock: Number(r.stock) || 0,
            is_active: r.is_active !== 0 && r.is_active !== false,
            photo_url: r.photo_url || null,
            photo_id: r.photo_id || null,
            pending: false,
          });
        });
        // Yangi qo'shilgan tovar TEPADA turishi kerak.
        S.items.sort((a, b) => Number(b.id) - Number(a.id));
      }
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
      const id = fields.id;
      const patch = { updatedAt: Date.now() };
      if (fields.price !== undefined) patch.price = fields.price;
      if (fields.stock !== undefined) patch.stock = fields.stock;
      // `is_active` katalogda son sifatida saqlanadi (SQLite bilan bir xil).
      if (fields.is_active !== undefined) patch.is_active = fields.is_active ? 1 : 0;

      // PATCH — faqat o'zgargan maydonlar. PUT qilsak qolgan maydonlar
      // (rasm, tavsif, kategoriya) o'chib ketardi.
      await fb().patch(P_PRODUCTS + "/" + id, patch);

      haptic("success");
      toast(okMsg);
      if (app().state) app().state.home = null;
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
            imported: !!r.imported,
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
      // Holatni to'g'ridan bazaga yozamiz — bu HAR DOIM ishlaydi.
      await fb().patch("pending_orders/" + order.key, {
        status: status,
        status_at: Date.now(),
      });
      haptic("success");

      // Mijozga Telegram xabari — bot tokeni faqat Worker'da, shuning uchun
      // xabar Worker orqali ketadi. Worker javob bermasa HOLAT BARIBIR
      // o'zgargan bo'ladi; shu sababli xabarni alohida aytamiz, aks holda
      // admin "o'zgarmadi shekilli" deb o'ylaydi.
      let notified = false;
      try {
        if (off().adminOrderStatus) {
          await off().adminOrderStatus(order.key, status);
          notified = true;
        }
      } catch (_) {
        notified = false;
      }

      toast(
        notified
          ? "✅ Holat o'zgardi — mijozga xabar ketdi"
          : "✅ Holat o'zgardi (mijozga xabar ketmadi)"
      );
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
