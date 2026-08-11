/* ==========================================================================
   ZIMMER — Bi-LED avtotuning Mini App
   Oqim: salom → mashina → Bi-LED linza → ochki → optika rangi → buyurtma
         → asosiy menyu (stories, bannerlar, aksiyalar, mahsulotlar)
   ========================================================================== */

(function () {
  "use strict";

  const tg = window.Telegram ? window.Telegram.WebApp : null;

  /* ------------------------------------------------------------- yordamchilar */
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
    home: null,
    catIndex: 0,
    cart: loadCart(),
    stories: [],
    storyIndex: 0,
    storyTimer: null,
    bannerTimer: null,
    booking: { service: null, date: null },
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
    const colors = ["#ff2d3a", "#ffffff", "#ff8a3d", "#e01020", "#ffd6d6"];
    for (let i = 0; i < 46; i++) {
      const p = el("i");
      p.style.left = Math.random() * 100 + "%";
      p.style.background = colors[i % colors.length];
      p.style.animationDelay = Math.random() * 0.5 + "s";
      p.style.animationDuration = 1.7 + Math.random() * 1.1 + "s";
      p.style.opacity = 0.75 + Math.random() * 0.25;
      box.append(p);
    }
    setTimeout(() => box.classList.add("hidden"), 2800);
  }

  /* -------------------------------------------------------------------- API */
  function apiBase() {
    const fromUrl = new URLSearchParams(location.search).get("api");
    if (fromUrl) {
      localStorage.setItem("zimmer_api", fromUrl);
      return fromUrl.replace(/\/$/, "");
    }
    const saved = localStorage.getItem("zimmer_api");
    return (saved || (window.ZIMMER_CONFIG && window.ZIMMER_CONFIG.API_BASE) || "").replace(/\/$/, "");
  }
  const API = apiBase();

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
      throw Object.assign({ code: e.code || "http_" + res.status, message: e.message || "Xatolik" }, e);
    }
    return data;
  }

  function onError(err, retry) {
    // Telefon yetishmasa — to'siq emas, kichik forma ochiladi va amal davom etadi
    if (err && err.code === "phone_required") {
      openPhoneSheet(retry);
      return;
    }
    if (err && err.code === "invalid_init_data") {
      gate("Telegram ma'lumotlari tasdiqlanmadi. Ilovani bot ichidagi tugma orqali oching.");
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
        if (contact) return JSON.parse(contact).phone_number || null;
        return null;
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
        Bir marta kiritasiz — keyin boshqa so'ralmaydi.</p>
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

  /** Telefon talab qiladigan amallarni o'raydi: kerak bo'lsa forma ochib, keyin davom etadi. */
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

  /* ---------------------------------------------------------------- savatcha */
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
    b.classList.toggle("hidden", n === 0);
  }
  const cartSum = () => S.cart.reduce((s, i) => s + i.price * i.qty, 0);

  /* ------------------------------------------------------------ navigatsiya */
  function show(page) {
    ["splash", "gate", "flow", "home", "cart", "profile"].forEach((p) => {
      const node = $(p);
      if (node) node.classList.toggle("hidden", p !== page);
    });
    S.page = page;

    // konfiguratorda o'zining sticky CTA'si bor — navbar ustma-ust tushmasligi uchun yashiriladi
    const navVisible = ["home", "cart", "profile"].includes(page) && S.me && S.me.registered;
    $("nav").classList.toggle("hidden", !navVisible);
    document.querySelectorAll(".nav-btn").forEach((b) =>
      b.classList.toggle("active", b.dataset.page === page)
    );

    if (page === "cart") renderCart();
    if (page === "profile") loadProfile();
    window.scrollTo({ top: 0 });
    syncBackButton();
  }

  function syncBackButton() {
    if (!tg || !tg.BackButton) return;
    const show = (S.page === "flow" && S.step > 1) || ["cart", "profile"].includes(S.page);
    if (show) tg.BackButton.show();
    else tg.BackButton.hide();
  }

  function goBack() {
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
    if (S.step >= 2) drawPreview();
    if (S.step === STEPS.length) renderSummary();

    const cta = $("flow-cta");
    cta.classList.toggle("hidden", S.step < 2);
    $("flow-next").textContent = S.step === STEPS.length ? "Buyurtmani yuborish" : "Davom etish";
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

  function updateTotal() {
    const node = $("flow-total");
    node.textContent = fmt(total());
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

  function drawPreview(flash) {
    $("headlight").innerHTML = window.ZimmerHeadlight.render({
      biled: S.biled,
      shroud: S.shroud,
      color: S.color,
      power: powerOf(S.biled),
    });

    const bits = [];
    if (S.car) bits.push(`<b>${esc(S.car.name)}</b>`);
    if (S.biled) bits.push(`💡 ${esc(S.biled.name)}`);
    if (S.shroud) bits.push(`🕶 ${esc(S.shroud.name)}`);
    if (S.color) bits.push(`🎨 ${esc(S.color.name)}`);
    if (!S.shroud && !S.color) bits.push('<span class="tagline">Jonli ko\'rinish</span>');
    $("preview-caption").innerHTML = bits.join(" · ");

    if (flash) {
      const p = $("preview");
      p.classList.remove("flash");
      void p.offsetWidth;
      p.classList.add("flash");
    }
  }

  /* ------------------------------------------------------------- mashinalar */
  function renderCars(target) {
    const box = target || $("cars");
    box.innerHTML = "";
    S.cars.forEach((car) => {
      const card = el("button", "car-card" + (S.car && S.car.id === car.id ? " selected" : ""));
      card.innerHTML = `
        <div class="car-art">${window.ZimmerCars.art(car.slug)}</div>
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
      loadHome();
    }
  }

  /* -------------------------------------------------- linza / ochki / rang */
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
    S.tuning.biled_types.forEach((b) => {
      const node = el("button", "opt" + (S.biled && S.biled.id === b.id ? " selected" : ""));
      node.innerHTML = `
        <div class="opt-icon">💡</div>
        <div class="opt-main">
          <div class="opt-name">${esc(b.name)}${b.badge ? `<i class="badge-tag">${esc(b.badge)}</i>` : ""}</div>
          <div class="opt-meta">
            <span>${esc(b.size || "")}</span><span>${esc(b.kelvin || "")}</span>
            <span>${esc(b.lumen || "")}</span><span>🛡 ${esc(b.warranty || "")}</span>
          </div>
          <div class="opt-desc">${esc(b.description || "")}</div>
          <div class="opt-price">${esc(b.price_label)}</div>
        </div>`;
      node.onclick = () => {
        S.biled = b;
        haptic();
        renderBiled();
        drawPreview(true);
        updateTotal();
      };
      box.append(node);
    });
  }

  const SHROUD_ICON = { classic: "⭕️", devil: "😈", angel: "😇", sport: "🏁", carbon: "🩶" };

  function renderShrouds() {
    const box = $("shroud-list");
    box.innerHTML = "";
    S.tuning.shrouds.forEach((s) => {
      const node = el("button", "opt" + (S.shroud && S.shroud.id === s.id ? " selected" : ""));
      node.innerHTML = `
        <div class="opt-icon">${SHROUD_ICON[s.style] || "⭕️"}</div>
        <div class="opt-main">
          <div class="opt-name">${esc(s.name)}</div>
          <div class="opt-desc">${esc(s.description || "")}</div>
          <div class="opt-price">${esc(s.price_label)}</div>
        </div>`;
      node.onclick = () => {
        S.shroud = s;
        haptic();
        renderShrouds();
        drawPreview(true);
        updateTotal();
      };
      box.append(node);
    });
  }

  function renderColors() {
    const box = $("color-list");
    box.innerHTML = "";
    S.tuning.colors.forEach((c) => {
      const node = el("button", "swatch" + (S.color && S.color.id === c.id ? " selected" : ""));
      node.innerHTML = `
        <div class="swatch-dot" style="background:linear-gradient(135deg,${esc(c.hex_from)},${esc(c.hex_to)})"></div>
        <div class="swatch-name">${esc(c.name)}</div>
        <div class="swatch-price">${c.price ? "+" + esc(c.price_label) : "Bepul"}</div>`;
      node.onclick = () => {
        S.color = c;
        haptic();
        renderColors();
        drawPreview(true);
        updateTotal();
      };
      box.append(node);
    });
  }

  /* ------------------------------------------------------------------ yakun */
  function renderSummary() {
    const rows = [
      ["🚗 Mashina", S.car ? `${S.car.name} (${S.car.years || "-"})` : "-", null],
      ["💡 Bi-LED linza", S.biled ? S.biled.name : "-", S.biled ? S.biled.price : 0],
      ["🕶 Ochki", S.shroud ? S.shroud.name : "tanlanmagan", S.shroud ? S.shroud.price : 0],
      ["🎨 Optika rangi", S.color ? S.color.name : "standart", S.color ? S.color.price : 0],
    ];
    let html = "";
    rows.forEach(([label, value, price]) => {
      html += `<div class="sum-row"><span>${label}</span><b>${esc(value)}${
        price ? `<br><small style="color:#9aa0ab;font-weight:500">${esc(fmt(price))}</small>` : ""
      }</b></div>`;
    });
    html += '<div class="sum-div"></div>';
    html += `<div class="sum-total"><span>Jami (o'rnatish bilan)</span><b>${esc(fmt(total()))}</b></div>`;
    $("summary").innerHTML = html;
  }

  function submitConfig() {
    if (!S.car || !S.biled) {
      toast("Mashina va linzani tanlang");
      return;
    }
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
    $("flow-cta").classList.add("hidden");
    $("preview").classList.add("hidden");
    $("progress-fill").style.width = "100%";
    $("flow-title").textContent = "Buyurtma qabul qilindi";
    $("flow-sub").textContent = "Rahmat!";
    $("flow-back").style.visibility = "hidden";

    const body = document.querySelector(".flow-body");
    body.innerHTML = `
      <div class="done-wrap">
        <div class="done-ring">
          <svg viewBox="0 0 52 52"><path d="M14 27 L22 35 L38 18"/></svg>
        </div>
        <h2>Buyurtma #${order.id} qabul qilindi</h2>
        <p>${esc(order.summary)}<br><b style="color:#fff">${esc(order.total_label)}</b></p>
        <p>Mutaxassisimiz tez orada bog'lanib, o'rnatish vaqtini kelishadi. 🔧</p>
        <button class="btn btn-primary" id="done-home">Asosiy menyuga o'tish</button>
      </div>`;
    $("done-home").onclick = () => {
      resetFlow();
      show("home");
      loadHome();
    };
  }

  function resetFlow() {
    S.biled = null;
    S.shroud = null;
    S.color = null;
    // "tayyor" ekrani .flow-body ni butunlay almashtirgan — qadamlarni tiklash uchun
    // sahifani qayta yuklaymiz (eng ishonchli yo'l)
    if (!$("fstep-car")) {
      location.reload();
      return;
    }
    setStep(1);
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
      renderStories();
      renderBanners();
      renderPromos();
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

  /* -------------------------------------------------------------- stories */
  function renderStories() {
    S.stories = S.home.stories || [];
    const box = $("stories");
    box.innerHTML = "";
    const seen = JSON.parse(localStorage.getItem("zimmer_seen") || "[]");

    S.stories.forEach((story, i) => {
      const node = el("button", "story" + (seen.includes(story.id) ? " seen" : ""));
      node.innerHTML = `
        <div class="story-ring">
          <div class="story-face" style="background:linear-gradient(150deg,${esc(story.color_from)},${esc(
        story.color_to
      )})">${esc(story.emoji)}</div>
        </div>
        <span class="story-label">${esc(story.title)}</span>`;
      node.onclick = () => openStory(i);
      box.append(node);
    });
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

    const bars = $("story-bars");
    bars.innerHTML = S.stories
      .map((_, i) => `<i class="${i < S.storyIndex ? "done" : i === S.storyIndex ? "active" : ""}"><b></b></i>`)
      .join("");

    $("story-inner").innerHTML = `
      <div class="story-bg" style="background:linear-gradient(160deg,${esc(story.color_from)},${esc(
      story.color_to
    )} 75%, #000)"></div>
      <div class="story-emoji">${esc(story.emoji)}</div>
      <div class="story-h">${esc(story.heading || story.title)}</div>
      <div class="story-b">${esc(story.body || "")}</div>`;

    const seen = JSON.parse(localStorage.getItem("zimmer_seen") || "[]");
    if (!seen.includes(story.id)) {
      seen.push(story.id);
      localStorage.setItem("zimmer_seen", JSON.stringify(seen));
    }

    clearTimeout(S.storyTimer);
    S.storyTimer = setTimeout(() => stepStory(1), 5000);
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
    $("story-view").classList.add("hidden");
    renderStories();
  }

  /* -------------------------------------------------------------- banners */
  function renderBanners() {
    const box = $("banners");
    const dots = $("banner-dots");
    box.innerHTML = "";
    dots.innerHTML = "";
    const list = S.home.banners || [];

    list.forEach((b, i) => {
      const node = el("div", "banner");
      node.style.background = `linear-gradient(135deg,${b.color_from},${b.color_to})`;
      node.innerHTML = `
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

    box.onscroll = () => {
      const idx = Math.round(box.scrollLeft / (box.clientWidth - 24));
      [...dots.children].forEach((d, i) => d.classList.toggle("on", i === idx));
    };

    clearInterval(S.bannerTimer);
    if (list.length > 1) {
      S.bannerTimer = setInterval(() => {
        if (S.page !== "home") return;
        const step = box.clientWidth - 24;
        const next = box.scrollLeft + step >= box.scrollWidth - 10 ? 0 : box.scrollLeft + step;
        box.scrollTo({ left: next, behavior: "smooth" });
      }, 4800);
    }
  }

  function renderPromos() {
    const box = $("promos");
    box.innerHTML = "";
    (S.home.promos || []).forEach((p) => {
      const node = el("div", "promo");
      node.innerHTML = `
        ${p.discount ? `<span class="promo-badge">${esc(p.discount)}</span>` : ""}
        <b>${esc(p.title)}</b>
        <p>${esc(p.text || "")}</p>`;
      box.append(node);
    });
    $("promos-sec").classList.toggle("hidden", !(S.home.promos || []).length);
  }

  /* ------------------------------------------------------------- mahsulotlar */
  function renderCatalog() {
    const cats = S.home.catalog || [];
    const chips = $("cats");
    chips.innerHTML = "";
    if (S.catIndex >= cats.length) S.catIndex = 0;

    cats.forEach((c, i) => {
      const chip = el("button", "chip" + (i === S.catIndex ? " on" : ""));
      chip.textContent = `${c.icon || "🛍"} ${c.name}`;
      chip.onclick = () => {
        S.catIndex = i;
        haptic();
        renderCatalog();
      };
      chips.append(chip);
    });

    const box = $("products");
    box.innerHTML = "";
    const products = cats[S.catIndex] ? cats[S.catIndex].products : [];
    $("products-empty").classList.toggle("hidden", products.length > 0);
    $("catalog-sec").classList.toggle("hidden", !cats.length);

    products.forEach((p, i) => {
      const card = el("div", "prod");
      card.style.animationDelay = i * 0.05 + "s";
      // rasm tashqi manzildan (Firebase/sayt) yoki Telegram'dan kelishi mumkin
      const photo = p.photo_url
        ? p.photo_external || /^https?:\/\//.test(p.photo_url)
          ? p.photo_url
          : API + p.photo_url
        : null;
      const art = photo ? `<img src="${esc(photo)}" alt="" loading="lazy">` : "💡";
      card.innerHTML = `
        <div class="prod-art">${art}${p.badge ? `<span class="prod-badge">${esc(p.badge)}</span>` : ""}</div>
        <div class="prod-body">
          <div class="prod-name">${esc(p.name)}</div>
          ${p.car_id ? '<div class="prod-fit">✓ Mashinangizga mos</div>' : ""}
          <div class="prod-price">${esc(p.price_label)}
            ${p.old_price_label ? `<span class="prod-old">${esc(p.old_price_label)}</span>` : ""}
          </div>
        </div>`;
      const btn = el("button", "prod-add", p.stock > 0 ? "➕ Savatchaga" : "Tugagan");
      btn.disabled = p.stock < 1;
      btn.onclick = () => {
        addToCart(p);
        btn.classList.add("added");
        btn.textContent = "✓ Qo'shildi";
        setTimeout(() => {
          btn.classList.remove("added");
          btn.textContent = "➕ Savatchaga";
        }, 1200);
      };
      card.append(btn);
      box.append(card);
    });
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
      });
    saveCart();
    haptic();
  }

  /* ------------------------------------------------------------- navbat */
  function renderBookCard() {
    const box = $("book-body");
    box.innerHTML = `
      <div class="book-line"><span>Bi-LED o'rnatish</span><b>2–3 soat</b></div>
      <div class="book-line"><span>Kafolat</span><b>1 yil</b></div>
      <button class="btn btn-primary btn-sm" id="book-open" style="width:100%;margin-top:10px">
        🗓 Navbat olish
      </button>`;
    $("book-open").onclick = openBookingSheet;
  }

  /* -------------------------------------------------------------- savatcha */
  function renderCart() {
    const box = $("cart-items");
    box.innerHTML = "";
    const empty = S.cart.length === 0;
    $("cart-empty").classList.toggle("hidden", !empty);
    $("cart-checkout").classList.toggle("hidden", empty);

    S.cart.forEach((item) => {
      const row = el("div", "card");
      row.innerHTML = `
        <div class="row" style="align-items:flex-start">
          <div>
            <b>${esc(item.name)}</b>
            <div class="item-sub">${esc(fmt(item.price))} × ${item.qty} = <b>${esc(
        fmt(item.price * item.qty)
      )}</b></div>
          </div>
        </div>`;
      const qty = el("div", "qty");
      const minus = el("button", null, "−");
      const plus = el("button", null, "+");
      const del = el("button", null, "🗑");
      minus.onclick = () => changeQty(item.id, -1);
      plus.onclick = () => changeQty(item.id, 1);
      del.onclick = () => {
        S.cart = S.cart.filter((i) => i.id !== item.id);
        saveCart();
        renderCart();
      };
      qty.append(minus, el("span", null, String(item.qty)), plus, del);
      row.append(qty);
      box.append(row);
    });

    $("cart-total").textContent = fmt(cartSum());
    if (S.me && S.me.phone && !$("order-phone").value) $("order-phone").value = S.me.phone;
  }

  function changeQty(id, delta) {
    const item = S.cart.find((i) => i.id === id);
    if (!item) return;
    if (delta > 0 && item.qty + 1 > item.stock) return toast(`Omborda ${item.stock} dona bor`);
    item.qty += delta;
    if (item.qty < 1) S.cart = S.cart.filter((i) => i.id !== id);
    saveCart();
    renderCart();
  }

  function submitOrder() {
    const address = $("order-address").value.trim();
    if (address.length < 5) return toast("Manzilni to'liqroq yozing");
    if (!S.cart.length) return toast("Savatcha bo'sh");

    return withPhone(async () => {
      const btn = $("order-submit");
      btn.disabled = true;
      btn.textContent = "Yuborilmoqda...";
      try {
        const res = await api("/api/orders", {
          method: "POST",
          body: {
            items: S.cart.map((i) => ({ product_id: i.id, qty: i.qty })),
            address,
            phone: $("order-phone").value.trim() || (S.me && S.me.phone) || "",
          },
        });
        S.cart = [];
        saveCart();
        renderCart();
        $("order-address").value = "";
        haptic("ok");
        burst();
        toast(`✅ Buyurtma #${res.order.id} qabul qilindi`, 3400);
        show("profile");
      } finally {
        btn.disabled = false;
        btn.textContent = "Buyurtma berish";
      }
    });
  }

  /* --------------------------------------------------------------- kabinet */
  async function loadProfile() {
    if (S.me) {
      $("profile-name").textContent = S.me.full_name || "—";
      $("profile-phone").textContent = S.me.phone || "kiritilmagan";
      $("profile-car").textContent = S.me.car ? `${S.me.car.name} (${S.me.car.years || "-"})` : "—";
      renderPhoneWarn();
    }
    try {
      const [biled, bookings, orders] = await Promise.all([
        api("/api/biled-orders"),
        api("/api/bookings"),
        api("/api/orders"),
      ]);
      renderBiledOrders(biled);
      renderBookings(bookings);
      renderOrders(orders);
    } catch (err) {
      onError(err);
    }
  }

  function renderBiledOrders(list) {
    const box = $("my-biled");
    box.innerHTML = "";
    $("biled-empty").classList.toggle("hidden", list.length > 0);
    list.forEach((o) => {
      const card = el("div", "card");
      card.innerHTML = `
        <div class="row">
          <b>#${o.id} · ${esc(o.car_name)}</b>
          <span class="status ${esc(o.status)}">${esc(o.status_label)}</span>
        </div>
        <div class="item-sub">${esc(o.summary)}</div>
        <div class="row"><span>Jami</span><b>${esc(o.total_label)}</b></div>`;
      box.append(card);
    });
  }

  function renderBookings(list) {
    const box = $("my-bookings");
    box.innerHTML = "";
    $("bookings-empty").classList.toggle("hidden", list.length > 0);
    list.forEach((b) => {
      const card = el("div", "card");
      card.innerHTML = `
        <div class="row">
          <b>#${b.id} · ${esc(b.service_name)}</b>
          <span class="status ${esc(b.status)}">${esc(b.status_label)}</span>
        </div>
        <div class="item-sub">📅 ${esc(b.date_label)} · 🕐 <b>${esc(b.time)}</b></div>`;
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
      const card = el("div", "card");
      card.innerHTML = `
        <div class="row">
          <b>#${o.id} · ${esc(o.total_label)}</b>
          <span class="status ${esc(o.status)}">${esc(o.status_label)}</span>
        </div>
        <div class="item-sub">🛍 ${goods}</div>`;
      box.append(card);
    });
  }

  /* ----------------------------------------------------------------- sheet */
  function openSheet(title, html) {
    $("sheet-title").textContent = title;
    $("sheet-content").innerHTML = html;
    $("sheet").classList.remove("hidden");
  }
  function closeSheet() {
    $("sheet").classList.add("hidden");
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
        const node = el("button", "opt");
        node.innerHTML = `
          <div class="opt-icon">🔧</div>
          <div class="opt-main">
            <div class="opt-name">${esc(s.name)}</div>
            <div class="opt-meta"><span>⏱ ${s.duration_min} daqiqa</span></div>
            <div class="opt-price">${esc(s.price_label)}</div>
          </div>`;
        node.onclick = () => pickBookingService(s);
        box.append(node);
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
      const wrap = el("div");
      const chips = el("div", "chips");
      days.forEach((d) => {
        const chip = el("button", "chip");
        chip.innerHTML = `${esc(d.short_label)}${
          d.free_count ? "" : " ·  band"
        }`;
        chip.disabled = !d.free_count;
        chip.onclick = () => pickBookingDate(d);
        chips.append(chip);
      });
      wrap.append(chips);
      $("sheet-content").innerHTML = "";
      $("sheet-content").append(wrap);
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
    }

    if (!tg || !tg.initData) {
      gate("Ilovani Telegram ichidan oching — botga /start yuborib «🚀 Ilovani ochish» tugmasini bosing.");
      return;
    }

    saveCart();

    try {
      const [cfg, me] = await Promise.all([api("/api/config"), api("/api/me")]);
      S.currency = cfg.currency || "so'm";
      S.me = me;
      // Ro'yxatdan o'tish to'sig'i YO'Q: foydalanuvchi initData asosida
      // avtomatik yaratiladi, telefon esa faqat buyurtmada so'raladi.
      renderPhoneWarn();

      const name = (me.full_name || me.first_name || "").split(" ")[0];
      $("splash-hello").innerHTML = `
        <h1>Assalomu alaykum${name ? ", " + esc(name) : ""}! 👋</h1>
        <p>Faralaringizni Bi-LED bilan yangilaymiz</p>`;

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

    $("splash-start").onclick = async () => {
      haptic("medium");
      if (S.car) {
        show("home");
        await loadHome();
      } else {
        await openFlow();
      }
    };
  }

  /* ------------------------------------------------------------- hodisalar */
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
    if (S.step === 3 && !S.shroud) return toast("Ochki turini tanlang");
    if (S.step === 4 && !S.color) return toast("Optika rangini tanlang");
    if (S.step === STEPS.length) return submitConfig();
    haptic();
    setStep(S.step + 1);
  };
  $("flow-back").onclick = () => setStep(S.step - 1);
  $("flow-close").onclick = () => {
    if (S.me && S.me.car) {
      show("home");
      if (!S.home) loadHome();
    } else {
      toast("Avval mashinangizni tanlang");
    }
  };

  $("config-cta").onclick = openFlow;
  $("car-chip").onclick = openCarSheet;
  $("change-car").onclick = openCarSheet;
  $("order-submit").onclick = submitOrder;

  $("sheet-close").onclick = closeSheet;
  $("sheet-backdrop").onclick = closeSheet;

  $("story-close").onclick = closeStory;
  $("story-prev").onclick = () => stepStory(-1);
  $("story-next").onclick = () => stepStory(1);

  $("gate-close").onclick = () => (tg ? tg.close() : window.close());
  $("gate-retry").onclick = () => location.reload();

  boot();
})();
