// =====================================================================
//  ZIMMER — Cloudflare Worker
//
//  MAQSAD: Mini App Render'siz TO'LIQ ishlashi. Render faqat botni
//  ishlatadi; do'kon, mijoz tanilishi va buyurtma berish shu Worker +
//  Firebase orqali ishlaydi. Worker uxlamaydi va bepul.
//
//  ENDPOINT'LAR
//    GET  /health    — holat (tashxis workflow'i uchun)
//    POST /auth      — Telegram initData -> Firebase custom token
//    POST /profile   — mijoz profilini saqlash (ism/telefon/mashina)
//    POST /order     — BUYURTMA YARATISH (summa server tomonda hisoblanadi)
//    GET  /media?id= — Telegram fayl proksisi (file_id rasmlar uchun)
//
//  Secret'lar (Worker > Settings > Variables and Secrets):
//     BOT_TOKEN               — BotFather tokeni
//     FIREBASE_CLIENT_EMAIL   — serviceAccount.json dagi client_email
//     FIREBASE_PRIVATE_KEY    — serviceAccount.json dagi private_key
//  Oddiy o'zgaruvchilar:
//     FIREBASE_DB_URL         — https://zimmer-42840-default-rtdb.firebaseio.com
//     FIREBASE_ROOT           — zimmer
//     ADMIN_IDS               — 5105291033,483425630,5302078
//     INIT_DATA_MAX_AGE       — 86400 (soniya)
//
//  ---------------------------------------------------------------------
//  NEGA AVTO_A1 DAGIDAN BOSHQACHA (ataylab)
//
//  Avto_A1 da buyurtmani MIJOZ BRAUZERI to'g'ridan-to'g'ri RTDB ga
//  yozadi va o'zi adminga xabar yuboradi. Bu 4 ta muammo beradi:
//
//   1. Mijoz `total` ni O'ZI yozadi -> `total: 0` yuborish mumkin
//      (qoidalarda `.validate` yo'q). Bu yerda summa KATALOGDAN
//      o'qib, SERVER tomonda hisoblanadi. Mijoz yuborgan summa
//      butunlay E'TIBORSIZ qoldiriladi.
//   2. Mijoz `status: "yetkazildi"` yozib qo'ya oladi. Bu yerda status
//      har doim "new" bilan boshlanadi.
//   3. Yozuv yiqilsa `.catch(function(){})` uni yutadi -> buyurtma
//      yo'qoladi, mijoz esa "qabul qilindi" ko'radi. Bu yerda xato
//      MIJOZGA QAYTARILADI.
//   4. Mijoz `notified_admin: true` yozib botning xabarini o'chirib
//      qo'yadi. Bu yerda bu maydonni FAQAT server qo'yadi.
//
//  Shuningdek: token `Authorization: Bearer` sarlavhasida (URL'da emas,
//  loglarga tushmasin), access token keshlanadi, va `initData` yo'q
//  bo'lsa HECH QANDAY yo'l ochiq qolmaydi.
// =====================================================================

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Range",
  "Access-Control-Max-Age": "86400",
};

const DEFAULT_ROOT = "zimmer";
const DEFAULT_MAX_AGE = 86400; // 24 soat

// Deploy qilingan kod versiyasi. `/health` shuni qaytaradi — Cloudflare'da
// ESKI nusxa turganini shu bilan darhol aniqlash mumkin (aks holda "kod
// yangilanmadimi yoki kalit buzuqmi?" degan savolga taxmin bilan javob
// berishga to'g'ri keladi).
// Har deploy'da ko'tariladi — `/health` dagi bu raqam Cloudflare'da
// YANGI nusxa turganini tasdiqlashning eng oson yo'li.
const VERSION = "1.3.0";
const FEATURES = [
  "order",
  "me",
  "profile",
  "media",
  "admin_detect",
  // Render'siz admin amallari — katalogni telefondan boshqarish
  "admin_catalog",
  "admin_product_add",
  "admin_edit",
  "admin_orders",
];

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

function cfg(env) {
  const dbUrl = String(env.FIREBASE_DB_URL || "").replace(/\/+$/, "");
  const root = String(env.FIREBASE_ROOT || DEFAULT_ROOT).replace(/^\/+|\/+$/g, "");
  const admins = String(env.ADMIN_IDS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const maxAge = parseInt(env.INIT_DATA_MAX_AGE || DEFAULT_MAX_AGE, 10) || DEFAULT_MAX_AGE;
  return { dbUrl, root, admins, maxAge };
}

// =====================================================================
//  Kirish nuqtasi
// =====================================================================
export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return new Response(null, { headers: CORS });

    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";

    try {
      if (path === "/media" || path === "/file") return handleMedia(request, env);
      if (path === "/health" || path === "/") {
        // `?deep=1` — sozlamalar BOR-YO'QLIGINI emas, HAQIQATAN ISHLASHINI
        // tekshiradi: Firebase kalitini imzolab ko'radi va katalogni o'qiydi.
        return handleHealth(env, url.searchParams.get("deep") === "1");
      }

      if (request.method !== "POST") {
        return json({ ok: false, error: "Faqat POST" }, 405);
      }
      if (path === "/auth") return handleAuth(request, env);
      if (path === "/me") return handleMe(request, env);
      if (path === "/profile") return handleProfile(request, env);
      if (path === "/order") return handleOrder(request, env);

      // ---- Admin: Render'siz katalog boshqaruvi. Har biri imzoni tekshirib,
      // uid ni ADMIN_IDS bilan solishtiradi (`requireAdmin`).
      if (path === "/admin/catalog") return handleAdminCatalog(request, env);
      if (path === "/admin/product") return handleAdminProduct(request, env);
      if (path === "/admin/edit") return handleAdminEdit(request, env);
      if (path === "/admin/orders") return handleAdminOrders(request, env);
      if (path === "/admin/order-status") return handleAdminOrderStatus(request, env);

      return json({ ok: false, error: "Bunday manzil yo'q" }, 404);
    } catch (error) {
      // Xato YUTILMAYDI — mijoz sababni ko'rsin, aks holda buyurtma
      // "yo'qolgan" bo'lib qoladi va hech kim bilmaydi.
      return json({ ok: false, error: "server_error", message: String(error) }, 500);
    }
  },
};

