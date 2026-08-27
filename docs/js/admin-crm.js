/* ==========================================================================
   ZIMMER — MIJOZLAR BAZASI VA STATISTIKA (Avto_A1 modeli)

   NEGA BU FAYL BOR
   Admin panelda tovar va buyurtmalar bor edi, lekin MIJOZ tushunchasi yo'q edi.
   Admin «kim eng ko'p sotib olgan?», «bu odam ilgari xarid qilganmi?», «bu oy
   qancha tushdi?» degan savollarga javob topolmasdi — buyurtmalarni qo'lda
   varaqlashdan boshqa yo'l yo'q edi. Avto_A1 da bu ikki oyna (Mijozlar Ro'yxati
   va Statistika) eng ko'p ishlatiladigan bo'limlar.

   Avto_A1 BILAN NIMA BIR XIL
     • mijoz kartochkasi: ism, ID, telefon, sarflagan summa (gold), xarid soni;
     • saralash: eng ko'p sarflagan yuqorida;
     • qidiruv: ism / ID / telefon bo'yicha;
     • 20 talik ro'yxat, pastga tushganda o'zi yuklanadi;
     • VIP: 5+ yakunlangan xarid YOKI 1 000 000 so'm+ sarflagan;
     • statistika: bugungi savdo, jami mijozlar, umumiy tushum (raqamlar noldan
       yuqoriga sanaladi), o'rtacha chek, jami sotuvlar, qaytgan mijozlar,
       xit savdolar Top 5 (medal bilan) va davr grafigi (kunlik/haftalik/oylik).

   ZIMMER UCHUN NIMA BOSHQA (va NEGA)
     1. Avto_A1 da buyurtmalar mijozning ichida: `users/{uid}/orders`. Zimmer'da
        esa buyurtma UCH XIL va alohida tugunlarda: do'kon buyurtmasi, Bi-LED
        buyurtmasi va navbat. Ular mijozga `uid` maydoni orqali bog'lanadi.
        Shuning uchun ro'yxat va statistika uchta manbani BIRLASHTIRADI —
        aks holda Bi-LED va navbat hisobotga tushmay qolardi.
     2. «Yakunlangan» holat turga qarab boshqa: do'konda `delivered`, Bi-LED va
        navbatda `done`. Tushum FAQAT yakunlanganlardan yig'iladi (Avto_A1 da
        `yetkazildi` bilan bir xil mantiq).
     3. Avto_A1 da «Hududlar bo'yicha» hisobot bor (profil manzili). Zimmer far
        do'koni bo'lgani uchun uning o'rnida «Mashinalar bo'yicha» — Bi-LED
        buyurtmasidagi rusum va mijoz profilidagi mashina.
     4. Grafik Chart.js da EMAS. Sabab: styles.css boshidagi qoida — telefon
        qizmasligi kerak, tashqi CDN kutib turish esa panelni sekinlashtiradi.
        Grafik oddiy DIV ustunlar (balandligi foizda) — GPU uchun bepul.

   MA'LUMOT QAYERDAN
     • mijoz profillari — `zimmer/users/{uid}/profile` (database.rules.json da
       o'qishga ochiq, shuning uchun brauzerdan to'g'ridan o'qiladi);
     • buyurtmalar — `ZimmerShop.loadKind()`. O'z nusxasini YOZMAYMIZ: holat
       nomi yoki tugun o'zgarsa hisobot jimgina yolg'on raqam ko'rsatardi.
   ========================================================================== */

