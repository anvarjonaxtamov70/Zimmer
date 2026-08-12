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
    view: "dash", // dash | list | form | orders
    key: null, // joriy bo'lim
    item: null, // tahrirlanayotgan element
    orderKind: "biled",
    orderStatus: null, // joriy filtr — holat o'zgargandan keyin saqlanadi
    busy: false,
  };

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

  /* ====================================================================
     BOSH SAHIFA (dashboard)
     ==================================================================== */

  async function openDash() {
    S.view = "dash";
    S.key = null;
    S.item = null;
    setHead("Boshqaruv", "Zimmer admin paneli");
    loading();

    let data;
    try {
      data = await api("/api/admin/summary");
    } catch (err) {
      return fail(err, openDash);
    }

    const st = data.stats || {};
    const cards = [
      { icon: "🔥", label: "Bi-LED buyurtma", value: st.biled_total, hint: `${st.biled_new || 0} yangi` },
      { icon: "🗓", label: "Navbatlar", value: st.bookings_total, hint: `bugun ${st.bookings_today || 0}` },
      { icon: "📦", label: "Do'kon", value: st.orders_total, hint: `${st.orders_new || 0} yangi` },
      { icon: "👥", label: "Mijozlar", value: st.users, hint: `${st.products || 0} faol mahsulot` },
    ];

    body().innerHTML = `
      <div class="adm-money">
        <span>Umumiy savdo</span>
        <b>${esc(st.total_label || "0")}</b>
      </div>

      <div class="adm-stats">
        ${cards
          .map(
            (c) => `<div class="adm-stat">
                      <i>${c.icon}</i>
                      <b>${esc(c.value == null ? 0 : c.value)}</b>
                      <span>${esc(c.label)}</span>
                      <small>${esc(c.hint)}</small>
                    </div>`
          )
          .join("")}
      </div>

      <h3 class="sec-title">📋 Buyurtmalar</h3>
      <div class="adm-orders-tabs">
        ${ORDER_TABS.map(
          (t) =>
            `<button class="adm-tab" data-kind="${t.kind}">${t.icon} ${esc(t.title)}</button>`
        ).join("")}
      </div>

      <h3 class="sec-title">🗂 Katalogni boshqarish</h3>
      <div class="adm-grid" id="adm-sections"></div>

      <p class="adm-note">
        Har bir bo'limda element qo'shish, tahrirlash, rasm/video yuklash,
        yashirish va o'chirish mumkin. O'zgarish darhol ilovada ko'rinadi.
      </p>`;

    body()
      .querySelectorAll(".adm-tab")
      .forEach((btn) => {
        btn.onclick = () => {
          haptic();
          openOrders(btn.dataset.kind);
        };
      });

    const grid = $("adm-sections");
    (data.sections || []).forEach((sec) => {
      const card = document.createElement("button");
      card.className = "adm-card";
      card.innerHTML = `
        <i>${esc(sec.icon)}</i>
        <b>${esc(sec.title)}</b>
        <small>${esc(sec.count)} ta</small>`;
      card.onclick = () => {
        haptic();
        openList(sec.key);
      };
      grid.append(card);
    });
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

    box.innerHTML = `
      <span>${esc(field.label)}</span>
      <div class="adm-media-row">
        <div class="adm-thumb big">${preview}</div>
        <div class="adm-media-btns">
          ${
            item
              ? `<button class="btn btn-ghost btn-sm" data-role="pick">
                   ${state.empty ? "Fayl yuklash" : "Almashtirish"}</button>
                 ${
                   state.empty
                     ? ""
                     : '<button class="btn btn-ghost btn-sm danger" data-role="clear">O\'chirish</button>'
                 }`
              : `<small class="adm-hint">Faylni element qo'shilgandan keyin yuklaysiz</small>`
          }
        </div>
      </div>
      <input type="text" value="${esc(state.raw_url || "")}"
             data-col="${esc(field.column)}" data-kind="media" data-media="${esc(kind)}"
             data-initial="${esc(state.raw_url || "")}"
             placeholder="yoki https://... manzil">
      <small class="adm-hint">${esc(
        field.hint || "Telefondan fayl yuklang yoki tashqi manzil yozing"
      )}</small>
      <input type="file" class="hidden" data-role="file"
             accept="${kind === "photo" ? "image/*" : "video/*"}">`;

    if (!item) return box;

    const fileInput = box.querySelector('[data-role="file"]');
    const pick = box.querySelector('[data-role="pick"]');
    const clear = box.querySelector('[data-role="clear"]');

    if (pick) pick.onclick = () => fileInput.click();

    fileInput.onchange = async () => {
      const file = fileInput.files && fileInput.files[0];
      if (!file) return;
      const fd = new FormData();
      fd.append("kind", kind);
      fd.append("file", file, file.name);

      if (pick) {
        pick.disabled = true;
        pick.textContent = "Yuklanmoqda...";
      }
      try {
        await upload(
          `/api/admin/section/${encodeURIComponent(section.key)}/${item.id}/media`,
          fd
        );
        haptic("ok");
        toast("Fayl yuklandi ✅");
        openForm(section.key, item.id);
      } catch (err) {
        haptic("err");
        toast((err && err.message) || "Yuklanmadi");
        if (pick) {
          pick.disabled = false;
          pick.textContent = "Fayl yuklash";
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
        haptic("ok");
        toast("Qo'shildi ✅");
        // Rasm yuklash uchun darhol tahrirlash oynasiga o'tamiz
        openForm(section.key, res.item && res.item.id);
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
    if (S.view === "list" && S.key) return openList(S.key);
    return openDash();
  }

  /** Panel ichida bir qadam orqaga. true — panel o'zi hal qildi. */
  function back() {
    if (S.view === "form" && S.key) {
      openList(S.key);
      return true;
    }
    if (S.view === "list" || S.view === "orders") {
      openDash();
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
        if (S.view === "list") return openList(S.key);
        if (S.view === "orders") return openOrders(S.orderKind, S.orderStatus);
        if (S.view === "form") return openForm(S.key, S.item && S.item.id);
        S.schema = null;
        openDash();
      };
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bind);
  } else {
    bind();
  }

  return { open: open, back: back, openDash: openDash };
})();