// =====================================================================
//  GET /health
// =====================================================================
async function handleHealth(env, deep) {
  const c = cfg(env);
  const payload = {
    status: "ok",
    service: "zimmer-worker",
    // Cloudflare'da qaysi nusxa turganini bilish uchun
    version: VERSION,
    features: FEATURES,
    // DIQQAT: bu faqat «kiritilgan / yo'q». Qiymatlar oshkor qilinmaydi va
    // kalitning HAQIQATAN ishlashi bu yerda tekshirilmaydi — buning uchun
    // `?deep=1` kerak.
    configured: {
      bot_token: !!env.BOT_TOKEN,
      firebase_key: !!(env.FIREBASE_CLIENT_EMAIL && env.FIREBASE_PRIVATE_KEY),
      db_url: !!c.dbUrl,
      admins: c.admins.length,
    },
    time: new Date().toISOString(),
  };

  if (!deep) return json(payload);

  // ---- Chuqur tekshiruv: har bir bo'lak ALOHIDA sinaladi, shunda muammo
  // aynan qayerda ekani ko'rinadi (kalitda? bazada? katalogda?).
  const checks = {};

  // 1) Firebase kaliti haqiqatan imzolay oladimi va Google token beradimi?
  let token = null;
  try {
    // `force` — keshni chetlab o'tamiz, aks holda tashxis eski tokenga
    // qarab «joyida» deb yolg'on gapirardi.
    token = await accessToken(env, true);
    checks.firebase_token = { ok: true };
  } catch (error) {
    checks.firebase_token = {
      ok: false,
      // Kalit matni buzilgan bo'lsa odatda shu yerda "Invalid keyData"
      // yoki "invalid_grant" chiqadi.
      error: String(error).slice(0, 300),
      hint:
        "FIREBASE_PRIVATE_KEY matni buzilgan bo'lishi mumkin. " +
        "serviceAccount.json dagi private_key ni -----BEGIN dan -----END gacha " +
        "TO'LIQ nusxalang, ichidagi \\n larni o'zgartirmang.",
    };
  }

  // 2) Baza o'qiladimi va katalog bormi?
  if (token) {
    try {
      const res = await fetch(
        `${c.dbUrl}/${c.root}/catalog/products.json?shallow=true`,
        { headers: authHeaders(token) }
      );
      if (!res.ok) {
        checks.catalog_read = {
          ok: false,
          status: res.status,
          // 401 = token olindi, lekin RTDB uni qabul qilmadi. Deyarli har
          // doim scope kamligi sabab (kalit buzuqligi emas — kalit buzuq
          // bo'lsa yuqoridagi firebase_token bosqichi yiqilardi).
          hint:
            res.status === 401
              ? "Token olingan, lekin RTDB rad etdi. Sabab odatda OAuth scope: " +
                "userinfo.email VA firebase.database — ikkisi ham kerak. " +
                "Cloudflare'dagi Worker nusxasi eski bo'lishi mumkin."
              : res.status === 404
                ? "FIREBASE_DB_URL xato bo'lishi mumkin (baza manzili yoki mintaqa)."
                : undefined,
        };
      } else {
        const node = await res.json();
        const count = node && typeof node === "object" ? Object.keys(node).length : 0;
        checks.catalog_read = {
          ok: count > 0,
          products: count,
          hint: count ? undefined : "Katalog bo'sh — botga /firebase yuborilishi kerak.",
        };
      }
    } catch (error) {
      checks.catalog_read = { ok: false, error: String(error).slice(0, 200) };
    }
  }

  // 3) Bot tokeni haqiqiymi?
  if (env.BOT_TOKEN) {
    try {
      const res = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/getMe`);
      const data = await res.json();
      checks.bot_token = data && data.ok
        ? { ok: true, username: data.result && data.result.username }
        : { ok: false, error: (data && data.description) || "getMe ishlamadi" };
    } catch (error) {
      checks.bot_token = { ok: false, error: String(error).slice(0, 200) };
    }
  }

  payload.checks = checks;
  payload.status = Object.values(checks).every((x) => x.ok) ? "ok" : "problem";
  return json(payload);
}

// =====================================================================
//  POST /auth — initData -> Firebase custom token
// =====================================================================
async function handleAuth(request, env) {
  const body = await readJson(request);
  const verified = await verifyInitData(body.initData, env);
  if (!verified.ok) return json({ ok: false, error: verified.error }, 401);

  const uid = String(verified.user.id);
  const token = await createCustomToken(uid, env);
  return json({ ok: true, token, uid });
}

// =====================================================================
//  POST /me — mijoz profili + buyurtma tarixi
//
//  NEGA FIREBASE AUTH SDK ISHLATILMADI
//  Avto_A1 da brauzer RTDB ga TO'G'RIDAN yozadi, shuning uchun unga
//  Firebase Auth kerak: `/auth` custom token beradi, so'ng
//  `signInWithCustomToken` bilan `auth.uid` paydo bo'ladi va qoidalar
//  yozishga ruxsat beradi. Bu uchta narxga olib keladi:
//    • ilovaga ~300 KB SDK yuklanadi;
//    • qoidalarda mijozga YOZISH huquqi berilishi kerak, natijada u
//      `total: 0` yoki `status: "yetkazildi"` yozib qo'ya oladi;
//    • auth yiqilsa butun oqim yiqiladi.
//
//  Zimmer'da barcha yozishni Worker admin tokeni bilan bajaradi.
//  Shuning uchun brauzerga RTDB ga kirish huquqi UMUMAN BERILMAYDI —
//  qoidalar yopiq qoladi, SDK kerak emas, soxta ma'lumot yuborish
//  imkonsiz. `/auth` baribir qoldirildi (kelajakda kerak bo'lsa).
// =====================================================================
async function handleMe(request, env) {
  const c = cfg(env);
  if (!c.dbUrl) return json({ ok: false, error: "FIREBASE_DB_URL sozlanmagan" }, 500);

  const body = await readJson(request);
  const verified = await verifyInitData(body.initData, env);
  if (!verified.ok) return json({ ok: false, error: verified.error }, 401);

  const uid = String(verified.user.id);
  const user = verified.user;
  const token = await accessToken(env);

  const profile = (await rtdbGet(c.dbUrl, `${c.root}/users/${uid}/profile`, token)) || {};

  // Buyurtmalar: `orderBy="uid"` uchun qoidalarda `.indexOn: ["uid"]` bor.
  // Indeks bo'lmasa Firebase xato qaytaradi — o'sha holatda bo'sh ro'yxat
  // beramiz, ya'ni profil baribir ishlaydi (buyurtma tarixi ko'rinmaydi).
  let orders = [];
  try {
    const query =
      `${c.root}/pending_orders.json?orderBy=${encodeURIComponent('"uid"')}` +
      `&equalTo=${encodeURIComponent(uid)}&limitToLast=30`;
    const res = await fetch(`${c.dbUrl}/${query}`, { headers: authHeaders(token) });
    if (res.ok) {
      const node = await res.json();
      if (node && typeof node === "object") {
        orders = Object.values(node)
          .filter((o) => o && typeof o === "object")
          .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
          .map((o) => ({
            code: o.code || "",
            total: Number(o.total) || 0,
            total_label: fmtPrice(o.total),
            status: o.status || "new",
            address: o.address || "",
            items: Array.isArray(o.items) ? o.items : [],
            createdAt: o.createdAt || 0,
          }));
      }
    }
  } catch (_) {
    orders = [];
  }

  return json({
    ok: true,
    me: {
      id: Number(uid),
      // Render `/api/me` bu maydonni `user_id` deb ataydi. Ikkalasini ham
      // beramiz — frontend qaysi rejimda bo'lsa ham ID ni topadi.
      user_id: Number(uid),
      first_name: user.first_name || "",
      full_name:
        profile.name || [user.first_name, user.last_name].filter(Boolean).join(" ") || "Mijoz",
      phone: profile.phone || null,
      car: profile.carId ? { id: profile.carId, name: profile.carName || "" } : null,
      // ADMINNI TANIB OLAMIZ — va bu XAVFSIZ.
      //
      // `uid` yuqorida `verifyInitData` orqali Telegram HMAC IMZOSI bilan
      // tasdiqlangan, ya'ni uni soxtalashtirish mumkin emas. `ADMIN_IDS`
      // esa Worker'ning o'zida (env), brauzerda emas.
      //
      // Avto_A1 da bu boshqacha: `ADMIN_IDS` BRAUZERDA yozilgan va
      // `isAdmin()` `window.currentUser` ni solishtiradi — u esa
      // `localStorage` dan olinadi, ya'ni istalgan odam o'zini admin
      // qilib ko'rsatishi mumkin. Bizdagi usul shundan xavfsizroq.
      //
      // Bu belgi FAQAT «Boshqaruv» tugmasini ko'rsatish uchun. Haqiqiy
      // admin amallari Render'dagi `/api/admin/*` ga boradi va u imzoni
      // QAYTA tekshiradi — ya'ni bu yerda xato bo'lsa ham ma'lumot
      // oshkor bo'lmaydi.
      is_admin: c.admins.includes(uid),
    },
    orders,
  });
}

// =====================================================================
//  POST /profile — mijozni "tanib qolish"
//
//  Mijoz ismi, telefoni va tanlagan mashinasi Firebase'ga yoziladi.
//  Bot ko'tarilganda `sync.restore_users()` ularni SQLite ga tiklaydi,
//  ya'ni mijoz Render o'chgan paytda ro'yxatdan o'tsa ham YO'QOLMAYDI.
//
//  MUHIM: `uid` mijozdan OLINMAYDI — imzodan olinadi. Shuning uchun
//  birov boshqa mijozning profilini o'zgartira olmaydi (Avto_A1 da
//  `users/$uid` ga cheklovsiz yozish mumkin edi).
// =====================================================================
async function handleProfile(request, env) {
  const c = cfg(env);
  if (!c.dbUrl) return json({ ok: false, error: "FIREBASE_DB_URL sozlanmagan" }, 500);

  const body = await readJson(request);
  const verified = await verifyInitData(body.initData, env);
  if (!verified.ok) return json({ ok: false, error: verified.error }, 401);

  const uid = String(verified.user.id);
  const user = verified.user;

  const phone = normalizePhone(body.phone);
  if (body.phone && !phone) {
    return json({ ok: false, error: "Telefon raqam noto'g'ri" }, 400);
  }

  const token = await accessToken(env);
  const path = `${c.root}/users/${uid}/profile`;

  // Mavjud profilni o'qib, faqat berilgan maydonlarni yangilaymiz —
  // aks holda telefon yoki mashina tasodifan o'chib ketardi.
  const existing = (await rtdbGet(c.dbUrl, path, token)) || {};

  const profile = {
    uid: Number(uid),
    name:
      clean(body.full_name, 120) ||
      clean([user.first_name, user.last_name].filter(Boolean).join(" "), 120) ||
      existing.name ||
      "Mijoz",
    phone: phone || existing.phone || null,
    username: clean(user.username, 60) || existing.username || "",
    carId: body.car_id != null ? Number(body.car_id) : (existing.carId ?? null),
    carName: clean(body.car_name, 80) || existing.carName || null,
    source: "zimmer",
    updatedAt: { ".sv": "timestamp" },
  };

  const res = await rtdbPatch(c.dbUrl, path, profile, token);
  if (!res.ok) {
    const text = await res.text();
    return json({ ok: false, error: "profil saqlanmadi", detail: text.slice(0, 200) }, 502);
  }
  return json({ ok: true, profile: { ...profile, updatedAt: Date.now() } });
}

// =====================================================================
//  POST /order — BUYURTMA (asosiy qism)
//
//  Oqim:
//    1. initData tekshiriladi (imzo + yangilik)
//    2. Katalog Firebase'dan o'qiladi -> HAQIQIY narx va qoldiq
//    3. Summa SERVER tomonda hisoblanadi (mijoz yuborgani e'tiborsiz)
//    4. Qoldiq tekshiriladi
//    5. Buyurtma yoziladi (idempotent kalit bilan — ikki marta bosilsa
//       ham bitta buyurtma bo'ladi)
//    6. Qoldiq atomik kamaytiriladi ({".sv":{"increment":-n}})
//    7. Adminlarga va mijozga Telegram xabari
// =====================================================================
async function handleOrder(request, env) {
  const c = cfg(env);
  if (!c.dbUrl) return json({ ok: false, error: "FIREBASE_DB_URL sozlanmagan" }, 500);

  const body = await readJson(request);
  const verified = await verifyInitData(body.initData, env);
  if (!verified.ok) return json({ ok: false, error: verified.error }, 401);

  const uid = String(verified.user.id);
  const user = verified.user;

  // ---- Kiruvchi ma'lumotni tekshirish
  const rawItems = Array.isArray(body.items) ? body.items : [];
  if (!rawItems.length) return json({ ok: false, error: "Savatcha bo'sh" }, 400);
  if (rawItems.length > 50) return json({ ok: false, error: "Juda ko'p tovar" }, 400);

  const address = clean(body.address, 400);
  if (!address || address.length < 5) {
    return json({ ok: false, error: "Manzilni to'liqroq kiriting" }, 400);
  }

  const phone = normalizePhone(body.phone);
  if (!phone) return json({ ok: false, error: "Telefon raqam noto'g'ri" }, 400);

  const deliveryMethod = ["courier", "bts"].includes(body.delivery_method)
    ? body.delivery_method
    : null;
  const deliveryInfo = clean(body.delivery_info, 400);
  const paymentMethod = clean(body.payment_method, 120);

  const token = await accessToken(env);

  // ---- Katalogni o'qiymiz: narx va qoldiq FAQAT shu yerdan olinadi
  const catalog = await rtdbGet(c.dbUrl, `${c.root}/catalog/products`, token);
  if (!catalog || typeof catalog !== "object") {
    return json(
      { ok: false, error: "Katalog o'qilmadi — botga /firebase yuborilishi kerak" },
      503
    );
  }

  const lines = [];
  const problems = [];
  let total = 0;

  for (const entry of rawItems) {
    const pid = String(parseInt(entry && entry.product_id, 10));
    const qty = Math.max(1, Math.min(999, parseInt(entry && entry.qty, 10) || 0));
    const product = catalog[pid];

    if (!product || product.deleted || product.is_active === 0 || product.is_active === false) {
      problems.push({ product_id: pid, reason: "topilmadi" });
      continue;
    }
    const stock = Number(product.stock) || 0;
    if (stock < qty) {
      problems.push({ product_id: pid, name: product.name, reason: "yetarli emas", stock });
      continue;
    }

    // NARX KATALOGDAN — mijoz yuborgan narx umuman o'qilmaydi
    const price = Number(product.price) || 0;
    total += price * qty;
    lines.push({ product_id: Number(pid), name: String(product.name || ""), price, qty });
  }

  if (problems.length || !lines.length) {
    return json(
      {
        ok: false,
        error: "order_failed",
        message: "Ba'zi mahsulotlar yetarli emas. Savatchani yangilang.",
        problems,
      },
      409
    );
  }

  // ---- Idempotent kalit: ikki marta bosilsa bitta buyurtma bo'ladi
  const clientKey = clean(body.client_key, 40).replace(/[^A-Za-z0-9_-]/g, "") || null;
  const code = orderCode(uid, clientKey);
  // DIQQAT: ALOHIDA tugun — `{root}/orders` ni bot o'zi ishlatadi
  // (`sync._put_order` raqamli SQLite id bilan yozadi, `restore_orders`
  // esa raqamli id kutadi). Worker buyurtmalari hali SQLite'da yo'q va
  // raqamli id ham yo'q, shuning uchun ularni aralashtirmaymiz.
  const orderPath = `${c.root}/pending_orders/${uid}_${code}`;

  const already = await rtdbGet(c.dbUrl, orderPath, token);
  if (already && already.code) {
    // Allaqachon yozilgan — qayta yozmaymiz va qoldiqni QAYTA kamaytirmaymiz
    return json({ ok: true, order: { code: already.code, total: already.total }, repeated: true });
  }

  const record = {
    code,
    uid: Number(uid),
    customer_name: clean(
      body.full_name || [user.first_name, user.last_name].filter(Boolean).join(" "),
      120
    ) || "Mijoz",
    username: clean(user.username, 60) || "",
    phone,
    address,
    delivery_method: deliveryMethod,
    delivery_info: deliveryInfo || null,
    payment_method: paymentMethod || null,
    items: lines,
    total,
    // Statusni FAQAT server qo'yadi — mijoz "yetkazildi" deb yozib qo'ya olmaydi
    status: "new",
    source: "miniapp_offline",
    // Bu maydonni ham FAQAT server qo'yadi (Avto_A1 da mijoz yozib botning
    // xabarini o'chirib qo'yardi)
    notified_admin: false,
    // Bot buni SQLite ga ko'chirgach true qo'yadi
    imported: false,
    createdAt: { ".sv": "timestamp" },
  };

  const put = await rtdbPut(c.dbUrl, orderPath, record, token);
  if (!put.ok) {
    const text = await put.text();
    // Xato YUTILMAYDI
    return json({ ok: false, error: "buyurtma saqlanmadi", detail: text.slice(0, 200) }, 502);
  }

  // ---- Qoldiqni atomik kamaytiramiz (server-side increment)
  // Bu mirror nusxasi; asosiy manba SQLite. Bot ko'tarilganda moslashtiradi.
  for (const line of lines) {
    try {
      await rtdbPatch(
        c.dbUrl,
        `${c.root}/catalog/products/${line.product_id}`,
        { stock: { ".sv": { increment: -line.qty } } },
        token
      );
    } catch (_) {
      // Qoldiq kamaymasa ham buyurtma allaqachon saqlangan — bot tuzatadi
    }
  }

  // ---- Telegram xabarlari
  const notified = await notifyOrder(env, c, record);
  if (notified) {
    await rtdbPatch(c.dbUrl, orderPath, { notified_admin: true }, token).catch(() => {});
  }

  return json(
    {
      ok: true,
      order: { code, total, total_label: fmtPrice(total) },
      notified,
    },
    201
  );
}

// =====================================================================
//  ADMIN QATLAMI — Render'siz katalog boshqaruvi
//
//  NEGA KATALOGGA TO'G'RIDAN YOZILMAYDI (eng muhim qaror):
//  Bot katalogni `services/sync.py` da `method="put"` bilan yuboradi
//  (`push_catalog`, `push_all_catalog`) — ya'ni `zimmer/catalog/products`
//  tuguni USTIDAN to'liq qayta yoziladi. Zimmer'da haqiqiy manba SQLite,
//  Firebase esa uning ko'zgusi.
//
//  Shuning uchun admin qo'shgan tovarni to'g'ridan `catalog/products` ga
//  yozish XATO bo'lardi: Render uyg'onib birinchi sinxron qilganda tovar
//  JIMGINA O'CHIB KETARDI va admin buni bilmasdi.
//
//  (Avto_A1 da bu muammo yo'q, chunki uning yagona manbasi RTDB. Bizda
//  esa ikkita manba bor — shu sababli usulni ko'chirib bo'lmaydi.)
//
//  Yechim — `pending_orders` uchun allaqachon ishlaydigan naqsh:
//    zimmer/pending_products/{kalit}  — offline qo'shilgan yangi tovarlar
//    zimmer/pending_edits/{tovar_id}  — mavjud tovarga qilingan tuzatish
//  Ikkisi ham katalog sinxronidan TASHQARIDA — ustidan yozilmaydi. Bot
//  uyg'onganda ularni SQLite ga ko'chiradi (`imported: true` belgisi bilan).
//
//  Yangi tovarga RAQAMLI id BERILMAYDI — kalit `off_<uid>_<hash>`. Aks holda
//  SQLite avto-inkrementi bir kun o'sha raqamga yetib, ikki xil tovar bitta
//  id ga tushib qolardi.
// =====================================================================

/** Har bir admin endpointi uchun yagona darvoza: imzo -> uid -> ADMIN_IDS. */
async function requireAdmin(request, env) {
  const c = cfg(env);
  if (!c.dbUrl) {
    return { error: json({ ok: false, error: "FIREBASE_DB_URL sozlanmagan" }, 500) };
  }
  const body = await readJson(request);
  const verified = await verifyInitData(body.initData, env);
  if (!verified.ok) return { error: json({ ok: false, error: verified.error }, 401) };

  const uid = String(verified.user.id);
  // uid HMAC imzosidan olinadi — mijoz yuborgan qiymatga ISHONILMAYDI.
  // ADMIN_IDS esa Worker env'ida, brauzerda emas.
  if (!c.admins.includes(uid)) {
    return {
      error: json({ ok: false, error: "forbidden", message: "Bu amal faqat admin uchun" }, 403),
    };
  }
  return { c, body, uid, user: verified.user };
}

/** Musbat butun son; noto'g'ri qiymat -> null (0 haqiqiy qiymat sifatida qoladi). */
function toCount(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Math.floor(Number(String(value).replace(/[^\d-]/g, "")));
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

/** Narx: bo'shliq/probel bilan yozilgan "120 000" ni ham tushunadi. */
function toPrice(value) {
  const n = toCount(value);
  return n === null || n <= 0 ? null : n;
}

// ---------------------------------------------------------------------
//  POST /admin/catalog — ombor ko'rinishi (katalog + kutilayotgan tuzatishlar)
// ---------------------------------------------------------------------
async function handleAdminCatalog(request, env) {
  const gate = await requireAdmin(request, env);
  if (gate.error) return gate.error;
  const { c } = gate;

  const token = await accessToken(env);
  const [catalog, edits, pending] = await Promise.all([
    rtdbGet(c.dbUrl, `${c.root}/catalog/products`, token),
    rtdbGet(c.dbUrl, `${c.root}/pending_edits`, token),
    rtdbGet(c.dbUrl, `${c.root}/pending_products`, token),
  ]);

  const items = [];
  if (catalog && typeof catalog === "object") {
    for (const [id, row] of Object.entries(catalog)) {
      if (!row || typeof row !== "object") continue;
      if (row.deleted) continue;
      // Kutilayotgan tuzatish BOR bo'lsa — admin o'zi kiritgan qiymatni
      // ko'rsatamiz, aks holda "saqlamadim shekilli" degan taassurot bo'ladi.
      const patch = edits && edits[id] && !edits[id].imported ? edits[id] : null;
      items.push({
        id,
        name: String(row.name || "Nomsiz"),
        price: patch && patch.price != null ? patch.price : Number(row.price || 0),
        stock: patch && patch.stock != null ? patch.stock : Number(row.stock || 0),
        is_active:
          patch && patch.is_active != null ? !!patch.is_active : row.is_active !== 0,
        photo_id: row.photo_id || null,
        photo_url: row.photo_url || null,
        pending: !!patch,
      });
    }
  }

  const drafts = [];
  if (pending && typeof pending === "object") {
    for (const [key, row] of Object.entries(pending)) {
      if (!row || typeof row !== "object" || row.imported) continue;
      drafts.push({
        key,
        name: String(row.name || "Nomsiz"),
        price: Number(row.price || 0),
        stock: Number(row.stock || 0),
        photo_url: row.photo_url || null,
        created_at: row.createdAt || null,
      });
    }
  }

  return json({ ok: true, items, drafts, counts: { items: items.length, drafts: drafts.length } });
}

// ---------------------------------------------------------------------
//  POST /admin/product — Render'siz YANGI tovar qo'shish
// ---------------------------------------------------------------------
async function handleAdminProduct(request, env) {
  const gate = await requireAdmin(request, env);
  if (gate.error) return gate.error;
  const { c, body, uid } = gate;

  const name = clean(body.name, 200);
  if (!name || name.length < 2) {
    return json({ ok: false, error: "Tovar nomini kiriting" }, 400);
  }
  const price = toPrice(body.price);
  if (price === null) return json({ ok: false, error: "Narxni to'g'ri kiriting" }, 400);

  const stock = toCount(body.stock);
  if (stock === null) return json({ ok: false, error: "Qoldiqni to'g'ri kiriting" }, 400);

  // Rasm: faqat http(s) havola. `javascript:` va `data:` ataylab rad etiladi.
  const photoUrl = clean(body.photo_url, 600);
  if (photoUrl && !/^https:\/\/[^\s]+$/i.test(photoUrl)) {
    return json({ ok: false, error: "Rasm havolasi https:// bilan boshlanishi kerak" }, 400);
  }

  // Idempotentlik: tarmoq uzilib qayta yuborilsa ikkinchi nusxa yaralmaydi.
  const key = "off_" + uid + "_" + shortHash(uid + ":" + (body.client_key || name + price));
  const token = await accessToken(env);
  const path = `${c.root}/pending_products/${key}`;

  const exists = await rtdbGet(c.dbUrl, path, token);
  if (exists && typeof exists === "object") {
    return json({ ok: true, key, duplicate: true, product: { name, price, stock } });
  }

  const record = {
    name,
    price,
    stock,
    description: clean(body.description, 2000) || "",
    photo_url: photoUrl || null,
    category_id: toCount(body.category_id),
    // Bu maydonlarni FAQAT server qo'yadi — mijoz yuborgani e'tiborsiz.
    created_by: Number(uid),
    createdAt: { ".sv": "timestamp" },
    source: "miniapp_offline",
    imported: false,
  };

  const res = await rtdbPut(c.dbUrl, path, record, token);
  if (!res.ok) {
    return json({ ok: false, error: "Firebase yozmadi", status: res.status }, 502);
  }

  await notifyAdmins(
    env,
    c,
    "🆕 <b>Yangi tovar qo'shildi</b> (zaxira rejim)\n\n" +
      `📦 ${escHtml(name)}\n` +
      `💰 ${fmtPrice(price)}\n` +
      `📊 Qoldiq: ${stock}\n\n` +
      "<i>Server uyg'onganda katalogga o'tadi.</i>"
  ).catch(() => {});

  return json({ ok: true, key, product: { name, price, stock } }, 201);
}

// ---------------------------------------------------------------------
//  POST /admin/edit — mavjud tovarning narx/qoldiq/ko'rinishini o'zgartirish
// ---------------------------------------------------------------------
async function handleAdminEdit(request, env) {
  const gate = await requireAdmin(request, env);
  if (gate.error) return gate.error;
  const { c, body, uid } = gate;

  const id = clean(body.id, 40);
  if (!id || !/^[A-Za-z0-9_-]+$/.test(id)) {
    return json({ ok: false, error: "Tovar id noto'g'ri" }, 400);
  }

  const patch = {};
  if (body.price !== undefined) {
    const price = toPrice(body.price);
    if (price === null) return json({ ok: false, error: "Narxni to'g'ri kiriting" }, 400);
    patch.price = price;
  }
  if (body.stock !== undefined) {
    const stock = toCount(body.stock);
    if (stock === null) return json({ ok: false, error: "Qoldiqni to'g'ri kiriting" }, 400);
    patch.stock = stock;
  }
  if (body.is_active !== undefined) patch.is_active = !!body.is_active;

  if (!Object.keys(patch).length) {
    return json({ ok: false, error: "O'zgartirish uchun maydon berilmadi" }, 400);
  }

  const token = await accessToken(env);

  // Tovar HAQIQATAN bormi? Yo'q bo'lsa "saqlandi" deb yolg'on aytmaymiz.
  const row = await rtdbGet(c.dbUrl, `${c.root}/catalog/products/${id}`, token);
  if (!row || typeof row !== "object") {
    return json({ ok: false, error: "Bunday tovar katalogda yo'q" }, 404);
  }

  patch.updatedAt = { ".sv": "timestamp" };
  patch.updated_by = Number(uid);
  patch.imported = false;

  const res = await rtdbPatch(c.dbUrl, `${c.root}/pending_edits/${id}`, patch, token);
  if (!res.ok) {
    return json({ ok: false, error: "Firebase yozmadi", status: res.status }, 502);
  }
  return json({ ok: true, id, applied: patch });
}

// ---------------------------------------------------------------------
//  POST /admin/orders — zaxira rejimda tushgan buyurtmalar
// ---------------------------------------------------------------------
async function handleAdminOrders(request, env) {
  const gate = await requireAdmin(request, env);
  if (gate.error) return gate.error;
  const { c } = gate;

  const token = await accessToken(env);
  const node = await rtdbGet(c.dbUrl, `${c.root}/pending_orders`, token);

  const orders = [];
  if (node && typeof node === "object") {
    for (const [key, row] of Object.entries(node)) {
      if (!row || typeof row !== "object") continue;
      orders.push({
        key,
        code: row.code || key,
        uid: row.uid || null,
        name: row.customer_name || row.name || "",
        phone: row.phone || "",
        address: row.address || "",
        total: Number(row.total || 0),
        total_label: fmtPrice(Number(row.total || 0)),
        status: row.status || "new",
        items: Array.isArray(row.items) ? row.items : [],
        created_at: row.createdAt || null,
        imported: !!row.imported,
      });
    }
    // Yangi buyurtma TEPADA turishi kerak.
    orders.sort((a, b) => Number(b.created_at || 0) - Number(a.created_at || 0));
  }

  return json({ ok: true, orders, count: orders.length });
}

// ---------------------------------------------------------------------
//  POST /admin/order-status — buyurtma holatini o'zgartirish
// ---------------------------------------------------------------------
const ORDER_STATUSES = ["new", "accepted", "delivering", "done", "cancelled"];

async function handleAdminOrderStatus(request, env) {
  const gate = await requireAdmin(request, env);
  if (gate.error) return gate.error;
  const { c, body, uid } = gate;

  const key = clean(body.key, 120);
  if (!key || !/^[A-Za-z0-9_-]+$/.test(key)) {
    return json({ ok: false, error: "Buyurtma kaliti noto'g'ri" }, 400);
  }
  const status = clean(body.status, 20);
  if (!ORDER_STATUSES.includes(status)) {
    return json(
      { ok: false, error: "Holat noto'g'ri", allowed: ORDER_STATUSES },
      400
    );
  }

  const token = await accessToken(env);
  const path = `${c.root}/pending_orders/${key}`;
  const row = await rtdbGet(c.dbUrl, path, token);
  if (!row || typeof row !== "object") {
    return json({ ok: false, error: "Bunday buyurtma yo'q" }, 404);
  }

  const res = await rtdbPatch(
    c.dbUrl,
    path,
    { status, status_by: Number(uid), status_at: { ".sv": "timestamp" } },
    token
  );
  if (!res.ok) {
    return json({ ok: false, error: "Firebase yozmadi", status: res.status }, 502);
  }

  // Mijozga xabar — buyurtma holatini bilmay qolmasin.
  const TEXT = {
    accepted: "✅ Buyurtmangiz qabul qilindi",
    delivering: "🚚 Buyurtmangiz yo'lda",
    done: "🎉 Buyurtmangiz yetkazildi",
    cancelled: "❌ Buyurtmangiz bekor qilindi",
  };
  if (TEXT[status] && row.uid) {
    await sendMessage(env, row.uid, `${TEXT[status]}\n\n🧾 ${escHtml(row.code || key)}`).catch(
      () => {}
    );
  }

  return json({ ok: true, key, status });
}

/** Barcha adminlarga bir xil xabar. */
async function notifyAdmins(env, c, text) {
  if (!env.BOT_TOKEN || !c.admins.length) return false;
  await Promise.all(c.admins.map((id) => sendMessage(env, id, text).catch(() => {})));
  return true;
}

/** Qisqa, barqaror hash — idempotent kalitlar uchun. */
function shortHash(text) {
  let hash = 5381;
  for (let i = 0; i < text.length; i++) hash = ((hash * 33) ^ text.charCodeAt(i)) >>> 0;
  return hash.toString(36);
}

// ---------------------------------------------------------------------
//  Buyurtma kodi. Idempotent kalit berilsa — DETERMINISTIK (bir xil
//  kalitdan bir xil kod), aks holda vaqt asosida.
// ---------------------------------------------------------------------
function orderCode(uid, clientKey) {
  const seed = clientKey || String(Date.now());
  let hash = 5381;
  const text = `${uid}:${seed}`;
  for (let i = 0; i < text.length; i++) hash = ((hash * 33) ^ text.charCodeAt(i)) >>> 0;
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // I,O,0,1 yo'q — chalkashmasin
  let out = "";
  let n = hash;
  for (let i = 0; i < 6; i++) {
    out += chars[n % chars.length];
    n = Math.floor(n / chars.length);
  }
  return "ZM-" + out;
}

async function notifyOrder(env, c, order) {
  if (!env.BOT_TOKEN || !c.admins.length) return false;

  const itemLines = order.items
    .map((i) => `• ${escHtml(i.name)} × ${i.qty} = ${fmtPrice(i.price * i.qty)}`)
    .join("\n");

  const meta = [];
  if (order.delivery_info) meta.push(`🚚 ${escHtml(order.delivery_info)}`);
  if (order.payment_method) meta.push(`💳 To'lov: <b>${escHtml(order.payment_method)}</b>`);

  const who = order.username
    ? `<a href="https://t.me/${escHtml(order.username)}">${escHtml(order.customer_name)}</a>`
    : `<a href="tg://user?id=${order.uid}">${escHtml(order.customer_name)}</a>`;

  const adminText =
    "🔔 <b>Yangi buyurtma</b> (Mini App — server o'chiq)\n\n" +
    `🆔 <code>${order.code}</code>\n` +
    `👤 ${who}\n` +
    `📞 ${escHtml(order.phone)}\n` +
    `📍 ${escHtml(order.address)}\n` +
    (meta.length ? meta.join("\n") + "\n" : "") +
    "\n" +
    itemLines +
    `\n\n💰 Jami: <b>${fmtPrice(order.total)}</b>\n\n` +
    "<i>Bot ko'tarilganda buyurtma bazaga o'zi ko'chiriladi.</i>";

  let anyOk = false;
  for (const chatId of c.admins) {
    const ok = await sendMessage(env, chatId, adminText);
    anyOk = anyOk || ok;
  }

  // Mijozga tasdiq
  await sendMessage(
    env,
    String(order.uid),
    "✅ <b>Buyurtmangiz qabul qilindi!</b>\n\n" +
      `🆔 <code>${order.code}</code>\n` +
      itemLines +
      `\n\n💰 Jami: <b>${fmtPrice(order.total)}</b>\n` +
      `📍 ${escHtml(order.address)}\n\n` +
      "Operator tez orada bog'lanadi."
  );

  return anyOk;
}

async function sendMessage(env, chatId, text) {
  try {
    const res = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: "HTML",
        disable_web_page_preview: true,
      }),
    });
    const data = await res.json();
    return !!(data && data.ok);
  } catch (_) {
    return false;
  }
}