window.ZimmerCRM = (function () {
  "use strict";

  const app = () => window.ZIMMER_APP || {};
  const fb = () => window.ZimmerFB;
  const shop = () => window.ZimmerShop || {};
  const $ = (id) => document.getElementById(id);

  const esc = (v) => (app().esc ? app().esc(v) : String(v == null ? "" : v));
  const toast = (m, ms) => (app().toast ? app().toast(m, ms) : void 0);
  const haptic = (k) => (app().haptic ? app().haptic(k) : void 0);

  /* ------------------------------------------------------------ o'lchamlar */

  /** VIP chegarasi — Avto_A1 dagi bilan AYNAN bir xil. */
  const VIP_ORDERS = 5;
  const VIP_SPENT = 1000000;
  /** Bir «sahifa» — Avto_A1 dagi kabi 20 ta. */
  const PAGE = 20;

  /** Turga qarab «yakunlangan» holat nomi. Tushum faqat shulardan yig'iladi. */
  const DONE = { order: "delivered", biled: "done", booking: "done" };

  /** Bo'lim nomlari (statistika kesimida va mijoz tafsilotida ishlatiladi). */
  const KIND_LABEL = {
    order: { icon: "🛍", title: "Do'kon buyurtmalari" },
    biled: { icon: "🔥", title: "Bi-LED buyurtmalari" },
    booking: { icon: "🗓", title: "Navbatlar" },
  };

  const MONTHS = ["Yan", "Fev", "Mar", "Apr", "May", "Iyun", "Iyul", "Avg", "Sen", "Okt", "Noy", "Dek"];
  const MEDALS = ["🥇", "🥈", "🥉", "4️⃣", "5️⃣"];

  /* --------------------------------------------------------------- holat */
  const S = {
    view: null, // null | customers | customer | stats
    data: null, // {customers, orders, usersFailed}
    query: "", // qidiruv matni
    filter: "all", // all | vip | buyer | run | cold
    sort: "spent", // spent | orders | recent
    limit: PAGE, // ko'rinadigan mijozlar soni
    uid: null, // ochilgan mijoz
    chart: "daily", // daily | weekly | monthly
    io: null, // IntersectionObserver (cheksiz skroll)
    typing: null, // qidiruv debounce taymeri
  };

  /* ------------------------------------------------------------ yordamchi */

  const body = () => $("admin-body");

  function setHead(title, sub) {
    if (shop().setHead) return shop().setHead(title, sub);
    if ($("admin-title")) $("admin-title").textContent = title;
    if ($("admin-sub")) $("admin-sub").textContent = sub || "";
  }

  /** "1 250 000" — utils/helpers.py: fmt_price bilan bir xil (oddiy bo'shliq). */
  function num(v) {
    return String(Math.round(Number(v) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  }
  /** "1 250 000 so'm" — ZimmerShop bilan bitta manbadan. */
  const money = (v) => (shop().money ? shop().money(v) : num(v) + " so'm");
  const timeLabel = (ms) => (shop().timeLabel ? shop().timeLabel(ms) : "");

  const reduced = () =>
    !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);

  function loading(text) {
    body().innerHTML = '<div class="adm-loading">' + esc(text || "Yuklanmoqda...") + "</div>";
  }

  /** Xato oynasi — ZimmerShop dagi bilan bir xil ko'rinish va maslahatlar. */
  function fail(err, retry) {
    const code = (err && err.code) || "";
    const msg = (err && err.message) || "Xatolik yuz berdi";
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
      '<button class="btn btn-ghost btn-sm" id="crm-retry">Qayta urinish</button></div>';
    if ($("crm-retry")) $("crm-retry").onclick = retry;
  }

  /** Raqam noldan yuqoriga sanaladi (Avto_A1: animateValue). */
  function countUp(id, end, suffix) {
    const node = $(id);
    if (!node) return;
    const target = Math.round(Number(end) || 0);
    const tail = suffix || "";
    if (reduced() || target <= 0) {
      node.textContent = num(target) + tail;
      return;
    }
    const dur = 900;
    let t0 = null;
    function step(ts) {
      if (t0 === null) t0 = ts;
      const p = Math.min((ts - t0) / dur, 1);
      const eased = 1 - Math.pow(1 - p, 3); // sekinlashib to'xtaydi
      node.textContent = num(Math.round(eased * target)) + tail;
      if (p < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }

  /* --------------------------------------------------------- sana kalitlari */

  const two = (n) => (n < 10 ? "0" + n : String(n));
  const dayKey = (d) => d.getFullYear() + "-" + two(d.getMonth() + 1) + "-" + two(d.getDate());
  const monthKey = (d) => d.getFullYear() + "-" + two(d.getMonth() + 1);
  const dayLabel = (d) => two(d.getDate()) + "." + two(d.getMonth() + 1);

  /** Haftaning DUSHANBASI (hafta kesimi uchun barqaror kalit). */
  function weekStart(d) {
    const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
    return x;
  }

  /** Bo'sh «savatlar»: 14 kun, 8 hafta, 12 oy.
   *  Oldindan yasaladi — shunda savdo bo'lmagan kun grafikda BO'SHLIQ emas,
   *  nol ustun bo'lib turadi va o'sish/pasayish ko'zga tashlanadi. */
  function emptySeries() {
    const now = new Date();
    const out = { daily: [], weekly: [], monthly: [] };
    /* `label` — ustun ostidagi QISQA yozuv (14 ta ustun telefon ekraniga
       sig'ishi kerak), `full` — ustunga bosilganda yuqorida ko'rinadigan
       to'liq nom. Ilgari ikkisi bitta bo'lganda sanalar bir-birining ustiga
       chiqib ketardi. */
    for (let i = 13; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
      out.daily.push({ key: dayKey(d), label: String(d.getDate()), full: dayLabel(d), value: 0 });
    }
    const ws = weekStart(now);
    for (let i = 7; i >= 0; i--) {
      const d = new Date(ws.getFullYear(), ws.getMonth(), ws.getDate() - i * 7);
      out.weekly.push({
        key: dayKey(d),
        label: dayLabel(d),
        full: dayLabel(d) + " haftasi",
        value: 0,
      });
    }
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      out.monthly.push({
        key: monthKey(d),
        label: MONTHS[d.getMonth()],
        full: MONTHS[d.getMonth()] + " " + d.getFullYear(),
        value: 0,
      });
    }
    return out;
  }

  const byKey = (list) => {
    const m = {};
    list.forEach((b) => (m[b.key] = b));
    return m;
  };

  /* ====================================================================
     MA'LUMOT O'QISH

     Uch bo'lim (Mijozlar / Statistika / mijoz tafsiloti) bitta o'qishdan
     foydalanadi. Avto_A1 da ham shunday: `_getUsersSnap` 20 soniyalik kesh
     bilan — admin bo'limlar orasida yurganda butun baza qayta o'qilmaydi.
     ==================================================================== */

  let CACHE = null;
  const TTL = 20000;

  function invalidate() {
    CACHE = null;
  }

  async function loadData(force) {
    if (!force && CACHE && Date.now() - CACHE.at < TTL) return CACHE.data;
    if (!fb() || !fb().available()) throw { code: "no_db", message: "Baza sozlanmagan" };

    const load = (kind) => {
      if (!shop().loadKind) return Promise.resolve([]);
      return Promise.resolve(shop().loadKind(kind)).catch((err) => {
        console.warn("[crm] " + kind + " o'qilmadi:", err);
        return [];
      });
    };

    /* Profillar o'qilmasa ham to'xtamaymiz: buyurtmaning o'zida ism va
       telefon bor, ya'ni ro'yxat XARIDORLAR bo'yicha ishlaydi. Faqat hech
       buyurtma bermagan ro'yxatdan o'tganlar ko'rinmaydi — buni pastda
       ogohlantirish bilan aytamiz. */
    let usersFailed = null;
    const usersP = fb()
      .get("users")
      .catch((err) => {
        usersFailed = err;
        return null;
      });

    const [usersNode, ord, biled, book] = await Promise.all([
      usersP,
      load("order"),
      load("biled"),
      load("booking"),
    ]);

    const orders = [].concat(ord || [], biled || [], book || []);
    orders.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));

    if (!usersNode && !orders.length && usersFailed) throw usersFailed;

    const data = {
      customers: buildCustomers(usersNode, orders),
      orders: orders,
      usersFailed: usersFailed,
    };
    CACHE = { at: Date.now(), data: data };
    return data;
  }

  /** Buyurtma tafsilotidagi qatorni belgisi bo'yicha topadi ("🚗" -> mashina). */
  function lineOf(order, icon) {
    const rows = order.lines || [];
    for (let i = 0; i < rows.length; i++) {
      if (rows[i] && rows[i][0] === icon && rows[i][1]) return String(rows[i][1]).trim();
    }
    return "";
  }

  /* ====================================================================
     MIJOZLARNI YASASH

     Ikki manba birlashtiriladi:
       1) `users/{uid}/profile` — ro'yxatdan o'tgan hamma (xarid qilmagan ham);
       2) buyurtmalar — `uid` bo'yicha. Profil o'qilmagan yoki mijoz bazadan
          o'chib ketgan bo'lsa ham buyurtma egasi ro'yxatda qoladi.
     ==================================================================== */
  function buildCustomers(usersNode, orders) {
    const map = {};

    const touch = (uid) => {
      const k = String(uid);
      if (!map[k]) {
        map[k] = {
          uid: k,
          name: "",
          phone: "",
          username: "",
          car: "",
          registered: false, // profili bormi (ya'ni ilovada ro'yxatdan o'tgan)
          orders: 0, // jami yozuv (uch bo'lim birga)
          done: 0, // yakunlangan
          active: 0, // jarayonda
          cancelled: 0,
          spent: 0, // FAQAT yakunlanganlar summasi
          last: 0, // oxirgi buyurtma vaqti
          first: 0, // birinchi buyurtma vaqti
          kinds: { order: 0, biled: 0, booking: 0 },
        };
      }
      return map[k];
    };

    // ---- 1) profillar
    if (usersNode && typeof usersNode === "object") {
      Object.keys(usersNode).forEach((key) => {
        const raw = usersNode[key];
        if (!raw || typeof raw !== "object") return;
        /* services/sync.py `users/{uid}/profile` yozadi, lekin eski yozuvlarda
           maydonlar to'g'ridan tugunda turishi mumkin (sync.fetch_user ham
           ikkisini qabul qiladi) — shuning uchun ikki holat ham qo'llanadi. */
        const p = raw.profile && typeof raw.profile === "object" ? raw.profile : raw;
        const c = touch(p.uid != null ? p.uid : key);
        c.registered = true;
        c.name = String(p.name || "").trim();
        c.phone = String(p.phone || "").trim();
        c.username = String(p.username || "").replace(/^@+/, "").trim();
        c.car = String(p.carName || "").trim();
      });
    }

    // ---- 2) buyurtmalar
    orders.forEach((o) => {
      if (o.uid == null || o.uid === "") return; // egasi ko'rsatilmagan yozuv
      const c = touch(o.uid);
      // Profil bo'sh bo'lsa buyurtmadagi ma'lumot ishlatiladi.
      if (!c.name && o.name) c.name = String(o.name).trim();
      if (!c.phone && o.phone) c.phone = String(o.phone).trim();
      if (!c.car && o.kind === "biled") c.car = lineOf(o, "🚗");

      c.orders++;
      c.kinds[o.kind] = (c.kinds[o.kind] || 0) + 1;
      const at = Number(o.created_at) || 0;
      if (at > c.last) c.last = at;
      if (at && (!c.first || at < c.first)) c.first = at;

      if (o.status === "cancelled") {
        c.cancelled++;
      } else if (o.status === DONE[o.kind]) {
        c.done++;
        c.spent += Number(o.total) || 0;
      } else {
        c.active++;
      }
    });

    const arr = Object.keys(map).map((k) => {
      const c = map[k];
      if (!c.name) c.name = "Nomsiz mijoz";
      c.vip = c.done >= VIP_ORDERS || c.spent >= VIP_SPENT;
      c.avg = c.done ? Math.round(c.spent / c.done) : 0;
      return c;
    });
    return arr;
  }

  /* ====================================================================
     STATISTIKANI HISOBLASH — bitta o'tishda hammasi
     ==================================================================== */
  function blank() {
    return { total: 0, done: 0, active: 0, fresh: 0, cancelled: 0, revenue: 0 };
  }

  function buildStats(customers, orders) {
    const series = emptySeries();
    const dIdx = byKey(series.daily);
    const wIdx = byKey(series.weekly);
    const mIdx = byKey(series.monthly);

    const now = new Date();
    const todayK = dayKey(now);
    const monthK = monthKey(now);

    const st = {
      customers: customers.length,
      buyers: 0,
      returning: 0,
      vip: 0,
      registered: 0,
      revenue: 0,
      today: 0,
      month: 0,
      done: 0,
      active: 0,
      fresh: 0,
      cancelled: 0,
      total: orders.length,
      avg: 0,
      kinds: { order: blank(), biled: blank(), booking: blank() },
      series: series,
      topProducts: [],
      topCars: [],
    };

    const products = {};
    const cars = {};

    /* Mashina kesimi uchun uid -> rusum jadvali. Bi-LED buyurtmasida mashina
       buyurtmaning O'ZIDA bor (eng aniq manba), do'kon buyurtmasi va navbatda
       esa yo'q — o'shanda mijoz profilida ko'rsatgan mashina ishlatiladi. */
    const carByUid = {};
    customers.forEach((c) => {
      if (c.car) carByUid[c.uid] = c.car;
    });

    orders.forEach((o) => {
      const k = st.kinds[o.kind] || (st.kinds[o.kind] = blank());
      k.total++;

      if (o.status === "new") {
        st.fresh++;
        k.fresh++;
      }

      /* Tovar reytingi: bekor qilinganidan tashqari HAMMASI hisoblanadi —
         admin nima talab qilinayotganini ko'rishi kerak, faqat yopilgan
         savdolarni emas. Nomlar kichik harfda birlashtiriladi (bir tovar
         turli yozilishda kelishi mumkin). */
      if (o.status !== "cancelled" && o.items && o.items.length) {
        o.items.forEach((it) => {
          const name = String((it && it.name) || "").trim() || "Nomsiz tovar";
          const id = name.toLowerCase();
          if (!products[id]) products[id] = { name: name, units: 0, sum: 0 };
          const qty = Number(it.qty) || 1;
          products[id].units += qty;
          products[id].sum += (Number(it.price) || 0) * qty;
        });
      }

      if (o.status === "cancelled") {
        st.cancelled++;
        k.cancelled++;
        return;
      }
      if (o.status !== DONE[o.kind]) {
        st.active++;
        k.active++;
        return;
      }

      // ---- yakunlangan: tushum va davr kesimlari
      const sum = Number(o.total) || 0;
      st.done++;
      k.done++;
      st.revenue += sum;
      k.revenue += sum;

      const car = (o.kind === "biled" ? lineOf(o, "🚗") : "") || carByUid[String(o.uid)] || "";
      if (car) cars[car] = (cars[car] || 0) + 1;

      const at = Number(o.created_at) || 0;
      if (!at) return;
      const d = new Date(at);
      if (isNaN(d.getTime())) return;
      const dk = dayKey(d);
      if (dk === todayK) st.today += sum;
      if (monthKey(d) === monthK) st.month += sum;
      if (dIdx[dk]) dIdx[dk].value += sum;
      const wk = dayKey(weekStart(d));
      if (wIdx[wk]) wIdx[wk].value += sum;
      if (mIdx[monthKey(d)]) mIdx[monthKey(d)].value += sum;
    });

    st.avg = st.done ? Math.round(st.revenue / st.done) : 0;

    customers.forEach((c) => {
      if (c.registered) st.registered++;
      if (c.done > 0) st.buyers++;
      if (c.done > 1) st.returning++; // Avto_A1: 2+ xarid = qaytgan mijoz
      if (c.vip) st.vip++;
    });

    st.topProducts = Object.keys(products)
      .map((k) => products[k])
      .sort((a, b) => b.units - a.units || b.sum - a.sum)
      .slice(0, 5);

    st.topCars = Object.keys(cars)
      .filter((n) => cars[n] > 0)
      .map((n) => ({ name: n, units: cars[n] }))
      .sort((a, b) => b.units - a.units)
      .slice(0, 5);

    return st;
  }

  /* ====================================================================
     STATISTIKA OYNASI
     ==================================================================== */

  async function openStats(force) {
    S.view = "stats";
    S.uid = null;
    stopScroll();
    setHead("📊 Statistika", "Savdo va hisobot");
    loading("Hisob-kitob qilinmoqda...");
    let data;
    try {
      data = await loadData(force);
    } catch (err) {
      fail(err, () => openStats(true));
      return false;
    }
    S.data = data;
    renderStats(buildStats(data.customers, data.orders));
    return true;
  }

  /** Profillar o'qilmasa — «mijozlar soni» faqat xarid qilganlarni ko'rsatadi.
   *  Buni JIM qoldirmaymiz: admin raqamni to'liq deb o'ylab qolardi. */
  function profileWarning() {
    const err = S.data && S.data.usersFailed;
    if (!err) return "";
    const why =
      err.code === "rules"
        ? "Firebase qoidalari `users` tugunini o'qishga ruxsat bermadi — " +
          "database.rules.json ni Console'da qayta «Publish» qiling."
        : (err.message || "Sabab noma'lum") + "";
    return (
      '<div class="crm-warn">⚠️ <b>Mijoz profillari o\'qilmadi.</b> Ro\'yxat va ' +
      "raqamlar faqat buyurtma bergan mijozlarni qamraydi. " + esc(why) + "</div>"
    );
  }

  function kpi(id, icon, label, value, tone) {
    return (
      '<div class="crm-kpi' + (tone ? " is-" + tone : "") + '">' +
      '<span class="crm-kpi-ic">' + icon + "</span>" +
      '<span class="crm-kpi-lb">' + esc(label) + "</span>" +
      '<b id="' + id + '">' + esc(value) + "</b>" +
      "</div>"
    );
  }

  function renderStats(st) {
    const hasAny = st.total > 0 || st.customers > 0;
    if (!hasAny) {
      body().innerHTML =
        profileWarning() +
        '<div class="crm-empty"><div class="crm-empty-ic">📊</div>' +
        "<b>Hisobot uchun ma'lumot yo'q</b>" +
        "<p>Birinchi mijoz ro'yxatdan o'tib buyurtma berganda statistika shu yerda paydo bo'ladi.</p></div>";
      return;
    }

    // ---- bo'limlar kesimi (Zimmer'da uch xil buyurtma bor)
    const kindRows = ["order", "biled", "booking"]
      .map((kind) => {
        const k = st.kinds[kind] || blank();
        if (!k.total) return "";
        const meta = KIND_LABEL[kind];
        return (
          '<div class="crm-split">' +
          '<span class="crm-split-ic">' + meta.icon + "</span>" +
          '<span class="crm-split-tx"><b>' + esc(meta.title) + "</b>" +
          "<i>" + k.done + " yakunlandi · " + k.active + " jarayonda" +
          (k.cancelled ? " · " + k.cancelled + " bekor" : "") + "</i></span>" +
          '<em>' + esc(k.revenue ? money(k.revenue) : "—") + "</em>" +
          "</div>"
        );
      })
      .join("");

    const rank = (items, unit) =>
      items
        .map(
          (it, i) =>
            '<div class="adm-rank-row"><i>' + MEDALS[i] + "</i>" +
            "<b>" + esc(it.name) + "</b>" +
            "<span>" + it.units + " " + unit + "</span>" +
            (it.sum ? "<em>" + esc(money(it.sum)) + "</em>" : "") +
            "</div>"
        )
        .join("");

    body().innerHTML =
      // ---- yangi buyurtma ogohlantirishi
      (st.fresh
        ? '<div class="crm-alert">🆕 <b>' + st.fresh +
          " ta yangi buyurtma</b> javob kutib turibdi</div>"
        : "") +
      // ---- umumiy tushum (asosiy raqam)
      '<div class="crm-hero">' +
      '<span class="crm-hero-lb">Umumiy savdo (tushum)</span>' +
      '<b id="crm-total">0 so\'m</b>' +
      '<i>Faqat yakunlangan buyurtmalar hisoblanadi</i>' +
      "</div>" +
      // ---- bugun / bu oy
      '<div class="crm-kpis">' +
      kpi("crm-today", "📈", "Bugungi savdo", "0 so'm", "green") +
      kpi("crm-month", "🗓", "Bu oy", "0 so'm", "gold") +
      "</div>" +
      // ---- o'rtacha chek / jami sotuvlar
      '<div class="crm-kpis">' +
      kpi("crm-avg", "🧾", "O'rtacha chek", "0 so'm") +
      kpi("crm-done", "📦", "Jami sotuvlar", st.done + " ta") +
      "</div>" +
      // ---- mijozlar / xaridorlar
      '<div class="crm-kpis">' +
      kpi("crm-cust-n", "👥", "Jami mijozlar", st.customers + " kishi") +
      kpi("crm-buyers", "🛍", "Xaridorlar", st.buyers + " kishi") +
      "</div>" +
      // ---- sodiqlik
      '<div class="crm-strip">' +
      "<span>🔁 Qaytgan mijozlar <i>(2+ xarid)</i></span><b>" + st.returning + " kishi</b>" +
      "</div>" +
      '<div class="crm-strip">' +
      "<span>👑 VIP mijozlar <i>(5+ xarid yoki 1 mln+)</i></span><b class=\"is-gold\">" +
      st.vip + " kishi</b>" +
      "</div>" +
      (st.cancelled
        ? '<div class="crm-strip"><span>✕ Bekor qilingan</span><b class="is-red">' +
          st.cancelled + " ta</b></div>"
        : "") +
      // ---- grafik
      '<div class="adm-list-title">Savdo dinamikasi</div>' +
      '<div class="crm-seg">' +
      '<button class="crm-seg-b" data-c="daily">Kunlik</button>' +
      '<button class="crm-seg-b" data-c="weekly">Haftalik</button>' +
      '<button class="crm-seg-b" data-c="monthly">Oylik</button>' +
      "</div>" +
      '<div class="crm-chart" id="crm-chart"></div>' +
      // ---- bo'limlar kesimi
      (kindRows ? '<div class="adm-list-title">Bo\'limlar bo\'yicha</div>' + kindRows : "") +
      // ---- reytinglar
      (st.topProducts.length
        ? '<div class="adm-list-title">🏆 Xit savdolar (Top 5)</div>' +
          '<div class="adm-rank">' + rank(st.topProducts, "ta") + "</div>"
        : "") +
      (st.topCars.length
        ? '<div class="adm-list-title">🚗 Mashinalar bo\'yicha (Top 5)</div>' +
          '<div class="adm-rank">' + rank(st.topCars, "buyurtma") + "</div>"
        : "") +
      profileWarning();

    // ---- raqamlar noldan yuqoriga sanaladi (Avto_A1 hissi)
    countUp("crm-total", st.revenue, " so'm");
    countUp("crm-today", st.today, " so'm");
    countUp("crm-month", st.month, " so'm");
    countUp("crm-avg", st.avg, " so'm");

    // ---- grafik va davr tugmalari
    S.stats = st;
    paintChart();
    document.querySelectorAll(".crm-seg-b").forEach((b) => {
      b.onclick = () => {
        haptic();
        S.chart = b.dataset.c;
        paintChart();
      };
    });
  }

  /** Ustunli grafik — oddiy DIV lar (blur/canvas yo'q, telefon qizmaydi). */
  function paintChart() {
    const box = $("crm-chart");
    if (!box || !S.stats) return;
    document
      .querySelectorAll(".crm-seg-b")
      .forEach((b) => b.classList.toggle("on", b.dataset.c === S.chart));

    const list = S.stats.series[S.chart] || [];
    const max = list.reduce((m, b) => Math.max(m, b.value), 0);
    const total = list.reduce((s, b) => s + b.value, 0);
    let best = null;
    list.forEach((b) => {
      if (!best || b.value > best.value) best = b;
    });

    if (!total) {
      box.innerHTML =
        '<div class="crm-chart-empty">Bu davrda yakunlangan savdo bo\'lmagan.</div>';
      return;
    }

    const bars = list
      .map((b, i) => {
        // Nol bo'lmagan ustun ko'rinib turishi uchun minimal 3%.
        const h = max ? Math.max(Math.round((b.value / max) * 100), b.value ? 3 : 0) : 0;
        return (
          '<button class="crm-bar' + (b === best ? " is-best" : "") +
          '" data-i="' + i + '" style="--h:' + h + '%">' +
          "<i></i><span>" + esc(b.label) + "</span></button>"
        );
      })
      .join("");

    box.innerHTML =
      '<div class="crm-chart-read" id="crm-read">' +
      "<b>" + esc(best ? best.full || best.label : "—") + "</b>" +
      "<em>" + esc(money(best ? best.value : 0)) + "</em>" +
      '<span>eng yaxshi davr</span>' +
      "</div>" +
      '<div class="crm-bars">' + bars + "</div>" +
      '<div class="crm-chart-foot"><span>Jami davr</span><b>' + esc(money(total)) + "</b></div>";

    // Ustunga bosilganda o'sha davr raqami yuqorida ko'rinadi.
    box.querySelectorAll(".crm-bar").forEach((btn) => {
      btn.onclick = () => {
        haptic();
        const b = list[Number(btn.dataset.i)];
        if (!b) return;
        box.querySelectorAll(".crm-bar").forEach((x) => x.classList.remove("on"));
        btn.classList.add("on");
        const read = $("crm-read");
        if (read)
          read.innerHTML =
            "<b>" + esc(b.full || b.label) + "</b><em>" + esc(money(b.value)) +
            "</em><span>tanlangan davr</span>";
      };
    });
  }

  /* ====================================================================
     MIJOZLAR RO'YXATI
     ==================================================================== */

  const FILTERS = [
    ["all", "Hammasi"],
    ["vip", "👑 VIP"],
    ["buyer", "🛍 Xaridor"],
    ["run", "⏳ Jarayonda"],
    ["cold", "🆕 Buyurtmasiz"],
  ];

  const TESTS = {
    all: () => true,
    vip: (c) => c.vip,
    buyer: (c) => c.done > 0,
    run: (c) => c.active > 0,
    cold: (c) => c.orders === 0,
  };

  const SORTS = {
    spent: (a, b) => b.spent - a.spent || b.orders - a.orders || b.last - a.last,
    orders: (a, b) => b.orders - a.orders || b.spent - a.spent,
    recent: (a, b) => b.last - a.last || b.spent - a.spent,
  };

  async function openCustomers(force) {
    S.view = "customers";
    S.uid = null;
    S.limit = PAGE;
    stopScroll();
    setHead("👥 Mijozlar", "Foydalanuvchilar bazasi");
    loading("Mijozlar o'qilmoqda...");
    let data;
    try {
      data = await loadData(force);
    } catch (err) {
      fail(err, () => openCustomers(true));
      return false;
    }
    S.data = data;
    setHead("👥 Mijozlar", data.customers.length + " ta mijoz");
    renderCustomersShell();
    paintCustomers();
    return true;
  }

  /** Qidiruv maydoni va filtrlar BIR MARTA chiziladi.
   *  Sabab: har harfda butun panelni qayta chizsak, input fokusdan chiqib
   *  telefon klaviaturasi yopilardi. Shuning uchun faqat ro'yxat qismi
   *  yangilanadi. */
  function renderCustomersShell() {
    body().innerHTML =
      profileWarning() +
      '<div class="crm-search">' +
      '<span class="crm-search-ic">🔍</span>' +
      '<input type="text" id="crm-q" class="crm-search-in" ' +
      'placeholder="Ism, telefon yoki ID..." autocomplete="off" value="' + esc(S.query) + '">' +
      '<button class="crm-search-x hidden" id="crm-qx" aria-label="Tozalash">✕</button>' +
      "</div>" +
      '<div class="crm-sum" id="crm-sum"></div>' +
      '<div class="ord-filters" id="crm-chips"></div>' +
      '<div class="crm-sortbar">' +
      '<span>Saralash</span>' +
      '<button class="crm-sort" data-s="spent">💰 Summa</button>' +
      '<button class="crm-sort" data-s="orders">🛍 Xaridlar</button>' +
      '<button class="crm-sort" data-s="recent">🕐 Oxirgi</button>' +
      "</div>" +
      '<div id="crm-list"></div>' +
      '<div id="crm-more"></div>';

    const input = $("crm-q");
    if (input) {
      input.oninput = () => {
        clearTimeout(S.typing);
        S.typing = setTimeout(() => {
          S.query = input.value;
          S.limit = PAGE; // yangi qidiruv — birinchi sahifadan
          paintCustomers();
        }, 130);
      };
    }
    if ($("crm-qx"))
      $("crm-qx").onclick = () => {
        haptic();
        S.query = "";
        S.limit = PAGE;
        if ($("crm-q")) $("crm-q").value = "";
        paintCustomers();
      };

    document.querySelectorAll(".crm-sort").forEach((b) => {
      b.onclick = () => {
        haptic();
        S.sort = b.dataset.s;
        S.limit = PAGE;
        paintCustomers();
      };
    });
  }

  /** Qidiruv — Avto_A1 dagi kabi ism / ID / telefon, ustiga @username. */
  function matches(c, q) {
    if (!q) return true;
    return (
      c.name.toLowerCase().indexOf(q) !== -1 ||
      c.uid.indexOf(q) !== -1 ||
      (c.phone && c.phone.replace(/\s/g, "").indexOf(q.replace(/\s/g, "")) !== -1) ||
      (c.username && c.username.toLowerCase().indexOf(q) !== -1) ||
      (c.car && c.car.toLowerCase().indexOf(q) !== -1)
    );
  }

  function paintCustomers() {
    const all = (S.data && S.data.customers) || [];
    const q = S.query.trim().toLowerCase();

    // ---- filtr chiplari (har birida soni)
    const chips = FILTERS.map(([key, label]) => {
      const n = all.filter(TESTS[key]).length;
      if (key !== "all" && !n) return "";
      return (
        '<button class="ord-fchip' + (S.filter === key ? " selected" : "") +
        '" data-f="' + key + '">' + esc(label) + " <i>" + n + "</i></button>"
      );
    }).join("");
    $("crm-chips").innerHTML = chips;
    document.querySelectorAll("#crm-chips .ord-fchip").forEach((b) => {
      b.onclick = () => {
        haptic();
        S.filter = b.dataset.f;
        S.limit = PAGE;
        paintCustomers();
      };
    });

    // ---- yuqoridagi xulosa
    const spent = all.reduce((s, c) => s + c.spent, 0);
    const buyers = all.filter((c) => c.done > 0).length;
    $("crm-sum").innerHTML =
      '<div class="crm-sum-b"><b>' + all.length + "</b><span>mijoz</span></div>" +
      '<div class="crm-sum-b"><b>' + buyers + "</b><span>xaridor</span></div>" +
      '<div class="crm-sum-b is-gold"><b>' + esc(money(spent)) + "</b><span>umumiy tushum</span></div>";

    document.querySelectorAll(".crm-sort").forEach((b) =>
      b.classList.toggle("on", b.dataset.s === S.sort)
    );
    if ($("crm-qx")) $("crm-qx").classList.toggle("hidden", !S.query);

    // ---- ro'yxat
    const list = all.filter(TESTS[S.filter] || TESTS.all).filter((c) => matches(c, q));
    list.sort(SORTS[S.sort] || SORTS.spent);

    if (!list.length) {
      $("crm-list").innerHTML =
        '<div class="crm-empty"><div class="crm-empty-ic">🔍</div><b>Mijoz topilmadi</b>' +
        "<p>" + (q ? "Boshqa ism, telefon yoki ID bilan urinib ko'ring." :
          "Bu filtrga mos mijoz yo'q.") + "</p></div>";
      $("crm-more").innerHTML = "";
      stopScroll();
      return;
    }

    const shown = list.slice(0, S.limit);
    $("crm-list").innerHTML = shown.map(customerCard).join("");
    document.querySelectorAll("#crm-list .crm-cust").forEach((card) => {
      card.onclick = (ev) => {
        // Telefon tugmasi bosilsa kartani ochmaymiz.
        if (ev.target.closest(".crm-cust-tel")) return;
        haptic();
        openCustomer(card.dataset.uid);
      };
    });
    document.querySelectorAll("#crm-list .crm-cust-tel").forEach((btn) => {
      btn.onclick = (ev) => {
        ev.stopPropagation();
        callPhone(btn.dataset.tel);
      };
    });

    // ---- «pastga tushganda yana yuklanadi» (Avto_A1 mantiqi)
    const rest = list.length - shown.length;
    if (rest > 0) {
      $("crm-more").innerHTML =
        '<div class="crm-more" id="crm-sentinel">Yana ' + rest + " ta mijoz · pastga tushiring</div>";
      watchScroll(() => {
        S.limit += PAGE;
        paintCustomers();
      });
    } else {
      $("crm-more").innerHTML =
        list.length > PAGE ? '<div class="crm-end">Ro\'yxat tugadi · ' + list.length + " ta</div>" : "";
      stopScroll();
    }
  }

  /** Mijoz kartochkasi — avatar, VIP toji, summa va xarid soni. */
  function customerCard(c) {
    const initial = (c.name || "?").trim().charAt(0).toUpperCase() || "?";
    const tone = c.vip ? "is-vip" : c.done ? "is-buyer" : "is-cold";
    const sub = [];
    if (c.username) sub.push("@" + c.username);
    sub.push("ID " + c.uid);

    return (
      '<div class="crm-cust ' + tone + '" data-uid="' + esc(c.uid) + '">' +
      '<span class="crm-ava">' + esc(initial) +
      (c.vip ? '<i class="crm-ava-crown">👑</i>' : "") + "</span>" +
      '<span class="crm-cust-mid">' +
      '<b>' + esc(c.name) + "</b>" +
      '<span class="crm-cust-sub">' + esc(sub.join(" · ")) + "</span>" +
      (c.phone
        ? '<button class="crm-cust-tel" data-tel="' + esc(c.phone) + '">📞 ' + esc(c.phone) + "</button>"
        : '<span class="crm-cust-sub is-dim">Telefon kiritilmagan</span>') +
      (c.car ? '<span class="crm-cust-car">🚗 ' + esc(c.car) + "</span>" : "") +
      "</span>" +
      '<span class="crm-cust-right">' +
      "<b>" + esc(c.spent ? money(c.spent) : "—") + "</b>" +
      '<em class="crm-tag' + (c.done ? " is-done" : "") + '">' + c.done + " xarid</em>" +
      (c.active ? '<em class="crm-tag is-run">' + c.active + " jarayonda</em>" : "") +
      (c.last ? '<span class="crm-cust-when">' + esc(timeLabel(c.last)) + "</span>" : "") +
      "</span>" +
      "</div>"
    );
  }

  function callPhone(phone) {
    haptic();
    try {
      window.open("tel:" + String(phone).replace(/\s/g, ""), "_blank");
    } catch (_) {}
  }

  /* -------------------------------------------------- cheksiz skroll */

  /** Ro'yxat oxiridagi belgi ko'ringanda keyingi 20 tani chizadi.
   *  `scroll` tinglovchisidan farqli — brauzer o'zi xabar beradi, ya'ni
   *  skroll paytida hech qanday hisob-kitob bo'lmaydi (telefon qizmaydi). */
  function watchScroll(onHit) {
    stopScroll();
    const node = $("crm-sentinel");
    if (!node) return;
    if (!window.IntersectionObserver) {
      // Juda eski brauzer — belgini tugmaga aylantiramiz.
      node.textContent = "Yana ko'rsatish";
      node.onclick = onHit;
      return;
    }
    S.io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          stopScroll();
          onHit();
        }
      },
      { rootMargin: "240px 0px" }
    );
    S.io.observe(node);
  }

  function stopScroll() {
    if (S.io) {
      S.io.disconnect();
      S.io = null;
    }
  }

  /* ====================================================================
     BITTA MIJOZ — profil va uning HAMMA buyurtmalari
     ==================================================================== */

  function openCustomer(uid) {
    const all = (S.data && S.data.customers) || [];
    const c = all.filter((x) => x.uid === String(uid))[0];
    if (!c) return toast("Mijoz topilmadi");

    S.view = "customer";
    S.uid = c.uid;
    stopScroll();
    setHead(c.name, c.vip ? "👑 VIP mijoz" : c.done ? "Xaridor" : "Mijoz");

    const mine = (S.data.orders || []).filter((o) => String(o.uid) === c.uid);
    const initial = (c.name || "?").trim().charAt(0).toUpperCase() || "?";

    /* Buyurtmalar ZimmerShop dagi AYNI kartochka bilan chiziladi, lekin
       `next` bo'shatiladi — ya'ni holat tugmalari chiqmaydi. Holatni
       o'zgartirish o'z bo'limida bo'ladi: bu yerda tugma qo'ysak, bosilgandan
       keyin panel buyurtmalar oynasiga sakrab, admin mijoz kartasini
       yo'qotardi. */
    const KINDS = shop().KINDS || {};
    const cardOf = (o) => {
      const cfg = KINDS[o.kind];
      if (!cfg || !shop().orderCard) return "";
      const readOnly = {};
      Object.keys(cfg).forEach((k) => (readOnly[k] = cfg[k]));
      readOnly.next = {};
      return shop().orderCard(o, readOnly);
    };

    const groups = ["order", "biled", "booking"]
      .map((kind) => {
        const rows = mine.filter((o) => o.kind === kind);
        if (!rows.length) return "";
        const meta = KIND_LABEL[kind];
        return (
          '<div class="adm-list-title">' + meta.icon + " " + esc(meta.title) +
          " <i>" + rows.length + "</i></div>" +
          rows.map(cardOf).join("")
        );
      })
      .join("");

    const tg = c.username
      ? '<button class="crm-act" id="crm-tg">✈️ Telegram</button>'
      : "";
    const tel = c.phone ? '<button class="crm-act is-primary" id="crm-call">📞 Qo\'ng\'iroq</button>' : "";

    body().innerHTML =
      '<div class="crm-profile' + (c.vip ? " is-vip" : "") + '">' +
      '<span class="crm-ava big">' + esc(initial) +
      (c.vip ? '<i class="crm-ava-crown">👑</i>' : "") + "</span>" +
      "<b>" + esc(c.name) + "</b>" +
      '<span class="crm-profile-sub">' +
      (c.username ? "@" + esc(c.username) + " · " : "") + "ID " + esc(c.uid) +
      "</span>" +
      (c.vip ? '<span class="crm-vip-tag">👑 VIP mijoz</span>' : "") +
      (c.phone ? '<span class="crm-profile-row">📞 ' + esc(c.phone) + "</span>" : "") +
      (c.car ? '<span class="crm-profile-row">🚗 ' + esc(c.car) + "</span>" : "") +
      (c.registered ? "" : '<span class="crm-profile-row is-dim">Profil bazada yo\'q — ma\'lumot buyurtmadan olindi</span>') +
      (tel || tg ? '<div class="crm-acts">' + tel + tg + "</div>" : "") +
      "</div>" +
      '<div class="crm-kpis">' +
      kpi("crm-c-spent", "💰", "Sarflagan", money(c.spent), "gold") +
      kpi("crm-c-done", "📦", "Yakunlangan", c.done + " ta", "green") +
      "</div>" +
      '<div class="crm-kpis">' +
      kpi("crm-c-avg", "🧾", "O'rtacha chek", money(c.avg)) +
      kpi("crm-c-run", "⏳", "Jarayonda", c.active + " ta") +
      "</div>" +
      (c.cancelled
        ? '<div class="crm-strip"><span>✕ Bekor qilingan</span><b class="is-red">' +
          c.cancelled + " ta</b></div>"
        : "") +
      (c.first
        ? '<div class="crm-strip"><span>🕐 Birinchi buyurtma</span><b>' +
          esc(timeLabel(c.first)) + "</b></div>"
        : "") +
      (groups ||
        '<div class="crm-empty"><div class="crm-empty-ic">📭</div><b>Buyurtma yo\'q</b>' +
          "<p>Bu mijoz hali hech narsa buyurtma qilmagan.</p></div>");

    if ($("crm-call")) $("crm-call").onclick = () => callPhone(c.phone);
    if ($("crm-tg"))
      $("crm-tg").onclick = () => {
        haptic();
        const url = "https://t.me/" + c.username;
        const wa = window.Telegram && window.Telegram.WebApp;
        if (wa && wa.openTelegramLink) wa.openTelegramLink(url);
        else window.open(url, "_blank");
      };

    // Kartochkadagi telefon tugmalari (ZimmerShop kartochkasi ichida).
    document.querySelectorAll(".ord-tel").forEach((btn) => {
      btn.onclick = () => callPhone(c.phone || btn.textContent.replace(/[^\d+]/g, ""));
    });

    window.scrollTo({ top: 0, behavior: reduced() ? "auto" : "smooth" });
  }

  /* ====================================================================
     TASHQI INTERFEYS — ZimmerShop topbar'ni shu yerga yo'naltiradi
     ==================================================================== */

  function isActive() {
    return S.view !== null;
  }

  function close() {
    S.view = null;
    S.uid = null;
    S.query = "";
    S.filter = "all";
    S.limit = PAGE;
    stopScroll();
  }

  /** «Orqaga»: mijoz tafsiloti -> ro'yxat. Ro'yxat/statistikada `false`
   *  qaytaradi — ZimmerShop bosh menyuga chiqaradi. */
  function back() {
    if (S.view === "customer") {
      openCustomers();
      return true;
    }
    return false;
  }

  /** «Yangilash»: keshni tashlab qayta o'qiydi. */
  function reload() {
    invalidate();
    if (S.view === "stats") return openStats(true);
    if (S.view === "customer") {
      const uid = S.uid;
      // Ro'yxat qayta o'qilgach o'sha mijozga qaytamiz. O'qish yiqilsa
      // xato oynasi ustiga chizmaymiz.
      return openCustomers(true).then((ok) => {
        if (ok && uid) openCustomer(uid);
      });
    }
    return openCustomers(true);
  }

  return {
    openCustomers: openCustomers,
    openCustomer: openCustomer,
    openStats: openStats,
    back: back,
    reload: reload,
    isActive: isActive,
    close: close,
    invalidate: invalidate,
  };
})();
