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

  /* ====================================================================
     MAHALLIY SAQLASH KALITLARI

     DIQQAT: bular `S` dan OLDIN e'lon qilinishi SHART. `S` yasalayotganda
     `cart: loadCart()` chaqiriladi va u `CART_KEY` ga murojaat qiladi —
     kalit pastda e'lon qilingan bo'lsa `const` TDZ sababli ilova
     ochilishida `ReferenceError` bilan yiqilardi.

     Har bir kalitga foydalanuvchi ID'si qo'shiladi (`userKey`) — bitta
     telefondan ikki akkaunt kirsa ma'lumot aralashmasligi uchun.
     ==================================================================== */
  const CART_KEY = "zimmer_cart";
  /* Fon musiqasi yoqilganmi. Foydalanuvchiga bog'lanmaydi (`userKey`
     ishlatilmaydi): bu qurilma sozlamasi, bir telefondan ikki kishi
     kirsa ham ovoz kutilmaganda yonib ketmasligi kerak. */
  const MUSIC_KEY = "zimmer_music_on";
  const ADDR_KEY = "zimmer_addresses";
  const SEEN_KEY = "zimmer_seen";
  const FAV_KEY = "zimmer_favorites";
  const OFFLINE_KEY = "zimmer_offline_favorites";

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
    favLoaded: false, // saqlanganlar serverdan olindimi (Firebase manbasida)
    catIndex: 0,
    shopCat: null, // tanlangan kategoriya (null = hammasi)
    /* Do'kon qidiruvi va saralash.
       Ilgari ilovada tovar qidiruvi UMUMAN yo'q edi va tartib qattiq
       «yangi id avval» bo'lardi. */
    shopQ: "", // qidiruv matni
    /* Natija ANIQ moslik bilan emas, bitta-ikkita harf xatosiga yo'l
       qo'yib topilganmi (`fuzzyMatches`). Shunda mijozga «aynan
       topilmadi — o'xshashlar» deb aytiladi. */
    shopFuzzy: false,
    shopSort: "new", // new | cheap | dear | name
    shopMyCar: false, // faqat mashinamga mos
    shopInStock: false, // faqat omborda bor
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
    coStep: 1, // rasmiylashtirish oynasidagi qadam: 1 | 2 | 3
    payMethod: null, // tanlangan to'lov usuli: "card" | "app" | "cash"
    /* Xizmatlar ro'yxati (kesh). `servicesFallback` — server bo'sh
       ro'yxat bergani va ichki zaxira ishlatilgani belgisi. */
    services: null,
    servicesFallback: false,
    svcIndex: 0, // «Xizmatlar» da bosilgan plitka (alohida oyna uchun)
    pay: {}, // karta rekvizitlari (/api/config dan)

    /* ---- BUYURTMALARIM (uch bo'lim, uch oyna) ----
       `my` — uchala ro'yxatning KESHI. Kabinet ochilganda bir marta
       yig'iladi, shuning uchun bo'limga kirish ONI ochiladi (kutish yo'q),
       so'ng fonda jimgina yangilanadi. `myAt` — keshning vaqti (ms). */
    my: { order: [], biled: [], booking: [] },
    myAt: 0,
    myLoading: false,
    moKind: "order", // ochilgan bo'lim: "order" | "biled" | "booking"
    moFilter: "all", // filtr chipi: all | new | run | done | cancelled
    moQ: "", // qidiruv matni
    moOpen: null, // kengaytirilgan kartochka kaliti (akkordeon)
    /* Katalog yuklanishi: bir vaqtda ikki so'rov ketmasligi uchun joriy
       Promise shu yerda turadi (`loadHome`). Ilgari qorovul yo'q edi va
       ikki chaqiruv bir-birining natijasini ustiga yozardi. */
    homeLoading: null,
    homeAt: 0, // katalog qachon yuklangani (ms) — `isHomeStale()` uchun
    /* ---- 🎓 SHOGIRD (ilova ichidagi yordamchi) ----
       `msgs` — yozishma (faqat xotirada: bo'limlar orasida yurganda
       saqlanadi, lekin ilova qayta ochilsa toza boshlanadi — serverdagi
       xotira ham 30 daqiqada o'chadi, ya'ni ikkisi mos keladi).
       `aiOn` — `/api/config: ai_enabled`. `false` bo'lsa Shogird
       serverga bezovta qilmasdan, to'g'ridan-to'g'ri mahalliy bilimdan
       javob beradi. */
    sg: { msgs: [], busy: false, aiOn: true },
    // Zaxira rejim: server javob bermaydi, katalog Firebase'dan o'qilgan.
    // Bu holatda faqat KO'RISH mumkin — buyurtma/navbat bloklanadi.
    offline: false,
    // Sahifalar bo'yicha scroll holati (`show()` tiklaydi)
    scroll: {},
  };

  const fmt = (v) =>
    (Number(v) || 0).toLocaleString("ru-RU").replace(/,/g, " ") + " " + S.currency;

  /** Tebranish. Telegram `impactOccurred` faqat light/medium/heavy/rigid/soft
   *  ni biladi — boshqa so'z berilsa xato tashlaydi va tebranish YO'Q bo'ladi.
   *
   *  Kod bo'ylab `haptic("success")` va `haptic("error")` ham yozilgan
   *  (admin-shop.js, app.js) — ular `impactOccurred("success")` ga tushib
   *  jimgina yiqilardi, ya'ni tovar saqlanganda telefon tebranmasdi. Endi
   *  ikkala nom ham tushunarli. */
  function haptic(kind) {
    try {
      if (kind === "ok" || kind === "success") {
        tg.HapticFeedback.notificationOccurred("success");
      } else if (kind === "err" || kind === "error" || kind === "fail") {
        tg.HapticFeedback.notificationOccurred("error");
      } else if (kind === "warn" || kind === "warning") {
        tg.HapticFeedback.notificationOccurred("warning");
      } else {
        tg.HapticFeedback.impactOccurred(kind || "light");
      }
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

  /* ====================================================================
     TOAST — NAVBAT BILAN VA «QAYTARISH» TUGMASI

     ILGARI NIMA XATO EDI
     `toast()` bitta joyga yozardi: `clearTimeout` + ustidan yozish. Ya'ni
     ketma-ket ikki xabar chiqsa BIRINCHISI KO'RINMASDI. Kodda aynan
     ketma-ket toast yuboradigan joy bor (buyurtma xatosida bir necha
     muammo bir vaqtda aytiladi) — ular yo'qolardi.

     `toastProgress` degan keyframe stylesheet'da ALLAQACHON bor edi, ya'ni
     navbat o'ylangan, lekin yozilmagan.

     ENDI: xabarlar navbatga tushadi va ketma-ket ko'rsatiladi. Ixtiyoriy
     «Qaytarish» tugmasi bilan — shu tufayli o'chirishdan oldin tasdiq
     so'rash kerak emas (bir bosish kamayadi va noto'g'ri o'chirish ham
     tuzatiladi).
     ==================================================================== */

  const _toastQueue = [];
  let _toastBusy = false;

  /** @param {string} msg
   *  @param {number|{ms?:number, undo?:Function, undoLabel?:string}} [opts] */
  function toast(msg, opts) {
    const conf = typeof opts === "number" ? { ms: opts } : opts || {};
    _toastQueue.push({
      msg: String(msg == null ? "" : msg),
      ms: conf.ms || 2800,
      undo: typeof conf.undo === "function" ? conf.undo : null,
      undoLabel: conf.undoLabel || "Qaytarish",
    });
    // Navbat cheksiz o'smasin (masalan tarmoq uzilib ko'p xato kelsa)
    if (_toastQueue.length > 6) _toastQueue.splice(0, _toastQueue.length - 6);
    if (!_toastBusy) _toastNext();
  }

  function _toastNext() {
    const node = $("toast");
    if (!node) return;

    const item = _toastQueue.shift();
    if (!item) {
      _toastBusy = false;
      node.classList.add("hidden");
      return;
    }
    _toastBusy = true;

    node.innerHTML = "";
    node.append(el("span", "toast-tx", esc(item.msg)));

    let closed = false;
    const close = () => {
      if (closed) return;
      closed = true;
      clearTimeout(toast._t);
      node.classList.add("hidden");
      // Chiqish animatsiyasi tugagach keyingisini ko'rsatamiz
      setTimeout(_toastNext, 180);
    };

    if (item.undo) {
      const btn = el("button", "toast-undo", esc(item.undoLabel));
      btn.onclick = () => {
        haptic("ok");
        try {
          item.undo();
        } catch (err) {
          console.error("[toast] qaytarish xatosi:", err);
        }
        close();
      };
      node.append(btn);
    }

    // «Qaytarish» bor bo'lsa mijozga o'ylash uchun ko'proq vaqt beramiz
    const life = item.undo ? Math.max(item.ms, 4500) : item.ms;
    /* Progress chizig'i (`.toast::after`) AYNAN shuncha davom etadi.
       Ilgari u CSS'da qattiq 2.8 s edi va uzoqroq turgan xabarda vaqtni
       yolg'on ko'rsatardi (chiziq tugagan, xabar hali turgan). */
    node.style.setProperty("--toast-ms", life + "ms");

    node.classList.remove("hidden");
    clearTimeout(toast._t);
    toast._t = setTimeout(close, life);
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
  /* `alt` — ixtiyoriy uchinchi argument.
     Ilgari BARCHA yasalgan rasmlarda `alt=""` edi, hatto tovar nomi
     mavjud bo'lganda ham. Bo'sh `alt` skrinreaderga «bu rasmni
     e'tiborsiz qoldir» degani — bezak uchun to'g'ri, TOVAR uchun esa
     mijoz nimani ko'rayotganini bilmaydi. */
  const img = (src, cls, alt) =>
    src
      ? `<img ${cls ? `class="${cls}"` : ""} src="${esc(src)}" alt="${esc(alt || "")}" loading="lazy" ${FALLBACK}>`
      : "";

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

  /** Ism va telefonni saqlaydi va `S.me` ni yangilaydi.
   *
   *  IKKI joyda ishlatiladi: pastdan chiqadigan profil paneli
   *  (`openPhoneSheet` — profilni tahrirlash va to'siq ekrani) hamda
   *  rasmiylashtirish oynasining 1-qadami. Ilgari bu mantiq faqat panel
   *  ichida edi; oyna uchun nusxa yozilsa, ertaga saqlash yo'li o'zgarganda
   *  bittasi eskirib qolardi. */
  async function persistContact(fullName, value) {
    if (!S.me) S.me = {};
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
    return res;
  }

  /** «📱 Telegram raqamimni yuborish» tugmasini ko'rsatilgan maydonga ulaydi. */
  function wireRequestContact(btnId, inputId) {
    const btn = $(btnId);
    if (!btn) return;
    btn.onclick = () => {
      haptic();
      if (tg && typeof tg.requestContact === "function") {
        try {
          tg.requestContact((granted, response) => {
            if (!granted) return toast("Raqam ulashilmadi — qo'lda kiritishingiz mumkin");
            const got = extractPhone(response);
            if (!got) return toast("Raqamni qo'lda kiritib, davom etishni bosing");
            const input = $(inputId);
            if (input) input.value = got;
            haptic("ok");
            toast("Raqam olindi ✅");
          });
          return;
        } catch (_) {}
      }
      toast("Telegram versiyasi qo'llamaydi — raqamni qo'lda kiriting");
    };
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

    wireRequestContact("reg-contact", "reg-phone");

    $("reg-save").onclick = async () => {
      const btn = $("reg-save");
      const fullName = $("reg-name").value.trim();
      const value = $("reg-phone").value.trim();
      if (fullName.length < 2) return toast("Ismingizni kiriting");
      if (value.replace(/\D/g, "").length < 9) return toast("Telefon raqamni to'liq kiriting");

      btn.disabled = true;
      btn.textContent = "Saqlanmoqda...";
      try {
        await persistContact(fullName, value);
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

  /* ====================================================================
     MAHALLIY SAQLASH — HAR FOYDALANUVCHIGA ALOHIDA

     ILGARI NIMA XATO EDI
     Savat, manzillar va saqlanganlar QURILMA BO'YICHA umumiy kalitda
     turardi (`zimmer_cart`, `zimmer_addresses`, ...). Bitta telefondan
     ikki akkaunt kirsa (ota-bola, do'kon telefoni) — savat, manzillar va
     saqlanganlar ARALASHIB ketardi. Ya'ni bir odam boshqasining savatini
     va uy manzilini ko'rardi.

     Qizig'i: profil uchun bu TO'G'RI qilingan edi (`offlineMe()` keshni
     `initDataUnsafe.user.id` bilan tekshiradi) — o'sha usul savatga
     qo'llanmagan edi.

     ENDI kalitlar `...:<telegram_id>` ko'rinishida. Eski (umumiy) kalitda
     ma'lumot qolgan bo'lsa bir marta KO'CHIRILADI — mijoz savatini
     yo'qotmaydi.
     ==================================================================== */

  /** Joriy foydalanuvchining Telegram ID'si (matn ko'rinishida).
   *
   *  DIQQAT: bu FUNKSIYA DEKLARATSIYASI (`const` emas). Sabab: `S` obyekti
   *  yasalayotganda `cart: loadCart()` chaqiriladi va u shu funksiyaga
   *  tayanadi. `const` bo'lsa o'sha payt hali e'lon qilinmagan bo'lardi
   *  (TDZ) va ilova ochilishida `ReferenceError` bilan yiqilardi.
   */
  function myUid() {
    // `S` hali yasalmagan bo'lishi mumkin (yuqoridagi izohga qara). `const`
    // o'zgaruvchiga e'londan OLDIN murojaat qilish `ReferenceError` beradi —
    // hatto `typeof` ham. Shuning uchun try/catch bilan o'raymiz.
    let fromState = "";
    try {
      fromState = (S.me && S.me.user_id) || "";
    } catch (_) {
      fromState = "";
    }
    const fromTg =
      tg && tg.initDataUnsafe && tg.initDataUnsafe.user && tg.initDataUnsafe.user.id;
    return String(fromState || fromTg || "");
  }

  /** Foydalanuvchiga bog'langan localStorage kaliti. */
  function userKey(base) {
    const uid = myUid();
    return uid ? `${base}:${uid}` : base;
  }

  /** Eski umumiy kalitdagi ma'lumotni foydalanuvchi kalitiga ko'chiradi. */
  function migrateKey(base) {
    const key = userKey(base);
    if (key === base) return key; // uid yo'q — ko'chirishga hojat yo'q
    try {
      if (localStorage.getItem(key) === null) {
        const old = localStorage.getItem(base);
        if (old !== null) {
          localStorage.setItem(key, old);
          localStorage.removeItem(base);
        }
      }
    } catch (_) {}
    return key;
  }

  /* ------------------------------------------------------------- savatcha */
  function loadCart() {
    try {
      const raw = JSON.parse(localStorage.getItem(migrateKey(CART_KEY)) || "[]");
      if (!Array.isArray(raw)) return [];
      /* Har bir qatorni TEKSHIRAMIZ. Ilgari faqat `Array.isArray` ko'rilardi,
         ya'ni buzilgan yozuv (qo'lda tahrirlangan yoki eski versiyadan
         qolgan) to'g'ridan savatga tushardi va `cartSum()` da `NaN` chiqarib
         butun savatni ishdan chiqarardi. */
      return raw.filter(
        (i) =>
          i &&
          typeof i === "object" &&
          i.id != null &&
          Number.isFinite(Number(i.price)) &&
          Number.isFinite(Number(i.qty)) &&
          Number(i.qty) > 0
      );
    } catch (_) {
      return [];
    }
  }
  function saveCart() {
    localStorage.setItem(userKey(CART_KEY), JSON.stringify(S.cart));
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
    refreshQuickBadges(); // bosh sahifadagi «Savatcha» plitkasi
  }
  const cartSum = () => S.cart.reduce((s, i) => s + i.price * i.qty, 0);

  /* ---------------------------------------------------------- navigatsiya */

  /* Sahifalar orasida SCROLL HOLATI saqlanadigan ro'yxat.
     Bu ro'yxatdagi sahifaga qaytilganda mijoz avval qaragan joyda
     paydo bo'ladi. Qolganlari (oqimlar, oynalar) doim tepadan boshlanadi. */
  const KEEP_SCROLL = ["home", "saved", "orders"];

  function show(page) {
    /* ================================================================
       SCROLL HOLATINI SAQLAYMIZ

       Ilgari `show()` oxirida shartsiz `window.scrollTo({top: 0})`
       turardi. Natijada mijoz katalogni uzoq varaqlab, tovar oynasini
       ochib, keyin yopsa — katalogning ENG BOSHIGA tushardi va o'sha
       joyni qaytadan izlashi kerak bo'lardi. Bu ro'yxatdagi eng
       bezovta qiluvchi kamchilik edi.
       ================================================================ */
    if (S.page && KEEP_SCROLL.includes(S.page)) {
      S.scroll[S.page] = window.scrollY || 0;
    }

    [
      "splash",
      "gate",
      "flow",
      "home",
      "cart",
      "saved",
      "profile",
      "admin",
      "checkout",
      // Xizmatlar bo'limi (pastdagi navigatsiyada «🛠 Xizmatlar»)
      "services",
      // Bitta xizmatning alohida oynasi (plitka bosilganda)
      "service",
      // 🎓 Shogird — yordamchi bilan yozishma
      "shogird",
      // Kabinetning ichki oynalari: buyurtmalarim (uch bo'lim) va manzillarim.
      "orders",
      "addresses",
    ].forEach((p) => {
      const node = $(p);
      if (node) node.classList.toggle("hidden", p !== page);
    });
    S.page = page;

    // Konfiguratorda o'zining sticky CTA'si bor — navbar yashiriladi.
    // Rasmiylashtirish oynasi ham navbarsiz: u to'liq ekranli oyna va
    // o'zining «‹ orqaga» hamda «✕ yopish» tugmalari bor. Navbar tursa,
    // mijoz oqim o'rtasida boshqa bo'limga sakrab, tanlagan manzilini
    // yo'qotardi.
    /* Buyurtmalarim va Manzillarim oynalarida navbar QOLADI (checkout'dan
       farqli). Sabab: bu oynalarda mijoz hech qanday oqim o'rtasida emas —
       aksincha, «Qayta buyurtma» dan keyin darhol savatga o'tishi kerak.
       Navbar yashirilsa, u faqat «‹» orqali kabinetga, keyin savatga —
       ikki bosishga majbur bo'lardi. */
    /* «🎓 Shogird» ATAYLAB yo'q: u yozishma oynasi va pastda yozish
       maydoni turadi. Navbar ham qolsa, klaviatura ochilganda uch qatlam
       (klaviatura + yozish maydoni + navbar) ekranni siqib qo'yardi va
       yozgan matn ko'rinmasdi. Chiqish uchun tepada «‹» tugmasi bor. */
    const navVisible =
      ["home", "cart", "saved", "profile", "admin", "orders", "addresses", "services"].includes(
        page
      ) && S.me;
    $("nav").classList.toggle("hidden", !navVisible);
    document
      .querySelectorAll(".nav-btn")
      .forEach((b) => b.classList.toggle("active", b.dataset.page === page));

    if (page === "cart") {
      // Katalog bilan moslashtirib chizamiz — o'chirilgan tovar savatda
      // qolib, buyurtmani yiqitmasin.
      refreshCart();
      animateCartTotal(); // jami summa 0 dan count-up bo'ladi
    }
    if (page === "checkout") renderCheckout();
    if (page === "saved") renderSaved();
    if (page === "profile") loadProfile();
    if (page === "addresses") renderAddressPage();
    if (page === "services") renderServicesPage(false);
    if (page === "service") renderServicePage();
    if (page === "shogird") sgOpen();
    /* Bo'lim (`S.moKind`) `openMyOrders()` da o'rnatiladi va shundan keyin
       `show("orders")` chaqiriladi — chizish shu yerda, bitta joyda. */
    if (page === "orders") renderMyOrdersPage();
    // Boshqaruv paneli: ONLINE bo'lsa to'liq panel (`admin.js`, Render),
    // zaxira rejimda esa Worker orqali ishlaydigan ixcham panel.
    //
    // Ilgari bu yerda `offlineBlocked()` turardi — ya'ni Render uxlaganda
    // admin umuman hech narsa qila olmasdi. Endi tovar qo'shish, narx va
    // qoldiqni o'zgartirish hamda buyurtmalarni boshqarish ishlaydi.
    // TOVAR boshqaruvi HAR DOIM `ZimmerShop` (brauzerdan to'g'ridan
    // `catalog/products` ga — Avto_A1 modeli). Render bor yoki yo'q,
    // farqi yo'q: yagona manba, yagona dizayn, chalkashlik yo'q.
    if (page === "admin") openAdminPanel();
    if (page !== "flow") stopVideos();

    // Banner taymeri faqat bosh sahifada kerak — boshqa joyda to'xtatiladi
    if (page !== "home") stopBannerTimer();
    else if (!S.bannerTimer && $("banners") && $("banners").children.length > 1) {
      startBannerTimer($("banners"));
    }

    // Saqlangan joyga qaytaramiz (yo'q bo'lsa tepaga). `behavior: "auto"` —
    // `scroll-behavior: smooth` global qo'yilgani uchun aks holda sahifa
    // har almashinuvda ANIMATSIYA bilan sakrab tushardi.
    const saved = KEEP_SCROLL.includes(page) ? S.scroll[page] || 0 : 0;
    window.scrollTo({ top: saved, behavior: "auto" });

    syncBackButton();
  }

  /** Admin panelini ochadi: kerak bo'lsa avval kodini yuklaydi.
   *
   *  Ilgari admin to'plami `index.html` da har bir mijozga yuklanardi va
   *  bu yerda shunchaki `window.ZimmerShop.open()` chaqirilardi. Endi kod
   *  faqat shu lahzada keladi, shuning uchun ochilish ASINXRON. */
  async function openAdminPanel() {
    /* ================================================================
       DIQQAT — FAQAT `#admin-body` GA TEGAMIZ, `#admin` GA EMAS.

       `#admin` bo'limi ichida index.html dan kelgan DOIMIY tuzilma bor:
           #admin-back   — orqaga tugmasi
           #admin-title  — sarlavha
           #admin-sub    — kichik sarlavha
           #admin-reload — yangilash tugmasi
           #admin-body   — panel MANA SHU YERGA chiziladi

       Barcha to'rt modul (`admin.js`, `admin-shop.js`, `admin-crm.js`,
       `admin-stories.js`) aynan shu id'larga murojaat qiladi.

       Shu sababli `$("admin").innerHTML = ""` QILISH MUMKIN EMAS — u
       `#admin-body` ni ham, sarlavhani ham, tugmalarni ham o'chiradi va
       panel boshqa hech qachon chizilmaydi.
       ================================================================ */
    const body = $("admin-body");

    // Yuklanish davomida bo'sh ekran ko'rinmasin
    if (body && !window.ZimmerShop && !window.ZimmerAdmin) {
      body.innerHTML =
        '<div class="skeleton" style="height:120px;margin-bottom:12px"></div>' +
        '<div class="skeleton" style="height:220px"></div>';
    }

    try {
      await ensureAdminBundle();
    } catch (err) {
      console.error("[admin] panel yuklanmadi:", err);
      if (body) {
        body.innerHTML = "";
        const msg = el(
          "p",
          "empty",
          "Boshqaruv paneli yuklanmadi. Internetni tekshirib, qaytadan urinib ko'ring."
        );
        const again = el("button", "btn btn-primary btn-sm", "Qaytadan urinish");
        again.style.marginTop = "12px";
        again.onclick = () => openAdminPanel();
        body.append(msg, again);
      }
      return;
    }

    // Foydalanuvchi shu orada boshqa bo'limga o'tib ketgan bo'lishi mumkin
    if (S.page !== "admin") return;

    // Skeletonni tozalaymiz (panelning o'zi ham qayta chizadi)
    if (body) body.innerHTML = "";

    if (window.ZimmerShop) window.ZimmerShop.open();
    else if (window.ZimmerAdmin) window.ZimmerAdmin.open();
    else if (body) {
      body.append(
        el("p", "empty", "Boshqaruv paneli topilmadi. Ilovani yangilab ko'ring.")
      );
    }
  }

  function syncBackButton() {
    if (!tg || !tg.BackButton) return;
    // Ustma-ust turgan qatlamlar ham «orqaga» ni talab qiladi: ilgari
    // panel yoki xarita ochiq bo'lsa tugma ko'rinmasdi va ularni yopishning
    // yagona yo'li X tugmasi edi.
    const overlay =
      sheetOpen() ||
      S.flowDone ||
      ($("map-picker-overlay") && !$("map-picker-overlay").classList.contains("hidden")) ||
      ($("addr-name-overlay") && !$("addr-name-overlay").classList.contains("hidden"));
    const need =
      overlay ||
      (S.page === "flow" && S.step > 1) ||
      [
        "cart", "saved", "profile", "checkout",
        "orders", "addresses", "services", "service", "shogird",
      ].includes(S.page);
    if (need) tg.BackButton.show();
    else tg.BackButton.hide();
  }

  function goBack() {
    /* Ustma-ust qatlamlar: avval eng ustidagisi yopiladi. Aks holda
       Telegram'ning «orqaga» tugmasi rasm ko'ruvchi ochiq turganda ham
       sahifani almashtirib yuborardi. */
    if (viewerOpen()) return closeViewer();
    if (storyOpen()) return closeStory();
    if (currentProduct) return closeProductModal();
    /* Pastdan chiqadigan panel (`#sheet`) — ilgari `goBack()` da UMUMAN
       hisobga olinmagan edi: panel ochiq turganda orqaga bosilsa sahifa
       ORQADA almashardi va mijoz panelni yopgach butunlay boshqa joyda
       paydo bo'lardi. */
    if (sheetOpen()) return closeSheet();
    /* Xarita va manzil oynalari TO'LIQ EKRAN. Ilgari ular faqat
       `addresses`/`orders` sahifasida yopilardi — ya'ni xarita
       rasmiylashtirish oynasidan ochilgan bo'lsa orqaga bosilishi
       xarita OSTIDAGI sahifani almashtirardi va ekran chalkashardi. */
    if ($("map-picker-overlay") && !$("map-picker-overlay").classList.contains("hidden")) {
      return closeMapPicker();
    }
    if ($("addr-name-overlay") && !$("addr-name-overlay").classList.contains("hidden")) {
      return closeAddrNameModal();
    }
    // «Buyurtma qabul qilindi» qatlami — orqaga bosilsa bosh menyuga
    if (S.flowDone) {
      closeFlowDone();
      return show("home");
    }
    // Admin panelning o'z ichki qatlamlari bor — avval unga imkon beramiz.
    // Zaxira rejimda boshqa panel ishlayotgani uchun avval o'shani so'raymiz.
    if (S.page === "admin") {
      if (window.ZimmerShop && window.ZimmerShop.isActive()) {
        if (window.ZimmerShop.back()) return;
      } else if (window.ZimmerAdmin && window.ZimmerAdmin.back()) {
        return;
      }
    }
    /* Rasmiylashtirish oynasi ko'p qadamli: «orqaga» avval QADAM bo'yicha
       qaytaradi va faqat birinchi qadamda savatga chiqaradi. Ilgari (pastdan
       chiqadigan panelda) orqaga bosilishi butun oqimni yopib, tanlangan
       manzil va usulni yo'qotardi. */
    if (S.page === "checkout") {
      if (S.coStep > 1) return coGo(S.coStep - 1);
      return show("cart");
    }
    /* Bitta xizmat oynasi → xizmatlar ro'yxati (chiqish animatsiyasi
       bilan), ro'yxat esa → bosh menyu. */
    if (S.page === "service") return closeService();
    if (S.page === "services") return show("home");
    /* Shogird — alohida oyna: orqaga bosilsa bosh menyuga. Yozishma
       `S.sg.msgs` da qoladi, ya'ni qaytib kirsa suhbat davom etadi. */
    if (S.page === "shogird") return show("home");
    /* Kabinetning ichki oynalari har doim KABINETGA qaytadi (bosh sahifaga
       emas) — mijoz qaysi bo'limdan kelganini yo'qotmasin. Xarita va
       manzil oynalari ustma-ust turgan bo'lsa, avval ular yopiladi. */
    // Xarita/manzil oynalari yuqorida (sahifadan qat'i nazar) yopiladi
    if (S.page === "addresses" || S.page === "orders") return show("profile");
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

  /** Konfigurator qadamini ko'rsatadi.
   *
   *  DIQQAT: har bir DOM murojaati TEKSHIRILADI. Ilgari bu yerda
   *  `$(s.node).classList` to'g'ridan chaqirilardi va agar element
   *  yo'q bo'lsa (`showDone()` DOM'ni qayta yozgandan keyin shunday
   *  bo'lardi) `TypeError` chiqib konfigurator butunlay o'lardi. */
  function setStep(step) {
    // «Buyurtma qabul qilindi» qatlami ochiq bo'lsa — avval yopamiz
    if (S.flowDone) closeFlowDone();

    S.step = Math.max(1, Math.min(STEPS.length, step));
    const cur = STEPS[S.step - 1];

    STEPS.forEach((s, i) => {
      const node = $(s.node);
      if (node) node.classList.toggle("hidden", i !== S.step - 1);
    });
    setText("flow-title", cur.title);
    setText(
      "flow-sub",
      S.step === STEPS.length ? "Yakuniy qadam" : `${S.step}-qadam / ${STEPS.length - 1}`
    );
    const fill = $("progress-fill");
    if (fill) fill.style.width = (S.step / STEPS.length) * 100 + "%";
    const back = $("flow-back");
    if (back) back.style.visibility = S.step > 1 ? "visible" : "hidden";

    const preview = $("preview");
    if (preview) preview.classList.toggle("hidden", S.step < 2);
    if (S.step >= 2) {
      S.previewTab = "art";
      drawPreview();
    } else {
      stopVideos();
    }
    if (S.step === STEPS.length) renderSummary();

    const cta = $("flow-cta");
    if (cta) cta.classList.toggle("hidden", S.step < 2);
    updateCta();
    updateTotal();
    syncBackButton();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  /** Elementga matn yozadi (element yo'q bo'lsa jimgina o'tadi). */
  function setText(id, value) {
    const node = $(id);
    if (node) node.textContent = value;
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
    if (!btn) return;
    if (S.step === STEPS.length) btn.textContent = "Buyurtmani yuborish";
    else if (S.step === 3 && !S.shroud) btn.textContent = "O'tkazib yuborish";
    else if (S.step === 4 && !S.color) btn.textContent = "O'tkazib yuborish";
    else btn.textContent = "Davom etish";
  }

  function updateTotal() {
    const node = $("flow-total");
    if (!node) return;
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

  /** Mashinalar ro'yxatini yakuniy holatga keltiradi.
   *
   *  Server (yoki bulut) BO'SH ro'yxat qaytarsa — `docs/js/cars.js` dagi
   *  ichki ro'yxat ishlatiladi (O'zbekistondagi asosiy GM/Chevrolet
   *  modellari, Damas'dan Tahoe'gacha). Ilgari bunday holatda konfigurator
   *  «Hozircha mashinalar qo'shilmagan» deb turib qolardi va mijoz
   *  hech narsa qila olmasdi.
   *
   *  DIQQAT: ro'yxatlar QO'SHILMAYDI. Bazada mashina bo'lsa faqat u
   *  ko'rsatiladi — aks holda admin o'chirgan model ichki ro'yxatdan
   *  qaytib kelib turardi. */
  function useCars(list) {
    const arr = Array.isArray(list) ? list.filter(Boolean) : [];
    if (arr.length) return arr;
    const built = (window.ZimmerCars && window.ZimmerCars.list) || [];
    return built.slice();
  }

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

    /* Tanlov serverga yozilmaydigan ikki holat:
         • zaxira rejim (server javob bermayapti);
         • mashina ICHKI ro'yxatdan olingan (`_fallback`) — uning id'si
           bazada yo'q, so'rov 404 bilan yiqilib mijozga tushunarsiz xato
           ko'rsatardi.
       Ikkalasida ham tanlov ekranda to'liq ishlaydi. */
    if (S.offline || car._fallback) {
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
      // Mashina o'zgardi — katalog unga bog'liq, MAJBURAN qayta o'qiymiz
      loadHome({ force: true });
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
      // Zaxira rejimda variantlar Firebase'dan o'qiladi. `biled_types`,
      // `shrouds`, `optic_colors` allaqachon bulutga ko'chiriladi —
      // shu paytgacha faqat o'qilmasdi, shuning uchun konfigurator
      // Render'siz ishlamasdi.
      S.tuning = S.offline
        ? await ZimmerOffline.tuning()
        : await api("/api/tuning");
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
        // Bazaga to'g'ridan yoziladi — Render kerak emas.
        const res = S.offline
          ? await ZimmerOffline.createBiledOrder({
              uid: (S.me && (S.me.user_id || S.me.id)) || 0,
              car_id: S.car.id,
              car_name: S.car.name || "",
              biled_id: S.biled.id,
              biled_name: S.biled.name || "",
              biled_price: S.biled.price || 0,
              shroud_id: S.shroud ? S.shroud.id : null,
              shroud_name: S.shroud ? S.shroud.name : "",
              shroud_price: S.shroud ? S.shroud.price : 0,
              color_id: S.color ? S.color.id : null,
              color_name: S.color ? S.color.name : "",
              color_price: S.color ? S.color.price : 0,
              comment: $("order-comment").value.trim(),
              name: (S.me && (S.me.full_name || S.me.first_name)) || "",
              phone: (S.me && S.me.phone) || "",
            })
          : await api("/api/biled-orders", {
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

  /* ====================================================================
     BUYURTMA QABUL QILINDI EKRANI

     ILGARI NIMA XATO EDI
     Bu funksiya `.flow-body` ning `innerHTML` ini QAYTA YOZARDI — ya'ni
     konfiguratorning BARCHA qadamlari (`#fstep-car` … `#fstep-summary`)
     va `#cars` ro'yxati DOM'dan butunlay o'chib ketardi. Tiklanish
     yagona yo'l bilan hisoblangan edi: «Asosiy menyuga o'tish» tugmasi
     `location.reload()` qiladi.

     Lekin mijoz o'sha tugmani bosishi SHART emas. U Telegram'ning orqaga
     tugmasini yoki pastdagi menyuni bosishi mumkin. Keyin konfiguratorga
     qaytsa:

         openFlow() -> renderCars() -> $("cars") === null
                    -> setStep()   -> null.classList  => TypeError

     va konfigurator SEANS OXIRIGACHA ishlamay qolardi. `setStep()` da
     bitta ham `null` tekshiruvi yo'q edi.

     ENDI
     Xabar ALOHIDA qatlamga chiziladi (`#flow-done`), qadamlar DOM'da
     buzilmasdan qoladi. Yopilganda qatlam olib tashlanadi va konfigurator
     birinchi qadamdan qaytadan ishlaydi — sahifani qayta yuklash kerak emas
     (ya'ni savat ham yo'qolmaydi).
     ==================================================================== */
  function showDone(order) {
    stopVideos();
    $("flow-cta").classList.add("hidden");
    $("preview").classList.add("hidden");
    $("progress-fill").style.width = "100%";
    $("flow-title").textContent = "Buyurtma qabul qilindi";
    $("flow-sub").textContent = "Rahmat!";
    $("flow-back").style.visibility = "hidden";

    const body = document.querySelector(".flow-body");
    if (!body) return;

    // Qadamlarni faqat YASHIRAMIZ (o'chirmaymiz)
    STEPS.forEach((s) => {
      const node = $(s.node);
      if (node) node.classList.add("hidden");
    });

    let layer = $("flow-done");
    if (!layer) {
      layer = el("div", "done-wrap");
      layer.id = "flow-done";
      body.appendChild(layer);
    }
    layer.innerHTML = `
      <div class="done-ring"><svg viewBox="0 0 52 52"><path d="M14 27 L22 35 L38 18"/></svg></div>
      <h2>Buyurtma #${esc(order.id)} qabul qilindi</h2>
      <p>${esc(order.summary)}<br><b style="color:#fff">${esc(order.total_label)}</b></p>
      <p>Mutaxassisimiz tez orada bog'lanib, o'rnatish vaqtini kelishadi. 🔧</p>
      <button class="btn btn-primary" id="done-home">Asosiy menyuga o'tish</button>`;
    layer.classList.remove("hidden");
    S.flowDone = true;

    $("done-home").onclick = () => {
      closeFlowDone();
      show("home");
      loadHome({ force: isHomeStale() });
    };
  }

  /** «Buyurtma qabul qilindi» qatlamini olib tashlaydi va konfiguratorni
   *  ishlashga qaytaradi. Sahifa QAYTA YUKLANMAYDI — savat saqlanadi. */
  function closeFlowDone() {
    const layer = $("flow-done");
    if (layer) layer.remove();
    if (!S.flowDone) return;
    S.flowDone = false;
    // Tanlovni tozalaymiz: keyingi buyurtma toza boshlanishi kerak
    S.biled = null;
    S.shroud = null;
    S.color = null;
    S.step = 1;
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

  /* `OFFLINE_KEY` fayl boshida, boshqa saqlash kalitlari bilan birga
     e'lon qilingan (`S` dan OLDIN turishi shart — TDZ). */

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
    S.homeAt = Date.now();
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
      shop_phone: c.SHOP_PHONE || "",
      delivery_city: "Samarqand",
      /* Zaxira rejimda AI ishlamaydi (server o'chgan). Shogird buni
         bilib turib mahalliy bilimga o'tadi — mijoz har savolda
         kutib, keyin xato ko'rmasin. */
      ai_enabled: false,
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
  /** Saqlangan tovar id'lari (onlayn). Server javob bermasa — mahalliy. */
  async function favoriteIds() {
    try {
      const res = await api("/api/favorites");
      return (res.items || []).map((x) => x.id);
    } catch (_) {
      return localFavorites();
    }
  }

  function localFavorites() {
    try {
      const raw = JSON.parse(localStorage.getItem(migrateKey(OFFLINE_KEY)) || "[]");
      return Array.isArray(raw) ? raw : [];
    } catch (_) {
      return [];
    }
  }

  function saveLocalFavorites() {
    try {
      localStorage.setItem(userKey(OFFLINE_KEY), JSON.stringify([...(S.favorites || [])]));
    } catch (_) {}
  }

  /** Sozlama yetishmagani uchun amal bajarilmasa (masalan WORKER_URL
   *  kiritilmagan). «Server uyg'onmoqda» degan matn OLIB TASHLANDI —
   *  mijozga serverning holati emas, aloqa yo'li kerak. */
  function offlineBlocked(what) {
    const c = window.ZIMMER_CONFIG || {};
    const lines = [`${what} hozir bajarilmadi.`, "", "Iltimos, biz bilan bog'laning:"];
    if (c.SHOP_TELEGRAM) lines.push(`Telegram: @${c.SHOP_TELEGRAM}`);
    if (c.SHOP_PHONE) lines.push(`Telefon: ${c.SHOP_PHONE}`);
    openSheet("Bog'lanish", `<p class="step-sub">${esc(lines.join("\n"))}</p>`);
    haptic("warning");
  }

  /** Kabinetdagi «Server uyg'onmoqda» izohi ham OLIB TASHLANDI —
   *  har doim yashirin turadi. */
  function setOfflineNote(on) {
    const note = $("pf-offline-note");
    if (note) note.classList.toggle("hidden", !on);
  }

  /* ====================================================================
     ZAXIRA REJIM BELGISI

     ILGARI NIMA XATO EDI
     Ikki funksiya ataylab bo'shatilgan edi: `renderOfflineBar()` chiziqni
     O'CHIRARDI, `scheduleServerRecheck()` esa hech narsa tekshirmasdi.
     Sabab to'g'ri edi — katta sariq chiziq bezovta qilardi. Lekin natija
     yomon bo'lib chiqdi:

       1. `S.offline = true` bo'lgach rejim HECH QACHON qaytmasdi —
          Render tiklansa ham buyurtma va navbat bloklangan qolardi;
       2. mijoz buni BILMASDI: u savatni to'ldirib, «Rasmiylashtirish» ni
          bosgandagina «biz bilan bog'laning» oynasini ko'rardi.

     ENDI
     Chiziq o'rniga sarlavhaga kichik, bosiladigan belgi qo'yiladi (bir
     qatorni egallamaydi) va server jimgina tekshirilib turiladi. Tiklansa
     ekran SAKRAMAYDI — faqat belgi yo'qoladi va katalog fonda yangilanadi.
     ==================================================================== */

  /** Zaxira rejim belgisini ko'rsatadi/yashiradi. */
  function renderOfflineBar() {
    // Eski katta chiziq qolgan bo'lsa olib tashlaymiz
    const bar = $("offline-bar");
    if (bar) bar.remove();

    const badge = $("offline-badge");
    if (!badge) return;
    badge.classList.toggle("hidden", !S.offline);
    setOfflineNote(S.offline);
  }

  /** Server tiklanganini jimgina tekshirib turadi.
   *
   *  Ilgari tiklanganda «✅ Server tiklandi» toast'i chiqib butun ekran
   *  qayta yuklanardi (`location.reload()`) — mijoz savatini yo'qotardi.
   *  Endi hech narsa sakramaydi: rejim o'chadi va katalog fonda yangilanadi.
   */
  function scheduleServerRecheck() {
    if (S._recheck) {
      clearInterval(S._recheck);
      S._recheck = null;
    }
    if (!S.offline) return;

    S._recheck = setInterval(async () => {
      if (!S.offline) {
        clearInterval(S._recheck);
        S._recheck = null;
        return;
      }
      // Sahifa fonda bo'lsa tarmoqni bezovta qilmaymiz
      if (document.hidden) return;
      try {
        const me = await api("/api/me");
        if (!me) return;
        S.me = me;
        S.offline = false;
        clearInterval(S._recheck);
        S._recheck = null;
        renderOfflineBar();
        // Katalogni serverdan qayta o'qiymiz (narx/qoldiq yangilanadi)
        loadHome({ force: true });
      } catch (_) {
        // Hali ham javob bermadi — keyingi urinishni kutamiz
      }
    }, SERVER_RECHECK_MS);
  }

  /** Serverni necha millisekundda bir tekshirish. */
  const SERVER_RECHECK_MS = 30 * 1000;

  /** Belgi bosilganda: nima ishlayotganini tushuntiradi. */
  function explainOffline() {
    haptic("warn");
    openSheet(
      "Aloqa yo'q",
      '<p class="step-sub">' +
        esc(
          "Server bilan aloqa yo'q. Do'kon, narxlar va konfigurator " +
            "ishlayapti — ularni ko'rishingiz mumkin.\n\n" +
            "Buyurtma va navbat vaqtincha qabul qilinmaydi. Aloqa " +
            "tiklanishi bilan bu belgi o'zi yo'qoladi."
        ) +
        "</p>"
    );
  }

  /* ======================================================================
     ASOSIY MENYU
     ====================================================================== */

  /** Katalogni yuklaydi va bosh sahifani chizadi.
   *
   *  @param {{force?: boolean}} opts
   *     force — keshni chetlab o'tib QAYTA o'qiydi.
   *
   *  ================================================================
   *  NEGA `force` KERAK BO'LDI
   *
   *  Ilgari bu funksiya `if (!S.home)` qorovuli bilan boshlanardi va
   *  `S.home` bir marta to'lgach BOSHQA HECH QACHON yangilanmasdi.
   *  Natijada yuqoridagi izohda yozilgan maqsad — «admin qaysi joyga
   *  yozsa, o'zgarish DARHOL ko'rinadi» — amalda ishlamasdi:
   *
   *    • admin yangi tovar qo'shsa, mijoz ilovani YOPIB QAYTA OCHMAGUNCHA
   *      ko'rmasdi;
   *    • narx va qoldiq uzoq seansda eskirib ketardi;
   *    • admin ko'prigidagi `loadHome` (5941-qator) «tovar qo'shilgandan
   *      keyin katalogni qayta o'qish uchun» berilgan edi, lekin qorovul
   *      uni bekor qilardi.
   *
   *  Endi qorovul faqat oddiy chaqiruvda ishlaydi; `force: true` bilan
   *  chaqirilsa katalog qaytadan o'qiladi (pastga tortish, admin
   *  o'zgartirishi, «qayta urinish» tugmasi).
   *  ================================================================
   */
  /** Katalog necha millisekunddan keyin «eskirgan» hisoblanadi.
   *  2 daqiqa — admin o'zgartirishi tez ko'rinadi, lekin har bosishda
   *  qayta so'rov ham ketmaydi. */
  const HOME_TTL = 2 * 60 * 1000;

  function isHomeStale() {
    if (!S.home) return true;
    return Date.now() - (S.homeAt || 0) > HOME_TTL;
  }

  /** Bosh sahifa yuklanayotganda joy egallab turadigan skeletonlar.
   *
   *  Ilgari skeleton FAQAT tovarlar uchun bor edi (ikkita qattiq
   *  `<div class="skel">`), stories halqalari va bannerlar esa BIRDAN
   *  paydo bo'lardi — sahifa sakrardi va mijoz bosayotgan tugma
   *  siljib ketardi. */
  function showHomeSkeletons() {
    const products = $("products");
    if (products && !products.children.length) {
      products.innerHTML =
        '<div class="skel"></div><div class="skel"></div>' +
        '<div class="skel"></div><div class="skel"></div>';
    }
    const stories = $("stories");
    if (stories && !stories.children.length) {
      stories.innerHTML = new Array(5).fill('<div class="skel-ring"></div>').join("");
    }
    const banners = $("banners");
    if (banners && !banners.children.length) {
      banners.innerHTML = '<div class="skel-banner"></div>';
    }
  }

  async function loadHome(opts) {
    const force = !!(opts && opts.force);

    // Bir vaqtda ikki yuklash ketmasin: ikkisi ham `S.home` ga yozadi va
    // keyin ikkisi ham `renderCatalog()` chaqiradi — oxirgisi g'olib
    // bo'ladi, ya'ni natija tasodifiy bo'lib qoladi. `loadHome` esa
    // ko'p joydan chaqiriladi (boot, menyu, savat, admin ko'prigi,
    // pastga tortish), shuning uchun joriy so'rovni qaytaramiz.
    if (S.homeLoading) return S.homeLoading;

    S.homeLoading = _loadHome(force).finally(() => {
      S.homeLoading = null;
    });
    return S.homeLoading;
  }

  async function _loadHome(force) {
    if (force) S.home = null;
    showHomeSkeletons();
    try {
      /* ================================================================
         DO'KON MANBASI — FIREBASE BIRINCHI (Avto_A1 modeli)

         ILGARI NIMA XATO EDI
         Admin paneli tovarni FIREBASE'ga yozadi (`catalog/products` —
         `admin-shop.js`), do'kon esa onlayn holatda `/api/home` dan,
         ya'ni RENDER + SQLite dan o'qirdi. Ikki xil ombor:

             admin yozadi  ->  Firebase
             mijoz o'qiydi  ->  SQLite      ❌ mos kelmaydi

         Natijada:
           • admin o'chirgan tovar do'konda TURAVERARDI (SQLite bilmaydi);
           • yangi qo'shilgan tovar KO'RINMASDI (bot restart bo'lguncha);
           • narx o'zgarishi ham kechikardi.

         SQLite'da `deleted` degan ustun UMUMAN yo'q — ya'ni mini app'ning
         «o'chirish» belgisi u yerga hech qachon yetib bormaydi. Uni
         qo'shish ham yechim emas: ikki ombor har doim bir-biridan
         uzoqlashadi.

         Endi Avto_A1 dagidek: YAGONA manba — Firebase. Admin qaysi joyga
         yozsa, mijoz ham shu joydan o'qiydi, o'zgarish DARHOL ko'rinadi.
         `/api/home` faqat ZAXIRA: Firebase sozlanmagan yoki o'qilmagan
         holatda ishlatiladi.
         ================================================================ */
      let src = null;

      if (window.ZimmerOffline && ZimmerOffline.available()) {
        // `enterOfflineMode()` katalogni allaqachon o'qib qo'ygan bo'lishi
        // mumkin — qayta so'ramaymiz.
        //
        // Onlayn holatda `strict` rejim: Firebase o'qilmasa keshni EMAS,
        // `/api/home` ni ishlatamiz (u yangiroq).
        if (!S.home) S.home = await ZimmerOffline.home({ strict: !S.offline });
        if (S.home) src = "firebase";
      }
      if (!S.home && !S.offline) {
        S.home = await api("/api/home");
        src = "api";
      }
      if (!S.home && S.offline) {
        // Zaxira rejimda to'liq zanjir (kesh, statik nusxa)
        S.home = await ZimmerOffline.home();
        if (S.home) src = "cache";
      }
      // Zanjirning hech biri ishlamasa ham YIQILMAYMIZ: bo'sh katalog
      // bilan davom etamiz — ilovaning ochilishi to'siq ekranidan yaxshi.
      if (!S.home) S.home = EMPTY_HOME;

      /* SAQLANGANLAR. `/api/home` javobida `favorite_ids` bo'ladi, Firebase
         katalogida esa yo'q (saqlanganlar serverda turadi). Shu sababli
         Firebase'dan o'qilgan bo'lsa ularni BIR MARTA alohida olamiz. */
      if (S.offline) {
        S.favorites = new Set(localFavorites());
      } else if (src === "api") {
        S.favorites = new Set(S.home.favorite_ids || []);
      } else if (!S.favLoaded) {
        S.favorites = new Set(await favoriteIds());
        S.favLoaded = true;
      }
      // Katalogni keshlaymiz — bu 3-QATLAM zaxira. Server ham, Firebase ham
      // javob bermasa, BIR MARTA kirgan mijoz baribir do'konni ko'radi va
      // to'siq ekraniga TUSHMAYDI.
      if (window.ZimmerOffline && !S.offline) ZimmerOffline.save(S.home);

      // Yuklangan vaqt — `isHomeStale()` shundan hisoblaydi
      S.homeAt = Date.now();

      S.shopProducts = buildShopProducts(); // kategoriyasiz, random tartib
      renderOfflineBar();
      renderStories();
      renderBanners();
      renderCatalog();
      $("car-chip-name").textContent = (S.me && S.me.car && S.me.car.name) || "Mashina tanlash";
      refreshQuickBadges();
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

  /* ==================================================================
     STORIES — Instagram mantiqi

     NIMA QO'SHILDI (ilgari YO'Q edi)
       * sarlavha: avatar, bo'lim nomi va "qancha vaqt oldin";
       * ochilish/yopilish animatsiyasi (ilgari oyna shunchaki paydo
         bo'lardi — `.hidden` olib tashlanardi, tamom);
       * bo'limlar orasida YON TOMONGA surish (ilgari faqat chegaraga
         yetganda o'zi o'tardi);
       * reaksiyalar (❤️ 🔥 👏 😍 😮) va ikki marta bosib "yoqtirish";
       * "Xabar yozing" — javob adminga QAYSI story'dan kelganini
         bildirib boradi (ilgari mijoz `t.me/admin` ga o'tib qo'lda
         yozardi va admin nima haqida gap ketayotganini bilmasdi);
       * ko'rishlar soni — adminga ko'rinadi;
       * havola (CTA) — story'dan tovarga o'tish;
       * ovoz holati eslab qolinadi.

     KO'RISHLAR VA REAKSIYALAR QANDAY SAQLANADI
     `story_views/{id}/u/{uid}` va `story_reactions/{id}/u/{uid}` —
     kalit sifatida foydalanuvchi id si. Ya'ni sanoqchi emas, RO'YXAT:
       * bir odam necha marta ko'rsa ham bir marta hisoblanadi (kalit
         ustiga qayta yozilади) — sanoqchi bo'lsa "shishib" ketardi;
       * reaksiyani almashtirish tabiiy ishlaydi (kalit qiymati o'zgaradi).
     Bu tugunlar `catalog/stories` dan TASHQARIDA: `services/sync.py`
     katalogni PUT bilan yozadi va ichki tugunlarni o'chirib yuborardi.
     ================================================================== */

  /** Instagram'dagi tez reaksiyalar. */
  const STORY_REACTS = ["❤️", "🔥", "👏", "😍", "😮"];

  /** Ko'rilgan elementlar ro'yxati (id bo'yicha). */
  const seenList = () => {
    try {
      const raw = JSON.parse(localStorage.getItem(migrateKey(SEEN_KEY)) || "[]");
      return Array.isArray(raw) ? raw : [];
    } catch (_) {
      return [];
    }
  };

  const fbOk = () => !!(window.ZimmerFB && window.ZimmerFB.available());

  /* ====================================================================
     TALAB BO'YICHA SKRIPT YUKLASH (lazy load)

     NEGA KERAK. `index.html` ilgari 12 ta skriptni BLOKLAB yuklardi va
     ularning ichida 231 KB ADMIN kodi bor edi — u faqat 3-4 admin uchun
     kerak, lekin HAR BIR MIJOZ yuklab olardi. Ustiga `bts.js` — 61 KB
     bitta satrdagi JSON (barcha pochta filiallari), u esa faqat
     rasmiylashtirishda «BTS Pochta» tanlansa ishlatiladi.

     Endi ular kerak bo'lganda yuklanadi. Har bir fayl BIR MARTA
     yuklanadi: takror chaqiruv o'sha Promise'ni qaytaradi.
     ==================================================================== */

  const SCRIPT_VERSION = "60"; // index.html dagi `?v=` bilan bir xil bo'lsin
  const _scripts = new Map();

  function loadScript(src) {
    if (_scripts.has(src)) return _scripts.get(src);

    const promise = new Promise((resolve, reject) => {
      const node = document.createElement("script");
      node.src = `${src}?v=${SCRIPT_VERSION}`;
      node.async = false; // tartib saqlanadi (bir nechta chaqirilsa muhim)
      node.onload = () => resolve(src);
      node.onerror = () => {
        // Muvaffaqiyatsiz yuklashni KESHDA QOLDIRMAYMIZ — mijoz qayta
        // urinib ko'rishi mumkin (tarmoq tiklanishi mumkin).
        _scripts.delete(src);
        reject(new Error(`Yuklanmadi: ${src}`));
      };
      document.body.appendChild(node);
    });

    _scripts.set(src, promise);
    return promise;
  }

  /** Admin panel to'plami (231 KB) — faqat admin ochganda yuklanadi.
   *  Tartib MUHIM: `admin-crm.js` buyurtmalar quvurini `admin-shop.js`
   *  dan oladi, shuning uchun ketma-ket yuklanadi. */
  let _adminBundle = null;
  function ensureAdminBundle() {
    if (_adminBundle) return _adminBundle;
    _adminBundle = (async () => {
      await loadScript("js/admin.js");
      await loadScript("js/admin-shop.js");
      await loadScript("js/admin-crm.js");
      await loadScript("js/admin-stories.js");
    })().catch((err) => {
      _adminBundle = null; // qayta urinishga imkon beramiz
      throw err;
    });
    return _adminBundle;
  }

  /** BTS pochta filiallari (61 KB) — «BTS Pochta» tanlanganda yuklanadi. */
  function ensureBts() {
    if (window.BTS_BRANCHES) return Promise.resolve();
    return loadScript("js/bts.js");
  }

  /** "hozir" / "5 daqiqa" / "3 soat" / "2 kun oldin". */
  function storyAgo(ms) {
    const t = Number(ms) || 0;
    if (!t) return "";
    const diff = Date.now() - t;
    if (diff < 0) return "hozir";
    const min = Math.floor(diff / 60000);
    if (min < 1) return "hozir";
    if (min < 60) return min + " daqiqa oldin";
    const hour = Math.floor(min / 60);
    if (hour < 24) return hour + " soat oldin";
    const day = Math.floor(hour / 24);
    if (day < 7) return day + " kun oldin";
    const week = Math.floor(day / 7);
    if (week < 5) return week + " hafta oldin";
    return Math.floor(day / 30) + " oy oldin";
  }

  /* ------------------------------------------------------- halqalar qatori */

  /** HALQALAR (bo'limlar): bitta doira ichida bir nechta element.
      Hammasi ko'rilgan bo'lsa halqa xiralashadi (Instagram kabi). */
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
          <div class="story-face" style="background:${gradientOf(
            ring.color_from,
            ring.color_to
          )}">${cover ? img(cover) : esc(ring.emoji)}</div>
          ${items.length > 1 ? `<i class="story-count">${items.length}</i>` : ""}
        </div>
        <span class="story-label">${esc(ring.title)}</span>`;
      node.onclick = () => openStory(i);
      box.append(node);
    });
    // Birorta ham story bo'lmasa — qator umuman ko'rinmaydi (toza ko'rinish)
    box.classList.toggle("hidden", !S.rings.length);
    // Bosqichma-bosqich chiqish (bir martalik)
    if (S.rings.length) {
      box.classList.remove("enter");
      void box.offsetWidth;
      box.classList.add("enter");
    }
  }

  /* ------------------------------------------------------------- ochish */

  /** Halqani ochadi. `dir` — yon tomonga surish animatsiyasi yo'nalishi. */
  function openStory(ringIndex, itemIndex, dir) {
    if (!S.rings.length) return;
    S.ringIndex = Math.max(0, Math.min(S.rings.length - 1, ringIndex));
    S.storyIndex = itemIndex || 0;
    S.stories = (S.rings[S.ringIndex] && S.rings[S.ringIndex].items) || [];
    if (!S.stories.length) return;

    const view = $("story-view");
    const first = view.classList.contains("hidden");
    view.classList.remove("hidden", "closing");
    if (first) {
      // Ochilish animatsiyasi: kichikdan kattaga (bir martalik)
      view.classList.remove("opening");
      void view.offsetWidth;
      view.classList.add("opening");
      document.body.style.overflow = "hidden";
    }
    haptic();
    paintStory(dir);
  }

  /* ---------------------------------------------------- story: progress (rAF)
     Chiziq video DAVOMIYLIGIGA moslashadi: rasm — 5s, video — o'zining
     uzunligi. Bosib turilsa pauza qiladi. */
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

  /* --------------------------------------------------------- chizish */

  function paintStory(dir) {
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
        <div class="story-text">
          <div class="story-h">${esc(story.heading || "")}</div>
          <div class="story-b">${esc(story.body || "")}</div>
        </div>`;

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
              saveStoryMute();
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
      /* Rasm ham "suyak" bilan keladi: yuklanmaguncha bo'sh qora ekran
         turmasin (ilgari shunday edi). */
      const bg = photo ? `<img id="story-photo" class="loading" src="${esc(photo)}" alt="">` : "";
      inner.innerHTML = `
        <div class="story-bg" style="background:linear-gradient(160deg,${safeColor(
          story.color_from,
          "#2a2d38"
        )},${safeColor(story.color_to, "#12131a")} 75%, #000)">${bg}</div>
        ${photo ? '<div class="story-spinner" id="story-spinner"></div>' : ""}
        <div class="story-shade"></div>
        ${!bg ? `<div class="story-emoji">${esc(story.emoji)}</div>` : ""}
        <div class="story-text">
          <div class="story-h">${esc(story.heading || "")}</div>
          <div class="story-b">${esc(story.body || "")}</div>
        </div>`;
      const pic = $("story-photo");
      if (pic) {
        const done = () => {
          pic.classList.remove("loading");
          const sp = $("story-spinner");
          if (sp) sp.style.display = "none";
        };
        pic.onload = done;
        pic.onerror = done;
        if (pic.complete && pic.naturalWidth) done();
      }
      animateStoryProgress(fill, 5000);
    }

    // Yon tomonga o'tish animatsiyasi (bo'lim almashganda)
    if (dir) {
      inner.classList.remove("slide-l", "slide-r");
      void inner.offsetWidth;
      inner.classList.add(dir > 0 ? "slide-l" : "slide-r");
    }

    paintStoryHead(story);
    paintStoryCta(story);
    paintStoryReacts(story);

    const seen = seenList();
    if (!seen.includes(story.id)) {
      seen.push(story.id);
      localStorage.setItem(userKey(SEEN_KEY), JSON.stringify(seen.slice(-400)));
    }
    countStoryView(story);
    preloadNextStory();
  }

  /** Sarlavha: avatar, bo'lim nomi, "qancha vaqt oldin" va o'rni. */
  function paintStoryHead(story) {
    const ring = S.rings[S.ringIndex] || {};
    const ava = $("story-ava");
    if (ava) {
      ava.textContent = ring.emoji || "📸";
      ava.style.background = `linear-gradient(150deg,${safeColor(
        ring.color_from,
        "#ff4b3e"
      )},${safeColor(ring.color_to, "#1a0508")})`;
    }
    const nameEl = $("story-who-name");
    if (nameEl) {
      nameEl.textContent =
        (ring.title || "Zimmer") +
        (S.stories.length > 1 ? " · " + (S.storyIndex + 1) + "/" + S.stories.length : "");
    }
    const timeEl = $("story-who-time");
    if (timeEl) {
      // Vaqt bulutdagi yozuvdan keladi (`updatedAt`/`createdAt`)
      timeEl.textContent = storyAgo(story.updatedAt || story.createdAt);
    }
  }

  /** Story'ga bog'langan havola: tovarga yoki tashqi manzilga o'tadi. */
  function paintStoryCta(story) {
    const btn = $("story-cta");
    if (!btn) return;
    const link = String(story.link || "").trim();
    if (!link) return btn.classList.add("hidden");

    const label = $("story-cta-tx");
    const num = /^\d+$/.test(link) ? Number(link) : null;
    const prod = num ? (S.shopProducts || []).find((p) => Number(p.id) === num) : null;
    if (label) label.textContent = prod ? prod.name : "Batafsil ko'rish";
    btn.classList.remove("hidden");
    btn.onclick = (e) => {
      e.stopPropagation();
      haptic("medium");
      if (prod) {
        closeStory();
        return openProductModal(prod);
      }
      if (/^https?:\/\//i.test(link)) {
        try {
          tg.openLink(link);
        } catch (_) {
          window.open(link, "_blank");
        }
      }
    };
  }

  /* --------------------------------------------- ko'rishlar va reaksiyalar */

  /** Ko'rishni belgilaydi. Kalit — foydalanuvchi id si, shuning uchun bir
   *  odam necha marta ko'rsa ham BIR marta hisoblanadi. */
  function countStoryView(story) {
    if (!fbOk() || !story || story.id == null) return;
    const uid = myUid();
    if (!uid) return;
    // Bir sessiyada bir marta yozamiz — behuda so'rov ketmasin
    S.storyCounted = S.storyCounted || {};
    const key = story.id + ":" + uid;
    if (S.storyCounted[key]) return;
    S.storyCounted[key] = true;
    window.ZimmerFB.patch("story_views/" + story.id + "/u", {
      [uid]: window.ZimmerFB.serverTime(),
    }).catch(() => {});
  }

  /** Reaksiya qatorini chizadi va joriy holatni bulutdan o'qiydi. */
  function paintStoryReacts(story) {
    const box = $("story-reacts");
    if (!box) return;
    const mine = (S.storyMyReact || {})[story.id] || "";

    box.innerHTML = STORY_REACTS.map(
      (e) =>
        '<button class="story-react' +
        (mine === e ? " on" : "") +
        '" data-e="' +
        e +
        '">' +
        e +
        "</button>"
    ).join("");
    box.querySelectorAll(".story-react").forEach((b) => {
      b.onclick = (ev) => {
        ev.stopPropagation();
        reactStory(b.dataset.e);
      };
    });

    // Statistika: reaksiyalar hammaga, ko'rishlar soni faqat adminga
    loadStoryMeta(story);
  }

  /** Bulutdan reaksiyalarni (va admin bo'lsa ko'rishlarni) o'qiydi. */
  async function loadStoryMeta(story) {
    if (!fbOk() || !story || story.id == null) return;
    const id = story.id;
    const isAdmin = !!(S.me && S.me.is_admin);
    S.storyMyReact = S.storyMyReact || {};

    try {
      const reacts = await window.ZimmerFB.get("story_reactions/" + id + "/u");
      if (S.storyIndex == null || !S.stories[S.storyIndex] || S.stories[S.storyIndex].id !== id) {
        return; // boshqa story'ga o'tib ketilgan
      }
      const uid = myUid();
      const tally = {};
      let total = 0;
      Object.keys(reacts || {}).forEach((k) => {
        const e = reacts[k];
        if (!e) return;
        tally[e] = (tally[e] || 0) + 1;
        total++;
        if (k === uid) S.storyMyReact[id] = e;
      });

      // O'z reaksiyamni belgilaymiz
      const mine = S.storyMyReact[id];
      document.querySelectorAll("#story-reacts .story-react").forEach((b) => {
        b.classList.toggle("on", b.dataset.e === mine);
      });

      if (!isAdmin) return;
      const views = await window.ZimmerFB.get("story_views/" + id + "/u");
      const seenBy = Object.keys(views || {}).length;
      const stats = $("story-stats");
      if (!stats) return;
      const top = Object.keys(tally)
        .sort((a, b) => tally[b] - tally[a])
        .slice(0, 5)
        .map((e) => e + " " + tally[e])
        .join("  ");
      stats.innerHTML =
        '<span class="story-stat">👁 ' + seenBy + " ko'rdi</span>" +
        (total ? '<span class="story-stat">' + top + "</span>" : "");
      stats.classList.remove("hidden");
    } catch (_) {
      // Statistika ixtiyoriy — yiqilsa story ko'rinishiga ta'sir qilmaydi
    }
  }

  /** Reaksiya qo'yadi yoki olib tashlaydi (bir odam — bitta reaksiya). */
  function reactStory(emoji) {
    const story = S.stories[S.storyIndex];
    if (!story || story.id == null) return;
    if (!fbOk()) return toast("Baza sozlanmagan");
    const uid = myUid();
    if (!uid) return;

    S.storyMyReact = S.storyMyReact || {};
    const was = S.storyMyReact[story.id];
    const next = was === emoji ? null : emoji;
    S.storyMyReact[story.id] = next || "";

    // Ekranda darhol
    document.querySelectorAll("#story-reacts .story-react").forEach((b) => {
      b.classList.toggle("on", !!next && b.dataset.e === next);
    });
    haptic(next ? "ok" : "light");
    if (next) flyHeart(next);

    const path = "story_reactions/" + story.id + "/u/" + uid;
    const p = next ? window.ZimmerFB.put(path, next) : window.ZimmerFB.remove(path);
    p.then(() => loadStoryMeta(story)).catch(() => toast("Reaksiya saqlanmadi"));
  }

  /** Ikki marta bosilganda (yoki reaksiyada) uchib chiqadigan belgi. */
  function flyHeart(emoji) {
    const node = $("story-heart");
    if (!node) return;
    node.textContent = emoji || "❤️";
    node.classList.remove("pop");
    void node.offsetWidth;
    node.classList.add("pop");
  }

  /* ------------------------------------------------------------- javob */

  /** Story'ga javob yuboradi — adminga QAYSI story ekani bilan boradi. */
  async function sendStoryReply() {
    const input = $("story-reply-in");
    const btn = $("story-send");
    if (!input) return;
    const text = (input.value || "").trim();
    if (!text) return;

    const story = S.stories[S.storyIndex];
    const ring = S.rings[S.ringIndex] || {};
    if (!story) return;

    const off = window.ZimmerOffline;
    if (!off || !off.storyReply || !off.workerReady || !off.workerReady()) {
      return toast("Xabar yuborish sozlanmagan (WORKER_URL)");
    }

    if (btn) btn.disabled = true;
    input.disabled = true;
    try {
      await off.storyReply({
        story_id: String(story.id),
        ring_key: String(ring.key || ""),
        ring_title: String(ring.title || ""),
        heading: String(story.heading || ""),
        text: text,
      });
      input.value = "";
      haptic("ok");
      toast("✅ Xabar yuborildi");
      flyHeart("💬");
    } catch (err) {
      haptic("err");
      toast((err && err.message) || "Xabar yuborilmadi");
    } finally {
      if (btn) btn.disabled = false;
      input.disabled = false;
      storyPause(false);
    }
  }

  /* ----------------------------------------------------------- boshqarish */

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

  const saveStoryMute = () => {
    try {
      localStorage.setItem("zimmer_story_mute", S.storyMuted ? "1" : "0");
    } catch (_) {}
  };

  function toggleStorySound() {
    if (!S.storyVideo) return;
    S.storyMuted = !S.storyMuted;
    S.storyVideo.muted = S.storyMuted;
    saveStoryMute(); // holat eslab qolinadi (ilgari har ochilishda ovozsiz edi)
    const btn = $("story-sound");
    if (btn) btn.textContent = S.storyMuted ? "🔇" : "🔊";
    if (!S.storyMuted) S.storyVideo.play().catch(() => {});
    haptic();
  }

  /** 🗑 FAQAT ADMIN UCHUN: joriy storyni butunlay o'chirish. */
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
        /* Ilgari faqat `/api/admin/...` (Render) ishlatilardi va server
           uxlab yotganda o'chirish yiqilardi. Endi bulutdagi nusxa ham
           belgilanadi — do'kon katalogi Firebase'dan o'qiladi. */
        if (fbOk()) {
          await window.ZimmerFB.patch("catalog/stories/" + story.id, {
            deleted: true,
            is_active: 0,
            updatedAt: Date.now(),
          });
        }
        try {
          await api(`/api/admin/section/sto/${story.id}`, { method: "DELETE" });
        } catch (_) {
          // Render uxlab yotgan bo'lsa ham bulutda belgilandi — yetarli
        }
        haptic("ok");
        toast("Story o'chirildi", 2600);
        const ring = S.rings[S.ringIndex];
        if (ring) ring.items = (ring.items || []).filter((it) => it.id !== story.id);
        S.rings = S.rings.filter((r) => (r.items || []).length > 0);
        if (S.home) S.home.stories = S.rings;
        if (window.ZimmerOffline && window.ZimmerOffline.clearCache) {
          window.ZimmerOffline.clearCache();
        }
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
        return openStory(S.ringIndex + 1, 0, 1);
      }
      return closeStory();
    }

    if (next < 0) {
      // Orqaga: oldingi bo'limning OXIRGI elementiga qaytamiz
      if (S.ringIndex > 0) {
        const prev = S.rings[S.ringIndex - 1];
        const last = Math.max(0, ((prev && prev.items) || []).length - 1);
        haptic("light");
        return openStory(S.ringIndex - 1, last, -1);
      }
      return paintStory();
    }

    S.storyIndex = next;
    paintStory();
  }

  /** Yon tomonga surish — BO'LIM almashadi (Instagram kabi). */
  function swipeRing(delta) {
    const to = S.ringIndex + delta;
    if (to < 0 || to >= S.rings.length) {
      // Chegara — ozgina "qarshilik" bilan bildiramiz
      haptic("warning");
      return;
    }
    openStory(to, 0, delta);
  }

  const storyOpen = () => {
    const v = $("story-view");
    return !!v && !v.classList.contains("hidden");
  };

  function closeStory() {
    clearTimeout(S.storyTimer);
    cancelAnimationFrame(S.storyRaf);
    releaseStoryVideo();
    stopVideos();
    storyPause(false);
    const view = $("story-view");
    // Yopilish animatsiyasi (ilgari oyna shartta yo'qolardi)
    view.classList.add("closing");
    view.classList.remove("opening");
    setTimeout(() => {
      view.classList.add("hidden");
      view.classList.remove("closing");
      view.style.transform = "";
      view.style.opacity = "";
      $("story-inner").innerHTML = "";
    }, 200);
    const stats = $("story-stats");
    if (stats) stats.classList.add("hidden");
    const cta = $("story-cta");
    if (cta) cta.classList.add("hidden");
    const input = $("story-reply-in");
    if (input) input.value = "";
    document.body.style.overflow = "";
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
      node.style.background = gradientOf(b.color_from, b.color_to);
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

    /* Banner aylanishi.
       DIQQAT: ilgari bu interval BIR MARTA yoqilib, hech qachon
       to'xtatilmasdi — boshqa bo'limga o'tilganda ham har 5.2 soniyada
       ishga tushib `if (S.page !== "home") return` bilan chiqib ketardi.
       Ya'ni ilova butun umri davomida uyg'onib turadigan taymer bilan
       yashardi (batareyani behuda sarflaydi).
       Endi bosh sahifadan chiqilganda TO'XTATILADI (`stopBannerTimer`) va
       qaytilganda qayta yoqiladi. */
    stopBannerTimer();
    if (list.length > 1) startBannerTimer(box);
  }

  function startBannerTimer(box) {
    stopBannerTimer();
    S.bannerTimer = setInterval(() => {
      if (S.page !== "home" || document.hidden) return;
      const step = box.clientWidth - 24;
      const next = box.scrollLeft + step >= box.scrollWidth - 10 ? 0 : box.scrollLeft + step;
      box.scrollTo({ left: next, behavior: "smooth" });
    }, 5200);
  }

  /* ==================================================================
     FON MUSIQASI

     Admin botga audio tashlaydi (`handlers/music.py`), Mini App esa
     uni orqa fonda eshittiradi.

     ENG MUHIM CHEKLOV — BRAUZER OVOZNI O'ZI BOSHLAMAYDI.
     Chrome va Safari qoidasi: ovozli media foydalanuvchi sahifaga
     TEGINMAGUNCHA o'ynatilmaydi (`NotAllowedError`). Bu Zimmer
     kamchiligi emas va uni chetlab o'tishning to'g'ri yo'li YO'Q.

     Shu sababli:
       * musiqa FAQAT 🎵 tugmasi bosilganda boshlanadi (bu — teginish);
       * tanlov qurilmada eslab qolinadi (`MUSIC_KEY`);
       * keyingi kirishda darhol boshlashga urinamiz, brauzer rad etsa
         BIRINCHI teginishni kutamiz va shundan keyin davom etadi.

     Ya'ni mijoz bir marta yoqsa, boshqa hech narsa bosishi shart emas.
     ================================================================== */

  /** Musiqa holati. `el` — `<audio>`, kerak bo'lganda yasaladi. */
  const MU = { el: null, tracks: [], index: 0, on: false, armed: false, loaded: false };

  const musicWanted = () => {
    try {
      return localStorage.getItem(MUSIC_KEY) === "1";
    } catch (_) {
      return false;
    }
  };

  const rememberMusic = (on) => {
    try {
      localStorage.setItem(MUSIC_KEY, on ? "1" : "0");
    } catch (_) {}
  };

  /** Treklarni bir marta yuklaydi. */
  async function loadMusic() {
    if (MU.loaded) return MU.tracks;
    MU.loaded = true;
    try {
      const res = S.offline
        ? await ZimmerOffline.music()
        : await api("/api/music");
      MU.tracks = (res && res.tracks) || [];
    } catch (_) {
      /* Server javob bermadi — bulutdan urinamiz. Bulut yo'lida faqat
         tashqi havolali treklar bo'ladi (`file_id` ni brauzer o'qiy
         olmaydi), shuning uchun ro'yxat bo'sh chiqishi ham normal. */
      try {
        if (window.ZimmerOffline && ZimmerOffline.music) {
          const res = await ZimmerOffline.music();
          MU.tracks = (res && res.tracks) || [];
        }
      } catch (_) {
        MU.tracks = [];
      }
    }
    if (!Array.isArray(MU.tracks)) MU.tracks = [];
    return MU.tracks;
  }

  /** `<audio>` elementini yasaydi (faqat bir marta). */
  function musicEl() {
    if (MU.el) return MU.el;
    const el = document.createElement("audio");
    el.id = "bg-music";
    el.preload = "none";
    el.loop = false; // navbatdagi trekka o'tish uchun `ended` kerak
    /* Telefonda ovoz balandligini tizim boshqaradi, lekin fon musiqasi
       suhbatni bosib ketmasligi kerak — shuning uchun pasaytirilgan. */
    el.volume = 0.35;
    el.addEventListener("ended", () => {
      if (!MU.tracks.length) return;
      MU.index = (MU.index + 1) % MU.tracks.length;
      playCurrent();
    });
    el.addEventListener("error", () => {
      /* Bitta trek ochilmasa keyingisiga o'tamiz. Hammasi ishlamasa
         musiqani o'chiramiz — mijozga xato ko'rsatishning ma'nosi yo'q. */
      if (MU.tracks.length > 1) {
        MU.index = (MU.index + 1) % MU.tracks.length;
        playCurrent();
      } else {
        setMusic(false, { remember: false });
      }
    });
    document.body.appendChild(el);
    MU.el = el;
    return el;
  }

  /** Joriy trekni o'ynatadi. Brauzer rad etsa `false` qaytaradi. */
  async function playCurrent() {
    const track = MU.tracks[MU.index];
    if (!track || !track.url) return false;
    const el = musicEl();
    const src = abs(track.url);
    if (el.src !== src) {
      el.src = src;
      el.load();
    }
    try {
      await el.play();
      return true;
    } catch (_) {
      /* `NotAllowedError` — foydalanuvchi hali teginmagan. Xato EMAS,
         kutilgan holat: birinchi teginishda qayta urinamiz. */
      return false;
    }
  }

  /** Musiqani yoqadi/o'chiradi va tugmani yangilaydi. */
  async function setMusic(on, opts) {
    const remember = !opts || opts.remember !== false;
    MU.on = !!on;
    if (remember) rememberMusic(MU.on);

    if (!MU.on) {
      if (MU.el) {
        try {
          MU.el.pause();
        } catch (_) {}
      }
      paintMusicBtn();
      return;
    }

    await loadMusic();
    if (!MU.tracks.length) {
      MU.on = false;
      if (remember) rememberMusic(false);
      paintMusicBtn();
      return;
    }

    const started = await playCurrent();
    if (!started) armMusic();
    paintMusicBtn();
  }

  /** Birinchi teginishni kutib, shundan keyin boshlaydi.
   *
   *  Aynan shu — «mijoz bir marta yoqsa, keyingi kirishlarda o'zi
   *  davom etadi» xatti-harakatini beradigan qism. */
  function armMusic() {
    if (MU.armed) return;
    MU.armed = true;

    const kick = async () => {
      if (!MU.on) return unarm();
      const started = await playCurrent();
      if (started) unarm();
    };
    const unarm = () => {
      MU.armed = false;
      document.removeEventListener("pointerdown", kick);
      document.removeEventListener("touchstart", kick);
      document.removeEventListener("keydown", kick);
    };

    // `passive` — sahifa aylanishiga xalaqit bermasin
    document.addEventListener("pointerdown", kick, { passive: true });
    document.addEventListener("touchstart", kick, { passive: true });
    document.addEventListener("keydown", kick);
  }

  /** Tugma ko'rinishini holatga moslaydi. */
  function paintMusicBtn() {
    const btn = $("music-btn");
    if (!btn) return;
    // Trek yo'q bo'lsa tugma umuman ko'rinmaydi
    const has = MU.tracks.length > 0;
    btn.classList.toggle("hidden", !has);
    if (!has) return;
    btn.classList.toggle("on", MU.on);
    btn.textContent = MU.on ? "🎵" : "🔇";
    btn.setAttribute("aria-pressed", MU.on ? "true" : "false");
    btn.setAttribute(
      "aria-label",
      MU.on ? "Fon musiqasini o'chirish" : "Fon musiqasini yoqish"
    );
    btn.title = MU.on ? "Musiqa yoniq" : "Musiqa o'chiq";
  }

  /** Boot'da bir marta chaqiriladi. */
  async function initMusic() {
    const btn = $("music-btn");
    if (btn) {
      btn.onclick = () => {
        haptic("light");
        setMusic(!MU.on);
      };
    }

    await loadMusic();
    paintMusicBtn();

    // Mijoz ilgari yoqib qo'ygan bo'lsa — davom etamiz
    if (MU.tracks.length && musicWanted()) await setMusic(true, { remember: false });

    /* Ilova fonga o'tsa musiqani to'xtatamiz: batareya va trafik
       behuda ketmasin, boshqa ilovadagi ovoz ustiga chiqmasin.
       Qaytganda — mijoz yoqib qo'ygan bo'lsa davom etadi. */
    document.addEventListener("visibilitychange", () => {
      if (!MU.on || !MU.el) return;
      if (document.hidden) {
        try {
          MU.el.pause();
        } catch (_) {}
      } else {
        playCurrent();
      }
    });
  }

  function stopBannerTimer() {
    if (S.bannerTimer) {
      clearInterval(S.bannerTimer);
      S.bannerTimer = null;
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
        addToCart(p, 1, add);
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

  /** Barcha mahsulotni kategoriyalardan bitta ro'yxatga yig'adi.
   *
   *  ILGARI oxirida `shuffle(all)` turardi — tovarlar HAR chizishda
   *  tasodifiy tartibda chiqardi. Mijoz ro'yxatni varaqlab, tovarga kirib
   *  chiqsa (modal `renderCatalog()` ni qayta chaqiradi) tartib
   *  ALMASHARDI va o'sha tovarni qaytib topolmasdi. Endi tartib BARQAROR:
   *  yangi tovar yuqorida.
   *
   *  Har tovarga kategoriya nomi (`_cat`) yopishtiriladi — kategoriya
   *  chiplari shu bilan filtrlaydi.
   */
  function buildShopProducts() {
    const seen = new Set();
    const all = [];
    ((S.home && S.home.catalog) || []).forEach((c) => {
      const catName = String((c && c.name) || "").trim();
      const catIcon = (c && c.icon) || "";
      (c.products || []).forEach((p) => {
        // OXIRGI TO'SIQ: o'chirilgan/yashirilgan tovar ekranga CHIQMAYDI.
        //
        // Katalog beshta manbadan kelishi mumkin (Render API, Firebase,
        // localStorage keshi, statik `catalog.json`, Worker). Ularning
        // hammasida filtr bo'lishi kerak, lekin bittasi qolib ketsa admin
        // o'chirgan tovar do'konda ko'rinib turadi — aynan shu bo'lgan edi.
        // Shu sababli chizishdan OLDIN yana bir marta tekshiramiz: bu
        // yerdan o'tmagan tovar hech qaysi manbadan ham o'tolmaydi.
        if (!p || p.deleted || p.is_active === 0 || p.is_active === false) return;
        if (seen.has(p.id)) return;
        seen.add(p.id);
        p._cat = catName;
        p._catIcon = catIcon;
        // Filtr chiplari SHU raqam bo'yicha tartiblanadi (alifbo emas)
        p._catSort = Number(c && c.sort) || 0;
        /* QIDIRUV INDEKSI — bir marta, katalog yuklanganda.
           Ilgari har harf bosilganda har bir tovar uchun matn qaytadan
           normallashtirilardi. Indeks bilan yozish paytida hech narsa
           hisoblanmaydi — faqat tayyor satrlar solishtiriladi. */
        buildSearchIndex(p, catName);
        all.push(p);
      });
    });
    all.sort((a, b) => (Number(b.id) || 0) - (Number(a.id) || 0));
    return all;
  }

  /* ==================================================================
     KATALOG — kategoriya chiplari + tovar kartochkalari

     NIMA O'ZGARDI
       * Kategoriya chiplari ISHLAYDI. Ilgari `renderCatalog()` ularni
         tozalab yashirardi ("kerak emas") va butun do'kon bitta uzun
         ro'yxat edi: mijoz kerakli turni ajratib ololmasdi.
       * Tovar soni sarlavha yonida ko'rinadi.
       * Kartochka rasmi yuklanganda SILLIQ paydo bo'ladi, xato bo'lsa
         o'rniga belgi qoladi. Ilgari `img()` yordamchisi xatoda rasmni
         `display:none` qilardi va kartochkada BO'SH OQ kvadrat turardi.
       * Narx endi kartochka TANASIDA, tugmada emas. Ilgari narx faqat
         savat tugmasi ichida yozilardi — chegirmani ko'rsatish uchun joy
         yo'q edi va narx tugma rangida yo'qolib ketardi.
     ================================================================== */

  /* ==================================================================
     QIDIRUV, FILTR VA SARALASH

     MIJOZ QANDAY YOZADI. Bitta tovarni odamlar bir necha xil yozadi:

         «Go'zal»  «Gozal»  «Goʻzal»  «гозал»
         «H4»      «h 4»    «н4»
         «linza»   «Linzalar»          «lnza» (xato)

     Ilgari qidiruv faqat katta-kichik harfni va apostrof ko'rinishini
     tenglashtirardi. Natijada apostrofsiz yozgan, kirillda yozgan yoki
     bitta harfni xato bosgan mijoz HECH NARSA topmasdi.

     ENDI TO'RT QATLAM:

       1) NORMALIZATSIYA — kirill lotinga o'giriladi, apostroflar
          BUTUNLAY olib tashlanadi, tinish belgilari bo'sh joyga
          aylanadi. «Goʻzal» va «гозал» ikkisi ham «gozal» bo'ladi.

       2) INDEKS — har tovar uchun bir marta hisoblanadi
          (`buildShopProducts`), har harf bosilganda EMAS. Shu sababli
          yozish paytida sekinlashish yo'q.

       3) RELEVANTLIK — natijalar ball bo'yicha tartiblanadi: nomdagi
          moslik tavsifdagidan yuqori, so'z boshi so'z o'rtasidan
          yuqori, kod esa eng yuqori. Ilgari tasodifiy tartibda edi:
          nomi aynan mos tovar tavsifdagi mosikdan PASTDA turardi.

       4) XATOGA TOLERANTLIK — aniq moslik BO'LMASA va faqat o'shanda,
          bitta harf xatosiga yo'l qo'yiladi («lnza» -> «linza»).
          Ikkinchi bosqich sifatida — birinchisi ishlasa umuman
          chaqirilmaydi, ya'ni tez.
     ================================================================== */

  /* Kirill -> lotin. O'zbek (ў, қ, ғ, ҳ) va rus harflari.
     Mijoz kirill klaviaturada yozsa ham lotin katalogdan topadi. */
  const CYRILLIC_MAP = {
    а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "yo", ж: "j", з: "z",
    и: "i", й: "y", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r",
    с: "s", т: "t", у: "u", ф: "f", х: "x", ц: "ts", ч: "ch", ш: "sh",
    щ: "sh", ъ: "", ы: "i", ь: "", э: "e", ю: "yu", я: "ya",
    ў: "o", қ: "q", ғ: "g", ҳ: "h", ə: "a",
  };

  /** Qidiruv uchun matnni solishtirishga tayyorlaydi.
   *
   *  Natija: faqat kichik lotin harflari, raqamlar va bitta bo'shliq.
   *
   *  APOSTROF OLIB TASHLANADI (tenglashtirilmaydi): «o'rindiq» ->
   *  «orindiq». Shu tufayli apostrofni yozmagan mijoz ham topadi —
   *  telefon klaviaturasida uni bosish qiyin. */
  function normText(value) {
    return String(value == null ? "" : value)
      .toLowerCase()
      .replace(/[\u0400-\u04ff\u04af\u0259]/g, (ch) =>
        CYRILLIC_MAP[ch] !== undefined ? CYRILLIC_MAP[ch] : ch
      )
      // apostrofning barcha ko'rinishlari — o'chiriladi
      .replace(/['’ʻʼ`´]/g, "")
      // harf va raqamdan boshqasi (tinish, chiziqcha, emoji) -> bo'shliq
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  }

  /** Bo'shliqsiz ko'rinish: «h 4» va «h4» bir xil topilsin. */
  const compactText = (value) => String(value || "").replace(/ /g, "");

  /** Tovar uchun qidiruv indeksini yasaydi (bir marta, katalog yuklanganda).
   *
   *  Maydonlar ALOHIDA saqlanadi, chunki relevantlik ballari ular
   *  bo'yicha farq qiladi: nomdagi moslik tavsifdagidan qimmatroq. */
  function buildSearchIndex(p, catName) {
    const name = normText(p.name);
    const code = normText(p.code);
    const cat = normText(catName);
    const rest = normText(
      [p.brand, p.model, p.badge, p.description, p.desc].filter(Boolean).join(" ")
    );
    const all = [name, code, cat, rest].filter(Boolean).join(" ");

    p._sName = name;
    p._sCode = code;
    p._sCat = cat;
    p._sRest = rest;
    p._sAll = all;
    p._sAllC = compactText(all);
    // Xatoga tolerantlik uchun — alohida so'zlar (takrorsiz)
    p._sWords = [...new Set(all.split(" ").filter((w) => w.length > 2))];
  }

  /** So'z tovar indeksida bormi (bo'shliqli va bo'shliqsiz ko'rinishda). */
  function termHit(p, term) {
    if (!p._sAll) return false;
    return p._sAll.includes(term) || p._sAllC.includes(compactText(term));
  }

  /** Tovar qidiruv so'roviga mos keladimi (ANIQ moslik). */
  function matchesQuery(product, terms) {
    if (!terms.length) return true;
    // HAR BIR so'z topilishi kerak (ya'ni «h4 linza» ikkisini ham izlaydi)
    return terms.every((t) => termHit(product, t));
  }

  /* ---------------------------------------------- xatoga tolerantlik */

  /** Ikki so'z orasidagi tahrir masofasi. `limit` dan oshsa DARHOL
   *  to'xtaydi — butun katalogni tekshirish tez bo'lishi kerak. */
  function editDistance(a, b, limit) {
    if (a === b) return 0;
    if (Math.abs(a.length - b.length) > limit) return limit + 1;

    let prev = new Array(b.length + 1);
    let cur = new Array(b.length + 1);
    for (let j = 0; j <= b.length; j++) prev[j] = j;

    for (let i = 1; i <= a.length; i++) {
      cur[0] = i;
      let best = cur[0];
      for (let j = 1; j <= b.length; j++) {
        const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
        if (cur[j] < best) best = cur[j];
      }
      // Bu qatorda eng yaxshi natija ham limitdan oshsa — davom etish shart emas
      if (best > limit) return limit + 1;
      const swap = prev;
      prev = cur;
      cur = swap;
    }
    return prev[b.length];
  }

  /** Qancha harf xatosiga yo'l qo'yamiz. Qisqa so'zda — hech qancha:
   *  «h4» dan «h5» ni yasash oson va bu YOLG'ON natija berardi. */
  function fuzzyLimit(term) {
    if (term.length >= 7) return 2;
    if (term.length >= 4) return 1;
    return 0;
  }

  /** Tovar so'rovga TAXMINAN mos keladimi (bitta-ikkita harf xatosi). */
  function fuzzyMatches(product, terms) {
    if (!product._sWords || !product._sWords.length) return false;
    return terms.every((t) => {
      if (termHit(product, t)) return true;
      const limit = fuzzyLimit(t);
      if (!limit) return false;
      return product._sWords.some((w) => editDistance(w, t, limit) <= limit);
    });
  }

  /* -------------------------------------------------- relevantlik bali */

  /** Tovarning so'rovga mos kelish darajasi. Katta ball — yuqorida.
   *
   *  Ballar TARTIB uchun, filtr uchun emas: nimani ko'rsatishni
   *  `matchesQuery` hal qiladi, bu esa QAYSI TARTIBDA ekanini. */
  function searchScore(p, terms, query) {
    const q = query;
    const qc = compactText(q);
    const name = p._sName || "";
    const nameC = compactText(name);
    let score = 0;

    // Kod bo'yicha aniq moslik — eng ishonchli signal
    if (p._sCode && (p._sCode === q || compactText(p._sCode) === qc)) score += 1000;
    // Nomi aynan so'rov
    if (name && name === q) score += 500;
    else if (name.startsWith(q)) score += 260;
    else if (nameC.startsWith(qc)) score += 200;

    let allInName = true;
    terms.forEach((t) => {
      const inName = name.includes(t) || nameC.includes(compactText(t));
      if (inName) {
        // So'z BOSHIDA turgan moslik o'rtasidagidan qimmatroq
        const atWordStart = name.startsWith(t) || name.includes(" " + t);
        score += atWordStart ? 60 : 34;
        return;
      }
      allInName = false;
      if (p._sCode && p._sCode.includes(t)) score += 45;
      else if (p._sCat && p._sCat.includes(t)) score += 18;
      else if (p._sRest && p._sRest.includes(t)) score += 10;
    });

    // Bir necha so'zning HAMMASI nomda bo'lsa — bu juda yaxshi moslik
    if (allInName && terms.length > 1) score += 40;
    // Omborda bori yuqorida tursin (teng ballda)
    if (stockOf(p) > 0) score += 3;
    return score;
  }

  /** Filtrlangan va saralangan tovarlar ro'yxati.
   *
   *  `S.shopFuzzy` — natija faqat TAXMINIY moslik bilan topilganini
   *  bildiradi. `renderCatalog()` shu holatda mijozga «aniq moslik
   *  yo'q, shunga o'xshashlar» deb aytadi. */
  function visibleProducts() {
    const all = S.shopProducts || [];
    const query = normText(S.shopQ);
    const terms = query.split(" ").filter(Boolean);
    const myCarId = S.me && S.me.car ? S.me.car.id : null;

    /* Qidiruvdan BOSHQA filtrlar. Ular ikki bosqichda ham bir xil
       qo'llanadi, shuning uchun alohida ajratilgan. */
    const passesFilters = (p) => {
      if (S.shopCat && p._cat !== S.shopCat) return false;
      if (S.shopInStock && stockOf(p) <= 0) return false;
      /* «Mashinamga mos»: tovarda mashina ko'rsatilmagan bo'lsa u
         UNIVERSAL hisoblanadi va ro'yxatda qoladi — aks holda filtr
         katalogning yarmini behuda yashirib qo'yardi. */
      if (S.shopMyCar && myCarId && p.car_id && Number(p.car_id) !== Number(myCarId)) {
        return false;
      }
      return true;
    };

    const base = all.filter(passesFilters);

    // ---- 1-bosqich: ANIQ moslik
    let list = base.filter((p) => matchesQuery(p, terms));
    S.shopFuzzy = false;

    /* ---- 2-bosqich: XATOGA TOLERANTLIK
       Faqat aniq moslik BO'LMAGANDA ishlaydi. Shu tufayli odatdagi
       qidiruvda tahrir masofasi umuman hisoblanmaydi (tez), lekin
       mijoz bitta harfni xato bosganda ham natija ko'radi. */
    if (terms.length && !list.length) {
      const near = base.filter((p) => fuzzyMatches(p, terms));
      if (near.length) {
        list = near;
        S.shopFuzzy = true;
      }
    }

    /* ---- TARTIB
       So'rov bo'lsa RELEVANTLIK ustun turadi: mijoz «h4» deb yozganda
       eng mos tovar birinchi bo'lishi kerak, «yangi avval» emas.
       Teng ballda esa tanlangan saralash tartibi ishlaydi. */
    const price = (p) => Number(p.price) || 0;
    const byChosenSort = (a, b) => {
      if (S.shopSort === "cheap") return price(a) - price(b);
      if (S.shopSort === "dear") return price(b) - price(a);
      if (S.shopSort === "name") {
        return String(a.name || "").localeCompare(String(b.name || ""), "uz");
      }
      // "new" — yangi avval (id kamayish tartibida)
      return (Number(b.id) || 0) - (Number(a.id) || 0);
    };

    if (terms.length) {
      const score = new Map();
      list.forEach((p) => score.set(p, searchScore(p, terms, query)));
      list = list
        .slice()
        .sort((a, b) => (score.get(b) || 0) - (score.get(a) || 0) || byChosenSort(a, b));
    } else {
      list = list.slice().sort(byChosenSort);
    }

    return list;
  }

  function renderCatalog() {
    const all = S.shopProducts || [];
    renderCatChips(all);
    syncShopTools(all);

    const products = visibleProducts();

    const box = $("products");
    box.innerHTML = "";

    // Bo'sh holat matni: sabab har xil bo'ladi, shuni ANIQ aytamiz —
    // ilgari qidiruv natijasi bo'sh bo'lsa ham «bo'limda mahsulot yo'q»
    // deb yozilardi va mijoz katalog bo'sh deb o'ylardi.
    const emptyEl = $("products-empty");
    if (emptyEl) {
      let text;
      if (S.offline && (!S.home || S.home._empty)) {
        text = "Katalog hozir yuklanmadi. Server uyg'onganda o'zi paydo bo'ladi.";
      } else if (S.shopQ.trim()) {
        text =
          `«${S.shopQ.trim()}» bo'yicha hech narsa topilmadi. ` +
          "Nomini qisqartirib yoki tovar kodi bilan izlab ko'ring.";
      } else if (S.shopMyCar || S.shopInStock) {
        text = "Tanlangan filtrlarga mos tovar yo'q. Filtrni bo'shatib ko'ring.";
      } else if (S.shopCat) {
        text = "Bu turkumda hozircha mahsulot yo'q.";
      } else {
        text = "Bu bo'limda hozircha mahsulot yo'q.";
      }
      emptyEl.textContent = text;
      emptyEl.classList.toggle("hidden", products.length > 0);
    }

    // Katalog bo'limini zaxira rejimda YASHIRMAYMIZ — aks holda bosh sahifa
    // butunlay bo'sh ko'rinib, mijoz nima bo'lganini tushunmaydi.
    $("catalog-sec").classList.toggle("hidden", !all.length && !S.offline);

    const countEl = $("products-count");
    if (countEl) countEl.textContent = products.length ? products.length + " ta" : "";

    /* TAXMINIY NATIJA HAQIDA OGOHLANTIRISH.
       Mijoz «lnza» deb yozib «Linza» ni ko'rsa, nima uchun boshqa so'z
       chiqqanini bilishi kerak — aks holda qidiruv ishlamayotgandek
       tuyuladi. */
    const hintEl = $("shop-hint");
    if (hintEl) {
      const show = S.shopFuzzy && products.length > 0;
      hintEl.classList.toggle("hidden", !show);
      if (show) {
        hintEl.textContent =
          `«${S.shopQ.trim()}» aynan topilmadi — shunga o'xshashlarni ko'rsatdik.`;
      }
    }

    products.forEach((p) => box.append(prodCard(p)));
  }

  /** Qidiruv/filtr/saralash boshqaruvlarini holatga moslaydi. */
  function syncShopTools(all) {
    const tools = document.querySelector(".shop-tools");
    if (!tools) return;
    // Tovar juda kam bo'lsa qidiruv va filtr faqat joy egallaydi
    tools.classList.toggle("hidden", (all || []).length < 5);

    const clear = $("shop-q-clear");
    if (clear) clear.classList.toggle("hidden", !S.shopQ);

    const carBtn = $("shop-f-car");
    if (carBtn) {
      // Mashina tanlanmagan bo'lsa filtrning ma'nosi yo'q
      const hasCar = !!(S.me && S.me.car && S.me.car.id);
      carBtn.classList.toggle("hidden", !hasCar);
      carBtn.classList.toggle("on", S.shopMyCar);
      carBtn.setAttribute("aria-pressed", S.shopMyCar ? "true" : "false");
      if (hasCar) carBtn.textContent = `🚗 ${S.me.car.name}`;
    }

    const stockBtn = $("shop-f-stock");
    if (stockBtn) {
      stockBtn.classList.toggle("on", S.shopInStock);
      stockBtn.setAttribute("aria-pressed", S.shopInStock ? "true" : "false");
    }

    const sort = $("shop-sort");
    if (sort && sort.value !== S.shopSort) sort.value = S.shopSort;
  }

  /** Qidiruv, filtr va saralashni bir marta bog'laydi (boot'da chaqiriladi). */
  function bindShopTools() {
    const input = $("shop-q");
    if (input) {
      /* DEBOUNCE: har harfda butun katalogni qayta chizish shart emas.
         200 ms — yozish tugashini kutadi, lekin sezilmaydi. */
      let timer = null;
      input.addEventListener("input", () => {
        S.shopQ = input.value || "";
        const clear = $("shop-q-clear");
        if (clear) clear.classList.toggle("hidden", !S.shopQ);
        clearTimeout(timer);
        timer = setTimeout(() => renderCatalog(), 200);
      });
      // Klaviaturadagi «qidirish» tugmasi — darhol va klaviaturani yopadi
      input.addEventListener("change", () => {
        clearTimeout(timer);
        renderCatalog();
        input.blur();
      });
    }

    const clear = $("shop-q-clear");
    if (clear) {
      clear.onclick = () => {
        haptic("light");
        S.shopQ = "";
        if (input) input.value = "";
        clear.classList.add("hidden");
        renderCatalog();
      };
    }

    const carBtn = $("shop-f-car");
    if (carBtn) {
      carBtn.onclick = () => {
        haptic("selection");
        S.shopMyCar = !S.shopMyCar;
        renderCatalog();
      };
    }

    const stockBtn = $("shop-f-stock");
    if (stockBtn) {
      stockBtn.onclick = () => {
        haptic("selection");
        S.shopInStock = !S.shopInStock;
        renderCatalog();
      };
    }

    const sort = $("shop-sort");
    if (sort) {
      sort.onchange = () => {
        haptic("selection");
        S.shopSort = sort.value || "new";
        renderCatalog();
      };
    }
  }

  /** Kategoriya chiplari. Ikkitadan kam turkum bo'lsa filtrning ma'nosi yo'q. */
  function renderCatChips(all) {
    const box = $("cats");
    if (!box) return;

    const count = new Map();
    // Bo'limning `sort` raqami — chiplarni tartiblash uchun
    const order = new Map();
    all.forEach((p) => {
      const k = p._cat || "";
      if (!k) return;
      count.set(k, (count.get(k) || 0) + 1);
      if (!order.has(k)) order.set(k, Number(p._catSort) || 0);
    });

    if (count.size < 2) {
      box.innerHTML = "";
      box.classList.add("hidden");
      S.shopCat = null;
      return;
    }
    // Tanlangan turkum yo'qolgan bo'lsa (tovar o'chirilgan) — hammasiga qaytamiz
    if (S.shopCat && !count.has(S.shopCat)) S.shopCat = null;

    /* `aria-pressed` — chip BOSILGAN holatini bildiradi. Ilgari tanlangan
       chip faqat `.on` klassi bilan ajratilardi, ya'ni skrinreader qaysi
       turkum tanlanganini AYTMASDI. */
    const chip = (key, label, n, on) =>
      '<button class="chip' +
      (on ? " on" : "") +
      '" aria-pressed="' +
      (on ? "true" : "false") +
      '" data-cat="' +
      esc(key) +
      '">' +
      esc(label) +
      " <i>" +
      n +
      "</i></button>";

    /* TARTIB: bo'limning `sort` raqami bo'yicha, keyin nomi bo'yicha.
       Ilgari faqat alifbo bo'yicha edi — natijada «Aksesuarlar»
       «BI-ledlar» dan oldinga chiqib ketardi, holbuki admin bo'limlarni
       boshqa ketma-ketlikda ko'rsatishni xohlaydi. Endi tartibni admin
       panelidagi «Tartib» maydoni boshqaradi. */
    const names = [...count.keys()].sort(
      (a, b) => (order.get(a) || 0) - (order.get(b) || 0) || a.localeCompare(b, "uz")
    );
    box.innerHTML =
      chip("", "Barchasi", all.length, !S.shopCat) +
      names.map((k) => chip(k, k, count.get(k), S.shopCat === k)).join("");
    box.classList.remove("hidden");

    box.querySelectorAll(".chip").forEach((b) => {
      b.onclick = () => {
        haptic("selection");
        S.shopCat = b.dataset.cat || null;
        renderCatalog();
      };
    });
  }

  /* Kartochkada surat maydonni TO'LIQ to'ldiradi (`object-fit: cover`),
     ya'ni ortiqcha cheti qirqiladi. Oddiy suratlar uchun bu chiroyli,
     lekin haddan tashqari cho'ziq surat uchun XAVFLI: 1200x400 banner
     dan markazdagi 400x400 qoladi va tovarning o'zi kadrdan chiqib
     ketishi mumkin.

     Shu sababli suratning HAQIQIY nisbati o'lchanadi va chegaradan
     o'tsa maydonga `fit` klassi qo'yiladi — CSS uni `contain` ga
     qaytaradi (chetida qorong'i chiziq qoladi, lekin tovar ko'rinadi).

     Chegaralar nega shunday:
       4:3 (1.33) va 3:4 (0.75) — suratlarning aksariyati, `cover`
       bilan chetidan ~15% ketadi, bu sezilmaydi -> to'ldiradi;
       16:9 (1.78) da esa ~44% ketadi -> bu juda ko'p, `contain`. */
  const RATIO_WIDE = 1.7;
  const RATIO_TALL = 0.6;

  function markExtremeRatio(img, art) {
    if (!img || !art) return;
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    if (!w || !h) return; // hali ma'lum emas — `onload` da qayta chaqiriladi
    const ratio = w / h;
    if (ratio > RATIO_WIDE || ratio < RATIO_TALL) art.classList.add("fit");
    else art.classList.remove("fit");
  }

  /** Bitta tovar kartochkasi. */
  function prodCard(p) {
    const card = el("div", "prod");
    const photo = abs(p.photo_url);
    const off = discountPercent(p);
    const out = !(p.stock > 0);

    // Nom "·" bo'yicha ajratiladi: asosiy nom + mashina eslatmasi (Avto_A1)
    const parts = String(p.name || "").split("·");
    const mainName = (parts[0] || p.name || "").trim();
    const carHint = parts[1] ? '<div class="prod-hint">' + esc(parts[1].trim()) + "</div>" : "";

    card.innerHTML =
      '<div class="prod-art' +
      (photo ? "" : " empty") +
      (out ? " is-out" : "") +
      '">' +
      (photo
        ? '<img class="prod-img" src="' + esc(photo) + '" alt="' + esc(p.name || "Tovar") + '" loading="lazy">'
        : '<span class="prod-art-ph">💡</span>') +
      (off ? '<span class="prod-off">−' + off + "%</span>" : "") +
      (p.badge ? '<span class="prod-badge">' + esc(p.badge) + "</span>" : "") +
      (p.video_url ? '<span class="prod-play">▶</span>' : "") +
      (out ? '<span class="prod-outtag">Tugagan</span>' : "") +
      '<button class="prod-fav' +
      (S.favorites.has(p.id) ? " on" : "") +
      '" aria-label="Saqlash">♥</button>' +
      "</div>" +
      '<div class="prod-body">' +
      '<div class="prod-name">' +
      esc(mainName) +
      "</div>" +
      carHint +
      (p.car_id ? '<div class="prod-fit">✓ Mashinangizga mos</div>' : "") +
      '<div class="prod-cost"><b>' +
      esc(p.price_label || fmt(p.price)) +
      "</b>" +
      (off && p.old_price_label ? "<s>" + esc(p.old_price_label) + "</s>" : "") +
      "</div>" +
      /* Pastdagi bitta satr: qoldiq kam bo'lsa OGOHLANTIRISH ustun turadi
         (u shoshiltiradi), aks holda kafolat muddati.

         DIQQAT: ilgari bu yerda «🛡 14 kun kafolat» degan QATTIQ matn
         turardi — barcha tovarlar uchun bir xil va aksariyati uchun
         noto'g'ri. Endi muddat admin panelda har tovarga alohida
         qo'yiladi; qo'yilmagan bo'lsa satr UMUMAN chizilmaydi (yolg'on
         kafolat yozib qo'yishdan ko'ra hech narsa yozmaslik to'g'ri). */
      (p.stock > 0 && p.stock <= 5
        ? '<div class="prod-low">📦 ' + p.stock + " ta qoldi</div>"
        : p.stock > 0 && p.warranty
          ? '<div class="prod-trust">🛡 ' + esc(p.warranty) + " kafolat</div>"
          : "") +
      "</div>";

    /* Rasm: yuklanganda silliq paydo bo'ladi. Xato bo'lsa (havola o'lgan,
       internet uzilgan) o'rniga belgi qo'yiladi — bo'sh kvadrat qolmaydi. */
    const im = card.querySelector(".prod-img");
    if (im) {
      const art = card.querySelector(".prod-art");
      const shown = () => {
        im.classList.add("ready");
        markExtremeRatio(im, art);
      };
      im.onload = shown;
      im.onerror = () => {
        im.remove();
        if (art) {
          art.classList.add("empty");
          art.insertAdjacentHTML("afterbegin", '<span class="prod-art-ph">💡</span>');
        }
      };
      // Keshdan kelgan rasm `onload` ni o'tkazib yuborishi mumkin
      if (im.complete && im.naturalWidth) shown();
    }

    card.onclick = () => openProductModal(p);

    const fav = card.querySelector(".prod-fav");
    fav.onclick = (ev) => {
      ev.stopPropagation(); // karta bosilishi bilan aralashmasin
      toggleFavorite(p, fav);
    };

    // Savat tugmasi — narx tanada bo'lgani uchun tugmada faqat amal yoziladi
    const btn = el("button", "prod-add");
    const idle = '<span class="prod-add-ico">🛒</span><span class="prod-add-tx">Savatga</span>';
    if (out) {
      btn.classList.add("out");
      btn.textContent = "Tugadi";
      btn.disabled = true;
    } else {
      btn.innerHTML = idle;
    }
    btn.onclick = (ev) => {
      ev.stopPropagation();
      if (out) return;
      addToCart(p, 1, btn);
      btn.classList.add("added");
      btn.innerHTML = '<span class="prod-add-ico">✓</span><span class="prod-add-tx">Qo\'shildi</span>';
      setTimeout(() => {
        btn.classList.remove("added");
        btn.innerHTML = idle;
      }, 1100);
    };
    // Tugma kartochka TANASI ichida — pastga yopishib turadi (Avto_A1 kabi)
    card.querySelector(".prod-body").append(btn);
    return card;
  }

  /* ==================================================================
     BOSH SAHIFA — tez o'tish plitkalari
     ================================================================== */

  /* DIQQAT: `renderGreeting()` OLIB TASHLANDI.
     U «Xayrli tong / Xayrli kun / Xayrli kech, {ism}» degan qatorni har
     ochilishda ekranning eng tepasida chizardi. Foydasi yo'q edi: mijoz
     ilovani tovar ko'rish uchun ochadi, salomlashuvni o'qish uchun emas.
     Markup ham (`.hm-greet`) index.html dan chiqarildi. */

  /** Tez o'tish plitkalari (bir bosishda: konfigurator / navbat).
   *
   *  «Saqlangan» va «Savatcha» plitkalari OLIB TASHLANDI — ikkisi ham
   *  pastdagi navigatsiyada turadi va bu yerda takrorlanardi.
   *
   *  «Navbat» ilgari bosh sahifadagi `#book-sec` bo'limiga SKROLL qilardi.
   *  U bo'lim endi yo'q — barcha xizmatlar «🛠 Xizmatlar» sahifasida,
   *  shuning uchun plitka o'sha sahifani ochadi. */
  function bindQuickActions() {
    document.querySelectorAll("#hm-quick .hm-q").forEach((b) => {
      b.onclick = () => {
        haptic();
        const go = b.dataset.go;
        if (go === "flow") return openFlow();
        if (go === "book") return show("services");
        show(go);
      };
    });
  }

  /** Plitkalardagi sanoqchilar.
   *
   *  «Saqlangan» va «Savatcha» plitkalari olib tashlangani uchun hozir
   *  sanaladigan narsa qolmadi. Funksiya SAQLANDI: u savat o'zgarganda
   *  bir necha joydan chaqiriladi (`saveCart`), va elementlar yo'q bo'lsa
   *  jimgina chiqib ketadi. Ertaga plitka qaytsa — shu yerga bitta qator
   *  qo'shiladi, chaqiruvlarni qidirish kerak bo'lmaydi. */
  function refreshQuickBadges() {
    const set = (id, n) => {
      const b = $(id);
      if (!b) return;
      b.textContent = n > 99 ? "99+" : String(n);
      b.classList.toggle("hidden", !n);
    };
    set("hm-q-saved", S.favorites ? S.favorites.size : 0);
    set(
      "hm-q-cart",
      (S.cart || []).reduce((s, i) => s + (Number(i.qty) || 0), 0)
    );
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
          ? `<img src="${esc(photo)}" alt="${esc(p.name || "Tovar")}" style="width:100%;border-radius:14px">`
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
      addToCart(p, 1, add);
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
  /* ====================================================================
     RANGLARNI TOZALASH (CSS injection himoyasi)

     Banner va story halqalarining rangi bazadan keladi va ilgari
     `style.background` ga TO'G'RIDAN qo'yilardi:

         node.style.background = `linear-gradient(135deg,${b.color_from},...)`

     Bazaga yozish esa brauzerdan ochiq (admin paneli shunday ishlaydi),
     ya'ni qiymat ishonchsiz. `color_from` ga masalan
     `red), url(https://tashqi-manzil/?x=` yozib qo'yilsa brauzer o'sha
     manzilga so'rov yuborardi — mijozning IP manzili sizib ketardi.

     Endi qiymat faqat hex rang yoki rang NOMI bo'lishi mumkin. Firebase
     qoidalarida ham xuddi shu tekshiruv bor (ikki qatlamli himoya).
     ==================================================================== */
  const SAFE_COLOR = /^(#[0-9a-fA-F]{3,8}|[a-zA-Z]{3,20})$/;

  function safeColor(value, fallback) {
    const text = String(value == null ? "" : value).trim();
    return SAFE_COLOR.test(text) ? text : fallback || "#1d2029";
  }

  function gradientOf(from, to) {
    return `linear-gradient(135deg,${safeColor(from, "#2a2d38")},${safeColor(to, "#12131a")})`;
  }

  /** Tovar qoldig'i — HAR DOIM son. Noma'lum yoki buzuq bo'lsa 0.
   *
   *  ================================================================
   *  ILGARI NIMA XATO EDI
   *  `addToCart` da shunday tekshiruv turardi:
   *
   *      if (have + want > product.stock) return toast(...)
   *
   *  `product.stock` `undefined` bo'lsa (masalan katalog zaxira
   *  qatlamidan kelgan yoki admin qoldiqni kiritmagan) solishtirish
   *  `NaN > NaN` ga aylanadi va NATIJASI DOIM `false`. Ya'ni cheklov
   *  UMUMAN ISHLAMASDI: mijoz 50 dona qo'shib, checkout'da 409 xato
   *  olardi va nima bo'lganini tushunmasdi.
   *  ================================================================ */
  function stockOf(product) {
    const raw = Number(product && product.stock);
    return Number.isFinite(raw) ? Math.max(0, raw) : 0;
  }

  /* ====================================================================
     «SAVATGA UCHISH» ANIMATSIYASI

     Savatga qo'shish — ilovadagi ENG KO'P BOSILADIGAN tugma, lekin ilgari
     javob faqat haptic va nishondagi raqam edi: mijoz tovar qayerga
     ketganini KO'RMASDI.

     Bu naqsh loyihada allaqachon bor (`flyHeart` — story reaksiyasi),
     shu yerga qo'llanmagan edi.

     Animatsiya `position: fixed` element bilan qilinadi (DOM tartibiga
     ta'sir qilmaydi) va `requestAnimationFrame` ichida boshlanadi.
     Tugagach element O'ZINI O'CHIRADI — aks holda har bosishda sahifada
     bittadan «o'lik» element qolib borardi.
     ==================================================================== */
  function flyToCart(sourceEl, emoji) {
    // Harakatni kamaytirish rejimi — animatsiya qilmaymiz
    try {
      if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        return;
      }
    } catch (_) {}

    const target = $("cart-badge") || document.querySelector('.nav-btn[data-page="cart"]');
    if (!sourceEl || !target || !sourceEl.getBoundingClientRect) return;

    const from = sourceEl.getBoundingClientRect();
    const to = target.getBoundingClientRect();
    if (!from.width || !to.width) return;

    const dot = el("div", "fly-cart", emoji || "🛒");
    dot.style.left = from.left + from.width / 2 + "px";
    dot.style.top = from.top + from.height / 2 + "px";
    document.body.appendChild(dot);

    const dx = to.left + to.width / 2 - (from.left + from.width / 2);
    const dy = to.top + to.height / 2 - (from.top + from.height / 2);

    requestAnimationFrame(() => {
      dot.style.transform = `translate(${dx}px, ${dy}px) scale(0.35)`;
      dot.style.opacity = "0.15";
    });

    // `transitionend` kelmasa ham element qolib ketmasin
    let done = false;
    const cleanup = () => {
      if (done) return;
      done = true;
      dot.remove();
      // Nishonni «sakratamiz» — tovar yetib kelgani ko'rinadi
      if (target.classList) {
        target.classList.remove("landed");
        void target.offsetWidth;
        target.classList.add("landed");
      }
    };
    dot.addEventListener("transitionend", cleanup, { once: true });
    setTimeout(cleanup, 700);
  }

  function addToCart(product, qty, sourceEl) {
    const want = Math.max(1, parseInt(qty, 10) || 1);
    const found = S.cart.find((i) => i.id === product.id);
    const have = found ? found.qty : 0;
    const stock = stockOf(product);

    if (stock <= 0) {
      haptic("warn");
      return toast("Bu tovar hozir tugagan");
    }
    if (have + want > stock) {
      haptic("warn");
      return toast(`Omborda ${stock} dona bor`);
    }

    if (found) found.qty += want;
    else
      S.cart.push({
        id: product.id,
        name: product.name,
        price: product.price,
        qty: want,
        stock: stock,
        photo_url: product.photo_url || null, // savat qatorida rasm ko'rsatish uchun
      });
    saveCart();
    haptic();
    if (sourceEl) flyToCart(sourceEl, "🛒");
  }

  /* DIQQAT: `renderBookCard()` OLIB TASHLANDI.
     U bosh sahifada «Ustaga navbat olish» kartochkasini chizardi va
     «2–3 soat / 1 yil kafolat» degan QATTIQ raqamlarni ko'rsatardi —
     xizmatga bog'liq emas, ya'ni ko'pincha noto'g'ri. Navbat endi
     «🛠 Xizmatlar» sahifasida, har xizmatning O'Z muddati va kafolati
     bilan (`renderServicesPage`). */

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
          loadHome({ force: isHomeStale() });
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
            ${
              /* Bittadan ko'p bo'lsa DONA NARXI ham yoziladi. Ilgari faqat
                 yig'indi turardi va mijoz «nega bunchalik?» deb hisobni
                 tekshira olmasdi. */
              item.qty > 1
                ? `<i class="cart-unit">${item.qty} × ${esc(fmt(item.price))}</i>`
                : ""
            }
          </div>
          <div class="cart-controls">
            <button data-act="minus" aria-label="Kamaytirish">−</button>
            <span class="cart-qty">${item.qty}</span>
            <button data-act="plus" aria-label="Ko'paytirish"${
              /* Qoldiq tugagan bo'lsa tugma O'CHIRILADI. Ilgari bosilaverardi
                 va faqat toast chiqardi — mijoz nima uchun ko'paymayotganini
                 tushunmasdi.
                 `stockOf()` orqali: `item.stock` `undefined` bo'lsa
                 `qty >= undefined` `false` beradi va tugma OCHIQ qolardi. */
              item.qty >= stockOf(item) ? ' disabled title="Omborda shuncha bor"' : ""
            }>+</button>
          </div>
        </div>
        <div class="swipe-delete" title="O'chirish">🗑</div>`;
      row.querySelector('[data-act="minus"]').onclick = () => changeQty(item.id, -1);
      row.querySelector('[data-act="plus"]').onclick = () => changeQty(item.id, 1);
      row.querySelector(".swipe-delete").onclick = () => removeCartItem(item.id);
      box.append(row);
    });

    /* «Savatni bo'shatish» — bittalab o'chirish uzoq. Ro'yxat ostida,
       ko'zga tashlanmaydigan joyda (tasodifan bosilmasin) va tasdiq
       so'raydi. */
    const clear = el("button", "cart-clear", "🗑 Savatni bo'shatish");
    clear.onclick = async () => {
      if (!(await ask("Savatdagi hamma narsa o'chirilsinmi?"))) return;
      // Nusxasini saqlaymiz — «Qaytarish» uchun
      const backup = S.cart.slice();
      S.cart = [];
      saveCart();
      renderCart();
      haptic("success");
      toast("Savat bo'shatildi", {
        undo: () => {
          // Shu orada yangi tovar qo'shilgan bo'lsa uni YO'QOTMAYMIZ
          const current = S.cart.slice();
          S.cart = backup.concat(current.filter((i) => !backup.some((b) => b.id === i.id)));
          saveCart();
          renderCart();
        },
      });
    };
    box.append(clear);

    const total = cartSum();
    const sumEl = $("cart-total-sum");
    if (sumEl) sumEl.textContent = fmt(total);
    // Jami yonida DONA soni — mijoz nechta tovar olayotganini ko'radi
    const nEl = $("cart-total-n");
    if (nEl) {
      const n = S.cart.reduce((s, i) => s + i.qty, 0);
      nEl.textContent = n + " dona";
    }
    // Kuryer shahri serverdan keladi — belgida ham shu yozilishi kerak,
    // aks holda HTML'dagi qattiq nom bilan ziddiyat chiqadi.
    const cityEl = $("ct-city");
    if (cityEl) cityEl.textContent = dcity();
    renderCartProgress(total);
  }

  /** Savat qatorini butunlay o'chiradi (swipe → 🗑). */
  function removeCartItem(id) {
    const index = S.cart.findIndex((i) => i.id === id);
    if (index < 0) return;
    const removed = S.cart[index];

    S.cart = S.cart.filter((i) => i.id !== id);
    haptic("light");
    saveCart();
    renderCart();

    /* «Qaytarish» — noto'g'ri surib o'chirish oson bo'lgani uchun.
       Tovar AYNAN o'z joyiga qaytariladi (oxiriga emas). */
    toast(`${removed.name || "Tovar"} o'chirildi`, {
      undo: () => {
        if (S.cart.some((i) => i.id === removed.id)) return; // qayta qo'shilgan
        S.cart.splice(Math.min(index, S.cart.length), 0, removed);
        saveCart();
        renderCart();
      },
    });
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
    // `stockOf()` — `item.stock` noma'lum bo'lsa 0 deb hisoblanadi va
    // ko'paytirish to'xtatiladi (ilgari `NaN` solishtirish sababli o'tardi).
    const stock = stockOf(item);
    if (delta > 0 && item.qty + 1 > stock) {
      haptic("warn");
      return toast(stock > 0 ? `Omborda ${stock} dona bor` : "Bu tovar tugagan");
    }
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

  /* Kuryer ishlaydigan shahar. Server `/api/config` da `delivery_city`
     beradi; u yetib kelmasa zaxira qiymat ishlatiladi. */
  const dcity = () => (S.pay && S.pay.city) || "Samarqand";

  /* ================================================================
     DO'KON ALOQA MA'LUMOTLARI — YAGONA MANBA

     Uch joyda kerak: «Biz bilan aloqa», to'lov cheki yuborish va
     zaxira rejimdagi xabar. Ilgari har biri o'zicha o'qirdi va
     natijada bir joyda username bor, boshqasida yo'q bo'lib qolardi.

     Tartib: SERVER (`/api/config`) -> Mini App sozlamasi
     (`docs/config.js`). Serverda `PAY_ADMIN_USERNAME` bo'sh bo'lsa
     ilova ishlashdan to'xtamaydi — `SHOP_TELEGRAM` ishlatiladi.
     ================================================================ */

  /** Do'konning Telegram username'i (@ belgisisiz). */
  function shopTelegram() {
    const fromServer = (S.pay && S.pay.admin) || "";
    if (fromServer) return String(fromServer).replace(/^@+/, "");
    const cfg = window.ZIMMER_CONFIG || {};
    return String(cfg.SHOP_TELEGRAM || "").replace(/^@+/, "");
  }

  /** Do'kon telefon raqami (ko'rinadigan ko'rinishda). */
  function shopPhone() {
    const fromServer = (S.pay && S.pay.phone) || "";
    if (fromServer) return String(fromServer);
    const cfg = window.ZIMMER_CONFIG || {};
    return String(cfg.SHOP_PHONE || "");
  }

  /** Telegram chatini ochadi. */
  function openTelegram(username) {
    const name = String(username || "").replace(/^@+/, "");
    if (!name) return toast("Telegram manzili sozlanmagan");
    try {
      tg.openTelegramLink("https://t.me/" + name);
    } catch (_) {
      try {
        window.open("https://t.me/" + name, "_blank");
      } catch (_) {}
    }
  }

  /** Qo'ng'iroq qiladi.
   *
   *  `tel:` — Telegram ichida `openLink` bilan ishlamaydi (u faqat
   *  http/https ni ochadi), shuning uchun `location.href` ishlatiladi.
   *  Raqamdan bo'shliq va qavslar olib tashlanadi — aks holda ba'zi
   *  telefonlar havolani tushunmaydi. */
  function callPhone(phone) {
    const digits = String(phone || "").replace(/[^\d+]/g, "");
    if (!digits) return toast("Telefon raqami sozlanmagan");
    try {
      window.location.href = "tel:" + digits;
    } catch (_) {
      copyText(phone, "📋 Raqam nusxalandi — qo'ng'iroq qiling");
    }
  }

  /** "Rasmiylashtirish" tugmasi: to'liq ekranli oynani ochadi. */
  function startCheckout() {
    if (!S.cart.length) return toast("Savatcha bo'sh");
    // Oxirgi tekshiruv: savatdagi tovar hali sotuvdami, narxi o'zgarmadimi.
    const sync = syncCartWithCatalog();
    if (sync.removed.length) {
      renderCart();
      return toast("⚠️ Sotuvdan chiqqan tovar savatdan olindi: " + sync.removed.join(", "), 5000);
    }
    if (sync.changed.length) {
      renderCart();
      return toast("ℹ️ Narx yangilandi — tekshirib, qaytadan bosing", 4000);
    }
    /* Telefonni bu yerda TEKSHIRMAYMIZ — u endi oynaning 1-qadami.
       Ilgari `openPhoneSheet(startCheckout)` chaqirilardi va mijoz raqamini
       oqim ichida ko'rib-o'zgartira olmasdi. */
    S.delivery = null;
    S.dlvMethod = null;
    S.payMethod = null; // yangi buyurtma — usul qaytadan tanlanadi
    S.coStep = 1;
    haptic();
    show("checkout");
  }

  /* ==================================================================
     RASMIYLASHTIRISH OYNASI — UCH QADAM

         1) Ma'lumot   2) Yetkazib berish   3) To'lov

     Har qadam `#co-body` ichiga chiziladi, tepadagi ko'rsatkich
     (`#co-steps`) qaysi qadamda turganini bildiradi. BAJARILGAN qadamga
     bosib qaytish mumkin; oldinga sakrab o'tish mumkin emas — har qadam
     o'zining tasdiqlashi bilan o'tadi (manzilsiz to'lovga o'tib bo'lmaydi).
     ================================================================== */

  const CO_STEPS = [
    { n: 1, icon: "👤", label: "Ma'lumot", title: "Ma'lumotlaringiz" },
    { n: 2, icon: "🚚", label: "Yetkazish", title: "Yetkazib berish" },
    { n: 3, icon: "💳", label: "To'lov", title: "To'lov" },
  ];

  /** Qadamga o'tadi va oynani qayta chizadi. */
  function coGo(step) {
    S.coStep = Math.min(Math.max(Number(step) || 1, 1), CO_STEPS.length);
    renderCheckout();
  }

  /** Savat xulosasi — har qadamda tepada turadi, shunda mijoz nima uchun
   *  qancha to'layotganini ko'zdan qochirmaydi. */
  function coSummary() {
    const count = S.cart.reduce((s, i) => s + (Number(i.qty) || 0), 0);
    return (
      '<div class="co-sum">' +
      '<span class="co-sum-ic">🧺</span>' +
      '<span class="co-sum-tx"><b>' +
      count +
      " ta mahsulot</b><i>Savatchadagi buyurtma</i></span>" +
      "<em>" +
      esc(fmt(cartSum())) +
      "</em>" +
      "</div>"
    );
  }

  function renderCheckout() {
    /* Savat bo'shab qolsa (buyurtma yuborildi yoki oxirgi tovar o'chirildi)
       bu oynada turishning ma'nosi yo'q — savatga qaytaramiz. */
    if (!S.cart.length) return show("cart");

    const step = CO_STEPS[S.coStep - 1] || CO_STEPS[0];
    $("co-title").textContent = step.title;
    $("co-sub").textContent = step.n + "-qadam / " + CO_STEPS.length;

    // ---- qadam ko'rsatkichi
    $("co-steps").innerHTML = CO_STEPS.map((s) => {
      const state = s.n < S.coStep ? " is-done" : s.n === S.coStep ? " is-now" : "";
      return (
        '<button class="co-node' + state + '" data-step="' + s.n + '">' +
        "<i>" + (s.n < S.coStep ? "✓" : s.icon) + "</i>" +
        "<span>" + esc(s.label) + "</span></button>"
      );
    }).join("");
    document.querySelectorAll("#co-steps .co-node").forEach((node) => {
      node.onclick = () => {
        const n = parseInt(node.dataset.step, 10);
        if (!n || n >= S.coStep) return; // faqat orqaga
        haptic("light");
        coGo(n);
      };
    });

    if (S.coStep === 2) coStepDelivery();
    else if (S.coStep === 3) coStepPayment();
    else coStepContact();

    window.scrollTo({ top: 0 });
  }

  /* ----------------------------------------------- 1-qadam: ma'lumotlar */
  function coStepContact() {
    const me = S.me || (S.me = {});
    const name = me.full_name || "";
    const phone = me.phone || "";

    $("co-body").innerHTML =
      coSummary() +
      `<p class="step-sub">Buyurtma kim uchun va qaysi raqamga? Bir marta
        kiritasiz — keyingi buyurtmalarda tayyor turadi.</p>
       <label class="field"><span>👤 Ism va familiya</span>
         <input id="co-name" value="${esc(name)}" placeholder="Anvarjon Axtamov"></label>
       <label class="field"><span>📞 Telefon</span>
         <input id="co-phone" type="tel" inputmode="tel" value="${esc(phone)}"
                placeholder="+998901234567"></label>
       <button class="btn btn-ghost" id="co-contact">📱 Telegram raqamimni yuborish</button>
       <button class="btn btn-primary co-cta" id="co-next-1">Davom etish →</button>`;

    wireRequestContact("co-contact", "co-phone");

    $("co-next-1").onclick = async () => {
      const btn = $("co-next-1");
      const fullName = ($("co-name").value || "").trim();
      const value = ($("co-phone").value || "").trim();
      if (fullName.length < 2) return toast("Ismingizni kiriting");
      if (value.replace(/\D/g, "").length < 9) return toast("Telefon raqamni to'liq kiriting");

      // Hech narsa o'zgarmasa serverni bezovta qilmaymiz — darhol o'tamiz.
      if (me.full_name === fullName && me.phone === value) {
        haptic();
        return coGo(2);
      }

      btn.disabled = true;
      btn.textContent = "Saqlanmoqda...";
      try {
        await persistContact(fullName, value);
        haptic("ok");
        renderPhoneWarn();
        coGo(2);
      } catch (err) {
        btn.disabled = false;
        btn.textContent = "Davom etish →";
        onError(err);
      }
    };
  }

  /* ------------------------------------------ 2-qadam: yetkazib berish */
  function coStepDelivery() {
    $("co-body").innerHTML =
      coSummary() +
      `<p class="step-sub">Buyurtmani qanday qabul qilmoqchisiz?</p>
       <div class="dlv-methods">
         <button class="dlv-card" id="dlv-courier">
           <span class="dlv-ico">🚖</span>
           <span class="dlv-txt"><b>Kuryer — manzilga</b>
             <small>Faqat ${esc(dcity())} shahar ichida</small></span>
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
             placeholder="${esc(dcity())}, Registon ko'chasi, 25-uy, 12-xonadon"></textarea></label>
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

       <button class="btn btn-primary co-cta" id="dlv-continue">To'lovga o'tish →</button>`;

    /* Viloyatlar ro'yxati BU YERDA to'ldirilmaydi — `bts.js` (61 KB)
       endi talab bo'yicha yuklanadi va u faqat «BTS Pochta» tanlanganda
       kerak. `fillBtsRegions()` shuni qiladi (`pickDelivery` chaqiradi). */

    $("dlv-courier").onclick = () => pickDelivery("courier");
    $("dlv-bts").onclick = () => pickDelivery("bts");
    $("dlv-map-btn").onclick = () => openMapPicker("checkout");
    regSel.onchange = btsRegionChange;
    $("bts-district").onchange = btsDistrictChange;
    $("bts-branch").onchange = btsBranchChange;
    $("dlv-continue").onclick = confirmDelivery;

    /* To'lov qadamidan orqaga qaytilsa — tanlangan usul va yozilgan manzil
       joyida qoladi. Ilgari pastdan chiqadigan panel har ochilishida
       toza chizilardi va mijoz manzilni QAYTA yozishga majbur bo'lardi. */
    if (S.dlvMethod) {
      pickDelivery(S.dlvMethod);
      const box = $("dlv-address");
      if (
        box &&
        S.dlvMethod === "courier" &&
        S._dlvSelectedAddr === null &&
        S.delivery &&
        S.delivery.method === "courier"
      ) {
        box.value = S.delivery.address || "";
      }
    }
  }

  function pickDelivery(method) {
    S.dlvMethod = method;
    haptic("selection");
    $("dlv-courier").classList.toggle("on", method === "courier");
    $("dlv-bts").classList.toggle("on", method === "bts");
    $("dlv-courier-box").classList.toggle("hidden", method !== "courier");
    $("dlv-bts-box").classList.toggle("hidden", method !== "bts");
    // BTS filiallari (61 KB) faqat SHU YERDA kerak — talab bo'yicha yuklanadi
    if (method === "bts") fillBtsRegions();
    if (method === "courier") {
      /* «Asosiy» manzil o'zi tanlanadi. Ilgari mijoz saqlangan manzillari
         bo'lsa ham har safar ro'yxatdan bosib tanlashi kerak edi — eng
         ko'p takrorlanadigan ish shu bo'lgan. */
      if (S._dlvSelectedAddr === null) {
        const arr = getAddresses();
        const di = arr.findIndex((x) => x && x.def);
        if (di >= 0) S._dlvSelectedAddr = di;
      }
      renderCourierAddresses();
    }
  }

  /** Viloyatlar ro'yxatini to'ldiradi (kerak bo'lsa `bts.js` ni yuklaydi). */
  async function fillBtsRegions() {
    const regSel = $("bts-region");
    if (!regSel || regSel.dataset.filled === "1") return;

    if (!window.BTS_BRANCHES) {
      regSel.innerHTML = '<option value="">Yuklanmoqda…</option>';
      regSel.disabled = true;
      try {
        await ensureBts();
      } catch (err) {
        console.error("[bts] filiallar yuklanmadi:", err);
        regSel.innerHTML = '<option value="">Yuklanmadi — qayta urinib ko\'ring</option>';
        regSel.disabled = false;
        return;
      }
    }

    // Mijoz shu orada kuryerni tanlagan bo'lishi mumkin
    if (S.dlvMethod !== "bts") {
      regSel.disabled = false;
      return;
    }

    const B = window.BTS_BRANCHES || {};
    regSel.innerHTML = '<option value="">— Viloyatni tanlang —</option>';
    Object.keys(B).forEach((r) => {
      const o = el("option");
      o.value = r;
      o.textContent = r;
      regSel.append(o);
    });
    regSel.disabled = false;
    regSel.dataset.filled = "1";
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
        const note = a.note ? ` (${a.note})` : "";
        // Uy/xonadon izohi MANZILGA qo'shiladi — kuryer uni ko'rmasa,
        // izohning ma'nosi qolmaydi (bot faqat `address` ni yuboradi).
        const addr = a.address + note;
        const mapLink = a.mapLink || "";
        S.delivery = {
          method: "courier", address: addr, mapLink,
          summary:
            `Kuryer (manzilga): ${a.label || a.address}${note}` +
            (a.address && a.label ? `\n📍 ${a.address}` : "") +
            (mapLink ? `\n🗺 ${mapLink}` : ""),
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
    coGo(3);
  }

  /* ==================================================================
     3-QADAM: TO'LOV

     NEGA QAYTA YOZILDI
     Ilgari bu qadam IKKI ekranga bo'lingan edi: avval uch usul ro'yxati,
     usulni bosgach butun ro'yxat YASHIRILIB o'rniga tafsilot chiqardi va
     «‹ Boshqa usul» tugmasi paydo bo'lardi. Muammolari:

       • mijoz qayerda turganini yo'qotardi (ro'yxat ko'rinmay qolardi);
       • usulni almashtirish uchun orqaga qaytish kerak edi;
       • buyurtmani yuboradigan joy IKKI xil bo'lgan: «Naqd» ro'yxatda,
         «To'ladim» esa tafsilot ichida — ya'ni bir xil ish ikki xil
         tugmada;
       • summa tafsilot ichida yana bir marta takrorlanardi.

     Endi BITTA ekran, tepadan pastga bitta oqim:

       1) yetkazib berish eslatmasi — bosilsa 2-qadamga qaytaradi;
       2) SUMMA — eng katta element (mijozning asosiy savoli);
       3) uch usul iOS «grouped list» ko'rinishida, tanlangani belgilanadi;
       4) tanlangan usulning tafsiloti O'SHA YERDA, ro'yxat ostida
          ochiladi — hech narsa yashirilmaydi;
       5) pastda YAKKA tugma: nima bo'lishini aniq yozadi.
     ================================================================== */

  /** To'lov usullari — yagona lug'at.
   *
   *  `label`  — buyurtmaga yoziladigan nom (admin shu matnni ko'radi);
   *  `cta`    — pastdagi yakka tugma matni;
   *  `chat`   — yuborilgandan keyin admin chati ochilsinmi (chek uchun).
   *             Faqat kartada kerak: admin to'lovni tekshirishi shart. */
  const PAY_METHODS = {
    card: {
      icon: "💳",
      title: "Karta orqali o'tkazma",
      sub: "Uzcard / Humo",
      label: "Karta orqali o'tkazma",
      cta: "✓ To'lovni yubordim",
      note: "🛡 Admin to'lovni tekshirgach buyurtma tasdiqlanadi.",
      chat: true,
    },
    app: {
      icon: "📱",
      title: "Payme yoki Click",
      sub: "Ilova orqali o'tkazma",
      label: "Ilova orqali (Payme/Click)",
      cta: "✓ To'lovni yubordim",
      note: "🛡 Admin to'lovni tekshirgach buyurtma tasdiqlanadi.",
      chat: false,
    },
    cash: {
      icon: "💵",
      title: "Naqd pul",
      sub: "Tovarni olganda to'laysiz",
      label: "Naqd pul (yetkazilganda)",
      cta: "Buyurtmani tasdiqlash",
      note: "💵 To'lovni kuryerga tovarni qo'lga olganda berasiz.",
      chat: false,
    },
  };

  /** Yetkazib berish eslatmasi — bosiladi (2-qadamga qaytaradi).
   *  Xarita havolasi va ko'p qatorlilik tozalanadi: uzun URL bu yerda
   *  faqat xalaqit beradi. */
  function payRecap() {
    if (!S.delivery) return "";
    const isBts = S.delivery.method === "bts";
    const txt = moClean(S.delivery.summary || S.delivery.address || "");
    return (
      '<button class="pz-recap" id="pz-recap">' +
      '<span class="pz-recap-ic">' + (isBts ? "📦" : "🚖") + "</span>" +
      '<span class="pz-recap-tx"><small>Yetkazib berish</small>' +
      "<b>" + esc(txt) + "</b></span>" +
      '<span class="pz-recap-go">O\'zgartirish</span>' +
      "</button>"
    );
  }

  function payHero(sum) {
    const n = S.cart.reduce((s, i) => s + i.qty, 0);
    const free = sum >= FREE_DELIVERY_TARGET;
    return (
      '<div class="pz-hero">' +
      "<small>To'lov summasi</small>" +
      '<b id="pz-sum">' + esc(fmt(sum)) + "</b>" +
      "<span>" + n + " dona mahsulot" +
      (free ? " · 🚚 yetkazish bepul" : "") + "</span></div>"
    );
  }

  function payRow(kind) {
    const m = PAY_METHODS[kind];
    return (
      '<button class="pz-row" id="pz-row-' + kind + '" data-pay="' + kind + '">' +
      '<span class="pz-radio"></span>' +
      '<span class="pz-ic pz-ic-' + kind + '">' + m.icon + "</span>" +
      '<span class="pz-tx"><b>' + esc(m.title) + "</b>" +
      "<small>" + esc(m.sub) + "</small></span></button>"
    );
  }

  function coStepPayment() {
    const sum = cartSum();
    const isBts = S.delivery && S.delivery.method === "bts";

    /* BTS Pochta oldindan to'lov talab qiladi — naqd mumkin emas.
       Mijoz 2-qadamga qaytib usulni BTS ga o'zgartirgan bo'lishi mumkin,
       shuning uchun eskirgan tanlov shu yerda tozalanadi (aks holda
       «Naqd» tanlangan holatda qolib, tugma ishlab ketardi). */
    if (isBts && S.payMethod === "cash") S.payMethod = null;

    const rows = isBts ? ["card", "app"] : ["card", "app", "cash"];

    $("co-body").innerHTML =
      payRecap() +
      payHero(sum) +
      '<div class="pz-label">To\'lov usulini tanlang</div>' +
      '<div class="pz-group">' + rows.map(payRow).join("") + "</div>" +
      (isBts
        ? '<p class="pz-note">ℹ️ BTS Pochta orqali yuborishdan oldin to\'lov ' +
          "qilinadi — shu sababli «Naqd» mavjud emas.</p>"
        : "") +
      '<div class="pz-panel" id="pz-panel"><div class="pz-panel-in" id="pz-panel-in"></div></div>' +
      '<div class="pz-cta-wrap">' +
      '<button class="btn btn-primary pz-cta" id="pz-cta" disabled>Usulni tanlang</button>' +
      '<p class="pz-cta-note" id="pz-cta-note">Usulni tanlaganingizdan keyin davom etamiz.</p>' +
      "</div>";

    const recap = $("pz-recap");
    if (recap) recap.onclick = () => coGo(2);
    rows.forEach((k) => {
      $("pz-row-" + k).onclick = () => pickPay(k);
    });
    $("pz-cta").onclick = payConfirm;

    // Summa 0 dan sanab chiqadi — qadam «tirik» bo'lib ochiladi
    animateNum("pz-sum", sum, (v) => fmt(v));

    /* Mijoz to'lovga qaytib kelsa (masalan manzilni tuzatib), avval
       tanlagan usuli JOYIDA qoladi — qaytadan tanlashi shart emas. */
    if (S.payMethod && rows.indexOf(S.payMethod) !== -1) pickPay(S.payMethod, true);
  }

  /** Usulni tanlash: belgi, tafsilot va pastdagi tugma birga yangilanadi. */
  function pickPay(kind, silent) {
    const m = PAY_METHODS[kind];
    if (!m) return;
    S.payMethod = kind;
    if (!silent) haptic("selection");

    document.querySelectorAll(".pz-row").forEach((r) => {
      r.classList.toggle("is-on", r.dataset.pay === kind);
    });
    renderPayPanel(kind);

    const cta = $("pz-cta");
    if (cta) {
      cta.disabled = false;
      cta.textContent = m.cta;
    }
    const note = $("pz-cta-note");
    if (note) note.textContent = m.note;
  }

  /** Tanlangan usulning tafsiloti.
   *
   *  Balandlik JS dan beriladi (`max-height`), so'ng cheklov olib
   *  tashlanadi — kontent qanchalik uzun bo'lsa ham qirqilmaydi. Usul
   *  almashtirilganda panel allaqachon ochiq, shuning uchun balandlik
   *  erkin qoldiriladi (aks holda yangi matn eski o'lchamga sig'masdi). */
  function renderPayPanel(kind) {
    const panel = $("pz-panel");
    const box = $("pz-panel-in");
    if (!panel || !box) return;

    const sum = cartSum();
    const card = (S.pay && S.pay.card) || "";
    const holder = (S.pay && S.pay.holder) || "";

    if (kind === "cash") {
      box.innerHTML =
        '<div class="pz-info"><b>💵 ' + esc(fmt(sum)) + "</b>" +
        "<small>Kuryer tovarni keltirganda naqd to'laysiz. Iltimos, summani " +
        "aniq tayyorlab turing — kuryerda qaytim bo'lmasligi mumkin.</small></div>";
    } else if (!card) {
      /* Rekvizitlar serverdan kelmagan. YOLG'ON karta ko'rsatmaymiz —
         mijoz bo'sh raqamga pul o'tkazishga urinishi mumkin edi. */
      box.innerHTML =
        '<div class="pz-info is-warn"><b>⚠️ Karta rekvizitlari yuklanmadi</b>' +
        "<small>Internetni tekshirib ilovani yangilang yoki «Naqd» usulini " +
        "tanlang.</small></div>";
    } else {
      const steps =
        kind === "card"
          ? [
              "Karta raqamini <b>nusxalang</b>",
              "Bank ilovangizda <b>" + esc(fmt(sum)) + "</b> o'tkazing",
              "Pastdagi <b>«To'lovni yubordim»</b> tugmasini bosing",
            ]
          : [
              "<b>Payme</b> yoki <b>Click</b> ni ochib, shu kartaga <b>" +
                esc(fmt(sum)) + "</b> o'tkazing",
              "So'ng <b>«To'lovni yubordim»</b> tugmasini bosing",
            ];

      box.innerHTML =
        '<div class="pz-card">' +
        '<div class="pz-card-top"><span class="pz-card-chip"></span><em>UZCARD</em></div>' +
        '<div class="pz-card-num" id="pz-card-num">' + esc(card) + "</div>" +
        '<div class="pz-card-foot"><span>' + esc(holder || "—") + "</span>" +
        '<button class="pz-copy" id="pz-copy">📋 Nusxalash</button></div></div>' +
        /* O'tkaziladigan summa kartaning YONIDA yana bir marta turadi.
           Tepadagi summa skroll qilinganda ko'rinmay qoladi, mijoz esa
           bank ilovasiga o'tishdan oldin aynan shu raqamni yozadi. */
        '<div class="pz-amount"><small>O\'tkaziladigan summa</small><b>' +
        esc(fmt(sum)) + "</b></div>" +
        (kind === "app"
          ? '<div class="pz-apps">' +
            '<button class="pz-app" id="pz-payme">Payme ochish</button>' +
            '<button class="pz-app" id="pz-click">Click ochish</button></div>'
          : "") +
        '<ol class="pz-steps">' +
        steps.map((s) => "<li>" + s + "</li>").join("") +
        "</ol>";

      // Raqamning o'ziga bosish ham nusxalaydi (eski odat saqlanadi)
      const num = $("pz-card-num");
      if (num) num.onclick = copyCard;
      const cp = $("pz-copy");
      if (cp) cp.onclick = copyCard;
      const pm = $("pz-payme");
      if (pm) pm.onclick = () => openPayApp("payme");
      const ck = $("pz-click");
      if (ck) ck.onclick = () => openPayApp("click");
    }

    if (panel.dataset.open === "1") {
      // Panel allaqachon ochiq — balandlikni erkin qoldiramiz
      panel.style.maxHeight = "none";
      return;
    }
    panel.dataset.open = "1";
    panel.style.maxHeight = (box.scrollHeight || 900) + "px";
    clearTimeout(panel._pzT);
    panel._pzT = setTimeout(() => {
      panel.style.maxHeight = "none";
    }, 420);
  }

  const cardDigits = () => ((S.pay && S.pay.card) || "").replace(/\s/g, "");

  function copyCard() {
    const digits = cardDigits();
    if (!digits) return toast("Karta raqami yuklanmadi");
    // `copyText` ikki yo'lni biladi: `navigator.clipboard` va zaxira
    // `execCommand` (Telegram WebView'da birinchisi har doim ishlamaydi).
    copyText(digits, "📋 Karta raqami nusxalandi");
  }

  function openPayApp(provider) {
    haptic("medium");
    const url =
      provider === "payme"
        ? "https://payme.uz/home/main"
        : "https://my.click.uz/app/transfer";
    openExternal(url);
    toast((provider === "payme" ? "Payme" : "Click") + " ochildi. Kartaga o'tkazing!");
  }

  /** Yakka tugma: tanlangan usulga qarab buyurtmani yuboradi.
   *
   *  Tasdiq oynasi FAQAT pul o'tkazma usullarida so'raladi. Sabab: mijoz
   *  «to'ladim» deb da'vo qilyapti va admin buni tekshirishga vaqt
   *  sarflaydi — noto'g'ri bosilishi qimmatga tushadi. Naqdda esa hali
   *  hech qanday pul harakati yo'q, ortiqcha oyna faqat xalaqit beradi
   *  (ilgari aynan teskari edi: naqdda so'rardi, kartada — yo'q). */
  async function payConfirm() {
    const kind = S.payMethod;
    const m = PAY_METHODS[kind];
    if (!m) return toast("To'lov usulini tanlang");

    if (kind !== "cash") {
      const ok = await ask(
        "To'lovni amalga oshirdingizmi?\n\n" +
          "Summa: " + fmt(cartSum()) + "\n\n" +
          "Admin to'lovni tekshirib buyurtmani tasdiqlaydi."
      );
      if (!ok) return;
    }
    placeOrder(m.label, !!m.chat);
  }

  /** Yakuniy qadam: buyurtmani yuboradi.
   *
   *  =================================================================
   *  NEGA WORKER BIRINCHI (va nega ilgari buyurtma berib bo'lmasdi)
   *  =================================================================
   *  Do'kon katalogi FIREBASE'dan o'qiladi (`catalog/products`) — admin
   *  paneli ham aynan shu yerga yozadi. Ya'ni buyurtmani ham SHU manbaga
   *  qarab tekshiradigan yo'l bilan yuborish kerak.
   *
   *  Cloudflare Worker aynan shunday ishlaydi: narx va qoldiqni
   *  `catalog/products` dan O'ZI o'qiydi, tekshiradi, `pending_orders` ga
   *  yozadi, qoldiqni kamaytiradi va adminga Telegram xabarini yuboradi.
   *
   *  `/api/orders` (Render) esa SQLite'ga qaraydi. Mini app admin panelida
   *  qo'shilgan tovarning id'si 900000 dan boshlanadi (`fb.js: ID_BASE`)
   *  va SQLite'da UMUMAN YO'Q. Natijada:
   *
   *      create_order_from_items -> get_product(900001) -> None
   *      -> problems=[{reason: "not_found"}] -> 409 order_failed
   *      -> mijozga: «Ba'zi mahsulotlar yetarli emas. Savatchani yangilang»
   *
   *  Mijoz tovarni ko'radi, savatga qo'shadi — lekin buyurtma bermaydi va
   *  xabar ham YOLG'ON sabab ko'rsatadi (qoldiq yetarli, tovar shunchaki
   *  boshqa omborda). Savatni yangilash ham yordam bermaydi.
   *
   *  Shu sababli endi Worker BIRINCHI — Render bor yoki yo'q, farqi yo'q.
   *  Worker sozlanmagan bo'lsa `/api/orders` zaxira sifatida ishlatiladi.
   */
  function placeOrder(paymentLabel, openAdminChat) {
    if (!S.delivery) return toast("Yetkazib berish usulini tanlang");
    if (!S.cart.length) return toast("Savatcha bo'sh");

    if (window.ZimmerOffline && ZimmerOffline.workerReady()) {
      return placeOrderViaWorker(paymentLabel, openAdminChat);
    }
    if (S.offline) return offlineBlocked("Buyurtma berish");
    return placeOrderViaApi(paymentLabel, openAdminChat);
  }

  /** Zaxira yo'l: Render `/api/orders` (SQLite bo'yicha tekshiradi). */
  function placeOrderViaApi(paymentLabel, openAdminChat) {
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
        S.payMethod = null;
        S.coStep = 1; // rasmiylashtirish oynasi keyingi safar 1-qadamdan
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
        // 409 `order_failed` — sabab «qoldiq yetarli emas» deb yoziladi,
        // lekin aslida tovar SQLite'da yo'q bo'lishi ham mumkin. Aniq
        // aytamiz, aks holda mijoz savatni behuda yangilab o'tiradi.
        if (err && err.problems && err.problems.length) {
          const lost = err.problems.filter((p) => p.reason === "not_found").length;
          if (lost) {
            toast(
              "❌ " + lost + " ta tovar serverda topilmadi. Savatdan olib tashlab qayta urinib ko'ring.",
              5500
            );
            return;
          }
        }
        throw err;
      }
    });
  }

  /* ==================================================================
     SAVATNI JONLI KATALOG BILAN MOSLASHTIRISH

     Savat `localStorage["zimmer_cart"]` da nom/narx/qoldiq NUSXASI bilan
     saqlanadi va `renderCart()` katalogga umuman qaramaydi. Shu sababli:

       • admin tovarni o'chirsa — savatda turaveradi va buyurtma 409 bilan
         yiqiladi (mijoz sababini tushunmaydi);
       • narx o'zgarsa — savatda ESKI narx ko'rinadi va jami summa
         serverdagi summaga mos kelmaydi;
       • qoldiq kamaysa — «yetarli emas» xatosi faqat oxirida chiqadi.

     Endi savat ochilganda va buyurtma berishdan oldin ro'yxat jonli
     katalog bilan solishtiriladi.
     ================================================================== */
  function syncCartWithCatalog() {
    const live = new Map();
    (S.shopProducts || []).forEach((p) => live.set(String(p.id), p));
    // Katalog hali yuklanmagan bo'lsa hech narsa qilmaymiz — aks holda
    // butun savatni bo'shatib qo'yardik.
    if (!live.size || !S.cart.length) return { removed: [], changed: [] };

    const removed = [];
    const changed = [];
    const kept = [];

    S.cart.forEach((item) => {
      const p = live.get(String(item.id));
      if (!p) {
        removed.push(item.name || "Tovar");
        return;
      }
      const stock = Number(p.stock) || 0;
      if (stock <= 0) {
        removed.push(p.name || item.name);
        return;
      }
      const price = Number(p.price) || 0;
      const next = {
        id: p.id,
        name: p.name || item.name,
        price: price,
        qty: item.qty,
        stock: stock,
        photo_url: p.photo_url || null,
      };
      if (next.qty > stock) {
        next.qty = stock;
        changed.push(next.name);
      } else if (Number(item.price) !== price) {
        changed.push(next.name);
      }
      kept.push(next);
    });

    if (removed.length || changed.length) {
      S.cart = kept;
      saveCart();
    }
    return { removed: removed, changed: changed };
  }

  /** Savat ochilganda: moslashtirib, o'zgarish bo'lsa mijozga aytamiz. */
  function refreshCart() {
    const out = syncCartWithCatalog();
    renderCart();
    if (out.removed.length) {
      toast("⚠️ Sotuvdan chiqqan tovar savatdan olindi: " + out.removed.join(", "), 5000);
    } else if (out.changed.length) {
      toast("ℹ️ Narx/qoldiq yangilandi: " + out.changed.join(", "), 4000);
    }
  }

  /* -------------------------------------------------------------- kabinet */
  /* ==================================================================
     BUYURTMALARIM — UCH BO'LIM, UCH ALOHIDA OYNA

     NEGA SHUNDAY
     Ilgari uchala ro'yxat (Bi-LED, navbat, mahsulot) kabinet sahifasida
     ketma-ket chizilardi. Ikki-uch buyurtmadan keyin sahifa cho'zilib
     ketardi, pastdagi menyu («Aloqa», «Kafolat») ekrandan chiqib qolardi
     va mijoz kerakli buyurtmani izlab uzoq skroll qilardi. Filtr,
     qidiruv, holat izohi — hech biri yo'q edi.

     Endi admin panelidagi mantiq (`admin-shop.js` → `KINDS`) mijozga
     moslandi: kabinetda uch plitka, har biri ALOHIDA to'liq ekranli
     oynani ochadi. Oynada xulosa, qidiruv, filtr chiplari va holat
     zanjiri (timeline) bor.

     HOLAT NOMLARI ADMIN PANELI BILAN BIR XIL bo'lishi SHART — aks holda
     admin qo'ygan holat mijozda «Yangi» bo'lib ko'rinadi. Shuning uchun
     har bo'limning zanjiri va taxalluslari (`alias`) shu yerda, bitta
     joyda yozilgan:

        order   : new → accepted → delivering → delivered   (+ cancelled)
        biled   : new → accepted → in_work    → done        (+ cancelled)
        booking : new → confirmed → done                    (+ cancelled)

     `tone` — CSS bo'yog'i. Mavjud `.ord-pill.is-*` klasslari qayta
     ishlatiladi, ya'ni yangi rang yozish kerak emas.
     ================================================================== */

  const MY_KINDS = {
    order: {
      icon: "📦",
      title: "Mahsulot buyurtmalari",
      sub: "Do'kondan olgan tovarlaringiz",
      track: ["new", "accepted", "delivering", "delivered"],
      run: ["accepted", "delivering"],
      alias: { done: "delivered", shipped: "delivering", paid: "accepted" },
      st: {
        new: { label: "Yangi", short: "Yangi", icon: "🆕", tone: "new" },
        accepted: { label: "Qabul qilindi", short: "Qabul", icon: "✅", tone: "accepted" },
        delivering: { label: "Yo'lda", short: "Yo'lda", icon: "🚚", tone: "delivering" },
        delivered: { label: "Yetkazildi", short: "Yetkazildi", icon: "🎉", tone: "delivered" },
        cancelled: { label: "Bekor qilingan", short: "Bekor", icon: "✕", tone: "cancelled" },
      },
      hint: {
        new: "Buyurtma qabul qilindi. Admin tez orada tasdiqlaydi.",
        accepted: "Tasdiqlandi — tovar yetkazishga tayyorlanmoqda.",
        delivering: "Kuryer yo'lda. Telefonni yoningizda tuting.",
        delivered: "Yetkazildi. Xaridingiz uchun rahmat!",
        cancelled: "Bu buyurtma bekor qilingan.",
      },
      empty: {
        icon: "📦",
        title: "Buyurtma yo'q",
        desc: "Do'kondan tovar tanlab, birinchi buyurtmangizni bering.",
        btnText: "🛍 Do'konga o'tish",
      },
    },

    biled: {
      icon: "🔥",
      title: "Bi-LED buyurtmalarim",
      sub: "Linza o'rnatish buyurtmalari",
      track: ["new", "accepted", "in_work", "done"],
      run: ["accepted", "in_work"],
      alias: { delivered: "done", delivering: "in_work", in_progress: "in_work" },
      st: {
        new: { label: "Yangi", short: "Yangi", icon: "🆕", tone: "new" },
        accepted: { label: "Qabul qilindi", short: "Qabul", icon: "✅", tone: "accepted" },
        in_work: { label: "Ish jarayonida", short: "Ishda", icon: "🔧", tone: "delivering" },
        done: { label: "Topshirildi", short: "Topshirildi", icon: "✨", tone: "delivered" },
        cancelled: { label: "Bekor qilingan", short: "Bekor", icon: "✕", tone: "cancelled" },
      },
      hint: {
        new: "So'rovingiz qabul qilindi. Usta narxni aniqlab, bog'lanadi.",
        accepted: "Tasdiqlandi — o'rnatish kuni belgilanadi.",
        in_work: "Mashinangiz ustaxonada, ish ketmoqda.",
        done: "Ish topshirildi. Kafolat 1 yil!",
        cancelled: "Bu buyurtma bekor qilingan.",
      },
      empty: {
        icon: "🔥",
        title: "Bi-LED buyurtma yo'q",
        desc: "Konfiguratorda mashinangizga linza tanlab, narxini bilib olasiz.",
        btnText: "🔧 Konfiguratorni ochish",
      },
    },

    booking: {
      icon: "🗓",
      title: "Navbatlarim",
      sub: "Ustaga band qilgan vaqtlaringiz",
      track: ["new", "confirmed", "done"],
      run: ["confirmed"],
      alias: { accepted: "confirmed", delivered: "done", delivering: "confirmed" },
      st: {
        new: { label: "Kutilmoqda", short: "Kutilmoqda", icon: "⏳", tone: "new" },
        confirmed: { label: "Tasdiqlangan", short: "Tasdiq", icon: "✅", tone: "accepted" },
        done: { label: "Bajarilgan", short: "Bajarildi", icon: "✔️", tone: "delivered" },
        cancelled: { label: "Bekor qilingan", short: "Bekor", icon: "✕", tone: "cancelled" },
      },
      hint: {
        new: "Navbat so'rovi yuborildi. Usta vaqtni tasdiqlaydi.",
        confirmed: "Vaqt siz uchun band qilindi. Kechikmang!",
        done: "Navbat o'tdi. Xizmatimizdan foydalanganingiz uchun rahmat!",
        cancelled: "Bu navbat bekor qilingan.",
      },
      empty: {
        icon: "🗓",
        title: "Navbat yo'q",
        desc: "Ustaga bo'sh vaqtni tanlab, 3 qadamda navbat olasiz.",
        btnText: "🗓 Navbat olish",
      },
    },
  };

  /** Har bo'lim uchun holat nomini YAGONA ko'rinishga keltiradi.
   *  Notanish qiymat kelsa — «new» (yo'qotib qo'ymaslik uchun). */
  function myNorm(kind, value) {
    const cfg = MY_KINDS[kind] || MY_KINDS.order;
    let s = String(value == null ? "new" : value)
      .toLowerCase()
      .trim();
    if (cfg.alias[s]) s = cfg.alias[s];
    return cfg.st[s] ? s : "new";
  }

  const myStatus = (kind, value) => (MY_KINDS[kind] || MY_KINDS.order).st[myNorm(kind, value)];

  /** Holat «pill» belgisi — mavjud `.ord-pill.is-*` ranglarida.
   *
   *  DIQQAT: serverning `status_label` maydoni ATAYLAB ishlatilmaydi. U
   *  «🚚 Yetkazildi» ko'rinishida emoji bilan keladi va bizning belgimiz
   *  bilan qo'shilib IKKI emoji chiqarardi; bundan tashqari server eski
   *  nomlarni (`done`, `shipped`) xom qaytarishi mumkin. Matn ham, belgi
   *  ham YUQORIDAGI yagona lug'atdan olinadi. */
  function myPill(kind, value) {
    const st = myStatus(kind, value);
    return `<span class="ord-pill is-${st.tone}">${st.icon} ${esc(st.label)}</span>`;
  }

  /* Eski nomlar — kod bo'ylab boshqa joylarda ishlatilishi mumkin.
     Mahsulot buyurtmasi lug'atiga yo'naltiriladi. */
  const normStatus = (v) => myNorm("order", v);
  const statusPill = (v) => myPill("order", v);

  /* ------------------------------------------------------- kabinet: yig'ish */

  /** Butun son "count-up" animatsiyasi (statistika plitkalari).
   *  `format` berilsa — har kadrda shu funksiya orqali chiziladi
   *  (masalan pul summasi bo'sh joy bilan ajratilib ko'rsatiladi). */
  function animateNum(id, end, format) {
    const obj = $(id);
    if (!obj) return;
    end = Number(end) || 0;
    const draw = format || String;
    let startTime = null;
    const duration = 800;
    function step(ts) {
      if (!startTime) startTime = ts;
      const p = Math.min((ts - startTime) / duration, 1);
      // easeOutCubic — oxirida sekinlashadi, ko'zga yoqimli
      const e = 1 - Math.pow(1 - p, 3);
      obj.textContent = draw(Math.floor(e * end));
      if (p < 1) requestAnimationFrame(step);
      else obj.textContent = draw(end);
    }
    requestAnimationFrame(step);
  }

  /* Eski nom — «saqlanganlar» sanog'i bir necha joydan shu nom bilan
     chaqiriladi. Ikki xil count-up bo'lmasin: bittasi ikkinchisiga
     yo'naltiriladi. */
  const animateStat = (id, end) => animateNum(id, end);

  async function loadProfile() {
    if (S.me) {
      const name = (S.me.full_name || S.me.first_name || "Mijoz").trim();
      $("pf-name").textContent = name;
      $("pf-avatar").textContent = (name[0] || "M").toUpperCase();
      // `user_id` — Render `/api/me` dagi nom, `id` — Worker `/me` dagi nom.
      // Faqat birinchisiga tayanilgani uchun zaxira rejimda «ID: —» chiqardi.
      $("pf-id").textContent = "ID: " + (S.me.user_id || S.me.id || "—");
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
    animateNum("pf-stat-saved", S.favorites ? S.favorites.size : 0);
    renderAddrHint();

    // Ilgari bu yerda «Server uyg'onmoqda» izohi bor edi va to'liq rejimga
    // qaytilganda ham kabinetda qolib ketardi. Endi har ochilishda yopiladi.
    setOfflineNote(false);

    // Keshdan DARHOL chizamiz (bo'sh bo'lsa «Yuklanmoqda…»), keyin
    // yangilaymiz — plitkalar bo'sh bo'lib turmaydi.
    renderProfileHub();
    await refreshMyOrders({ silent: true });
  }

  /** Uchala ro'yxatni BIR martada yig'adi va `S.my` da keshlaydi.
   *
   *  Ilgari har bir chizish uchun uchta so'rov yuborilardi va bittasi
   *  yiqilsa (`Promise.all`) UCHALASI ham bo'sh qolardi — mijoz «hammasi
   *  yo'qolgan» deb o'ylardi. Endi har manba alohida himoyalangan:
   *  bittasi ishlamasa, qolganlari ko'rinadi. Xato esa HAMMASI bo'sh
   *  qolgandagina aytiladi. */
  async function refreshMyOrders(opts) {
    const o = opts || {};
    if (S.myLoading) return;
    S.myLoading = true;
    let firstErr = null;

    const grab = async (path) => {
      try {
        const r = await api(path);
        return Array.isArray(r) ? r : [];
      } catch (err) {
        firstErr = firstErr || err;
        return [];
      }
    };

    try {
      if (S.offline) {
        /* Zaxira rejim: do'kon buyurtmalari Firebase'dagi `pending_orders`
           dan o'qiladi (ilova yopilib qayta ochilsa ham yo'qolmaydi).
           Bi-LED va navbat tarixi FAQAT serverda turadi — ular bo'sh
           qoladi va oynada buning sababi yoziladi. */
        const mine = await myPendingOrders();
        S.my = {
          order: mine.length ? mine : offlineOrdersForView(),
          biled: [],
          booking: [],
        };
      } else {
        const [biled, bookings, orders, pending] = await Promise.all([
          grab("/api/biled-orders"),
          grab("/api/bookings"),
          grab("/api/orders"),
          myPendingOrders(),
        ]);
        S.my = {
          order: mergeOrders(orders, pending),
          biled: byNewest(biled),
          booking: byNewest(bookings),
        };
      }
      S.myAt = Date.now();
    } catch (err) {
      firstErr = firstErr || err;
    } finally {
      S.myLoading = false;
    }

    const total =
      (S.my.order || []).length + (S.my.biled || []).length + (S.my.booking || []).length;
    if (firstErr && !total && !o.silent) onError(firstErr);

    renderProfileHub();
    if (S.page === "orders") renderMyOrdersPage();
  }

  const byNewest = (list) => (list || []).slice().sort((a, b) => orderTime(b) - orderTime(a));

  /** Firebase `pending_orders` dan MENING buyurtmalarim (Worker qabul
   *  qilganlari). O'qish yiqilsa — jimgina bo'sh ro'yxat. */
  async function myPendingOrders() {
    try {
      const uid = S.me && (S.me.user_id || S.me.id);
      if (!uid || !window.ZimmerOffline || !ZimmerOffline.myOrders) return [];
      return await ZimmerOffline.myOrders(uid);
    } catch (_) {
      return [];
    }
  }

  /** SQLite va Worker buyurtmalarini birlashtiradi (takrorsiz, yangisi tepada).
   *
   *  Takrorlanish shundan bo'ladi: bot Worker buyurtmasini SQLite'ga
   *  ko'chirganda `pending_orders` yozuvida `sqlite_id` paydo bo'ladi va
   *  o'sha buyurtma ikkala manbada turadi. Shu belgiga qarab ajratamiz. */
  function mergeOrders(dbOrders, pendingOrders) {
    const out = (dbOrders || []).slice();
    const known = new Set(out.map((o) => String(o.id)));
    (pendingOrders || []).forEach((p) => {
      if (p.sqlite_id && known.has(String(p.sqlite_id))) return;
      out.push(p);
    });
    // Yangisi tepada: SQLite `created_at` — matn, Worker `createdAt` — ms.
    out.sort((a, b) => orderTime(b) - orderTime(a));
    return out;
  }

  function orderTime(o) {
    if (!o) return 0;
    if (o.createdAt) return Number(o.createdAt) || 0;
    const t = Date.parse(String(o.created_at || "").replace(" ", "T"));
    return Number.isFinite(t) ? t : 0;
  }

  /** Worker'dan kelgan buyurtmalarni umumiy shaklga keltiradi.
      Worker'da raqamli `id` yo'q (SQLite bermaydi) — o'rniga `ZM-XXXXXX`
      kod ishlatiladi va bot buyurtmani bazaga ko'chirganda raqam beriladi. */
  function offlineOrdersForView() {
    // Holat yozuvi yagona lug'atdan olinadi — bu yerda `status_label`
    // yasamaymiz (ilgari bu yerda uchinchi xil lug'at bor edi).
    return (S.offlineOrders || []).map((o) => ({
      id: o.code || "—",
      code: o.code || "",
      total: o.total || 0,
      total_label: o.total_label || fmt(o.total),
      status: o.status || "new",
      items: (o.items || []).map((i) => ({ name: i.name, qty: i.qty })),
      delivery_info: o.delivery_info || "",
      payment_method: o.payment_method || "",
    }));
  }

  /* ------------------------------------------------- kabinet: hub plitkalari */

  /** «Qachon» — inson tilida: bugun / kecha / N kun oldin / 12-mar.
   *  Navbat uchun esa buyurtma vaqti emas, TAYINLANGAN vaqt muhim. */
  function moWhen(kind, o) {
    if (kind === "booking" && o.date_label) {
      return o.date_label + (o.time ? " · " + o.time : "");
    }
    const t = orderTime(o);
    if (!t) return o.date_label || "";
    const d = new Date(t);
    const now = new Date();
    const startOf = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
    const days = Math.round((startOf(now) - startOf(d)) / 86400000);
    const hhmm =
      String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
    if (days === 0) return "bugun " + hhmm;
    if (days === 1) return "kecha " + hhmm;
    if (days > 1 && days < 7) return days + " kun oldin";
    const MON = [
      "yan",
      "fev",
      "mar",
      "apr",
      "may",
      "iyn",
      "iyl",
      "avg",
      "sen",
      "okt",
      "noy",
      "dek",
    ];
    return (
      d.getDate() +
      "-" +
      MON[d.getMonth()] +
      (d.getFullYear() !== now.getFullYear() ? " " + d.getFullYear() : "")
    );
  }

  /** Buyurtma summasi (son). Server ba'zan faqat `total_label` beradi
   *  («1 200 000 so'm») — undan raqamlarni ajratib olamiz. */
  function moMoney(o) {
    const n = Number(o && o.total);
    if (Number.isFinite(n) && n > 0) return n;
    const digits = String((o && o.total_label) || "").replace(/[^\d]/g, "");
    return digits ? Number(digits) : 0;
  }

  /** Kabinetdagi uch plitka: soni, oxirgi holat va yangilar belgisi. */
  function renderProfileHub() {
    ["order", "biled", "booking"].forEach((kind) => {
      const cfg = MY_KINDS[kind];
      const list = S.my[kind] || [];
      const cntEl = $("mo-cnt-" + kind);
      const sumEl = $("mo-sum-" + kind);
      const badge = $("mo-new-" + kind);
      if (!cntEl || !sumEl || !badge) return;

      cntEl.textContent = String(list.length);

      // «Yangi» — hali admin ko'rib chiqmagan yozuvlar. Qizil belgi
      // mijozga «bu hali kutilmoqda» degan tushunarli signal beradi.
      const fresh = list.filter((o) => myNorm(kind, o.status) === "new").length;
      badge.textContent = String(fresh);
      badge.classList.toggle("hidden", fresh === 0);

      if (!list.length) {
        sumEl.textContent = S.myLoading
          ? "Yuklanmoqda…"
          : S.offline && kind !== "order"
            ? "Server uyg'onganda ko'rinadi"
            : "Hozircha bo'sh";
        return;
      }
      const last = list[0];
      const st = myStatus(kind, last.status);
      sumEl.innerHTML =
        `<span class="mo-dot is-${st.tone}"></span> ${esc(st.label)}` +
        (moWhen(kind, last) ? ` · ${esc(moWhen(kind, last))}` : "");
    });

    // Statistika: buyurtma (do'kon + bi-led) va navbat
    animateNum("pf-stat-orders", (S.my.order || []).length + (S.my.biled || []).length);
    animateNum("pf-stat-bookings", (S.my.booking || []).length);
  }

  /** Bo'limni ALOHIDA oynada ochadi. Ro'yxat keshdan darhol chiziladi,
   *  kesh eskirgan bo'lsa fonda jimgina yangilanadi. */
  function openMyOrders(kind) {
    if (!MY_KINDS[kind]) kind = "order";
    haptic("light");
    S.moKind = kind;
    S.moFilter = "all";
    S.moQ = "";
    S.moOpen = null;
    show("orders");
    if (!S.myAt || Date.now() - S.myAt > 30000) refreshMyOrders({ silent: true });
  }

  /* ------------------------------------------------- buyurtmalar oynasi */

  /** Filtr shartlari — HOLAT NOMI bo'yicha (admin panelidagi mantiq).
   *  «Yakunlangan» — zanjirning oxirgi bosqichi. */
  function moFilters(kind) {
    const cfg = MY_KINDS[kind];
    const last = cfg.track[cfg.track.length - 1];
    return {
      all: () => true,
      new: (s) => s === "new",
      run: (s) => cfg.run.indexOf(s) !== -1,
      done: (s) => s === last,
      cancelled: (s) => s === "cancelled",
    };
  }

  const MO_CHIPS = [
    // «Barchasi» — do'kon filtrlari bilan bir xil so'z ishlatiladi
    ["all", "Barchasi"],
    ["new", "🆕 Yangi"],
    ["run", "⏳ Jarayonda"],
    ["done", "✅ Yakunlangan"],
    ["cancelled", "✕ Bekor"],
  ];

  /** Qidiruv: kod, raqam, tovar nomi, mashina, xizmat va manzil bo'yicha. */
  function moMatch(kind, o, q) {
    if (!q) return true;
    const hay = [
      o.code,
      o.id != null ? "#" + o.id : "",
      o.car_name,
      o.service_name,
      o.address,
      o.delivery_info,
      o.summary,
      o.payment_method,
      (o.items || []).map((i) => i.name).join(" "),
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return hay.indexOf(q) !== -1;
  }

  /** Kartochka kaliti (akkordeon holatini eslab qolish uchun). */
  const moKey = (kind, o, i) => kind + "|" + (o.code || (o.id != null ? o.id : "i" + i));

  function renderMyOrdersPage() {
    const kind = MY_KINDS[S.moKind] ? S.moKind : "order";
    S.moKind = kind;
    const cfg = MY_KINDS[kind];
    const list = S.my[kind] || [];

    $("mo-title").textContent = cfg.icon + " " + cfg.title;
    $("mo-sub").textContent = list.length ? list.length + " ta yozuv" : cfg.sub;

    // Qidiruv maydonini holatga moslaymiz (fokusni buzmasdan)
    const q = $("mo-q");
    if (q && q.value !== S.moQ) q.value = S.moQ;
    $("mo-q-clear").classList.toggle("hidden", !S.moQ);
    // Qidiruv va filtr bo'sh ro'yxatda ma'nosiz — yashiramiz
    const hasAny = list.length > 0;
    $("mo-search").classList.toggle("hidden", !hasAny);
    $("mo-stats").classList.toggle("hidden", !hasAny);

    renderMoStats(kind, list);
    renderMoFilters(kind, list);
    renderMoList(kind, list);
  }

  /** Tepadagi xulosa — mavjud `.ord-summary`/`.ord-stat` uslubida. */
  function renderMoStats(kind, list) {
    const box = $("mo-stats");
    if (!box) return;
    if (!list.length) {
      box.innerHTML = "";
      return;
    }
    const f = moFilters(kind);
    const st = (o) => myNorm(kind, o.status);
    const running = list.filter((o) => f.run(st(o))).length;
    const doneN = list.filter((o) => f.done(st(o))).length;
    const spent = list.reduce((s, o) => (st(o) === "cancelled" ? s : s + moMoney(o)), 0);

    // Navbatda pul yo'q — uning o'rniga «bajarilgan» ko'rsatiladi
    const third =
      kind === "booking"
        ? { id: "mo-st-3", val: doneN, label: "Bajarilgan", cls: "" }
        : { id: "mo-st-3", val: spent, label: "Sarflangan", cls: "is-money", money: true };

    box.innerHTML =
      `<div class="ord-summary">
         <div class="ord-stat"><b id="mo-st-1">0</b><span>Jami</span></div>
         <div class="ord-stat is-run"><b id="mo-st-2">0</b><span>Jarayonda</span></div>
         <div class="ord-stat ${third.cls}"><b id="${third.id}">0</b><span>${esc(third.label)}</span></div>
       </div>`;

    animateNum("mo-st-1", list.length);
    animateNum("mo-st-2", running);
    animateNum(
      third.id,
      third.val,
      third.money ? (v) => (Number(v) || 0).toLocaleString("ru-RU").replace(/,/g, " ") : null
    );
  }

  /** Filtr chiplari — sanoq bilan. Bo'sh filtr chizilmaydi (mijoz bosib
   *  bo'sh ekran ko'rmasin), «Barchasi» esa har doim turadi. */
  function renderMoFilters(kind, list) {
    const box = $("mo-filters");
    if (!box) return;
    const f = moFilters(kind);
    const stats = list.map((o) => myNorm(kind, o.status));

    const counts = {};
    MO_CHIPS.forEach(([key]) => {
      counts[key] = stats.filter((s) => f[key](s)).length;
    });
    // Tanlangan filtr bo'shab qolgan bo'lsa — hammasiga qaytamiz
    if (S.moFilter !== "all" && !counts[S.moFilter]) S.moFilter = "all";

    const shown = MO_CHIPS.filter(([key]) => key === "all" || counts[key] > 0);
    // Faqat «Barchasi» qolsa filtrning ma'nosi yo'q
    box.classList.toggle("hidden", shown.length < 2 || !list.length);
    box.innerHTML = shown
      .map(
        ([key, label]) =>
          `<button class="ord-fchip${S.moFilter === key ? " selected" : ""}" data-mof="${key}">` +
          `${esc(label)}<i>${counts[key]}</i></button>`
      )
      .join("");
  }

  /** Holat zanjiri (timeline). Chiziq chapdan o'ngga chizilib boradi,
   *  o'tilgan bosqichlarda ✓, joriy bosqichda belgisi «nafas oladi».
   *  Bekor qilingan buyurtmada zanjirning ma'nosi yo'q — ko'rsatilmaydi. */
  function moTrack(kind, status) {
    const cfg = MY_KINDS[kind];
    const key = myNorm(kind, status);
    if (key === "cancelled") return "";
    const steps = cfg.track;
    const at = steps.indexOf(key);
    if (at < 0) return "";
    const pct = steps.length > 1 ? (at / (steps.length - 1)) * 100 : 100;

    const cells = steps
      .map((s, i) => {
        const meta = cfg.st[s];
        const cls = i < at ? "is-done" : i === at ? "is-now" : "";
        const mark = i < at ? "✓" : i === at ? meta.icon : "";
        return (
          `<span class="mo-tr-step ${cls}" style="--d:${i * 90}ms">` +
          `<b>${mark}</b><small>${esc(meta.short)}</small></span>`
        );
      })
      .join("");

    return (
      `<div class="mo-track">` +
      `<div class="mo-tr-line"><i style="width:${pct}%"></i></div>` +
      `<div class="mo-tr-steps">${cells}</div></div>`
    );
  }

  /** Buyurtmadagi xarita havolasi. Ilgari `mapLink` alohida maydon
   *  bo'lib yuborilmagan — u `delivery_info` matni ichida ketadi,
   *  shuning uchun ikkalasini ham tekshiramiz. */
  function moMapLink(o) {
    if (o.mapLink) return o.mapLink;
    if (o.map_link) return o.map_link;
    const m = String(o.delivery_info || o.address || "").match(/https?:\/\/[^\s]+/);
    return m ? m[0] : "";
  }

  /** Manzil matni — xarita havolasi olib tashlangan holda (u alohida
   *  tugma bo'lib chiqadi, uzun URL kartochkani buzmasin). */
  const moClean = (s) =>
    String(s || "")
      .replace(/https?:\/\/[^\s]+/g, "")
      .replace(/🗺/g, "")
      .replace(/\s*\n\s*/g, " · ")
      .replace(/\s{2,}/g, " ")
      .replace(/^[\s·]+|[\s·]+$/g, "");

  function renderMoList(kind, list) {
    const box = $("mo-list");
    if (!box) return;
    const cfg = MY_KINDS[kind];

    // Yuklanmoqda va kesh bo'sh — skelet (bo'sh ekran «yo'q» degan
    // yolg'on taassurot bermasin)
    if (!list.length && S.myLoading) {
      box.innerHTML = Array.from({ length: 3 })
        .map((_, i) => `<div class="mo-skel" style="--d:${i * 110}ms"></div>`)
        .join("");
      return;
    }

    // Zaxira rejimda Bi-LED va navbat tarixi FAQAT serverda turadi —
    // buni aytmasak, mijoz «buyurtmalarim yo'qolgan» deb o'ylaydi.
    if (!list.length && S.offline && kind !== "order") {
      box.innerHTML = emptyStatePro({
        icon: "🌙",
        title: "Hozir ko'rsatib bo'lmaydi",
        desc: "Bu bo'lim tarixi serverda saqlanadi. Server uyg'onganda ro'yxat o'zi paydo bo'ladi.",
      });
      return;
    }

    if (!list.length) {
      box.innerHTML = emptyStatePro(cfg.empty);
      const btn = box.querySelector(".es-btn");
      if (btn) btn.onclick = () => moEmptyGo(kind);
      return;
    }

    const f = moFilters(kind);
    const q = S.moQ.trim().toLowerCase();
    const rows = list.filter(
      (o) => f[S.moFilter](myNorm(kind, o.status)) && moMatch(kind, o, q)
    );

    if (!rows.length) {
      box.innerHTML = emptyStatePro({
        icon: q ? "🔍" : "🗂",
        title: q ? "Topilmadi" : "Bu filtrda yozuv yo'q",
        desc: q
          ? `«${q}» bo'yicha hech narsa chiqmadi. Kodni yoki tovar nomini tekshirib ko'ring.`
          : "Boshqa filtrni tanlang.",
      });
      return;
    }

    box.innerHTML = rows
      .map((o, i) => moCard(kind, o, list.indexOf(o), Math.min(i, 8)))
      .join("");
    // Ochiq kartochka qayta chizishdan keyin ham ochiq qolishi kerak —
    // balandlik CSS dan emas, shu yerdan beriladi.
    moApplyOpen(false);
  }

  function moEmptyGo(kind) {
    haptic("light");
    if (kind === "order") {
      show("home");
      loadHome({ force: isHomeStale() });
      return;
    }
    if (kind === "biled") return openFlow();
    // Navbat bo'sh — mijozni XIZMATLAR ro'yxatiga olib boramiz. Ilgari
    // `openBookingSheet()` chaqirilardi, u endi yo'q: navbat har doim
    // aniq bir xizmat kartochkasidan boshlanadi.
    return show("services");
  }

  /** Bitta kartochka. Tepa qismi har doim ko'rinadi, tafsilot esa bosilganda
   *  ochiladi (akkordeon) — ro'yxat qisqa va tez skroll bo'ladi. */
  function moCard(kind, o, idx, stagger) {
    const cfg = MY_KINDS[kind];
    const key = myNorm(kind, o.status);
    const st = cfg.st[key];
    const ck = moKey(kind, o, idx);
    const open = S.moOpen === ck;
    const code = o.code || (o.id != null ? "#" + o.id : "—");
    const when = moWhen(kind, o);
    const money = moMoney(o);
    const mapLink = moMapLink(o);

    /* --- kindga xos asosiy satr --- */
    let head = "";
    if (kind === "order") {
      const n = (o.items || []).reduce((s, i) => s + (Number(i.qty) || 1), 0);
      const names = (o.items || [])
        .map((i) => i.name)
        .filter(Boolean)
        .join(", ");
      head = `<div class="mo-lead">${esc(names || "Tovarlar")}</div>
              <div class="mo-sub2">${n} dona${when ? " · " + esc(when) : ""}</div>`;
    } else if (kind === "biled") {
      head = `<div class="mo-lead">🚗 ${esc(o.car_name || "Mashina")}</div>
              <div class="mo-sub2">${esc(moClean(o.summary) || "Bi-LED o'rnatish")}</div>`;
    } else {
      head = `<div class="mo-lead">🔧 ${esc(o.service_name || "Xizmat")}</div>
              <div class="mo-sub2">📅 ${esc(o.date_label || "-")}${o.time ? " · 🕐 " + esc(o.time) : ""}</div>`;
    }

    /* --- tafsilot (akkordeon ichida) --- */
    const goods = (o.items || [])
      .map((i) => {
        const qty = Number(i.qty) || 1;
        const price = Number(i.price) || 0;
        return (
          `<div class="ord-good"><span>${esc(i.name || "Tovar")}</span>` +
          `<i>×${qty}</i>${price ? `<b>${esc(fmt(price * qty))}</b>` : ""}</div>`
        );
      })
      .join("");

    const meta = [];
    const addr = moClean(o.address);
    const dinfo = moClean(o.delivery_info);
    /* Manzil IKKI joyda bo'lishi mumkin: alohida `address` maydonida va
       `delivery_info` matnining ichida («Kuryer (manzilga): Uy · 📍 …»).
       Ikkalasini ham chizsak, mijoz bir xil manzilni ketma-ket ikki marta
       o'qiydi. Shuning uchun takrorlanish tekshiriladi. */
    if (addr && !(dinfo && dinfo.indexOf(addr) !== -1)) {
      meta.push(`<div class="ord-meta-row">📍 ${esc(addr)}</div>`);
    }
    if (dinfo && dinfo !== addr) meta.push(`<div class="ord-meta-row">🚚 ${esc(dinfo)}</div>`);
    if (o.payment_method) meta.push(`<div class="ord-meta-row">💳 ${esc(o.payment_method)}</div>`);
    if (kind === "biled" && o.summary)
      meta.push(`<div class="ord-meta-row">🔧 ${esc(moClean(o.summary))}</div>`);
    if (o.created_at || o.createdAt)
      meta.push(`<div class="ord-meta-row">🕒 Berilgan: ${esc(moWhen("order", o))}</div>`);

    /* --- amal tugmalari --- */
    const acts = [];
    if (kind === "order" && (o.items || []).length && key !== "cancelled")
      acts.push(`<button class="ord-act is-go" data-moact="reorder" data-mokey="${esc(ck)}">🔁 Qayta buyurtma</button>`);
    if (mapLink)
      acts.push(`<button class="ord-act" data-moact="map" data-mokey="${esc(ck)}">🗺 Xaritada</button>`);
    acts.push(`<button class="ord-act" data-moact="copy" data-mokey="${esc(ck)}">📋 Kod</button>`);
    if (kind === "booking" && o.can_cancel)
      acts.push(`<button class="ord-act is-danger" data-moact="cancel" data-mokey="${esc(ck)}">✕ Bekor qilish</button>`);
    acts.push(`<button class="ord-act" data-moact="help" data-mokey="${esc(ck)}">💬 Yordam</button>`);

    return (
      `<div class="ord mo-card is-${st.tone}${open ? " is-open" : ""}" data-key="${esc(ck)}" style="--d:${stagger * 60}ms">
         <div class="ord-top">
           <span class="ord-code">${esc(code)}</span>
           ${myPill(kind, o.status)}
         </div>
         <div class="mo-body">
           <div class="mo-head">${head}</div>
           <span class="mo-exp">›</span>
         </div>
         ${moTrack(kind, o.status)}
         ${money ? `<div class="ord-foot"><span>Jami</span><b>${esc(o.total_label || fmt(money))}</b></div>` : ""}
         <div class="mo-more"><div class="mo-more-in">
           <div class="mo-hint is-${st.tone}">${st.icon} ${esc(cfg.hint[key] || "")}</div>
           ${goods ? `<div class="ord-goods">${goods}</div>` : ""}
           ${meta.length ? `<div class="ord-meta">${meta.join("")}</div>` : ""}
           <div class="ord-acts mo-acts">${acts.join("")}</div>
         </div></div>
       </div>`
    );
  }

  /** Akkordeon: bitta kartochka ochiladi, qolganlari yopiladi.
   *  Ro'yxat QAYTA CHIZILMAYDI — faqat klass va balandlik almashadi,
   *  shuning uchun ochilish silliq va skroll joyida qoladi. */
  function moToggle(ck) {
    S.moOpen = S.moOpen === ck ? null : ck;
    haptic("light");
    moApplyOpen(true);
  }

  /** Ochilgan kartochkaning tafsilot balandligini o'rnatadi.
   *
   *  Balandlik ATAYLAB JS dan beriladi: tafsilot balandligi tovarlar
   *  soniga qarab har xil, CSS da esa `max-height` uchun aniq son kerak.
   *  `scrollHeight` — kontentning haqiqiy balandligi (element yopiq
   *  turganda ham to'g'ri o'lchanadi).
   *
   *  `animate=false` — ro'yxat qayta chizilgandan keyin: ochiq kartochka
   *  darhol ochiq holatda paydo bo'ladi, «sakrash» bo'lmaydi. */
  function moApplyOpen(animate) {
    const box = $("mo-list");
    if (!box) return;
    box.querySelectorAll(".mo-card").forEach((c) => {
      const open = !!S.moOpen && c.dataset.key === S.moOpen;
      const more = c.querySelector(".mo-more");
      c.classList.toggle("is-open", open);
      if (!more) return;
      clearTimeout(more._moT);

      if (!open) {
        /* `none` dan to'g'ridan `0` ga o'tish animatsiya bermaydi —
           brauzer `none` ni interpolatsiya qila olmaydi. Shuning uchun
           avval aniq balandlik qo'yiladi, keyin nolga tushiriladi. */
        if (more.style.maxHeight === "none") {
          more.style.transition = "none";
          more.style.maxHeight = more.scrollHeight + "px";
          void more.offsetHeight;
          more.style.transition = "";
        }
        if (!animate) {
          more.style.transition = "none";
          more.style.maxHeight = "0px";
          void more.offsetHeight;
          requestAnimationFrame(() => {
            more.style.transition = "";
          });
        } else {
          more.style.maxHeight = "0px";
        }
        return;
      }

      /* OCHISH. Animatsiya uchun aniq balandlik kerak, LEKIN u yakuniy
         holat bo'lib QOLMASLIGI kerak: o'lchov xato bo'lsa yoki kontent
         keyin qayta oqsa (uzun manzil boshqacha o'ralsa, ekran burilsa,
         shrift kechikib yuklansa) tafsilot QIRQILIB qolardi.
         Shuning uchun o'tish tugagach cheklov butunlay olib tashlanadi. */
      const h = more.scrollHeight;
      if (!animate) {
        more.style.transition = "none";
        more.style.maxHeight = "none";
        void more.offsetHeight;
        requestAnimationFrame(() => {
          more.style.transition = "";
        });
        return;
      }
      more.style.maxHeight = (h || 1600) + "px";
      more._moT = setTimeout(() => {
        // Shu orada yopilgan bo'lsa — tegmaymiz.
        if (c.classList.contains("is-open")) more.style.maxHeight = "none";
      }, 400);
    });
  }

  /** Kalit bo'yicha yozuvni topadi (amal tugmalari uchun). */
  function moFind(ck) {
    const kind = S.moKind;
    const list = S.my[kind] || [];
    for (let i = 0; i < list.length; i++) {
      if (moKey(kind, list[i], i) === ck) return list[i];
    }
    return null;
  }

  async function moAction(act, ck) {
    const kind = S.moKind;
    const o = moFind(ck);
    if (!o) return toast("Yozuv topilmadi — ro'yxatni yangilang");

    if (act === "copy") {
      const code = o.code || (o.id != null ? "#" + o.id : "");
      if (!code) return toast("Bu yozuvda kod yo'q");
      return copyText(code, "📋 Kod nusxalandi: " + code);
    }
    if (act === "map") {
      const url = moMapLink(o);
      if (!url) return toast("Xarita havolasi yo'q");
      haptic("light");
      return openExternal(url);
    }
    if (act === "help") {
      const code = o.code || (o.id != null ? "#" + o.id : "");
      return openContactSheet(code ? `Buyurtma: ${code}` : "");
    }
    if (act === "reorder") return reorderFromOrder(o);
    if (act === "cancel") return cancelBooking(o);
  }

  /** Navbatni bekor qilish (server tasdiqlaydi). */
  async function cancelBooking(b) {
    if (!b || b.id == null) return toast("Navbat raqami topilmadi");
    if (!(await ask(`#${b.id} navbatni bekor qilasizmi?`))) return;
    try {
      await api(`/api/bookings/${b.id}/cancel`, { method: "POST" });
      haptic("ok");
      toast("Navbat bekor qilindi");
      await refreshMyOrders({ silent: true });
    } catch (err) {
      onError(err);
    }
  }

  /** «Qayta buyurtma» — eski buyurtmadagi tovarlarni savatga qaytaradi.
   *
   *  Ehtiyotkorlik: tovar o'chirilgan, narxi o'zgargan yoki omborda
   *  qoldiq kamaygan bo'lishi mumkin. Shuning uchun tovar KATALOGDAN
   *  qayta topiladi (eski narx ishlatilmaydi) va qoldiqqa sig'gani
   *  qo'shiladi. Nima bo'lganini mijoz bir qatorda ko'radi. */
  async function reorderFromOrder(o) {
    const items = o.items || [];
    if (!items.length) return toast("Bu buyurtmada tovar ko'rsatilmagan");

    if (!S.shopProducts || !S.shopProducts.length || isHomeStale()) {
      toast("Katalog yuklanmoqda…");
      try {
        // Narx va qoldiq YANGI bo'lishi kerak — qayta buyurtmada
        // eskirgan narx bilan savat to'ldirilmasin.
        await loadHome({ force: true });
      } catch (_) {}
    }
    const all = S.shopProducts || [];
    if (!all.length) {
      haptic("err");
      return toast("Katalog hozir yuklanmadi. Keyinroq urinib ko'ring.");
    }

    let added = 0;
    let missing = 0;
    let limited = 0;

    items.forEach((it) => {
      const pid = it.product_id != null ? it.product_id : it.id;
      const nm = String(it.name || "")
        .trim()
        .toLowerCase();
      const p =
        (pid != null && all.find((x) => String(x.id) === String(pid))) ||
        (nm && all.find((x) => String(x.name || "").trim().toLowerCase() === nm));
      if (!p) {
        missing++;
        return;
      }
      const want = Math.max(1, Number(it.qty) || 1);
      const found = S.cart.find((c) => c.id === p.id);
      const have = found ? found.qty : 0;
      const room = Math.max(0, (Number(p.stock) || 0) - have);
      if (room <= 0) {
        limited++;
        return;
      }
      const take = Math.min(want, room);
      if (take < want) limited++;
      if (found) found.qty = have + take;
      else
        S.cart.push({
          id: p.id,
          name: p.name,
          price: p.price,
          qty: take,
          stock: p.stock,
          photo_url: p.photo_url || null,
        });
      added += take;
    });

    if (!added) {
      haptic("err");
      return toast(
        missing ? "Bu tovarlar endi katalogda yo'q" : "Omborda qoldiq tugagan",
        3600
      );
    }

    saveCart();
    haptic("ok");
    const notes = [];
    if (missing) notes.push(missing + " ta topilmadi");
    if (limited) notes.push("qoldiq cheklandi");
    toast(
      `🧺 ${added} dona savatga qo'shildi` + (notes.length ? " (" + notes.join(", ") + ")" : ""),
      3600
    );
  }

  /** Ro'yxatni qo'lda yangilash (↻ tugmasi va pastga tortish). */
  async function moRefresh() {
    const btn = $("mo-refresh");
    if (btn) btn.classList.add("is-spin");
    await refreshMyOrders({ silent: false });
    if (btn) btn.classList.remove("is-spin");
    toast("↻ Yangilandi", 1500);
  }

  /* ------------------------------------------------------- kichik yordamchi */

  /** Matnni almashish buferiga nusxalash.
   *  Telegram WebView'da `navigator.clipboard` HAR DOIM ishlamaydi
   *  (ruxsat yoki eski versiya) — shuning uchun zaxira yo'l ham bor. */
  function copyText(text, okMsg) {
    const done = () => {
      haptic("ok");
      toast(okMsg || "📋 Nusxalandi");
    };
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done, () => legacyCopy(text, done));
        return;
      }
    } catch (_) {}
    legacyCopy(text, done);
  }

  function legacyCopy(text, done) {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.top = "-1000px";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      ta.setSelectionRange(0, String(text).length);
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      if (ok) return done();
    } catch (_) {}
    /* Ikki yo'l ham ishlamadi (ba'zi WebView'larda almashish buferi
       umuman berilmaydi). Oxirgi chora — matnni EKRANDA ko'rsatamiz:
       mijoz uni qo'lda ko'chirib yozadi. Jim qolish eng yomon variant
       bo'lardi: tugma bosildi, lekin hech narsa bo'lmadi. */
    toast("Nusxalanmadi, qo'lda yozib oling: " + String(text), 6000);
  }

  /** Tashqi havolani ochish (xarita). Telegram'da `openLink` ishlatiladi. */
  function openExternal(url) {
    try {
      if (tg && tg.openLink) return tg.openLink(url);
    } catch (_) {}
    try {
      window.open(url, "_blank");
    } catch (_) {
      location.href = url;
    }
  }

  /* ==================================================================
     MANZILLARIM

     Saqlash joyi rasmiylashtirish oynasi bilan YAGONA:
     `localStorage["zimmer_addresses"]`. Yozuv shakli (barcha qo'shimcha
     maydonlar majburiy emas — eski yozuvlar ham ishlaydi):

        { type, label, address, mapLink, lat, lng, note, def, at }

     `def` — «asosiy» manzil. Buyurtma berayotganda o'zi tanlanadi, ya'ni
     mijoz har safar ro'yxatni bosib o'tirmaydi.
     ================================================================== */

  const ADDR_ICONS = { home: "🏠", work: "💼", shop: "🏪", map: "📍" };
  const addrIcon = (a) => ADDR_ICONS[(a && a.type) || "map"] || "📍";

  /** Kabinet menyusidagi «Manzillarim» yonidagi soni. */
  function renderAddrHint() {
    const h = $("pf-addr-hint");
    if (!h) return;
    const n = getAddresses().length;
    h.textContent = n ? String(n) : "";
  }

  function renderAddressPage() {
    const box = $("ad-list");
    if (!box) return;
    const arr = getAddresses();
    $("ad-sub").textContent = arr.length
      ? arr.length + " ta manzil saqlangan"
      : "Hali manzil yo'q";
    $("ad-tip").classList.toggle("hidden", arr.length < 2);

    if (!arr.length) {
      box.innerHTML = emptyStatePro({
        icon: "🗺",
        title: "Manzil yo'q",
        desc: "Uy yoki ish manzilingizni bir marta belgilab qo'ysangiz, keyingi buyurtmalar bir necha bosishda tayyor bo'ladi.",
      });
      return;
    }

    box.innerHTML = arr
      .map(
        (a, i) =>
          `<div class="ad-item${a.def ? " is-def" : ""}" style="--d:${Math.min(i, 8) * 60}ms">
             <div class="ad-row">
               <span class="ad-ic">${addrIcon(a)}</span>
               <div class="ad-tx">
                 <div class="ad-name">${esc(a.label || "Manzil")}${
                   a.def ? '<span class="ad-def">⭐ Asosiy</span>' : ""
                 }</div>
                 <div class="ad-addr">${esc(a.address || "")}</div>
                 ${a.note ? `<div class="ad-note">🚪 ${esc(a.note)}</div>` : ""}
               </div>
             </div>
             <div class="ad-acts">
               ${
                 a.def
                   ? '<span class="ad-act is-on">⭐ Asosiy</span>'
                   : `<button class="ad-act" data-adact="def" data-adi="${i}">⭐ Asosiy qilish</button>`
               }
               <!-- Bu tugmalarda FAQAT emoji bor, ya'ni skrinreader ularni
                    "tugma" deb o'qib, nima qilishini AYTMASDI. Shu sababli
                    aria-label va title qo'shildi. -->
               <button class="ad-act" data-adact="edit" data-adi="${i}"
                 aria-label="Manzilni tahrirlash" title="Tahrirlash">✏️</button>
               ${
                 a.mapLink
                   ? `<button class="ad-act" data-adact="map" data-adi="${i}"
                        aria-label="Xaritada ko'rish" title="Xaritada ko'rish">🗺</button>`
                   : ""
               }
               <button class="ad-act" data-adact="copy" data-adi="${i}"
                 aria-label="Manzilni nusxalash" title="Nusxalash">📋</button>
               <button class="ad-act is-danger" data-adact="del" data-adi="${i}"
                 aria-label="Manzilni o'chirish" title="O'chirish">🗑</button>
             </div>
           </div>`
      )
      .join("");
  }

  async function addrAction(act, i) {
    const arr = getAddresses();
    const a = arr[i];
    if (!a) {
      renderAddressPage();
      return toast("Manzil topilmadi");
    }

    if (act === "def") {
      arr.forEach((x, k) => {
        if (x) x.def = k === i;
      });
      saveAddresses(arr);
      haptic("ok");
      toast("⭐ Asosiy manzil: " + (a.label || "manzil"));
      // Rasmiylashtirish oynasidagi tanlov eskirmasin
      S._dlvSelectedAddr = null;
      renderAddressPage();
      return;
    }

    if (act === "map") {
      if (!a.mapLink) return toast("Bu manzil xaritadan belgilanmagan");
      haptic("light");
      return openExternal(a.mapLink);
    }

    if (act === "copy") {
      const text = [a.label, a.address, a.note].filter(Boolean).join(" — ");
      return copyText(text, "📋 Manzil nusxalandi");
    }

    if (act === "edit") return openAddrEdit(i);

    if (act === "del") {
      if (!(await ask(`"${a.label || a.address}" manzilini o'chirasizmi?`))) return;
      const wasDef = !!a.def;
      arr.splice(i, 1);
      // Asosiy manzil o'chirilsa — birinchisi asosiy bo'ladi, aks holda
      // «asosiy» tushunchasi yo'qolib, checkout hech narsa tanlamaydi.
      if (wasDef && arr.length) arr[0].def = true;
      saveAddresses(arr);
      // Indekslar siljidi — checkout tanlovini tozalaymiz (aks holda
      // boshqa manzilga buyurtma ketishi mumkin edi).
      S._dlvSelectedAddr = null;
      haptic("success");
      // «Qaytarish» — manzil qo'lda yozilgan, tasodifan o'chirilsa
      // qaytadan kiritish (va xaritada belgilash) uzoq ish.
      toast("Manzil o'chirildi", {
        undo: () => {
          const now = getAddresses();
          now.splice(Math.min(i, now.length), 0, a);
          if (wasDef) now.forEach((x, k) => (x.def = k === Math.min(i, now.length - 1)));
          saveAddresses(now);
          S._dlvSelectedAddr = null;
          renderAddressPage();
          renderAddrHint();
        },
      });
      renderAddressPage();
      renderAddrHint();
      return;
    }
  }

  /** Nom, tur va izohni tahrirlash (koordinata o'zgarmaydi). */
  function openAddrEdit(i) {
    const arr = getAddresses();
    const a = arr[i];
    if (!a) return;
    haptic("light");
    openSheet(
      "✏️ Manzilni tahrirlash",
      `<label class="field"><span>🏷 Nom</span>
         <input type="text" id="ae-name" maxlength="40" value="${esc(a.label || "")}"
           placeholder="Uy, Ish, Onamniki…"></label>
       <div class="addr-name-chips" id="ae-chips">
         <button class="addr-chip${a.type === "home" ? " sel" : ""}" data-label="Uy" data-type="home">🏠 Uy</button>
         <button class="addr-chip${a.type === "work" ? " sel" : ""}" data-label="Ish" data-type="work">💼 Ish</button>
         <button class="addr-chip${a.type === "shop" ? " sel" : ""}" data-label="Do'kon" data-type="shop">🏪 Do'kon</button>
         <button class="addr-chip${!a.type || a.type === "map" ? " sel" : ""}" data-label="Boshqa" data-type="map">📍 Boshqa</button>
       </div>
       <label class="field"><span>🚪 Uy / xonadon / mo'ljal</span>
         <input type="text" id="ae-note" maxlength="80" value="${esc(a.note || "")}"
           placeholder="12-uy, 3-podyezd, 45-xonadon"></label>
       <div class="ae-addr">📍 ${esc(a.address || "")}</div>
       <button class="btn btn-primary" id="ae-save">Saqlash</button>`
    );

    let type = a.type || "map";
    const chips = document.querySelectorAll("#ae-chips .addr-chip");
    chips.forEach((chip) => {
      chip.onclick = () => {
        chips.forEach((c) => c.classList.remove("sel"));
        chip.classList.add("sel");
        type = chip.dataset.type;
        // Nom bo'sh bo'lsa chipning nomi qo'yiladi — bir bosishda tayyor
        const nameIn = $("ae-name");
        if (nameIn && !nameIn.value.trim()) nameIn.value = chip.dataset.label;
        haptic("selection");
      };
    });

    $("ae-save").onclick = () => {
      const name = ($("ae-name").value || "").trim();
      if (!name) {
        toast("Manzilga nom kiriting");
        $("ae-name").focus();
        return;
      }
      const list = getAddresses();
      if (!list[i]) {
        closeSheet();
        renderAddressPage();
        return toast("Manzil topilmadi");
      }
      list[i].label = name;
      list[i].type = type;
      list[i].note = ($("ae-note").value || "").trim();
      saveAddresses(list);
      haptic("ok");
      toast("✅ Saqlandi");
      closeSheet();
      renderAddressPage();
    };
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

  /** Aloqa paneli. `about` berilsa (masalan «Buyurtma: ZM-123456») —
   *  mijoz adminga nima haqida yozayotganini darhol ko'radi va kodni
   *  bir bosishda nusxalaydi. Buyurtma kartochkasidagi «💬 Yordam»
   *  tugmasi shu yo'l bilan ishlaydi. */
  function openContactSheet(about) {
    haptic();
    const admin = shopTelegram();
    const phone = shopPhone();

    openSheet(
      "📞 Biz bilan aloqa",
      `${
        about
          ? `<div class="mo-about">${esc(about)}
               <button class="mo-about-copy" id="contact-copy">📋 Nusxalash</button></div>`
          : ""
      }
       <p class="step-sub">Savol yoki takliflar bo'lsa bemalol yozing — tez javob beramiz.</p>
       ${
         /* TELEFON — birinchi o'rinda va bir bosishda qo'ng'iroq qiladi.
            `tel:` havolasi telefonning qo'ng'iroq oynasini raqam bilan
            ochadi. Raqamni nusxalash ham qoldirildi: mijoz boshqa
            qurilmadan qo'ng'iroq qilishni xohlashi mumkin. */
         phone
           ? `<div class="ct-phone">
                <div class="ct-phone-tx">
                  <small>Telefon</small>
                  <b>${esc(phone)}</b>
                </div>
                <div class="ct-phone-acts">
                  <button class="ct-call" id="contact-call" type="button"
                          aria-label="Qo'ng'iroq qilish">📞 Qo'ng'iroq</button>
                  <button class="ct-copy" id="contact-phone-copy" type="button"
                          aria-label="Raqamni nusxalash">📋</button>
                </div>
              </div>`
           : ""
       }
       ${
         admin
           ? `<button class="btn btn-primary ct-tg" id="contact-tg">
                ✈️ Telegram: @${esc(admin)}
              </button>`
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
        haptic();
        openTelegram(admin);
      };

    const call = $("contact-call");
    if (call)
      call.onclick = () => {
        haptic();
        callPhone(phone);
      };

    const phoneCopy = $("contact-phone-copy");
    if (phoneCopy) phoneCopy.onclick = () => copyText(phone, "📋 Raqam nusxalandi");
    const cp = $("contact-copy");
    if (cp) {
      // Faqat kodni nusxalaymiz («Buyurtma: » qismi keraksiz)
      const code = String(about || "").replace(/^[^:]*:\s*/, "");
      cp.onclick = () => copyText(code || String(about || ""), "📋 Nusxalandi: " + code);
    }
  }

  function openTrustSheet() {
    haptic();
    openSheet(
      "🛡 Kafolat va yetkazib berish",
      /* DIQQAT: «7 kun ichida qaytarish» bandi ATAYLAB OLIB TASHLANGAN.
         Bunday shart amalda berilmaydi — yozib qo'yilsa mijoz talab
         qilishga haqli bo'ladi va bu nizoga olib keladi. */
      `<div class="trust-list">
         <div class="trust-item"><i>🛡</i><div><b>Kafolat</b>
           <small>Bi-LED o'rnatishga 1 yil. Do'kon tovarlarida kafolat
             muddati har tovarning kartochkasida ko'rsatilgan.</small></div></div>
         <div class="trust-item"><i>🚚</i><div><b>Yetkazib berish</b>
           <small>Kuryer — ${esc(dcity())} shahar ichida. Boshqa hududlarga
             BTS Pochta orqali (butun O'zbekiston).</small></div></div>
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
    // Panel ochiq bo'lsa Telegram'ning orqaga tugmasi ko'rinishi kerak —
    // aks holda uni yopishning yagona yo'li X tugmasi bo'lib qolardi.
    syncBackButton();
  }
  function closeSheet() {
    stopVideos();
    $("sheet").classList.add("hidden");
    $("sheet-content").innerHTML = "";
    syncBackButton();
  }

  /** Pastdan chiqadigan panel ochiqmi (`goBack()` shundan foydalanadi). */
  function sheetOpen() {
    const sheet = $("sheet");
    return !!sheet && !sheet.classList.contains("hidden");
  }

  function openCarSheet() {
    openSheet("Mashinani tanlang", '<div class="cars" id="sheet-cars"></div>');
    renderCars($("sheet-cars"));
  }

  /* ==================================================================
     XIZMATLAR — ro'yxat, dizayn temalari va alohida navbat

     NEGA ALOHIDA BO'LIM
     Ilgari pastdagi navigatsiyada «Konfigurator» turardi (faqat Bi-LED
     linza tanlash), navbat esa bosh menyudagi bitta kartochka edi. Qolgan
     xizmatlar — polirovka, chexol tikish, shisha almashtirish, fara ichini
     tozalash — ilovada UMUMAN ko'rinmasdi, mijoz ular borligini bilmasdi.

     Endi «🛠 Xizmatlar» bo'limida hammasi bor. Har xizmatning O'Z narxi,
     kafolati, davomiyligi va alohida navbat oqimi bor.

     DIZAYN: har xizmat boshqacha ko'rinadi (`SERVICE_THEMES` → `layout`).
     Sabab oddiy: yetti xil ishni bir xil kulrang qatorda ko'rsatsak, mijoz
     ularni farqlamaydi va o'qimaydi ham.
     ================================================================== */

  /** Dizayn temalari. `layout` — kartochkaning TUZILISHI (bir-birini
   *  takrorlamaydi), `accent` — rang kaliti (CSS `.sv-a-*`). */
  const SERVICE_THEMES = {
    config: {
      icon: "💡",
      layout: "hero",
      accent: "gold",
      short: "Narxni hisoblash",
      blockTitle: "Nimalarni tanlaysiz",
      tagline: "Linza, ochki va rangni tanlab narxni o'zingiz hisoblang",
      facts: [
        ["🔩", "Linza", "5 xil model"],
        ["🎭", "Ochki", "Devil Eye"],
        ["🌈", "Rang", "Optika tusi"],
      ],
    },
    biled: {
      icon: "🔧",
      layout: "tech",
      accent: "red",
      short: "2 faraga linza",
      blockTitle: "Ish tartibi",
      tagline: "Ikki faraga professional Bi-LED linza o'rnatish",
      steps: ["Farani ochamiz", "Linzani o'rnatamiz", "Germetiklaymiz"],
    },
    polish: {
      icon: "✨",
      layout: "shine",
      accent: "cyan",
      short: "Shaffoflikni qaytarish",
      blockTitle: "Natija",
      tagline: "Xiralashgan farani asl shaffofligiga qaytaramiz",
      before: "Xira, sarg'aygan",
      after: "Shaffof, yorqin",
    },
    glass: {
      icon: "🪟",
      layout: "split",
      accent: "blue",
      short: "Yangi original shisha",
      blockTitle: "Nima almashtiriladi",
      tagline: "Yorilgan yoki singan fara shishasini yangisiga almashtirish",
      pair: ["Yorilgan shisha", "Yangi original shisha"],
    },
    clean: {
      icon: "🧼",
      layout: "bubble",
      accent: "teal",
      short: "Chang, bug', namlik",
      blockTitle: "Bosqichlar",
      tagline: "Fara ichidagi chang, bug' va namlikni to'liq tozalash",
      bullets: ["Farani ochib tozalash", "Namlikni quritish", "Qayta germetiklash"],
    },
    wheel: {
      icon: "🕹",
      layout: "stitch",
      accent: "amber",
      short: "O'lchov bo'yicha, qo'lda",
      blockTitle: "Ip va material",
      tagline: "Rul g'ilofini o'lchov bo'yicha qo'lda tikamiz",
      threads: ["#d4a853", "#c1121f", "#2b2f38", "#e9e2d0"],
    },
    seat: {
      icon: "🪑",
      layout: "fabric",
      accent: "violet",
      short: "To'liq komplekt",
      blockTitle: "Materiallar",
      tagline: "O'rindiqlarga to'liq chexol — o'lchov bo'yicha o'rnatiladi",
      materials: ["Ekoteri", "Alkantara", "Mato", "Kombinatsiya"],
    },
    /* ---- yangi yo'nalishlar (hozircha «Tez kunda») ----
       Ular ro'yxatda KO'RINADI: mijoz do'kon nima rejalashtirayotganini
       bilishi kerak. Narx va navbat `coming_soon` bo'lsa yopiladi. */
    laminate: {
      icon: "🪞",
      layout: "list",
      accent: "lime",
      short: "Salon panellari",
      blockTitle: "Nimalar qoplanadi",
      tagline: "Salon panellariga laminat qoplama — yangi ko'rinish",
      bullets: ["Torpedo va panellar", "Eshik ichi", "Konsol va tugmalar"],
    },
    tint: {
      icon: "🌓",
      layout: "list",
      accent: "slate",
      short: "Oyna plyonkasi",
      blockTitle: "Nima beradi",
      tagline: "Oynalarga plyonka — issiq, quyosh va ko'zdan himoya",
      bullets: ["Issiqni kamaytiradi", "Salonni ko'zdan yashiradi", "Shishani ushlab turadi"],
    },
    armor: {
      icon: "🛡",
      layout: "list",
      accent: "pink",
      short: "Kuzov himoyasi",
      blockTitle: "Nima beradi",
      tagline: "Kuzovni chizilish va toshdan saqlovchi shaffof plyonka",
      bullets: ["Chizilishdan saqlaydi", "Bo'yoqni asrab turadi", "Shaffof — rang o'zgarmaydi"],
    },
  };

  /* Notanish xizmat kelsa temalar NAVBAT bilan beriladi — ikki yangi
     xizmat qo'shilsa ham ular bir xil ko'rinmaydi. */
  const THEME_CYCLE = ["tech", "shine", "split", "bubble", "stitch", "fabric"];

  /** Xizmat nomidan tema kalitini aniqlaydi.
   *
   *  Birinchi navbatda serverdagi `theme` ustuni ishlatiladi (admin uni
   *  o'zi qo'yadi). U bo'lmasa nom bo'yicha taxmin qilinadi — shu sababli
   *  eski bazadagi xizmatlar ham to'g'ri dizayn oladi. Tekshiruv tartibi
   *  MUHIM: «Bi-LED o'rnatish» ham «o'rnat», ham «bi-led» so'zini o'z
   *  ichiga oladi, «Fara shishasini almashtirish» esa «shisha» ni. */
  function themeOf(s, index) {
    const key = String((s && s.theme) || "").toLowerCase().trim();
    if (SERVICE_THEMES[key]) return key;

    const n = String((s && s.name) || "").toLowerCase();
    if (n.indexOf("konfigurator") !== -1) return "config";
    /* Yangi yo'nalishlar «rul» dan OLDIN tekshiriladi: tartib muhim.
       `database/db.py: _THEME_GUESS` bilan bir xil bo'lishi kerak —
       ikki tomon boshqa tema bersa kartochka dizayni ikki xil ko'rinadi. */
    if (n.indexOf("laminat") !== -1) return "laminate";
    if (n.indexOf("tanirov") !== -1 || n.indexOf("tonirov") !== -1) return "tint";
    if (
      n.indexOf("broni") !== -1 ||
      n.indexOf("bronli") !== -1 ||
      n.indexOf("plyonka") !== -1 ||
      n.indexOf("plonka") !== -1
    ) {
      return "armor";
    }
    if (n.indexOf("rul") !== -1) return "wheel";
    if (n.indexOf("rindiq") !== -1 || n.indexOf("orindiq") !== -1) return "seat";
    if (n.indexOf("shisha") !== -1) return "glass";
    if (n.indexOf("polirov") !== -1 || n.indexOf("polish") !== -1) return "polish";
    if (n.indexOf("tozala") !== -1 || n.indexOf("germet") !== -1) return "clean";
    if (n.indexOf("bi-led") !== -1 || n.indexOf("biled") !== -1 || n.indexOf("bi led") !== -1) {
      return "biled";
    }
    return THEME_CYCLE[(Number(index) || 0) % THEME_CYCLE.length];
  }

  /** ICHKI ZAXIRA RO'YXAT.
   *
   *  Faqat server (va bulut) BO'SH ro'yxat qaytarganda ishlatiladi —
   *  masalan backend hali yangilanmagan bo'lsa. Bo'lmasa bo'lim butunlay
   *  bo'sh turib, mijoz «xizmat yo'q» deb o'ylardi.
   *
   *  Narx va kafolat — BOSHLANG'ICH qiymatlar; admin panelda o'zgartirilsa
   *  serverdan kelgan ro'yxat ustun turadi va bu yerga qaralmaydi. */
  const SERVICES_FALLBACK = [
    { id: null, theme: "config", name: "Bi-LED konfigurator", duration_min: 0, price: 0,
      warranty: "1 yil", description: "Mashinangizga mos linzani tanlab, narxni o'zingiz ko'ring." },
    { id: null, theme: "biled", name: "Bi-LED o'rnatish (2 fara)", duration_min: 120, price: 400000,
      warranty: "1 yil", description: "Linzani o'rnatish, sozlash va germetiklash." },
    { id: null, theme: "polish", name: "Fara polirovkasi", duration_min: 60, price: 150000,
      warranty: "3 oy", description: "Sarg'aygan qatlamni olib, himoya lak qo'yamiz." },
    { id: null, theme: "glass", name: "Fara shishasini almashtirish", duration_min: 90, price: 250000,
      warranty: "6 oy", description: "Yorilgan shisha o'rniga yangisi qo'yiladi." },
    { id: null, theme: "clean", name: "Fara ichini tozalash", duration_min: 45, price: 120000,
      warranty: "3 oy", description: "Chang, bug' va namlik to'liq tozalanadi." },
    { id: null, theme: "wheel", name: "Rul chexol o'rnatish", duration_min: 90, price: 200000,
      warranty: "6 oy", description: "Rul g'ilofi o'lchov bo'yicha tanlanadi va o'rnatiladi." },
    { id: null, theme: "seat", name: "O'rindiq chexol o'rnatish", duration_min: 240, price: 700000,
      warranty: "1 yil", description: "Barcha o'rindiqlarga to'liq chexol o'rnatiladi." },
    /* ---- «Tez kunda» yo'nalishlar ----
       Narx ATAYLAB `null`: `0` bo'lsa mijoz «bepul» deb o'qib qolishi
       mumkin edi. `coming_soon` esa navbat tugmasini yopadi. */
    { id: null, theme: "laminate", name: "Laminat salon", duration_min: 0, price: null,
      price_label: null, coming_soon: true, warranty: null,
      description: "Salon panellariga laminat qoplama. Tez kunda ishga tushadi." },
    { id: null, theme: "tint", name: "Tanirovka", duration_min: 0, price: null,
      price_label: null, coming_soon: true, warranty: null,
      description: "Oynalarga plyonka yopishtirish. Tez kunda ishga tushadi." },
    { id: null, theme: "armor", name: "Broni plyonka", duration_min: 0, price: null,
      price_label: null, coming_soon: true, warranty: null,
      description: "Kuzovni chizilishdan saqlovchi himoya plyonka. Tez kunda ishga tushadi." },
  ].map(function (s) {
    s._fallback = true;
    return s;
  });

  /** Davomiylikni inson tilida: 45 daqiqa → «45 daqiqa», 120 → «2 soat». */
  function svcDuration(min) {
    const m = Number(min) || 0;
    if (m <= 0) return "";
    if (m < 60) return m + " daqiqa";
    const h = Math.floor(m / 60);
    const rest = m % 60;
    return h + " soat" + (rest ? " " + rest + " daq" : "");
  }

  /** «Tez kunda» xizmatmi? Server `coming_soon` yuboradi.
   *
   *  Backend eski bo'lib maydon kelmasa ham xato bo'lmasin: narx ham,
   *  yorliq ham bo'lmasa (`null`) xizmat hali sozlanmagan hisoblanadi. */
  const svcSoon = (s) =>
    !!(s && (s.coming_soon || (s.price == null && s.price_label == null)));

  const SOON_TEXT = "Tez kunda";

  /** Narx matni. «Tez kunda» bo'lsa raqam O'RNIGA shu yozuv chiqadi —
   *  ilgari bunday holatda `fmt(0)` ishlab «0 so'm» ko'rinardi. */
  const svcPrice = (s) => {
    if (svcSoon(s)) return SOON_TEXT;
    if (s && s.price_label) return s.price_label;
    return fmt((s && s.price) || 0);
  };

  /** Xizmatlar ro'yxati (keshlanadi). */
  /* ================================================================
     XIZMATLARNING KANONIK TARTIBI

     Uchta GURUH, har doim shu ketma-ketlikda:

         0. Bi-LED konfigurator   — HAR DOIM birinchi
         1. Oddiy xizmatlar       — `sort` bo'yicha
         2. «Tez kunda»           — HAR DOIM oxirgi

     NEGA FRONTENDDA HAM. Server allaqachon shu tartibda yuboradi
     (`queries.py: SERVICES_ORDER`), lekin ro'yxat UCH manbadan
     kelishi mumkin:

         • `/api/services`      — server tartiblab beradi
         • `ZimmerOffline`      — bulut (Render uxlagan), oddiy `sort`
         • `SERVICES_FALLBACK`  — ichki zaxira ro'yxat

     Oxirgi ikkitasida server YO'Q. Shu sababli tartib shu yerda ham
     qo'llanadi — natijada mijoz qaysi manbadan o'qilganiga qaramay
     BIR XIL ketma-ketlikni ko'radi.

     DIQQAT: `queries.py: service_group()` bilan aynan bir xil bo'lishi
     kerak. Ikki til, ikki amalga oshirish — shuning uchun ular test
     bilan bog'langan (`verify_order.py`).
     ================================================================ */

  /** Xizmatning guruh raqami (0 / 1 / 2). */
  function svcGroup(s) {
    if (svcSoon(s)) return 2;
    /* Tema kalitiga qaraymiz, NOMGA emas — admin xizmat nomini
       o'zgartirsa ham konfigurator tepada qolishi kerak. `themeOf()`
       nomdan ham taxmin qiladi, ya'ni `theme` ustuni bo'sh eski
       yozuvlar ham to'g'ri joyga tushadi. */
    return themeOf(s, 0) === "config" ? 0 : 1;
  }

  /** Ro'yxatni kanonik tartibda qaytaradi (kirish massivi o'zgarmaydi). */
  function sortServices(list) {
    if (!Array.isArray(list)) return [];
    /* `map` bilan indeksni saqlab olamiz: `sort` ham, `id` ham teng
       bo'lsa dastlabki ketma-ketlik saqlanadi. `Array.sort` barqaror
       bo'lsa ham, taqqoslash aniq bo'lishi tushunarliroq. */
    return list
      .map((s, i) => ({ s: s, i: i }))
      .sort(function (a, b) {
        return (
          svcGroup(a.s) - svcGroup(b.s) ||
          (Number(a.s && a.s.sort) || 0) - (Number(b.s && b.s.sort) || 0) ||
          (Number(a.s && a.s.id) || 0) - (Number(b.s && b.s.id) || 0) ||
          a.i - b.i
        );
      })
      .map((x) => x.s);
  }

  async function loadServices(force) {
    if (S.services && !force) return S.services;
    let list = null;
    try {
      list = S.offline ? await ZimmerOffline.services() : await api("/api/services");
    } catch (_) {
      /* Server javob bermadi — bulutdan urinamiz. `services` tuguni
         katalog bilan birga ko'chiriladi, ya'ni Render uxlasa ham bor. */
      try {
        if (window.ZimmerOffline && ZimmerOffline.services) list = await ZimmerOffline.services();
      } catch (_) {}
    }
    if (!Array.isArray(list)) list = [];
    S.servicesFallback = list.length === 0;
    S.services = sortServices(list.length ? list : SERVICES_FALLBACK.slice());
    return S.services;
  }

  /* ------------------------------------------------- xizmatlar: PLITKALAR */

  /** Xizmatlar bo'limi — TUGMA-PLITKALAR (admin panelidagi kabi).
   *
   *  Ilgari bu yerda har xizmat to'liq kartochka bo'lib chizilardi: bir
   *  ekranga bittasi ham sig'masdi va ro'yxatni ko'rish uchun uzoq skroll
   *  qilish kerak bo'lardi. Endi plitkalar ikki ustunda — hammasi bir
   *  ko'rinishda, tafsilot esa ALOHIDA oynada (`#service`). */
  function renderServicesPage(force) {
    const box = $("sv-list");
    if (!box) return;

    if (!S.services || force) {
      box.innerHTML =
        '<div class="svt-skel"></div><div class="svt-skel"></div>' +
        '<div class="svt-skel"></div><div class="svt-skel"></div>';
      $("sv-sub").textContent = "Yuklanmoqda…";
      loadServices(force).then(
        () => renderServicesPage(false),
        () => renderServicesPage(false)
      );
      return;
    }

    const list = S.services || [];
    $("sv-sub").textContent = list.length + " ta xizmat";
    box.innerHTML = list.map((s, i) => svcTile(s, i)).join("");

    /* Xizmat hali sozlanmagan bo'lsa (server bo'sh ro'yxat berdi) —
       buni yashirmaymiz. Narxlar boshlang'ich ekanini aytamiz. */
    if (S.servicesFallback) {
      box.insertAdjacentHTML(
        "afterend",
        '<p class="sv-note">ℹ️ Narxlar boshlang\'ich ko\'rsatilgan. Aniq narx va ' +
          "muddat usta bilan tasdiqlanadi.</p>"
      );
    }
  }

  /** Bitta plitka. Temaning rangi PLITKADA ham saqlanadi — ro'yxat bir xil
   *  kulrang kvadratlar bo'lib qolmasin. */
  function svcTile(s, i) {
    const key = themeOf(s, i);
    const t = SERVICE_THEMES[key] || SERVICE_THEMES.biled;
    const isConfig = key === "config";
    const soon = svcSoon(s);
    const price = isConfig ? "Hisoblash" : svcPrice(s);

    return (
      '<button class="svt sv-a-' + t.accent + (isConfig ? " is-hero" : "") +
      (soon ? " is-soon" : "") +
      '" data-svc="' + i + '" style="--d:' + Math.min(i, 8) * 55 + 'ms">' +
      '<span class="svt-glow"></span>' +
      /* Plitkaning burchagidagi yorliq — ro'yxatdan turib ham tayyor
         emasligi ko'rinsin, ichiga kirish shart bo'lmasin. */
      (soon ? '<span class="svt-badge">' + esc(SOON_TEXT) + "</span>" : "") +
      '<span class="svt-ic">' + t.icon + "</span>" +
      '<span class="svt-tx">' +
      "<b>" + esc(s.name || "Xizmat") + "</b>" +
      "<i>" + esc(t.short || t.tagline || "") + "</i>" +
      "</span>" +
      '<span class="svt-foot">' +
      '<span class="svt-price' + (soon ? " is-soon" : "") + '">' + esc(price) + "</span>" +
      '<span class="svt-go">›</span>' +
      "</span>" +
      "</button>"
    );
  }

  /* --------------------------------------------- xizmatlar: ALOHIDA OYNA */

  /** Plitka bosilganda: xizmatni eslab qolib alohida oynani ochadi. */
  function openService(index) {
    const list = S.services || [];
    const s = list[Number(index)];
    if (!s) return toast("Xizmat topilmadi — ro'yxatni yangilang");
    haptic("light");
    S.svcIndex = Number(index);
    show("service");
  }

  /** Oynani YOPISH — chiqish animatsiyasi bilan.
   *
   *  `show()` ni darhol chaqirsak oyna bir zumda yo'qoladi va harakat
   *  sezilmaydi. Shu sababli avval `.is-out` klassi qo'yiladi (CSS
   *  pastga sirg'alib so'nadi), keyin sahifa almashadi. */
  function closeService() {
    const page = $("service");
    if (!page || page.classList.contains("hidden")) return show("services");
    page.classList.add("is-out");
    clearTimeout(closeService._t);
    closeService._t = setTimeout(() => {
      page.classList.remove("is-out");
      show("services");
    }, 200);
  }

  function renderServicePage() {
    const box = $("sd-body");
    if (!box) return;
    const s = (S.services || [])[S.svcIndex];
    if (!s) {
      box.innerHTML = "";
      return show("services");
    }

    const key = themeOf(s, S.svcIndex);
    const t = SERVICE_THEMES[key] || SERVICE_THEMES.biled;
    const isConfig = key === "config";
    const soon = svcSoon(s);
    const dur = svcDuration(s.duration_min);
    const war = s.warranty || "";
    const desc = s.description || t.tagline || "";

    $("sd-title").textContent = t.icon + " " + (s.name || "Xizmat");
    $("sd-sub").textContent = soon
      ? SOON_TEXT
      : isConfig
        ? "Narxni o'zingiz hisoblang"
        : "Narx va navbat";

    /* --- narx / kafolat / vaqt plitkalari ---
       «Tez kunda» bo'lsa narx O'RNIGA shu yozuv turadi; kafolat va
       davomiylik hali aniq bo'lmagani uchun umuman ko'rsatilmaydi. */
    const facts = [];
    facts.push(
      '<div class="sd-fact is-price' + (soon ? " is-soon" : "") + '"><i>' +
        (soon ? "🕒" : "💰") + "</i><b>" +
        esc(soon ? SOON_TEXT : isConfig ? "Tanlovga qarab" : svcPrice(s)) +
        "</b><small>Narx</small></div>"
    );
    if (!soon && war) {
      facts.push('<div class="sd-fact is-war"><i>🛡</i><b>' + esc(war) + "</b><small>Kafolat</small></div>");
    }
    if (!soon && dur) {
      facts.push('<div class="sd-fact"><i>⏱</i><b>' + esc(dur) + "</b><small>Davomiyligi</small></div>");
    }

    box.innerHTML =
      /* --- sarlavha bloki: katta ikonka + tavsif --- */
      '<div class="sd-hero sv-a-' + t.accent + " sd-l-" + t.layout +
      (soon ? " is-soon" : "") + '">' +
      '<div class="sd-hero-glow"></div>' +
      (soon ? '<div class="sd-soon-tag">' + esc(SOON_TEXT) + "</div>" : "") +
      '<div class="sd-ic">' + t.icon + "</div>" +
      "<h2>" + esc(s.name || "Xizmat") + "</h2>" +
      "<p>" + esc(desc) + "</p>" +
      "</div>" +
      /* --- xulosa plitkalari --- */
      '<div class="sd-facts">' + facts.join("") + "</div>" +
      /* --- VIDEO (faqat uchta fara xizmatida, server ruxsat bersa) --- */
      svcVideoBlock(s, t) +
      /* --- temaga xos blok (dizaynlarni aynan shu joy ajratadi) --- */
      '<div class="sd-block sv-a-' + t.accent + " sv-l-" + t.layout + '">' +
      '<div class="sd-block-h">' + esc(t.blockTitle || "Xizmat haqida") + "</div>" +
      svcThemeBlock(t) +
      "</div>" +
      /* --- «Tez kunda» tushuntirishi (navbat tugmasi o'rniga) --- */
      (soon
        ? '<div class="sd-soon-note">' +
          "<b>Bu xizmat hozir tayyorlanmoqda</b>" +
          "<p>Narx va navbat tez kunda ochiladi. Ishga tushishi bilan " +
          "shu bo'limda paydo bo'ladi.</p>" +
          "</div>"
        : "");

    bindServiceVideo();

    /* --- pastdagi yakka tugma ---
       «Tez kunda» xizmatda navbat OLINMAYDI (server ham 409 qaytaradi).
       Tugmani o'chirib qo'yish emas, butunlay YASHIRAMIZ: bosilmaydigan
       tugma mijozni chalg'itadi — «buzilganmi?» degan savol tug'iladi.
       Tushuntirish esa yuqorida, `sd-soon-note` da turadi. */
    const bar = $("sd-bar");
    const cta = $("sd-cta");
    if (bar) bar.classList.toggle("hidden", soon);
    /* Sahifaning pastidagi bo'sh joy TUGMA uchun ajratilgan. Tugma
       yashirilsa u joy ham kerak emas — bo'lmasa oynaning oxirida
       sababsiz katta bo'shliq qolardi. */
    const pageEl = $("service");
    if (pageEl) pageEl.classList.toggle("no-cta", soon);
    if (soon) {
      cta.onclick = null;
      return svcPageIn();
    }

    cta.textContent = isConfig ? "💡 Narxni hisoblash" : "🗓 Navbat olish";
    cta.className = "btn btn-primary sd-cta sv-a-" + t.accent;
    cta.onclick = () => {
      if (isConfig) return openFlow();
      openServiceBooking(s);
    };

    svcPageIn();
  }

  /** Ochilish animatsiyasini har safar qaytadan ishga tushiradi.
   *  `void offsetWidth` — brauzerni klassni qayta hisoblashga majburlaydi,
   *  aks holda olib qo'yib darhol qo'shish HECH QANDAY o'zgarish
   *  bermaydi va animatsiya ikkinchi marta ko'rinmaydi. */
  function svcPageIn() {
    const page = $("service");
    if (!page) return;
    page.classList.remove("is-in");
    void page.offsetWidth;
    page.classList.add("is-in");
  }

  /* -------------------------------------------------- xizmat videosi */

  /** Xizmat videosi bloki — YOPIQ holatda chiziladi.
   *
   *  NEGA DARHOL `<video>` QO'YILMAYDI. Video uzun va yuqori sifatda
   *  bo'ladi (o'nlab MB). Sahifa ochilishida uni yuklab boshlash mijoz
   *  trafigini behuda yeydi — ayniqsa mobil internetda. Shu sababli
   *  avval faqat TUGMA turadi; `<video>` elementi mijoz bosgandan keyin
   *  yaratiladi. Ya'ni «xohlasa ochib ko'radi, xohlamasa yo'q».
   *
   *  Ruxsatni SERVER beradi (`video_allowed`) — faqat uchta fara
   *  xizmatida. Qoida frontendda TAKRORLANMAYDI, aks holda ikki joyda
   *  saqlanib bir-biridan ajralib ketardi. */
  function svcVideoBlock(s, t) {
    if (!s || !s.has_video || !s.video_url) return "";
    /* `video_allowed` eski backendda bo'lmasligi mumkin. Bo'lsa —
       hurmat qilamiz; bo'lmasa `has_video` ning o'zi yetarli, chunki
       serverda video faqat ruxsat etilgan xizmatga saqlanadi. */
    if ("video_allowed" in s && !s.video_allowed) return "";

    return (
      '<div class="sd-video sv-a-' + t.accent + '" id="sd-video">' +
      '<button class="sd-video-open" id="sd-video-open" type="button">' +
      '<span class="sd-video-ring"><span class="sd-video-play">▶</span></span>' +
      '<span class="sd-video-tx">' +
      "<b>Videoni ko'rish</b>" +
      "<i>Xizmat qanday bajarilishi — qisqa lavha</i>" +
      "</span>" +
      "</button>" +
      '<p class="sd-video-hint">Video ochilganda yuklanadi — trafik ' +
      "behuda ketmaydi.</p>" +
      "</div>"
    );
  }

  /** Yopiq video blokini «tirik» qiladi: bosilganda `<video>` yaratiladi.
   *
   *  Element mijoz BOSGANIDAN keyin qo'shiladi — shu sababli
   *  `video.play()` foydalanuvchi harakati ichida chaqiriladi va brauzer
   *  avtomatik o'ynatishni to'xtatmaydi. */
  function bindServiceVideo() {
    const btn = $("sd-video-open");
    if (!btn) return;
    btn.onclick = () => {
      const wrap = $("sd-video");
      const s = (S.services || [])[S.svcIndex];
      if (!wrap || !s || !s.video_url) return;
      haptic("light");

      const v = document.createElement("video");
      v.className = "sd-video-el";
      v.src = s.video_url;
      v.controls = true;
      v.playsInline = true;
      /* `metadata` — faqat davomiylik va o'lchamni oladi, keyin brauzer
         o'ynatish davomida bo'lak-bo'lak yuklaydi. Uzun videoni butunlay
         kutib o'tirish shart emas. */
      v.preload = "metadata";
      v.setAttribute("playsinline", "");
      v.onerror = () => {
        wrap.innerHTML =
          '<p class="sd-video-hint is-err">Video ochilmadi. Internetni ' +
          "tekshirib qayta urinib ko'ring.</p>";
      };

      wrap.classList.add("is-open");
      wrap.innerHTML = "";
      wrap.appendChild(v);
      const p = v.play();
      // Brauzer rad etsa (masalan quvvat tejash rejimi) — xato
      // konsolga chiqmasin, mijoz o'zi bosib qo'yadi.
      if (p && p.catch) p.catch(() => {});
    };
  }

  /** Temaga xos ichki blok. Yetti tema — yetti xil tuzilish. */
  function svcThemeBlock(t) {
    if (t.layout === "hero") {
      return (
        '<div class="sv-hero-beam"></div>' +
        '<div class="sv-facts">' +
        (t.facts || [])
          .map(
            (f) =>
              '<div class="sv-fact"><i>' + f[0] + "</i><b>" + esc(f[1]) +
              "</b><small>" + esc(f[2]) + "</small></div>"
          )
          .join("") +
        "</div>"
      );
    }
    if (t.layout === "tech") {
      return (
        '<ol class="sv-steps">' +
        (t.steps || []).map((x) => "<li>" + esc(x) + "</li>").join("") +
        "</ol>"
      );
    }
    if (t.layout === "shine") {
      return (
        '<div class="sv-ba">' +
        '<div class="sv-ba-col is-before"><small>Oldin</small><b>' +
        esc(t.before || "") + "</b></div>" +
        '<span class="sv-ba-arrow">→</span>' +
        '<div class="sv-ba-col is-after"><small>Keyin</small><b>' +
        esc(t.after || "") + "</b></div>" +
        "</div>"
      );
    }
    if (t.layout === "split") {
      return (
        '<div class="sv-pair">' +
        (t.pair || [])
          .map(
            (x, k) =>
              '<div class="sv-pair-b' + (k ? " is-new" : " is-old") + '">' +
              (k ? "🪟" : "💥") + " " + esc(x) + "</div>"
          )
          .join("") +
        "</div>"
      );
    }
    if (t.layout === "bubble") {
      return (
        '<div class="sv-bubbles"><i></i><i></i><i></i></div>' +
        '<ul class="sv-bullets">' +
        (t.bullets || []).map((x) => "<li>" + esc(x) + "</li>").join("") +
        "</ul>"
      );
    }
    if (t.layout === "stitch") {
      return (
        '<div class="sv-thread"><span>Ip rangi:</span>' +
        (t.threads || []).map((c) => '<i style="background:' + esc(c) + '"></i>').join("") +
        "</div>"
      );
    }
    if (t.layout === "fabric") {
      return (
        '<div class="sv-mats">' +
        (t.materials || []).map((x) => "<span>" + esc(x) + "</span>").join("") +
        "</div>"
      );
    }
    // Oddiy ro'yxat — yangi yo'nalishlar uchun (laminat, tanirovka, broni)
    if (t.layout === "list") {
      return (
        '<ul class="sv-bullets">' +
        (t.bullets || []).map((x) => "<li>" + esc(x) + "</li>").join("") +
        "</ul>"
      );
    }
    return "";
  }

  /* ==================================================================
     NAVBAT OLISH — IKKI qadam:  1) Kun  →  2) Vaqt  →  tasdiq

     Ilgari uch qadam edi va birinchisi «Xizmatni tanlang» ro'yxati bo'lib
     turardi. Endi xizmat «🛠 Xizmatlar» bo'limidagi KARTOCHKADAN keladi
     (`openServiceBooking`) — mijoz allaqachon nimani xohlayotganini
     aytgan, ro'yxatni ikkinchi marta ko'rsatish ortiqcha qadam edi.

     Vaqt band bo'lib qolsa (409) — ro'yxat darhol yangilanadi.
     ================================================================== */

  const BK = { step: 1, service: null, day: null, days: [], slots: [], time: null };

  function bookingHead() {
    const titles = ["Qulay kunni tanlang", "Vaqtni tanlang"];
    $("sheet-title").textContent = "🗓 " + (titles[BK.step - 1] || "Navbat olish");
  }

  /** Yuqoridagi qadam ko'rsatkichi (iOS segment uslubi). */
  function bookingSteps() {
    const names = ["Kun", "Vaqt"];
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

  /** Tanlangan xizmat va kun haqida ixcham eslatma.
   *  Xizmat endi alohida qadam emas — nomi va narxi HAR DOIM ko'rinib
   *  turadi, mijoz nimaga navbat olayotganini yo'qotmasin. */
  function bookingRecap() {
    const bits = [];
    if (BK.service) {
      const p = BK.service.price ? " · " + svcPrice(BK.service) : "";
      bits.push(`🔧 ${esc(BK.service.name)}${esc(p)}`);
    }
    if (BK.day) bits.push(`📅 ${esc(BK.day.short_label || BK.day.label)}`);
    return bits.length ? el("div", "bk-recap", bits.join(" · ")) : null;
  }

  /** Tanlangan xizmat uchun navbat oqimini ochadi.
   *
   *  Xizmat kartochkasidan chaqiriladi, ya'ni ro'yxat qadami TASHLAB
   *  ketiladi va mijoz to'g'ridan kun tanlashga tushadi.
   *
   *  Bo'sh vaqtlar brauzerda ham hisoblanadi (mantiq
   *  `utils/helpers.py: free_slots` dan aynan ko'chirilgan), shuning uchun
   *  Render uxlagan bo'lsa ham navbat ishlaydi.
   */
  function openServiceBooking(service) {
    if (!service) return;
    /* Himoya: «Tez kunda» xizmatga navbat ochilmasligi kerak. Tugma
       allaqachon yashirilgan, lekin bu funksiya boshqa joydan ham
       chaqirilishi mumkin — server esa 409 qaytarardi va mijoz shaklni
       to'ldirib bo'lgach xato ko'rardi. */
    if (svcSoon(service)) return toast(SOON_TEXT + " — hozircha navbat olinmaydi");
    haptic("medium");
    BK.step = 1;
    BK.service = service;
    BK.day = null;
    BK.time = null;
    BK.days = [];
    BK.slots = [];
    openSheet("🗓 Qulay kunni tanlang", '<div class="bk-load">Yuklanmoqda...</div>');
    loadBookingDays();
  }

  /** Navbat so'rovlari SERVERGA ketishi kerakmi.
   *
   *  Xizmat serverda mavjud bo'lmasa (ichki zaxira ro'yxat — `id` yo'q)
   *  yoki zaxira rejim bo'lsa, hammasi brauzer + bulut orqali bajariladi.
   *  Aks holda mavjud bo'lmagan `service_id` bilan so'rov ketib, mijoz
   *  tushunarsiz xato ko'rardi. */
  const bkLocal = () => S.offline || !BK.service || !BK.service.id;

  function paintBooking() {
    bookingHead();
    const box = $("sheet-content");
    box.innerHTML = "";
    box.append(bookingSteps());
    const recap = bookingRecap();
    if (recap) box.append(recap);

    if (BK.step === 1) return paintBookingDays(box);
    return paintBookingSlots(box);
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
      BK.days = bkLocal()
        ? await ZimmerOffline.bookingDates(BK.service.duration_min)
        : await api("/api/dates?service_id=" + BK.service.id);
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
        BK.step = 2;
        loadBookingSlots();
      };
      strip.append(card);
    });
    box.append(strip);

    /* Xizmat endi panel ichida tanlanmaydi — u «Xizmatlar» bo'limidagi
       kartochkadan keldi. Shuning uchun bu tugma panelni YOPADI va mijoz
       boshqa xizmatni ro'yxatdan tanlaydi. */
    const back = el("button", "btn btn-ghost btn-sm", "‹ Boshqa xizmat");
    back.onclick = () => {
      haptic();
      closeSheet();
      show("services");
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
      const data = bkLocal()
        ? await ZimmerOffline.bookingSlots(BK.day.date, BK.service.duration_min)
        : await api(
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
        BK.step = 1;
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
      // Kun — endi 1-qadam (xizmat qadami olib tashlangan)
      BK.step = 1;
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
        // Bazaga to'g'ridan yoziladi. Bandlik yozishdan OLDIN qayta
        // tekshiriladi — oradа boshqa mijoz olib qo'ygan bo'lishi mumkin.
        const res = bkLocal()
          ? await ZimmerOffline.createBooking({
              uid: (S.me && (S.me.user_id || S.me.id)) || 0,
              service_id: BK.service.id,
              service_name: BK.service.name || "",
              duration_min: BK.service.duration_min,
              price: BK.service.price || 0,
              date: BK.day.date,
              time: BK.time,
              name: (S.me && (S.me.full_name || S.me.first_name)) || "",
              phone: (S.me && S.me.phone) || "",
            })
          : await api("/api/bookings", {
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
    // Oldingi buyurtmadan qolgan «qabul qilindi» qatlami bo'lsa yopamiz —
    // aks holda konfigurator ochilganda xabar ustida turib qolardi.
    closeFlowDone();
    show("flow");
    if (!S.cars.length) {
      /* Ilgari bu yerda FAQAT `/api/cars` so'ralardi va Render uxlagan
         bo'lsa konfigurator umuman ochilmasdi (`onError` bilan chiqib
         ketardi). Endi bulut, keyin ichki ro'yxat — oyna har holda
         ishlaydi. */
      let list = null;
      try {
        list = S.offline ? await ZimmerOffline.cars() : await api("/api/cars");
      } catch (_) {
        try {
          if (window.ZimmerOffline && ZimmerOffline.cars) list = await ZimmerOffline.cars();
        } catch (_) {}
      }
      S.cars = useCars(list);
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

  /* ====================================================================
     TELEGRAM MAVZUSI BILAN MOSLASHTIRISH

     MUAMMO. Ilgari `themeParams` va `colorScheme` BUTUN ILOVADA bir marta
     ham ishlatilmagan edi, ranglar esa uch joyda QATTIQ yozilgan:
     `tg.setHeaderColor("#08080a")`, `tg.setBackgroundColor("#08080a")` va
     `<meta name="theme-color">`. Natijada:

       * palitra o'zgarsa bu uchtasi eskirib qolardi (bir-biriga bog'liq
         emas);
       * Telegram'ning pastki paneli (bottom bar) sozlanmasdi va qora
         ilova ostida boshqa rangda ko'rinardi;
       * mijoz Telegram'da kunduzgi rejimga o'tsa hech narsa o'zgarmasdi.

     YECHIM. Rang stylesheet'dagi `--bg` dan O'QILADI (yagona manba) va
     Telegram chetlariga uzatiladi. Ilovaning o'zi qora qoladi — bu brend
     qarori (yuqoridagi `styles.css` izohiga qara).
     ==================================================================== */
  function applyTgTheme() {
    if (!tg) return;

    // Yagona manba: CSS o'zgaruvchisi
    let bg = "";
    try {
      bg = getComputedStyle(document.documentElement)
        .getPropertyValue("--bg")
        .trim();
    } catch (_) {}
    if (!/^#[0-9a-fA-F]{3,8}$/.test(bg)) bg = "#08080a"; // zaxira

    try {
      if (tg.setHeaderColor) tg.setHeaderColor(bg);
    } catch (_) {}
    try {
      if (tg.setBackgroundColor) tg.setBackgroundColor(bg);
    } catch (_) {}
    try {
      // Telegram 7.10+ — pastki panel. Ilgari umuman sozlanmasdi.
      if (tg.setBottomBarColor) tg.setBottomBarColor(bg);
    } catch (_) {}

    // Brauzer chizadigan joylar ham mos bo'lsin (masalan Android'da
    // klaviatura ochilganda ko'rinadigan tor chiziq)
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", bg);
  }

  /* ======================================================================
     🎓 SHOGIRD — ILOVA ICHIDAGI YORDAMCHI

     NIMA UCHUN BU BOTDAGI AI EMAS
     Botdagi yordamchining butun maqsadi — mijozni ilovaga olib kirish
     («Do'konni ochish» tugmasi har javob ostida turadi). Ilova ICHIDA bu
     javob ma'nosiz. Shogirdning ko'rsatmasi shu sababli boshqa
     (`services/shogird.py`): u mijoz ilovada turganini biladi va uni
     BO'LIMLAR bo'ylab yo'naltiradi.

     UCHTA QAROR, QOLGANLARI SHUNDAN KELIB CHIQADI

     1) MODEL FAQAT MATN YOZADI, KARTOCHKANI SERVER TANLAYDI.
        Javob ostidagi xizmat va tovar kartochkalari model «tanlagani»
        emas — server javob matnini BAZADAGI nomlar bilan solishtirib
        topadi (`services/shogird.py: _match_*`). Ya'ni mavjud bo'lmagan
        tovar hech qachon ko'rsatilmaydi va narx modeldan emas, bazadan
        keladi. Model narxni o'ylab topsa ham kartochkadagi raqam haqiqiy.

     2) SHOGIRD HECH QACHON JIM QOLMAYDI.
        `GROQ_API_KEY` sozlanmagan, Groq chegarasi tugagan yoki Render
        uxlagan bo'lishi mumkin — bularning hammasi HAQIQIY holat. Shu
        sababli pastda mahalliy bilim bor (`SG_FAQ`): yetkazib berish,
        kafolat, to'lov, manzil, ish vaqti, narxlar va katalog qidiruvi.
        Bu ma'lumot ilovada allaqachon bor (`S.pay`, `S.services`,
        `S.home`), shunchaki bir joyga yig'ilgan. Mijoz javob o'rniga
        qizil xato ko'rmaydi.

     3) SHOGIRD MIJOZ NOMIDAN HECH NARSA QILMAYDI.
        Buyurtma bermaydi, navbat olmaydi, savatga qo'shmaydi. Kartochkada
        tugma bor, lekin uni MIJOZ bosadi. Aks holda «shogird noto'g'ri
        tovar buyurdi» degan holat paydo bo'lardi va uni tekshirishning
        yo'li yo'q edi.
     ====================================================================== */

  /** «Nima bo'ldi?» plitkalari.
   *
   *  Har plitka — TAYYOR SAVOL. Sabab: bo'sh yozishma oynasi mijozni
   *  qotib qoldiradi («nima deb yozsam?»), ayniqsa yordamchiga birinchi
   *  marta kirganda. Matnlar mijozning O'Z tilida yozilgan («faram
   *  xira»), xizmat nomida emas («polirovka») — mijoz xizmat nomini
   *  bilmasligi mumkin, muammosini esa biladi. */
  const SG_TOPICS = [
    {
      ic: "🔅",
      t: "Faram xira",
      q: "Faram xira bo'lib qolgan, sarg'aygan. Nima qilish kerak va qancha turadi?",
    },
    {
      ic: "💧",
      t: "Ichida bug'",
      q: "Fara ichida bug' va namlik yig'ilib qolgan. Buni tuzatasizmi, narxi qancha?",
    },
    {
      ic: "💡",
      t: "Yorug'lik kam",
      q: "Faramning yorug'ligi kam, kechasi yo'l yaxshi ko'rinmaydi. Bi-LED linza yordam beradimi?",
    },
    {
      ic: "🪟",
      t: "Shisha yorilgan",
      q: "Fara shishasi yorilgan. Almashtirib berasizmi, qancha turadi?",
    },
    {
      ic: "🪑",
      t: "Chexollar",
      q: "Rul va o'rindiq chexollari haqida ma'lumot bering.",
    },
    { ic: "💰", t: "Narxlar", q: "Xizmatlaringizning narxlari qanday?" },
    { ic: "🚚", t: "Yetkazib berish", q: "Tovarni qanday yetkazib berasiz?" },
    { ic: "🛡", t: "Kafolat", q: "Ishlaringizga kafolat berasizmi, qancha muddat?" },
  ];

  /** Modeldan kelgan matnni tozalaydi.
   *
   *  Ko'rsatmada «markdown ishlatma» deb yozilgan, lekin model ba'zan
   *  baribir `**qalin**` yoki `### sarlavha` yozadi. Pufakcha ichida bu
   *  yulduzchalar bo'lib ko'rinadi va javob qo'pol chiqadi, shuning uchun
   *  belgilar olib tashlanadi (matn O'ZI qoladi). */
  function sgClean(text) {
    return String(text || "")
      .replace(/\*\*([^*]+)\*\*/g, "$1")
      .replace(/\*([^*\n]+)\*/g, "$1")
      .replace(/^#{1,6}\s*/gm, "")
      .replace(/^\s*[-•]\s+/gm, "• ")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  /** Yozishmani eng pastga suradi (yangi xabar ko'rinib turishi kerak).
   *
   *  DIQQAT: bu yerda SAHIFA suriladi, `#sg-log` emas. Yozishma o'z
   *  skrolliga ega bo'lsa ikki qatlam paydo bo'lardi (sahifa ham,
   *  ro'yxat ham) — telefonda bu eng bezovta qiluvchi holat. */
  function sgScroll(smooth) {
    window.scrollTo({
      top: document.body.scrollHeight,
      behavior: smooth ? "smooth" : "auto",
    });
  }

  /** Bo'sh holat (salom + plitkalar) ko'rinsinmi. */
  function sgPaintHero() {
    const empty = !(S.sg.msgs || []).length;
    const hero = $("sg-hero");
    if (hero) hero.classList.toggle("hidden", !empty);
    const reset = $("sg-reset");
    if (reset) reset.classList.toggle("hidden", empty);
  }

  function sgRenderTopics() {
    const box = $("sg-topics");
    if (!box || box.dataset.ready === "1") return;
    box.innerHTML = SG_TOPICS.map(
      (topic, i) =>
        '<button class="sg-topic" type="button" data-sg-topic="' +
        i +
        '" style="--d:' +
        Math.min(i, 8) * 40 +
        'ms"><i>' +
        topic.ic +
        "</i><span>" +
        esc(topic.t) +
        "</span></button>"
    ).join("");
    box.dataset.ready = "1";
  }

  /** Bitta pufakcha. `role`: "me" | "sg". */
  function sgBubble(role, text) {
    const row = el("div", "sg-row sg-" + role);
    if (role === "sg") row.append(el("span", "sg-face", "🎓"));
    const bubble = el("div", "sg-msg");
    // `textContent` — matn ichidagi `<`, `&` xavfsiz qoladi; qatorlar
    // esa CSS `white-space: pre-wrap` bilan saqlanadi.
    bubble.textContent = text;
    row.append(bubble);
    return row;
  }

  /** «Yozmoqda…» belgisi. Javob 5-15 soniya kelishi mumkin — belgisiz
   *  mijoz ilova qotib qolgan deb o'ylaydi. */
  function sgTyping(on) {
    const log = $("sg-log");
    if (!log) return;
    const old = log.querySelector(".sg-wait");
    if (old) old.remove();
    if (!on) return;
    const row = el("div", "sg-row sg-sg sg-wait");
    row.append(el("span", "sg-face", "🎓"));
    row.append(el("div", "sg-msg sg-msg-wait", '<span class="typing-dots"><i></i><i></i><i></i></span>'));
    log.append(row);
    sgScroll();
  }

  /** Tovar ID'si bo'yicha ilovadagi HAQIQIY tovarni topadi.
   *
   *  Server faqat id va nomni yuboradi — rasm, qoldiq va tavsif esa
   *  ilovada allaqachon bor (`S.home.catalog`). Shu tufayli kartochka
   *  do'kondagi bilan bir xil ko'rinadi va «Savatga qo'shish» haqiqiy
   *  qoldiqni tekshiradi. */
  function sgFindProduct(id) {
    const groups = (S.home && S.home.catalog) || [];
    for (const group of groups) {
      const hit = (group.products || []).find((p) => String(p.id) === String(id));
      if (hit) return hit;
    }
    return null;
  }

  /** Xizmat ID'si bo'yicha `S.services` dagi o'rnini (indeksini) topadi.
   *  `openService()` aynan indeks bilan ishlaydi. */
  function sgServiceIndex(id) {
    const list = S.services || [];
    const idx = list.findIndex((s) => String(s.id) === String(id));
    return idx >= 0 ? idx : -1;
  }

  /** Javob ostidagi kartochkalar: xizmat → oynasi, tovar → savat. */
  function sgAttach(reply) {
    const services = reply.services || [];
    const products = reply.products || [];
    if (!services.length && !products.length) return null;

    const box = el("div", "sg-attach");

    services.forEach((svc) => {
      const card = el("button", "sg-card sg-card-svc");
      card.type = "button";
      card.dataset.sgSvc = svc.id;
      card.innerHTML =
        '<span class="sg-card-ic">🛠</span>' +
        '<span class="sg-card-tx"><b>' +
        esc(svc.name || "Xizmat") +
        "</b><small>" +
        (svc.coming_soon
          ? "Tez kunda"
          : esc(svc.price_label || "") +
            (svc.warranty ? " · 🛡 " + esc(svc.warranty) : "")) +
        "</small></span>" +
        '<span class="sg-card-go">' +
        (svc.coming_soon ? "›" : "Ochish ›") +
        "</span>";
      box.append(card);
    });

    products.forEach((item) => {
      const real = sgFindProduct(item.id);
      const photo = real ? abs(real.photo_url) : null;
      const stock = real ? Number(real.stock || 0) : Number(item.stock || 0);
      const price = real ? real.price_label : item.price_label;

      const card = el("div", "sg-card sg-card-prod");
      card.innerHTML =
        '<span class="sg-card-img">' +
        (photo ? img(photo, "", item.name) : '<i class="sg-card-ph">🛍</i>') +
        "</span>" +
        '<span class="sg-card-tx"><b>' +
        esc(item.name || "Tovar") +
        "</b><small>" +
        esc(price || "") +
        (stock > 0 ? "" : " · tugagan") +
        "</small></span>" +
        '<button class="sg-card-btn" type="button" data-sg-open="' +
        esc(item.id) +
        '">Ko\'rish</button>' +
        (stock > 0
          ? '<button class="sg-card-btn is-add" type="button" data-sg-add="' +
            esc(item.id) +
            '" aria-label="Savatga qo\'shish">＋</button>'
          : "");
      box.append(card);
    });

    return box;
  }

  /** Javobdan keyingi savol chiplari. */
  function sgSuggest(list) {
    const items = (list || []).filter(Boolean);
    if (!items.length) return null;
    const box = el("div", "sg-sugs");
    items.forEach((text) => {
      const chip = el("button", "sg-sug", esc(text));
      chip.type = "button";
      chip.dataset.sgAsk = text;
      box.append(chip);
    });
    return box;
  }

  /** Shogirdning javobini yozishmaga qo'yadi. */
  function sgPush(reply) {
    const log = $("sg-log");
    if (!log) return;
    const text = sgClean(reply.text);
    const row = sgBubble("sg", text);
    log.append(row);

    const attach = sgAttach(reply);
    if (attach) log.append(attach);
    const sugs = sgSuggest(reply.suggests);
    if (sugs) log.append(sugs);

    S.sg.msgs.push({ role: "sg", ...reply, text: text });
    sgPaintHero();
    sgScroll(true);
  }

  /* ------------------------------------------------- mahalliy bilim (zaxira)

     Bu ro'yxat AI O'RNINI BOSMAYDI — u faqat tez-tez so'raladigan
     savollarga javob beradi. Lekin aynan shu savollar eng ko'p beriladi,
     shuning uchun AI o'chirilgan bo'lsa ham Shogird foydali bo'lib
     qoladi.

     MA'LUMOT QAYERDAN: `S.pay` (`/api/config`), `S.services`
     (`/api/services`) va `S.home.catalog`. Ya'ni matnda QATTIQ yozilgan
     narx yoki telefon YO'Q — admin o'zgartirsa javob ham o'zgaradi. */

  function sgContactLine() {
    const out = [];
    if (S.pay && S.pay.phone) out.push("📞 " + S.pay.phone);
    if (S.pay && S.pay.admin) out.push("✍️ @" + S.pay.admin);
    return out.join("   ");
  }

  function sgServiceList() {
    const list = (S.services || []).filter((s) => !svcSoon(s));
    if (!list.length) return "";
    return list
      .slice(0, 8)
      .map((s) => "• " + s.name + " — " + (s.price_label || "narxi so'rov bo'yicha"))
      .join("\n");
  }

  const SG_FAQ = [
    {
      k: ["yetkaz", "dostavka", "kuryer", "pochta", "bts", "jo'nat", "jonat", "olib kel"],
      a: () =>
        "Yetkazib berish ikki xil:\n" +
        "• " +
        ((S.pay && S.pay.city) || "Samarqand") +
        " bo'ylab — kuryer\n" +
        "• Boshqa viloyatlarga — BTS Pochta\n\n" +
        "Usulni 🧺 Savatcha → «Rasmiylashtirish» qadamida tanlaysiz, " +
        "narxi shu yerda ko'rinadi.",
    },
    {
      k: ["kafolat", "garantiya", "garanti"],
      a: () =>
        "Kafolat ish va tovarga qarab beriladi — har xizmatning o'z muddati bor " +
        "(masalan Bi-LED o'rnatishga 1 yil, polirovkaga 3 oy).\n\n" +
        "Aniq muddat 🛠 Xizmatlar bo'limida xizmat ustiga bosilganda va tovar " +
        "kartochkasida 🛡 belgisi bilan yozilgan.",
    },
    {
      k: ["qayer", "manzil", "adres", "joylash", "kelsam", "lokatsiya"],
      a: () =>
        "Ustaxonamiz " +
        ((S.pay && S.pay.city) || "Samarqand") +
        "da. Aniq manzil va mo'ljalni bering deb yozsangiz, usta joylashuvni " +
        "yuboradi:\n" +
        (sgContactLine() || "Aloqa ma'lumoti kabinetdagi «Biz bilan aloqa» da."),
    },
    {
      k: ["to'lov", "tolov", "karta", "naqd", "plastik", "bo'lib to'lash", "nasiya"],
      a: () =>
        "To'lov usullari: naqd, plastik karta va ilova orqali o'tkazma.\n" +
        "Usulni 🧺 Savatcha → «Rasmiylashtirish» ning oxirgi qadamida tanlaysiz. " +
        "Karta rekvizitlari shu yerda ko'rinadi.",
    },
    {
      k: ["navbat", "band qil", "yozil", "qachonga", "vaqt olsam", "zapis"],
      a: () =>
        "Navbat shunday olinadi:\n" +
        "1) 🛠 Xizmatlar bo'limiga o'ting\n" +
        "2) Kerakli xizmatni bosing\n" +
        "3) «🗓 Navbat olish» → kun va soatni tanlang\n\n" +
        "Navbatlaringiz 👤 Kabinet → «Navbatlarim» da turadi.",
    },
    {
      k: ["narx", "qancha tur", "pul", "price", "prays", "skolko"],
      a: () => {
        const list = sgServiceList();
        return list
          ? "Xizmat narxlari:\n" +
              list +
              "\n\nTovar narxlari 🏠 Asosiy bo'limidagi katalogda. " +
              "Aniq narx usta ko'rgandan keyin tasdiqlanadi."
          : "Har xizmatning narxi 🛠 Xizmatlar bo'limida, tovar narxlari esa " +
              "🏠 Asosiy bo'limidagi katalogda turadi.";
      },
    },
    {
      k: ["ish vaqti", "soat necha", "qachon ochiq", "dam olish", "ishlaysiz"],
      a: () =>
        "Navbat olish mumkin bo'lgan kunlar va bo'sh soatlar 🛠 Xizmatlar → " +
        "xizmat → «🗓 Navbat olish» da ko'rinadi — band bo'lgan vaqtlar " +
        "ro'yxatda chiqmaydi.\n" +
        (sgContactLine() ? "Shoshilinch bo'lsa: " + sgContactLine() : ""),
    },
    {
      k: ["telefon", "aloqa", "bog'lan", "boglan", "admin", "usta bilan", "operator"],
      a: () =>
        "Biz bilan bog'lanish:\n" +
        (sgContactLine() || "👤 Kabinet → «Biz bilan aloqa»") +
        "\n\nUstaga rasm yuborsangiz, holatni ko'rib aniq javob beradi.",
    },
    {
      k: ["buyurtma qanday", "qanday sotib", "savat", "zakaz qil"],
      a: () =>
        "Buyurtma berish:\n" +
        "1) 🏠 Asosiy bo'limidan tovarni tanlab «Savatga qo'shish»\n" +
        "2) 🧺 Savatcha → «Rasmiylashtirish»\n" +
        "3) Manzil va to'lov usulini tanlang\n\n" +
        "Buyurtmalaringiz 👤 Kabinet → «Buyurtmalarim» da kuzatiladi.",
    },
  ];

  /** Mijoz savolidan tovar qidiradi (mahalliy katalog bo'yicha). */
  function sgLocalProducts(question) {
    const low = String(question || "").toLowerCase().replace(/[’ʻ`]/g, "'");
    const words = low.match(/[a-z0-9']+/g) || [];
    const keys = words.filter((w) => w.length >= 4 || /\d/.test(w));
    if (!keys.length) return [];

    const out = [];
    ((S.home && S.home.catalog) || []).forEach((group) => {
      (group.products || []).forEach((p) => {
        const name = String(p.name || "").toLowerCase().replace(/[’ʻ`]/g, "'");
        const code = String(p.code || "").toLowerCase();
        const hit =
          keys.filter((k) => name.includes(k)).length + (code && low.includes(code) ? 2 : 0);
        if (hit > 0) out.push({ hit: hit, p: p });
      });
    });

    out.sort((a, b) => b.hit - a.hit || (a.p.price || 0) - (b.p.price || 0));
    return out.slice(0, 3).map((x) => ({
      id: x.p.id,
      name: x.p.name,
      price_label: x.p.price_label,
      stock: x.p.stock,
    }));
  }

  /** AI ishlamaganda javob. Har doim BIROR foydali narsa qaytaradi. */
  function sgLocal(question) {
    const low = String(question || "").toLowerCase().replace(/[’ʻ`]/g, "'");
    const hit = SG_FAQ.find((row) => row.k.some((needle) => low.includes(needle)));

    if (hit) {
      return {
        text: hit.a(),
        products: [],
        services: [],
        suggests: ["Navbat qanday olinadi?", "Kafolat qancha?"],
        local: true,
      };
    }

    const products = sgLocalProducts(question);
    if (products.length) {
      return {
        text: "Shu tovarlar mos keldi — narxi va qoldig'i quyida:",
        products: products,
        services: [],
        suggests: ["Yetkazib berish qanday?", "Kafolat qancha?"],
        local: true,
      };
    }

    return {
      text:
        "Bu savolga aniq javob berish uchun ustaning o'zi ko'rishi kerak.\n" +
        (sgContactLine() ? sgContactLine() + "\n" : "") +
        "\nShu vaqtda: 🛠 Xizmatlar bo'limida narx va kafolat, 🏠 Asosiy " +
        "bo'limida esa butun katalog turadi.",
      products: [],
      services: [],
      suggests: ["Xizmat narxlari qanday?", "Yetkazib berish qanday?", "Kafolat qancha?"],
      local: true,
    };
  }

  /* ------------------------------------------------------------- so'rov */

  function sgSetBusy(on) {
    S.sg.busy = !!on;
    const send = $("sg-send");
    const box = $("sg-in");
    if (send) send.disabled = !!on;
    if (box) box.disabled = !!on;
    const sub = $("sg-sub");
    if (sub) sub.textContent = on ? "O'ylayapti…" : sgSubText();
  }

  function sgSubText() {
    if (S.sg.aiOn === false) return "Asosiy ma'lumotlar rejimi";
    return "Ustaxona yordamchisi";
  }

  /** Savol yuborish — yozishmaning yagona kirish nuqtasi. */
  async function sgAsk(question) {
    const text = String(question || "").trim();
    if (!text || S.sg.busy) return;

    const log = $("sg-log");
    if (!log) return;

    haptic("light");
    S.sg.msgs.push({ role: "me", text: text });
    log.append(sgBubble("me", text));
    sgPaintHero();

    const box = $("sg-in");
    if (box) {
      box.value = "";
      sgGrow();
    }

    sgSetBusy(true);
    sgTyping(true);

    /* Xizmatlar ro'yxati mahalliy javob uchun ham, kartochkani ochish
       uchun ham kerak (`openService()` indeks bilan ishlaydi). Fonda
       yuklanadi — javobni kutib turmaydi. */
    if (!S.services) loadServices(false).catch(() => {});

    let reply = null;
    if (!S.offline && S.sg.aiOn !== false) {
      try {
        const res = await api("/api/shogird", { method: "POST", body: { text: text } });
        if (res && res.ok) {
          reply = res;
        } else if (res && res.reason === "no_key") {
          // Kalit sozlanmagan — boshqa savollarda ham so'ramaymiz
          S.sg.aiOn = false;
        }
      } catch (err) {
        /* Bu yerda `onError()` ATAYLAB chaqirilmaydi: u qizil xato
           chiqaradi va suhbat uzilib qoladi. «Juda tez» holatida esa
           mijozga kutish kerakligini aytamiz. */
        if (err && (err.code === "too_fast" || err.code === "busy")) {
          sgTyping(false);
          sgSetBusy(false);
          toast(err.message || "Bir oz kuting");
          return;
        }
        if (err && err.code === "phone_required") {
          // Savol berish uchun telefon KERAK EMAS, lekin imzo eskirgan
          // bo'lsa shu xato kelishi mumkin — mahalliy javobga o'tamiz.
          console.warn("[shogird] server javob bermadi:", err.code);
        }
      }
    }

    /* Mahalliy javobga o'tayotgan bo'lsak, xizmatlar ro'yxatini KUTAMIZ:
       «Narxlar» savoliga javob aynan shundan yasaladi. Kutmasak,
       yordamchiga birinchi kirgan mijoz narxlar o'rniga «Xizmatlar
       bo'limiga o'ting» degan bo'sh javob olardi. */
    if (!reply && !S.services) {
      try {
        await loadServices(false);
      } catch (_) {}
    }
    if (!reply) reply = sgLocal(text);

    sgTyping(false);
    sgSetBusy(false);
    sgPush(reply);
  }

  /** Yozish maydoni matn bilan birga o'sadi (~5 qatorgacha).
   *
   *  `+2` — chegaralar (border) uchun: `box-sizing: border-box` bo'lgani
   *  uchun ular balandlikning ichida. Qo'shilmasa matn bir pikselga
   *  sig'may, maydonda KERAKSIZ skroll chizig'i paydo bo'ladi.
   *  Eng kichigi 48px — CSS dagi boshlang'ich balandlik (tugma bilan
   *  bir xil), aks holda birinchi harfda maydon sakrab kichrayardi. */
  function sgGrow() {
    const box = $("sg-in");
    if (!box) return;
    box.style.height = "auto";
    box.style.height = Math.max(48, Math.min(box.scrollHeight + 2, 118)) + "px";
  }

  /** Suhbatni tozalaydi. Server xotirasi ham tozalanadi — aks holda
   *  model eski mavzuga (oldingi mashina, oldingi muammo) qaytib ketardi. */
  function sgReset() {
    haptic();
    S.sg.msgs = [];
    const log = $("sg-log");
    if (log) log.innerHTML = "";
    sgPaintHero();
    if (!S.offline) api("/api/shogird/reset", { method: "POST" }).catch(() => {});
    toast("Suhbat tozalandi");
  }

  /** Bo'lim ochilganda (`show("shogird")`). */
  function sgOpen() {
    S.sg = S.sg || { msgs: [], busy: false, aiOn: true };
    sgRenderTopics();
    sgPaintHero();
    const hi = $("sg-hi");
    if (hi) {
      const name = ((S.me && (S.me.first_name || S.me.full_name)) || "").split(" ")[0];
      hi.textContent = name ? "Assalomu alaykum, " + name : "Assalomu alaykum";
    }
    const sub = $("sg-sub");
    if (sub && !S.sg.busy) sub.textContent = sgSubText();
    /* Klaviatura O'ZI ochilmaydi: mijoz avval plitkalarni ko'rishi kerak.
       Avtomatik fokus ekranning yarmini klaviatura bilan yopib qo'yardi. */
    if ((S.sg.msgs || []).length) sgScroll();
  }

  async function boot() {
    let carsReady = Promise.resolve(); // mashinalar so'rovi (parallel yuklanadi)
    if (tg) {
      tg.ready();
      tg.expand();
      applyTgTheme();
      try {
        // Telegram mavzusi o'zgarsa (mijoz kunduzgi/tungi rejimni almashtirsa)
        // chetlardagi ranglarni QAYTA tenglashtiramiz.
        if (tg.onEvent) tg.onEvent("themeChanged", applyTgTheme);
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
      /* Serverdagi qiymat bo'sh bo'lsa Mini App sozlamasiga tushamiz —
         `PAY_ADMIN_USERNAME` Render'da sozlanmagan bo'lsa ham «Biz bilan
         aloqa» va chek yuborish ISHLASHDAN TO'XTAMASLIGI kerak. */
      const local = window.ZIMMER_CONFIG || {};
      S.pay = {
        card: cfg.pay_card_number || "",
        holder: cfg.pay_card_holder || "",
        admin: String(cfg.pay_admin_username || local.SHOP_TELEGRAM || "").replace(/^@+/, ""),
        phone: cfg.shop_phone || local.SHOP_PHONE || "",
        city: cfg.delivery_city || "Samarqand",
      };
      /* Shogird: AI kaliti sozlanganmi. `false` bo'lsa har savolda
         serverga borib xato kutib o'tirmaydi — darhol mahalliy bilimdan
         javob beradi (`sgLocal`). */
      S.sg.aiOn = cfg.ai_enabled !== false;
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
        /* Adminda tugma YETTITA bo'ladi («🎓 Shogird» qo'shilgandan
           keyin). Yozuvlar sig'ishi uchun panel ixchamlashadi — aks
           holda «Xizmatlar» va «Saqlangan» uch nuqtaga aylanardi. */
        const nav = $("nav");
        if (nav) nav.classList.add("is-wide");
      }

    // Mashinalar ro'yxati kutib turmaydi — bosh menyu bilan BIR VAQTDA
    // yuklanadi. Ilgari ketma-ket kutilardi va kirishda qotish sezilardi.
    carsReady = (S.offline ? ZimmerOffline.cars() : api("/api/cars"))
      .then((list) => {
        const real = Array.isArray(list) ? list.filter(Boolean) : [];
        S.cars = useCars(real);
        /* Keshga FAQAT serverdan kelgan ro'yxat yoziladi. Ichki ro'yxatni
           keshlash xato bo'lardi: sun'iy (manfiy) id'lar keshda qolib,
           keyinchalik haqiqiy ro'yxat kelganda ham ular «server ma'lumoti»
           bo'lib ko'rinardi. */
        if (real.length && !S.offline && window.ZimmerOffline) {
          ZimmerOffline.saveCars(real);
        }
        if (me.car) S.car = S.cars.find((c) => c.id === me.car.id) || null;
      })
      .catch(() => {
        // So'rov butunlay yiqildi — konfigurator bo'sh qolmasin
        S.cars = useCars(null);
      });
    
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
      S.pay = { card: "", holder: "", admin: "", city: "Samarqand" };
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
    /* Admin tovar qo'shgandan keyin katalogni QAYTA o'qish uchun.
       DIQQAT: `{force: true}` bilan chaqirilishi SHART — aks holda
       kesh qaytadi va yangi tovar ko'rinmaydi. Shuning uchun ko'prikda
       majburiy yangilashga o'ralgan holda beriladi. */
    loadHome: (opts) => loadHome(opts || { force: true }),
    abs: abs,
    apiBase: () => API,
    state: S,
  };

  /* --------------------------------------------------------------- hodisa */
  document.querySelectorAll(".nav-btn").forEach((btn) => {
    btn.onclick = () => {
      haptic();
      const page = btn.dataset.page;
      /* Ilgari bu yerda «flow» uchun maxsus shart bor edi (konfigurator
         navigatsiyada alohida bo'lim edi). Endi u «🛠 Xizmatlar» ichidagi
         bitta kartochka — navigatsiya oddiy `show()` bilan ishlaydi. */
      show(page);
      // Bosh sahifa: katalog yo'q bo'lsa yuklaymiz, eskirgan bo'lsa
      // jimgina yangilaymiz (admin o'zgartirishi ko'rinishi uchun).
      if (page === "home") loadHome({ force: isHomeStale() });
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
    loadHome({ force: isHomeStale() });
  };

  // Zaxira rejim belgisi — bosilganda holatni tushuntiradi
  if ($("offline-badge")) $("offline-badge").onclick = explainOffline;

  bindQuickActions(); // bosh sahifadagi tez o'tish plitkalari
  bindShopTools(); // do'kon qidiruvi, filtrlar va saralash
  /* Fon musiqasi. `await` QILINMAYDI: musiqa ilovaning ishga tushishini
     kutib turmasligi kerak — server javob bermasa ham do'kon ochilishi
     shart. Xato bo'lsa jim qoladi (tugma ko'rinmaydi). */
  initMusic().catch(() => {});

  /* ---------------------------------------------------- XIZMATLAR bo'limi */
  /* Kartochkalar HAR chizishda qaytadan yasaladi, shuning uchun hodisa
     ota elementda tutiladi — bir marta bog'lanadi va abadiy ishlaydi. */
  /* Plitkalar HAR chizishda qaytadan yasaladi — hodisa ota elementda
     tutiladi. Plitka endi navbatni O'ZI ochmaydi: avval xizmatning
     alohida oynasi ko'rinadi, navbat esa o'sha oynadagi tugmada. */
  $("sv-list").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-svc]");
    if (!btn) return;
    openService(btn.dataset.svc);
  });
  $("sd-back").onclick = () => {
    haptic();
    closeService();
  };
  $("sv-refresh").onclick = () => {
    haptic("light");
    renderServicesPage(true); // serverdan qaytadan o'qiladi
  };

  /* ------------------------------------------------------ 🎓 SHOGIRD */
  /* Yozishma ichidagi tugmalar HAR javobda qaytadan yasaladi, shuning
     uchun hodisa ota elementda tutiladi — bir marta bog'lanadi. */
  $("sg-back").onclick = () => {
    haptic();
    show("home");
  };
  $("sg-reset").onclick = sgReset;

  $("sg-topics").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-sg-topic]");
    if (!btn) return;
    const topic = SG_TOPICS[Number(btn.dataset.sgTopic)];
    if (topic) sgAsk(topic.q);
  });

  $("sg-log").addEventListener("click", (e) => {
    // Keyingi savol chipi
    const chip = e.target.closest("[data-sg-ask]");
    if (chip) return sgAsk(chip.dataset.sgAsk);

    // Xizmat kartochkasi → xizmatning alohida oynasi
    const svc = e.target.closest("[data-sg-svc]");
    if (svc) {
      const idx = sgServiceIndex(svc.dataset.sgSvc);
      if (idx < 0) return toast("Xizmat ro'yxati yuklanmadi — qayta urinib ko'ring");
      return openService(idx);
    }

    // Tovarni ko'rish → do'kondagi bir xil oyna
    const open = e.target.closest("[data-sg-open]");
    if (open) {
      const product = sgFindProduct(open.dataset.sgOpen);
      if (!product) return toast("Tovar topilmadi — katalogni yangilang");
      return openProductModal(product);
    }

    /* Savatga qo'shish. Tovar `S.home` dan olinadi — ya'ni qoldiq va
       narx do'kondagi bilan BIR XIL manbadan. Shogird yuborgan
       ma'lumotga ishonib qo'shilsa, eskirgan narx savatga tushishi
       mumkin edi. */
    const add = e.target.closest("[data-sg-add]");
    if (add) {
      const product = sgFindProduct(add.dataset.sgAdd);
      if (!product) return toast("Tovar topilmadi — katalogni yangilang");
      addToCart(product, 1, add);
      return toast("Savatga qo'shildi");
    }
  });

  (function bindShogirdForm() {
    const form = $("sg-form");
    const box = $("sg-in");
    if (!form || !box) return;

    form.addEventListener("submit", (e) => {
      e.preventDefault();
      sgAsk(box.value);
    });

    box.addEventListener("input", sgGrow);
    /* Enter — yuborish, Shift+Enter — yangi qator. Telefonda
       `enterkeyhint="send"` tufayli klaviaturada «yuborish» ko'rinadi. */
    box.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        sgAsk(box.value);
      }
    });
  })();
  $("car-chip").onclick = openCarSheet;
  $("change-car").onclick = openCarSheet;
  $("order-submit").onclick = startCheckout;

  /* Rasmiylashtirish oynasi: «‹» bir qadam orqaga (goBack o'zi hisoblaydi),
     «✕» esa oqimni tashlab savatga qaytaradi. */
  $("co-back").onclick = () => {
    haptic();
    goBack();
  };
  $("co-close").onclick = () => {
    haptic();
    show("cart");
  };

  // Profil hub tugmalari
  $("pf-edit").onclick = () => openPhoneSheet(() => loadProfile());
  $("pf-contact").onclick = () => openContactSheet();
  $("pf-trust").onclick = openTrustSheet;
  $("pf-clear-cache").onclick = clearAppCache;

  /* ---------------------------------------- BUYURTMALARIM (uch oyna) */
  // Kabinetdagi uch plitka — har biri o'z oynasini ochadi
  $("mo-open-order").onclick = () => openMyOrders("order");
  $("mo-open-biled").onclick = () => openMyOrders("biled");
  $("mo-open-booking").onclick = () => openMyOrders("booking");

  $("mo-back").onclick = () => {
    haptic();
    show("profile");
  };
  $("mo-refresh").onclick = () => {
    haptic("light");
    moRefresh();
  };

  /* Qidiruv: har harfda qayta chizish o'rniga 180 ms kutamiz — uzun
     ro'yxatda yozish sekinlashmasin. */
  (function bindMoSearch() {
    const box = $("mo-q");
    if (!box) return;
    let t = 0;
    box.oninput = () => {
      clearTimeout(t);
      t = setTimeout(() => {
        S.moQ = box.value || "";
        $("mo-q-clear").classList.toggle("hidden", !S.moQ);
        renderMoFilters(S.moKind, S.my[S.moKind] || []);
        renderMoList(S.moKind, S.my[S.moKind] || []);
      }, 180);
    };
    // Klaviaturadagi «izlash» tugmasi — klaviaturani yopadi
    box.onkeydown = (e) => {
      if (e.key === "Enter") box.blur();
    };
  })();

  $("mo-q-clear").onclick = () => {
    S.moQ = "";
    $("mo-q").value = "";
    haptic("light");
    renderMyOrdersPage();
  };

  /* Filtr chiplari va kartochkalar HAR chizishda qaytadan yasaladi —
     shuning uchun har biriga alohida `onclick` bog'lash xato bo'lardi
     (yangi element eski bog'lamani olmaydi). Hodisa ota elementda
     tutiladi: bir marta bog'lanadi va abadiy ishlaydi. */
  $("mo-filters").addEventListener("click", (e) => {
    const chip = e.target.closest("[data-mof]");
    if (!chip) return;
    S.moFilter = chip.dataset.mof;
    S.moOpen = null;
    haptic("selection");
    renderMoFilters(S.moKind, S.my[S.moKind] || []);
    renderMoList(S.moKind, S.my[S.moKind] || []);
  });

  $("mo-list").addEventListener("click", (e) => {
    const act = e.target.closest("[data-moact]");
    if (act) {
      // Amal tugmasi bosilganda kartochka ochilib-yopilmasligi kerak
      e.stopPropagation();
      moAction(act.dataset.moact, act.dataset.mokey);
      return;
    }
    const card = e.target.closest(".mo-card[data-key]");
    if (card) moToggle(card.dataset.key);
  });

  /* Pastga tortib yangilash (pull-to-refresh) — telefonda eng tabiiy
     harakat. Faqat sahifa tepasida turganda ishlaydi, aks holda oddiy
     skrollga xalaqit berardi. */
  (function moPullToRefresh() {
    const page = $("orders");
    const ptr = $("mo-ptr");
    if (!page || !ptr) return;
    const TH = 66; // shu masofadan keyin qo'yib yuborsa — yangilanadi
    let startY = 0;
    let dist = 0;
    let pulling = false;

    page.addEventListener(
      "touchstart",
      (e) => {
        if (page.classList.contains("hidden")) return;
        if (e.touches.length !== 1) return;
        if (window.scrollY > 4) return;
        startY = e.touches[0].clientY;
        dist = 0;
        pulling = true;
      },
      { passive: true }
    );

    page.addEventListener(
      "touchmove",
      (e) => {
        if (!pulling) return;
        // Skroll boshlansa — tortishni tashlab yuboramiz
        if (window.scrollY > 4) {
          pulling = false;
          ptr.classList.remove("show", "ready");
          ptr.style.transform = "";
          return;
        }
        dist = e.touches[0].clientY - startY;
        if (dist <= 0) {
          ptr.classList.remove("show", "ready");
          ptr.style.transform = "";
          return;
        }
        // Qarshilik bilan: 0.45 koeffitsient «rezina» hissini beradi
        ptr.classList.add("show");
        ptr.style.transform = "translate3d(0," + Math.min(dist * 0.45, 84) + "px,0)";
        const ready = dist > TH;
        ptr.classList.toggle("ready", ready);
        $("mo-ptr-tx").textContent = ready
          ? "Qo'yib yuboring — yangilanadi"
          : "Yangilash uchun tortib turing";
      },
      { passive: true }
    );

    const release = () => {
      if (!pulling) return;
      pulling = false;
      const fire = dist > TH;
      dist = 0;
      ptr.style.transition = "transform .26s var(--silk)";
      ptr.style.transform = "";
      setTimeout(() => {
        ptr.style.transition = "";
        ptr.classList.remove("show", "ready");
      }, 280);
      if (fire) {
        haptic("medium");
        moRefresh();
      }
    };
    page.addEventListener("touchend", release, { passive: true });
    page.addEventListener("touchcancel", release, { passive: true });
  })();

  /* ------------------------------------------------- MANZILLARIM */
  $("pf-addresses").onclick = () => {
    haptic("light");
    show("addresses");
  };
  $("ad-back").onclick = () => {
    haptic();
    show("profile");
  };
  $("ad-add").onclick = () => openMapPicker("addresses");
  $("ad-list").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-adact]");
    if (!btn) return;
    addrAction(btn.dataset.adact, parseInt(btn.dataset.adi, 10));
  });

  $("sheet-close").onclick = closeSheet;
  $("sheet-backdrop").onclick = closeSheet;

  $("story-close").onclick = closeStory;
  $("story-prev").onclick = () => stepStory(-1);
  $("story-next").onclick = () => stepStory(1);
  $("story-sound").onclick = toggleStorySound;
  $("story-save").onclick = saveStory;
  $("story-del").onclick = deleteCurrentStory;

  /* Pastga surib yopish (Avto_A1 kabi). Faqat transform/opacity — silliq. */
  /* Surish ishoralari (Instagram kabi):
       * pastga  -> yopadi (fon xiralashib boradi);
       * yon tomonga -> BO'LIM almashadi (ilgari yon surish umuman
         ishlamasdi, bo'limga faqat chegaraga yetganda o'tilardi). */
  (function storySwipe() {
    const view = $("story-view");
    if (!view) return;
    let startY = 0;
    let startX = 0;
    let deltaY = 0;
    let deltaX = 0;
    let active = false;
    let axis = ""; // "y" | "x" — yo'nalish bir marta tanlanadi

    const isControl = (t) =>
      !!(t && t.closest && t.closest(".story-foot, .story-head, .story-cta"));

    view.addEventListener(
      "touchstart",
      (e) => {
        if (view.classList.contains("hidden")) return;
        // Pastdagi javob maydoni va tepadagi tugmalarda surish ishlamaydi
        if (isControl(e.target)) return;
        startY = e.touches[0].clientY;
        startX = e.touches[0].clientX;
        deltaY = 0;
        deltaX = 0;
        axis = "";
        active = true;
      },
      { passive: true }
    );

    view.addEventListener(
      "touchmove",
      (e) => {
        if (!active) return;
        deltaY = e.touches[0].clientY - startY;
        deltaX = e.touches[0].clientX - startX;
        if (!axis && (Math.abs(deltaX) > 10 || Math.abs(deltaY) > 10)) {
          axis = Math.abs(deltaX) > Math.abs(deltaY) ? "x" : "y";
        }
        if (axis === "y" && deltaY > 6) {
          view.style.transform = `translate3d(0, ${deltaY}px, 0)`;
          view.style.opacity = String(Math.max(0.35, 1 - deltaY / 420));
        } else if (axis === "x") {
          // Ozgina siljish — surilayotgani sezilsin (qarshilik bilan)
          view.style.transform = `translate3d(${deltaX * 0.25}px, 0, 0)`;
        }
      },
      { passive: true }
    );

    const spring = () => {
      view.style.transition = "transform 0.22s var(--silk), opacity 0.22s";
      view.style.transform = "";
      view.style.opacity = "";
      setTimeout(() => (view.style.transition = ""), 240);
    };

    view.addEventListener(
      "touchend",
      () => {
        if (!active) return;
        active = false;
        if (axis === "y" && deltaY > 110) {
          haptic("light");
          return closeStory();
        }
        if (axis === "x" && Math.abs(deltaX) > 60) {
          spring();
          return swipeRing(deltaX < 0 ? 1 : -1);
        }
        spring(); // yetarli surilmadi — joyiga qaytadi
      },
      { passive: true }
    );
  })();

  /* Media ustida IKKI MARTA bosish -> ❤️ (Instagram kabi). Bosish zonalari
     ustida ishlaydi, shuning uchun bir marta bosish oldinga/orqaga yurishga
     xalaqit bermaydi — ikkinchi bosish 320 ms ichida kelsa "yoqtirish". */
  (function storyDoubleTap() {
    let last = 0;
    ["story-prev", "story-next"].forEach((id) => {
      const zone = $(id);
      if (!zone) return;
      zone.addEventListener(
        "click",
        () => {
          const now = Date.now();
          if (now - last < 320) {
            last = 0;
            reactStory("❤️");
          } else last = now;
        },
        true // capture — zonaning o'z ishlovchisidan OLDIN
      );
    });
  })();

  /* Javob maydoni: yozayotganda story TO'XTAYDI (Instagram kabi) */
  (function storyReplyBind() {
    const form = $("story-reply");
    const input = $("story-reply-in");
    if (!form || !input) return;
    form.onsubmit = (e) => {
      e.preventDefault();
      sendStoryReply();
    };
    input.onfocus = () => storyPause(true);
    input.onblur = () => {
      if (!(input.value || "").trim()) storyPause(false);
    };
    // Maydonni bosish story'ni oldinga yurgizib yubormasin
    form.onclick = (e) => e.stopPropagation();
  })();

  /* Ovoz holati eslab qolinadi (ilgari har ochilishda ovozsiz edi) */
  try {
    S.storyMuted = localStorage.getItem("zimmer_story_mute") !== "0";
  } catch (_) {}

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
    try { return JSON.parse(localStorage.getItem(migrateKey(ADDR_KEY)) || "[]"); }
    catch { return []; }
  }
  function saveAddresses(arr) {
    localStorage.setItem(userKey(ADDR_KEY), JSON.stringify(arr));
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
        <span style="font-size:17px;">${addrIcon(a)}</span>
        <div style="flex:1;min-width:0;">
          <div style="font-size:13px;font-weight:700;">${esc(a.label || "Manzil")}${
            a.def ? ' <span class="ad-def">⭐</span>' : ""
          }</div>
          <div style="font-size:11px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(a.address)}</div>
          ${
            a.note
              ? `<div style="font-size:11px;color:var(--dim);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">🚪 ${esc(a.note)}</div>`
              : ""
          }
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
        const wasDef = !!arr[idx].def;
        arr.splice(idx, 1);
        if (wasDef && arr.length) arr[0].def = true;
        saveAddresses(arr);
        if (S._dlvSelectedAddr === idx) {
          S._dlvSelectedAddr = arr.length > 0 ? Math.min(idx, arr.length - 1) : null;
        } else if (S._dlvSelectedAddr !== null && S._dlvSelectedAddr > idx) S._dlvSelectedAddr--;
        renderCourierAddresses();
        renderAddrHint();
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
  /* Xarita IKKI joydan ochiladi: rasmiylashtirish oynasidan («checkout»)
     va kabinetdagi «Manzillarim» dan («addresses»). Saqlagandan keyin
     qaysi ro'yxatni qayta chizish kerakligi shu bilan aniqlanadi —
     ilgari xarita faqat checkout'ni bilardi. */
  let _mapCtx = "checkout";
  /* Xaritadan topilgan haqiqiy manzil matni (reverse geocoding). */
  let _pickedAddrText = "";
  /* Tanlangan tur — «🏠 Uy» / «💼 Ish» chipiga qarab (belgi uchun). */
  let _pickedType = "map";

  async function openMapPicker(ctx) {
    _mapCtx = ctx === "addresses" ? "addresses" : "checkout";
    const ov = $("map-picker-overlay");
    ov.classList.remove("hidden");
    _pickedCoords = null;
    _pickedAddrText = "";
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

  /** Haqiqiy son yoki `null`.
   *
   *  DIQQAT: oddiy `Number(v)` bu yerda YARAMAYDI — `Number(null)` va
   *  `Number("")` NOLGA aylanadi, ya'ni «koordinata yo'q» holati
   *  «(0, 0) nuqtasi» bo'lib o'tib ketardi va keyin `lat.toFixed()`
   *  butun oynani yiqitardi. Shuning uchun bo'sh qiymatlar alohida
   *  rad etiladi. */
  const finiteNum = (v) => {
    if (v === null || v === undefined || v === "" || typeof v === "boolean") return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  const validCoords = (c) => !!c && finiteNum(c.lat) !== null && finiteNum(c.lng) !== null;

  function placeMarker(lat, lng) {
    const la = finiteNum(lat);
    const ln = finiteNum(lng);
    // Xarita hodisasi yoki qurilma geolokatsiyasi buzuq qiymat bersa —
    // markerni qo'ymaymiz, aks holda keyingi qadam yiqiladi.
    if (la === null || ln === null) return;
    _pickedCoords = { lat: la, lng: ln };
    if (_mapMarker) _mapMarker.setLatLng([la, ln]);
    else if (window.L) _mapMarker = L.marker([la, ln]).addTo(_mapObj);
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
    if (!validCoords(_pickedCoords)) return toast("Xaritada nuqtani belgilang");
    openAddrNameModal();
  }

  /** Koordinatadan HAQIQIY manzil matni (ko'cha, uy, tuman, shahar).
   *
   *  NEGA KERAK: ilgari manzil sifatida faqat «📍 41.31111, 69.27970»
   *  saqlanardi. Kuryer bunday yozuvdan hech narsa tushunmaydi va
   *  mijozga qo'ng'iroq qilishga majbur bo'ladi. Endi OpenStreetMap
   *  (Nominatim, kalitsiz va bepul) orqali ko'cha nomi topiladi.
   *
   *  Xizmat yiqilsa yoki sekin bo'lsa — hech narsa buzilmaydi:
   *  koordinata matni zaxira bo'lib qoladi (shu sababli `try/catch` va
   *  6 soniyalik chek). */
  async function reverseGeocode(lat, lng) {
    try {
      const ctl = typeof AbortController !== "undefined" ? new AbortController() : null;
      const timer = setTimeout(() => {
        try {
          if (ctl) ctl.abort();
        } catch (_) {}
      }, 6000);
      const url =
        "https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=18&addressdetails=1" +
        "&accept-language=uz&lat=" +
        encodeURIComponent(lat) +
        "&lon=" +
        encodeURIComponent(lng);
      const res = await fetch(url, {
        signal: ctl ? ctl.signal : undefined,
        headers: { Accept: "application/json" },
      });
      clearTimeout(timer);
      if (!res.ok) return "";
      const d = await res.json();
      const a = d.address || {};
      const street = a.road || a.pedestrian || a.residential || a.neighbourhood || "";
      const parts = [
        street + (a.house_number ? " " + a.house_number : ""),
        a.suburb || a.city_district || a.district || "",
        a.city || a.town || a.village || a.county || "",
      ]
        .map((s) => String(s).trim())
        .filter(Boolean);
      // Takrorlanishni olib tashlaymiz («Chilonzor, Chilonzor» bo'lmasin)
      const uniq = parts.filter((s, i) => parts.indexOf(s) === i);
      if (uniq.length) return uniq.join(", ");
      return String(d.display_name || "").split(",").slice(0, 4).join(",").trim();
    } catch (_) {
      return "";
    }
  }

  /** Topilgan manzilni oynada ko'rsatadi (kutish belgisi bilan). */
  async function resolvePickedAddress() {
    const found = $("addr-name-found");
    if (!found || !validCoords(_pickedCoords)) return;
    const want = _pickedCoords;
    _pickedAddrText = "";
    found.classList.remove("hidden");
    found.innerHTML = '<span class="addr-found-wait">🔎 Manzil aniqlanmoqda…</span>';

    const txt = await reverseGeocode(want.lat, want.lng);
    // Mijoz shu orada boshqa nuqtani tanlagan bo'lishi mumkin — eski
    // javobni yozib qo'ymaymiz.
    if (_pickedCoords !== want) return;
    if (txt) {
      _pickedAddrText = txt;
      found.innerHTML = "📌 " + esc(txt);
    } else {
      found.innerHTML = '<span class="addr-found-wait">Ko\'cha nomi topilmadi — koordinata saqlanadi</span>';
    }
  }

  // Manzilga nom berish modali
  function openAddrNameModal() {
    const ov = $("addr-name-overlay");
    if (!validCoords(_pickedCoords)) return toast("Xaritada nuqtani belgilang");
    const coords = $("addr-name-coords");
    if (coords) {
      coords.textContent = "📍 " + _pickedCoords.lat.toFixed(5) + ", " + _pickedCoords.lng.toFixed(5);
    }
    $("addr-name-input").value = "";
    const noteIn = $("addr-note-input");
    if (noteIn) noteIn.value = "";
    const found = $("addr-name-found");
    if (found) {
      found.classList.add("hidden");
      found.innerHTML = "";
    }
    ov.querySelectorAll(".addr-chip").forEach((c) => c.classList.remove("sel"));
    _pickedType = "map";

    ov.classList.remove("hidden");
    requestAnimationFrame(() => ov.classList.add("show"));
    setTimeout(() => $("addr-name-input").focus(), 320);

    // Ko'cha nomini fonda topamiz — mijoz nom yozayotgan paytda tayyor bo'ladi
    resolvePickedAddress();

    // Chip tanlash
    ov.querySelectorAll(".addr-chip").forEach((chip) => {
      chip.onclick = () => {
        ov.querySelectorAll(".addr-chip").forEach((c) => c.classList.remove("sel"));
        chip.classList.add("sel");
        $("addr-name-input").value = chip.dataset.label;
        _pickedType = chip.dataset.type || "map";
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
    if (!validCoords(_pickedCoords)) return toast("Xaritada nuqtani belgilang");
    const name = ($("addr-name-input").value || "").trim();
    if (!name) { toast("Manzilga nom kiriting"); $("addr-name-input").focus(); return; }

    const lat = _pickedCoords.lat, lng = _pickedCoords.lng;
    const mapLink = "https://www.google.com/maps?q=" + lat.toFixed(6) + "," + lng.toFixed(6);
    // Ko'cha nomi topilgan bo'lsa — u ishlatiladi (kuryer uchun tushunarli),
    // topilmasa koordinata zaxira bo'lib qoladi.
    const addrText = _pickedAddrText || "📍 " + lat.toFixed(5) + ", " + lng.toFixed(5);
    const noteIn = $("addr-note-input");
    const note = noteIn ? (noteIn.value || "").trim() : "";

    const arr = getAddresses();
    arr.push({
      type: _pickedType || "map",
      label: name,
      address: addrText,
      mapLink: mapLink,
      lat: lat,
      lng: lng,
      note: note,
      // Birinchi manzil o'zi «asosiy» bo'ladi — mijoz alohida bosmasin
      def: arr.length === 0,
      at: Date.now(),
    });
    saveAddresses(arr);

    toast("✅ Manzil saqlandi: " + name);
    haptic("success");
    closeAddrNameModal();
    closeMapPicker();
    renderAddrHint();

    if (_mapCtx === "addresses") {
      // Kabinetdagi menejerdan qo'shildi — checkout tanloviga tegmaymiz
      renderAddressPage();
      return;
    }
    // Rasmiylashtirish oynasidan qo'shildi — yangi manzil darhol tanlanadi
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
      const imgEl = el("img", "pm-shot", "");
      imgEl.src = src;
      imgEl.alt = product.name || "";
      imgEl.loading = i === 0 ? "eager" : "lazy";
      // Yuklanmagan rasm o'rnida bo'shliq turmasin — silliq paydo bo'ladi
      imgEl.onload = () => imgEl.classList.add("ready");
      if (imgEl.complete && imgEl.naturalWidth) imgEl.classList.add("ready");
      // Rasmni bosish -> to'liq ekranli ko'ruvchi (kattalashtirish)
      imgEl.onclick = () => openViewer(images, i);
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
    
    /* XUSUSIYATLAR JADVALI
       Ilgari bu blok FAQAT `product.specs` ni o'qirdi, lekin bunday maydonni
       hech kim yaratmaydi (na admin formasi, na Firebase, na API) — ya'ni
       jadval HAR DOIM BO'SH turardi. Endi haqiqiy maydonlardan yig'iladi;
       `specs` bo'lsa u ham qo'shiladi (kelajakda kerak bo'lsa). */
    const specs = $("pm-specs");
    specs.innerHTML = "";
    const rows = [];
    if (product.warranty) rows.push(["🛡 Kafolat", product.warranty]);
    if (product.code) rows.push(["🔖 Artikul", product.code]);
    if (product._cat) rows.push(["🗂 Turkum", product._cat]);
    if (product.car_name) rows.push(["🚗 Mashina", product.car_name]);
    if (product.specs && typeof product.specs === "object") {
      Object.entries(product.specs).forEach(([key, val]) => {
        if (val) rows.push([key, val]);
      });
    }
    rows.forEach(([key, val]) => {
      const row = el("div", "pm-spec-row");
      row.innerHTML =
        `<span class="pm-spec-label">${esc(key)}</span>` +
        `<span class="pm-spec-value">${esc(val)}</span>`;
      specs.appendChild(row);
    });
    
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
    
    // «Kattalashtirish» tugmasi faqat rasm bo'lganda ko'rinadi
    const zoomBtn = $("pm-zoom");
    if (zoomBtn) zoomBtn.classList.toggle("hidden", !images.length);

    /* Rasm almashinuvini brauzerning O'ZI hal qiladi (`scroll-snap`), biz
       faqat nuqtalarni kuzatamiz.

       ILGARI bu yerda `setupTouchGestures(slider)` ham chaqirilardi va u
       har `touchend` da `scrollToImage()` ni majburan chaqirardi. Natijada
       ikki mexanizm bir-biriga qarshi ishlab, tez surganda rasm sakrab
       ketardi. Bundan tashqari o'sha tinglovchilar HAR ochilishda qayta
       qo'shilardi va yopilganda OLIB TASHLANMASDI — modal 10 marta
       ochilsa, bitta surish 10 marta ishlov berardi. */
    slider.removeEventListener("scroll", handleModalScroll);
    slider.addEventListener("scroll", handleModalScroll, { passive: true });
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

  /* ==================================================================
     RASM KO'RUVCHI — to'liq ekran, kattalashtirish va surish

     NEGA YOZILDI
     Mahsulot rasmini kattalashtirib ko'rish imkoni UMUMAN yo'q edi:
     galereyadagi rasmda bosish ishlovchisi yo'q, brauzerning o'z
     kattalashtirishi esa `index.html` dagi `user-scalable=no` bilan
     o'chirilgan. Ustiga galereya rasmni OQ kvadratda `object-fit: cover`
     bilan QIRQIB ko'rsatardi — ya'ni kartochkada butun tovar ko'rinib,
     "kattalashtirganda" chetlari kesilardi.

     ISHORALAR
       * bir marta bosish (fon)      -> yopadi
       * ikki marta bosish (rasm)    -> 2.6× kattalashtiradi / qaytaradi
       * ikki barmoq (chimchilash)   -> 1× dan 4× gacha
       * kattalashtirilgan holda surish -> rasmni ko'chiradi (chegarada to'xtaydi)
       * chapga/o'ngga surish        -> keyingi / oldingi rasm
       * pastga surish               -> yopadi (fon xiralashib boradi)

     Faqat `transform` va `opacity` o'zgaradi — kompozitor ishi, telefon
     qizimaydi (styles.css boshidagi qoidaga muvofiq).
     ================================================================== */

  const IV_MAX = 4; // eng katta kattalashtirish
  const IV = {
    images: [],
    index: 0,
    scale: 1,
    x: 0,
    y: 0,
    pinch: 0, // chimchilash boshidagi masofa
    startScale: 1,
    dragging: false,
    sx: 0,
    sy: 0,
    ox: 0,
    oy: 0,
    lastTap: 0,
    bound: false,
  };

  const viewerOpen = () => {
    const b = $("imgViewer");
    return !!b && !b.classList.contains("hidden");
  };

  function openViewer(images, index) {
    const list = (images || []).filter(Boolean);
    if (!list.length) return;
    IV.images = list;
    IV.index = Math.min(Math.max(Number(index) || 0, 0), list.length - 1);
    bindViewer();
    ivPaint();
    const box = $("imgViewer");
    box.classList.remove("hidden", "closing");
    document.body.style.overflow = "hidden";
    haptic("light");
  }

  function closeViewer() {
    const box = $("imgViewer");
    if (!box || box.classList.contains("hidden")) return;
    box.classList.add("closing");
    box.style.opacity = "";
    setTimeout(() => {
      box.classList.add("hidden");
      box.classList.remove("closing", "zoomed");
    }, 200);
    /* Modal hali ochiq bo'lsa sahifa qulfini SAQLAB qolamiz — aks holda
       ko'ruvchi yopilgach modal orqasidagi sahifa surila boshlardi. */
    const pm = $("productModal");
    if (!pm || pm.classList.contains("hidden")) document.body.style.overflow = "";
    haptic("light");
  }

  function ivReset() {
    IV.scale = 1;
    IV.x = 0;
    IV.y = 0;
  }

  function ivApply(smooth) {
    const im = $("iv-img");
    if (!im) return;
    im.style.transition = smooth ? "transform 0.26s var(--silk)" : "none";
    im.style.transform =
      "translate(" + Math.round(IV.x) + "px," + Math.round(IV.y) + "px) scale(" + IV.scale + ")";
    const box = $("imgViewer");
    if (box) box.classList.toggle("zoomed", IV.scale > 1.02);
  }

  /** Kattalashtirilgan rasm chegaradan chiqib ketmasin. */
  function ivClamp(smooth) {
    const stage = $("iv-stage");
    const im = $("iv-img");
    if (!stage || !im) return;
    const maxX = Math.max(0, (im.clientWidth * IV.scale - stage.clientWidth) / 2);
    const maxY = Math.max(0, (im.clientHeight * IV.scale - stage.clientHeight) / 2);
    IV.x = Math.min(maxX, Math.max(-maxX, IV.x));
    IV.y = Math.min(maxY, Math.max(-maxY, IV.y));
    ivApply(smooth !== false);
  }

  function ivPaint() {
    const im = $("iv-img");
    if (!im) return;
    im.classList.remove("ready");
    im.src = IV.images[IV.index];
    im.onload = () => im.classList.add("ready");
    if (im.complete && im.naturalWidth) im.classList.add("ready");

    const c = $("iv-count");
    if (c) c.textContent = IV.images.length > 1 ? IV.index + 1 + " / " + IV.images.length : "";

    const hint = $("iv-hint");
    if (hint) {
      hint.textContent =
        IV.images.length > 1
          ? "Ikki marta bosing yoki chimchilang · yon tomonga surib almashtiring"
          : "Ikki marta bosing yoki chimchilab kattalashtiring";
    }

    // Kichik rasmlar tasmasi — bir bosishda kerakli rasmga o'tadi
    const th = $("iv-thumbs");
    if (th) {
      th.innerHTML =
        IV.images.length > 1
          ? IV.images
              .map(
                (src, i) =>
                  '<button class="iv-th' +
                  (i === IV.index ? " on" : "") +
                  '" data-i="' +
                  i +
                  '"><img src="' +
                  esc(src) +
                  '" alt="" loading="lazy"></button>'
              )
              .join("")
          : "";
      th.querySelectorAll(".iv-th").forEach((b) => {
        b.onclick = () => ivGo(Number(b.dataset.i));
      });
    }

    ivReset();
    ivApply(false);
  }

  function ivGo(i) {
    if (i < 0 || i >= IV.images.length || i === IV.index) return;
    IV.index = i;
    haptic("selection");
    ivPaint();
  }

  /** Ishoralar bir MARTA bog'lanadi (modal xatosi qaytarilmasin). */
  function bindViewer() {
    if (IV.bound) return;
    IV.bound = true;

    const stage = $("iv-stage");
    if (!stage) return;
    const closeBtn = $("iv-close");
    if (closeBtn) closeBtn.onclick = closeViewer;

    const gap = (t) => {
      const dx = t[0].clientX - t[1].clientX;
      const dy = t[0].clientY - t[1].clientY;
      return Math.sqrt(dx * dx + dy * dy);
    };

    stage.addEventListener(
      "touchstart",
      (e) => {
        if (e.touches.length === 2) {
          IV.pinch = gap(e.touches);
          IV.startScale = IV.scale;
          IV.dragging = false;
          return;
        }
        const t = e.touches[0];
        IV.dragging = true;
        IV.sx = t.clientX;
        IV.sy = t.clientY;
        IV.ox = IV.x;
        IV.oy = IV.y;
      },
      { passive: true }
    );

    stage.addEventListener(
      "touchmove",
      (e) => {
        // ---- chimchilash
        if (e.touches.length === 2 && IV.pinch) {
          const k = gap(e.touches) / IV.pinch;
          IV.scale = Math.min(IV_MAX, Math.max(1, IV.startScale * k));
          if (IV.scale <= 1) {
            IV.x = 0;
            IV.y = 0;
          }
          ivApply(false);
          return;
        }
        if (!IV.dragging || e.touches.length !== 1) return;
        const t = e.touches[0];
        const dx = t.clientX - IV.sx;
        const dy = t.clientY - IV.sy;

        if (IV.scale > 1.02) {
          // ---- kattalashtirilgan: rasmni surish
          IV.x = IV.ox + dx;
          IV.y = IV.oy + dy;
          ivApply(false);
        } else if (dy > 0 && Math.abs(dy) > Math.abs(dx)) {
          // ---- pastga surish: yopishga tayyorlanadi, fon xiralashadi
          IV.y = dy;
          ivApply(false);
          const box = $("imgViewer");
          if (box) box.style.opacity = String(Math.max(0.25, 1 - dy / 420));
        }
      },
      { passive: true }
    );

    stage.addEventListener(
      "touchend",
      (e) => {
        const box = $("imgViewer");

        if (IV.pinch) {
          if (e.touches.length === 0) {
            IV.pinch = 0;
            if (IV.scale < 1.05) {
              ivReset();
              ivApply(true);
            } else ivClamp(true);
          }
          return;
        }
        if (!IV.dragging) return;
        IV.dragging = false;

        if (IV.scale > 1.02) return ivClamp(true);

        if (box) box.style.opacity = "";
        // Pastga yetarlicha surildi -> yopamiz
        if (IV.y > 110) return closeViewer();

        // Yon tomonga surish -> qo'shni rasm
        const t = (e.changedTouches && e.changedTouches[0]) || null;
        const dx = t ? t.clientX - IV.sx : 0;
        if (Math.abs(dx) > 60 && Math.abs(dx) > IV.y) {
          ivReset();
          ivApply(false);
          return ivGo(IV.index + (dx < 0 ? 1 : -1));
        }
        ivReset();
        ivApply(true);
      },
      { passive: true }
    );

    /* Bosish: rasmda IKKI MARTA -> kattalashtirish; fonda bir marta -> yopish. */
    stage.addEventListener("click", (e) => {
      const onImg = !!(e.target && e.target.id === "iv-img");
      const now = Date.now();
      if (onImg && now - IV.lastTap < 320) {
        IV.lastTap = 0;
        if (IV.scale > 1.02) ivReset();
        else IV.scale = 2.6;
        ivApply(true);
        haptic("light");
        return;
      }
      IV.lastTap = onImg ? now : 0;
      if (!onImg && IV.scale <= 1.02) closeViewer();
    });
  }

  /** Tovar oynasini yopadi.
   *  @param {boolean} skipAnim — surib yopilganda `true`: harakat
   *     ALLAQACHON qilingan, ustiga `modalSlideDown` qo'yilsa oyna
   *     sakrab ketadi. */
  function closeProductModal(skipAnim) {
    const modal = $("productModal");
    if (!modal) return;

    // Rasm ko'ruvchi ochiq bo'lsa u ham yopiladi (ostida qolib ketmasin)
    if (viewerOpen()) closeViewer();

    const finish = () => {
      modal.classList.add("hidden");
      modal.style.animation = "";
      // Surish qoldirgan uslublarni HAM tozalaymiz — aks holda keyingi
      // ochilishda oyna yarim surilgan holatda paydo bo'lardi.
      modal.style.transform = "";
      modal.style.opacity = "";
      modal.style.transition = "";
      document.body.style.overflow = "";
    };

    if (skipAnim) {
      finish();
    } else {
      modal.style.animation = "modalSlideDown 0.25s cubic-bezier(0.4, 0, 1, 1)";
      setTimeout(finish, 250);
    }

    currentProduct = null;
    const slider = $("pm-slider");
    if (slider) slider.removeEventListener("scroll", handleModalScroll);

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
    
    addToCart(currentProduct, modalQuantity, $("pm-add-cart"));
    
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
        S.payMethod = null;
        S.coStep = 1; // rasmiylashtirish oynasi keyingi safar 1-qadamdan
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
        /* Worker `problems` qaytaradi — SABABNI aniq aytamiz va savatni
           tuzatamiz. Ilgari hamma holat uchun «Yetarli emas» yozilardi,
           hatto tovar katalogdan o'chirilgan bo'lsa ham — mijoz savatni
           behuda yangilab o'tirardi. */
        if (err && err.problems && err.problems.length) {
          const gone = err.problems.filter((p) => /topilmadi/i.test(p.reason || ""));
          const short = err.problems.filter((p) => !/topilmadi/i.test(p.reason || ""));
          // Katalogda yo'q tovarlarni savatdan olib tashlaymiz
          if (gone.length) {
            const ids = new Set(gone.map((p) => String(p.product_id)));
            S.cart = S.cart.filter((i) => !ids.has(String(i.id)));
            saveCart();
            renderCart();
          }
          const label = (list) => list.map((p) => p.name || "#" + p.product_id).join(", ");
          if (gone.length && short.length) {
            toast(`❌ Sotuvda yo'q: ${label(gone)} · Qoldiq yetmadi: ${label(short)}`, 6000);
          } else if (gone.length) {
            toast(`❌ Sotuvda yo'q — savatdan olib tashladim: ${label(gone)}`, 6000);
          } else {
            toast(`❌ Qoldiq yetarli emas: ${label(short)}`, 5000);
          }
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
    /* DIQQAT: o'ram funksiya SHART. `onclick = closeProductModal` deb
       yozilsa brauzer birinchi argument sifatida Event obyektini uzatadi
       va u `skipAnim` bo'lib qoladi (Event doim truthy) — natijada yopilish
       animatsiyasi ishlamay, oyna birdan g'oyib bo'lardi. */
    $("pm-close").onclick = () => closeProductModal();
    $("pm-wishlist").onclick = toggleModalWishlist;
    $("pm-qty-minus").onclick = () => updateModalQuantity(-1);
    $("pm-qty-plus").onclick = () => updateModalQuantity(1);
    $("pm-add-cart").onclick = addFromModal;

    // «⤢ Kattalashtirish» — joriy rasmni to'liq ekranda ochadi
    const zoomBtn = $("pm-zoom");
    if (zoomBtn)
      zoomBtn.onclick = (e) => {
        e.stopPropagation();
        if (!currentProduct) return;
        openViewer(productImages(currentProduct), currentImageIndex);
      };

    // Tashqariga bosib yopish
    $("productModal").onclick = (e) => {
      if (e.target.id === "productModal") closeProductModal();
    };

    // ESC: avval rasm ko'ruvchi, keyin modal yopiladi
    document.addEventListener("keydown", (e) => {
      if (e.key !== "Escape") return;
      if (viewerOpen()) return closeViewer();
      if (currentProduct) closeProductModal();
    });

    bindModalDrag();
  }

  /* ====================================================================
     TOVAR OYNASINI PASTGA SURIB YOPISH

     Ilovada uchta to'liq ekranli qatlam bor: rasm ko'ruvchi, story va
     tovar oynasi. Birinchi ikkitasini SURIB yopish mumkin edi, tovar
     oynasini — YO'Q (faqat «✕»). Bir ilovada ikki xil xatti-harakat:
     mijoz qo'li o'rgangan harakatni qiladi, hech narsa bo'lmaydi.

     Tovar oynasi eng ko'p ochiladigan qatlam, shuning uchun bir xillik
     aynan shu yerda muhim.

     DIQQAT: sur faqat oyna TEPASIDAN boshlansa ishlaydi. Aks holda
     tovar tavsifini varaqlash (vertikal scroll) yopish deb tushunilardi.
     ==================================================================== */
  function bindModalDrag() {
    const modal = $("productModal");
    if (!modal || modal.dataset.dragBound === "1") return;
    modal.dataset.dragBound = "1";

    let startY = 0;
    let dy = 0;
    let dragging = false;

    const CLOSE_AT = 110; // shu masofadan keyin qo'yib yuborilsa yopiladi

    modal.addEventListener(
      "touchstart",
      (e) => {
        // Rasm ko'ruvchi ochiq bo'lsa u o'z harakatini boshqaradi
        if (viewerOpen()) return;
        if (!e.touches || e.touches.length !== 1) return;
        // Faqat tepadan: pastda kontent varaqlanadi
        if (modal.scrollTop > 4) return;
        startY = e.touches[0].clientY;
        dy = 0;
        dragging = true;
        modal.style.transition = "none";
      },
      { passive: true }
    );

    modal.addEventListener(
      "touchmove",
      (e) => {
        if (!dragging || !e.touches || !e.touches.length) return;
        dy = e.touches[0].clientY - startY;
        if (dy <= 0) return; // faqat pastga
        // Rezina effekti: masofa oshgani sari sekinlashadi
        const shift = Math.pow(dy, 0.85);
        modal.style.transform = `translateY(${shift}px)`;
        modal.style.opacity = String(Math.max(0.4, 1 - dy / 600));
      },
      { passive: true }
    );

    const release = () => {
      if (!dragging) return;
      dragging = false;
      modal.style.transition = "transform 0.22s var(--silk), opacity 0.22s var(--silk)";

      if (dy > CLOSE_AT) {
        haptic("light");
        // Yopilgandan keyin uslublarni tozalaymiz — aks holda keyingi
        // ochilishda oyna surilgan holatda paydo bo'lardi.
        modal.style.transform = "translateY(100%)";
        modal.style.opacity = "0";
        // `skipAnim = true` — harakat allaqachon qilindi
        setTimeout(() => closeProductModal(true), 200);
        return;
      }

      // Yetarli surilmadi — joyiga qaytadi
      modal.style.transform = "";
      modal.style.opacity = "";
      setTimeout(() => {
        modal.style.transition = "";
      }, 240);
    };

    modal.addEventListener("touchend", release, { passive: true });
    modal.addEventListener("touchcancel", release, { passive: true });
  }

  // Yordamchi funksiya: saqlanganlarni localStorage ga yozish
  function saveFavorites() {
    try {
      localStorage.setItem(userKey(FAV_KEY), JSON.stringify([...S.favorites]));
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