// =====================================================================
//  GET /media?id=<file_id> — Telegram fayl proksisi
//
//  Telegram `file_id` ni faqat bot tokeni bilan ochish mumkin. Render
//  o'chganda `/api/media/...` ishlamaydi va ilovada BARCHA rasmlar
//  yo'qoladi. Bu endpoint shu muammoni hal qiladi: token faqat Worker
//  ichida qoladi, `file_path` har so'rovda qayta olinadi (link
//  eskirmaydi), `Range` uzatiladi (video suriladi).
// =====================================================================
async function handleMedia(request, env) {
  const mediaCors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
    "Access-Control-Allow-Headers": "Range, Content-Type",
  };
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Faqat GET", { status: 405, headers: mediaCors });
  }
  if (!env.BOT_TOKEN) {
    return new Response("BOT_TOKEN sozlanmagan", { status: 500, headers: mediaCors });
  }

  const fileId = new URL(request.url).searchParams.get("id");
  if (!fileId) return new Response("?id= yo'q", { status: 400, headers: mediaCors });

  const gfRes = await fetch(
    `https://api.telegram.org/bot${env.BOT_TOKEN}/getFile?file_id=${encodeURIComponent(fileId)}`
  );
  const gf = await gfRes.json();
  if (!gf || !gf.ok || !gf.result || !gf.result.file_path) {
    return new Response("Fayl topilmadi", { status: 404, headers: mediaCors });
  }
  const filePath = gf.result.file_path;

  const range = request.headers.get("Range");
  const upstream = await fetch(
    `https://api.telegram.org/file/bot${env.BOT_TOKEN}/${filePath}`,
    { method: request.method, headers: range ? { Range: range } : {} }
  );

  const headers = new Headers(mediaCors);
  headers.set("Accept-Ranges", "bytes");
  headers.set("Cache-Control", "public, max-age=86400");
  const ct = upstream.headers.get("Content-Type");
  headers.set("Content-Type", ct && ct !== "application/octet-stream" ? ct : guessMime(filePath));
  for (const name of ["Content-Length", "Content-Range"]) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }
  return new Response(upstream.body, { status: upstream.status, headers });
}

