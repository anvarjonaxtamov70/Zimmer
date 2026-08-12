/* ==========================================================================
   ZIMMER — avtotuning Mini App

   Oqim: salom → mashina → Bi-LED linza → ochki → optika rangi → buyurtma
         → asosiy menyu (stories, bannerlar, aksiyalar, mahsulotlar)

   Tamoyillar:
     • Jonli ko'rinish (fara) yopishqoq — ro'yxat aylanganda joyida turadi.
     • Variant qatorlari ixcham; tafsilot faqat tanlanganda ochiladi.
     • Har bir element rasm/video bilan bo'lishi mumkin (admin panelda).
     • Sahifa fonga o'tsa animatsiyalar to'xtaydi (batareya va issiqlik).
   ========================================================================== */

(function () {
  "use strict";

  const tg = window.Telegram ? window.Telegram.WebApp : null;

  /* ----------------------------------------------------------- yordamchilar */
  const $ = (id) => document.getElementById(id);
  const el = (tag, cls, html) => {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (html !== undefined) node.innerHTML = html;
    return node;
  };
  const esc = (v) =>
    String(v ?? "").replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
    );

  const S = {
    page: "splash",
    step: 1,
    currency: "so'm",
    me: null,
    cars: [],
    tuning: null,
    car: null,
    biled: null,
    shroud: null,
    color: null,
    previewTab: "art",
    home: null,
    favorites: new Set(), // saqlangan tovar ID'lari
    catIndex: 0,
    cart: loadCart(),
    stories: [],
    storyIndex: 0,
    storyTimer: null,
    bannerTimer: null,
    booking: { service: null, date: null },
    delivery: null, // {method, address, summary}
    dlvMethod: null, // tanlangan usul (tasdiqlashdan oldin)
    pay: {}, // karta rekvizitlari (/api/config dan)
  };

  const fmt = (v) =>
    (Number(v) || 0).toLocaleString("ru-RU").replace(/,/g, " ") + " " + S.currency;

  function haptic(kind) {
    try {
      if (kind === "ok") tg.HapticFeedback.notificationOccurred("success");
      else if (kind === "err") tg.HapticFeedback.notificationOccurred("error");
      else tg.HapticFeedback.impactOccurred(kind || "light");
    } catch (_) {}
  }

  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  /** Bosh menyuga silliq kirish: bloklar navbat bilan ko'tariladi. */
  function enterHome() {
    const home = $("home");
    show("home");
    home.classList.add("entering");
    clearTimeout(enterHome._t);
    enterHome._t = setTimeout(() => home.classList.remove("entering"), 1100);
  }

  function toast(msg, ms) {
    const node = $("toast");
    node.textContent = msg;
    node.classList.remove("hidden");
    clearTimeout(toast._t);
    toast._t = setTimeout(() => node.classList.add("hidden"), ms || 2800);
  }

  function ask(msg) {
    return new Promise((res) => {
      if (tg && tg.showConfirm) tg.showConfirm(msg, (ok) => res(!!ok));
      else res(window.confirm(msg));
    });
  }

  function burst() {
    const box = $("burst");
    box.innerHTML = "";
    box.classList.remove("hidden");
    const colors = ["#ff2d3a", "#ffffff", "#ff8a3d", "#e01020"];
    for (let i = 0; i < 34; i++) {
      const p = el("i");
      p.style.left = Math.random() * 100 + "%";
      p.style.background = colors[i % colors.length];
      p.style.animationDelay = Math.random() * 0.4 + "s";
      box.append(p);
    }
    setTimeout(() => {
      box.classList.add("hidden");
      box.innerHTML = "";
    }, 2400);
  }

  /* ---------------------------------------------------------------- API */
  function apiBase() {
    const fromUrl = new URLSearchParams(location.search).get("api");
    if (fromUrl) {
      localStorage.setItem("zimmer_api", fromUrl);
      return fromUrl.replace(/\/$/, "");
    }
    const saved = localStorage.getItem("zimmer_api");
    return (saved || (window.ZIMMER_CONFIG && window.ZIMMER_CONFIG.API_BASE) || "").replace(
      /\/$/,
      ""
    );
  }
  const API = apiBase();

  /** Nisbiy media manzilini to'liq manzilga aylantiradi. */
  const abs = (url) => (!url ? null : /^https?:\/\//.test(url) ? url : API + url);

  /** Rasm ochilmasa — sindirilgan belgi ko'rinmasin, shunchaki yashiriladi. */
  const FALLBACK = 'onerror="this.dataset.failed=1;this.style.display=&quot;none&quot;"';
  const img = (src, cls) =>
    src ? `<img ${cls ? `class="${cls}"` : ""} src="${esc(src)}" alt="" loading="lazy" ${FALLBACK}>` : "";

  /** Ro'yxat bo'sh bo'lsa — chiroyli xabar (admin hali qo'shmagan bo'lishi mumkin). */
  function emptyState(box, text) {
    box.innerHTML = "";
    box.append(el("p", "empty", text));
  }

  async function api(path, opts) {
    const o = opts || {};
    const headers = { Authorization: "tma " + ((tg && tg.initData) || "") };
    if (o.body !== undefined) headers["Content-Type"] = "application/json";

    let res;
    try {
      res = await fetch(API + path, {
        method: o.method || "GET",
        headers,
        body: o.body === undefined ? undefined : JSON.stringify(o.body),
      });
    } catch (_) {
      throw { code: "network", message: "Server javob bermadi. Internetni tekshiring." };
    }

    let data = null;
    try {
      data = await res.json();
    } catch (_) {}

    if (!res.ok) {
      const e = (data && data.error) || {};
      throw Object.assign(
        { code: e.code || "http_" + res.status, message: e.message || "Xatolik" },
        e
      );
    }
    return data;
  }

  function onError(err, retry) {
    if (err && err.code === "phone_required") {
      openPhoneSheet(retry);
      return;
    }
    if (err && err.code === "invalid_init_data") {
      // Bu odatda ilova uzoq vaqt fonda turib, imzo eskirganda bo'ladi.
      // Sahifani yangilash yordam bermaydi — ilovani YOPIB, botdagi
      // «🛍 Do'konni ochish» tugmasidan qayta ochish kerak.
      gate(
        "Sessiya eskirgan.\n\nIlovani yopib, botdagi «🛍 Do'konni ochish» " +
          "tugmasi orqali qaytadan oching."
      );
      return;
    }
    haptic("err");
    toast((err && err.message) || "Xatolik yuz berdi");
  }

  /* ------------------------------------------- ism + telefon (bir martalik) */
  function extractPhone(response) {
    try {
      if (!response) return null;
      if (typeof response === "string") {
        const params = new URLSearchParams(response);
        const contact = params.get("contact");
        return contact ? JSON.parse(contact).phone_number || null : null;
      }
      const contact =
        (response.responseUnsafe && response.responseUnsafe.contact) || response.contact;
      return (contact && contact.phone_number) || null;
    } catch (_) {
      return null;
    }
  }

  function openPhoneSheet(onSaved) {
    const name = (S.me && S.me.full_name) || "";
    const phone = (S.me && S.me.phone) || "";

    openSheet(
      "Ma'lumotlaringiz",
      `<p class="step-sub">Buyurtmani rasmiylashtirish uchun ism va telefon kerak.
        Bir marta kiritasiz — keyin so'ralmaydi.</p>
       <label class="field"><span>👤 Ism va familiya</span>
         <input id="reg-name" value="${esc(name)}" placeholder="Anvarjon Axtamov"></label>
       <label class="field"><span>📞 Telefon</span>
         <input id="reg-phone" type="tel" inputmode="tel" value="${esc(phone)}"
                placeholder="+998901234567"></label>
       <button class="btn btn-ghost" id="reg-contact">📱 Telegram raqamimni yuborish</button>
       <button class="btn btn-primary" id="reg-save" style="margin-top:10px">
         Saqlash va davom etish</button>`
    );

    $("reg-contact").onclick = () => {
      haptic();
      if (tg && typeof tg.requestContact === "function") {
        try {
          tg.requestContact((granted, response) => {
            if (!granted) return toast("Raqam ulashilmadi — qo'lda kiritishingiz mumkin");
            const got = extractPhone(response);
            if (got) {
              $("reg-phone").value = got;
              haptic("ok");
              toast("Raqam olindi ✅");
            } else {
              toast("Raqamni qo'lda kiritib, Saqlashni bosing");
            }
          });
          return;
        } catch (_) {}
      }
      toast("Telegram versiyasi qo'llamaydi — raqamni qo'lda kiriting");
    };

    $("reg-save").onclick = async () => {
      const btn = $("reg-save");
      const fullName = $("reg-name").value.trim();
      const value = $("reg-phone").value.trim();
      if (fullName.length < 2) return toast("Ismingizni kiriting");
      if (value.replace(/\D/g, "").length < 9) return toast("Telefon raqamni to'liq kiriting");

      btn.disabled = true;
      btn.textContent = "Saqlanmoqda...";
      try {
        const res = await api("/api/register", {
          method: "POST",
          body: { full_name: fullName, phone: value },
        });
        S.me.full_name = res.full_name;
        S.me.phone = res.phone;
        S.me.needs_phone = false;
        haptic("ok");
        closeSheet();
        toast("Rahmat! Ma'lumotlar saqlandi ✅");
        renderPhoneWarn();
        if (typeof onSaved === "function") onSaved();
      } catch (err) {
        onError(err);
      } finally {
        btn.disabled = false;
        btn.textContent = "Saqlash va davom etish";
      }
    };
  }

  async function withPhone(action) {
    try {
      await action();
    } catch (err) {
      onError(err, () => withPhone(action));
    }
  }

  function renderPhoneWarn() {
    const box = $("phone-warn");
    if (!box) return;
    if (!S.me || !S.me.needs_phone) {
      box.classList.add("hidden");
      box.innerHTML = "";
      return;
    }
    box.className = "card";
    box.innerHTML = `
      <div class="row"><b>📞 Telefon qoldirilmagan</b></div>
      <div class="item-sub">Buyurtma berish uchun bir marta raqam kiritish kerak.</div>`;
    const btn = el("button", "btn btn-primary btn-sm", "Raqam qoldirish");
    btn.style.marginTop = "10px";
    btn.onclick = () => openPhoneSheet();
    box.append(btn);
  }

  /* ------------------------------------------------------------- savatcha */
  function loadCart() {
    try {
      const raw = JSON.parse(localStorage.getItem("zimmer_cart") || "[]");
      return Array.isArray(raw) ? raw : [];
    } catch (_) {
      return [];
    }
  }
  function saveCart() {
    localStorage.setItem("zimmer_cart", JSON.stringify(S.cart));
    const n = S.cart.reduce((s, i) => s + i.qty, 0);
    const b = $("cart-badge");
    b.textContent = n;
    // Aqlli badge: son o'zgarganda "pulse" (Avto_A1 mantiqi)
    if (n > 0) {
      b.classList.remove("hidden");
      b.classList.remove("pulse");
      void b.offsetWidth; // reflow — animatsiya qayta ishga tushsin
      b.classList.add("pulse");
    } else {
      b.classList.add("hidden");
      b.classList.remove("pulse");
    }
  }
  const cartSum = () => S.cart.reduce((s, i) => s + i.price * i.qty, 0);

  /* ---------------------------------------------------------- navigatsiya */
  function show(page) {
    ["splash", "gate", "flow", "home", "cart", "saved", "profile", "admin"].forEach((p) => {
      const node = $(p);
      if (node) node.classList.toggle("hidden", p !== page);
    });
    S.page = page;

    // konfiguratorda o'zining sticky CTA'si bor — navbar yashiriladi
    const navVisible = ["home", "cart", "saved", "profile", "admin"].includes(page) && S.me;
    $("nav").classList.toggle("hidden", !navVisible);
    document
      .querySelectorAll(".nav-btn")
      .forEach((b) => b.classList.toggle("active", b.dataset.page === page));

    if (page === "cart") {
      renderCart();
      animateCartTotal(); // jami summa 0 dan count-up bo'ladi
    }
    if (page === "saved") renderSaved();
    if (page === "profile") loadProfile();
    if (page === "admin" && window.ZimmerAdmin) window.ZimmerAdmin.open();
    if (page !== "flow") stopVideos();
    window.scrollTo({ top: 0 });
    syncBackButton();
  }

  function syncBackButton() {
    if (!tg || !tg.BackButton) return;
    const need =
      (S.page === "flow" && S.step > 1) || ["cart", "saved", "profile"].includes(S.page);
    if (need) tg.BackButton.show();
    else tg.BackButton.hide();
  }

  function goBack() {
    // Admin panelning o'z ichki qatlamlari bor — avval unga imkon beramiz
    if (S.page === "admin" && window.ZimmerAdmin && window.ZimmerAdmin.back()) return;
    if (S.page === "flow" && S.step > 1) return setStep(S.step - 1);
    if (S.page !== "home") return show("home");
  }

  function gate(text) {
    if (text) $("gate-text").textContent = text;
    $("splash").classList.add("hidden");
    show("gate");
    $("nav").classList.add("hidden");
  }

  /* ======================================================================
     KONFIGURATOR
     ====================================================================== */

  const STEPS = [
    { key: "car", title: "Mashinani tanlang", node: "fstep-car" },
    { key: "biled", title: "Bi-LED linza", node: "fstep-biled" },
    { key: "shroud", title: "Ochki (maska)", node: "fstep-shroud" },
    { key: "color", title: "Optika rangi", node: "fstep-color" },
    { key: "summary", title: "Buyurtmani tasdiqlash", node: "fstep-summary" },
  ];

  function setStep(step) {
    S.step = Math.max(1, Math.min(STEPS.length, step));
    const cur = STEPS[S.step - 1];

    STEPS.forEach((s, i) => $(s.node).classList.toggle("hidden", i !== S.step - 1));
    $("flow-title").textContent = cur.title;
    $("flow-sub").textContent =
      S.step === STEPS.length ? "Yakuniy qadam" : `${S.step}-qadam / ${STEPS.length - 1}`;
    $("progress-fill").style.width = (S.step / STEPS.length) * 100 + "%";
    $("flow-back").style.visibility = S.step > 1 ? "visible" : "hidden";

    $("preview").classList.toggle("hidden", S.step < 2);
    if (S.step >= 2) {
      S.previewTab = "art";
      drawPreview();
    } else {
      stopVideos();
    }
    if (S.step === STEPS.length) renderSummary();

    $("flow-cta").classList.toggle("hidden", S.step < 2);
    updateCta();
    updateTotal();
    syncBackButton();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function total() {
    return (
      (S.biled ? S.biled.price : 0) +
      (S.shroud ? S.shroud.price : 0) +
      (S.color ? S.color.price : 0)
    );
  }

  /** CTA tugmasi matni: majburiy bo'lmagan qadamda «O'tkazib yuborish». */
  function updateCta() {
    const btn = $("flow-next");
    if (S.step === STEPS.length) btn.textContent = "Buyurtmani yuborish";
    else if (S.step === 3 && !S.shroud) btn.textContent = "O'tkazib yuborish";
    else if (S.step === 4 && !S.color) btn.textContent = "O'tkazib yuborish";
    else btn.textContent = "Davom etish";
  }

  function updateTotal() {
    const node = $("flow-total");
    const value = fmt(total());
    if (node.textContent === value) return;
    node.textContent = value;
    node.classList.remove("bump");
    void node.offsetWidth;
    node.classList.add("bump");
  }

  function powerOf(biled) {
    if (!biled) return 3;
    const list = (S.tuning && S.tuning.biled_types) || [];
    const i = list.findIndex((b) => b.id === biled.id);
    return Math.max(1, Math.min(5, i + 1));
  }

  /** Ayni qadamda tanlangan element (media shundan olinadi). */
  function currentItem() {
    if (S.step === 3) return S.shroud;
    if (S.step === 4) return S.color;
    return S.biled;
  }

  function stopVideos() {
    document.querySelectorAll("video").forEach((v) => {
      try {
        v.pause();
      } catch (_) {}
    });
  }

  function drawPreview(flash) {
    const item = currentItem();
    const photo = abs(item && item.photo_url);
    const video = abs(item && item.video_url);

    // tablar: chizma doim bor, rasm/video faqat mavjud bo'lsa
    const tabs = [["art", "◐ Chizma"]];
    if (photo) tabs.push(["photo", "🖼 Rasm"]);
    if (video) tabs.push(["video", "🎬 Video"]);
    if (!tabs.some(([k]) => k === S.previewTab)) S.previewTab = "art";

    const tabBox = $("preview-tabs");
    tabBox.classList.toggle("hidden", tabs.length < 2);
    tabBox.innerHTML = "";
    tabs.forEach(([key, label]) => {
      const btn = el("button", "ptab" + (key === S.previewTab ? " on" : ""), label);
      btn.onclick = () => {
        S.previewTab = key;
        haptic();
        drawPreview();
      };
      tabBox.append(btn);
    });

    const svgBox = $("headlight");
    const mediaBox = $("preview-media");

    if (S.previewTab === "art") {
      stopVideos();
      mediaBox.classList.add("hidden");
      mediaBox.innerHTML = "";
      svgBox.classList.remove("hidden");
      svgBox.innerHTML = window.ZimmerHeadlight.render({
        biled: S.biled,
        shroud: S.shroud,
        color: S.color,
        power: powerOf(S.biled),
      });
    } else {
      svgBox.classList.add("hidden");
      mediaBox.classList.remove("hidden");
      mediaBox.innerHTML =
        S.previewTab === "photo"
          ? img(photo)
          : `<video src="${esc(video)}" controls playsinline preload="none"
                 ${photo ? `poster="${esc(photo)}"` : ""}></video>`;
    }

    const bits = [];
    if (S.car) bits.push(`<b>${esc(S.car.name)}</b>`);
    if (S.biled) bits.push(`💡 ${esc(S.biled.name)}`);
    if (S.shroud) bits.push(`🕶 ${esc(S.shroud.name)}`);
    if (S.color) bits.push(`🎨 ${esc(S.color.name)}`);
    if (!S.shroud && !S.color) bits.push('<span class="tagline">Jonli ko\'rinish</span>');
    $("preview-caption").innerHTML = bits.join(" · ");

    const preview = $("preview");
    preview.classList.toggle("lit", !!S.biled);
    if (flash) {
      preview.classList.remove("flash");
      void preview.offsetWidth;
      preview.classList.add("flash");
    }
  }

  /* --------------------------------------------------------------- mashina */
  function renderCars(target) {
    const box = target || $("cars");
    box.innerHTML = "";
    if (!S.cars.length) {
      emptyState(box, "Hozircha mashinalar qo'shilmagan. Tez orada qo'shiladi.");
      return;
    }
    S.cars.forEach((car) => {
      const card = el("button", "car-card" + (S.car && S.car.id === car.id ? " selected" : ""));
      const photo = abs(car.photo_url);
      card.innerHTML = `
        <div class="car-art">${
          photo
            ? img(photo, "car-thumb")
            : window.ZimmerCars.art(car.slug)
        }</div>
        <div class="car-info">
          <div class="car-name">${esc(car.name)}</div>
          <div class="car-years">${esc(car.years || "")}</div>
          <div class="car-note">${esc(car.note || "")}</div>
        </div>
        <span class="car-go">›</span>`;
      card.onclick = () => pickCar(car);
      box.append(card);
    });
  }

  async function pickCar(car) {
    S.car = car;
    haptic("medium");
    renderCars();
    if ($("sheet-cars")) closeSheet();

    try {
      await api("/api/me/car", { method: "POST", body: { car_id: car.id } });
      if (S.me) S.me.car = { id: car.id, name: car.name, years: car.years };
      $("car-chip-name").textContent = car.name;
    } catch (err) {
      onError(err);
    }

    if (S.page === "flow") {
      if (!S.tuning) await loadTuning();
      setStep(2);
    } else {
      S.home = null;
      loadHome();
    }
  }

  /* ------------------------------------------- ixcham variant qatorlari */

  /**
   * Bir xil ko'rinishdagi ixcham qator: [◉] [thumb] nom/meta ... narx
   * Tanlanganda pastida tafsilot ochiladi (akkordeon).
   */
  function optionRow(opts) {
    const wrap = el("div");
    const row = el("button", "opt" + (opts.selected ? " selected" : ""));

    const thumb = opts.photo
      ? img(opts.photo, "opt-thumb")
      : `<div class="opt-icon">${opts.icon || "•"}</div>`;

    row.innerHTML = `
      <span class="opt-mark"></span>
      ${thumb}
      <div class="opt-body">
        <div class="opt-name">
          <span>${esc(opts.name)}</span>
          ${opts.badge ? `<i class="badge-tag">${esc(opts.badge)}</i>` : ""}
          ${opts.hasVideo ? '<i class="badge-media">🎬</i>' : ""}
        </div>
        ${opts.meta ? `<div class="opt-meta">${esc(opts.meta)}</div>` : ""}
      </div>
      <div class="opt-price${opts.price ? "" : " free"}">${esc(opts.priceLabel)}</div>`;
    row.onclick = opts.onSelect;
    wrap.append(row);

    if (opts.details) {
      const more = el("div", "opt-more" + (opts.selected ? " open" : ""), opts.details);
      wrap.append(more);
    }
    return wrap;
  }

  async function loadTuning() {
    try {
      S.tuning = await api("/api/tuning");
      renderBiled();
      renderShrouds();
      renderColors();
    } catch (err) {
      onError(err);
    }
  }

  function renderBiled() {
    const box = $("biled-list");
    box.innerHTML = "";
    if (!S.tuning.biled_types.length) {
      emptyState(box, "Linzalar ro'yxati hozircha bo'sh.");
      return;
    }
    S.tuning.biled_types.forEach((b) => {
      const selected = S.biled && S.biled.id === b.id;
      const specs = [
        ["O'lcham", b.size],
        ["Harorat", b.kelvin],
        ["Yorqinlik", b.lumen],
        ["Kafolat", b.warranty],
      ].filter(([, v]) => v);

      const details =
        (b.description ? `<div>${esc(b.description)}</div>` : "") +
        (specs.length
          ? `<div class="spec-grid">${specs
              .map(([k, v]) => `<div class="spec">${esc(k)}<b>${esc(v)}</b></div>`)
              .join("")}</div>`
          : "");

      box.append(
        optionRow({
          name: b.name,
          meta: [b.brand, b.size, b.kelvin, b.lumen].filter(Boolean).join(" · "),
          priceLabel: b.price_label,
          price: b.price,
          badge: b.badge,
          icon: "💡",
          photo: abs(b.photo_url),
          hasVideo: !!b.video_url,
          selected,
          details,
          onSelect: () => {
            S.biled = b;
            haptic();
            renderBiled();
            drawPreview(true);
            updateTotal();
          },
        })
      );
    });
  }

  const SHROUD_ICON = { classic: "⭕️", devil: "😈", angel: "😇", sport: "🏁", carbon: "🩶" };

  function renderShrouds() {
    const box = $("shroud-list");
    box.innerHTML = "";
    if (!S.tuning.shrouds.length) {
      emptyState(box, "Ochki turlari hozircha qo'shilmagan.");
      return;
    }
    S.tuning.shrouds.forEach((s) => {
      const selected = S.shroud && S.shroud.id === s.id;
      box.append(
        optionRow({
          name: s.name,
          meta: s.description ? s.description.slice(0, 46) : "",
          priceLabel: s.price_label,
          price: s.price,
          icon: SHROUD_ICON[s.style] || "⭕️",
          photo: abs(s.photo_url),
          hasVideo: !!s.video_url,
          selected,
          details: s.description ? `<div>${esc(s.description)}</div>` : "",
          onSelect: () => {
            S.shroud = s;
            haptic();
            renderShrouds();
            drawPreview(true);
            updateTotal();
            updateCta();
          },
        })
      );
    });
  }

  function renderColors() {
    const box = $("color-list");
    box.innerHTML = "";
    if (!S.tuning.colors.length) {
      emptyState(box, "Ranglar hozircha qo'shilmagan.");
      return;
    }
    S.tuning.colors.forEach((c) => {
      const node = el("button", "swatch" + (S.color && S.color.id === c.id ? " selected" : ""));
      const photo = abs(c.photo_url);
      node.innerHTML = `
        <div class="swatch-dot" style="${
          photo
            ? `background-image:url('${esc(photo)}');background-size:cover;background-position:center`
            : `background:linear-gradient(135deg,${esc(c.hex_from)},${esc(c.hex_to)})`
        }"></div>
        <div class="swatch-name">${esc(c.name)}</div>
        <div class="swatch-price">${c.price ? "+" + esc(c.price_label) : "Bepul"}</div>`;
      node.onclick = () => {
        S.color = c;
        haptic();
        renderColors();
        drawPreview(true);
        updateTotal();
        updateCta();
      };
      box.append(node);
    });
  }

  /* ------------------------------------------------------------------ yakun */
  function renderSummary() {
    const rows = [
      ["🚗 Mashina", S.car ? `${S.car.name} (${S.car.years || "-"})` : "-", 0],
      ["💡 Bi-LED linza", S.biled ? S.biled.name : "-", S.biled ? S.biled.price : 0],
      ["🕶 Ochki", S.shroud ? S.shroud.name : "tanlanmagan", S.shroud ? S.shroud.price : 0],
      ["🎨 Optika rangi", S.color ? S.color.name : "standart", S.color ? S.color.price : 0],
    ];
    let html = "";
    rows.forEach(([label, value, price]) => {
      html += `<div class="sum-row"><span>${label}</span><b>${esc(value)}${
        price
          ? `<br><small style="color:#9aa0ab;font-weight:500">${esc(fmt(price))}</small>`
          : ""
      }</b></div>`;
    });
    html += '<div class="sum-div"></div>';
    html += `<div class="sum-total"><span>Jami (o'rnatish bilan)</span><b>${esc(
      fmt(total())
    )}</b></div>`;
    $("summary").innerHTML = html;
  }

  function submitConfig() {
    if (!S.car || !S.biled) return toast("Mashina va linzani tanlang");
    return withPhone(async () => {
      const btn = $("flow-next");
      btn.disabled = true;
      btn.textContent = "Yuborilmoqda...";
      try {
        const res = await api("/api/biled-orders", {
          method: "POST",
          body: {
            car_id: S.car.id,
            biled_id: S.biled.id,
            shroud_id: S.shroud ? S.shroud.id : null,
            color_id: S.color ? S.color.id : null,
            comment: $("order-comment").value.trim(),
          },
        });
        haptic("ok");
        burst();
        showDone(res.order);
      } finally {
        btn.disabled = false;
        btn.textContent = "Buyurtmani yuborish";
      }
    });
  }

  function showDone(order) {
    stopVideos();
    $("flow-cta").classList.add("hidden");
    $("preview").classList.add("hidden");
    $("progress-fill").style.width = "100%";
    $("flow-title").textContent = "Buyurtma qabul qilindi";
    $("flow-sub").textContent = "Rahmat!";
    $("flow-back").style.visibility = "hidden";

    document.querySelector(".flow-body").innerHTML = `
      <div class="done-wrap">
        <div class="done-ring"><svg viewBox="0 0 52 52"><path d="M14 27 L22 35 L38 18"/></svg></div>
        <h2>Buyurtma #${order.id} qabul qilindi</h2>
        <p>${esc(order.summary)}<br><b style="color:#fff">${esc(order.total_label)}</b></p>
        <p>Mutaxassisimiz tez orada bog'lanib, o'rnatish vaqtini kelishadi. 🔧</p>
        <button class="btn btn-primary" id="done-home">Asosiy menyuga o'tish</button>
      </div>`;
    $("done-home").onclick = () => location.reload();
  }

  /* ======================================================================
     ASOSIY MENYU
     ====================================================================== */

  async function loadHome() {
    if (!$("products").children.length) {
      $("products").innerHTML = '<div class="skel"></div><div class="skel"></div>';
    }
    try {
      S.home = await api("/api/home");
      S.favorites = new Set(S.home.favorite_ids || []);
      S.shopProducts = buildShopProducts(); // kategoriyasiz, random tartib
      renderStories();
      renderBanners();
      renderCatalog();
      renderBookCard();
      $("car-chip-name").textContent = (S.me && S.me.car && S.me.car.name) || "Mashina tanlash";
      $("config-cta-sub").textContent =
        S.me && S.me.car
          ? `${S.me.car.name} uchun linza, ochki va rangni tanlang`
          : "Linza, ochki va rangni tanlab narxni ko'ring";
    } catch (err) {
      onError(err);
    }
  }

  /* ------------------------------------------------------------- stories */
  function renderStories() {
    S.stories = S.home.stories || [];
    const box = $("stories");
    box.innerHTML = "";
    const seen = JSON.parse(localStorage.getItem("zimmer_seen") || "[]");

    S.stories.forEach((story, i) => {
      const node = el("button", "story" + (seen.includes(story.id) ? " seen" : ""));
      const photo = abs(story.photo_url);
      node.innerHTML = `
        <div class="story-ring">
          <div class="story-face" style="background:linear-gradient(150deg,${esc(
            story.color_from
          )},${esc(story.color_to)})">${
        photo ? img(photo) : esc(story.emoji)
      }</div>
        </div>
        <span class="story-label">${esc(story.title)}</span>`;
      node.onclick = () => openStory(i);
      box.append(node);
    });
    $("stories").classList.toggle("hidden", !S.stories.length);
  }

  function openStory(index) {
    if (!S.stories.length) return;
    S.storyIndex = index;
    $("story-view").classList.remove("hidden");
    haptic();
    paintStory();
  }

  function paintStory() {
    const story = S.stories[S.storyIndex];
    if (!story) return closeStory();

    $("story-bars").innerHTML = S.stories
      .map(
        (_, i) =>
          `<i class="${i < S.storyIndex ? "done" : i === S.storyIndex ? "active" : ""}"><b></b></i>`
      )
      .join("");

    const photo = abs(story.photo_url);
    const video = abs(story.video_url);
    const bg = video
      ? `<video src="${esc(video)}" autoplay muted loop playsinline></video>`
      : photo
      ? `<img src="${esc(photo)}" alt="">`
      : "";

    $("story-inner").innerHTML = `
      <div class="story-bg" style="background:linear-gradient(160deg,${esc(
        story.color_from
      )},${esc(story.color_to)} 75%, #000)">${bg}</div>
      <div class="story-shade"></div>
      ${!bg ? `<div class="story-emoji">${esc(story.emoji)}</div>` : ""}
      <div class="story-h">${esc(story.heading || story.title)}</div>
      <div class="story-b">${esc(story.body || "")}</div>`;

    const seen = JSON.parse(localStorage.getItem("zimmer_seen") || "[]");
    if (!seen.includes(story.id)) {
      seen.push(story.id);
      localStorage.setItem("zimmer_seen", JSON.stringify(seen));
    }

    clearTimeout(S.storyTimer);
    S.storyTimer = setTimeout(() => stepStory(1), video ? 9000 : 5000);
  }

  function stepStory(delta) {
    const next = S.storyIndex + delta;
    if (next < 0) return paintStory();
    if (next >= S.stories.length) return closeStory();
    S.storyIndex = next;
    paintStory();
  }

  function closeStory() {
    clearTimeout(S.storyTimer);
    stopVideos();
    $("story-view").classList.add("hidden");
    $("story-inner").innerHTML = "";
    renderStories();
  }

  /* ------------------------------------------------------------- banners */
  function renderBanners() {
    const box = $("banners");
    const dots = $("banner-dots");
    box.innerHTML = "";
    dots.innerHTML = "";
    const list = S.home.banners || [];

    list.forEach((b, i) => {
      const node = el("div", "banner");
      node.style.background = `linear-gradient(135deg,${b.color_from},${b.color_to})`;
      const photo = abs(b.photo_url);
      node.innerHTML = `
        ${img(photo, "banner-bg")}
        ${photo ? '<div class="banner-shade"></div>' : ""}
        ${b.tag ? `<span class="banner-tag">${esc(b.tag)}</span>` : ""}
        <div class="banner-title">${esc(b.title)}</div>
        <div class="banner-sub">${esc(b.subtitle || "")}</div>`;
      node.onclick = () => {
        haptic();
        openFlow();
      };
      box.append(node);
      dots.append(el("i", i === 0 ? "on" : ""));
    });

    // scroll hodisasi rAF bilan cheklanadi (ortiqcha hisob-kitob bo'lmasin)
    let ticking = false;
    box.onscroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        const idx = Math.round(box.scrollLeft / Math.max(1, box.clientWidth - 24));
        [...dots.children].forEach((d, i) => d.classList.toggle("on", i === idx));
        ticking = false;
      });
    };

    clearInterval(S.bannerTimer);
    if (list.length > 1) {
      S.bannerTimer = setInterval(() => {
        if (S.page !== "home" || document.hidden) return;
        const step = box.clientWidth - 24;
        const next = box.scrollLeft + step >= box.scrollWidth - 10 ? 0 : box.scrollLeft + step;
        box.scrollTo({ left: next, behavior: "smooth" });
      }, 5200);
    }
  }

  /* -------------------------------------------------------- saqlanganlar */

  /** Yurakni bosish: darhol bo'yaladi, so'ng serverga yoziladi. */
  async function toggleFavorite(product, button) {
    const wasSaved = S.favorites.has(product.id);

    // Darhol javob beramiz — mijoz kutib turmaydi
    if (wasSaved) S.favorites.delete(product.id);
    else S.favorites.add(product.id);
    if (button) {
      button.classList.toggle("on", !wasSaved);
      // Yurak "portlashi" — faqat saqlanganda (Avto_A1 heartBurst)
      button.classList.remove("pop", "burst");
      void button.offsetWidth;
      button.classList.add(wasSaved ? "pop" : "burst");
      setTimeout(() => button.classList.remove("pop", "burst"), 520);
    }
    haptic(wasSaved ? "light" : "medium");

    try {
      const res = await api("/api/favorites", {
        method: "POST",
        body: { product_id: product.id },
      });
      // Server haqiqiy holatni aytadi — moslashtirib qo'yamiz
      if (res.saved) S.favorites.add(product.id);
      else S.favorites.delete(product.id);
      if (button) button.classList.toggle("on", !!res.saved);
      toast(res.saved ? "Saqlanganlarga qo'shildi ❤️" : "Saqlanganlardan olindi");
    } catch (err) {
      // Xato bo'lsa — orqaga qaytaramiz, yolg'on ko'rsatmaymiz
      if (wasSaved) S.favorites.add(product.id);
      else S.favorites.delete(product.id);
      if (button) button.classList.toggle("on", wasSaved);
      onError(err);
    }
  }

  async function renderSaved() {
    const box = $("my-saved");
    const empty = $("saved-empty");
    if (!box) return;

    let items = [];
    try {
      const res = await api("/api/favorites");
      items = res.items || [];
    } catch (err) {
      onError(err);
      return;
    }

    S.favorites = new Set(items.map((p) => p.id));
    box.innerHTML = "";
    empty.classList.toggle("hidden", items.length > 0);
    animateStat("pf-stat-saved", items.length);

    items.forEach((p) => {
      const row = el("div", "saved-row");
      const photo = abs(p.photo_url);
      row.innerHTML = `
        <div class="saved-art">${photo ? img(photo) : "💡"}</div>
        <div class="saved-mid">
          <b>${esc(p.name)}</b>
          <span>${esc(p.price_label)}</span>
        </div>`;

      const add = el("button", "saved-add", p.stock > 0 ? "➕" : "—");
      add.disabled = p.stock < 1;
      add.title = "Savatchaga";
      add.onclick = () => {
        addToCart(p);
        add.textContent = "✓";
        setTimeout(() => (add.textContent = "➕"), 1100);
      };

      const remove = el("button", "saved-del", "♥");
      remove.title = "Saqlanganlardan olish";
      remove.onclick = async () => {
        await toggleFavorite(p, null);
        row.remove();
        empty.classList.toggle("hidden", box.children.length > 0);
      };

      row.append(add, remove);
      box.append(row);
    });
  }

  /** Chegirma foizi: eski va yangi narxdan hisoblanadi (aksiya tovarda). */
  function discountPercent(p) {
    const now = Number(p.price) || 0;
    const was = Number(p.old_price) || 0;
    if (was <= now || !now) return 0;
    return Math.round(((was - now) / was) * 100);
  }

  /* ---------------------------------------------------------- mahsulotlar */
  /** Massivni aralashtiradi (Fisher–Yates). */
  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const t = a[i];
      a[i] = a[j];
      a[j] = t;
    }
    return a;
  }

  /** Barcha mahsulotni kategoriyalardan bitta ro'yxatga yig'ib, aralashtiradi.
      Kategoriyalar olib tashlangan — tovarlar RANDOM tartibda chiqadi (Avto_A1). */
  function buildShopProducts() {
    const seen = new Set();
    const all = [];
    ((S.home && S.home.catalog) || []).forEach((c) =>
      (c.products || []).forEach((p) => {
        if (!seen.has(p.id)) {
          seen.add(p.id);
          all.push(p);
        }
      })
    );
    return shuffle(all);
  }

  function renderCatalog() {
    // Kategoriya chiplari kerak emas — yashiramiz
    const chips = $("cats");
    if (chips) {
      chips.innerHTML = "";
      chips.classList.add("hidden");
    }

    const products = S.shopProducts || [];
    const box = $("products");
    box.innerHTML = "";
    $("products-empty").classList.toggle("hidden", products.length > 0);
    $("catalog-sec").classList.toggle("hidden", !products.length);

    products.forEach((p) => {
      const card = el("div", "prod");
      const photo = abs(p.photo_url);
      const off = discountPercent(p);

      // Nom "·" bo'yicha ajratiladi: asosiy nom + mashina eslatmasi (Avto_A1)
      const parts = String(p.name || "").split("·");
      const mainName = (parts[0] || p.name || "").trim();
      const carHint = parts[1] ? `<div class="prod-hint">${esc(parts[1].trim())}</div>` : "";

      // Meta: eski narx (chegirma) + kam qolgani
      const metaBits = [];
      if (off && p.old_price_label)
        metaBits.push(`<span class="prod-old">${esc(p.old_price_label)}</span>`);
      if (p.stock > 0 && p.stock <= 5)
        metaBits.push(`<span class="prod-low">📦 ${p.stock} ta qoldi</span>`);
      const metaHTML = metaBits.length ? `<div class="prod-meta">${metaBits.join("")}</div>` : "";

      card.innerHTML = `
        <div class="prod-art${photo ? "" : " empty"}">
          ${photo ? img(photo, "card-img-lazy") : '<span class="prod-art-ph">💡</span>'}
          ${off ? `<span class="prod-off">-${off}%</span>` : ""}
          ${p.badge ? `<span class="prod-badge">${esc(p.badge)}</span>` : ""}
          ${p.video_url ? '<span class="prod-play">▶</span>' : ""}
          <button class="prod-fav${S.favorites.has(p.id) ? " on" : ""}"
                  aria-label="Saqlash">♥</button>
        </div>
        <div class="prod-body">
          <div class="prod-name">${esc(mainName)}</div>
          ${carHint}
          ${p.car_id ? '<div class="prod-fit">✓ Mashinangizga mos</div>' : ""}
          ${metaHTML}
          ${p.stock > 0 ? '<div class="prod-trust">🛡 14 kun kafolat</div>' : ""}
        </div>`;

      // Butun kartani bosish — tafsilot oynasi (Avto_A1 mantiqi)
      card.onclick = () => openProduct(p);

      const fav = card.querySelector(".prod-fav");
      fav.onclick = (ev) => {
        ev.stopPropagation(); // karta bosilishi bilan aralashmasin
        toggleFavorite(p, fav);
      };

      // Narx + savat tugmasi BIRGA (Avto_A1 kabi)
      const btn = el("button", "prod-add");
      const priceInner = `<span class="prod-add-price">${esc(p.price_label)}</span><span class="prod-add-ico">🛒</span>`;
      if (p.stock > 0) {
        btn.innerHTML = priceInner;
      } else {
        btn.classList.add("out");
        btn.textContent = "Tugadi";
        btn.disabled = true;
      }
      btn.onclick = (ev) => {
        ev.stopPropagation();
        if (p.stock < 1) return;
        addToCart(p);
        btn.classList.add("added");
        btn.innerHTML = "✓ Qo'shildi";
        setTimeout(() => {
          btn.classList.remove("added");
          btn.innerHTML = priceInner;
        }, 1100);
      };
      // Tugma kartochka TANASI ichida — pastga yopishib turadi (Avto_A1 kabi)
      card.querySelector(".prod-body").append(btn);

      box.append(card);
    });
  }

  function openProduct(p) {
    haptic();
    const photo = abs(p.photo_url);
    const video = abs(p.video_url);
    openSheet(
      p.name,
      `${
        video
          ? `<video src="${esc(video)}" controls playsinline preload="none" ${
              photo ? `poster="${esc(photo)}"` : ""
            } style="width:100%;border-radius:14px"></video>`
          : photo
          ? `<img src="${esc(photo)}" alt="" style="width:100%;border-radius:14px">`
          : ""
      }
      <p class="step-sub" style="margin-top:12px">${esc(p.description || "")}</p>
      <div class="row"><span>Narx</span><b>${esc(p.price_label)}</b></div>
      <div class="row"><span>Omborda</span><b>${p.stock} dona</b></div>`
    );
    const add = el("button", "btn btn-primary", "➕ Savatchaga qo'shish");
    add.style.marginTop = "12px";
    add.disabled = p.stock < 1;
    add.onclick = () => {
      addToCart(p);
      closeSheet();
    };

    // Saqlash tugmasi — kartochkadagi yurak bilan bir xil ishlaydi
    const save = el(
      "button",
      "btn btn-ghost btn-sm",
      S.favorites.has(p.id) ? "♥ Saqlanganlarda" : "♡ Saqlash"
    );
    save.style.marginTop = "8px";
    save.onclick = async () => {
      await toggleFavorite(p, null);
      save.textContent = S.favorites.has(p.id) ? "♥ Saqlanganlarda" : "♡ Saqlash";
      renderCatalog();
    };

    $("sheet-content").append(add, save);
  }

  function addToCart(product) {
    const found = S.cart.find((i) => i.id === product.id);
    const have = found ? found.qty : 0;
    if (have + 1 > product.stock) return toast(`Omborda ${product.stock} dona bor`);
    if (found) found.qty += 1;
    else
      S.cart.push({
        id: product.id,
        name: product.name,
        price: product.price,
        qty: 1,
        stock: product.stock,
        photo_url: product.photo_url || null, // savat qatorida rasm ko'rsatish uchun
      });
    saveCart();
    haptic();
  }

  /* --------------------------------------------------------------- navbat */
  function renderBookCard() {
    $("book-body").innerHTML = `
      <div class="book-line"><span>Bi-LED o'rnatish</span><b>2–3 soat</b></div>
      <div class="book-line"><span>Kafolat</span><b>1 yil</b></div>
      <button class="btn btn-primary btn-sm" id="book-open" style="width:100%;margin-top:10px">
        🗓 Navbat olish</button>`;
    $("book-open").onclick = openBookingSheet;
  }

  /* ------------------------------------------------------------- savatcha */
  // Bepul yetkazib berish chegarasi (so'm). Shu summadan oshsa — bepul.
  const FREE_DELIVERY_TARGET = 3000000;

  /** Chiroyli "bo'sh holat" bloki (Avto_A1 uslubida). */
  function emptyStatePro(o) {
    return `<div class="empty-state-pro">
        <div class="es-icon">${o.icon || "📦"}</div>
        <h3 class="es-title">${esc(o.title || "")}</h3>
        <p class="es-desc">${esc(o.desc || "")}</p>
        ${o.btnText ? `<button class="es-btn">${esc(o.btnText)}</button>` : ""}
      </div>`;
  }

  function renderCart() {
    const box = $("cart-items");
    box.innerHTML = "";
    const empty = S.cart.length === 0;
    $("cart-checkout").classList.toggle("hidden", empty);
    // savat sahifasiga "has-bar" — pastdagi yopishgan panel joyini ochadi
    const cartSec = $("cart");
    if (cartSec) cartSec.classList.toggle("has-bar", !empty);
    const emptyP = $("cart-empty");
    if (emptyP) emptyP.classList.add("hidden");

    if (empty) {
      box.innerHTML = emptyStatePro({
        icon: "🧺",
        title: "Savatingiz bo'sh",
        desc: "Hozircha hech narsa qo'shmadingiz. Mahsulotlarni tanlab, savatga qo'shing.",
        btnText: "Xaridni boshlash",
      });
      const btn = box.querySelector(".es-btn");
      if (btn)
        btn.onclick = () => {
          haptic();
          show("home");
          if (!S.home) loadHome();
        };
      renderCartProgress(0);
      return;
    }

    S.cart.forEach((item) => {
      const row = el("div", "cart-row");
      const photo = abs(item.photo_url);
      row.innerHTML = `
        <div class="cart-content-wrap">
          <div class="cart-thumb">${photo ? img(photo) : "💡"}</div>
          <div class="cart-info">
            <h4>${esc(item.name)}</h4>
            <span class="cart-price">${esc(fmt(item.price * item.qty))}</span>
          </div>
          <div class="cart-controls">
            <button data-act="minus" aria-label="Kamaytirish">−</button>
            <span class="cart-qty">${item.qty}</span>
            <button data-act="plus" aria-label="Ko'paytirish">+</button>
          </div>
        </div>
        <div class="swipe-delete" title="O'chirish">🗑</div>`;
      row.querySelector('[data-act="minus"]').onclick = () => changeQty(item.id, -1);
      row.querySelector('[data-act="plus"]').onclick = () => changeQty(item.id, 1);
      row.querySelector(".swipe-delete").onclick = () => removeCartItem(item.id);
      box.append(row);
    });

    const total = cartSum();
    const sumEl = $("cart-total-sum");
    if (sumEl) sumEl.textContent = fmt(total);
    renderCartProgress(total);
  }

  /** Savat qatorini butunlay o'chiradi (swipe → 🗑). */
  function removeCartItem(id) {
    S.cart = S.cart.filter((i) => i.id !== id);
    haptic("light");
    saveCart();
    renderCart();
  }

  /** Bepul yetkazib berishgacha progress bar (rang red→orange→green). */
  function renderCartProgress(total) {
    const wrap = $("cart-progress-wrap");
    const bar = $("cart-progress-bar");
    const msg = $("cart-progress-msg");
    if (!wrap || !bar || !msg) return;
    if (total <= 0) {
      wrap.classList.add("hidden");
      delete wrap.dataset.celebrated;
      return;
    }
    wrap.classList.remove("hidden");
    const percent = Math.min(100, (total / FREE_DELIVERY_TARGET) * 100);
    if (percent >= 100) {
      bar.style.width = "100%";
      bar.classList.add("done");
      msg.classList.add("done");
      msg.innerHTML = "🎉 Tabriklaymiz! Yetkazib berish <b>BEPUL</b>!";
      if (!wrap.dataset.celebrated) {
        wrap.dataset.celebrated = "1";
        haptic("ok");
      }
    } else {
      bar.style.width = percent + "%";
      bar.classList.remove("done");
      msg.classList.remove("done");
      msg.innerHTML = `Bepul yetkazishga yana <b>${esc(fmt(FREE_DELIVERY_TARGET - total))}</b> qoldi`;
      delete wrap.dataset.celebrated;
    }
  }

  /** Jami summa "count-up" animatsiyasi (savat ochilganda). */
  function animateCartTotal() {
    const obj = $("cart-total-sum");
    if (!obj) return;
    const end = cartSum();
    if (end <= 0) {
      obj.textContent = fmt(0);
      return;
    }
    let startTime = null;
    const duration = 1000;
    function step(ts) {
      if (!startTime) startTime = ts;
      const p = Math.min((ts - startTime) / duration, 1);
      obj.textContent = fmt(Math.floor(p * end));
      if (p < 1) requestAnimationFrame(step);
      else obj.textContent = fmt(end);
    }
    requestAnimationFrame(step);
  }

  function changeQty(id, delta) {
    const item = S.cart.find((i) => i.id === id);
    if (!item) return;
    if (delta > 0 && item.qty + 1 > item.stock) return toast(`Omborda ${item.stock} dona bor`);
    item.qty += delta;
    haptic(delta > 0 ? "light" : "light");
    if (item.qty < 1) S.cart = S.cart.filter((i) => i.id !== id);
    saveCart();
    renderCart();
  }

  /* ==================================================================
     RASMIYLASHTIRISH: savatcha → yetkazib berish → to'lov → buyurtma
     (Avto_A1 dagi mantiq, Zimmer dizaynida)
     ================================================================== */

  const dcity = () => (S.pay && S.pay.city) || "Toshkent";

  /** "Rasmiylashtirish" tugmasi: avval yetkazib berish usulini so'raymiz. */
  function startCheckout() {
    if (!S.cart.length) return toast("Savatcha bo'sh");
    // Telefon profilda bo'lmasa — bir marta so'raymiz, keyin davom etamiz
    if (!S.me || !S.me.phone) return openPhoneSheet(startCheckout);
    S.delivery = null;
    S.dlvMethod = null;
    haptic();
    openDeliverySheet();
  }

  /* --------------------------------------------------------- yetkazib berish */
  function openDeliverySheet() {
    openSheet(
      "🚚 Yetkazib berish",
      `<p class="step-sub">Buyurtmani qanday qabul qilmoqchisiz?</p>
       <div class="dlv-methods">
         <button class="dlv-card" id="dlv-courier">
           <span class="dlv-ico">🚖</span>
           <span class="dlv-txt"><b>Kuryer — manzilga</b>
             <small>Faqat ${esc(dcity())} shahar ichida · 1–2 kun</small></span>
           <span class="dlv-check">✓</span>
         </button>
         <button class="dlv-card" id="dlv-bts">
           <span class="dlv-ico">📦</span>
           <span class="dlv-txt"><b>BTS Pochta filialiga</b>
             <small>Butun O'zbekiston · 2–4 kun · filialdan olasiz</small></span>
           <span class="dlv-check">✓</span>
         </button>
       </div>

       <div id="dlv-courier-box" class="hidden">
         <label class="field"><span>📍 Yetkazish manzili</span>
           <textarea id="dlv-address" rows="2"
             placeholder="${esc(dcity())}, Chilonzor 9-kvartal, 25-uy, 12-xonadon"></textarea></label>
         <p class="dlv-note">ℹ️ Kuryer faqat <b>${esc(dcity())} shahar ichida</b> ishlaydi.
           Boshqa hududda bo'lsangiz, 📦 <b>BTS Pochta</b> ni tanlang.</p>
       </div>

       <div id="dlv-bts-box" class="hidden">
         <label class="field"><span>📦 Viloyat</span>
           <select id="bts-region" class="dlv-select"><option value="">— Viloyatni tanlang —</option></select></label>
         <label class="field hidden" id="bts-district-f"><span>Tuman / shahar</span>
           <select id="bts-district" class="dlv-select"><option value="">— Tumanni tanlang —</option></select></label>
         <label class="field hidden" id="bts-branch-f"><span>Filial</span>
           <select id="bts-branch" class="dlv-select"><option value="">— Filialni tanlang —</option></select></label>
         <div class="bts-info hidden" id="bts-info"></div>
       </div>

       <button class="btn btn-primary" id="dlv-continue">To'lovga o'tish →</button>`
    );

    const B = window.BTS_BRANCHES || {};
    const regSel = $("bts-region");
    Object.keys(B).forEach((r) => {
      const o = el("option");
      o.value = r;
      o.textContent = r;
      regSel.append(o);
    });

    $("dlv-courier").onclick = () => pickDelivery("courier");
    $("dlv-bts").onclick = () => pickDelivery("bts");
    regSel.onchange = btsRegionChange;
    $("bts-district").onchange = btsDistrictChange;
    $("bts-branch").onchange = btsBranchChange;
    $("dlv-continue").onclick = confirmDelivery;
  }

  function pickDelivery(method) {
    S.dlvMethod = method;
    haptic("selection");
    $("dlv-courier").classList.toggle("on", method === "courier");
    $("dlv-bts").classList.toggle("on", method === "bts");
    $("dlv-courier-box").classList.toggle("hidden", method !== "courier");
    $("dlv-bts-box").classList.toggle("hidden", method !== "bts");
  }

  function btsRegionChange() {
    const B = window.BTS_BRANCHES || {};
    const region = $("bts-region").value;
    const distF = $("bts-district-f");
    const distSel = $("bts-district");
    $("bts-info").classList.add("hidden");
    $("bts-branch-f").classList.add("hidden");
    distSel.innerHTML = '<option value="">— Tumanni tanlang —</option>';
    if (!region || !B[region]) {
      distF.classList.add("hidden");
      return;
    }
    Object.keys(B[region]).forEach((d) => {
      const o = el("option");
      o.value = d;
      o.textContent = d;
      distSel.append(o);
    });
    distF.classList.remove("hidden");
  }

  function btsDistrictChange() {
    const B = window.BTS_BRANCHES || {};
    const region = $("bts-region").value;
    const district = $("bts-district").value;
    const brF = $("bts-branch-f");
    const brSel = $("bts-branch");
    $("bts-info").classList.add("hidden");
    brSel.innerHTML = '<option value="">— Filialni tanlang —</option>';
    const branches = (B[region] || {})[district] || [];
    if (!branches.length) {
      brF.classList.add("hidden");
      return;
    }
    branches.forEach((b, i) => {
      const o = el("option");
      o.value = String(i);
      o.textContent = "📦 " + b.name;
      brSel.append(o);
    });
    brF.classList.remove("hidden");
  }

  function btsBranchChange() {
    const B = window.BTS_BRANCHES || {};
    const region = $("bts-region").value;
    const district = $("bts-district").value;
    const idx = $("bts-branch").value;
    const info = $("bts-info");
    const b = ((B[region] || {})[district] || [])[parseInt(idx, 10)];
    if (!b) {
      info.classList.add("hidden");
      return;
    }
    info.innerHTML = `<b>📦 BTS ${esc(b.name)}</b>
      <div>📍 ${esc(b.address)}</div>
      ${b.landmark ? `<div class="bts-landmark">🏷 ${esc(b.landmark)}</div>` : ""}
      ${b.hours ? `<div class="bts-hours">🕒 ${esc(b.hours)}</div>` : ""}`;
    info.classList.remove("hidden");
    haptic("light");
  }

  function confirmDelivery() {
    const method = S.dlvMethod;
    if (!method) return toast("Yetkazib berish usulini tanlang");

    if (method === "courier") {
      const address = ($("dlv-address").value || "").trim();
      if (address.length < 5) return toast("Manzilni to'liqroq yozing");
      S.delivery = { method: "courier", address, summary: `Kuryer (manzilga): ${address}` };
    } else {
      const B = window.BTS_BRANCHES || {};
      const region = $("bts-region").value;
      if (!region) return toast("Viloyatni tanlang");
      const district = $("bts-district").value;
      if (!district) return toast("Tuman / shaharni tanlang");
      const idx = $("bts-branch").value;
      if (idx === "") return toast("Filialni tanlang");
      const b = ((B[region] || {})[district] || [])[parseInt(idx, 10)];
      if (!b) return toast("Filial topilmadi");
      S.delivery = {
        method: "bts",
        address: `BTS ${b.name}, ${district}, ${region}`,
        summary:
          `BTS Pochta: ${b.name} filiali — ${b.address}` +
          `${b.landmark ? " (" + b.landmark + ")" : ""}, ${district}, ${region}`,
      };
    }
    haptic("medium");
    openPaymentSheet();
  }

  /* ---------------------------------------------------------------- to'lov */
  function openPaymentSheet() {
    const sum = cartSum();
    const isBts = S.delivery && S.delivery.method === "bts";
    openSheet(
      "💳 To'lov",
      `<div class="pay-total">
         <div><small>To'lov summasi</small><b>${esc(fmt(sum))}</b></div>
         <span class="pay-total-ico">🛒</span>
       </div>
       <div id="pay-options">
         <button class="pay-card" id="pay-card">
           <span class="pay-ico blue">💳</span>
           <span class="pay-txt"><b>Karta orqali o'tkazma</b><small>Uzcard / Humo kartaga</small></span>
           <span class="pay-go">›</span>
         </button>
         <button class="pay-card" id="pay-app">
           <span class="pay-ico cyan">📱</span>
           <span class="pay-txt"><b>Ilova orqali to'lash</b><small>Payme, Click yoki boshqa</small></span>
           <span class="pay-go">›</span>
         </button>
         <button class="pay-card${isBts ? " hidden" : ""}" id="pay-cash">
           <span class="pay-ico green">💵</span>
           <span class="pay-txt"><b>Naqd pul</b><small>Tovar kelganda to'laysiz</small></span>
           <span class="pay-go">›</span>
         </button>
         ${
           isBts
             ? '<p class="dlv-note">ℹ️ BTS Pochta orqali yuborishdan oldin to\'lov qilinadi — shuning uchun "Naqd" mavjud emas.</p>'
             : ""
         }
       </div>
       <div id="pay-detail" class="hidden"></div>`
    );
    $("pay-card").onclick = () => showPayDetail("card");
    $("pay-app").onclick = () => showPayDetail("app");
    const cash = $("pay-cash");
    if (cash) cash.onclick = payCash;
  }

  const cardDigits = () => ((S.pay && S.pay.card) || "").replace(/\s/g, "");

  function copyCard() {
    const digits = cardDigits();
    const done = () => {
      haptic("ok");
      toast("Karta raqami nusxalandi ✅");
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(digits).then(done, () => fallbackCopy(digits, done));
    } else {
      fallbackCopy(digits, done);
    }
  }
  function fallbackCopy(text, done) {
    const t = el("textarea");
    t.value = text;
    t.style.position = "fixed";
    t.style.opacity = "0";
    document.body.append(t);
    t.select();
    try {
      document.execCommand("copy");
      done();
    } catch (_) {}
    t.remove();
  }

  function showPayDetail(kind) {
    haptic();
    const sum = cartSum();
    const card = (S.pay && S.pay.card) || "";
    const holder = (S.pay && S.pay.holder) || "";
    const label = kind === "card" ? "Karta orqali o'tkazma" : "Ilova orqali (Payme/Click)";
    const steps =
      kind === "card"
        ? `<ol class="pay-steps">
             <li>Yuqoridagi karta raqamini <b>nusxalang</b> (raqamga bosing)</li>
             <li>Bank ilovangizda (Apelsin, Click, Payme...) <b>pul o'tkazing</b></li>
             <li>Pastdagi <b>«To'ladim»</b> tugmasini bosing</li>
           </ol>`
        : `<div class="pay-apps">
             <button class="btn btn-ghost btn-sm" id="open-payme">Payme ochish</button>
             <button class="btn btn-ghost btn-sm" id="open-click">Click ochish</button>
           </div>
           <ol class="pay-steps">
             <li>Ilovada yuqoridagi <b>kartaga</b> summani o'tkazing</li>
             <li>So'ng <b>«To'ladim»</b> tugmasini bosing</li>
           </ol>`;

    $("pay-options").classList.add("hidden");
    const box = $("pay-detail");
    box.classList.remove("hidden");
    box.innerHTML = `
      <button class="pay-back" id="pay-back">‹ Boshqa usul</button>
      <div class="bank-card">
        <div class="bank-chip"></div>
        <div class="bank-num" id="bank-num">${esc(card)}</div>
        <div class="bank-bottom"><span>${esc(holder)}</span><em>UZCARD</em></div>
      </div>
      <div class="pay-amount"><small>O'tkaziladigan summa</small><b>${esc(fmt(sum))}</b></div>
      ${steps}
      <button class="btn btn-primary" id="pay-done">✓ To'ladim</button>
      <p class="pay-hint">🛡 Admin to'lovni tekshirgach buyurtma tasdiqlanadi.</p>`;

    $("pay-back").onclick = () => {
      box.classList.add("hidden");
      box.innerHTML = "";
      $("pay-options").classList.remove("hidden");
    };
    $("bank-num").onclick = copyCard;
    $("pay-done").onclick = () => placeOrder(label, kind === "card");
    if (kind === "app") {
      const pm = $("open-payme");
      const ck = $("open-click");
      if (pm) pm.onclick = () => openPayApp("payme");
      if (ck) ck.onclick = () => openPayApp("click");
    }
  }

  function openPayApp(provider) {
    haptic("medium");
    const url =
      provider === "payme"
        ? "https://payme.uz/home/main"
        : "https://my.click.uz/app/transfer";
    try {
      tg.openLink(url);
    } catch (_) {
      window.open(url, "_blank");
    }
    toast((provider === "payme" ? "Payme" : "Click") + " ochildi. Kartaga o'tkazing!");
  }

  function payCash() {
    const sum = cartSum();
    ask(
      `Buyurtmani tasdiqlaysizmi?\n\nJami: ${fmt(sum)}\nTo'lov: Naqd pul (yetkazilganda)`
    ).then((ok) => {
      if (ok) placeOrder("Naqd pul (yetkazilganda)", false);
    });
  }

  /** Yakuniy qadam: buyurtmani serverga yuboradi. */
  function placeOrder(paymentLabel, openAdminChat) {
    if (!S.delivery) return toast("Yetkazib berish usulini tanlang");
    if (!S.cart.length) return toast("Savatcha bo'sh");

    return withPhone(async () => {
      const btn = $("pay-done"); // naqdda bu tugma bo'lmaydi
      if (btn) {
        btn.disabled = true;
        btn.textContent = "Yuborilmoqda...";
      }
      try {
        const res = await api("/api/orders", {
          method: "POST",
          body: {
            items: S.cart.map((i) => ({ product_id: i.id, qty: i.qty })),
            address: S.delivery.address,
            phone: (S.me && S.me.phone) || "",
            delivery_method: S.delivery.method,
            delivery_info: S.delivery.summary,
            payment_method: paymentLabel,
          },
        });
        S.cart = [];
        saveCart();
        renderCart();
        S.delivery = null;
        S.dlvMethod = null;
        haptic("ok");
        closeSheet();
        burst();
        toast(`✅ Buyurtma #${res.order.id} qabul qilindi`, 3400);
        show("profile");
        // Karta to'lovi: chekni yuborish uchun admin chatini ochamiz
        if (openAdminChat && S.pay && S.pay.admin) {
          try {
            tg.openTelegramLink("https://t.me/" + S.pay.admin);
          } catch (_) {}
        }
      } catch (err) {
        if (btn) {
          btn.disabled = false;
          btn.textContent = "✓ To'ladim";
        }
        throw err;
      }
    });
  }

  /* -------------------------------------------------------------- kabinet */
  /** Butun son "count-up" animatsiyasi (statistika plitkalari). */
  function animateStat(id, end) {
    const obj = $(id);
    if (!obj) return;
    end = Number(end) || 0;
    let startTime = null;
    const duration = 800;
    function step(ts) {
      if (!startTime) startTime = ts;
      const p = Math.min((ts - startTime) / duration, 1);
      obj.textContent = Math.floor(p * end);
      if (p < 1) requestAnimationFrame(step);
      else obj.textContent = end;
    }
    requestAnimationFrame(step);
  }

  async function loadProfile() {
    if (S.me) {
      const name = (S.me.full_name || S.me.first_name || "Mijoz").trim();
      $("pf-name").textContent = name;
      $("pf-avatar").textContent = (name[0] || "M").toUpperCase();
      $("pf-id").textContent = "ID: " + (S.me.user_id || "—");
      // Telefon bor bo'lsa — VIP (ring yorqinroq)
      const card = document.querySelector(".pf-card");
      if (card) card.classList.toggle("is-vip", !!S.me.phone);
      $("pf-since").textContent = S.me.phone ? "✓ Tasdiqlangan mijoz" : "Zimmer mijozi";
      $("profile-car").textContent = S.me.car
        ? `${S.me.car.name} (${S.me.car.years || "-"})`
        : "Belgilanmagan";
      renderPhoneWarn();
    }
    // "Saqlangan" endi alohida bo'lim — bu yerda faqat sonini ko'rsatamiz
    animateStat("pf-stat-saved", S.favorites ? S.favorites.size : 0);
    try {
      const [biled, bookings, orders] = await Promise.all([
        api("/api/biled-orders"),
        api("/api/bookings"),
        api("/api/orders"),
      ]);
      renderBiledOrders(biled);
      renderBookings(bookings);
      renderOrders(orders);
      // statistika: buyurtma (do'kon + bi-led), navbat
      animateStat("pf-stat-orders", (orders.length || 0) + (biled.length || 0));
      animateStat("pf-stat-bookings", bookings.length || 0);
    } catch (err) {
      onError(err);
    }
  }

  function renderBiledOrders(list) {
    const box = $("my-biled");
    box.innerHTML = "";
    $("biled-empty").classList.toggle("hidden", list.length > 0);
    list.forEach((o) => {
      box.append(
        el(
          "div",
          "card",
          `<div class="row">
             <b>#${o.id} · ${esc(o.car_name)}</b>
             <span class="status ${esc(o.status)}">${esc(o.status_label)}</span>
           </div>
           <div class="item-sub">${esc(o.summary)}</div>
           <div class="row"><span>Jami</span><b>${esc(o.total_label)}</b></div>`
        )
      );
    });
  }

  function renderBookings(list) {
    const box = $("my-bookings");
    box.innerHTML = "";
    $("bookings-empty").classList.toggle("hidden", list.length > 0);
    list.forEach((b) => {
      const card = el(
        "div",
        "card",
        `<div class="row">
           <b>#${b.id} · ${esc(b.service_name)}</b>
           <span class="status ${esc(b.status)}">${esc(b.status_label)}</span>
         </div>
         <div class="item-sub">📅 ${esc(b.date_label)} · 🕐 <b>${esc(b.time)}</b></div>`
      );
      if (b.can_cancel) {
        const btn = el("button", "btn btn-danger btn-sm", "Bekor qilish");
        btn.style.marginTop = "10px";
        btn.onclick = async () => {
          if (!(await ask(`#${b.id} navbatni bekor qilasizmi?`))) return;
          try {
            await api(`/api/bookings/${b.id}/cancel`, { method: "POST" });
            toast("Navbat bekor qilindi");
            loadProfile();
          } catch (err) {
            onError(err);
          }
        };
        card.append(btn);
      }
      box.append(card);
    });
  }

  function renderOrders(list) {
    const box = $("my-orders");
    box.innerHTML = "";
    $("orders-empty").classList.toggle("hidden", list.length > 0);
    list.forEach((o) => {
      const goods = o.items.map((i) => `${esc(i.name)} ×${i.qty}`).join(", ");
      box.append(
        el(
          "div",
          "card",
          `<div class="row">
             <b>#${o.id} · ${esc(o.total_label)}</b>
             <span class="status ${esc(o.status)}">${esc(o.status_label)}</span>
           </div>
           <div class="item-sub">🛍 ${goods}</div>
           ${o.delivery_info ? `<div class="item-sub">🚚 ${esc(o.delivery_info)}</div>` : ""}
           ${o.payment_method ? `<div class="item-sub">💳 ${esc(o.payment_method)}</div>` : ""}`
        )
      );
    });
  }

  /* -------------------------------------------------- profil: kesh / aloqa */

  /** Ilovani yangilash (kesh) — Avto_A1 dagi mantiq. Savat/saqlanganlar o'chmaydi. */
  function clearAppCache() {
    ask("Ilovani yangilaymizmi?\n\nSavat va saqlanganlaringiz o'chmaydi.").then((ok) => {
      if (!ok) return;
      haptic("ok");
      toast("Yangilanmoqda...");
      setTimeout(() => {
        try {
          location.reload(true);
        } catch (_) {
          location.reload();
        }
      }, 700);
    });
  }

  function openContactSheet() {
    haptic();
    const admin = (S.pay && S.pay.admin) || "";
    openSheet(
      "📞 Biz bilan aloqa",
      `<p class="step-sub">Savol yoki takliflar bo'lsa bemalol yozing — tez javob beramiz.</p>
       ${
         admin
           ? `<button class="btn btn-primary" id="contact-tg">✈️ Telegram: @${esc(admin)}</button>`
           : ""
       }
       <div class="contact-rows">
         <div class="row"><span>🕒 Ish vaqti</span><b>Har kuni 9:00–20:00</b></div>
         <div class="row"><span>📍 Shahar</span><b>${esc(dcity())}</b></div>
       </div>`
    );
    const b = $("contact-tg");
    if (b)
      b.onclick = () => {
        try {
          tg.openTelegramLink("https://t.me/" + admin);
        } catch (_) {}
      };
  }

  function openTrustSheet() {
    haptic();
    openSheet(
      "🛡 Kafolat va yetkazib berish",
      `<div class="trust-list">
         <div class="trust-item"><i>🛡</i><div><b>1 yil kafolat</b>
           <small>Barcha Bi-LED o'rnatishlarga rasmiy kafolat beriladi.</small></div></div>
         <div class="trust-item"><i>🚚</i><div><b>Tez yetkazib berish</b>
           <small>Kuryer (shahar ichida) yoki BTS Pochta (butun O'zbekiston).</small></div></div>
         <div class="trust-item"><i>↩️</i><div><b>7 kun ichida qaytarish</b>
           <small>Tovar mos kelmasa 7 kun ichida qaytarib berasiz.</small></div></div>
         <div class="trust-item"><i>🔧</i><div><b>Professional o'rnatish</b>
           <small>Tajribali ustalar va zamonaviy uskunalar bilan.</small></div></div>
       </div>`
    );
  }

  /* ----------------------------------------------------------------- sheet */
  function openSheet(title, html) {
    $("sheet-title").textContent = title;
    $("sheet-content").innerHTML = html;
    $("sheet").classList.remove("hidden");
  }
  function closeSheet() {
    stopVideos();
    $("sheet").classList.add("hidden");
    $("sheet-content").innerHTML = "";
  }

  function openCarSheet() {
    openSheet("Mashinani tanlang", '<div class="cars" id="sheet-cars"></div>');
    renderCars($("sheet-cars"));
  }

  async function openBookingSheet() {
    haptic();
    openSheet("O'rnatishga navbat", '<p class="empty">Yuklanmoqda...</p>');
    try {
      const services = await api("/api/services");
      const box = el("div", "opts");
      services.forEach((s) => {
        box.append(
          optionRow({
            name: s.name,
            meta: `⏱ ${s.duration_min} daqiqa`,
            priceLabel: s.price_label,
            price: s.price,
            icon: "🔧",
            onSelect: () => pickBookingService(s),
          })
        );
      });
      $("sheet-content").innerHTML = "";
      $("sheet-content").append(box);
    } catch (err) {
      closeSheet();
      onError(err);
    }
  }

  async function pickBookingService(service) {
    S.booking.service = service;
    haptic();
    $("sheet-title").textContent = service.name;
    $("sheet-content").innerHTML = '<p class="empty">Kunlar yuklanmoqda...</p>';
    try {
      const days = await api("/api/dates?service_id=" + service.id);
      const chips = el("div", "chips");
      days.forEach((d) => {
        const chip = el("button", "chip", d.short_label + (d.free_count ? "" : " · band"));
        chip.disabled = !d.free_count;
        chip.onclick = () => pickBookingDate(d);
        chips.append(chip);
      });
      $("sheet-content").innerHTML = "";
      $("sheet-content").append(chips);
    } catch (err) {
      onError(err);
    }
  }

  async function pickBookingDate(day) {
    S.booking.date = day.date;
    haptic();
    $("sheet-content").innerHTML = '<p class="empty">Vaqtlar yuklanmoqda...</p>';
    try {
      const data = await api(
        `/api/slots?service_id=${S.booking.service.id}&date=${encodeURIComponent(day.date)}`
      );
      const wrap = el("div");
      wrap.append(el("p", "step-sub", `📅 ${esc(day.label)} — bo'sh vaqtlar`));
      const grid = el("div", "slots");
      data.slots.forEach((time) => {
        const btn = el("button", "slot", time);
        btn.onclick = async () => {
          if (!(await ask(`${S.booking.service.name}\n${day.label} · ${time}\n\nTasdiqlaysizmi?`)))
            return;
          await withPhone(async () => {
            const res = await api("/api/bookings", {
              method: "POST",
              body: { service_id: S.booking.service.id, date: day.date, time },
            });
            haptic("ok");
            closeSheet();
            burst();
            toast(`✅ Navbat #${res.booking.id} · ${time}`, 3200);
            show("profile");
          });
        };
        grid.append(btn);
      });
      wrap.append(grid);
      $("sheet-content").innerHTML = "";
      $("sheet-content").append(wrap);
    } catch (err) {
      onError(err);
    }
  }

  /* ------------------------------------------------------------------ oqim */
  async function openFlow() {
    show("flow");
    if (!S.cars.length) {
      try {
        S.cars = await api("/api/cars");
      } catch (err) {
        return onError(err);
      }
    }
    renderCars();
    if (!S.tuning) await loadTuning();
    setStep(S.car ? 2 : 1);
  }

  /* ------------------------------------------------------------------ boot */
  /** To'liq ekranda header Telegram tugmalari ostida qolmasligi uchun
      --safe-t ni qurilma + Telegram UI insetlaridan hisoblab yangilaydi. */
  function applyTgSafeTop() {
    if (!tg) return;
    try {
      const sa = tg.safeAreaInset || {}; // qurilma (notch/status bar)
      const csa = tg.contentSafeAreaInset || {}; // Telegram UI paneli
      const saTop = typeof sa.top === "number" ? sa.top : 0;
      const csaTop = typeof csa.top === "number" ? csa.top : 0;
      let total = saTop + csaTop;
      const isFs = typeof tg.isFullscreen === "boolean" ? tg.isFullscreen : false;
      // Fullscreen yoqilgan, lekin inset hali kelmagan — zaxira qiymat
      if (total < 1 && isFs) total = 56;
      if (total > 0) document.documentElement.style.setProperty("--safe-t", total + "px");
    } catch (_) {}
  }

  async function boot() {
    if (tg) {
      tg.ready();
      tg.expand();
      try {
        tg.setHeaderColor("#08080a");
        tg.setBackgroundColor("#08080a");
      } catch (_) {}
      if (tg.BackButton) tg.BackButton.onClick(goBack);
      if (tg.enableClosingConfirmation) tg.enableClosingConfirmation();

      // 🔳 To'liq ekran (Telegram 8.0+) — ilova butun ekranni egallaydi
      try {
        if (tg.isVersionAtLeast && tg.isVersionAtLeast("8.0") && tg.requestFullscreen) {
          tg.requestFullscreen();
        }
      } catch (_) {}

      // 🛑 Pastga/tepaga tortganda yopilib ketmasin (Telegram 7.7+)
      try {
        if (tg.isVersionAtLeast && tg.isVersionAtLeast("7.7") && tg.disableVerticalSwipes) {
          tg.disableVerticalSwipes();
        }
      } catch (_) {}

      // 🔝 To'liq ekranda Telegram tugmalari (✕, ⋮) kontent ustida suzadi —
      // header ular ostida qolmasligi uchun --safe-t ni haqiqiy insetlar bilan
      // yangilaymiz. Insetlar fullscreen o'tishidan KEYIN kelishi mumkin.
      applyTgSafeTop();
      try {
        if (tg.onEvent) {
          tg.onEvent("safeAreaChanged", applyTgSafeTop);
          tg.onEvent("contentSafeAreaChanged", applyTgSafeTop);
          tg.onEvent("fullscreenChanged", applyTgSafeTop);
        }
      } catch (_) {}
      setTimeout(applyTgSafeTop, 150);
      setTimeout(applyTgSafeTop, 600);
    }

    if (!tg || !tg.initData) {
      gate(
        "Do'konni Telegram ichidan oching — botga /start yuborib «🛍 Do'konni ochish» tugmasini bosing."
      );
      return;
    }

    saveCart();

    try {
      const [cfg, me] = await Promise.all([api("/api/config"), api("/api/me")]);
      S.currency = cfg.currency || "so'm";
      S.pay = {
        card: cfg.pay_card_number || "",
        holder: cfg.pay_card_holder || "",
        admin: cfg.pay_admin_username || "",
        city: cfg.delivery_city || "Toshkent",
      };
      S.me = me;
      renderPhoneWarn();

      const name = (me.full_name || me.first_name || "").split(" ")[0];
      $("splash-hello").innerHTML = `
        <h1>Assalomu alaykum${name ? ", " + esc(name) : ""}</h1>
        <p>Faralaringizni yangilaymiz</p>`;

      // Admin bo'lsa — pastdagi menyuda «Boshqaruv» tugmasi paydo bo'ladi
      if (me.is_admin) {
        const adminBtn = $("nav-admin");
        if (adminBtn) adminBtn.classList.remove("hidden");
      }

      S.cars = await api("/api/cars");
      if (me.car) S.car = S.cars.find((c) => c.id === me.car.id) || null;
    } catch (err) {
      if (err && err.code === "invalid_init_data") return onError(err);
      gate(
        (err && err.message ? err.message : "Server javob bermadi") +
          "\n\nServer: " +
          (API || "ko'rsatilmagan")
      );
      return;
    }

    // Tugma yo'q: mijoz ismini ko'radi, chiziq to'ladi va bosh menyu O'ZI
    // ochiladi. Konfigurator hech qachon majburan ochilmaydi.
    const progress = $("splash-progress");
    if (progress) progress.classList.add("on");

    // Bosh menyu ma'lumoti shu kutish paytida fonda yuklanadi
    const loading = loadHome();
    await Promise.all([loading, wait(1500)]);

    $("splash").classList.add("leaving");
    await wait(280);
    enterHome();
  }

  /* ---------------------------------------------------- admin panel ko'prigi
     admin.js alohida fayl (app.js dan oldin yuklanadi). U shu ko'prik
     orqali API, toast, haptic va boshqa yordamchilarni ishlatadi — kod
     ikki joyda takrorlanmasin. */
  window.ZIMMER_APP = {
    api: api,
    toast: toast,
    haptic: haptic,
    esc: esc,
    fmt: fmt,
    ask: ask,
    show: show,
    abs: abs,
    apiBase: () => API,
    state: S,
  };

  /* --------------------------------------------------------------- hodisa */
  document.querySelectorAll(".nav-btn").forEach((btn) => {
    btn.onclick = () => {
      haptic();
      const page = btn.dataset.page;
      if (page === "flow") return openFlow();
      show(page);
      if (page === "home" && !S.home) loadHome();
    };
  });

  $("flow-next").onclick = () => {
    if (S.step === 1 && !S.car) return toast("Mashinani tanlang");
    if (S.step === 2 && !S.biled) return toast("Bi-LED linzani tanlang");
    // Ochki va rang majburiy emas — tanlanmasa tugma «O'tkazib yuborish» bo'ladi
    if (S.step === STEPS.length) return submitConfig();
    haptic();
    setStep(S.step + 1);
  };
  $("flow-back").onclick = () => setStep(S.step - 1);
  // Konfiguratorni yopish har doim ishlaydi — mashina tanlash majburiy emas
  $("flow-close").onclick = () => {
    show("home");
    if (!S.home) loadHome();
  };

  $("config-cta").onclick = openFlow;
  $("car-chip").onclick = openCarSheet;
  $("change-car").onclick = openCarSheet;
  $("order-submit").onclick = startCheckout;

  // Profil hub tugmalari
  $("pf-edit").onclick = () => openPhoneSheet(() => loadProfile());
  $("pf-contact").onclick = openContactSheet;
  $("pf-trust").onclick = openTrustSheet;
  $("pf-clear-cache").onclick = clearAppCache;

  $("sheet-close").onclick = closeSheet;
  $("sheet-backdrop").onclick = closeSheet;

  $("story-close").onclick = closeStory;
  $("story-prev").onclick = () => stepStory(-1);
  $("story-next").onclick = () => stepStory(1);

  $("gate-close").onclick = () => (tg ? tg.close() : window.close());
  $("gate-retry").onclick = () => location.reload();

  // Sahifa fonga o'tsa — animatsiya va videolar to'xtaydi (issiqlik/batareya)
  document.addEventListener("visibilitychange", () => {
    document.body.classList.toggle("paused", document.hidden);
    if (document.hidden) stopVideos();
  });

  /* --------------------------------------------------- savatda swipe → o'chirish
     Qatorni chapga surib 🗑 tugmasini ochadi (Avto_A1 mantiqi). Passiv touch —
     skroll buzilmaydi; faqat aniq gorizontal harakatda ishlaydi. */
  (function cartSwipeInit() {
    let startX = 0,
      startY = 0,
      deltaX = 0,
      target = null,
      horizontal = null;
    const threshold = 50;

    document.addEventListener(
      "touchstart",
      (e) => {
        const row = e.target.closest ? e.target.closest(".cart-row") : null;
        if (!row) {
          document
            .querySelectorAll(".cart-row.show-delete")
            .forEach((r) => r.classList.remove("show-delete"));
          return;
        }
        document
          .querySelectorAll(".cart-row.show-delete")
          .forEach((r) => r !== row && r.classList.remove("show-delete"));
        target = row;
        startX = e.touches[0].clientX;
        startY = e.touches[0].clientY;
        deltaX = 0;
        horizontal = null;
      },
      { passive: true }
    );

    document.addEventListener(
      "touchmove",
      (e) => {
        if (!target) return;
        const dx = e.touches[0].clientX - startX;
        const dy = e.touches[0].clientY - startY;
        if (horizontal === null && (Math.abs(dx) > 8 || Math.abs(dy) > 8)) {
          horizontal = Math.abs(dx) > Math.abs(dy);
        }
        if (horizontal) {
          deltaX = Math.min(0, dx);
          const wrap = target.querySelector(".cart-content-wrap");
          if (wrap) {
            wrap.style.transition = "none";
            wrap.style.transform = `translateX(${Math.max(deltaX, -100)}px)`;
          }
        }
      },
      { passive: true }
    );

    document.addEventListener(
      "touchend",
      () => {
        if (!target) return;
        const wrap = target.querySelector(".cart-content-wrap");
        if (wrap) wrap.style.transition = "";
        if (horizontal && deltaX < -threshold) {
          target.classList.add("show-delete");
        } else {
          target.classList.remove("show-delete");
        }
        if (wrap) wrap.style.transform = "";
        target = null;
        deltaX = 0;
        horizontal = null;
      },
      { passive: true }
    );
  })();

  boot();
})();
