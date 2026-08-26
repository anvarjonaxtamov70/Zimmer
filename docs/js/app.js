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
    rings: [], // halqalar (kategoriyalar)
    ringIndex: 0, // joriy halqa
    stories: [], // joriy halqa ichidagi elementlar
    storyIndex: 0,
    storyTimer: null,
    storyRaf: 0, // requestAnimationFrame id (progress chizig'i)
    storyDuration: 5000,
    storyPassed: 0,
    storyPaused: false,
    storyVideo: null, // joriy video elementi
    storyMuted: true, // ovoz holati (birinchi ochilishda ovozsiz)
    bannerTimer: null,
    booking: { service: null, date: null },
    delivery: null, // {method, address, summary}
    dlvMethod: null, // tanlangan usul (tasdiqlashdan oldin)
    pay: {}, // karta rekvizitlari (/api/config dan)
    // Zaxira rejim: server javob bermaydi, katalog Firebase'dan o'qilgan.
    // Bu holatda faqat KO'RISH mumkin — buyurtma/navbat bloklanadi.
    offline: false,
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
    // Animatsiya tugagach klass olib tashlanadi (0.16s kechikish + 0.34s)
    clearTimeout(enterHome._t);
    enterHome._t = setTimeout(() => home.classList.remove("entering"), 600);
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
    const colors = ["#ff2d3a", "#ffffff", "#ff8a3d", "#e01020", "#d4a853", "#2fd45f"];
    for (let i = 0; i < 42; i++) {
      const p = el("i");
      p.style.left = Math.random() * 100 + "%";
      p.style.background = colors[i % colors.length];
      p.style.animationDelay = Math.random() * 0.5 + "s";
      p.style.width = (4 + Math.random() * 5) + "px";
      p.style.height = (8 + Math.random() * 8) + "px";
      box.append(p);
    }
    setTimeout(() => {
      box.classList.add("hidden");
      box.innerHTML = "";
    }, 2800);
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

  /** Yuklanish vaqtida typing dots ko'rsatish */
  function loadingDots(box) {
    var wrap = el("div", "loading-dots-wrap");
    var dots = el("span", "typing-dots", "<i></i><i></i><i></i>");
    wrap.append(dots);
    box.innerHTML = "";
    box.append(wrap);
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
        "Ilovani yopib, botdagi «🛍 Do'konni ochish» tugmasi orqali " +
          "qaytadan oching.",
        "Sessiya eskirgan",
        "🔄"
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
        // Zaxira rejimda profil Worker orqali Firebase'ga yoziladi.
        // Bot ko'tarilganda `sync.restore_users()` uni SQLite ga tiklaydi —
        // ya'ni Render o'chgan paytda ro'yxatdan o'tgan mijoz YO'QOLMAYDI.
        const res = S.offline
          ? await saveProfileOffline(fullName, value)
          : await api("/api/register", {
              method: "POST",
              body: { full_name: fullName, phone: value },
            });
        S.me.full_name = res.full_name;
        S.me.phone = res.phone;
        S.me.needs_phone = false;
        if (S.offline) saveMe(S.me);
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

  /** Zaxira rejimda profilni Worker orqali saqlaydi.
      `/api/register` javobining shakliga moslab qaytaradi. */
  async function saveProfileOffline(fullName, phone) {
    if (!window.ZimmerOffline || !ZimmerOffline.workerReady()) {
      throw { code: "no_worker", message: "Server javob bermayapti — keyinroq urinib ko'ring" };
    }
    const res = await ZimmerOffline.saveProfile({
      full_name: fullName,
      phone: phone,
      car_id: S.me && S.me.car ? S.me.car.id : null,
      car_name: S.me && S.me.car ? S.me.car.name : null,
    });
    return {
      full_name: (res.profile && res.profile.name) || fullName,
      phone: (res.profile && res.profile.phone) || phone,
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
    // Aqlli badge: son o'zgarganda "pulse" + "bounce" (Avto_A1 mantiqi)
    if (n > 0) {
      b.classList.remove("hidden");
      b.classList.remove("pulse", "bounce");
      void b.offsetWidth; // reflow — animatsiya qayta ishga tushsin
      b.classList.add("pulse", "bounce");
    } else {
      b.classList.add("hidden");
      b.classList.remove("pulse", "bounce");
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
    // Boshqaruv paneli Render'dagi `/api/admin/*` ni talab qiladi. Zaxira
    // rejimda uni ochsak har bir so'rov xato beradi — shuning uchun sababni
    // ochiq aytamiz. Admin BARIBIR tanilgan bo'ladi (tugma ko'rinadi),
    // faqat panel ishlamaydi.
    if (page === "admin" && S.offline) {
      offlineBlocked("Boshqaruv paneli");
      return;
    }
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

  /** To'siq ekrani — OXIRGI CHORA.
   *
   *  Ilgari HTML'da sarlavha qattiq «Ro'yxatdan o'tish kerak» deb yozilgan
   *  edi va bu funksiya faqat pastdagi matnni almashtirardi. Shuning uchun
   *  server o'chganda ham mijoz «Ro'yxatdan o'tish kerak» degan YOLG'ON
   *  xabarni ko'rardi — u allaqachon ro'yxatdan o'tgan bo'lsa ham.
   *
   *  Endi sarlavha va belgi ham shu yerdan beriladi.
   */
  function gate(text, title, icon) {
    if (text) $("gate-text").textContent = text;
    const t = $("gate-title");
    // Standart sarlavha ATAYLAB betaraf: bu ekran endi faqat ikki holatda
    // chiqadi (Telegram tashqarisida ochilgan / imzo eskirgan) va ikkisi ham
    // o'z sarlavhasini beradi. Ilgari sarlavha qattiq «Ro'yxatdan o'tish
    // kerak» edi va har xato uchun YOLG'ON gapirardi.
    if (t) t.textContent = title || "Bir lahza…";
    const ic = $("gate-icon");
    if (ic) ic.textContent = icon || "⏳";
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

    // Zaxira rejimda tanlov serverga yozilmaydi — lekin ekranda ishlaydi,
    // shunda mijoz mashinasiga mos tovarlarni ko'ra oladi.
    if (S.offline) {
      if (S.me) S.me.car = { id: car.id, name: car.name, years: car.years };
      $("car-chip-name").textContent = car.name;
    } else {
      try {
        await api("/api/me/car", { method: "POST", body: { car_id: car.id } });
        if (S.me) S.me.car = { id: car.id, name: car.name, years: car.years };
        $("car-chip-name").textContent = car.name;
      } catch (err) {
        onError(err);
      }
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
      if (S.offline) return offlineBlocked("Bi-LED buyurtmasi");
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
     ZAXIRA (OFFLINE) REJIM

     Render bepul tarifda uxlaydi yoki oylik kvota tugasa butunlay to'xtaydi.
     Ilgari o'sha payt ilova "Server javob bermadi" ekranida qotib qolardi.

     Endi katalog to'g'ridan-to'g'ri Firebase'dan o'qiladi (bot uni doim
     ko'chirib turadi) — Avto_A1 dagi kabi: server o'chsa ham do'kon ishlaydi.

     Nima ISHLAYDI: katalog, mahsulot kartochkasi va modali, qidirish,
     savat, saqlanganlar (mahalliy), bannerlar, stories, mashinalar ro'yxati.
     Nima ISHLAMAYDI: buyurtma, navbat, profil o'zgartirish — ular ombor
     kamaytirish va adminga xabar berishni talab qiladi, ya'ni serversiz
     bajarilsa ma'lumot buziladi. Ular bloklanadi va sabab aytiladi.
     ====================================================================== */

  const OFFLINE_KEY = "zimmer_offline_favorites";

  /** Zaxira rejimga o'tishga harakat qiladi. true — muvaffaqiyatli. */
  async function enterOfflineMode() {
    if (!window.ZimmerOffline || !ZimmerOffline.available()) {
      console.warn("[offline] FIREBASE_DB_URL sozlanmagan — zaxira rejim o'chiq.");
      return false;
    }
    // Katalogni HOZIR o'qib ko'ramiz: o'qilmasa zaxira rejimning ma'nosi yo'q
    // (bo'sh do'kon ko'rsatgandan ko'ra aniq xato yaxshiroq).
    const probe = await ZimmerOffline.home();
    if (!probe) return false;

    S.offline = true;
    S.home = probe; // ikkinchi marta so'ramaymiz — `loadHome()` shuni ishlatadi
    console.warn("[offline] Server javob bermadi — katalog Firebase'dan o'qildi.");
    scheduleServerRecheck();
    return true;
  }

  /** `/api/config` javobining zaxirasi (config.js dagi qiymatlardan). */
  function offlineConfig() {
    const c = window.ZIMMER_CONFIG || {};
    return {
      currency: c.CURRENCY || "so'm",
      pay_card_number: "",
      pay_card_holder: "",
      pay_admin_username: c.SHOP_TELEGRAM || "",
      delivery_city: "Toshkent",
    };
  }

  /** `/api/me` javobining zaxirasi.
   *
   *  MIJOZNI TANIB QOLISH: oxirgi MUVAFFAQIYATLI `/api/me` javobi keshlanadi
   *  (`saveMe()`), shuning uchun server o'chganda ham mijozning ismi,
   *  telefoni va tanlagan mashinasi eslanadi — u o'zini "notanish" his
   *  qilmaydi. Kesh bo'lmasa Telegram bergan ismga tushamiz.
   *
   *  XAVFSIZLIK: `is_admin` keshdan olinadi, lekin bu HUQUQ BERMAYDI —
   *  barcha `/api/admin/*` so'rovlari serverda imzo bilan qayta
   *  tekshiriladi. Kesh faqat «Boshqaruv» tugmasini ko'rsatish uchun.
   */
  const ME_KEY = "zimmer_me_cache";

  function saveMe(me) {
    if (!me || !me.id) return;
    try {
      localStorage.setItem(ME_KEY, JSON.stringify({ at: Date.now(), me: me }));
    } catch (_) {}
  }

  function cachedMe() {
    try {
      const raw = JSON.parse(localStorage.getItem(ME_KEY) || "null");
      return raw && raw.me && raw.me.id ? raw.me : null;
    } catch (_) {
      return null;
    }
  }

  /** Zaxira rejimda mijozni Worker orqali TANIB olamiz.
   *
   *  Bu `offlineMe()` dan kuchliroq: Worker `initData` imzosini tekshirib,
   *  Firebase'dagi HAQIQIY profilni (ism, telefon, mashina) va buyurtma
   *  tarixini qaytaradi. Ya'ni mijoz boshqa telefondan kirsa ham tanilaadi
   *  — localStorage keshi esa faqat shu qurilmada ishlaydi.
   */
  async function offlineMeFromWorker() {
    if (!window.ZimmerOffline || !ZimmerOffline.workerReady()) return null;
    try {
      const res = await ZimmerOffline.me();
      if (res && res.me) {
        S.offlineOrders = res.orders || [];
        saveMe(res.me); // keyingi safar tarmoqsiz ham tanilsin
        return res.me;
      }
    } catch (err) {
      console.warn("[offline] /me olinmadi:", err && err.message);
    }
    return null;
  }

  function offlineMe() {
    const u = (tg && tg.initDataUnsafe && tg.initDataUnsafe.user) || {};
    const saved = cachedMe();
    // Kesh AYNI SHU foydalanuvchiga tegishli bo'lsagina ishlatiladi
    if (saved && (!u.id || String(saved.id) === String(u.id))) return saved;
    return {
      id: u.id || 0,
      first_name: u.first_name || "",
      full_name: [u.first_name, u.last_name].filter(Boolean).join(" "),
      phone: null,
      car: null,
      is_admin: false,
    };
  }

  /** Saqlanganlar — zaxira rejimda faqat mahalliy xotirada. */
  function localFavorites() {
    try {
      const raw = JSON.parse(localStorage.getItem(OFFLINE_KEY) || "[]");
      return Array.isArray(raw) ? raw : [];
    } catch (_) {
      return [];
    }
  }

  function saveLocalFavorites() {
    try {
      localStorage.setItem(OFFLINE_KEY, JSON.stringify([...(S.favorites || [])]));
    } catch (_) {}
  }

  /** Zaxira rejimda serverni talab qiladigan amal bosilganda. */
  function offlineBlocked(what) {
    const c = window.ZIMMER_CONFIG || {};
    const lines = [
      `${what} uchun server kerak, u hozir javob bermayapti.`,
      "",
      "Katalogni ko'rishda davom etishingiz mumkin — server tiklanganda",
      "ilova o'zi to'liq rejimga o'tadi.",
    ];
    if (c.SHOP_TELEGRAM) lines.push("", `Telegram: @${c.SHOP_TELEGRAM}`);
    if (c.SHOP_PHONE) lines.push(`Telefon: ${c.SHOP_PHONE}`);
    openSheet("⏳ Server uyg'onmoqda", `<p class="step-sub">${esc(lines.join("\n"))}</p>`);
    haptic("warning");
  }

  /** Yuqorida turadigan ogohlantiruv chizig'i. */
  function renderOfflineBar() {
    let bar = $("offline-bar");
    if (!S.offline) {
      if (bar) bar.remove();
      return;
    }
    if (bar) return;
    // Kesh nusxasi eskirgan bo'lishi mumkin — mijozga rostini aytamiz.
    const stale = S.home && S.home._cached;
    bar = el(
      "div",
      "offline-bar",
      stale
        ? "⏳ Server uyg'onmoqda — saqlangan katalog ko'rsatilyapti, narxlar o'zgargan bo'lishi mumkin"
        : "⏳ Server uyg'onmoqda — katalog ko'rish mumkin, buyurtma vaqtincha ishlamaydi"
    );
    bar.id = "offline-bar";
    document.body.appendChild(bar);
  }

  /** Fonda serverni tekshirib turadi; tiklansa to'liq rejimga o'tadi.
      Render "sovuq start" 30–60 soniya oladi, shuning uchun har 20 soniyada. */
  function scheduleServerRecheck() {
    if (S._recheck) return;
    S._recheck = setInterval(async () => {
      try {
        const res = await fetch(API + "/health", { cache: "no-store" });
        if (!res.ok) return;
      } catch (_) {
        return;
      }
      clearInterval(S._recheck);
      S._recheck = null;
      S.offline = false;
      renderOfflineBar();
      toast("✅ Server tiklandi — to'liq rejim");
      try {
        S.me = await api("/api/me");
        S.home = null; // zaxira nusxa emas, serverdan yangisi olinsin
        await loadHome();
      } catch (_) {
        // Tiklanish yarim qolsa — mijoz ilovani qayta ochsa to'liq yuklanadi
      }
    }, 20000);
  }

  /* ======================================================================
     ASOSIY MENYU
     ====================================================================== */

  async function loadHome() {
    if (!$("products").children.length) {
      $("products").innerHTML = '<div class="skel"></div><div class="skel"></div>';
    }
    try {
      if (S.offline) {
        // Zaxira rejim: katalog Firebase'dan. Shakl `/api/home` bilan bir xil,
        // shuning uchun pastdagi render kodi umuman o'zgarmaydi.
        //
        // `enterOfflineMode()` katalogni allaqachon o'qib qo'ygan (zaxira
        // rejimga o'tish mumkinligini tekshirish uchun) — uni QAYTA
        // SO'RAMAYMIZ, aks holda kirishda ikki marta tarmoqqa chiqilardi.
        if (!S.home) S.home = await ZimmerOffline.home();
        // Zanjirning hech biri ishlamasa ham YIQILMAYMIZ: bo'sh katalog
        // bilan davom etamiz. Ilgari bu yerda xato ko'tarilib, mijoz
        // to'siq ekraniga tushardi — ilovaning ochilishi ancha yaxshi.
        if (!S.home) S.home = EMPTY_HOME;
      } else {
        S.home = await api("/api/home");
      }
      S.favorites = new Set(
        S.offline ? localFavorites() : S.home.favorite_ids || []
      );
      // Katalogni keshlaymiz — bu 3-QATLAM zaxira. Server ham, Firebase ham
      // javob bermasa, BIR MARTA kirgan mijoz baribir do'konni ko'radi va
      // to'siq ekraniga TUSHMAYDI.
      if (window.ZimmerOffline && !S.offline) ZimmerOffline.save(S.home);

      S.shopProducts = buildShopProducts(); // kategoriyasiz, random tartib
      renderOfflineBar();
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
      // Zaxira rejimda xato bo'lsa ilovani YIQITMAYMIZ — bo'sh katalog
      // ko'rsatib, sababni pastdagi chiziqda aytamiz.
      if (S.offline) {
        console.error("[offline] loadHome xatosi:", err);
        S.home = EMPTY_HOME;
        S.favorites = new Set(localFavorites());
        S.shopProducts = [];
        renderOfflineBar();
        renderCatalog();
        return;
      }
      onError(err);
    }
  }

  /** Ma'lumot topilmaganda ishlatiladigan bo'sh, LEKIN TO'G'RI SHAKLDAGI javob.
      Render kodi `banners`, `stories`, `catalog` massivlarini kutadi — null
      bo'lsa yiqilardi. */
  const EMPTY_HOME = {
    car_id: null,
    banners: [],
    stories: [],
    catalog: [],
    favorite_ids: [],
    _offline: true,
    _empty: true,
  };

  /* ------------------------------------------------------------- stories */
  /** Ko'rilgan elementlar ro'yxati (id bo'yicha). */
  const seenList = () => {
    try {
      const raw = JSON.parse(localStorage.getItem("zimmer_seen") || "[]");
      return Array.isArray(raw) ? raw : [];
    } catch (_) {
      return [];
    }
  };

  /** HALQALAR (kategoriyalar): bitta doira ichida bir nechta element.
      Hammasi ko'rilgan bo'lsa halqa xiralashadi (Avto_A1 kabi). */
  function renderStories() {
    S.rings = (S.home && S.home.stories) || [];
    const box = $("stories");
    box.innerHTML = "";
    const seen = seenList();

    S.rings.forEach((ring, i) => {
      const items = ring.items || [];
      const allSeen = items.length > 0 && items.every((it) => seen.includes(it.id));
      const node = el("button", "story" + (allSeen ? " seen" : ""));
      // Halqa yuzida birinchi elementning rasmi (bo'lsa), aks holda emoji
      const cover = abs((items[0] && items[0].photo_url) || null);
      node.innerHTML = `
        <div class="story-ring">
          <div class="story-face" style="background:linear-gradient(150deg,${esc(
            ring.color_from
          )},${esc(ring.color_to)})">${cover ? img(cover) : esc(ring.emoji)}</div>
          ${items.length > 1 ? `<i class="story-count">${items.length}</i>` : ""}
        </div>
        <span class="story-label">${esc(ring.title)}</span>`;
      node.onclick = () => openStory(i);
      box.append(node);
    });
    // Birorta ham story bo'lmasa — qator umuman ko'rinmaydi (toza ko'rinish)
    box.classList.toggle("hidden", !S.rings.length);
  }

  /** Halqani ochadi: ichidagi elementlar ketma-ket o'ynaydi. */
  function openStory(ringIndex, itemIndex) {
    if (!S.rings.length) return;
    S.ringIndex = Math.max(0, Math.min(S.rings.length - 1, ringIndex));
    S.storyIndex = itemIndex || 0;
    S.stories = (S.rings[S.ringIndex] && S.rings[S.ringIndex].items) || [];
    if (!S.stories.length) return;
    $("story-view").classList.remove("hidden");
    haptic();
    paintStory();
  }

  /* ---------------------------------------------------- story: progress (rAF)
     Chiziq video DAVOMIYLIGIGA moslashadi (Avto_A1 mantiqi): rasm — 5s,
     video — o'zining uzunligi. Bosib turilsa pauza qiladi. */
  function animateStoryProgress(fill, ms) {
    cancelAnimationFrame(S.storyRaf);
    S.storyDuration = ms;
    S.storyPassed = 0;
    S.storyPaused = false;
    let last = Date.now();

    function step() {
      if (S.storyPaused) {
        last = Date.now();
        S.storyRaf = requestAnimationFrame(step);
        return;
      }
      const now = Date.now();
      S.storyPassed += now - last;
      last = now;
      const percent = (S.storyPassed / S.storyDuration) * 100;
      if (percent >= 100) {
        if (fill) fill.style.width = "100%";
        // Video o'zining `ended` hodisasi bilan o'tadi — ikki marta o'tmaymiz
        if (!S.storyVideo) stepStory(1);
        return;
      }
      if (fill) fill.style.width = percent + "%";
      S.storyRaf = requestAnimationFrame(step);
    }
    S.storyRaf = requestAnimationFrame(step);
  }

  /** Keyingi storyni fonda yuklab qo'yadi — silliq o'tishi uchun. */
  function preloadNextStory() {
    const next = S.stories[S.storyIndex + 1];
    if (!next) return;
    const photo = abs(next.photo_url);
    const video = abs(next.video_url);
    if (video) {
      const v = document.createElement("video");
      v.preload = "auto";
      v.muted = true;
      v.src = video;
    } else if (photo) {
      const i = new Image();
      i.src = photo;
    }
  }

  function releaseStoryVideo() {
    if (!S.storyVideo) return;
    try {
      S.storyVideo.pause();
      S.storyVideo.removeAttribute("src");
      S.storyVideo.load();
    } catch (_) {}
    S.storyVideo = null;
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
    const bars = $("story-bars").children;
    const fill = bars[S.storyIndex] ? bars[S.storyIndex].querySelector("b") : null;

    cancelAnimationFrame(S.storyRaf);
    clearTimeout(S.storyTimer);
    releaseStoryVideo();

    const photo = abs(story.photo_url);
    const video = abs(story.video_url);
    const inner = $("story-inner");
    const soundBtn = $("story-sound");
    const saveBtn = $("story-save");

    // Ovoz tugmasi faqat videoda; yuklab olish faqat media bo'lsa
    if (soundBtn) soundBtn.classList.toggle("hidden", !video);
    if (saveBtn) saveBtn.classList.toggle("hidden", !(video || photo));
    // 🗑 faqat adminga ko'rinadi
    const delBtn = $("story-del");
    if (delBtn) delBtn.classList.toggle("hidden", !(S.me && S.me.is_admin));

    if (video) {
      inner.innerHTML = `
        <div class="story-bg" style="background:#000">
          <video id="story-video" class="loading" playsinline webkit-playsinline
                 preload="auto" autoplay ${S.storyMuted ? "muted" : ""}
                 ${photo ? `poster="${esc(photo)}"` : ""}
                 src="${esc(video)}"></video>
        </div>
        <div class="story-spinner" id="story-spinner"></div>
        <div class="story-buffer show" id="story-buffer"><i></i></div>
        <div class="story-shade"></div>
        <div class="story-h">${esc(story.heading || "")}</div>
        <div class="story-b">${esc(story.body || "")}</div>`;

      const node = $("story-video");
      S.storyVideo = node;
      const spinner = $("story-spinner");
      const buffer = $("story-buffer");
      const bufferFill = buffer ? buffer.firstElementChild : null;
      if (soundBtn) soundBtn.textContent = S.storyMuted ? "🔇" : "🔊";

      // Autoplay kafolati: bloklansa — ovozsiz qilib qayta urinamiz
      const safePlay = () => {
        if (!S.storyVideo) return;
        const p = S.storyVideo.play();
        if (p && typeof p.catch === "function") {
          p.catch(() => {
            try {
              S.storyVideo.muted = true;
              S.storyMuted = true;
              if (soundBtn) soundBtn.textContent = "🔇";
              S.storyVideo.play().catch(() => {});
            } catch (_) {}
          });
        }
      };

      node.addEventListener("progress", () => {
        try {
          if (node.buffered.length && node.duration) {
            const end = node.buffered.end(node.buffered.length - 1);
            const pct = Math.min(100, (end / node.duration) * 100);
            if (bufferFill) bufferFill.style.width = pct + "%";
          }
        } catch (_) {}
      });

      node.addEventListener(
        "loadedmetadata",
        () => {
          const ms = (node.duration && isFinite(node.duration) ? node.duration : 9) * 1000;
          animateStoryProgress(fill, ms);
          if (node.paused) safePlay();
        },
        { once: true }
      );

      node.addEventListener(
        "canplay",
        () => {
          if (spinner) spinner.style.display = "none";
          node.classList.remove("loading");
          if (node.paused) safePlay();
        },
        { once: true }
      );

      node.addEventListener("waiting", () => {
        if (spinner) spinner.style.display = "flex";
        node.classList.add("loading");
      });
      node.addEventListener("playing", () => {
        if (spinner) spinner.style.display = "none";
        node.classList.remove("loading");
        if (buffer) setTimeout(() => buffer.classList.remove("show"), 1200);
      });
      node.addEventListener("ended", () => stepStory(1));
      node.addEventListener("error", () => {
        toast("Video yuklanmadi");
        setTimeout(() => stepStory(1), 600);
      });
    } else {
      const bg = photo ? `<img src="${esc(photo)}" alt="">` : "";
      inner.innerHTML = `
        <div class="story-bg" style="background:linear-gradient(160deg,${esc(
          story.color_from
        )},${esc(story.color_to)} 75%, #000)">${bg}</div>
        <div class="story-shade"></div>
        ${!bg ? `<div class="story-emoji">${esc(story.emoji)}</div>` : ""}
        <div class="story-h">${esc(story.heading || "")}</div>
        <div class="story-b">${esc(story.body || "")}</div>`;
      animateStoryProgress(fill, 5000);
    }

    // Bo'lim nomi tepada ko'rinadi (qaysi halqada turganini bildiradi)
    const ring = S.rings[S.ringIndex];
    const badge = $("story-cat");
    if (badge && ring) {
      badge.innerHTML = `${esc(ring.emoji)} ${esc(ring.title)}${
        S.stories.length > 1 ? ` · ${S.storyIndex + 1}/${S.stories.length}` : ""
      }`;
      badge.classList.remove("hidden");
    }

    const seen = seenList();
    if (!seen.includes(story.id)) {
      seen.push(story.id);
      localStorage.setItem("zimmer_seen", JSON.stringify(seen.slice(-400)));
    }
    preloadNextStory();
  }

  /** Bosib turilsa — pauza (video ham, chiziq ham to'xtaydi). */
  function storyPause(on) {
    S.storyPaused = on;
    const ind = $("story-pause");
    if (ind) ind.classList.toggle("show", on);
    if (S.storyVideo) {
      try {
        if (on) S.storyVideo.pause();
        else S.storyVideo.play().catch(() => {});
      } catch (_) {}
    }
  }

  function toggleStorySound() {
    if (!S.storyVideo) return;
    S.storyMuted = !S.storyMuted;
    S.storyVideo.muted = S.storyMuted;
    const btn = $("story-sound");
    if (btn) btn.textContent = S.storyMuted ? "🔇" : "🔊";
    if (!S.storyMuted) S.storyVideo.play().catch(() => {});
    haptic();
  }

  /** 🗑 FAQAT ADMIN UCHUN: joriy storyni butunlay o'chirish (Avto_A1 kabi). */
  function deleteCurrentStory() {
    const story = S.stories[S.storyIndex];
    if (!story || !story.id) return;
    storyPause(true); // so'rov paytida o'ynamasin

    ask("Ushbu storyni butunlay o'chirib tashlaysizmi?").then(async (okay) => {
      if (!okay) {
        storyPause(false);
        return;
      }
      try {
        await api(`/api/admin/section/sto/${story.id}`, { method: "DELETE" });
        haptic("ok");
        toast("Story bazadan o'chirildi!", 2600);
        // Ro'yxatdan ham olib tashlaymiz va oynani yopamiz — qayta ochilganda yo'q
        const ring = S.rings[S.ringIndex];
        if (ring) ring.items = (ring.items || []).filter((it) => it.id !== story.id);
        S.rings = S.rings.filter((r) => (r.items || []).length > 0);
        if (S.home) S.home.stories = S.rings;
        closeStory();
      } catch (err) {
        storyPause(false);
        haptic("err");
        toast((err && err.message) || "O'chirishda xatolik yuz berdi");
      }
    });
  }

  /** Storyni telefonga yuklab olish (ilova ichidan). */
  function saveStory() {
    const story = S.stories[S.storyIndex];
    if (!story) return;
    const url = abs(story.video_url) || abs(story.photo_url);
    if (!url) return toast("Bu storyda yuklab olinadigan fayl yo'q");
    haptic("medium");
    const ring = S.rings[S.ringIndex];
    const base = (ring && ring.title) || story.heading || "zimmer-story";
    const name = ("zimmer-" + base).replace(/[^\w\-]+/g, "_");
    const ext = abs(story.video_url) ? ".mp4" : ".jpg";
    try {
      const a = document.createElement("a");
      a.href = url;
      a.download = name + ext;
      a.rel = "noopener";
      document.body.append(a);
      a.click();
      a.remove();
      toast("Yuklab olinmoqda... ⬇️");
    } catch (_) {
      // Telegram WebView yuklab olishni bloklasa — brauzerda ochamiz
      try {
        tg.openLink(url);
      } catch (__) {
        window.open(url, "_blank");
      }
    }
  }

  /** Ichida oldinga/orqaga yuradi; halqa tugasa — KEYINGI HALQAGA o'tadi. */
  function stepStory(delta) {
    const next = S.storyIndex + delta;

    if (next >= S.stories.length) {
      // Shu bo'lim tugadi — keyingi bo'lim bor bo'lsa unga o'tamiz
      if (S.ringIndex + 1 < S.rings.length) {
        haptic("light");
        return openStory(S.ringIndex + 1, 0);
      }
      return closeStory();
    }

    if (next < 0) {
      // Orqaga: oldingi bo'limning OXIRGI elementiga qaytamiz
      if (S.ringIndex > 0) {
        const prev = S.rings[S.ringIndex - 1];
        const last = Math.max(0, ((prev && prev.items) || []).length - 1);
        haptic("light");
        return openStory(S.ringIndex - 1, last);
      }
      return paintStory();
    }

    S.storyIndex = next;
    paintStory();
  }

  function closeStory() {
    clearTimeout(S.storyTimer);
    cancelAnimationFrame(S.storyRaf);
    releaseStoryVideo();
    stopVideos();
    storyPause(false);
    const view = $("story-view");
    view.classList.add("hidden");
    view.style.transform = "";
    view.style.opacity = "";
    const badge = $("story-cat");
    if (badge) badge.classList.add("hidden");
    $("story-inner").innerHTML = "";
    renderStories(); // ko'rilgan halqalar xiralashadi
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

    // Zaxira rejim: server yo'q — faqat mahalliy xotiraga yozamiz.
    // Server tiklanganda mijoz yuraklarni qaytadan bosishi kerak bo'lmasin
    // uchun ro'yxat localStorage'da saqlanadi.
    if (S.offline) {
      saveLocalFavorites();
      toast(wasSaved ? "Saqlanganlardan olindi" : "Saqlanganlarga qo'shildi ❤️");
      return;
    }

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
    if (S.offline) {
      // Zaxira rejim: saqlanganlarni mahalliy ro'yxat + Firebase katalogidan
      // yig'amiz (server javob bermaydi).
      const ids = new Set(localFavorites());
      items = (S.shopProducts || []).filter((p) => ids.has(p.id));
    } else {
      try {
        const res = await api("/api/favorites");
        items = res.items || [];
      } catch (err) {
        onError(err);
        return;
      }
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
    // Bo'sh holat matni: zaxira rejimda sabab boshqacha, shuni aytamiz.
    const emptyEl = $("products-empty");
    if (emptyEl) {
      emptyEl.textContent =
        S.offline && (!S.home || S.home._empty)
          ? "Katalog hozir yuklanmadi. Server uyg'onganda o'zi paydo bo'ladi."
          : "Bu bo'limda hozircha mahsulot yo'q.";
      emptyEl.classList.toggle("hidden", products.length > 0);
    }
    // Katalog bo'limini zaxira rejimda YASHIRMAYMIZ — aks holda bosh sahifa
    // butunlay bo'sh ko'rinib, mijoz nima bo'lganini tushunmaydi.
    $("catalog-sec").classList.toggle("hidden", !products.length && !S.offline);

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

      // Butun kartani bosish — modal ochiladi (yangilangan)
      card.onclick = () => openProductModal(p);

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

  /** Savatga qo'shish. `qty` — nechta (modaldagi «+/−» uchun; standart 1).
      Ilgari bu funksiya faqat bitta argument olardi, modal esa
      `addToCart(product, modalQuantity)` deb chaqirardi — ikkinchi argument
      JIMGINA tashlab ketilardi va nechta tanlansa ham 1 dona qo'shilardi. */
  function addToCart(product, qty) {
    const want = Math.max(1, parseInt(qty, 10) || 1);
    const found = S.cart.find((i) => i.id === product.id);
    const have = found ? found.qty : 0;
    if (have + want > product.stock) return toast(`Omborda ${product.stock} dona bor`);
    if (found) found.qty += want;
    else
      S.cart.push({
        id: product.id,
        name: product.name,
        price: product.price,
        qty: want,
        stock: product.stock,
        photo_url: product.photo_url || null, // savat qatorida rasm ko'rsatish uchun
      });
    saveCart();
    haptic();
  }

  /* --------------------------------------------------------------- navbat */
  function renderBookCard() {
    $("book-body").innerHTML = `
      <div class="bk-card-top">
        <span class="bk-card-ico">🗓</span>
        <div class="bk-card-tx">
          <b>Ustaga navbat olish</b>
          <small>Bo'sh vaqtni tanlab, 3 qadamda band qilasiz</small>
        </div>
      </div>
      <div class="bk-card-facts">
        <div><i>⏱</i><b>2–3 soat</b><small>O'rnatish</small></div>
        <div><i>🛡</i><b>1 yil</b><small>Kafolat</small></div>
        <div><i>🔧</i><b>Usta</b><small>Tajribali</small></div>
      </div>
      <button class="btn btn-primary" id="book-open" style="width:100%;margin-top:12px">
        Navbat olish →</button>`;
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
         <div class="dlv-addr-list" id="dlv-addresses"></div>
         <button class="dlv-map-btn" id="dlv-map-btn">🗺 Xaritadan belgilash</button>
         <label class="field"><span>📍 Yoki manzilni yozing</span>
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
    $("dlv-map-btn").onclick = openMapPicker;
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
    if (method === "courier") renderCourierAddresses();
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
      // Saqlangan manzil tanlangan bo'lsa, undan foydalanamiz
      const addrs = getAddresses();
      if (S._dlvSelectedAddr !== null && addrs[S._dlvSelectedAddr]) {
        const a = addrs[S._dlvSelectedAddr];
        const addr = a.address;
        const mapLink = a.mapLink || "";
        S.delivery = {
          method: "courier", address: addr, mapLink,
          summary: `Kuryer (manzilga): ${a.label || addr}` + (mapLink ? `\n🗺 ${mapLink}` : ""),
        };
      } else {
        const address = ($("dlv-address").value || "").trim();
        if (address.length < 5) return toast("Manzilni to'liqroq yozing yoki xaritadan belgilang");
        S.delivery = { method: "courier", address, summary: `Kuryer (manzilga): ${address}` };
      }
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

    // ZAXIRA REJIM: Render o'chgan bo'lsa buyurtma Cloudflare Worker orqali
    // qabul qilinadi. Worker uxlamaydi, summani KATALOGDAN o'zi hisoblaydi
    // va adminga Telegram xabarini yuboradi. Ya'ni Avto_A1 dagi kabi —
    // bot ishlamasa ham buyurtma keladi.
    if (S.offline) {
      if (!window.ZimmerOffline || !ZimmerOffline.workerReady()) {
        return offlineBlocked("Buyurtma berish");
      }
      return placeOrderViaWorker(paymentLabel, openAdminChat);
    }

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

    // Zaxira rejim: buyurtma/navbat tarixi FAQAT serverda turadi, uni
    // bulutdagi katalogdan tiklab bo'lmaydi. Bo'sh ro'yxat ko'rsatish
    // "buyurtmalarim yo'qolgan" degan taassurot beradi — shuning uchun
    // aniq sabab yoziladi.
    if (S.offline) {
      // Do'kon buyurtmalari Worker'dan keladi (Firebase'da saqlangan).
      // Bi-LED va navbat esa faqat serverda — ular uchun izoh ko'rsatiladi.
      renderBiledOrders([]);
      renderBookings([]);
      renderOrders(offlineOrdersForView());
      const note = $("pf-offline-note");
      if (note) note.classList.remove("hidden");
      return;
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

  /** Worker'dan kelgan buyurtmalarni `renderOrders` kutgan shaklga keltiradi.
      Worker'da raqamli `id` yo'q (SQLite bermaydi) — o'rniga `ZM-XXXXXX` kod
      ishlatiladi va bot buyurtmani bazaga ko'chirganda raqam beriladi. */
  function offlineOrdersForView() {
    const STATUS = {
      new: "Yangi",
      accepted: "Qabul qilindi",
      shipped: "Yo'lda",
      done: "Yetkazildi",
      cancelled: "Bekor qilingan",
    };
    return (S.offlineOrders || []).map((o) => ({
      id: o.code || "—",
      total_label: o.total_label || fmt(o.total),
      status: o.status || "new",
      status_label: STATUS[o.status] || "Yangi",
      items: (o.items || []).map((i) => ({ name: i.name, qty: i.qty })),
      delivery_info: o.delivery_info || "",
      payment_method: o.payment_method || "",
    }));
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

  /* ==================================================================
     NAVBAT OLISH — iPhone uslubida, uch qadam:
       1) Xizmat  →  2) Kun  →  3) Vaqt  →  tasdiq
     Har qadam orqaga qaytadi, tanlovlar esda qoladi. Vaqt band bo'lib
     qolsa (409) — ro'yxat darhol yangilanadi va mijoz xabar oladi.
     ================================================================== */

  const BK = { step: 1, service: null, day: null, days: [], slots: [], time: null };

  function bookingHead() {
    const titles = ["Xizmatni tanlang", "Qulay kunni tanlang", "Vaqtni tanlang"];
    $("sheet-title").textContent = "🗓 " + (titles[BK.step - 1] || "Navbat olish");
  }

  /** Yuqoridagi qadam ko'rsatkichi (iOS segment uslubi). */
  function bookingSteps() {
    const names = ["Xizmat", "Kun", "Vaqt"];
    const wrap = el("div", "bk-steps");
    names.forEach((name, i) => {
      const n = i + 1;
      const item = el(
        "div",
        "bk-step" + (n === BK.step ? " on" : n < BK.step ? " done" : ""),
        `<i>${n < BK.step ? "✓" : n}</i><span>${name}</span>`
      );
      if (n < BK.step) {
        item.onclick = () => {
          BK.step = n;
          haptic();
          paintBooking();
        };
      }
      wrap.append(item);
    });
    return wrap;
  }

  /** Tanlanganlar haqida ixcham eslatma (2- va 3-qadamda). */
  function bookingRecap() {
    const bits = [];
    if (BK.service) bits.push(`🔧 ${esc(BK.service.name)}`);
    if (BK.day) bits.push(`📅 ${esc(BK.day.short_label || BK.day.label)}`);
    return bits.length ? el("div", "bk-recap", bits.join(" · ")) : null;
  }

  async function openBookingSheet() {
    // Navbat bo'sh vaqtni serverdan hisoblashni talab qiladi (band slotlar
    // bazada). Zaxira rejimda buni bajarish mumkin emas.
    if (S.offline) return offlineBlocked("Navbat olish");
    haptic();
    BK.step = 1;
    BK.service = null;
    BK.day = null;
    BK.time = null;
    openSheet("🗓 Xizmatni tanlang", '<div class="bk-load">Yuklanmoqda...</div>');
    try {
      BK.services = await api("/api/services");
    } catch (err) {
      closeSheet();
      return onError(err);
    }
    paintBooking();
  }

  function paintBooking() {
    bookingHead();
    const box = $("sheet-content");
    box.innerHTML = "";
    box.append(bookingSteps());
    const recap = BK.step > 1 ? bookingRecap() : null;
    if (recap) box.append(recap);

    if (BK.step === 1) return paintBookingServices(box);
    if (BK.step === 2) return paintBookingDays(box);
    return paintBookingSlots(box);
  }

  /* ------------------------------------------------------- 1-qadam: xizmat */
  function paintBookingServices(box) {
    const list = BK.services || [];
    if (!list.length) {
      box.append(el("p", "empty", "Hozircha xizmatlar qo'shilmagan."));
      return;
    }
    const group = el("div", "bk-list");
    list.forEach((s) => {
      const row = el("button", "bk-row");
      row.innerHTML = `
        <span class="bk-row-ico">🔧</span>
        <span class="bk-row-mid">
          <b>${esc(s.name)}</b>
          <small>⏱ ${s.duration_min} daqiqa</small>
        </span>
        <span class="bk-row-end">
          <b>${esc(s.price_label)}</b>
          <i>›</i>
        </span>`;
      row.onclick = () => {
        BK.service = s;
        BK.day = null;
        BK.time = null;
        haptic("medium");
        BK.step = 2;
        loadBookingDays();
      };
      group.append(row);
    });
    box.append(group);
    box.append(el("p", "bk-hint", "O'rnatish vaqti xizmatga qarab belgilanadi."));
  }

  /** Kun kartochkasi uchun yozuvlar: yuqorida hafta kuni, o'rtada sana.
      Bugun/Ertaga serverdan kelgan yorliqdan aniqlanadi — shunda telefon
      va server vaqt zonasi farq qilsa ham to'g'ri chiqadi. */
  const WEEKDAY_SHORT = ["Yak", "Du", "Se", "Chor", "Pay", "Jum", "Sha"];
  function dayParts(day) {
    const label = String(day.short_label || "");
    const today = /bugun/i.test(label);
    const tomorrow = /ertaga/i.test(label);
    const bits = String(day.date || "").split("-");
    const y = Number(bits[0]);
    const m = Number(bits[1]);
    const d = Number(bits[2]);
    let top;
    if (today) top = "Bugun";
    else if (tomorrow) top = "Ertaga";
    else {
      const dt = new Date(y, (m || 1) - 1, d || 1);
      top = WEEKDAY_SHORT[dt.getDay()] || "";
    }
    return { top: top, num: d || "", today: today };
  }

  /* ---------------------------------------------------------- 2-qadam: kun */
  async function loadBookingDays() {
    bookingHead();
    const box = $("sheet-content");
    box.innerHTML = "";
    box.append(bookingSteps());
    const recap = bookingRecap();
    if (recap) box.append(recap);
    box.append(el("div", "bk-load", "Kunlar yuklanmoqda..."));
    try {
      BK.days = await api("/api/dates?service_id=" + BK.service.id);
      paintBooking();
    } catch (err) {
      onError(err);
    }
  }

  function paintBookingDays(box) {
    const days = BK.days || [];
    const free = days.filter((d) => d.free_count > 0);
    if (!free.length) {
      box.append(
        el("p", "empty", "Yaqin kunlarda bo'sh vaqt qolmagan. Iltimos, keyinroq urinib ko'ring.")
      );
      return;
    }

    const strip = el("div", "bk-days");
    days.forEach((d) => {
      const p = dayParts(d);
      const card = el("button", "bk-day" + (BK.day && BK.day.date === d.date ? " on" : ""));
      card.disabled = !d.free_count;
      if (p.today) card.classList.add("today");
      card.innerHTML = `
        <span class="bk-day-top">${esc(p.top)}</span>
        <span class="bk-day-num">${esc(p.num)}</span>
        <span class="bk-day-free">${d.free_count ? d.free_count + " ta" : "band"}</span>`;
      card.onclick = () => {
        BK.day = d;
        BK.time = null;
        haptic("medium");
        BK.step = 3;
        loadBookingSlots();
      };
      strip.append(card);
    });
    box.append(strip);

    const back = el("button", "btn btn-ghost btn-sm", "‹ Xizmatni o'zgartirish");
    back.onclick = () => {
      BK.step = 1;
      haptic();
      paintBooking();
    };
    box.append(back);
  }

  /* --------------------------------------------------------- 3-qadam: vaqt */
  async function loadBookingSlots() {
    bookingHead();
    const box = $("sheet-content");
    box.innerHTML = "";
    box.append(bookingSteps());
    const recap = bookingRecap();
    if (recap) box.append(recap);
    box.append(el("div", "bk-load", "Bo'sh vaqtlar yuklanmoqda..."));
    try {
      const data = await api(
        `/api/slots?service_id=${BK.service.id}&date=${encodeURIComponent(BK.day.date)}`
      );
      BK.slots = data.slots || [];
      paintBooking();
    } catch (err) {
      onError(err);
    }
  }

  function paintBookingSlots(box) {
    const slots = BK.slots || [];
    if (!slots.length) {
      box.append(el("p", "empty", "Bu kunda bo'sh vaqt qolmagan. Boshqa kunni tanlang."));
      const back = el("button", "btn btn-ghost btn-sm", "‹ Boshqa kun");
      back.onclick = () => {
        BK.step = 2;
        haptic();
        paintBooking();
      };
      box.append(back);
      return;
    }

    // Vaqtlarni kun bo'limlariga ajratamiz — tanlash osonlashadi
    const groups = [
      { label: "Ertalab", from: 0, to: 12, items: [] },
      { label: "Tushdan keyin", from: 12, to: 17, items: [] },
      { label: "Kechqurun", from: 17, to: 24, items: [] },
    ];
    slots.forEach((t) => {
      const hour = parseInt(String(t).split(":")[0], 10) || 0;
      const g = groups.find((x) => hour >= x.from && hour < x.to) || groups[0];
      g.items.push(t);
    });

    groups.forEach((g) => {
      if (!g.items.length) return;
      box.append(el("div", "bk-group", g.label));
      const grid = el("div", "bk-times");
      g.items.forEach((t) => {
        const btn = el("button", "bk-time" + (BK.time === t ? " on" : ""), t);
        btn.onclick = () => {
          BK.time = t;
          haptic();
          paintBooking();
        };
        grid.append(btn);
      });
      box.append(grid);
    });

    // Tasdiqlash paneli — tanlangandan keyin paydo bo'ladi
    const bar = el("div", "bk-confirm");
    if (BK.time) {
      bar.innerHTML = `
        <div class="bk-sum">
          <small>${esc(BK.day.label || BK.day.short_label)}</small>
          <b>🕐 ${esc(BK.time)} · ${esc(BK.service.price_label)}</b>
        </div>`;
      const go = el("button", "btn btn-primary", "Navbatni band qilish");
      go.onclick = () => confirmBooking(go);
      bar.append(go);
    } else {
      bar.innerHTML = '<div class="bk-sum"><small>Vaqtni tanlang</small></div>';
    }
    box.append(bar);

    const back = el("button", "btn btn-ghost btn-sm", "‹ Boshqa kun");
    back.onclick = () => {
      BK.step = 2;
      haptic();
      paintBooking();
    };
    box.append(back);
  }

  /** Yakuniy tasdiq: navbatni band qiladi. */
  function confirmBooking(btn) {
    if (!BK.service || !BK.day || !BK.time) return toast("Vaqtni tanlang");
    return withPhone(async () => {
      btn.disabled = true;
      btn.textContent = "Band qilinmoqda...";
      try {
        const res = await api("/api/bookings", {
          method: "POST",
          body: { service_id: BK.service.id, date: BK.day.date, time: BK.time },
        });
        haptic("ok");
        closeSheet();
        burst();
        toast(`✅ Navbat #${res.booking.id} · ${BK.time}`, 3400);
        show("profile");
      } catch (err) {
        btn.disabled = false;
        btn.textContent = "Navbatni band qilish";
        // Kimdir shu vaqtni oldindan olib qo'ygan bo'lsa — ro'yxatni yangilaymiz
        if (err && err.code === "slot_taken") {
          haptic("err");
          toast("Bu vaqt band bo'lib qoldi — boshqa vaqtni tanlang", 3200);
          BK.slots = (err.slots || []).length ? err.slots : BK.slots.filter((t) => t !== BK.time);
          BK.time = null;
          paintBooking();
          return;
        }
        throw err;
      }
    });
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
    let carsReady = Promise.resolve(); // mashinalar so'rovi (parallel yuklanadi)
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
      // Bu «ro'yxatdan o'tish» emas: Telegram Mini App faqat Telegram ichida
      // ishlaydi (haptic, BackButton, safe-area — hammasi shundan keladi).
      gate(
        "Do'kon Telegram ilovasi ichida ochiladi.\n\n" +
          "Botga /start yuboring va «🛍 Do'konni ochish» tugmasini bosing.",
        "Telegram ichidan oching",
        "📱"
      );
      return;
    }

    saveCart();

    try {
      let cfg, me;
      try {
        [cfg, me] = await Promise.all([api("/api/config"), api("/api/me")]);
      } catch (err) {
        // ============================================================
        //  ZAXIRA REJIM
        //  Ilgari bu yerda darhol `gate(...)` chaqirilardi — Render
        //  uxlagan yoki kvota tugagan payt ilova "Server javob bermadi"
        //  ekranida QOTIB qolardi, ya'ni do'kon umuman ochilmasdi.
        //
        //  Endi katalogni to'g'ridan-to'g'ri Firebase'dan o'qishga
        //  harakat qilamiz (bot uni doim ko'chirib turadi). Shunda
        //  Avto_A1 dagi kabi: server o'chsa ham do'kon ko'rinadi.
        //
        //  Imzo xatosi (invalid_init_data) — boshqa masala: unda
        //  zaxira ham yordam bermaydi, mijoz ilovani qayta ochishi kerak.
        // ============================================================
        if (err && err.code === "invalid_init_data") return onError(err);
        // TO'SIQ EKRANI ENDI CHIQMAYDI.
        //
        // Ilgari zaxira zanjiri yiqilsa `gate()` chaqirilardi va mijoz
        // «Ulanish yo'q» devoriga urilardi. Bu keraksiz: ilovaning o'zi
        // ochilib, do'kon bo'limi bo'sh holatini ko'rsatishi ANCHA yaxshi —
        // mijoz kamida navigatsiya qila oladi va sabab pastdagi chiziqda
        // yozilgan bo'ladi.
        //
        // `enterOfflineMode()` false qaytarsa ham davom etamiz: `loadHome()`
        // katalogni zanjirdan (Firebase → kesh → statik nusxa) oladi, hech
        // biri bo'lmasa bo'sh holat ko'rsatiladi.
        await enterOfflineMode();
        S.offline = true;
        scheduleServerRecheck();
        cfg = offlineConfig();
        // Avval Worker'dan so'raymiz (haqiqiy profil + buyurtma tarixi),
        // bo'lmasa mahalliy keshdan.
        me = (await offlineMeFromWorker()) || offlineMe();
      }

      S.currency = cfg.currency || "so'm";
      S.pay = {
        card: cfg.pay_card_number || "",
        holder: cfg.pay_card_holder || "",
        admin: cfg.pay_admin_username || "",
        city: cfg.delivery_city || "Toshkent",
      };
      S.me = me;
      // Mijozni tanib qolish uchun keshlaymiz — server o'chganda ismi,
      // telefoni va mashinasi eslanadi.
      if (!S.offline) saveMe(me);
      renderPhoneWarn();

      // Salomlashuv: vergul yo'q, ism alohida qatorda. Harflar navbat bilan
      // chiqadi — faqat opacity/transform ishlatiladi, telefon qizimaydi.
      const name = (me.full_name || me.first_name || "").split(" ")[0];
      const letters = (text, delay) =>
        text
          .split("")
          .map(
            (ch, i) =>
              `<span style="animation-delay:${(delay + i * 0.032).toFixed(3)}s">${
                ch === " " ? "&nbsp;" : esc(ch)
              }</span>`
          )
          .join("");
      $("splash-hello").innerHTML =
        `<h1 class="hello-line">${letters("Assalomu alaykum", 0.1)}</h1>` +
        (name ? `<h1 class="hello-name">${letters(name, 0.62)}</h1>` : "");

      // Admin bo'lsa — pastdagi menyuda «Boshqaruv» tugmasi paydo bo'ladi
      if (me.is_admin) {
        const adminBtn = $("nav-admin");
        if (adminBtn) adminBtn.classList.remove("hidden");
      }

    // Mashinalar ro'yxati kutib turmaydi — bosh menyu bilan BIR VAQTDA
    // yuklanadi. Ilgari ketma-ket kutilardi va kirishda qotish sezilardi.
    carsReady = (S.offline ? ZimmerOffline.cars() : api("/api/cars"))
      .then((list) => {
        S.cars = list || [];
        // Serverdan kelgan ro'yxatni keshlaymiz — keyingi safar server
        // o'chgan bo'lsa konfigurator baribir ishlaydi.
        if (!S.offline && window.ZimmerOffline) ZimmerOffline.saveCars(S.cars);
        if (me.car) S.car = S.cars.find((c) => c.id === me.car.id) || null;
      })
      .catch(() => {});
    
    // DIQQAT: bu yerda ilgari `loadProducts()` chaqirilardi. U mavjud bo'lmagan
    // `${API}/products` manziliga murojaat qilib 404 olardi va catch bloki
    // $("products") ichiga «Mahsulotlarni yuklab bo'lmadi» yozib, `loadHome()`
    // allaqachon chizgan katalogni O'CHIRIB tashlardi. Katalog `/api/home`
    // orqali `loadHome()` → `renderCatalog()` da yuklanadi — yagona manba.
    } catch (err) {
      if (err && err.code === "invalid_init_data") return onError(err);
      // Kutilmagan xato — bu yerda ham TO'SIQ KO'RSATMAYMIZ. Ilova ochiladi,
      // katalog zaxira zanjiridan olinadi, hech biri bo'lmasa bo'sh holat
      // ko'rinadi. Mijoz doim kamida ilovaning o'ziga kira olishi kerak.
      console.error("[boot] kutilmagan xato — zaxira rejimda ochilyapti:", err);
      S.offline = true;
      S.home = null; // loadHome() zanjirdan oladi
      S.currency = offlineConfig().currency;
      S.pay = { card: "", holder: "", admin: "", city: "Toshkent" };
      S.me = offlineMe();
      scheduleServerRecheck();
    }

    // Tugma yo'q: mijoz salomlashuvni ko'radi va bosh menyu O'ZI ochiladi.
    // Bosh menyu, mashinalar va salomlashuv animatsiyasi — hammasi parallel.
    await Promise.all([loadHome(), carsReady, wait(1600)]);

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
  $("story-sound").onclick = toggleStorySound;
  $("story-save").onclick = saveStory;
  $("story-del").onclick = deleteCurrentStory;

  /* Pastga surib yopish (Avto_A1 kabi). Faqat transform/opacity — silliq. */
  (function storySwipeClose() {
    const view = $("story-view");
    if (!view) return;
    let startY = 0;
    let deltaY = 0;
    let active = false;

    view.addEventListener(
      "touchstart",
      (e) => {
        if (view.classList.contains("hidden")) return;
        startY = e.touches[0].clientY;
        deltaY = 0;
        active = true;
      },
      { passive: true }
    );

    view.addEventListener(
      "touchmove",
      (e) => {
        if (!active) return;
        deltaY = e.touches[0].clientY - startY;
        if (deltaY > 6) {
          view.style.transform = `translate3d(0, ${deltaY}px, 0)`;
          view.style.opacity = String(Math.max(0.35, 1 - deltaY / 420));
        }
      },
      { passive: true }
    );

    view.addEventListener(
      "touchend",
      () => {
        if (!active) return;
        active = false;
        if (deltaY > 110) {
          haptic("light");
          closeStory();
          return;
        }
        // Yetarli surilmadi — joyiga qaytadi
        view.style.transition = "transform 0.22s var(--silk), opacity 0.22s";
        view.style.transform = "";
        view.style.opacity = "";
        setTimeout(() => (view.style.transition = ""), 240);
      },
      { passive: true }
    );
  })();

  // Bosib turilsa pauza (ikki tomonda ham) — Avto_A1 kabi
  ["story-prev", "story-next"].forEach((id) => {
    const zone = $(id);
    if (!zone) return;
    let held = false;
    let timer = null;
    const down = () => {
      held = false;
      clearTimeout(timer);
      timer = setTimeout(() => {
        held = true;
        storyPause(true);
      }, 220);
    };
    const up = () => {
      clearTimeout(timer);
      if (held) storyPause(false);
      // `held` shu holatda qoladi — pastdagi onclick uni tekshiradi
    };
    zone.addEventListener("touchstart", down, { passive: true });
    zone.addEventListener("touchend", up);
    zone.addEventListener("touchcancel", up);
    zone.addEventListener("mousedown", down);
    zone.addEventListener("mouseup", up);
    zone.addEventListener("mouseleave", up);
    // Bosib turgandan keyin bosish hodisasi o'tmasligi uchun
    const original = zone.onclick;
    zone.onclick = (ev) => {
      if (held) {
        held = false;
        return;
      }
      if (original) original(ev);
    };
  });

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

  /* ==================================================================
     XARITA TANLASH (Map Picker) — Leaflet (OpenStreetMap, kalitsiz)
     Avto_A1 dagi mantiq, Zimmer dizaynida
     ================================================================== */

  // Saqlangan manzillar (localStorage)
  function getAddresses() {
    try { return JSON.parse(localStorage.getItem("zimmer_addresses") || "[]"); }
    catch { return []; }
  }
  function saveAddresses(arr) {
    localStorage.setItem("zimmer_addresses", JSON.stringify(arr));
  }

  // Manzillar ro'yxatini chizish
  S._dlvSelectedAddr = null;
  function renderCourierAddresses() {
    const box = $("dlv-addresses");
    if (!box) return;
    const addrs = getAddresses();
    if (!addrs.length) {
      box.innerHTML = '<div style="color:var(--muted);font-size:12px;padding:8px;text-align:center;">Saqlangan manzil yo\'q. Xaritadan belgilang yoki pastga yozing.</div>';
      return;
    }
    box.innerHTML = addrs.map((a, i) =>
      `<div class="dlv-addr-item ${S._dlvSelectedAddr === i ? "selected" : ""}" data-idx="${i}">
        <div class="dlv-addr-radio"></div>
        <span style="font-size:17px;">${a.type === "home" ? "🏠" : a.type === "work" ? "🏢" : "📍"}</span>
        <div style="flex:1;min-width:0;">
          <div style="font-size:13px;font-weight:700;">${esc(a.label || "Manzil")}</div>
          <div style="font-size:11px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(a.address)}</div>
        </div>
        <button class="dlv-addr-del" data-delidx="${i}" aria-label="O'chirish">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
            <line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
        </button>
      </div>`
    ).join("");

    // Tanlash
    box.querySelectorAll(".dlv-addr-item").forEach((item) => {
      item.addEventListener("click", (e) => {
        if (e.target.closest(".dlv-addr-del")) return;
        S._dlvSelectedAddr = parseInt(item.dataset.idx, 10);
        haptic("light");
        renderCourierAddresses();
      });
    });

    // O'chirish
    box.querySelectorAll(".dlv-addr-del").forEach((btn) => {
      btn.addEventListener("click", async (e) => {
        e.stopPropagation();
        const idx = parseInt(btn.dataset.delidx, 10);
        const arr = getAddresses();
        if (!arr[idx]) return;
        const ok = await ask(`"${arr[idx].label || arr[idx].address}" manzilini o'chirasizmi?`);
        if (!ok) return;
        arr.splice(idx, 1);
        saveAddresses(arr);
        if (S._dlvSelectedAddr === idx) {
          S._dlvSelectedAddr = arr.length > 0 ? Math.min(idx, arr.length - 1) : null;
        } else if (S._dlvSelectedAddr !== null && S._dlvSelectedAddr > idx) S._dlvSelectedAddr--;
        renderCourierAddresses();
        toast("Manzil o'chirildi");
        haptic("success");
      });
    });
  }

  // Leaflet yuklash
  let _leafletLoading = null;
  function ensureLeaflet() {
    if (window.L) return Promise.resolve();
    if (_leafletLoading) return _leafletLoading;
    _leafletLoading = new Promise((resolve, reject) => {
      const css = document.createElement("link");
      css.rel = "stylesheet";
      css.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
      document.head.appendChild(css);
      const js = document.createElement("script");
      js.src = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
      js.onload = () => resolve();
      js.onerror = () => reject(new Error("xarita yuklanmadi"));
      document.head.appendChild(js);
    });
    return _leafletLoading;
  }

  let _mapObj = null;
  let _mapMarker = null;
  let _pickedCoords = null;

  async function openMapPicker() {
    const ov = $("map-picker-overlay");
    ov.classList.remove("hidden");
    _pickedCoords = null;
    haptic("medium");

    try { await ensureLeaflet(); } catch {
      toast("Xarita yuklanmadi. Internetni tekshiring.");
      ov.classList.add("hidden");
      return;
    }

    setTimeout(() => {
      const mapEl = $("map-picker-map");
      if (_mapObj && _mapObj.remove) {
        try { _mapObj.remove(); } catch {}
        _mapObj = null; _mapMarker = null;
      }

      _mapObj = L.map(mapEl).setView([41.3111, 69.2797], 12);
      L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png", {
        maxZoom: 20, attribution: "\u00a9 OpenStreetMap, \u00a9 CARTO", subdomains: "abcd",
      }).addTo(_mapObj);

      _mapObj.on("click", (e) => {
        placeMarker(e.latlng.lat, e.latlng.lng);
      });

      if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
          (pos) => { _mapObj.setView([pos.coords.latitude, pos.coords.longitude], 15); },
          () => {}, { timeout: 5000 }
        );
      }
      _mapObj.invalidateSize();
    }, 200);

    $("map-cancel").onclick = closeMapPicker;
    $("map-confirm").onclick = confirmMapLocation;
    $("map-locate-btn").onclick = locateMe;
  }

  function closeMapPicker() {
    $("map-picker-overlay").classList.add("hidden");
    haptic();
  }

  function placeMarker(lat, lng) {
    _pickedCoords = { lat, lng };
    if (_mapMarker) _mapMarker.setLatLng([lat, lng]);
    else if (window.L) _mapMarker = L.marker([lat, lng]).addTo(_mapObj);
  }

  function locateMe() {
    const btn = $("map-locate-btn");
    const hint = $("map-locate-hint");
    if (!navigator.geolocation) return toast("Qurilmangiz joylashuvni qo'llamaydi");
    if (btn) btn.classList.add("locating");
    if (hint) hint.textContent = "Joylashuv aniqlanmoqda...";
    haptic("selection");

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = pos.coords.latitude, lng = pos.coords.longitude;
        if (_mapObj) _mapObj.setView([lat, lng], 16);
        placeMarker(lat, lng);
        if (btn) btn.classList.remove("locating");
        if (hint) hint.textContent = "📍 Joylashuvingiz topildi!";
        toast("📍 Joylashuvingiz aniqlandi");
        haptic("success");
      },
      (err) => {
        if (btn) btn.classList.remove("locating");
        if (hint) hint.textContent = "Joyni belgilang yoki 🎯 tugmasini bosing";
        let msg = "Joylashuvni aniqlab bo'lmadi";
        if (err && err.code === 1) msg = "Joylashuvga ruxsat berilmadi. Sozlamalardan yoqing.";
        else if (err && err.code === 3) msg = "Vaqt tugadi. Qayta urinib ko'ring.";
        toast(msg);
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  }

  function confirmMapLocation() {
    if (!_pickedCoords) return toast("Xaritada nuqtani belgilang");
    openAddrNameModal();
  }

  // Manzilga nom berish modali
  function openAddrNameModal() {
    const ov = $("addr-name-overlay");
    const coords = $("addr-name-coords");
    if (coords && _pickedCoords) {
      coords.textContent = "📍 " + _pickedCoords.lat.toFixed(5) + ", " + _pickedCoords.lng.toFixed(5);
    }
    $("addr-name-input").value = "";
    ov.querySelectorAll(".addr-chip").forEach((c) => c.classList.remove("sel"));

    ov.classList.remove("hidden");
    requestAnimationFrame(() => ov.classList.add("show"));
    setTimeout(() => $("addr-name-input").focus(), 320);

    // Chip tanlash
    ov.querySelectorAll(".addr-chip").forEach((chip) => {
      chip.onclick = () => {
        ov.querySelectorAll(".addr-chip").forEach((c) => c.classList.remove("sel"));
        chip.classList.add("sel");
        $("addr-name-input").value = chip.dataset.label;
        haptic("selection");
      };
    });

    // Saqlash
    $("addr-name-save").onclick = saveMapAddressWithName;

    // Tashqariga bosib yopish
    ov.onclick = (e) => { if (e.target === ov) closeAddrNameModal(); };
  }

  function closeAddrNameModal() {
    const ov = $("addr-name-overlay");
    ov.classList.remove("show");
    setTimeout(() => ov.classList.add("hidden"), 220);
  }

  function saveMapAddressWithName() {
    if (!_pickedCoords) return toast("Xaritada nuqtani belgilang");
    const name = ($("addr-name-input").value || "").trim();
    if (!name) { toast("Manzilga nom kiriting"); $("addr-name-input").focus(); return; }

    const lat = _pickedCoords.lat, lng = _pickedCoords.lng;
    const mapLink = "https://www.google.com/maps?q=" + lat.toFixed(6) + "," + lng.toFixed(6);
    const addrText = "📍 " + lat.toFixed(5) + ", " + lng.toFixed(5);

    const arr = getAddresses();
    arr.push({ type: "map", label: name, address: addrText, mapLink: mapLink });
    saveAddresses(arr);

    toast("✅ Manzil saqlandi: " + name);
    haptic("success");
    closeAddrNameModal();
    closeMapPicker();

    // Yangi manzilni tanlash
    S._dlvSelectedAddr = arr.length - 1;
    renderCourierAddresses();
  }

  /* ========================================================================
     MAHSULOTLAR TIZIMI — IZOH (PR #54–#58 dagi nosozlik va uning yechimi)

     Bu yerda ilgari IKKINCHI, mustaqil mahsulot tizimi turardi:
     `loadProducts()` / `renderProducts()` / `createProductCard()` /
     `toggleFavorite(id)` / `quickAddToCart(id)`. U 5 xil sababdan ishlamasdi:

       1) `fetch(`${API}/products`)` — serverda bunday manzil YO'Q
          (haqiqiy manzillar: `/api/home` va `/api/catalog`) → har safar 404.
       2) catch bloki `$("products")` ichiga xato matnini yozib,
          `renderCatalog()` chizgan haqiqiy katalogni o'chirib tashlardi.
       3) `allProducts.find(p => p.id === id)` — `dataset.id` MATN, mahsulot
          `id` esa SON. `===` hech qachon rost bo'lmaydi → kartochka bosilmaydi.
       4) `onclick="toggleFavorite(...)"` inline atributlar GLOBAL doiradan
          funksiya izlaydi, bu fayl esa IIFE ichida → `ReferenceError`.
       5) ENG MUHIMI: `function toggleFavorite(id)` yuqoridagi (1292-qator)
          `async function toggleFavorite(product, button)` ni USTIDAN YOZARDI
          (JS'da keyingi e'lon g'olib). Shu sababli kartochkadagi yurak
          serverga yozmay qo'ydi va bosilganda butun grid o'chib ketardi.

     Yechim: yagona manba — `/api/home` → `S.home.catalog` → `renderCatalog()`.
     Mahsulot modali (pastda) shu bir xil obyekt shakli bilan ishlaydi.
     ======================================================================== */

  /* ========================================================================
     MAHSULOT TAFSILOT MODALI (Avto_A1 dan Zimmerga ko'chirilgan)
     ======================================================================== */
  
  let currentProduct = null;
  let currentImageIndex = 0;
  let modalQuantity = 1;
  let touchStartX = 0;
  let touchEndX = 0;

  /** Mahsulotning barcha rasmlari — mutlaq manzillar ro'yxati (bo'sh bo'lishi mumkin).
      Server `images` massivini beradi; eski yozuvlar uchun `photo_url` ga tayanamiz. */
  function productImages(p) {
    const raw = Array.isArray(p.images) && p.images.length ? p.images : [p.photo_url];
    const seen = new Set();
    const out = [];
    raw.forEach((u) => {
      const src = abs(u);
      if (src && !seen.has(src)) {
        seen.add(src);
        out.push(src);
      }
    });
    return out;
  }

  function openProductModal(product) {
    currentProduct = product;
    currentImageIndex = 0;
    modalQuantity = 1;
    
    const modal = $("productModal");
    const slider = $("pm-slider");
    const dots = $("pm-dots");
    
    // Rasm galereyasini yaratish.
    // Katalog obyektida `images` (1–3 rasm) va `photo_url` bo'lishi mumkin.
    // Ilgari bu yerda `product.images || [product.image || product.thumbnail]`
    // yozilgan edi — katalogda bunday maydonlar yo'q, natijada massiv
    // `[undefined]` bo'lib, `abs(undefined)` → null va buzuq rasm chiqardi.
    slider.innerHTML = "";
    dots.innerHTML = "";

    const images = productImages(product);
    images.forEach((src, i) => {
      const imgEl = el("img", "", "");
      imgEl.src = src;
      imgEl.alt = product.name || "";
      imgEl.loading = i === 0 ? "eager" : "lazy";
      slider.appendChild(imgEl);

      // Bitta rasm bo'lsa nuqtalar kerak emas
      if (images.length > 1) {
        const dot = el("i", i === 0 ? "on" : "");
        dot.onclick = () => scrollToImage(i);
        dots.appendChild(dot);
      }
    });
    if (!images.length) {
      slider.appendChild(el("div", "pm-noimg", "💡"));
    }

    // Badges
    const badges = $("pm-badges");
    badges.innerHTML = "";
    const off = discountPercent(product);
    if (product.badge) {
      const badge = el("span", "pm-badge new", product.badge);
      badges.appendChild(badge);
    }
    if (off > 0) {
      const saleBadge = el("span", "pm-badge sale", `-${off}%`);
      badges.appendChild(saleBadge);
    }
    if (product.stock === 0) {
      const outBadge = el("span", "pm-badge out", "Tugagan");
      badges.appendChild(outBadge);
    }
    
    // Ma'lumotlar
    $("pm-title").textContent = product.name;
    $("pm-price").textContent = product.price_label || fmt(product.price);
    
    // Stock holati
    const stockEl = $("pm-stock");
    if (product.stock > 10) {
      stockEl.textContent = "Omborda bor";
      stockEl.className = "pm-stock in-stock";
    } else if (product.stock > 0) {
      stockEl.textContent = `${product.stock} ta qoldi`;
      stockEl.className = "pm-stock low-stock";
    } else {
      stockEl.textContent = "Tugagan";
      stockEl.className = "pm-stock out-of-stock";
    }
    
    $("pm-desc").textContent = product.description || "";
    
    // Specs (agar bo'lsa)
    const specs = $("pm-specs");
    specs.innerHTML = "";
    if (product.specs && typeof product.specs === "object") {
      Object.entries(product.specs).forEach(([key, val]) => {
        const row = el("div", "pm-spec-row");
        row.innerHTML = `<span class="pm-spec-label">${esc(key)}</span><span class="pm-spec-value">${esc(val)}</span>`;
        specs.appendChild(row);
      });
    }
    
    // Yoqtirgan tugmasi
    const wishBtn = $("pm-wishlist");
    wishBtn.classList.toggle("active", !!(S.favorites && S.favorites.has(product.id)));
    wishBtn.classList.remove("hidden");

    // Quantity
    $("pm-qty-val").textContent = modalQuantity;
    
    // Savatga qo'shish tugmasi
    const addBtn = $("pm-add-cart");
    if (product.stock > 0) {
      addBtn.textContent = "Savatga qo'shish";
      addBtn.disabled = false;
    } else {
      addBtn.textContent = "Tugagan";
      addBtn.disabled = true;
    }
    
    modal.classList.remove("hidden");
    
    // Body scroll lock
    document.body.style.overflow = "hidden";
    
    // Animatsiya uchun ozgina kechikish
    requestAnimationFrame(() => {
      modal.style.animation = "modalSlideUp 0.35s cubic-bezier(0.34, 1.56, 0.64, 1)";
    });
    
    haptic("light");
    
    // Scroll listener - rasm o'zgarishi
    slider.addEventListener("scroll", handleModalScroll, { passive: true });
    
    // Touch swipe gestures
    setupTouchGestures(slider);
  }

  function setupTouchGestures(slider) {
    slider.addEventListener("touchstart", (e) => {
      touchStartX = e.changedTouches[0].screenX;
    }, { passive: true });
    
    slider.addEventListener("touchend", (e) => {
      touchEndX = e.changedTouches[0].screenX;
      handleSwipeGesture();
    }, { passive: true });
  }

  function handleSwipeGesture() {
    const swipeThreshold = 50;
    const diff = touchStartX - touchEndX;
    
    if (Math.abs(diff) > swipeThreshold) {
      if (diff > 0) {
        // Swipe left - keyingi rasm
        navigateImage(1);
      } else {
        // Swipe right - oldingi rasm
        navigateImage(-1);
      }
    }
  }

  function navigateImage(direction) {
    if (!currentProduct) return;
    const images = productImages(currentProduct);
    const newIndex = currentImageIndex + direction;

    if (newIndex >= 0 && newIndex < images.length) {
      scrollToImage(newIndex);
      haptic("light");
    }
  }

  function scrollToImage(index) {
    const slider = $("pm-slider");
    const width = slider.offsetWidth;
    slider.scrollTo({
      left: width * index,
      behavior: "smooth"
    });
  }

  function handleModalScroll() {
    const slider = $("pm-slider");
    const scrollLeft = slider.scrollLeft;
    const width = slider.offsetWidth;
    const newIndex = Math.round(scrollLeft / width);
    
    if (newIndex !== currentImageIndex) {
      currentImageIndex = newIndex;
      updateModalDots();
      haptic("selection");
    }
  }

  function updateModalDots() {
    const dots = $("pm-dots").children;
    for (let i = 0; i < dots.length; i++) {
      if (i === currentImageIndex) {
        dots[i].classList.add("on");
        dots[i].style.transform = "scale(1.1)";
      } else {
        dots[i].classList.remove("on");
        dots[i].style.transform = "scale(1)";
      }
    }
  }

  function closeProductModal() {
    const modal = $("productModal");
    
    // Animatsiya bilan yopish
    modal.style.animation = "modalSlideDown 0.25s cubic-bezier(0.4, 0, 1, 1)";
    
    setTimeout(() => {
      modal.classList.add("hidden");
      modal.style.animation = "";
      document.body.style.overflow = "";
    }, 250);
    
    currentProduct = null;
    const slider = $("pm-slider");
    slider.removeEventListener("scroll", handleModalScroll);
    
    haptic("light");
  }

  function updateModalQuantity(delta) {
    if (!currentProduct) return;
    const newQty = modalQuantity + delta;
    if (newQty < 1) return;
    if (newQty > currentProduct.stock) {
      toast(`Omborda faqat ${currentProduct.stock} ta bor`);
      return;
    }
    modalQuantity = newQty;
    $("pm-qty-val").textContent = modalQuantity;
    haptic("light");
  }

  function addFromModal() {
    if (!currentProduct || currentProduct.stock < 1) return;
    
    addToCart(currentProduct, modalQuantity);
    
    // Success animatsiya
    const btn = $("pm-add-cart");
    const originalText = btn.textContent;
    btn.textContent = "✓ Qo'shildi!";
    btn.style.background = "linear-gradient(135deg, #2fd45f 0%, #1ea84a 100%)";
    
    toast(`✅ ${modalQuantity} ta savatga qo'shildi`);
    haptic("success");
    
    // Modalni yopish
    setTimeout(() => {
      btn.textContent = originalText;
      btn.style.background = "";
      closeProductModal();
      modalQuantity = 1;
    }, 800);
  }

  /** Zaxira rejimda buyurtma — Cloudflare Worker orqali.
   *
   *  Worker: imzoni tekshiradi -> katalogdan HAQIQIY narxni oladi ->
   *  summani o'zi hisoblaydi -> qoldiqni tekshiradi -> Firebase'ga yozadi ->
   *  qoldiqni atomik kamaytiradi -> adminga va mijozga xabar yuboradi.
   *
   *  Bizdan yuborilgan narx/summa Worker tomonida UMUMAN O'QILMAYDI, ya'ni
   *  brauzerdan soxta summa yuborish imkonsiz.
   */
  function placeOrderViaWorker(paymentLabel, openAdminChat) {
    return withPhone(async () => {
      const btn = $("pay-done");
      if (btn) {
        btn.disabled = true;
        btn.textContent = "Yuborilmoqda...";
      }

      // Idempotent kalit: ikki marta bosilsa Worker BITTA buyurtma yaratadi.
      // Savat tarkibiga bog'lab yasaymiz, shunda savat o'zgarsa kalit ham
      // o'zgaradi va yangi buyurtma bo'ladi.
      const key = orderKey();

      try {
        const res = await ZimmerOffline.createOrder({
          items: S.cart.map((i) => ({ product_id: i.id, qty: i.qty })),
          address: S.delivery.address,
          phone: (S.me && S.me.phone) || "",
          full_name: (S.me && S.me.full_name) || "",
          delivery_method: S.delivery.method,
          delivery_info: S.delivery.summary,
          payment_method: paymentLabel,
          client_key: key,
        });

        S.cart = [];
        saveCart();
        renderCart();
        S.delivery = null;
        S.dlvMethod = null;
        haptic("ok");
        closeSheet();
        burst();

        const code = (res.order && res.order.code) || "";
        toast(`✅ Buyurtma ${code} qabul qilindi`, 3600);

        // Yangi buyurtmani darhol tarixga qo'shamiz (Worker'ni qayta
        // so'ramasdan) — mijoz uni profilda ko'radi.
        S.offlineOrders = [
          {
            code,
            total: res.order.total,
            total_label: res.order.total_label,
            status: "new",
            address: (S.me && S.me.address) || "",
            items: [],
            createdAt: Date.now(),
          },
          ...(S.offlineOrders || []),
        ];

        if (!res.notified) {
          // Adminga xabar ketmagan bo'lsa — mijozga ROSTINI aytamiz.
          // Avto_A1 da bu holat jimgina yutilardi va buyurtma "yo'qolardi".
          toast("⚠️ Buyurtma saqlandi, lekin adminga xabar ketmadi", 5000);
        }

        show("profile");
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
        // Qoldiq yetmasa Worker `problems` qaytaradi — aniq aytamiz
        if (err && err.problems && err.problems.length) {
          const names = err.problems.map((p) => p.name || "#" + p.product_id).join(", ");
          toast(`❌ Yetarli emas: ${names}`, 5000);
          return;
        }
        toast(`❌ ${(err && err.message) || "Buyurtma yuborilmadi"}`, 5000);
      }
    });
  }

  /** Savat tarkibidan idempotent kalit — bir xil savat = bir xil kalit. */
  function orderKey() {
    const parts = S.cart
      .map((i) => `${i.id}x${i.qty}`)
      .sort()
      .join("|");
    let hash = 5381;
    const text = parts + "|" + (S.delivery ? S.delivery.address : "");
    for (let i = 0; i < text.length; i++) hash = ((hash * 33) ^ text.charCodeAt(i)) >>> 0;
    return "k" + hash.toString(36);
  }

  /** Modaldagi yurak — ASOSIY `toggleFavorite` ga topshiriladi, ya'ni holat
      serverga (`POST /api/favorites`) yoziladi va boshqa qurilmada ham saqlanadi.
      Ilgari bu funksiya faqat `localStorage` ga yozardi: ilova qayta ochilganda
      «Saqlanganlar» bo'limi serverdan o'qib, belgilar yo'qolib ketardi. */
  async function toggleModalWishlist() {
    if (!currentProduct) return;
    const btn = $("pm-wishlist");
    await toggleFavorite(currentProduct, null);
    const saved = !!(S.favorites && S.favorites.has(currentProduct.id));
    if (btn) btn.classList.toggle("active", saved);
    saveFavorites();
    updateSavedCount();
    // Grid'dagi yuraklar ham yangilanadi
    if (S.shopProducts) renderCatalog();
  }

  // Event listenerlar
  function initProductModal() {
    $("pm-close").onclick = closeProductModal;
    $("pm-wishlist").onclick = toggleModalWishlist;
    $("pm-qty-minus").onclick = () => updateModalQuantity(-1);
    $("pm-qty-plus").onclick = () => updateModalQuantity(1);
    $("pm-add-cart").onclick = addFromModal;
    
    // Tashqariga bosib yopish
    $("productModal").onclick = (e) => {
      if (e.target.id === "productModal") closeProductModal();
    };
    
    // ESC tugmasi bilan yopish
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && currentProduct) {
        closeProductModal();
      }
    });
  }

  // Yordamchi funksiya: saqlanganlarni localStorage ga yozish
  function saveFavorites() {
    try {
      localStorage.setItem("zimmer_favorites", JSON.stringify([...S.favorites]));
    } catch (_) {}
  }

  // Yordamchi funksiya: saqlangan mahsulotlar sonini yangilash
  function updateSavedCount() {
    const count = S.favorites ? S.favorites.size : 0;
    const obj = $("pf-stat-saved");
    if (obj) animateStat("pf-stat-saved", count);
  }

  boot();
  initProductModal();
})();