function guessMime(p) {
  const ext = (p.split(".").pop() || "").toLowerCase();
  return (
    {
      mp4: "video/mp4",
      mov: "video/quicktime",
      webm: "video/webm",
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      png: "image/png",
      webp: "image/webp",
      gif: "image/gif",
    }[ext] || "application/octet-stream"
  );
}

// =====================================================================
//  Telegram initData tekshiruvi
//    secretKey = HMAC_SHA256(key="WebAppData", msg=botToken)
//    hash      = HMAC_SHA256(key=secretKey,   msg=sorted("k=v") joined LF)
// =====================================================================
async function verifyInitData(initData, env) {
  if (!env.BOT_TOKEN) return { ok: false, error: "BOT_TOKEN sozlanmagan" };
  if (!initData || typeof initData !== "string") return { ok: false, error: "initData yo'q" };

  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) return { ok: false, error: "hash yo'q" };
  params.delete("hash");

  const pairs = [];
  for (const [k, v] of params) pairs.push(`${k}=${v}`);
  pairs.sort();
  const dataCheckString = pairs.join(String.fromCharCode(10));

  const enc = new TextEncoder();
  const secretKey = await hmac(enc.encode("WebAppData"), enc.encode(env.BOT_TOKEN));
  const computed = toHex(await hmac(secretKey, enc.encode(dataCheckString)));

  if (!constantTimeEqual(computed, hash)) return { ok: false, error: "imzo mos kelmadi" };

  const { maxAge } = cfg(env);
  const authDate = parseInt(params.get("auth_date") || "0", 10);
  const now = Math.floor(Date.now() / 1000);
  if (!authDate || now - authDate > maxAge) return { ok: false, error: "initData eskirgan" };

  let user;
  try {
    user = JSON.parse(params.get("user") || "null");
  } catch (_) {
    user = null;
  }
  if (!user || !user.id) return { ok: false, error: "user yo'q" };

  return { ok: true, user };
}

