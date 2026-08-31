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
const VERSION = "1.8.0";
const FEATURES = [
  "order",
  /* Razmerli tovarlar: buyurtma qatorida `size` bo'ladi va qoldiq AYNAN
     o'sha razmerdan kamayadi (`catalog/products/{id}/sizes`). Bu belgi
     bo'lmasa Mini App eski Worker turganini biladi. */
  "order_sizes",
  "me",
  "profile",
  "media",
  "admin_detect",
  // Render'siz admin amallari — katalogni telefondan boshqarish
  "admin_catalog",
  "admin_product_add",
  "admin_edit",
  "admin_orders",
  // 1.4.0 — buyurtmalar: `pending_orders` VA `orders` birlashtirilib beriladi
  // (yopiq tugunni Worker service-account bilan o'qiydi), holat o'zgartirish
  // esa `kind` (order|biled|booking) bo'yicha to'g'ri tugunga yoziladi.
  // Mini App shu belgilarga qarab Cloudflare'da ESKI nusxa turganini
  // aniqlaydi va aniq aytadi.
  "admin_orders_merged",
  "admin_status_kind",
  // 1.5.0 — story'ga javob va Mini App ichidan VIDEO yuklash
  "story_reply",
  "admin_upload",
  // 1.8.0 — reviewed root-level atomic commits and strict catalog validation.
  "order_cas_reservation",
  "admin_catalog_write",
  "secure_booking",
  "secure_biled_order",
  "order_atomic_root",
  "booking_atomic_root",
  "admin_status_atomic_compensation",
  "catalog_write_validated",
];

/** Mini App'dan yuklanadigan fayl chegarasi.
 *  Telegram Bot API `sendVideo` uchun 50 MB beradi, lekin Worker'ning
 *  xotirasi 128 MB — fayl kirish va chiqishda ikki marta buferlanadi.
 *  Shu sababli 32 MB da to'xtaymiz va sababini AYTAMIZ (jimgina
 *  yiqilgandan ko'ra). Kattaroq video botga tashlanadi. */
const MAX_UPLOAD_BYTES = 32 * 1024 * 1024;

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
      if (path === "/booking") return handleBooking(request, env);
      if (path === "/biled-order") return handleBiledOrder(request, env);
      // Story'ga javob: adminga QAYSI story'dan kelganini bildirib yuboradi
      if (path === "/story-reply") return handleStoryReply(request, env);

      // ---- Admin: Render'siz katalog boshqaruvi. Har biri imzoni tekshirib,
      // uid ni ADMIN_IDS bilan solishtiradi (`requireAdmin`).
      if (path === "/admin/catalog") return handleAdminCatalog(request, env);
      if (path === "/admin/product") return handleAdminProduct(request, env);
      if (path === "/admin/edit") return handleAdminEdit(request, env);
      if (path === "/admin/catalog-write") return handleAdminCatalogWrite(request, env);
      // Mini App ichidan video/rasm yuklash (bot orqali file_id olinadi)
      if (path === "/admin/upload") return handleAdminUpload(request, env);
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
          .filter((o) => o.status !== "processing" && o.status !== "failed")
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
/** Tovarning razmerlar ro'yxati: `[{size, stock}]`.
 *
 *  RTDB bo'sh kataklari bor massivni LUG'AT qilib qaytaradi
 *  (`{"0":{...},"2":{...}}`), shuning uchun ikki shaklni ham tekislaymiz.
 *  INDEKS SAQLANADI: qoldiqni kamaytirishda aynan `sizes/{i}/stock` yo'li
 *  kerak bo'ladi. */
function sizesOfProduct(product) {
  const raw = product && product.sizes;
  let entries = [];
  if (Array.isArray(raw)) entries = raw.map((v, i) => [i, v]);
  else if (raw && typeof raw === "object") entries = Object.keys(raw).map((k) => [k, raw[k]]);

  return entries
    .filter(([, v]) => v && typeof v === "object" && String(v.size || "").trim())
    .map(([key, v]) => ({
      key: String(key), // RTDB dagi kalit (massiv indeksi yoki lug'at kaliti)
      size: String(v.size).trim(),
      stock: Math.max(0, Number(v.stock) || 0),
    }));
}

async function handleOrder(request, env) {
  const c = cfg(env);
  if (!c.dbUrl) return json({ ok: false, error: "FIREBASE_DB_URL sozlanmagan" }, 500);

  const body = await readJson(request);
  const verified = await verifyInitData(body.initData, env);
  if (!verified.ok) return json({ ok: false, error: verified.error }, 401);

  const uid = String(verified.user.id);
  const rawItems = Array.isArray(body.items) ? body.items : [];
  if (!rawItems.length || rawItems.length > 50) {
    return json({ ok: false, error: rawItems.length ? "Juda ko'p tovar" : "Savatcha bo'sh" }, 400);
  }

  const items = [];
  for (const raw of rawItems) {
    const productId = parseInt(raw && raw.product_id, 10);
    const qty = parseInt(raw && raw.qty, 10);
    if (!Number.isInteger(productId) || productId < 1 || !Number.isInteger(qty) || qty < 1 || qty > 999) {
      return json({ ok: false, error: "Tovar yoki miqdor noto'g'ri" }, 400);
    }
    items.push({ product_id: productId, qty, size: clean(raw && raw.size, 40) || null });
  }

  const address = clean(body.address, 400);
  if (address.length < 5) return json({ ok: false, error: "Manzilni to'liqroq kiriting" }, 400);
  const phone = normalizePhone(body.phone);
  if (!phone) return json({ ok: false, error: "Telefon raqam noto'g'ri" }, 400);

  /* Kalit majburiy va tasodifiy bo'lishi kerak. Savat/manzildan yasalgan
     deterministik kalit keyingi real buyurtmani eski yozuvga ulab qo'yadi. */
  const clientKey = clean(body.client_key, 64).replace(/[^A-Za-z0-9_-]/g, "");
  if (clientKey.length < 16) {
    return json({ ok: false, error: "client_key_required", message: "Checkout kaliti yo'q" }, 400);
  }

  const deliveryMethod = ["courier", "bts"].includes(body.delivery_method)
    ? body.delivery_method
    : null;
  const requestShape = {
    items,
    address,
    phone,
    delivery_method: deliveryMethod,
    delivery_info: clean(body.delivery_info, 400) || null,
    payment_method: clean(body.payment_method, 120) || null,
  };
  const requestHash = await sha256Hex(JSON.stringify(requestShape));
  const orderKey = `${uid}_${clientKey}`;
  const orderPath = `${c.root}/pending_orders/${orderKey}`;
  const token = await accessToken(env);

  /* 1) Order claim: faqat `null_etag` egasi yaratadi. Parallel retrylar
     bitta claimni ko'radi; payload almashtirilsa fail-closed. */
  const claim = {
    code: orderCode(uid, clientKey),
    uid: Number(uid),
    client_key: clientKey,
    request_hash: requestHash,
    claim_state: "claimed",
    status: "processing",
    source: "miniapp_offline",
    imported: false,
    notified_admin: false,
    createdAt: { ".sv": "timestamp" },
  };
  const claimResult = await rtdbCreate(c.dbUrl, orderPath, claim, token);
  let current = claimResult.value;
  if (!claimResult.created) {
    if (!current) return json({ ok: false, error: "order_claim_missing" }, 409);
    if (current.request_hash !== requestHash) {
      /* Yetarli qoldiq bo'lmagani uchun reservation qilinmagan urinishda
         mijoz savatini tuzatishi mumkin. Ayni client_key claimi CAS bilan
         yangi payloadga qayta bog'lanadi; reserved orderda esa qat'iy conflict. */
      if (current.status !== "failed" || current.reservation_state !== "failed") {
        return json({ ok: false, error: "idempotency_conflict", message: "Bu checkout kaliti boshqa buyurtmaga tegishli" }, 409);
      }
      current = await casPatchObject(c.dbUrl, orderPath, token, (row) => {
        if (row.status !== "failed" || row.reservation_state !== "failed") {
          throw new Error("order claim o'zgardi");
        }
        return { ...claim, createdAt: row.createdAt || claim.createdAt };
      });
    }
    if (current.status === "cancelled" || current.status === "delivered") {
      return json({ ok: false, error: "order_final", message: "Bu buyurtma yakunlangan" }, 409);
    }
    if (current.reservation_state === "reserved" && current.status !== "failed") {
      let notified = !!current.notified_admin;
      if (!notified) {
        notified = await notifyOrder(env, c, current);
        if (notified) {
          current = await casPatchObject(c.dbUrl, orderPath, token, (row) => ({ ...row, notified_admin: true }));
        }
      }
      return json({
        ok: true,
        order: { code: current.code, total: current.total, total_label: fmtPrice(current.total) },
        notified,
        repeated: true,
      });
    }
  }

  /* 2) Finalize + qoldiq kamayishi (umumiy VA razmer) + exactly-once
     rezerv markeri BITTA root ETag CAS ichida. Bir xil kalit + bir xil
     normalizatsiyalangan payload idempotent replay bo'ladi; boshqa payload
     esa yuqorida idempotency_conflict qaytaradi. */
  const user = verified.user;
  const finalizeFields = {
    customer_name: clean(
      body.full_name || [user.first_name, user.last_name].filter(Boolean).join(" "),
      120
    ) || "Mijoz",
    username: clean(user.username, 60) || "",
    phone,
    address,
    delivery_method: deliveryMethod,
    delivery_info: requestShape.delivery_info,
    payment_method: requestShape.payment_method,
  };

  let committed;
  try {
    committed = await commitOrder(c, token, orderKey, requestHash, items, finalizeFields);
  } catch (error) {
    if (error && error.code === "stock") {
      await casPatchObject(c.dbUrl, orderPath, token, (row) => ({
        ...row,
        status: "failed",
        claim_state: "failed",
        reservation_state: "failed",
        problems: error.problems,
        status_at: { ".sv": "timestamp" },
      }));
      return json({
        ok: false,
        error: "order_failed",
        message: "Ba'zi mahsulotlar yetarli emas. Savatchani yangilang.",
        problems: error.problems,
      }, 409);
    }
    if (error && error.code === "order_final") {
      return json({ ok: false, error: "order_final", message: "Bu buyurtma bekor qilingan" }, 409);
    }
    throw error;
  }

  const record = committed.record;
  let notified = !!record.notified_admin;
  if (!notified) {
    notified = await notifyOrder(env, c, record);
    if (notified) {
      await casPatchObject(c.dbUrl, orderPath, token, (row) => ({ ...row, notified_admin: true }));
    }
  }

  return json({
    ok: true,
    order: { code: record.code, total: record.total, total_label: fmtPrice(record.total) },
    notified,
  }, claimResult.created && !committed.repeated ? 201 : 200);
}

