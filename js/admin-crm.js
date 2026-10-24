/* ==========================================================================
   UZBROVV — MIJOZLAR BAZASI VA STATISTIKA (Avto_A1 modeli)

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
  const off = () => window.ZimmerOffline;
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
    /* `users` tuguni YOPIQ (database.rules.json: .read=false) — ism/telefon
       PII. Uni to'g'ridan Firebase'dan EMAS, imzolangan Worker orqali
       o'qiymiz (`/admin/users`, faqat tasdiqlangan admin). Worker yo'q yoki
       eski bo'lsa profillar o'qilmaydi, lekin ro'yxat baribir buyurtmalardan
       tuziladi (pastda ogohlantiriladi). */
    let usersFailed = null;
    let flags = { blocked: {}, vip: {} };
    const usersP =
      off() && off().adminUsers
        ? off()
            .adminUsers()
            .then((res) => {
              // Worker 1.10.0+: bloklanganlar va qo'lda VIP xaritalari ham keladi
              flags = { blocked: (res && res.blocked) || {}, vip: (res && res.vip) || {} };
              return (res && res.users) || null;
            })
            .catch((err) => {
              usersFailed = err;
              return null;
            })
        : Promise.resolve().then(() => {
            usersFailed = { code: "no_worker", message: "Worker sozlanmagan" };
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
      customers: buildCustomers(usersNode, orders, flags),
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
  function buildCustomers(usersNode, orders, flags) {
    const map = {};
    const blockedMap = (flags && flags.blocked) || {};
    const vipMap = (flags && flags.vip) || {};

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
      c.manual = !!vipMap[c.uid];
      c.blocked = !!blockedMap[c.uid];
      c.autoVip = c.done >= VIP_ORDERS || c.spent >= VIP_SPENT;
      c.vip = c.autoVip || c.manual;
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
    let why;
    if (err.code === "no_worker") {
      why =
        "Worker sozlanmagan yoki eski nusxa — mijoz profillari (`users`) " +
        "faqat Worker orqali o'qiladi. Cloudflare'da Worker'ni 1.8.0+ ga " +
        "yangilang va docs/config.js dagi WORKER_URL to'g'riligini tekshiring.";
    } else if (err.code === "old_worker" || /feature|admin_users/i.test(err.message || "")) {
      why =
        "Cloudflare'da Worker'ning ESKI nusxasi turibdi (`admin_users` yo'q). " +
        "cloudflare-worker.js ni qayta deploy qiling.";
    } else {
      why = (err.message || "Sabab noma'lum") + "";
    }
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
     MIJOZLAR — AVTO_A1 BILAN 1:1 (2026)

     Tuzilish (Avto_A1 `index.html` → «5. MIJOZLAR» bilan bir xil):
       ro'yxat  — qidiruv + aylanma saralash tugmasi, 7 ta segment (soni
                  bilan), «N ta mijoz», iOS guruhlangan qatorlar (avatar,
                  ism, 👑, «Bloklangan», telefon, ›), 20 tadan cheksiz skroll;
       tafsilot — hero (avatar, ism, telefon, belgilar), 4 ta tezkor amal
                  (Qo'ng'iroq · Telegram · Xabar · Buyurtmalar), ichki xabar
                  maydoni, bo'limlar: Statistika · Ma'lumot · Daraja · Oxirgi
                  buyurtmalar · Boshqaruv (qo'lda VIP, Bloklash).

     Zimmer farqlari: yozuvlar BRAUZERDAN emas, imzolangan Worker orqali
     (`/admin/block`, `/admin/vip`, `/admin/message`) — `users` va
     `blocked_users` tugunlari yopiq. Bloklash bot, Render API va Worker
     tomonida tekshiriladi (services/blocked.py, verifyInitData).
     ==================================================================== */

  const DAY = 86400000;

  const SEGS = [
    ["all", "👥", "Hammasi"],
    ["vip", "👑", "VIP"],
    ["active", "🔥", "Faol"],
    ["new", "🆕", "Yangi"],
    ["sleeping", "💤", "Uxlagan"],
    ["noorder", "👤", "Xaridsiz"],
    ["blocked", "⛔", "Bloklangan"],
  ];

  function segMatch(c, seg) {
    const now = Date.now();
    switch (seg) {
      case "vip": return c.vip;
      case "active": return c.last > 0 && now - c.last <= 30 * DAY;
      case "new": return c.first > 0 && now - c.first <= 14 * DAY;
      case "sleeping": return c.orders > 0 && c.last > 0 && now - c.last > 60 * DAY;
      case "noorder": return c.orders === 0;
      case "blocked": return !!c.blocked;
      default: return true;
    }
  }

  const SORT_LIST = [
    ["spent", "Eng ko'p sarflagan"],
    ["orders", "Eng ko'p buyurtma"],
    ["recent", "Oxirgi xaridi yangi"],
    ["name", "Ism bo'yicha (A-Z)"],
  ];

  const SORTS = {
    spent: (a, b) => b.spent - a.spent || b.orders - a.orders,
    orders: (a, b) => b.orders - a.orders || b.spent - a.spent,
    recent: (a, b) => b.last - a.last || b.spent - a.spent,
    name: (a, b) => a.name.localeCompare(b.name, "uz"),
  };

  /** "3 kun oldin" (Avto_A1: agoLabel). */
  function ago(ms) {
    ms = Number(ms) || 0;
    if (!ms) return "—";
    const d = Math.max(0, Date.now() - ms);
    const min = Math.floor(d / 60000);
    if (min < 1) return "hozir";
    if (min < 60) return min + " daqiqa oldin";
    const h = Math.floor(min / 60);
    if (h < 24) return h + " soat oldin";
    const day = Math.floor(h / 24);
    if (day === 1) return "kecha";
    if (day < 30) return day + " kun oldin";
    const mo = Math.floor(day / 30);
    if (mo < 12) return mo + " oy oldin";
    return Math.floor(mo / 12) + " yil oldin";
  }

  const tierOf = (c) =>
    c.vip ? { icon: "💎", name: "VIP mijoz" } : { icon: "🛒", name: "Oddiy mijoz" };

  /** Qidiruv — ism / ID / telefon / @username. */
  function matches(c, q) {
    if (!q) return true;
    return (
      c.name.toLowerCase().indexOf(q) !== -1 ||
      c.uid.indexOf(q) !== -1 ||
      (c.phone || "").toLowerCase().replace(/\s/g, "").indexOf(q.replace(/\s/g, "")) !== -1 ||
      (c.username || "").toLowerCase().indexOf(q.replace(/^@/, "")) !== -1
    );
  }

  /* ------------------------------------------------------------ ro'yxat */

  async function openCustomers(force) {
    S.view = "customers";
    S.uid = null;
    S.limit = PAGE;
    stopScroll();
    setHead("Mijozlar", "Foydalanuvchilar bazasi");
    loading("Mijozlar o'qilmoqda...");
    let data;
    try {
      data = await loadData(force);
    } catch (err) {
      fail(err, () => openCustomers(true));
      return false;
    }
    S.data = data;
    showCustomers(true);
    return true;
  }

  /** Ro'yxat oynasini (keshdagi ma'lumotdan) chizadi. */
  function showCustomers(animate) {
    S.view = "customers";
    S.uid = null;
    stopScroll();
    const all = (S.data && S.data.customers) || [];
    setHead("Mijozlar", all.length + " ta mijoz");
    const sortLabel = (SORT_LIST.filter((x) => x[0] === S.sort)[0] || SORT_LIST[0])[1];

    body().innerHTML =
      profileWarning() +
      '<div class="cst-wrap">' +
      '<div class="cst-tools">' +
      '<label class="cst-search' + (S.query ? " has-text" : "") + '" id="cst-search">' +
      '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.3-4.3"/></svg>' +
      '<input type="text" id="cst-q" placeholder="Ism, telefon yoki ID..." autocomplete="off" inputmode="search" value="' +
      esc(S.query) + '">' +
      '<button type="button" class="cst-search-x" id="cst-q-x" aria-label="Tozalash">✕</button>' +
      "</label>" +
      '<button type="button" class="cst-sort" id="cst-sort" aria-label="' + esc(sortLabel) + '" title="' + esc(sortLabel) + '">' +
      '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h12M4 12h9M4 17h6"/><path d="m17 14 3 3-3 3M20 17V8"/></svg>' +
      "</button>" +
      "</div>" +
      '<div class="cst-segs" id="cst-segs"></div>' +
      '<div id="cst-list"></div>' +
      '<div id="crm-more"></div>' +
      "</div>";

    const input = $("cst-q");
    if (input)
      input.oninput = () => {
        clearTimeout(S.typing);
        S.typing = setTimeout(() => {
          S.query = input.value || "";
          $("cst-search").classList.toggle("has-text", !!S.query);
          S.limit = PAGE;
          paintCustomers(false);
        }, 120);
      };
    $("cst-q-x").onclick = () => {
      haptic("light");
      S.query = "";
      if (input) {
        input.value = "";
        input.focus();
      }
      $("cst-search").classList.remove("has-text");
      S.limit = PAGE;
      paintCustomers(false);
    };
    $("cst-sort").onclick = () => {
      const ids = SORT_LIST.map((x) => x[0]);
      const next = SORT_LIST[(ids.indexOf(S.sort) + 1) % SORT_LIST.length];
      S.sort = next[0];
      haptic("selection");
      $("cst-sort").title = next[1];
      $("cst-sort").setAttribute("aria-label", next[1]);
      toast(next[1]);
      S.limit = PAGE;
      paintCustomers(true);
    };
    $("cst-segs").onclick = (e) => {
      const b = e.target.closest(".cst-seg");
      if (!b) return;
      haptic("selection");
      S.filter = b.dataset.seg;
      S.limit = PAGE;
      paintCustomers(true);
    };
    $("cst-list").onclick = (e) => {
      const row = e.target.closest(".cx-row");
      if (!row) return;
      haptic("light");
      openCustomer(row.dataset.uid);
    };
    paintCustomers(animate);
  }

  function paintCustomers(animate) {
    const all = (S.data && S.data.customers) || [];
    if (!SEGS.some((x) => x[0] === S.filter)) S.filter = "all";

    $("cst-segs").innerHTML = SEGS.map(
      (sg) =>
        '<button type="button" class="cst-seg' + (S.filter === sg[0] ? " on" : "") + '" data-seg="' + sg[0] + '">' +
        sg[1] + " " + esc(sg[2]) + "<em>" + all.filter((c) => segMatch(c, sg[0])).length + "</em></button>"
    ).join("");

    const q = (S.query || "").toLowerCase().trim();
    const list = all.filter((c) => segMatch(c, S.filter) && matches(c, q));
    list.sort(SORTS[S.sort] || SORTS.spent);

    const box = $("cst-list");
    if (!list.length) {
      box.innerHTML =
        '<div class="cst-empty"><span class="ic">🔍</span><b>Natija yo\'q</b><p>' +
        (q
          ? "«" + esc(S.query) + "» bo'yicha mijoz topilmadi. Boshqa ism yoki telefon raqami bilan urinib ko'ring."
          : "Bu segmentda mijoz yo'q. Boshqa segmentni tanlab ko'ring.") +
        "</p></div>";
      $("crm-more").innerHTML = "";
      stopScroll();
      return;
    }

    const shown = list.slice(0, S.limit);
    box.innerHTML =
      '<p class="cx-count">' + list.length + " ta mijoz</p>" +
      '<div class="ig cx-group' + (animate ? " is-anim" : "") + '">' + shown.map(rowHTML).join("") + "</div>";

    const rest = list.length - shown.length;
    if (rest > 0) {
      $("crm-more").innerHTML =
        '<div class="crm-more" id="crm-sentinel">Yana ' + rest + " ta mijoz · pastga suring</div>";
      watchScroll(() => {
        S.limit += PAGE;
        paintCustomers(false);
      });
    } else {
      $("crm-more").innerHTML = "";
      stopScroll();
    }
  }

  function rowHTML(c, i) {
    const initial = (c.name || "?").trim().charAt(0).toUpperCase() || "?";
    return (
      '<button type="button" class="ig-row cx-row' + (c.blocked ? " is-blocked" : "") + (c.vip ? " is-vip" : "") +
      '" data-uid="' + esc(c.uid) + '" style="--i:' + Math.min(i, 12) + '">' +
      '<span class="cx-av">' + esc(initial) + "</span>" +
      '<span class="ig-tx"><b class="cx-name"><span class="t">' + esc(c.name) + "</span>" +
      (c.vip ? '<span class="cx-vip" title="VIP">👑</span>' : "") +
      (c.blocked ? '<span class="cx-blk">Bloklangan</span>' : "") +
      "</b><small>" + esc(c.phone || "Telefon yo'q") + "</small></span>" +
      '<span class="ig-chev" aria-hidden="true"></span>' +
      "</button>"
    );
  }

  function callPhone(phone) {
    if (!phone) return toast("Telefon raqami yo'q");
    haptic("light");
    try {
      window.location.href = "tel:" + String(phone).replace(/[^0-9+]/g, "");
    } catch (_) {
      toast(phone);
    }
  }

  function openTelegram(c) {
    haptic("light");
    const wa = window.Telegram && window.Telegram.WebApp;
    try {
      if (c.username) {
        const url = "https://t.me/" + c.username;
        if (wa && wa.openTelegramLink) return wa.openTelegramLink(url);
        return window.open(url, "_blank");
      }
      window.open("tg://user?id=" + c.uid, "_blank");
    } catch (_) {
      toast("Ochib bo'lmadi");
    }
  }

  /* -------------------------------------------------- cheksiz skroll */

  function watchScroll(onHit) {
    stopScroll();
    const node = $("crm-sentinel");
    if (!node) return;
    if (!window.IntersectionObserver) {
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

  /* ------------------------------------------------------------ tafsilot */

  const SV = {
    call: '<path d="M6.6 10.8c1.4 2.8 3.8 5.1 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.6.6.5 0 1 .4 1 1V20c0 .6-.5 1-1 1-9.4 0-17-7.6-17-17 0-.6.5-1 1-1h3.5c.6 0 1 .4 1 1 0 1.2.2 2.4.6 3.6.1.3 0 .7-.2 1z"/>',
    tg: '<path d="M9.8 15.6l-.2 3.6c.4 0 .6-.2.8-.4l2-1.9 4.1 3c.8.4 1.3.2 1.5-.7l2.7-12.6c.2-1.1-.4-1.5-1.1-1.2L3.4 10.1c-1.1.4-1 1-.2 1.3l4.2 1.3 9.7-6.1c.5-.3.9-.1.5.2z"/>',
    msg: '<path d="M20 2H4a2 2 0 0 0-2 2v18l4-4h14a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2zM7 9h10v2H7zm6 5H7v-2h6zm4-6H7V6h10z"/>',
    box: '<path d="M20 2H4c-1 0-2 .9-2 2v3c0 .7.4 1.3 1 1.7V20c0 1.1 1.1 2 2 2h14c.9 0 2-.9 2-2V8.7c.6-.4 1-1 1-1.7V4c0-1.1-1-2-2-2zm-5 12H9v-2h6v2zm5-7H4V4h16v3z"/>',
    crown: '<path d="M5 16 3 5l5.5 5L12 4l3.5 6L21 5l-2 11zm14 3c0 .6-.4 1-1 1H6c-.6 0-1-.4-1-1v-1h14z"/>',
    block: '<path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zM4 12a8 8 0 0 1 12.9-6.3L5.7 16.9A7.9 7.9 0 0 1 4 12zm8 8a7.9 7.9 0 0 1-4.9-1.7L18.3 7.1A8 8 0 0 1 12 20z"/>',
  };
  const svg = (k) => '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">' + SV[k] + "</svg>";

  function statusText(o) {
    const cfg = (shop().KINDS || {})[o.kind];
    const st = cfg && cfg.statuses && cfg.statuses[o.status];
    return (st && st.label) || "Kutilmoqda";
  }

  function openCustomer(uid) {
    const all = (S.data && S.data.customers) || [];
    const c = all.filter((x) => x.uid === String(uid))[0];
    if (!c) return toast("Mijoz topilmadi");

    S.view = "customer";
    S.uid = c.uid;
    stopScroll();
    const t = tierOf(c);
    setHead(c.name, t.icon + " " + t.name + (c.vip ? " · VIP mijoz" : " daraja"));

    const mine = (S.data.orders || []).filter((o) => String(o.uid) === c.uid);
    const recent = mine.slice().sort((a, b) => (b.created_at || 0) - (a.created_at || 0)).slice(0, 6);

    const needSum = Math.max(0, VIP_SPENT - c.spent);
    const needOrd = Math.max(0, VIP_ORDERS - c.done);
    const nextTx = c.vip
      ? "VIP mijoz"
      : "💎 VIP bo'lishga " + num(needSum) + " so'm yoki " + needOrd + " ta xarid qoldi";

    const qb = (id, label, k, color) =>
      '<button type="button" class="cx-q" id="' + id + '" style="--qc:' + color + '">' +
      '<span class="cx-q-ic">' + svg(k) + '</span><span class="cx-q-l">' + label + "</span></button>";
    const kv = (k, v, cls) =>
      '<div class="cx-kv"><span class="k">' + k + '</span><span class="v' + (cls ? " " + cls : "") + '">' + v + "</span></div>";
    const telV = c.phone
      ? '<a class="cx-link" href="tel:' + esc(String(c.phone).replace(/[^0-9+]/g, "")) + '">' + esc(c.phone) + "</a>"
      : "—";
    const initial = (c.name || "?").trim().charAt(0).toUpperCase() || "?";

    body().innerHTML =
      '<div class="cx-wrap">' +
      // --- HERO
      '<div class="cx-hero' + (c.vip ? " is-vip" : "") + (c.blocked ? " is-blocked" : "") + '">' +
      '<div class="cx-hav">' + esc(initial) + "</div>" +
      '<h3 class="cx-hname">' + esc(c.name) + "</h3>" +
      '<div class="cx-hphone">' + esc(c.phone || "Telefon yo'q") + "</div>" +
      '<div class="cx-badges">' +
      '<span class="cx-badge is-tier">' + t.icon + " " + esc(t.name) + "</span>" +
      (c.manual ? '<span class="cx-badge">Qo\'lda</span>' : "") +
      (c.blocked ? '<span class="cx-badge is-blk">Bloklangan</span>' : "") +
      "</div></div>" +
      // --- TEZKOR AMALLAR
      '<div class="cx-quick">' +
      (c.phone ? qb("cdt-a-call", "Qo'ng'iroq", "call", "#30d158") : "") +
      qb("cdt-a-tg", "Telegram", "tg", "#0a84ff") +
      qb("cdt-a-msg", "Xabar", "msg", "var(--accent)") +
      qb("cdt-a-orders", "Buyurtmalar", "box", "#ff9f0a") +
      "</div>" +
      '<div id="cdt-msg-box" data-open="0"></div>' +
      // --- STATISTIKA
      '<p class="ig-sec">Statistika</p><div class="ig cx-grp">' +
      kv("Buyurtmalar", c.orders + " ta" + (c.active ? " <em>· " + c.active + " faol</em>" : "")) +
      kv("Sarflagan", esc(money(c.spent)), "is-acc") +
      kv("O'rtacha chek", c.avg ? esc(money(c.avg)) : "—") +
      kv("Oxirgi xarid", esc(c.last ? ago(c.last) : "—")) +
      "</div>" +
      // --- MA'LUMOT
      '<p class="ig-sec">Ma\'lumot</p><div class="ig cx-grp">' +
      kv("Telefon", telV) +
      kv("Telegram", c.username ? "@" + esc(c.username) : "—") +
      kv("ID", esc(c.uid), "mono") +
      (c.car ? kv("Mashinasi", esc(c.car)) : "") +
      kv("Birinchi xarid", c.first ? esc(new Date(c.first).toLocaleDateString("uz-UZ")) : "—") +
      kv("Bo'limlar", "Do'kon " + c.kinds.order + " · Bi-LED " + c.kinds.biled + " · Navbat " + c.kinds.booking) +
      "</div>" +
      // --- DARAJA
      '<p class="ig-sec">Daraja</p><div class="ig cx-grp">' +
      kv("Hozirgi", t.icon + " " + esc(t.name) + (c.manual ? " <em>· qo'lda</em>" : "")) +
      kv("Keyingi", esc(nextTx)) +
      kv("Shart", VIP_ORDERS + " ta yakunlangan xarid yoki " + esc(money(VIP_SPENT))) +
      (c.cancelled ? kv("Bekor qilingan", c.cancelled + " ta", "is-red") : "") +
      "</div>" +
      // --- OXIRGI BUYURTMALAR
      '<p class="ig-sec">Oxirgi buyurtmalar</p><div class="ig cx-grp">' +
      (recent.length
        ? recent
            .map(
              (o) =>
                '<div class="cx-ord"><span class="cx-ord-c"><b>' + esc(o.code || "#" + (o.id || "")) + "</b>" +
                "<span>" + esc(o.created_at ? ago(o.created_at) : "—") + " · " + esc(statusText(o)) + "</span></span>" +
                '<span class="cx-ord-s">' + esc(o.total ? money(o.total) : "—") + "</span></div>"
            )
            .join("")
        : '<div class="cx-kv"><span class="k">Hali buyurtma yo\'q</span></div>') +
      "</div>" +
      // --- BOSHQARUV
      '<p class="ig-sec">Boshqaruv</p><div class="ig cx-grp">' +
      '<button type="button" class="ig-row cx-act" id="cdt-a-vip">' +
      '<span class="ig-ic" style="--ic:linear-gradient(180deg,#e9c96a,#b48a2c)">' + svg("crown") + "</span>" +
      '<span class="ig-lbl">' + (c.manual ? "Qo'lda VIPni olib tashlash" : "Qo'lda VIP qilish") + "</span>" +
      '<span class="ig-chev" aria-hidden="true"></span></button>' +
      '<button type="button" class="ig-row cx-act is-danger" id="cdt-a-block">' +
      '<span class="ig-ic" style="--ic:' +
      (c.blocked ? "linear-gradient(180deg,#3ad37f,#22a35c)" : "linear-gradient(180deg,#ff6a5f,#ff3b30)") +
      '">' + svg("block") + "</span>" +
      '<span class="ig-lbl">' + (c.blocked ? "Blokdan chiqarish" : "Bloklash") + "</span></button>" +
      "</div>" +
      '<p class="cx-foot">' +
      (c.blocked
        ? "Bu mijoz bloklangan: botga yoza olmaydi, ilovani ocha olmaydi va buyurtma bera olmaydi."
        : "Bloklangan mijoz botdan va ilovadan foydalana olmaydi. Istalgan payt blokdan chiqarish mumkin.") +
      "</p>" +
      "</div>";

    const on = (id, fn) => {
      const b = $(id);
      if (b) b.onclick = fn;
    };
    on("cdt-a-call", () => callPhone(c.phone));
    on("cdt-a-tg", () => openTelegram(c));
    on("cdt-a-msg", () => toggleMessage(c));
    on("cdt-a-orders", () => {
      haptic("light");
      openCustomerOrders(c.uid);
    });
    on("cdt-a-vip", () => toggleManualVip(c));
    on("cdt-a-block", () => {
      haptic("light");
      toggleBlock(c);
    });
    window.scrollTo({ top: 0, behavior: "auto" });
  }

  /** Mijozning HAMMA buyurtmalari (ZimmerShop kartochkasi, faqat o'qish). */
  function openCustomerOrders(uid) {
    const c = ((S.data && S.data.customers) || []).filter((x) => x.uid === String(uid))[0];
    if (!c) return;
    S.view = "customer-orders";
    S.uid = c.uid;
    setHead(c.name, "Buyurtmalari");
    const mine = (S.data.orders || []).filter((o) => String(o.uid) === c.uid);
    const KINDS = shop().KINDS || {};
    const cardOf = (o) => {
      const cfg = KINDS[o.kind];
      if (!cfg || !shop().orderCard) return "";
      const ro = {};
      Object.keys(cfg).forEach((k) => (ro[k] = cfg[k]));
      ro.next = {}; // holat tugmalari o'z bo'limida
      return shop().orderCard(o, ro);
    };
    const groups = ["order", "biled", "booking"]
      .map((kind) => {
        const rows = mine.filter((o) => o.kind === kind);
        if (!rows.length) return "";
        const meta = KIND_LABEL[kind];
        return (
          '<p class="ig-sec">' + esc(meta.title) + " · " + rows.length + "</p>" + rows.map(cardOf).join("")
        );
      })
      .join("");
    body().innerHTML =
      groups ||
      '<div class="cst-empty"><span class="ic">📭</span><b>Buyurtma yo\'q</b><p>Bu mijoz hali hech narsa buyurtma qilmagan.</p></div>';
    document.querySelectorAll(".ord-tel").forEach((btn) => {
      btn.onclick = () => callPhone(c.phone || btn.textContent.replace(/[^\d+]/g, ""));
    });
    window.scrollTo({ top: 0, behavior: "auto" });
  }

  /** Tasdiqlash: Telegram `showConfirm`, bo'lmasa `confirm` (Avto_A1). */
  function ask(text, run) {
    const wa = window.Telegram && window.Telegram.WebApp;
    try {
      if (wa && wa.showConfirm) {
        wa.showConfirm(text, (ok) => ok && run());
        return;
      }
    } catch (_) {}
    if (window.confirm(text)) run();
  }

  function toggleBlock(c) {
    if (!off() || !off().adminBlock) return toast("Worker yangilanmagan (1.10.0 kerak)");
    const q = c.blocked
      ? c.name + " blokdan chiqarilsinmi?"
      : c.name + " bloklansinmi? U botdan va ilovadan foydalana olmaydi.";
    ask(q, async () => {
      try {
        await off().adminBlock(c.uid, !c.blocked, c.name, c.phone);
        c.blocked = !c.blocked;
        haptic("success");
        toast(c.blocked ? "⛔ " + c.name + " bloklandi" : c.name + " blokdan chiqarildi");
        openCustomer(c.uid);
      } catch (err) {
        if (err && err.code === "admin") return toast("Adminni bloklab bo'lmaydi");
        toast("Saqlanmadi: " + ((err && err.message) || "xato"));
      }
    });
  }

  async function toggleManualVip(c) {
    if (!off() || !off().adminVip) return toast("Worker yangilanmagan (1.10.0 kerak)");
    const next = !c.manual;
    try {
      await off().adminVip(c.uid, next);
      c.manual = next;
      c.vip = c.autoVip || c.manual;
      haptic("success");
      toast(next ? "👑 " + c.name + " → VIP mijoz (qo'lda)" : c.name + " — qo'lda daraja olib tashlandi");
      setTimeout(() => openCustomer(c.uid), 250);
    } catch (err) {
      toast("Saqlanmadi: " + ((err && err.message) || "xato"));
    }
  }

  /** Bot orqali shu mijozga xabar — tafsilot ichidagi maydon (prompt EMAS). */
  function toggleMessage(c) {
    const host = $("cdt-msg-box");
    if (!host) return;
    if (host.dataset.open === "1") {
      host.dataset.open = "0";
      host.innerHTML = "";
      return;
    }
    haptic("light");
    host.dataset.open = "1";
    host.innerHTML =
      '<div class="cx-msg">' +
      '<label class="cx-msg-l">Xabar matni — ' + esc(c.name) + "</label>" +
      '<textarea id="cdt-msg-tx" rows="3" maxlength="900" placeholder="Assalomu alaykum! Buyurtmangiz tayyor..."></textarea>' +
      '<button type="button" class="btn btn-primary" id="cdt-msg-send">✈ Yuborish</button>' +
      "</div>";
    const tx = $("cdt-msg-tx");
    if (tx) setTimeout(() => tx.focus(), 60);
    $("cdt-msg-send").onclick = async () => {
      const text = (tx.value || "").trim();
      if (text.length < 2) return toast("Xabar matnini yozing");
      if (!off() || !off().adminMessage) return toast("Xabar yuborish moduli topilmadi");
      const btn = $("cdt-msg-send");
      btn.disabled = true;
      btn.textContent = "Yuborilmoqda...";
      try {
        await off().adminMessage(c.uid, text);
        haptic("success");
        toast("Xabar yuborildi");
        host.dataset.open = "0";
        host.innerHTML = "";
      } catch (err) {
        toast((err && err.message) || "Yuborilmadi — mijoz botni bloklagan bo'lishi mumkin");
        btn.disabled = false;
        btn.textContent = "✈ Yuborish";
      }
    };
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
    if (S.view === "customer-orders") {
      openCustomer(S.uid);
      return true;
    }
    if (S.view === "customer") {
      showCustomers(false);
      return true;
    }
    return false;
  }

  /** «Yangilash»: keshni tashlab qayta o'qiydi. */
  function reload() {
    invalidate();
    if (S.view === "stats") return openStats(true);
    if (S.view === "customer" || S.view === "customer-orders") {
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