function constantTimeEqual(a, b) {
  a = String(a);
  b = String(b);
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function hmac(keyBytes, msgBytes) {
  const key = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  return crypto.subtle.sign("HMAC", key, msgBytes);
}

function toHex(buf) {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// =====================================================================
//  Firebase: custom token va access token
// =====================================================================
async function createCustomToken(uid, env) {
  const now = Math.floor(Date.now() / 1000);
  return signJwt(
    {
      iss: env.FIREBASE_CLIENT_EMAIL,
      sub: env.FIREBASE_CLIENT_EMAIL,
      aud:
        "https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit",
      iat: now,
      exp: now + 3600,
      uid,
    },
    env
  );
}

// Access token KESHLANADI. Avto_A1 da har so'rovda RSA imzo + Google'ga
// murojaat qilinardi — bu keraksiz kechikish va kvota sarfi.
let _tokenCache = { value: null, exp: 0 };

/**
 * @param force  Keshni CHETLAB O'TIB, yangi token oladi.
 *
 *  Nega kerak: kesh modul darajasida turadi va bir soat yashaydi. Shu
 *  sababli `/health?deep=1` keshdagi ESKI (ishlaydigan) tokenni qaytarib,
 *  kalit buzuq bo'lsa ham «hammasi joyida» deb ko'rsatardi — ya'ni tashxis
 *  yolg'on gapirardi. Kalit almashtirilgan holatda ham xuddi shu muammo
 *  bo'lardi: Worker bir soatgacha eski tokendan foydalanib turardi.
 */
async function accessToken(env, force) {
  const now = Math.floor(Date.now() / 1000);
  if (!force && _tokenCache.value && _tokenCache.exp - 60 > now) return _tokenCache.value;

  const jwt = await signJwt(
    {
      iss: env.FIREBASE_CLIENT_EMAIL,
      // DIQQAT — IKKI scope ham SHART, bo'shliq bilan ajratiladi.
      //
      // `userinfo.email` tushib qolsa Google tokenni MUAMMOSIZ beradi
      // (ya'ni bu bosqichda xato ko'rinmaydi), lekin RTDB o'sha token bilan
      // kelgan har qanday so'rovni 401 bilan rad etadi. Xato kalitda emas,
      // aynan shu yerda bo'lgani uchun uni topish qiyin edi.
      scope:
        "https://www.googleapis.com/auth/userinfo.email" +
        " https://www.googleapis.com/auth/firebase.database",
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
    },
    env
  );

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body:
      "grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=" +
      encodeURIComponent(jwt),
  });
  const data = await res.json();
  if (!data || !data.access_token) {
    throw new Error("access_token olinmadi: " + JSON.stringify(data).slice(0, 200));
  }
  _tokenCache = { value: data.access_token, exp: now + (data.expires_in || 3600) };
  return data.access_token;
}