/** Buyurtma yozuvini finalize qiladi, qoldiqni kamaytiradi (umumiy VA
    razmer) va exactly-once rezerv markerini BITTA root ETag CAS ichida
    yozadi. Crash bo'lsa ham "kamaygan qoldiq + yashirin processing claim"
    holati QOLMAYDI: hammasi bitta shartli PUT bilan commit bo'ladi. */
async function commitOrder(c, token, orderKey, requestHash, requested, finalizeFields) {
  for (let attempt = 0; attempt < 10; attempt++) {
    const snap = await rtdbGetEtag(c.dbUrl, c.root, token);
    const root = snap.value && typeof snap.value === "object" ? snap.value : {};
    const products = root.catalog && root.catalog.products;
    if (!products || typeof products !== "object") throw new Error("Katalog o'qilmadi");
    const pending = root.pending_orders && typeof root.pending_orders === "object"
      ? root.pending_orders
      : (root.pending_orders = {});
    const orderRow = pending[orderKey];
    if (!orderRow || typeof orderRow !== "object" || orderRow.request_hash !== requestHash) {
      throw new Error("order claim o'zgardi");
    }
    const markers = root.order_reservations && typeof root.order_reservations === "object"
      ? root.order_reservations
      : (root.order_reservations = {});
    const existing = markers[orderKey];
    if (existing && existing.state === "reserved") {
      /* Marker faqat yakuniy PUT'da yoziladi — demak buyurtma yozuvi ham
         AYNI o'sha PUT'da finalize bo'lgan. Idempotent replay. */
      return { record: orderRow, repeated: true };
    }
    if (existing && existing.state === "released") {
      throw Object.assign(new Error("order final"), { code: "order_final" });
    }
    if (!["processing", "failed"].includes(orderRow.status)) {
      throw new Error("order claim yakunlangan");
    }

    const grouped = new Map();
    for (const item of requested) {
      const k = `${item.product_id}\u0000${item.size || ""}`;
      const old = grouped.get(k);
      if (old) old.qty += item.qty;
      else grouped.set(k, { ...item });
    }

    const lines = [];
    const problems = [];
    const perProduct = new Map();
    let total = 0;

    for (const item of grouped.values()) {
      const pid = String(item.product_id);
      const product = products[pid];
      if (!product || product.deleted || product.is_active === 0 || product.is_active === false) {
        problems.push({ product_id: pid, reason: "topilmadi" });
        continue;
      }
      const sizes = sizesOfProduct(product);
      let sizeRow = null;
      if (sizes.length) {
        sizeRow = sizes.find((s) => s.size === item.size) || null;
        if (!sizeRow) {
          problems.push({ product_id: pid, name: product.name, reason: item.size ? "razmer topilmadi" : "razmer tanlanmagan", size: item.size });
          continue;
        }
        if (sizeRow.stock < item.qty) {
          problems.push({ product_id: pid, name: product.name, reason: "yetarli emas", size: item.size, stock: sizeRow.stock });
          continue;
        }
      } else if ((Number(product.stock) || 0) < item.qty) {
        problems.push({ product_id: pid, name: product.name, reason: "yetarli emas", stock: Number(product.stock) || 0 });
        continue;
      }

      const used = perProduct.get(pid) || 0;
      perProduct.set(pid, used + item.qty);
      const price = Number(product.price) || 0;
      const line = { product_id: Number(pid), name: String(product.name || ""), price, qty: item.qty };
      if (sizeRow) {
        line.size = sizeRow.size;
        line._sizeKey = sizeRow.key;
      }
      lines.push(line);
      total += price * item.qty;
    }

    for (const [pid, qty] of perProduct) {
      const product = products[pid];
      if ((Number(product.stock) || 0) < qty) {
        problems.push({ product_id: pid, name: product.name, reason: "yetarli emas", stock: Number(product.stock) || 0 });
      }
    }
    if (problems.length || !lines.length) throw Object.assign(new Error("stock"), { code: "stock", problems });

    for (const line of lines) {
      const product = products[String(line.product_id)];
      product.stock = (Number(product.stock) || 0) - line.qty;
      if (line._sizeKey != null) {
        const size = product.sizes && product.sizes[line._sizeKey];
        if (!size || (Number(size.stock) || 0) < line.qty) {
          throw Object.assign(new Error("stock"), {
            code: "stock",
            problems: [{ product_id: line.product_id, name: line.name, reason: "yetarli emas", size: line.size }],
          });
        }
        size.stock = (Number(size.stock) || 0) - line.qty;
      }
    }

    const publicLines = lines.map(({ _sizeKey, ...line }) => line);
    markers[orderKey] = {
      state: "reserved",
      lines: lines.map((line) => ({ ...line })),
      total,
      reservedAt: Date.now(),
    };
    /* Buyurtma yozuvi AYNI shu snapshot/PUT ichida finalize bo'ladi —
       qoldiq kamayishi, rezerv markeri va "new" holati birga commit
       qilinadi. Ikki alohida CAS bo'lsa, oraliqda crash "kamaygan qoldiq +
       processing claim" ni qoldirar edi. */
    pending[orderKey] = {
      ...orderRow,
      ...finalizeFields,
      items: publicLines,
      total,
      status: "new",
      claim_state: "complete",
      reservation_state: "reserved",
      problems: null,
    };
    const put = await rtdbPutIfMatch(c.dbUrl, c.root, root, token, snap.etag);
    if (put.status === 412) continue;
    await ensureOk(put, "Buyurtma saqlanmadi");
    return { record: pending[orderKey], repeated: false };
  }
  throw new Error("Qoldiq band — qayta urinib ko'ring");
}

