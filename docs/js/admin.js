/* ==========================================================================
   ZIMMER — Mini App ichidagi ADMIN PANEL

   Nima qiladi: katalogning HAMMA bo'limini telefon ekranidan boshqarish —
   mahsulot qo'shish, Bi-LED linzalarni, ochkilarni, ranglarni, mashinalarni,
   bannerlarni, stories va aksiyalarni tahrirlash, rasm/video yuklash,
   yashirish/ko'rsatish, o'chirish va buyurtmalar holatini o'zgartirish.

   Muhim: bu fayl maydonlar ro'yxatini O'ZIDA saqlamaydi. Hammasi
   `/api/admin/schema` dan keladi (server tomonda `handlers/admin_schema.py`).
   Ya'ni backendga yangi maydon qo'shilsa — bu panelda o'zi paydo bo'ladi.

   app.js bilan aloqa: `window.ZIMMER_APP` ko'prigi (api, toast, esc, ...).
   ========================================================================== */

window.ZimmerAdmin = (function () {
  "use strict";

  /* ------------------------------------------------------------- ko'prik */
  const app = () => window.ZIMMER_APP || {};
  const $ = (id) => document.getElementById(id);

  /** Element yasash yordamchisi. app.js dagi `el` alohida ko'lamda —
      shuning uchun bu fayl o'zinikini ishlatadi. */
  const el = (tag, cls, html) => {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (html !== undefined) node.innerHTML = html;
    return node;
  };

  const esc = (v) => (app().esc ? app().esc(v) : String(v == null ? "" : v));
  const toast = (m) => (app().toast ? app().toast(m) : void 0);
  const haptic = (k) => (app().haptic ? app().haptic(k) : void 0);
  const fmt = (v) => (app().fmt ? app().fmt(v) : String(v));
  const ask = (m) => (app().ask ? app().ask(m) : Promise.resolve(window.confirm(m)));
  const api = (path, opts) => app().api(path, opts);

  /* --------------------------------------------------------------- holat */
  const S = {
    schema: null, // /api/admin/schema natijasi
    sections: {}, // key -> bo'lim tavsifi
    view: "menu", // menu | stats | orders | catalog | list | form
    key: null, // joriy bo'lim
    item: null, // tahrirlanayotgan element
    statKind: "products",
    statPeriod: "month",
    orderKind: "biled",
    orderStatus: null, // joriy filtr — holat o'zgargandan keyin saqlanadi
    newMedia: {}, // yangi element uchun tanlangan fayllar (kind -> File)
    busy: false,
    // ---- ombor va yangi tovar
    inv: null, // /api/admin/inventory natijasi
    invQuery: "", // qidiruv matni
    invFilter: "all", // all | low | out | hidden
    apCars: [], // yangi tovar formasidagi mashinalar
    apCarId: null, // tanlangan mashina
  };

  // Hisobot plitkalari. Katalog bo'limlari bularga QO'SHIB, bitta
  // ekranda ko'rsatiladi — alohida «Katalog» oynasi yo'q.
  const REPORTS = [
    { icon: "📊", title: "Tovarlar", open: () => openStats("products") },
    { icon: "🔥", title: "Bi-LED", open: () => openStats("biled") },
    { icon: "📋", title: "Buyurtmalar", open: () => openOrders("biled"), badge: true },
  ];

  const ORDER_TABS = [
    { kind: "biled", icon: "🔥", title: "Bi-LED" },
    { kind: "order", icon: "📦", title: "Do'kon" },
    { kind: "booking", icon: "🗓", title: "Navbat" },
  ];

  /* ------------------------------------------------------------ yordamchi */
  function body() {
    return $("admin-body");
  }

  function setHead(title, sub) {
    $("admin-title").textContent = title;
    $("admin-sub").textContent = sub || "";
  }

  function loading(text) {
    body().innerHTML = `<div class="adm-loading">${esc(text || "Yuklanmoqda...")}</div>`;
  }

  function fail(err, retry) {
    const msg = (err && err.message) || "Xatolik yuz berdi";
    body().innerHTML = `
      <div class="adm-fail">
        <div class="adm-fail-icon">⚠️</div>
        <p>${esc(msg)}</p>
        <button class="btn btn-ghost btn-sm" id="adm-retry">Qayta urinish</button>
      </div>`;
    const btn = $("adm-retry");
    if (btn) btn.onclick = retry || open;
  }

  /** Fayl yuklash (JSON emas — FormData). */
  async function upload(path, formData) {
    const base = app().apiBase ? app().apiBase() : "";
    const tg = window.Telegram ? window.Telegram.WebApp : null;
    let res;
    try {
      res = await fetch(base + path, {
        method: "POST",
        headers: { Authorization: "tma " + ((tg && tg.initData) || "") },
        body: formData,
      });
    } catch (_) {
      throw { code: "network", message: "Fayl yuborilmadi — internetni tekshiring." };
    }
    let data = null;
    try {
      data = await res.json();
    } catch (_) {}
    if (!res.ok) {
      const e = (data && data.error) || {};
      throw { code: e.code || "http_" + res.status, message: e.message || "Yuklanmadi" };
    }
    return data;
  }

  /** Rasm/videoni serverga yuklaydi (qo'shish va tahrirlashda bir xil). */
  function uploadMedia(key, rowId, kind, file) {
    const fd = new FormData();
    fd.append("kind", kind);
    fd.append("file", file, file.name);
    return upload(`/api/admin/section/${encodeURIComponent(key)}/${rowId}/media`, fd);
  }

  /* ====================================================================
     BOSH MENYU
     ==================================================================== */

  /** Bosh menyu — sodda ro'yxat. Har bir band alohida oyna ochadi. */
  async function openMenu() {
    S.view = "menu";
    S.key = null;
    S.item = null;
    setHead("Boshqaruv", "");
    loading();

    let data;
    try {
      data = await api("/api/admin/summary");
    } catch (err) {
      return fail(err, openMenu);
    }

    S.summary = data;
    const badges = data.badges || {};
    const counts = {
      orders: (badges.orders_new || 0) + (badges.biled_new || 0) + (badges.bookings_new || 0),
      catalog: badges.catalog || 0,
    };

    body().innerHTML = "";

    /** Bitta plitka yasaydi. */
    const tile = (icon, title, count, soft, onOpen) => {
      const node = el("button", "adm-tile");
      node.innerHTML = `
        <span class="adm-tile-ico">${icon}</span>
        <b>${esc(title)}</b>
        ${count ? `<em${soft ? ' class="soft"' : ""}>${count}</em>` : ""}`;
      node.onclick = () => {
        haptic();
        onOpen();
      };
      return node;
    };

    // ---- Hisobot
    body().append(el("div", "adm-group", "Hisobot"));
    const reports = el("div", "adm-tiles enter");
    REPORTS.forEach((entry) => {
      reports.append(
        tile(entry.icon, entry.title, entry.badge ? counts.orders : 0, false, entry.open)
      );
    });
    body().append(reports);

    // ---- Do'kon: ombor va yangi tovar qo'shish («Mahsulotlar» o'rniga)
    body().append(el("div", "adm-group", "Do'kon"));
    const shop = el("div", "adm-tiles enter");
    shop.append(tile("📦", "Ombor", 0, false, openInventory));
    shop.append(tile("➕", "Tovar qo'shish", 0, false, () => openAddProduct()));
    body().append(shop);

    // ---- Katalog bo'limlari (alohida oyna emas — shu yerda)
    body().append(el("div", "adm-group", "Katalog"));
    const sections = el("div", "adm-tiles enter");
    (data.sections || []).forEach((sec) => {
      sections.append(
        tile(esc(sec.icon), sec.title, sec.count, true, () => openList(sec.key))
      );
    });
    body().append(sections);
  }

  /* ====================================================================
     STATISTIKA — ikki turi alohida, aralashmaydi
     ==================================================================== */

  async function openStats(kind, period) {
    S.view = "stats";
    S.statKind = kind || S.statKind;
    S.statPeriod = period || S.statPeriod;
    loading();

    let data;
    try {
      data = await api(
        `/api/admin/stats/${encodeURIComponent(S.statKind)}?period=${encodeURIComponent(
          S.statPeriod
        )}`
      );
    } catch (err) {
      return fail(err, () => openStats(S.statKind, S.statPeriod));
    }

    setHead(data.title, "");
    body().innerHTML = "";

    // Davr tanlash
    const tabs = el("div", "adm-periods");
    (data.periods || []).forEach((p) => {
      const b = el("button", "adm-period" + (p.value === data.period ? " on" : ""), esc(p.label));
      b.onclick = () => {
        haptic();
        openStats(S.statKind, p.value);
      };
      tabs.append(b);
    });
    body().append(tabs);

    // Asosiy raqamlar
    const grid = el("div", "adm-figures");
    (data.cards || []).forEach((c) => {
      const box = el("div", "adm-figure" + (c.wide ? " wide" : ""));
      box.innerHTML = `<b>${esc(c.value)}</b><span>${esc(c.label)}</span>`;
      grid.append(box);
    });
    body().append(grid);

    // Qo'shimcha holatlar
    if ((data.notes || []).length) {
      const notes = el("div", "adm-notes");
      data.notes.forEach((n) => {
        notes.append(el("div", "adm-note-row", `<span>${esc(n.label)}</span><b>${n.value}</b>`));
      });
      body().append(notes);
    }

    // Reytinglar
    (data.lists || []).forEach((block) => {
      if (!(block.items || []).length) return;
      body().append(el("div", "adm-list-title", esc(block.title)));
      const box = el("div", "adm-rank");
      block.items.forEach((item, index) => {
        box.append(
          el(
            "div",
            "adm-rank-row",
            `<i>${index + 1}</i>
             <b>${esc(item.name)}</b>
             <span>${item.units} ta</span>
             <em>${esc(item.total_label)}</em>`
          )
        );
      });
      body().append(box);
    });

    if (data.hint) body().append(el("p", "adm-hint-block", esc(data.hint)));
  }



  /* ====================================================================
     OMBOR (Avto_A1 mantiqi: qidiruv, filtr, xulosa, tez saqlash)
     ==================================================================== */

  const INV_FILTERS = [
    { key: "all", label: "Hammasi" },
    { key: "low", label: "Kam qoldi" },
    { key: "out", label: "Tugagan" },
    { key: "hidden", label: "Yashirin" },
  ];

  async function openInventory() {
    S.view = "inventory";
    S.key = null;
    loading("Ombor yuklanmoqda...");

    let data;
    try {
      data = await api("/api/admin/inventory");
    } catch (err) {
      return fail(err, openInventory);
    }

    S.inv = data;
    setHead("📦 Ombor", `${(data.items || []).length} ta tovar`);
    paintInventory();
  }

  /** Ro'yxatni qidiruv/filtrga qarab qayta chizadi (server so'rovisiz). */
  function paintInventory() {
    const data = S.inv || { items: [], summary: {} };
    const sum = data.summary || {};
    const query = (S.invQuery || "").toLowerCase().trim();
    const filter = S.invFilter || "all";

    const items = (data.items || []).filter((p) => {
      if (filter === "low" && !p.low) return false;
      if (filter === "out" && !p.out) return false;
      if (filter === "hidden" && p.is_active) return false;
      if (query) {
        const name = String(p.name || "").toLowerCase();
        const code = String(p.code || "").toLowerCase();
        if (name.indexOf(query) < 0 && code.indexOf(query) < 0) return false;
      }
      return true;
    });

    body().innerHTML = "";

    // Yangi tovar qo'shish — ombor tepasida ham qo'l ostida
    const add = el("button", "btn btn-primary adm-add", "+ Yangi tovar qo'shish");
    add.onclick = () => {
      haptic();
      openAddProduct();
    };
    body().append(add);

    // Xulosa: jami / kam qoldi / tugagan + umumiy qiymat
    const stats = el("div", "inv-summary");
    stats.innerHTML = `
      <div class="inv-stat"><b>${sum.total || 0}</b><span>Jami tovar</span></div>
      <div class="inv-stat low"><b>${sum.low || 0}</b><span>Kam qoldi</span></div>
      <div class="inv-stat out"><b>${sum.out || 0}</b><span>Tugagan</span></div>`;
    body().append(stats);
    body().append(
      el("div", "inv-value", `💰 Ombor qiymati: <b>${esc(sum.value_label || "0")}</b>`)
    );

    // Qidiruv
    const search = el("input", "inv-search");
    search.type = "search";
    search.placeholder = "🔍 Nomi yoki artikul bo'yicha qidirish...";
    search.value = S.invQuery || "";
    search.oninput = () => {
      S.invQuery = search.value;
      clearTimeout(paintInventory._t);
      paintInventory._t = setTimeout(() => {
        paintInventory();
        const again = body().querySelector(".inv-search");
        if (again) {
          again.focus();
          const end = again.value.length;
          try {
            again.setSelectionRange(end, end);
          } catch (_) {}
        }
      }, 260);
    };
    body().append(search);

    // Filtr chiplari
    const chips = el("div", "chips adm-filters");
    INV_FILTERS.forEach((f) => {
      const count =
        f.key === "low" ? sum.low : f.key === "out" ? sum.out : f.key === "hidden" ? sum.hidden : 0;
      const chip = el("button", "chip" + (filter === f.key ? " on" : ""));
      chip.textContent = f.label + (count ? ` (${count})` : "");
      chip.onclick = () => {
        S.invFilter = f.key;
        haptic();
        paintInventory();
      };
      chips.append(chip);
    });
    body().append(chips);

    if (!items.length) {
      body().append(el("p", "empty", "Tovar topilmadi."));
      return;
    }
    items.forEach((p) => body().append(inventoryRow(p)));
  }

  /** Bitta ombor qatori: qoldiqni shu yerda o'zgartirib saqlash mumkin. */
  function inventoryRow(p) {
    const row = el("div", "inv-row" + (p.out ? " out" : p.low ? " low" : ""));
    if (!p.is_active) row.classList.add("off");

    const parts = String(p.name || "").split("·");
    const mainName = (parts[0] || p.name || "").trim();
    const carHint = parts[1] ? `<span class="inv-hint">· ${esc(parts[1].trim())}</span>` : "";
    const photo = p.photo_url ? (app().abs ? app().abs(p.photo_url) : p.photo_url) : null;
    const flag = p.out
      ? '<span class="inv-flag out">Tugagan</span>'
      : p.low
      ? '<span class="inv-flag low">Kam qoldi</span>'
      : "";

    row.innerHTML = `
      <div class="inv-top">
        <div class="adm-thumb">${
          photo
            ? `<img src="${esc(photo)}" alt="" onerror="this.style.display='none'">`
            : '<span class="adm-thumb-empty">🖼</span>'
        }</div>
        <div class="inv-info">
          <b>${esc(mainName)}${carHint}</b>
          <small>${esc(p.price_label)}${
      p.code ? ` · 🔖 ${esc(p.code)}` : ""
    } ${flag}${p.is_active ? "" : " · yashirilgan"}</small>
        </div>
        <div class="inv-acts">
          <button class="adm-mini" data-act="edit" title="Tahrirlash">✏️</button>
          <button class="adm-mini" data-act="toggle" title="Yashirish/ko'rsatish">${
            p.is_active ? "🟢" : "🔴"
          }</button>
        </div>
      </div>`;

    row.querySelector('[data-act="edit"]').onclick = () => {
      haptic();
      openForm("prd", p.id);
    };
    row.querySelector('[data-act="toggle"]').onclick = async (ev) => {
      const btn = ev.currentTarget;
      btn.disabled = true;
      try {
        const res = await api(`/api/admin/section/prd/${p.id}/toggle`, {
          method: "POST",
          body: {},
        });
        p.is_active = res.is_active;
        btn.textContent = res.is_active ? "🟢" : "🔴";
        row.classList.toggle("off", !res.is_active);
        haptic("ok");
        toast(res.is_active ? "Ko'rinadigan qilindi" : "Yashirildi");
      } catch (err) {
        haptic("err");
        toast((err && err.message) || "O'zgarmadi");
      } finally {
        btn.disabled = false;
      }
    };

    // ---- qoldiqni tahrirlash
    const box = el("div", "inv-stock");
    if (p.product_type === "razmerli" && (p.sizes || []).length) {
      box.append(el("div", "inv-sizes-title", "Razmerlar va qoldiq"));
      const sizes = p.sizes.map((s) => ({ size: s.size, stock: s.stock }));
      sizes.forEach((s, i) => {
        const line = el("div", "inv-size-row");
        line.innerHTML = `<span class="inv-size-name">${esc(s.size)}</span>`;
        const input = el("input", "inv-input");
        input.type = "number";
        input.min = "0";
        input.value = s.stock;
        input.oninput = () => (sizes[i].stock = Math.max(0, parseInt(input.value, 10) || 0));
        line.append(input);
        box.append(line);
      });
      const save = el("button", "inv-save", "Saqlash");
      save.onclick = () => saveStock(p, { sizes: sizes }, save, row);
      box.append(save);
    } else {
      const line = el("div", "inv-size-row");
      line.append(el("span", "inv-size-name", "Qoldiq (dona)"));
      const input = el("input", "inv-input");
      input.type = "number";
      input.min = "0";
      input.value = p.stock;
      line.append(input);
      const save = el("button", "inv-save", "Saqlash");
      save.onclick = () =>
        saveStock(p, { stock: Math.max(0, parseInt(input.value, 10) || 0) }, save, row);
      line.append(save);
      box.append(line);
    }
    row.append(box);
    return row;
  }

  async function saveStock(product, payload, btn, row) {
    btn.disabled = true;
    const original = btn.textContent;
    btn.textContent = "...";
    try {
      const res = await api(`/api/admin/inventory/${product.id}/stock`, {
        method: "POST",
        body: payload,
      });
      haptic("ok");
      toast("Qoldiq saqlandi ✅");
      // Ro'yxatdagi ma'lumotni yangilaymiz va xulosani qayta hisoblaymiz
      const list = (S.inv && S.inv.items) || [];
      const i = list.findIndex((x) => x.id === product.id);
      if (i > -1) list[i] = res.item;
      recalcInventorySummary();
      paintInventory();
    } catch (err) {
      haptic("err");
      toast((err && err.message) || "Saqlanmadi");
      btn.disabled = false;
      btn.textContent = original;
    }
  }

  /** Xulosa raqamlarini mahalliy qayta hisoblaydi (server so'rovisiz). */
  function recalcInventorySummary() {
    if (!S.inv) return;
    const items = S.inv.items || [];
    const value = items.reduce((a, p) => a + (p.price || 0) * (p.stock || 0), 0);
    S.inv.summary = {
      total: items.length,
      low: items.filter((p) => p.low).length,
      out: items.filter((p) => p.out).length,
      hidden: items.filter((p) => !p.is_active).length,
      value: value,
      value_label: fmt(value),
    };
  }

  /* ====================================================================
     BO'LIM RO'YXATI
     ==================================================================== */

  async function ensureSchema() {
    if (S.schema) return S.schema;
    const data = await api("/api/admin/schema");
    S.schema = data;
    (data.sections || []).forEach((sec) => {
      S.sections[sec.key] = sec;
    });
    return data;
  }

  async function openList(key) {
    S.view = "list";
    S.key = key;
    S.item = null;
    loading();

    let data;
    try {
      await ensureSchema();
      data = await api(`/api/admin/section/${encodeURIComponent(key)}`);
    } catch (err) {
      return fail(err, () => openList(key));
    }

    setHead(`${data.icon} ${data.title}`, `${(data.items || []).length} ta element`);

    const wrap = document.createElement("div");
    const addBtn = document.createElement("button");
    addBtn.className = "btn btn-primary adm-add";
    addBtn.textContent = "+ Yangi qo'shish";
    addBtn.onclick = () => {
      haptic();
      openForm(key, null);
    };
    wrap.append(addBtn);

    if (!(data.items || []).length) {
      const empty = document.createElement("p");
      empty.className = "empty";
      empty.textContent = "Bu bo'lim hozircha bo'sh. «Yangi qo'shish» ni bosing.";
      wrap.append(empty);
    }

    (data.items || []).forEach((item) => {
      wrap.append(renderRow(key, item));
    });

    body().innerHTML = "";
    body().append(wrap);
  }

  function renderRow(key, item) {
    const row = document.createElement("div");
    row.className = "adm-row" + (item.is_active ? "" : " off");

    const photo = item.media && item.media.photo && item.media.photo.url;
    const thumb = photo
      ? `<img src="${esc(app().abs ? app().abs(photo) : photo)}" alt=""
              onerror="this.style.display='none'">`
      : `<span class="adm-thumb-empty">🖼</span>`;

    row.innerHTML = `
      <div class="adm-thumb">${thumb}</div>
      <div class="adm-row-mid">
        <b>${esc(item.label)}</b>
        <small>#${esc(item.id)}${item.is_active ? "" : " · yashirilgan"}</small>
      </div>
      <div class="adm-row-act">
        <button class="adm-mini" data-act="edit" title="Tahrirlash">✏️</button>
        <button class="adm-mini" data-act="toggle" title="Yashirish/ko'rsatish">
          ${item.is_active ? "🟢" : "🔴"}
        </button>
        <button class="adm-mini danger" data-act="del" title="O'chirish">🗑</button>
      </div>`;

    row.querySelector('[data-act="edit"]').onclick = () => {
      haptic();
      openForm(key, item.id);
    };

    row.querySelector('[data-act="toggle"]').onclick = async (ev) => {
      const btn = ev.currentTarget;
      if (btn.disabled) return;
      btn.disabled = true;
      try {
        const res = await api(
          `/api/admin/section/${encodeURIComponent(key)}/${item.id}/toggle`,
          { method: "POST", body: {} }
        );
        item.is_active = res.is_active;
        btn.textContent = res.is_active ? "🟢" : "🔴";
        row.classList.toggle("off", !res.is_active);
        haptic("ok");
        toast(res.is_active ? "Ko'rinadigan qilindi" : "Yashirildi");
      } catch (err) {
        haptic("err");
        toast((err && err.message) || "O'zgarmadi");
      } finally {
        btn.disabled = false;
      }
    };

    row.querySelector('[data-act="del"]').onclick = async () => {
      const ok = await ask(`«${item.label}» butunlay o'chirilsinmi?`);
      if (!ok) return;
      try {
        await api(`/api/admin/section/${encodeURIComponent(key)}/${item.id}`, {
          method: "DELETE",
        });
        haptic("ok");
        toast("O'chirildi");
        row.remove();
      } catch (err) {
        haptic("err");
        toast((err && err.message) || "O'chirilmadi");
      }
    };

    return row;
  }

  /* ====================================================================
     FORMA (qo'shish / tahrirlash)
     ==================================================================== */

  async function openForm(key, id) {
    // Boshqa bo'limga o'tilsa tanlangan fayllar saqlanib qolmasin
    if (S.key !== key || (id != null && S.view !== "form")) S.newMedia = {};
    S.view = "form";
    S.key = key;
    loading();

    let section, item = null;
    try {
      await ensureSchema();
      section = S.sections[key];
      if (!section) throw { message: "Bo'lim topilmadi" };
      if (id != null) {
        const res = await api(`/api/admin/section/${encodeURIComponent(key)}/${id}`);
        item = res.item;
      }
    } catch (err) {
      return fail(err, () => openForm(key, id));
    }

    S.item = item;
    setHead(
      `${section.icon} ${item ? "Tahrirlash" : "Yangi qo'shish"}`,
      item ? item.label : section.title
    );

    const form = document.createElement("div");
    form.className = "adm-form";

    section.fields.forEach((field) => {
      form.append(renderField(section, field, item));
    });

    const save = document.createElement("button");
    save.className = "btn btn-primary";
    save.textContent = item ? "Saqlash" : "Qo'shish";
    save.onclick = () => submitForm(section, item, save);
    form.append(save);

    const back = document.createElement("button");
    back.className = "btn btn-ghost btn-sm";
    back.textContent = "Ro'yxatga qaytish";
    back.onclick = () => openList(key);
    form.append(back);

    body().innerHTML = "";
    body().append(form);
  }

  /** Maydon turiga qarab kerakli boshqaruvni yasaydi. */
  function renderField(section, field, item) {
    const value =
      item && item.values && item.values[field.column] != null
        ? item.values[field.column]
        : "";
    const box = document.createElement("label");
    box.className = "field adm-field";
    const req = field.required ? ' <em class="adm-req">*</em>' : "";
    const hint = field.hint ? `<small class="adm-hint">${esc(field.hint)}</small>` : "";

    /* rasm / video */
    if (field.kind === "photo" || field.kind === "video") {
      return renderMediaField(section, field, item);
    }

    /* tanlov */
    if (field.kind === "choice") {
      const options = (field.choices || [])
        .map((c) => {
          const sel = String(c.value) === String(value) ? " selected" : "";
          return `<option value="${esc(c.value)}"${sel}>${esc(c.label)}</option>`;
        })
        .join("");
      box.innerHTML = `<span>${esc(field.label)}${req}</span>
        <select data-col="${esc(field.column)}" data-kind="choice">
          ${field.required ? "" : '<option value="">— tanlanmagan —</option>'}
          ${options}
        </select>${hint}`;
      return box;
    }

    /* rang */
    if (field.kind === "color") {
      const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(String(value)) ? value : "#ff2d3a";
      box.innerHTML = `<span>${esc(field.label)}${req}</span>
        <div class="adm-color">
          <input type="color" value="${esc(hex)}" data-role="picker">
          <input type="text" value="${esc(value)}" placeholder="#ff2d3a"
                 data-col="${esc(field.column)}" data-kind="color">
        </div>${hint}`;
      const picker = box.querySelector('[data-role="picker"]');
      const text = box.querySelector('[data-kind="color"]');
      picker.oninput = () => (text.value = picker.value);
      text.oninput = () => {
        if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(text.value)) picker.value = text.value;
      };
      return box;
    }

    /* uzun matn */
    if (field.kind === "long") {
      box.innerHTML = `<span>${esc(field.label)}${req}</span>
        <textarea rows="3" data-col="${esc(field.column)}" data-kind="long"
                  placeholder="${esc(field.hint)}">${esc(value)}</textarea>${hint}`;
      return box;
    }

    /* son / narx */
    if (field.kind === "int" || field.kind === "money") {
      box.innerHTML = `<span>${esc(field.label)}${req}</span>
        <input type="number" inputmode="numeric" min="0" value="${esc(value)}"
               data-col="${esc(field.column)}" data-kind="${esc(field.kind)}"
               placeholder="${esc(field.hint || "0")}">${hint}`;
      return box;
    }

    /* oddiy matn */
    box.innerHTML = `<span>${esc(field.label)}${req}</span>
      <input type="text" value="${esc(value)}" data-col="${esc(field.column)}"
             data-kind="text" placeholder="${esc(field.hint)}">${hint}`;
    return box;
  }

  /** Rasm/video: ko'rinish + fayl tanlash + URL + o'chirish. */
  function renderMediaField(section, field, item) {
    const kind = field.media_kind || (field.kind === "video" ? "video" : "photo");
    const state = (item && item.media && item.media[kind]) || {};
    const box = document.createElement("div");
    box.className = "field adm-field adm-media";

    const preview =
      state.url && kind === "photo"
        ? `<img src="${esc(app().abs ? app().abs(state.url) : state.url)}" alt=""
                onerror="this.style.display='none'">`
        : state.url
        ? `<span class="adm-media-ok">🎬 video yuklangan</span>`
        : `<span class="adm-thumb-empty">${kind === "photo" ? "🖼" : "🎬"}</span>`;

    // Qo'shish va tahrirlash BIR XIL ko'rinadi: ikkisida ham fayl darhol
    // tanlanadi. Yangi elementda fayl xotirada turadi va element
    // saqlangandan keyin o'zi yuklanadi.
    const chosen = !item && S.newMedia[kind] ? S.newMedia[kind].name : null;

    box.innerHTML = `
      <span>${esc(field.label)}</span>
      <div class="adm-media-row">
        <div class="adm-thumb big">${chosen ? "✓" : preview}</div>
        <div class="adm-media-btns">
          <button class="btn btn-ghost btn-sm" data-role="pick">
            ${chosen ? "Almashtirish" : state.empty ? "Fayl tanlash" : "Almashtirish"}</button>
          ${
            item && !state.empty
              ? '<button class="btn btn-ghost btn-sm danger" data-role="clear">O\'chirish</button>'
              : ""
          }
        </div>
      </div>
      ${chosen ? `<small class="adm-hint">Tanlandi: ${esc(chosen)}</small>` : ""}
      <input type="text" value="${esc(state.raw_url || "")}"
             data-col="${esc(field.column)}" data-kind="media" data-media="${esc(kind)}"
             data-initial="${esc(state.raw_url || "")}"
             placeholder="yoki https://... manzil">
      <input type="file" class="hidden" data-role="file"
             accept="${kind === "photo" ? "image/*" : "video/*"}">`;

    const fileInput = box.querySelector('[data-role="file"]');
    const pick = box.querySelector('[data-role="pick"]');
    const clear = box.querySelector('[data-role="clear"]');

    if (pick) pick.onclick = () => fileInput.click();

    fileInput.onchange = async () => {
      const file = fileInput.files && fileInput.files[0];
      if (!file) return;

      // Yangi element: hali id yo'q — faylni eslab qolamiz
      if (!item) {
        S.newMedia[kind] = file;
        haptic("ok");
        toast("Fayl tanlandi — saqlaganda yuklanadi");
        openForm(section.key, null);
        return;
      }

      if (pick) {
        pick.disabled = true;
        pick.textContent = "Yuklanmoqda...";
      }
      try {
        await uploadMedia(section.key, item.id, kind, file);
        haptic("ok");
        toast("Fayl yuklandi ✅");
        openForm(section.key, item.id);
      } catch (err) {
        haptic("err");
        toast((err && err.message) || "Yuklanmadi");
        if (pick) {
          pick.disabled = false;
          pick.textContent = "Fayl tanlash";
        }
      }
    };

    if (clear)
      clear.onclick = async () => {
        const ok = await ask("Media o'chirilsinmi?");
        if (!ok) return;
        try {
          await api(
            `/api/admin/section/${encodeURIComponent(section.key)}/${item.id}/media/${kind}`,
            { method: "DELETE" }
          );
          haptic("ok");
          toast("O'chirildi");
          openForm(section.key, item.id);
        } catch (err) {
          haptic("err");
          toast((err && err.message) || "O'chirilmadi");
        }
      };

    return box;
  }

  /** Formadan qiymatlarni yig'ib serverga yuboradi. */
  async function submitForm(section, item, btn) {
    if (S.busy) return;

    const values = {};
    body()
      .querySelectorAll("[data-col]")
      .forEach((node) => {
        const column = node.dataset.col;
        const kind = node.dataset.kind;
        let value = node.value;

        if (typeof value === "string") value = value.trim();

        if (kind === "media") {
          // MUHIM: media maydonini faqat ODAM o'zgartirgan bo'lsa yuboramiz.
          // Aks holda Telegram'ga yuklangan rasm (file_id) bo'sh URL bilan
          // birga tasodifan o'chib ketadi — chunki server URL yozilganda
          // file_id'ni tozalaydi.
          const initial = node.dataset.initial || "";
          if (value === initial) return;
          if (!item && !value) return;
        }

        values[column] = value === "" ? null : value;
      });

    S.busy = true;
    btn.disabled = true;
    const original = btn.textContent;
    btn.textContent = "Saqlanmoqda...";

    try {
      if (item) {
        await api(`/api/admin/section/${encodeURIComponent(section.key)}/${item.id}`, {
          method: "PATCH",
          body: { values: values },
        });
        haptic("ok");
        toast("Saqlandi ✅");
        openList(section.key);
      } else {
        const res = await api(`/api/admin/section/${encodeURIComponent(section.key)}`, {
          method: "POST",
          body: { values: values },
        });
        const newId = res.item && res.item.id;

        // Tanlangan fayllarni saqlangandan keyin o'zi yuklaydi —
        // shuning uchun qo'shish va tahrirlash mijoz uchun bir xil.
        const pending = Object.keys(S.newMedia);
        if (newId && pending.length) {
          btn.textContent = "Fayl yuklanmoqda...";
          for (const kind of pending) {
            try {
              await uploadMedia(section.key, newId, kind, S.newMedia[kind]);
            } catch (err) {
              toast((err && err.message) || "Fayl yuklanmadi");
            }
          }
        }
        S.newMedia = {};

        haptic("ok");
        toast("Qo'shildi ✅");
        openList(section.key);
      }
    } catch (err) {
      haptic("err");
      toast((err && err.message) || "Saqlanmadi");
      btn.disabled = false;
      btn.textContent = original;
    } finally {
      S.busy = false;
    }
  }

  /* ====================================================================
     YANGI TOVAR QO'SHISH (Avto_A1 formasi, Zimmer ranglarida)

     Tartib: rasmlar → jonli ko'rinish → asosiy ma'lumot (nom, narx, artikul)
             → aksiya → o'lchov/tur (oddiy | razmerli) → razmerlar → tavsif
             → mos mashina → Saqlash (pastda yopishgan).
     Rasmlar telefondan tanlanadi: fayl xotirada turadi, tovar saqlangach
     mavjud media yuklash oqimi bilan yuboriladi (Telegram file_id).
     ==================================================================== */

  const AP = { photo: null, photo2: null, photo3: null }; // tanlangan fayllar
  const APU = { photo: "", photo2: "", photo3: "" }; // rasm linklari

  /** Narxni "150 000" ko'rinishida ko'rsatadi. */
  function formatMoneyInput(input) {
    const digits = (input.value || "").replace(/\D/g, "");
    input.value = digits ? Number(digits).toLocaleString("ru-RU").replace(/,/g, " ") : "";
  }
  const moneyValue = (id) => ($(id) ? ($(id).value || "").replace(/\D/g, "") : "");

  /** Ovozdan yozish (qo'llab-quvvatlansa). */
  function startVoice(targetId) {
    const Rec = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Rec) return toast("Bu telefonda ovozli kiritish yo'q");
    try {
      const rec = new Rec();
      rec.lang = "uz-UZ";
      rec.interimResults = false;
      rec.maxAlternatives = 1;
      toast("🎤 Gapiring...");
      haptic("medium");
      rec.onresult = (e) => {
        const text = (e.results[0][0].transcript || "").trim();
        const node = $(targetId);
        if (node && text) {
          node.value = node.value ? node.value + " " + text : text;
          node.dispatchEvent(new Event("input"));
          haptic("ok");
        }
      };
      rec.onerror = () => toast("Ovoz aniqlanmadi");
      rec.start();
    } catch (_) {
      toast("Ovozli kiritish ishlamadi");
    }
  }

  async function openAddProduct() {
    S.view = "addproduct";
    S.key = "prd";
    S.item = null;
    AP.photo = AP.photo2 = AP.photo3 = null;
    APU.photo = APU.photo2 = APU.photo3 = "";
    loading();

    // Mos mashina uchun ro'yxat (Zimmer'da kategoriya emas — mashina)
    let cars = [];
    try {
      cars = await api("/api/cars");
    } catch (_) {}
    S.apCars = cars;
    S.apCarId = null;

    setHead("➕ Yangi tovar", "Rasm, nom, narx va qoldiqni to'ldiring");

    const form = el("div", "ap-form");
    form.innerHTML = `
      <!-- 1. RASMLAR -->
      <div class="ap-group">
        <div class="ap-head">
          <span class="ap-ic">🖼</span>
          <div class="ap-tx"><b>Rasmlar</b><span>Birinchi qadam · 1–3 ta</span></div>
        </div>
        <div class="ap-upload" id="ap-upload">
          <span class="ap-up-ic">⬆️</span>
          <div class="ap-up-t">Telefondan rasm yuklash</div>
          <div class="ap-up-s">Bir vaqtda 3 tagacha tanlash mumkin</div>
          <input type="file" id="ap-files" accept="image/*" multiple>
        </div>
        <div class="ap-previews" id="ap-previews"></div>
        <input type="text" class="ap-input" id="ap-url1" placeholder="Yoki rasm linki (ixtiyoriy)">
        <input type="text" class="ap-input" id="ap-url2" placeholder="2-rasm linki (ixtiyoriy)">
        <input type="text" class="ap-input" id="ap-url3" placeholder="3-rasm linki (ixtiyoriy)">
      </div>

      <!-- 2. JONLI KO'RINISH -->
      <div class="ap-sub">Mijozga qanday ko'rinadi</div>
      <div class="ap-live" id="ap-live"></div>

      <!-- 3. ASOSIY MA'LUMOT -->
      <div class="ap-group">
        <div class="ap-head">
          <span class="ap-ic">📝</span>
          <div class="ap-tx"><b>Asosiy ma'lumotlar</b><span>Nomi · narxi · artikul</span></div>
        </div>
        <div class="ap-wrap">
          <input type="text" class="ap-input" id="ap-name" placeholder="Tovar nomi (mas: Bi-LED linza)">
          <button type="button" class="ap-mic" id="ap-mic-name" title="Ovozdan yozish">🎤</button>
        </div>
        <input type="text" inputmode="numeric" class="ap-input" id="ap-price" placeholder="Narxi (so'm, mas: 150 000)">
        <input type="text" class="ap-input" id="ap-code" placeholder="Artikul / OEM kod (ixtiyoriy)">
        <input type="text" class="ap-input" id="ap-badge" placeholder="Belgi (mas: Yangi, TOP) — ixtiyoriy">
      </div>

      <!-- 4. AKSIYA -->
      <div class="ap-group ap-sale">
        <div class="ap-head">
          <span class="ap-ic red">🔥</span>
          <div class="ap-tx"><b>Aksiya (ixtiyoriy)</b><span>Eski narx — chegirma o'zi hisoblanadi</span></div>
        </div>
        <input type="text" inputmode="numeric" class="ap-input" id="ap-old" placeholder="Eski narx (hozirgi narxdan katta)">
        <div class="ap-note" id="ap-sale-note">Bo'sh qoldirilsa — aksiya yo'q.</div>
      </div>

      <!-- 5. TUR VA QOLDIQ -->
      <div class="ap-group">
        <div class="ap-head">
          <span class="ap-ic green">📦</span>
          <div class="ap-tx"><b>Qoldiq</b><span>O'lchov va tovar turi</span></div>
        </div>
        <div class="ap-row2">
          <select class="ap-input" id="ap-unit">
            <option value="dona">1 dona</option>
            <option value="komplekt">Nabor (komplekt)</option>
          </select>
          <select class="ap-input" id="ap-type">
            <option value="oddiy">Oddiy tovar</option>
            <option value="razmerli">Razmerli</option>
          </select>
        </div>
        <div id="ap-simple">
          <input type="number" inputmode="numeric" min="0" class="ap-input" id="ap-stock"
                 placeholder="Skladdagi qoldiq (dona)" value="10">
        </div>
        <div id="ap-sized" class="ap-sized hidden">
          <div class="ap-sub" style="margin-top:0">Razmerlar va qoldiq</div>
          <div id="ap-sizes"></div>
          <button type="button" class="ap-add-size" id="ap-add-size">+ YANGI RAZMER</button>
        </div>
      </div>

      <!-- 6. TAVSIF -->
      <div class="ap-group">
        <div class="ap-head">
          <span class="ap-ic blue">💬</span>
          <div class="ap-tx"><b>Tavsif</b><span>Mijoz uchun qisqa izoh</span></div>
        </div>
        <button type="button" class="ap-voice" id="ap-mic-desc">🎤 Ovoz bilan ayting</button>
        <textarea class="ap-input ap-area" id="ap-desc" rows="4"
                  placeholder="Masalan: original linza, 5500K, 1 yil kafolat..."></textarea>
      </div>

      <!-- 7. MOS MASHINA -->
      <div class="ap-group" id="ap-cars-group">
        <div class="ap-head">
          <span class="ap-ic">🚗</span>
          <div class="ap-tx"><b>Mos mashina</b><span>Tanlanmasa — barchasi uchun</span></div>
        </div>
        <div class="ap-chips" id="ap-cars"></div>
      </div>`;

    body().innerHTML = "";
    body().append(form);

    // Saqlash — pastda yopishib turadi
    const bar = el("div", "ap-footer");
    const save = el("button", "btn btn-primary", "💾 Saqlash");
    save.onclick = () => saveNewProduct(save);
    bar.append(save);
    body().append(bar);

    // ---- hodisalar
    $("ap-files").onchange = (ev) => pickProductImages(ev.target.files);
    $("ap-upload").onclick = (ev) => {
      if (ev.target.id !== "ap-files") $("ap-files").click();
    };
    ["ap-url1", "ap-url2", "ap-url3"].forEach((id, i) => {
      $(id).oninput = () => {
        APU[["photo", "photo2", "photo3"][i]] = $(id).value.trim();
        renderApPreviews();
        renderApLive();
      };
    });
    $("ap-name").oninput = renderApLive;
    $("ap-price").oninput = () => {
      formatMoneyInput($("ap-price"));
      renderApLive();
      renderApSaleNote();
    };
    $("ap-old").oninput = () => {
      formatMoneyInput($("ap-old"));
      renderApLive();
      renderApSaleNote();
    };
    $("ap-badge").oninput = renderApLive;
    $("ap-mic-name").onclick = () => startVoice("ap-name");
    $("ap-mic-desc").onclick = () => startVoice("ap-desc");
    $("ap-type").onchange = () => {
      const sized = $("ap-type").value === "razmerli";
      $("ap-sized").classList.toggle("hidden", !sized);
      $("ap-simple").classList.toggle("hidden", sized);
      if (sized && !$("ap-sizes").children.length) addSizeRow();
      haptic();
    };
    $("ap-add-size").onclick = () => {
      addSizeRow();
      haptic();
    };

    // mashina chiplari
    const carBox = $("ap-cars");
    if (!cars.length) {
      $("ap-cars-group").classList.add("hidden");
    } else {
      cars.forEach((c) => {
        const chip = el("button", "ap-chip", esc(c.name));
        chip.onclick = () => {
          S.apCarId = S.apCarId === c.id ? null : c.id;
          carBox.querySelectorAll(".ap-chip").forEach((n) => n.classList.remove("on"));
          if (S.apCarId === c.id) chip.classList.add("on");
          haptic();
          renderApLive();
        };
        carBox.append(chip);
      });
    }

    renderApPreviews();
    renderApLive();
  }

  /** Telefondan tanlangan rasmlar (1–3 ta) xotirada saqlanadi. */
  function pickProductImages(files) {
    const list = Array.prototype.slice.call(files || []).slice(0, 3);
    if (!list.length) return;
    const slots = ["photo", "photo2", "photo3"];
    // Bo'sh joylarga navbat bilan joylashtiramiz
    list.forEach((file) => {
      const free = slots.find((s) => !AP[s]);
      if (free) AP[free] = file;
    });
    haptic("ok");
    toast(`${list.length} ta rasm tanlandi — saqlaganda yuklanadi`);
    renderApPreviews();
    renderApLive();
  }

  function renderApPreviews() {
    const box = $("ap-previews");
    if (!box) return;
    box.innerHTML = "";
    ["photo", "photo2", "photo3"].forEach((slot, i) => {
      const file = AP[slot];
      const url = APU[slot];
      if (!file && !url) return;
      const cell = el("div", "ap-prev");
      if (file) {
        const img = el("img");
        img.src = URL.createObjectURL(file);
        img.onload = () => URL.revokeObjectURL(img.src);
        cell.append(img);
      } else {
        const img = el("img");
        img.src = url;
        img.onerror = () => (img.style.display = "none");
        cell.append(img);
      }
      const del = el("button", "ap-prev-del", "✕");
      del.onclick = () => {
        AP[slot] = null;
        APU[slot] = "";
        const input = $(["ap-url1", "ap-url2", "ap-url3"][i]);
        if (input) input.value = "";
        haptic("light");
        renderApPreviews();
        renderApLive();
      };
      cell.append(del);
      if (slot === "photo") cell.append(el("span", "ap-prev-main", "Asosiy"));
      box.append(cell);
    });
  }

  /** Mijozga qanday ko'rinishini shu zahoti ko'rsatadi. */
  function renderApLive() {
    const box = $("ap-live");
    if (!box) return;
    const name = ($("ap-name") && $("ap-name").value.trim()) || "Tovar nomi";
    const price = parseInt(moneyValue("ap-price") || "0", 10);
    const old = parseInt(moneyValue("ap-old") || "0", 10);
    const badge = ($("ap-badge") && $("ap-badge").value.trim()) || "";
    const off = old > price && price ? Math.round(((old - price) / old) * 100) : 0;

    let src = "";
    if (AP.photo) src = URL.createObjectURL(AP.photo);
    else if (APU.photo) src = APU.photo;

    const car = (S.apCars || []).find((c) => c.id === S.apCarId);

    box.innerHTML = `
      <div class="ap-live-card">
        <div class="ap-live-art">
          ${src ? `<img src="${esc(src)}" alt="" onerror="this.style.display='none'">` : "💡"}
          ${off ? `<span class="ap-live-off">-${off}%</span>` : ""}
          ${badge ? `<span class="ap-live-badge">${esc(badge)}</span>` : ""}
        </div>
        <div class="ap-live-body">
          <div class="ap-live-name">${esc(name)}</div>
          ${car ? `<div class="ap-live-fit">✓ ${esc(car.name)}</div>` : ""}
          ${
            off
              ? `<div class="ap-live-old">${esc(fmt(old))}</div>`
              : ""
          }
        </div>
        <div class="ap-live-btn">${esc(fmt(price))} <span>🛒</span></div>
      </div>`;
  }

  function renderApSaleNote() {
    const note = $("ap-sale-note");
    if (!note) return;
    const price = parseInt(moneyValue("ap-price") || "0", 10);
    const old = parseInt(moneyValue("ap-old") || "0", 10);
    if (!old) {
      note.className = "ap-note";
      note.textContent = "Bo'sh qoldirilsa — aksiya yo'q.";
      return;
    }
    if (old <= price) {
      note.className = "ap-note bad";
      note.textContent = "⚠️ Eski narx hozirgi narxdan KATTA bo'lishi kerak.";
      return;
    }
    const off = Math.round(((old - price) / old) * 100);
    note.className = "ap-note good";
    note.textContent = `✓ Chegirma −${off}% bo'lib ko'rinadi.`;
  }

  function addSizeRow(size, stock) {
    const box = $("ap-sizes");
    if (!box) return;
    const row = el("div", "ap-size-row");
    const sizeInput = el("input", "ap-input ap-size-name");
    sizeInput.type = "text";
    sizeInput.placeholder = "Razmer (mas: 92.5)";
    if (size) sizeInput.value = size;
    const stockInput = el("input", "ap-input ap-size-stock");
    stockInput.type = "number";
    stockInput.min = "0";
    stockInput.placeholder = "Soni";
    if (stock != null) stockInput.value = stock;
    const del = el("button", "ap-size-del", "✕");
    del.onclick = () => {
      row.remove();
      haptic("light");
    };
    row.append(sizeInput, stockInput, del);
    box.append(row);
  }

  function collectSizes() {
    const out = [];
    const box = $("ap-sizes");
    if (!box) return out;
    box.querySelectorAll(".ap-size-row").forEach((row) => {
      const size = (row.querySelector(".ap-size-name").value || "").trim();
      const stock = parseInt(row.querySelector(".ap-size-stock").value, 10) || 0;
      if (size) out.push({ size: size, stock: Math.max(0, stock) });
    });
    return out;
  }

  /** Saqlash: tovar yaratiladi, so'ng tanlangan rasmlar yuklanadi. */
  async function saveNewProduct(btn) {
    if (S.busy) return;

    const name = ($("ap-name").value || "").trim();
    if (name.length < 2) {
      haptic("err");
      toast("Tovar nomini yozing");
      return $("ap-name").focus();
    }
    const price = moneyValue("ap-price");
    if (!price) {
      haptic("err");
      toast("Narxni kiriting");
      return $("ap-price").focus();
    }

    const sized = $("ap-type").value === "razmerli";
    const sizes = sized ? collectSizes() : [];
    if (sized && !sizes.length) {
      haptic("err");
      return toast("Kamida bitta razmer va uning soni kerak");
    }

    const payload = {
      name: name,
      price: price,
      old_price: moneyValue("ap-old") || null,
      stock: sized ? 0 : parseInt($("ap-stock").value, 10) || 0,
      unit: $("ap-unit").value,
      product_type: sized ? "razmerli" : "oddiy",
      sizes: sizes,
      code: ($("ap-code").value || "").trim() || null,
      badge: ($("ap-badge").value || "").trim() || null,
      description: ($("ap-desc").value || "").trim() || null,
      car_id: S.apCarId,
      photo_url: APU.photo || null,
      photo2_url: APU.photo2 || null,
      photo3_url: APU.photo3 || null,
    };

    S.busy = true;
    btn.disabled = true;
    btn.textContent = "Saqlanmoqda...";

    try {
      const res = await api("/api/admin/products", { method: "POST", body: payload });
      const newId = res.item && res.item.id;

      // Telefondan tanlangan rasmlarni ketma-ket yuklaymiz
      const pending = ["photo", "photo2", "photo3"].filter((k) => AP[k]);
      for (let i = 0; i < pending.length; i++) {
        const kind = pending[i];
        btn.textContent = `Rasm yuklanmoqda (${i + 1}/${pending.length})...`;
        try {
          await uploadMedia("prd", newId, kind, AP[kind]);
        } catch (err) {
          toast((err && err.message) || "Rasm yuklanmadi");
        }
      }

      AP.photo = AP.photo2 = AP.photo3 = null;
      APU.photo = APU.photo2 = APU.photo3 = "";
      haptic("ok");
      toast("Tovar qo'shildi ✅");
      openInventory();
    } catch (err) {
      haptic("err");
      toast((err && err.message) || "Saqlanmadi");
      btn.disabled = false;
      btn.textContent = "💾 Saqlash";
    } finally {
      S.busy = false;
    }
  }

  /* ====================================================================
     BUYURTMALAR
     ==================================================================== */

  async function openOrders(kind, status) {
    S.view = "orders";
    S.orderKind = kind || "biled";
    S.orderStatus = status || null;
    loading();

    let data;
    try {
      const query = status ? "&status=" + encodeURIComponent(status) : "";
      data = await api(`/api/admin/orders?kind=${encodeURIComponent(S.orderKind)}${query}`);
    } catch (err) {
      return fail(err, () => openOrders(kind, status));
    }

    setHead(`${data.icon} ${data.title}`, `${(data.items || []).length} ta`);

    const wrap = document.createElement("div");
    const tabs = document.createElement("div");
    tabs.className = "adm-orders-tabs";
    ORDER_TABS.forEach((t) => {
      const b = document.createElement("button");
      b.className = "adm-tab" + (t.kind === S.orderKind ? " on" : "");
      b.textContent = `${t.icon} ${t.title}`;
      b.onclick = () => {
        haptic();
        openOrders(t.kind);
      };
      tabs.append(b);
    });
    wrap.append(tabs);

    const filters = document.createElement("div");
    filters.className = "chips adm-filters";
    const all = document.createElement("button");
    all.className = "chip" + (status ? "" : " on");
    all.textContent = "Hammasi";
    all.onclick = () => openOrders(S.orderKind);
    filters.append(all);
    (data.statuses || []).forEach((st) => {
      const c = document.createElement("button");
      c.className = "chip" + (status === st.value ? " on" : "");
      c.textContent = st.label;
      c.onclick = () => openOrders(S.orderKind, st.value);
      filters.append(c);
    });
    wrap.append(filters);

    if (!(data.items || []).length) {
      const empty = document.createElement("p");
      empty.className = "empty";
      empty.textContent = "Buyurtma yo'q.";
      wrap.append(empty);
    }

    (data.items || []).forEach((order) => {
      wrap.append(renderOrder(data, order));
    });

    body().innerHTML = "";
    body().append(wrap);
  }

  function renderOrder(data, order) {
    const card = document.createElement("div");
    card.className = "adm-order";
    const phone = order.phone
      ? `<a href="tel:${esc(order.phone)}" class="adm-phone">📞 ${esc(order.phone)}</a>`
      : "";

    if (order.closed) card.classList.add("closed");

    card.innerHTML = `
      <div class="adm-order-head">
        <b>#${esc(order.id)}</b>
        <span class="adm-status">${esc(order.status_label)}</span>
      </div>
      <div class="adm-order-body">
        <div>👤 ${esc(order.name || "—")} ${phone}</div>
        ${order.summary ? `<div class="item-sub">${esc(order.summary)}</div>` : ""}
        ${order.date ? `<div class="item-sub">📅 ${esc(order.date)}</div>` : ""}
        ${order.comment ? `<div class="item-sub">📝 ${esc(order.comment)}</div>` : ""}
        <div class="adm-order-total">${esc(order.total_label || "")}</div>
      </div>
      <div class="adm-order-acts"></div>`;

    const acts = card.querySelector(".adm-order-acts");

    // MUHIM: tugmalar serverdan keladigan `next` ro'yxatidan yasaladi.
    // Bekor qilingan yoki topshirilgan buyurtmada `next` bo'sh bo'ladi —
    // shuning uchun «Qabul qilish» tugmasi umuman chiqmaydi.
    if (order.closed || !(order.next || []).length) {
      acts.innerHTML = `<small class="adm-hint">Bu buyurtma yopilgan — holati o'zgarmaydi.</small>`;
      return card;
    }

    (order.next || []).forEach((st) => {
      const b = document.createElement("button");
      b.className = "adm-mini wide";
      b.textContent = st.label;
      b.onclick = async () => {
        if (st.value === "cancelled") {
          const ok = await ask(
            `#${order.id} bekor qilinsinmi?\n\nBekor qilingandan keyin buyurtmani qayta ochib bo'lmaydi.`
          );
          if (!ok) return;
        }
        b.disabled = true;
        try {
          const res = await api(
            `/api/admin/orders/${encodeURIComponent(data.kind)}/${order.id}/status`,
            { method: "POST", body: { status: st.value } }
          );
          haptic("ok");
          toast("Holat: " + res.status_label);
          openOrders(data.kind, S.orderStatus);
        } catch (err) {
          haptic("err");
          toast((err && err.message) || "O'zgarmadi");
          b.disabled = false;
        }
      };
      acts.append(b);
    });

    return card;
  }

  /* ====================================================================
     KIRISH VA ORQAGA
     ==================================================================== */

  function open() {
    if (S.view === "inventory") return openInventory();
    if (S.view === "list" && S.key) return openList(S.key);
    return openMenu();
  }

  /** Panel ichida bir qadam orqaga. true — panel o'zi hal qildi. */
  function back() {
    // «Yangi tovar» — ombordan ochiladi, shu bois ombor'ga qaytamiz
    if (S.view === "addproduct") {
      openInventory();
      return true;
    }
    if (S.view === "form" && S.key) {
      // Mahsulot tahriri ombordan ochilgan — ombor'ga qaytaramiz
      if (S.key === "prd" && S.inv) {
        openInventory();
        return true;
      }
      openList(S.key);
      return true;
    }
    if (
      S.view === "list" ||
      S.view === "orders" ||
      S.view === "stats" ||
      S.view === "inventory"
    ) {
      openMenu();
      return true;
    }
    return false;
  }

  function bind() {
    const backBtn = $("admin-back");
    const reload = $("admin-reload");
    if (backBtn)
      backBtn.onclick = () => {
        haptic();
        if (!back() && app().show) app().show("home");
      };
    if (reload)
      reload.onclick = () => {
        haptic();
        if (S.view === "inventory") return openInventory();
        if (S.view === "addproduct") return openAddProduct();
        if (S.view === "list") return openList(S.key);
        if (S.view === "orders") return openOrders(S.orderKind, S.orderStatus);
        if (S.view === "form") return openForm(S.key, S.item && S.item.id);
        if (S.view === "stats") return openStats(S.statKind, S.statPeriod);
        S.schema = null;
        S.summary = null;
        openMenu();
      };
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bind);
  } else {
    bind();
  }

  return {
    open: open,
    back: back,
    openMenu: openMenu,
    openInventory: openInventory,
    openAddProduct: openAddProduct,
  };
})();