async function signJwt(payload, env) {
  if (!env.FIREBASE_CLIENT_EMAIL || !env.FIREBASE_PRIVATE_KEY) {
    throw new Error("FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY sozlanmagan");
  }
  const enc = new TextEncoder();
  const head = b64url(enc.encode(JSON.stringify({ alg: "RS256", typ: "JWT" })));
  const body = b64url(enc.encode(JSON.stringify(payload)));
  const input = `${head}.${body}`;
  const key = await importPrivateKey(env.FIREBASE_PRIVATE_KEY);
  const sig = await crypto.subtle.sign({ name: "RSASSA-PKCS1-v1_5" }, key, enc.encode(input));
  return `${input}.${b64url(new Uint8Array(sig))}`;
}

async function importPrivateKey(pem) {
  // Cloudflare panelida private_key ko'pincha "\n" matni sifatida saqlanadi —
  // uni haqiqiy yangi qatorga aylantiramiz.
  const clean = String(pem)
    .split(String.fromCharCode(92) + "n")
    .join(String.fromCharCode(10))
    .replace("-----BEGIN PRIVATE KEY-----", "")
    .replace("-----END PRIVATE KEY-----", "")
    .replace(/\s+/g, "");
  return crypto.subtle.importKey(
    "pkcs8",
    b64bytes(clean),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );
}