async function handleOrderLegacy(request, env) {
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

    /* ---- RAZMERLI TOVAR
       Razmerlar `catalog/products/{id}/sizes` da: `[{size, stock}]`.
       Qoldiq TEKSHIRUVI umumiy `stock` dan EMAS, aynan tanlangan
       razmerdan olinadi. Aks holda «H4 tugagan, H7 da 10 ta bor» holatida
       umumiy qoldiq 10 bo'lib turadi va H4 uchun buyurtma o'tib ketardi —
       ombor esa bo'sh. Narx kabi, bu ham FAQAT katalogdan o'qiladi. */
    const sizeRows = sizesOfProduct(product);
    const wantSize = clean(entry && entry.size, 40);
    let sizeIndex = -1;

    if (sizeRows.length) {
      if (!wantSize) {
        problems.push({ product_id: pid, name: product.name, reason: "razmer tanlanmagan" });
        continue;
      }
      sizeIndex = sizeRows.findIndex((s) => s.size === wantSize);
      if (sizeIndex === -1) {
        problems.push({
          product_id: pid,
          name: product.name,
          reason: "razmer topilmadi",
          size: wantSize,
        });
        continue;
      }
      if (sizeRows[sizeIndex].stock < qty) {
        problems.push({
          product_id: pid,
          name: product.name,
          reason: "yetarli emas",
          size: wantSize,
          stock: sizeRows[sizeIndex].stock,
        });
        continue;
      }
    } else {
      const stock = Number(product.stock) || 0;
      if (stock < qty) {
        problems.push({ product_id: pid, name: product.name, reason: "yetarli emas", stock });
        continue;
      }
    }

    // NARX KATALOGDAN — mijoz yuborgan narx umuman o'qilmaydi
    const price = Number(product.price) || 0;
    total += price * qty;
    const line = { product_id: Number(pid), name: String(product.name || ""), price, qty };
    // `size` faqat razmerli tovarda yoziladi: razmersiz qatorda bo'sh
    // maydon turishi bot va admin panelini chalkashtiradi.
    if (sizeIndex !== -1) {
      line.size = sizeRows[sizeIndex].size;
      // RTDB kaliti — qoldiqni kamaytirish uchun (buyurtma yozuviga
      // TUSHMAYDI, pastda `stripLine()` bilan olib tashlanadi).
      line._sizeKey = sizeRows[sizeIndex].key;
    }
    lines.push(line);
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
    /* `_sizeKey` — ICHKI maydon (RTDB kaliti). Buyurtma yozuviga tushmaydi:
       u bazaning tuzilishi haqidagi tafsilot, botga ham, adminga ham
       kerak emas va qoidalarda ruxsat etilgan maydonlar ro'yxatida yo'q. */
    items: lines.map(({ _sizeKey, ...rest }) => rest),
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
      /* RAZMERLI TOVAR: umumiy qoldiqdan tashqari AYNAN o'sha razmerning
         qoldig'i ham kamayadi. Ikkisi birga kamaymasa yig'indi qoidasi
         buziladi (`stock` = razmerlar yig'indisi) va do'kon «12 ta bor»
         deb turib, mijozning buyurtmasini rad etaverardi. */
      if (line._sizeKey != null) {
        await rtdbPatch(
          c.dbUrl,
          `${c.root}/catalog/products/${line.product_id}/sizes/${line._sizeKey}`,
          { stock: { ".sv": { increment: -line.qty } } },
          token
        );
      }
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
//  POST /booking va /biled-order — faqat Telegram imzosi bilan
// =====================================================================
function catalogRowById(node, id) {
  if (!node || typeof node !== "object") return null;
  const direct = node[String(id)];
  if (direct && typeof direct === "object") return direct;
  return Object.values(node).find((row) => row && String(row.id) === String(id)) || null;
}

function catalogRowAvailable(row) {
  return !!row && !row.deleted && row.is_active !== 0 && row.is_active !== false;
}

function tashkentToday() {
  const d = new Date(Date.now() + 5 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}

function addIsoDays(iso, days) {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function hhmmMinutes(value) {
  const m = /^([0-1][0-9]|2[0-3]):([0-5][0-9])$/.exec(String(value || ""));
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/** Bir kun uchun BO'SH vaqtlarni "HH:MM" ro'yxati sifatida hisoblaydi
 *  (`utils/helpers.py: free_slots` va `docs/js/offline.js: freeSlots` bilan
 *  bir xil qoida: 09:00–18:00, 30 daq qadam, bugun uchun hozirdan +30 daq).
 *  slot_taken javobida qaytariladi — Mini App navbat oynasini darhol
 *  yangilaydi (err.slots). */
function computeFreeSlots(day, date, today, durationMin) {
  const step = 30;
  const workStart = 9 * 60;
  const workEnd = 18 * 60;
  const dur = Math.max(step, Number(durationMin) || step);
  const busy = [];
  for (const k of Object.keys(day || {})) {
    const slot = day[k];
    if (!slot || typeof slot !== "object") continue;
    const s = hhmmMinutes(slot.time);
    if (s === null) continue;
    busy.push([s, s + Math.max(step, Number(slot.duration_min) || step)]);
  }
  let minStart = workStart;
  if (date === today) {
    const now = new Date(Date.now() + 5 * 60 * 60 * 1000);
    const lead = now.getUTCHours() * 60 + now.getUTCMinutes() + 30;
    minStart = Math.max(minStart, Math.ceil(lead / step) * step);
  }
  const out = [];
  for (let start = workStart; start + dur <= workEnd; start += step) {
    if (start < minStart) continue;
    const clash = busy.some((b) => start < b[1] && b[0] < start + dur);
    if (!clash) {
      out.push(`${String(Math.floor(start / 60)).padStart(2, "0")}:${String(start % 60).padStart(2, "0")}`);
    }
  }
  return out;
}

async function handleBooking(request, env) {
  const c = cfg(env);
  const body = await readJson(request);
  const verified = await verifyInitData(body.initData, env);
  if (!verified.ok) return json({ ok: false, error: verified.error }, 401);
  if (!c.dbUrl) return json({ ok: false, error: "FIREBASE_DB_URL sozlanmagan" }, 500);

  const uid = String(verified.user.id);
  const date = clean(body.date, 10);
  const time = clean(body.time, 5);
  const start = hhmmMinutes(time);
  const today = tashkentToday();
  /* Lexical taqqoslash EMAS: Asia/Tashkent bo'yicha bugundan +6 kungacha
     HAQIQIY kalendar sanalar generatsiya qilinadi va faqat AYNAN mos kelgani
     qabul qilinadi. Shu sababli 2025-04-31 kabi mavjud bo'lmagan sanalar
     rad etiladi (avval regex ularni o'tkazib yuborardi). */
  const validDates = [];
  for (let i = 0; i < 7; i++) validDates.push(addIsoDays(today, i));
  if (!validDates.includes(date)) {
    return json({ ok: false, error: "Sana noto'g'ri" }, 400);
  }
  if (start === null || start < 9 * 60 || start >= 18 * 60 || start % 30 !== 0) {
    return json({ ok: false, error: "Vaqt noto'g'ri" }, 400);
  }

  const token = await accessToken(env);
  const services = await rtdbGetStrict(c.dbUrl, `${c.root}/catalog/services`, token);
  const service = catalogRowById(services, body.service_id);
  if (!catalogRowAvailable(service) || service.coming_soon) {
    return json({ ok: false, error: "Xizmat topilmadi" }, 404);
  }
  const duration = Math.max(30, Number(service.duration_min) || 30);
  if (start + duration > 18 * 60) return json({ ok: false, error: "Vaqt ish soatidan tashqarida" }, 400);
  if (date === today) {
    const now = new Date(Date.now() + 5 * 60 * 60 * 1000);
    const minStart = now.getUTCHours() * 60 + now.getUTCMinutes() + 30;
    if (start < minStart) return json({ ok: false, error: "Bu vaqt o'tib ketgan" }, 409);
  }

  const phone = normalizePhone(body.phone);
  if (!phone) return json({ ok: false, error: "Telefon raqam noto'g'ri" }, 400);
  const clientKey = clean(body.client_key, 64).replace(/[^A-Za-z0-9_-]/g, "");
  if (clientKey.length < 16) return json({ ok: false, error: "client_key_required" }, 400);
  const serviceId = service.id == null ? Number(body.service_id) : service.id;
  const requestHash = await sha256Hex(JSON.stringify({ service_id: serviceId, date, time, phone }));
  const key = `b_${uid}_${clientKey}`;
  const bookingPath = `${c.root}/bookings/${key}`;
  const claim = {
    uid: Number(uid),
    request_hash: requestHash,
    status: "processing",
    imported: false,
    source: "miniapp_worker",
    createdAt: Date.now(),
  };
  const claimed = await rtdbCreate(c.dbUrl, bookingPath, claim, token);
  if (!claimed.created) {
    const old = claimed.value;
    if (!old || old.request_hash !== requestHash) return json({ ok: false, error: "booking_conflict" }, 409);
    if (["cancelled", "done"].includes(old.status)) return json({ ok: false, error: "booking_final" }, 409);
  }

  /* Slot rezervatsiyasi VA booking yozuvining finalize'i BITTA umumiy root
     ETag CAS ichida: `slots/{date}/{key}` va `bookings/{key}` birga commit
     bo'ladi. Shu sababli "slot band, lekin booking yo'q" (yoki aksincha)
     oraliq holati qolmaydi. */
  const bookingFields = {
    service_id: serviceId,
    service_name: clean(service.name, 200),
    date,
    time,
    duration_min: duration,
    price: Math.max(0, Number(service.price) || 0),
    name: clean(body.name || [verified.user.first_name, verified.user.last_name].filter(Boolean).join(" "), 200),
    phone,
  };
  for (let attempt = 0; attempt < 10; attempt++) {
    const snap = await rtdbGetEtag(c.dbUrl, c.root, token);
    const root = snap.value && typeof snap.value === "object" ? snap.value : {};
    const bookings = root.bookings && typeof root.bookings === "object"
      ? root.bookings
      : (root.bookings = {});
    const bookingRow = bookings[key];
    if (!bookingRow || typeof bookingRow !== "object" || bookingRow.request_hash !== requestHash) {
      return json({ ok: false, error: "booking_conflict" }, 409);
    }
    if (["cancelled", "done"].includes(bookingRow.status)) {
      return json({ ok: false, error: "booking_final" }, 409);
    }
    const slots = root.slots && typeof root.slots === "object" ? root.slots : (root.slots = {});
    const day = slots[date] && typeof slots[date] === "object" ? slots[date] : (slots[date] = {});
    const finalized = bookingRow.status !== "processing" && bookingRow.status !== "failed";
    if (finalized && day[key]) {
      /* Avvalgi PUT'da slot + yozuv birga commit bo'lgan — idempotent replay. */
      return json({ ok: true, booking: { id: key, date: bookingRow.date, time: bookingRow.time, label: bookingRow.date }, repeated: true });
    }
    const clash = Object.keys(day).some((k) => {
      if (k === key) return false;
      const slot = day[k];
      if (!slot || typeof slot !== "object") return false;
      const otherStart = hhmmMinutes(slot.time);
      const otherDuration = Math.max(30, Number(slot.duration_min) || 30);
      return otherStart !== null && start < otherStart + otherDuration && otherStart < start + duration;
    });
    if (clash) {
      const freeList = computeFreeSlots(day, date, today, duration);
      bookings[key] = { ...bookingRow, status: "failed" };
      const put = await rtdbPutIfMatch(c.dbUrl, c.root, root, token, snap.etag);
      if (put.status === 412) continue;
      await ensureOk(put, "Navbat holati saqlanmadi");
      // `slots` — endi BO'SH vaqtlar ("HH:MM"), UI ularni to'g'ridan ko'rsatadi.
      return json({ ok: false, error: "slot_taken", message: "Bu vaqt band qilingan", slots: freeList }, 409);
    }
    day[key] = { time, duration_min: duration };
    bookings[key] = { ...bookingRow, ...bookingFields, status: "new" };
    const put = await rtdbPutIfMatch(c.dbUrl, c.root, root, token, snap.etag);
    if (put.status === 412) continue;
    await ensureOk(put, "Navbat band qilinmadi");
    return json({ ok: true, booking: { id: key, date, time, label: date } }, claimed.created ? 201 : 200);
  }
  return json({ ok: false, error: "slot_busy", message: "Vaqtni band qilishda to'qnashuv" }, 409);
}

async function handleBiledOrder(request, env) {
  const c = cfg(env);
  const body = await readJson(request);
  const verified = await verifyInitData(body.initData, env);
  if (!verified.ok) return json({ ok: false, error: verified.error }, 401);
  if (!c.dbUrl) return json({ ok: false, error: "FIREBASE_DB_URL sozlanmagan" }, 500);
  const phone = normalizePhone(body.phone);
  if (!phone) return json({ ok: false, error: "Telefon raqam noto'g'ri" }, 400);

  const token = await accessToken(env);
  const [cars, bileds, shrouds, colors] = await Promise.all([
    rtdbGetStrict(c.dbUrl, `${c.root}/catalog/cars`, token),
    rtdbGetStrict(c.dbUrl, `${c.root}/catalog/biled_types`, token),
    rtdbGetStrict(c.dbUrl, `${c.root}/catalog/shrouds`, token),
    rtdbGetStrict(c.dbUrl, `${c.root}/catalog/optic_colors`, token),
  ]);
  const car = catalogRowById(cars, body.car_id);
  const biled = catalogRowById(bileds, body.biled_id);
  const shroud = body.shroud_id == null ? null : catalogRowById(shrouds, body.shroud_id);
  const color = body.color_id == null ? null : catalogRowById(colors, body.color_id);
  if (
    !catalogRowAvailable(car) ||
    !catalogRowAvailable(biled) ||
    (body.shroud_id != null && !catalogRowAvailable(shroud)) ||
    (body.color_id != null && !catalogRowAvailable(color))
  ) {
    return json({ ok: false, error: "Konfigurator tanlovi topilmadi yoki faol emas" }, 409);
  }

  const uid = String(verified.user.id);
  const nonce = clean(body.client_key, 64).replace(/[^A-Za-z0-9_-]/g, "");
  if (nonce.length < 16) return json({ ok: false, error: "client_key_required" }, 400);
  const key = `bl_${uid}_${nonce}`;
  const total = (Number(biled.price) || 0) + (Number(shroud && shroud.price) || 0) + (Number(color && color.price) || 0);
  const record = {
    uid: Number(uid),
    car_id: car.id == null ? Number(body.car_id) : car.id,
    car_name: clean(car.name, 200),
    biled_id: biled.id == null ? Number(body.biled_id) : biled.id,
    biled_name: clean(biled.name, 200),
    biled_price: Number(biled.price) || 0,
    shroud_id: shroud ? (shroud.id == null ? Number(body.shroud_id) : shroud.id) : null,
    shroud_name: shroud ? clean(shroud.name, 200) : "",
    shroud_price: Number(shroud && shroud.price) || 0,
    color_id: color ? (color.id == null ? Number(body.color_id) : color.id) : null,
    color_name: color ? clean(color.name, 200) : "",
    color_price: Number(color && color.price) || 0,
    comment: clean(body.comment, 2000),
    total,
    name: clean(body.name || [verified.user.first_name, verified.user.last_name].filter(Boolean).join(" "), 200),
    phone,
    status: "new",
    createdAt: Date.now(),
    imported: false,
    source: "miniapp_worker",
  };
  const requestHash = await sha256Hex(JSON.stringify({
    car_id: record.car_id,
    biled_id: record.biled_id,
    shroud_id: record.shroud_id,
    color_id: record.color_id,
    comment: record.comment,
    phone: record.phone,
  }));
  record.request_hash = requestHash;
  const created = await rtdbCreate(c.dbUrl, `${c.root}/biled_orders/${key}`, record, token);
  if (!created.created) {
    if (!created.value || created.value.request_hash !== requestHash) {
      return json({ ok: false, error: "idempotency_conflict" }, 409);
    }
    const oldTotal = Number(created.value.total) || 0;
    return json({ ok: true, order: { id: key, code: "BL-" + shortHash(key).toUpperCase(), total: oldTotal, total_label: fmtPrice(oldTotal) }, repeated: true });
  }
  return json({ ok: true, order: { id: key, code: "BL-" + shortHash(key).toUpperCase(), total, total_label: fmtPrice(total) } }, 201);
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
//  POST /admin/catalog-write — yagona signed catalog mutation adapteri
// ---------------------------------------------------------------------
const CATALOG_WRITE_FIELDS = {
  products: new Set(["id", "_key", "name", "description", "price", "old_price", "stock", "code", "badge", "photo_url", "photo_id", "photo2_url", "photo2_id", "photo3_url", "photo3_id", "is_active", "deleted", "category_id", "categoryName", "car_id", "carName", "carNames", "product_type", "sizes", "warranty", "flashUntil", "sort", "createdAt", "updatedAt", "source"]),
  categories: new Set(["id", "_key", "name", "title", "icon", "sort", "is_active", "deleted", "createdAt", "updatedAt", "source"]),
  cars: new Set(["id", "_key", "name", "years", "note", "sort", "photo_url", "photo_id", "is_active", "deleted", "createdAt", "updatedAt", "source"]),
  stories: new Set(["id", "_key", "category", "title", "heading", "body", "emoji", "color_from", "color_to", "photo_url", "photo_id", "video_url", "video_id", "link", "sort", "is_active", "deleted", "createdAt", "updatedAt", "source"]),
  banners: new Set(["id", "_key", "title", "subtitle", "tag", "color_from", "color_to", "photo_url", "photo_id", "video_url", "video_id", "sort", "is_active", "deleted", "createdAt", "updatedAt", "source"]),
  music: new Set(["id", "_key", "title", "audio_url", "audio_id", "duration", "sort", "is_active", "deleted", "createdAt", "updatedAt", "source"]),
};
const CATALOG_COUNTERS = {
  products: "products_counter",
  stories: "stories_counter",
  banners: "banners_counter",
};

/* Server tomonda katalog mutatsiyasini `database.rules.json` bilan AYNAN
   mos tekshiramiz. Worker service-account tokeni bilan yozadi va qoidalarni
   CHETLAB O'TADI — shu sababli tur/diapazon tekshiruvi shu yerda takrorlanadi.
   `null`/`undefined` — kalitni o'chirish/qoldirish (Firebase semantikasi):
   qoida faqat MAVJUD qiymatni tekshiradi, shuning uchun ular ruxsat etiladi. */
const CATALOG_URL_RE = /^https:\/\/[^\s"']{1,600}$/i;
const CATALOG_COLOR_RE = /^(#[0-9a-fA-F]{3,8}|[a-zA-Z]{3,20})$/;
const MAX_TS = Number.MAX_SAFE_INTEGER;

function catNum(v, min, max) {
  return typeof v === "number" && Number.isFinite(v) && v >= min && v <= max;
}
function catStr(v, max) {
  return typeof v === "string" && v.length <= max;
}
function catBool01(v) {
  return typeof v === "boolean" || (typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1);
}
function catUrl(v) {
  return v === "" || (typeof v === "string" && CATALOG_URL_RE.test(v));
}
function catColor(v) {
  return typeof v === "string" && CATALOG_COLOR_RE.test(v);
}

const CATALOG_FIELD_CHECK = {
  // raqamlar
  id: (v) => catNum(v, 0, MAX_TS),
  sort: (v) => catNum(v, -100000, 100000),
  price: (v) => catNum(v, 0, 100000000000),
  old_price: (v) => catNum(v, 0, 100000000000),
  stock: (v) => catNum(v, 0, 10000000),
  duration: (v) => catNum(v, 0, MAX_TS),
  category_id: (v) => typeof v === "number" && Number.isFinite(v),
  car_id: (v) => typeof v === "number" && Number.isFinite(v),
  createdAt: (v) => catNum(v, 0, MAX_TS),
  updatedAt: (v) => catNum(v, 0, MAX_TS),
  flashUntil: (v) => catNum(v, 0, MAX_TS),
  // string va uzunlik (qoidalardagi length bilan bir xil)
  _key: (v) => typeof v === "string" || (typeof v === "number" && Number.isFinite(v)),
  name: (v) => catStr(v, 300),
  title: (v) => catStr(v, 300),
  subtitle: (v) => catStr(v, 500),
  heading: (v) => catStr(v, 300),
  body: (v) => catStr(v, 4000),
  description: (v) => catStr(v, 6000),
  badge: (v) => catStr(v, 60),
  tag: (v) => catStr(v, 60),
  code: (v) => catStr(v, 80),
  warranty: (v) => catStr(v, 200),
  emoji: (v) => catStr(v, 16),
  icon: (v) => catStr(v, 40),
  category: (v) => catStr(v, 80),
  years: (v) => catStr(v, 60),
  note: (v) => catStr(v, 500),
  product_type: (v) => catStr(v, 40),
  source: (v) => catStr(v, 40),
  categoryName: (v) => catStr(v, 200),
  carName: (v) => catStr(v, 200),
  // ranglar
  color_from: catColor,
  color_to: catColor,
  // media havolalari (https yoki bo'sh)
  photo_url: catUrl,
  photo2_url: catUrl,
  photo3_url: catUrl,
  video_url: catUrl,
  audio_url: catUrl,
  link: (v) => v === "" || (typeof v === "string" && CATALOG_URL_RE.test(v)),
  // Telegram file_id
  photo_id: (v) => catStr(v, 200),
  photo2_id: (v) => catStr(v, 200),
  photo3_id: (v) => catStr(v, 200),
  video_id: (v) => catStr(v, 200),
  audio_id: (v) => catStr(v, 200),
  // boolean yoki 0/1
  is_active: catBool01,
  deleted: catBool01,
};

function validateCatalogSizes(raw) {
  const rows = Array.isArray(raw)
    ? raw
    : (raw && typeof raw === "object" ? Object.values(raw) : null);
  if (!rows) return "Razmerlar noto'g'ri";
  if (rows.length > 40) return "Razmerlar juda ko'p";
  for (const row of rows) {
    if (row == null) continue; // siyrak massiv teshigi — o'chirish
    if (typeof row !== "object" || Array.isArray(row)) return "Razmerlar noto'g'ri";
    if (!catStr(row.size, 40) || !row.size.trim()) return "Razmer nomi noto'g'ri";
    if (!catNum(row.stock, 0, 10000000)) return "Razmer qoldig'i noto'g'ri";
  }
  return null;
}

function validateCatalogStringArray(raw, max) {
  const rows = Array.isArray(raw)
    ? raw
    : (raw && typeof raw === "object" ? Object.values(raw) : null);
  if (!rows) return "Ro'yxat noto'g'ri";
  if (rows.length > 100) return "Ro'yxat juda uzun";
  for (const row of rows) {
    if (row == null) continue;
    if (!catStr(row, max)) return "Ro'yxat elementi noto'g'ri";
  }
  return null;
}

function validateCatalogMutation(table, value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "Yozuv obyekt bo'lishi kerak";
  if (JSON.stringify(value).length > 65536) return "Yozuv juda katta";
  const allowed = CATALOG_WRITE_FIELDS[table];
  if (!allowed) return "Jadval ruxsat etilmagan";
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) return `Ruxsat etilmagan maydon: ${key}`;
    const v = value[key];
    // null/undefined = kalitni o'chirish; qoida faqat mavjud qiymatni tekshiradi.
    if (v === null || v === undefined) continue;
    if (key === "sizes") {
      const why = validateCatalogSizes(v);
      if (why) return why;
      continue;
    }
    if (key === "carNames" || key === "categories" || key === "carnames") {
      const why = validateCatalogStringArray(v, 200);
      if (why) return why;
      continue;
    }
    if (key === "images") {
      const rows = Array.isArray(v) ? v : (typeof v === "object" ? Object.values(v) : null);
      if (!rows) return "Rasmlar ro'yxati noto'g'ri";
      for (const u of rows) {
        if (u == null) continue;
        if (!catUrl(u)) return "Rasm havolasi https bo'lishi kerak";
      }
      continue;
    }
    const check = CATALOG_FIELD_CHECK[key];
    if (check && !check(v)) return `Maydon noto'g'ri: ${key}`;
  }
  return null;
}

async function handleAdminCatalogWrite(request, env) {
  const gate = await requireAdmin(request, env);
  if (gate.error) return gate.error;
  const { c, body, uid } = gate;
  const method = clean(body.method, 12).toLowerCase();
  const token = await accessToken(env);

  if (method === "allocate") {
    const table = clean(body.table, 30);
    const counter = CATALOG_COUNTERS[table];
    if (!counter) return json({ ok: false, error: "Sanoqchi ruxsat etilmagan" }, 400);
    for (let attempt = 0; attempt < 10; attempt++) {
      const path = `${c.root}/${counter}/n`;
      const snap = await rtdbGetEtag(c.dbUrl, path, token);
      const current = Number(snap.value);
      const next = (Number.isFinite(current) && current >= 900000 ? current : 900000) + 1;
      const put = await rtdbPutIfMatch(c.dbUrl, path, next, token, snap.etag);
      if (put.status === 412) continue;
      await ensureOk(put, "ID ajratilmadi");
      return json({ ok: true, id: next });
    }
    return json({ ok: false, error: "ID band — qayta urinib ko'ring" }, 409);
  }

  if (!["put", "patch", "delete"].includes(method)) {
    return json({ ok: false, error: "Method ruxsat etilmagan" }, 400);
  }
  const match = /^catalog\/([A-Za-z0-9_-]+)\/([A-Za-z0-9_-]+)$/.exec(clean(body.path, 160));
  if (!match || !CATALOG_WRITE_FIELDS[match[1]]) {
    return json({ ok: false, error: "Catalog path ruxsat etilmagan" }, 400);
  }
  const table = match[1];
  const row = match[2];
  const path = `${c.root}/catalog/${table}/${row}`;
  let res;
  if (method === "delete") {
    res = await rtdbDelete(c.dbUrl, path, token);
  } else {
    const why = validateCatalogMutation(table, body.value);
    if (why) return json({ ok: false, error: "validation", message: why }, 400);
    const value = { ...body.value, updated_by: Number(uid) };
    /* Audit maydoni katalog sxemasiga kirmaydi; client whitelist qat'iy,
       server esa faqat timestampni qo'shadi. */
    delete value.updated_by;
    res = method === "put"
      ? await rtdbPut(c.dbUrl, path, value, token)
      : await rtdbPatch(c.dbUrl, path, value, token);
  }
  await ensureOk(res, "Katalog yozilmadi");
  return json({ ok: true, table, row, method, value: body.value == null ? null : body.value });
}

// ---------------------------------------------------------------------
//  POST /admin/orders — zaxira rejimda tushgan buyurtmalar
// ---------------------------------------------------------------------
/** RTDB tuguni dict yoki massiv — ikkisini ham [kalit, qiymat] ga keltiradi. */
function entriesOf(node) {
  if (!node || typeof node !== "object") return [];
  if (Array.isArray(node)) {
    return node.map((v, i) => [String(i), v]).filter((pair) => pair[1] && typeof pair[1] === "object");
  }
  return Object.entries(node).filter((pair) => pair[1] && typeof pair[1] === "object");
}

/** `items` ro'yxat yoki lug'at bo'lishi mumkin (RTDB siyrak massivni lug'at qiladi). */
function itemsOf(raw) {
  return entriesOf(raw)
    .map((pair) => pair[1])
    .map((i) => ({
      product_id: i.product_id != null ? i.product_id : null,
      name: String(i.name || ""),
      price: Number(i.price || 0),
      qty: Number(i.qty || 1),
      // Razmer — admin ro'yxatida va «Buyurtmalarim» da ko'rinishi kerak
      size: i.size ? String(i.size) : null,
    }))
    .filter((i) => i.name || i.product_id != null);
}

/** Holat nomlarini YAGONA lug'atga keltiradi (pastdagi izohga qarang). */
function normStatus(value) {
  const s = String(value || "new").toLowerCase();
  if (s === "done" || s === "delivered") return "delivered";
  if (s === "shipped" || s === "delivering") return "delivering";
  if (s === "new" || s === "accepted" || s === "cancelled") return s;
  return "new";
}

// ---------------------------------------------------------------------
//  POST /admin/orders — BARCHA do'kon buyurtmalari
//
//  NEGA IKKI TUGUN O'QILADI
//  Buyurtmalar tarixan ikki joyda saqlanadi:
//
//    zimmer/pending_orders/{uid}_{kod}  — Worker qabul qilganlari
//                                          (Render o'chgan paytda), brauzer
//                                          o'qishi mumkin;
//    zimmer/orders/{sqlite_id}          — Render (SQLite) buyurtmalarining
//                                          nusxasi, `sync.push_order` yozadi.
//                                          Qoidalarda `.read: false` —
//                                          brauzer O'QIY OLMAYDI.
//
//  Mini app admin paneli faqat birinchisini o'qirdi. Natijada mijozning
//  profilida buyurtmalar turadi (ular SQLite'dan), admin panelida esa
//  «Hali buyurtma tushmagan» yozuvi chiqadi. Aynan shu holat.
//
//  Yechim: ikkisini SHU YERDA birlashtiramiz. Worker service-account bilan
//  ishlaydi, ya'ni yopiq tugunni ham o'qiydi — va faqat TASDIQLANGAN admin
//  (`requireAdmin`: initData imzosi -> uid -> ADMIN_IDS) javob oladi.
//  Shu sababli `zimmer/orders` ni qoidalarda OCHISH KERAK EMAS: mijoz
//  telefon raqamlari yopiq qoladi.
// ---------------------------------------------------------------------
/** Ikki tugunni bitta ro'yxatga birlashtiradi (TOZA funksiya — sinovga qulay).
 *
 *  `pending_orders` maydonlari snake_case (Worker yozadi),
 *  `orders` maydonlari camelCase (`services/sync.py: _put_order` yozadi).
 *  Shu sababli har maydon ikki nom bilan o'qiladi. */
function mergeAdminOrders(pendingNode, dbNode) {
  const orders = [];

  // 1) SQLite nusxasi (`orders`) — bot yozadi.
  const dbIds = new Set();
  for (const [key, row] of entriesOf(dbNode)) {
    const id = row.id != null ? row.id : key;
    dbIds.add(String(id));
    const total = Number(row.total || 0);
    orders.push({
      key: String(key),
      source: "db", // holat o'zgarishi `orders/{id}` ga yoziladi
      id: id,
      code: "#" + id,
      uid: row.uid || null,
      name: row.name || row.customer_name || "",
      phone: row.phone || "",
      address: row.address || "",
      delivery_info: row.deliveryInfo || row.delivery_info || "",
      payment_method: row.paymentMethod || row.payment_method || "",
      total: total,
      total_label: fmtPrice(total),
      status: normStatus(row.status),
      items: itemsOf(row.items),
      created_at: Number(row.createdAt || 0) || null,
      imported: true,
    });
  }

  // 2) Worker qabul qilganlari (`pending_orders`).
  //    Bot ularni SQLite'ga ko'chirgan bo'lsa (`imported` + `sqlite_id`),
  //    yuqoridagi ro'yxatda allaqachon bor — TAKRORLAMAYMIZ.
  for (const [key, row] of entriesOf(pendingNode)) {
    // Claim hali tugamagan yoki qoldiq xatosi bilan to'xtagan yozuv admin
    // status amallariga chiqmaydi; aks holda processing order bekor qilinib
    // reservation/finalize bilan poyga qilishi mumkin.
    if (row.status === "processing" || row.status === "failed") continue;
    if (row.imported && row.sqlite_id && dbIds.has(String(row.sqlite_id))) continue;
    const total = Number(row.total || 0);
    orders.push({
      key: String(key),
      source: "pending", // holat `pending_orders/{key}` ga yoziladi
      id: row.sqlite_id || null,
      code: row.code || key,
      uid: row.uid || null,
      name: row.customer_name || row.name || "",
      phone: row.phone || "",
      address: row.address || "",
      delivery_info: row.delivery_info || row.deliveryInfo || "",
      payment_method: row.payment_method || row.paymentMethod || "",
      total: total,
      total_label: fmtPrice(total),
      status: normStatus(row.status),
      items: itemsOf(row.items),
      created_at: Number(row.createdAt || 0) || null,
      imported: !!row.imported,
    });
  }

  // Yangi buyurtma TEPADA turishi kerak.
  orders.sort((a, b) => Number(b.created_at || 0) - Number(a.created_at || 0));
  return orders;
}

/* ---------------------------------------------------------------------
   POST /admin/orders — admin uchun buyurtmalar ro'yxati

   `kind` bo'yicha uch xil ro'yxat qaytaradi:
       "order"   (standart) — pending_orders + orders birlashtirilgan
       "biled"             — biled_orders
       "booking"           — bookings

   NEGA `biled` VA `booking` HAM SHU YERGA QO'SHILDI. Ilgari admin paneli
   ularni BRAUZERDAN to'g'ridan-to'g'ri o'qirdi, ya'ni `biled_orders` va
   `bookings` tugunlari qoidalarda hammaga ochiq turishi kerak edi. Ularda
   esa mijozning ISMI va TELEFONI bor — istalgan odam yuklab olardi.
   Endi tugunlar YOPIQ, ro'yxatni faqat tasdiqlangan admin shu yerdan
   oladi (`requireAdmin` initData imzosini tekshiradi).
   --------------------------------------------------------------------- */
async function handleAdminOrders(request, env) {
  const gate = await requireAdmin(request, env);
  if (gate.error) return gate.error;
  const { c, body } = gate;
  const kind = String(body.kind || "order");
  const token = await accessToken(env);

  // Bi-LED va navbat: bitta tugun, xom holda qaytaramiz — panel o'zi
  // kerakli ko'rinishga o'giradi (`admin-shop.js -> loadKind`).
  if (kind === "biled" || kind === "booking") {
    const node = await rtdbGet(c.dbUrl, `${c.root}/${KIND_NODES[kind]}`, token);
    const rows = [];
    if (node && typeof node === "object") {
      for (const key of Object.keys(node)) {
        const row = node[key];
        if (!row || typeof row !== "object") continue;
        rows.push({ ...row, _key: key, id: row.id === undefined ? key : row.id });
      }
    }
    rows.sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
    return json({ ok: true, kind, orders: rows, count: rows.length });
  }

  const [pendingNode, dbNode] = await Promise.all([
    rtdbGet(c.dbUrl, `${c.root}/pending_orders`, token),
    rtdbGet(c.dbUrl, `${c.root}/orders`, token),
  ]);

  const orders = mergeAdminOrders(pendingNode, dbNode);
  return json({ ok: true, kind: "order", orders, count: orders.length });
}

// ---------------------------------------------------------------------
//  POST /admin/order-status — buyurtma holatini o'zgartirish
// ---------------------------------------------------------------------
/* YAGONA HOLAT LUG'ATI.
   Ilgari uch xil nom ishlatilardi va bir xil narsani bildirardi:
       SQLite / Render  : new, accepted, delivered, cancelled
       Worker + panel   : new, accepted, delivering, done, cancelled
       mijoz profili    : new, accepted, shipped,    done, cancelled
   Ya'ni «yetkazildi» uchun `delivered`, `done` — ikki xil so'z. Natijada
   panelda qo'yilgan holat SQLite uchun NOTANISH bo'lib qolardi va Render
   admin paneli o'sha buyurtmada tiqilib qolardi.
   Endi hamma joyda BIR XIL beshta nom. `normStatus()` eski nomlarni
   yangisiga o'giradi (orqaga moslik). */
const ORDER_STATUSES = ["new", "accepted", "delivering", "delivered", "cancelled"];

/* ---------------------------------------------------------------------
   UCH XIL BUYURTMA TURI

   Admin panelida uchta alohida bo'lim bor va har birining O'Z holatlari,
   O'Z tuguni va O'Z xabar matnlari bo'ladi. Ular `utils/texts.py` va
   `services/orders.py` dagi ro'yxatlar bilan AYNAN bir xil bo'lishi shart —
   aks holda panelda qo'yilgan holat bot uchun notanish bo'lib qoladi.
   --------------------------------------------------------------------- */
const KIND_STATUSES = {
  order: ORDER_STATUSES,
  biled: ["new", "accepted", "in_work", "done", "cancelled"],
  booking: ["new", "confirmed", "done", "cancelled"],
};

const KIND_NODES = { biled: "biled_orders", booking: "bookings" };

const KIND_TEXT = {
  order: {
    accepted: "✅ Buyurtmangiz qabul qilindi",
    delivering: "🚚 Buyurtmangiz yo'lda",
    delivered: "🎉 Buyurtmangiz yetkazildi",
    cancelled: "❌ Buyurtmangiz bekor qilindi",
  },
  biled: {
    accepted: "✅ Bi-LED buyurtmangiz qabul qilindi",
    in_work: "🔧 Ish boshlandi",
    done: "✨ Tayyor — topshirishga hozir",
    cancelled: "❌ Bi-LED buyurtmangiz bekor qilindi",
  },
  booking: {
    confirmed: "✅ Navbatingiz tasdiqlandi",
    done: "✔️ Navbat bajarildi",
    cancelled: "❌ Navbatingiz bekor qilindi",
  },
};

const ALLOWED_STATUS_TRANSITIONS = {
  order: {
    new: ["accepted", "cancelled"],
    accepted: ["delivering", "cancelled"],
    delivering: ["delivered", "cancelled"],
    delivered: [],
    cancelled: [],
  },
  biled: {
    new: ["accepted", "cancelled"],
    accepted: ["in_work", "cancelled"],
    in_work: ["done", "cancelled"],
    done: [],
    cancelled: [],
  },
  booking: {
    new: ["confirmed", "cancelled"],
    confirmed: ["done", "cancelled"],
    done: [],
    cancelled: [],
  },
};

async function handleAdminOrderStatus(request, env) {
  const gate = await requireAdmin(request, env);
  if (gate.error) return gate.error;
  const { c, body, uid } = gate;
  const kind = KIND_STATUSES[clean(body.kind, 12)] ? clean(body.kind, 12) : "order";
  const key = clean(body.key, 120);
  if (!key || !/^[A-Za-z0-9_-]+$/.test(key)) return json({ ok: false, error: "Buyurtma kaliti noto'g'ri" }, 400);
  const status = kind === "order" ? normStatus(clean(body.status, 20)) : clean(body.status, 20);
  if (!KIND_STATUSES[kind].includes(status)) return json({ ok: false, error: "Holat noto'g'ri", allowed: KIND_STATUSES[kind] }, 400);

  /* `orders` — Render/SQLite'ning faqat MIRROR nusxasi. Uni Worker'da
     patch qilish haqiqiy buyurtmani o'zgartirmaydi, shuning uchun yolg'on
     success o'rniga canonical server talab qilinadi. */
  if (kind === "order" && clean(body.source, 12) === "db") {
    return json({ ok: false, error: "server_required", message: "SQLite buyurtmasi uchun Render serveri kerak" }, 409);
  }
  const node = kind === "order" ? "pending_orders" : KIND_NODES[kind];
  const path = `${c.root}/${node}/${key}`;
  const token = await accessToken(env);
  let row = null;
  let repeated = false;
  let committed = false;

  /* BEKOR QILISH — do'kon buyurtmasi va navbat uchun status o'zgarishi VA
     kompensatsiya (qoldiq qaytarish / slot o'chirish) BITTA root ETag CAS
     ichida bajariladi. Aks holda oraliq crash "cancelled, lekin qoldiq
     qaytmagan (yoki slot band qolgan)" holatini qoldirar edi. Import
     qilingan (server-owned) yozuv kompensatsiyani chetlab o'tmaydi —
     helper avval imported'ni aniqlab server_required qaytaradi. */
  if (status === "cancelled" && (kind === "order" || kind === "booking")) {
    const outcome = kind === "order"
      ? await cancelOrderAtomic(c, token, key, uid)
      : await cancelBookingAtomic(c, token, key, uid);
    if (outcome.error) return outcome.error;
    row = outcome.row;
    repeated = !!outcome.repeated;
    committed = true;
  } else {
    for (let attempt = 0; attempt < 10; attempt++) {
      const snap = await rtdbGetEtag(c.dbUrl, path, token);
      row = snap.value;
      if (!row || typeof row !== "object") return json({ ok: false, error: "Bunday buyurtma yo'q" }, 404);
      if (row.imported) {
        return json({ ok: false, error: "server_required", message: "Import qilingan yozuv uchun canonical server kerak" }, 409);
      }
      const rawStatus = clean(row.status || "new", 20);
      const current = kind === "order" ? normStatus(rawStatus) : rawStatus;
      const knownOrderStatus = ["new", "accepted", "delivering", "delivered", "cancelled", "done", "shipped"].includes(rawStatus);
      if ((kind === "order" && !knownOrderStatus) || !(current in ALLOWED_STATUS_TRANSITIONS[kind])) {
        return json({ ok: false, error: "order_not_ready", message: "Buyurtma hali status o'zgarishiga tayyor emas" }, 409);
      }
      if (current === status) {
        repeated = true;
        committed = true;
        break;
      }
      const allowed = (ALLOWED_STATUS_TRANSITIONS[kind] || {})[current] || [];
      if (!allowed.includes(status)) {
        return json({ ok: false, error: "invalid_transition", message: `${current} → ${status} mumkin emas`, allowed }, 409);
      }
      const next = { ...row, status, status_by: Number(uid), status_at: Date.now() };
      const put = await rtdbPutIfMatch(c.dbUrl, path, next, token, snap.etag);
      if (put.status === 412) continue;
      await ensureOk(put, "Holat saqlanmadi");
      row = next;
      committed = true;
      break;
    }
  }
  if (!committed) return json({ ok: false, error: "status_busy", message: "Holat bir vaqtda o'zgardi — qayta urinib ko'ring" }, 409);

  const text = (KIND_TEXT[kind] || {})[status];
  const label = row.code ? String(row.code) : "#" + (row.id != null ? row.id : key);
  if (!repeated && text && row.uid) {
    await sendMessage(env, row.uid, `${text}\n\n🧾 ${escHtml(label)}`).catch(() => {});
  }
  return json({ ok: true, kind, key, status, node, repeated });
}

/** Do'kon buyurtmasini bekor qiladi: status→cancelled, qoldiqni qaytarish
    (umumiy + razmer) va rezerv markerini bo'shatish — BARCHASI bitta root
    ETag CAS ichida. Import qilingan (server-owned) yozuv kompensatsiyani
    CHETLAB O'TMAYDI: u avval aniqlanadi va server_required qaytariladi. */
async function cancelOrderAtomic(c, token, key, uid) {
  for (let attempt = 0; attempt < 10; attempt++) {
    const snap = await rtdbGetEtag(c.dbUrl, c.root, token);
    const root = snap.value && typeof snap.value === "object" ? snap.value : {};
    const pending = root.pending_orders && typeof root.pending_orders === "object" ? root.pending_orders : {};
    const row = pending[key];
    if (!row || typeof row !== "object") return { error: json({ ok: false, error: "Bunday buyurtma yo'q" }, 404) };
    if (row.imported) {
      return { error: json({ ok: false, error: "server_required", message: "Import qilingan yozuv uchun canonical server kerak" }, 409) };
    }
    const rawStatus = clean(row.status || "new", 20);
    const current = normStatus(rawStatus);
    const knownOrderStatus = ["new", "accepted", "delivering", "delivered", "cancelled", "done", "shipped"].includes(rawStatus);
    if (!knownOrderStatus || !(current in ALLOWED_STATUS_TRANSITIONS.order)) {
      return { error: json({ ok: false, error: "order_not_ready", message: "Buyurtma hali status o'zgarishiga tayyor emas" }, 409) };
    }
    if (current === "cancelled") {
      /* Allaqachon bekor qilingan — qoldiq avvalgi CAS'da qaytarilgan.
         Ikki marta qaytarmaslik uchun kompensatsiyani takrorlamaymiz. */
      return { row, repeated: true };
    }
    if (!(ALLOWED_STATUS_TRANSITIONS.order[current] || []).includes("cancelled")) {
      return { error: json({ ok: false, error: "invalid_transition", message: `${current} → cancelled mumkin emas`, allowed: ALLOWED_STATUS_TRANSITIONS.order[current] || [] }, 409) };
    }

    const products = root.catalog && root.catalog.products;
    if (!products || typeof products !== "object") throw new Error("Katalog o'qilmadi");
    const markers = root.order_reservations && typeof root.order_reservations === "object"
      ? root.order_reservations
      : (root.order_reservations = {});
    let marker = markers[key];
    /* Eski Worker yozuvlarida marker yo'q — qatorlardan bir marta tiklaymiz. */
    if (!marker) {
      const legacyLines = itemsOf(row.items).map((line) => {
        const product = products[String(line.product_id)];
        const sizeRow = line.size && product ? sizesOfProduct(product).find((s) => s.size === line.size) : null;
        return { ...line, _sizeKey: sizeRow ? sizeRow.key : null };
      });
      marker = { state: "reserved", lines: legacyLines, total: Number(row.total) || 0, legacy: true };
    }
    if (marker.state === "reserved") {
      for (const line of marker.lines || []) {
        const product = products[String(line.product_id)];
        if (!product) continue;
        const qty = Math.max(0, Number(line.qty) || 0);
        product.stock = (Number(product.stock) || 0) + qty;
        if (line._sizeKey != null && product.sizes && product.sizes[line._sizeKey]) {
          product.sizes[line._sizeKey].stock = (Number(product.sizes[line._sizeKey].stock) || 0) + qty;
        }
      }
    }
    marker.state = "released";
    marker.releasedAt = Date.now();
    markers[key] = marker;

    pending[key] = { ...row, status: "cancelled", status_by: Number(uid), status_at: Date.now() };
    root.pending_orders = pending;

    const put = await rtdbPutIfMatch(c.dbUrl, c.root, root, token, snap.etag);
    if (put.status === 412) continue;
    await ensureOk(put, "Buyurtma bekor qilinmadi");
    return { row: pending[key], repeated: false };
  }
  throw new Error("Bekor qilish band — qayta urinib ko'ring");
}

/** Navbatni bekor qiladi: status→cancelled va `slots/{date}/{key}` slotini
    O'CHIRISH — bitta root ETag CAS ichida (Worker'ga tegishli yozuvlar).
    Import qilingan yozuv server_required qaytaradi. */
async function cancelBookingAtomic(c, token, key, uid) {
  for (let attempt = 0; attempt < 10; attempt++) {
    const snap = await rtdbGetEtag(c.dbUrl, c.root, token);
    const root = snap.value && typeof snap.value === "object" ? snap.value : {};
    const bookings = root.bookings && typeof root.bookings === "object" ? root.bookings : {};
    const row = bookings[key];
    if (!row || typeof row !== "object") return { error: json({ ok: false, error: "Bunday buyurtma yo'q" }, 404) };
    if (row.imported) {
      return { error: json({ ok: false, error: "server_required", message: "Import qilingan yozuv uchun canonical server kerak" }, 409) };
    }
    const current = clean(row.status || "new", 20);
    if (!(current in ALLOWED_STATUS_TRANSITIONS.booking)) {
      return { error: json({ ok: false, error: "order_not_ready", message: "Navbat hali status o'zgarishiga tayyor emas" }, 409) };
    }
    if (current === "cancelled") return { row, repeated: true };
    if (!(ALLOWED_STATUS_TRANSITIONS.booking[current] || []).includes("cancelled")) {
      return { error: json({ ok: false, error: "invalid_transition", message: `${current} → cancelled mumkin emas`, allowed: ALLOWED_STATUS_TRANSITIONS.booking[current] || [] }, 409) };
    }
    if (row.date) {
      const slots = root.slots && typeof root.slots === "object" ? root.slots : null;
      const day = slots && slots[row.date] && typeof slots[row.date] === "object" ? slots[row.date] : null;
      if (day && day[key]) delete day[key];
    }
    bookings[key] = { ...row, status: "cancelled", status_by: Number(uid), status_at: Date.now() };
    root.bookings = bookings;
    const put = await rtdbPutIfMatch(c.dbUrl, c.root, root, token, snap.etag);
    if (put.status === 412) continue;
    await ensureOk(put, "Navbat bekor qilinmadi");
    return { row: bookings[key], repeated: false };
  }
  throw new Error("Bekor qilish band — qayta urinib ko'ring");
}

async function handleAdminOrderStatusLegacy(request, env) {
  const gate = await requireAdmin(request, env);
  if (gate.error) return gate.error;
  const { c, body, uid } = gate;

  const kind = KIND_STATUSES[clean(body.kind, 12)] ? clean(body.kind, 12) : "order";

  const key = clean(body.key, 120);
  if (!key || !/^[A-Za-z0-9_-]+$/.test(key)) {
    return json({ ok: false, error: "Buyurtma kaliti noto'g'ri" }, 400);
  }
  // Faqat do'kon buyurtmalarida eski nomlar (`done`/`shipped`) uchraydi.
  const status = kind === "order" ? normStatus(clean(body.status, 20)) : clean(body.status, 20);
  if (!KIND_STATUSES[kind].includes(status)) {
    return json({ ok: false, error: "Holat noto'g'ri", allowed: KIND_STATUSES[kind] }, 400);
  }

  // Qaysi tugun?
  //   order + db      -> `orders` (SQLite nusxasi)
  //   order + pending -> `pending_orders` (Worker qabul qilgani)
  //   biled / booking -> o'z tuguni
  let node;
  if (kind === "order") {
    node = clean(body.source, 12) === "db" ? "orders" : "pending_orders";
  } else {
    node = KIND_NODES[kind];
  }

  const token = await accessToken(env);
  const path = `${c.root}/${node}/${key}`;
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
  const text = (KIND_TEXT[kind] || {})[status];
  const label = row.code ? String(row.code) : "#" + (row.id != null ? row.id : key);
  if (text && row.uid) {
    await sendMessage(env, row.uid, `${text}\n\n🧾 ${escHtml(label)}`).catch(() => {});
  }

  return json({ ok: true, kind, key, status, node });
}

/** Barcha adminlarga bir xil xabar. */
async function notifyAdmins(env, c, text) {
  if (!env.BOT_TOKEN || !c.admins.length) return false;
  await Promise.all(c.admins.map((id) => sendMessage(env, id, text).catch(() => {})));
  return true;
}

// =====================================================================
//  STORY'GA JAVOB (Instagram'dagi "Reply to story" kabi)
//
//  NEGA WORKER ORQALI
//  Mijozning kim ekanini FAQAT server tomonda ishonchli aniqlash mumkin:
//  `initData` imzosi bot tokeni bilan tekshiriladi va token faqat shu
//  yerda turadi. Brauzer o'zini boshqa odam deb ko'rsata olmaydi.
//
//  Xabar IKKI joyga boradi:
//    1. Adminning Telegram'iga — qaysi bo'lim va qaysi story ekani bilan.
//       Ilgari mijoz `t.me/admin` ga o'tib qo'lda yozardi va admin
//       "qaysi story haqida gapiryapti?" deb tushunmasdi.
//    2. `story_replies` tuguniga — admin panelida story bo'yicha
//       guruhlangan holda ko'rinadi va yo'qolmaydi.
// =====================================================================
// =====================================================================
//  POST /admin/upload — MINI APP ICHIDAN VIDEO (va rasm) YUKLASH
//
//  MUAMMO
//  Bot ichidan video yuklash ishlaydi (`handlers/stories.py`), Mini App
//  ichidan esa MUTLAQO iloji yo'q edi:
//    * `docs/js/upload.js` ImgBB'ga yuklaydi — u FAQAT rasm qabul qiladi;
//    * `api/admin.py` dagi yuklash Render'da va u uxlab yotishi mumkin;
//    * brauzer Telegram'ga to'g'ridan murojaat qila olmaydi, chunki bot
//      tokeni kerak va uni brauzerga berish MUMKIN EMAS.
//
//  YECHIM
//  Fayl Worker'ga keladi, Worker uni bot orqali ADMINNING O'Z chatiga
//  yuboradi va Telegram qaytargan `file_id` ni oladi. Keyin video
//  `GET /media?id=<file_id>` orqali ko'rsatiladi (bu proksi allaqachon
//  bor va `Range` so'rovlarini qo'llaydi, ya'ni videoni orqaga-oldinga
//  surish ham ishlaydi).
//
//  NEGA AYNAN TELEGRAM
//  Yangi saqlash xizmati kerak emas, `file_id` muddatsiz yashaydi va
//  bot ham AYNI shu usulni ishlatadi — ya'ni botdan va Mini App'dan
//  qo'shilgan story bir xil ko'rinadi.
//
//  DIQQAT: bu yerda `requireAdmin()` ishlatilmaydi — u tanani JSON deb
//  o'qiydi, bizda esa multipart fayl keladi. Shuning uchun imzo qo'lda
//  tekshiriladi (mantiq bir xil: HMAC + ADMIN_IDS).
// =====================================================================
async function handleAdminUpload(request, env) {
  const c = cfg(env);
  if (!env.BOT_TOKEN) return json({ ok: false, error: "BOT_TOKEN sozlanmagan" }, 500);

  let form;
  try {
    form = await request.formData();
  } catch (_) {
    return json({ ok: false, error: "Fayl yuborilmadi (multipart kerak)" }, 400);
  }

  const verified = await verifyInitData(form.get("initData"), env);
  if (!verified.ok) return json({ ok: false, error: verified.error }, 401);
  const uid = String(verified.user.id);
  if (!c.admins.includes(uid)) {
    return json({ ok: false, error: "forbidden", message: "Bu amal faqat admin uchun" }, 403);
  }

  const file = form.get("file");
  if (!file || typeof file.arrayBuffer !== "function") {
    return json({ ok: false, error: "Fayl topilmadi" }, 400);
  }
  const size = Number(file.size) || 0;
  if (!size) return json({ ok: false, error: "Fayl bo'sh" }, 400);
  if (size > MAX_UPLOAD_BYTES) {
    const mb = Math.round(size / 1048576);
    return json(
      {
        ok: false,
        error: "too_big",
        message:
          `Fayl juda katta (${mb} MB). Chegara ${Math.round(MAX_UPLOAD_BYTES / 1048576)} MB — ` +
          "kalta video tanlang yoki botga tashlang.",
      },
      413
    );
  }

  const kind = String(form.get("kind") || "video").toLowerCase() === "photo" ? "photo" : "video";
  const method = kind === "photo" ? "sendPhoto" : "sendVideo";
  const field = kind === "photo" ? "photo" : "video";

  const out = new FormData();
  out.append("chat_id", uid); // adminning O'Z chati — fayl u yerda saqlanib turadi
  out.append("disable_notification", "true");
  out.append(
    "caption",
    kind === "photo" ? "🖼 Mini App: story rasmi" : "🎬 Mini App: story videosi"
  );
  out.append(field, file, file.name || (kind === "photo" ? "photo.jpg" : "video.mp4"));
  if (kind === "video") out.append("supports_streaming", "true");

  let data;
  try {
    const res = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/${method}`, {
      method: "POST",
      body: out,
    });
    data = await res.json();
  } catch (error) {
    return json({ ok: false, error: "network", message: "Telegram'ga yuborilmadi" }, 502);
  }

  if (!data || !data.ok || !data.result) {
    // Telegram sababni aytadi — uni YUTMAYMIZ, admin nima bo'lganini bilsin
    const why = (data && (data.description || data.error_code)) || "noma'lum";
    return json({ ok: false, error: "telegram", message: "Telegram rad etdi: " + why }, 502);
  }

  const r = data.result;
  let fileId = null;
  let thumbId = null;
  let duration = 0;

  if (kind === "photo") {
    const photos = Array.isArray(r.photo) ? r.photo : [];
    // Eng katta o'lcham oxirida turadi
    fileId = photos.length ? photos[photos.length - 1].file_id : null;
  } else {
    const v = r.video || r.animation || r.document || null;
    fileId = v ? v.file_id : null;
    duration = (v && Number(v.duration)) || 0;
    const th = v && (v.thumbnail || v.thumb);
    thumbId = th ? th.file_id : null;
  }

  if (!fileId) return json({ ok: false, error: "Telegram file_id bermadi" }, 502);

  /* `url` — darhol ko'rsatish uchun. Bazaga esa `file_id` yoziladi:
     u muddatsiz, va Render ham (`/api/media/...`), Worker ham
     (`/media?id=...`) shu id bo'yicha xizmat qiladi. */
  const base = new URL(request.url).origin;
  return json({
    ok: true,
    kind: kind,
    file_id: fileId,
    thumb_id: thumbId,
    duration: duration,
    size: size,
    url: `${base}/media?id=${encodeURIComponent(fileId)}`,
    thumb_url: thumbId ? `${base}/media?id=${encodeURIComponent(thumbId)}` : null,
  });
}

async function handleStoryReply(request, env) {
  const c = cfg(env);
  const body = await readJson(request);
  const verified = await verifyInitData(body.initData, env);
  if (!verified.ok) return json({ ok: false, error: verified.error }, 401);

  const user = verified.user;
  const uid = String(user.id);

  const text = clean(body.text, 900);
  if (text.length < 1) return json({ ok: false, error: "Xabar bo'sh" }, 400);

  const storyId = clean(body.story_id, 40);
  if (!storyId) return json({ ok: false, error: "story_id yo'q" }, 400);
  const ringTitle = clean(body.ring_title, 80);
  const ringKey = clean(body.ring_key, 40);
  const heading = clean(body.heading, 160);

  const name = clean(
    [user.first_name, user.last_name].filter(Boolean).join(" ") || "Mijoz",
    80
  );
  const username = clean(user.username, 40);

  // ---- 1) Tugunga yozamiz (admin paneli shu yerdan o'qiydi)
  let saved = false;
  if (c.dbUrl) {
    try {
      const token = await accessToken(env);
      const res = await fetch(rtdbUrl(c.dbUrl, "story_replies"), {
        method: "POST", // push — kalitni Firebase o'zi beradi
        headers: authHeaders(token, { "Content-Type": "application/json" }),
        body: JSON.stringify({
          storyId: storyId,
          ringKey: ringKey,
          ringTitle: ringTitle,
          heading: heading,
          uid: uid,
          name: name,
          username: username,
          text: text,
          createdAt: Date.now(),
          imported: false,
        }),
      });
      saved = res.ok;
    } catch (_) {
      saved = false;
    }
  }

  // ---- 2) Adminga Telegram xabari
  const who = username
    ? `<a href="https://t.me/${escHtml(username)}">${escHtml(name)}</a>`
    : `<a href="tg://user?id=${uid}">${escHtml(name)}</a>`;

  const where = ringTitle
    ? `📖 Bo'lim: <b>${escHtml(ringTitle)}</b>\n`
    : "";
  const what = heading ? `🏷 Story: <b>${escHtml(heading)}</b>\n` : "";

  const adminText =
    "💬 <b>Story'ga javob</b>\n\n" +
    where +
    what +
    `🆔 Story ID: <code>${escHtml(storyId)}</code>\n` +
    `👤 ${who}\n\n` +
    `<blockquote>${escHtml(text)}</blockquote>`;

  const notified = await notifyAdmins(env, c, adminText);

  /* Hech qayerga yetib bormasa — mijozga ROSTINI aytamiz. Aks holda u
     "yubordim" deb o'ylab kutib o'tiradi. */
  if (!saved && !notified) {
    return json({ ok: false, error: "Xabar yuborilmadi — keyinroq urinib ko'ring" }, 502);
  }
  return json({ ok: true, saved: saved, notified: notified });
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
    .map(
      (i) =>
        // Razmer nom bilan yonma-yon: admin buyurtmani o'qib darhol
        // to'g'ri razmerni javonda topadi (qayta qo'ng'iroq kerak emas).
        `• ${escHtml(i.name)}${i.size ? ` <b>[${escHtml(i.size)}]</b>` : ""}` +
        ` × ${i.qty} = ${fmtPrice(i.price * i.qty)}`
    )
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

function rtdbDelete(dbUrl, path, token) {
  return fetch(rtdbUrl(dbUrl, path), {
    method: "DELETE",
    headers: authHeaders(token),
  });
}

async function ensureOk(res, message) {
  if (res.ok) return res;
  const text = await res.text().catch(() => "");
  throw new Error(`${message} (${res.status}): ${text.slice(0, 200)}`);
}

async function rtdbGetStrict(dbUrl, path, token) {
  const res = await fetch(rtdbUrl(dbUrl, path), { headers: authHeaders(token) });
  await ensureOk(res, "Firebase o'qilmadi");
  return res.json();
}

async function rtdbGetEtag(dbUrl, path, token) {
  const res = await fetch(rtdbUrl(dbUrl, path), {
    headers: authHeaders(token, { "X-Firebase-ETag": "true" }),
  });
  await ensureOk(res, "Firebase CAS o'qilmadi");
  return { value: await res.json(), etag: res.headers.get("ETag") || "null_etag" };
}

function rtdbPutIfMatch(dbUrl, path, value, token, etag) {
  return fetch(rtdbUrl(dbUrl, path), {
    method: "PUT",
    headers: authHeaders(token, {
      "Content-Type": "application/json",
      "If-Match": etag || "null_etag",
    }),
    body: JSON.stringify(value),
  });
}

async function rtdbCreate(dbUrl, path, value, token) {
  const put = await rtdbPutIfMatch(dbUrl, path, value, token, "null_etag");
  if (put.ok) return { created: true, value };
  if (put.status !== 412) await ensureOk(put, "Firebase claim yaratilmadi");
  const current = await rtdbGetStrict(dbUrl, path, token);
  return { created: false, value: current };
}

async function casPatchObject(dbUrl, path, token, mutate) {
  for (let attempt = 0; attempt < 10; attempt++) {
    const snap = await rtdbGetEtag(dbUrl, path, token);
    const next = mutate(snap.value && typeof snap.value === "object" ? snap.value : {});
    const put = await rtdbPutIfMatch(dbUrl, path, next, token, snap.etag);
    if (put.status === 412) continue;
    await ensureOk(put, "Firebase CAS yozilmadi");
    return next;
  }
  throw new Error("Firebase yozuvi band — qayta urinib ko'ring");
}

async function sha256Hex(text) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
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