function b64url(bytes) {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let bin = "";
  for (let i = 0; i < arr.length; i++) bin += String.fromCharCode(arr[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64bytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// =====================================================================
//  RTDB REST — token SARLAVHADA (URL'da emas: loglarga tushmasin)
// =====================================================================
function rtdbUrl(dbUrl, path) {
  return `${dbUrl}/${String(path).replace(/^\/+/, "")}.json`;
}

function authHeaders(token, extra) {
  return { Authorization: `Bearer ${token}`, ...(extra || {}) };
}

async function rtdbGet(dbUrl, path, token) {
  const res = await fetch(rtdbUrl(dbUrl, path), { headers: authHeaders(token) });
  if (!res.ok) return null;
  return res.json();
}

function rtdbPut(dbUrl, path, value, token) {
  return fetch(rtdbUrl(dbUrl, path), {
    method: "PUT",
    headers: authHeaders(token, { "Content-Type": "application/json" }),
    body: JSON.stringify(value),
  });
}

function rtdbPatch(dbUrl, path, value, token) {
  return fetch(rtdbUrl(dbUrl, path), {
    method: "PATCH",
    headers: authHeaders(token, { "Content-Type": "application/json" }),
    body: JSON.stringify(value),
  });
}

// =====================================================================
//  Yordamchilar
// =====================================================================
async function readJson(request) {
  try {
    const body = await request.json();
    return body && typeof body === "object" ? body : {};
  } catch (_) {
    return {};
  }
}

function clean(value, max) {
  return String(value == null ? "" : value)
    .trim()
    .slice(0, max || 200);
}

/** `utils/helpers.py:normalize_phone` bilan bir xil mantiq: +998XXXXXXXXX */
function normalizePhone(raw) {
  const digits = String(raw == null ? "" : raw).replace(/\D/g, "");
  if (!digits) return null;
  if (digits.length === 9) return "+998" + digits;
  if (digits.length === 12 && digits.startsWith("998")) return "+" + digits;
  if (digits.length === 13 && digits.startsWith("0998")) return "+" + digits.slice(1);
  return null;
}

/** `utils/helpers.py:fmt_price` bilan bir xil: 120000 -> "120 000 so'm" */
function fmtPrice(value) {
  const n = Math.round(Number(value) || 0);
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, " ") + " so'm";
}

function escHtml(text) {
  return String(text == null ? "" : text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
