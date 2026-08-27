/* ==========================================================================
   ZIMMER — STORIES BOSHQARUVI (admin paneli)

   NEGA BU FAYL BOR
   Story qo'shishning YAKKA yo'li Telegram boti edi: rasmni `#bugun matn`
   izohi bilan yuborish. Ya'ni:
     * Mini App admin panelida stories bo'limi UMUMAN yo'q edi
       (`ZimmerShop` menyusida faqat tovar, buyurtma, mijoz, ombor bor);
     * `ZimmerAdmin` (sxema asosidagi panel) da story bo'limi bor, lekin
       `api/admin.py: MENU_HIDDEN = {"prd","sto"}` uni ro'yxatdan
       YASHIRADI — ya'ni plitka hech qachon chiqmaydi;
     * hech qayerda story'ni kim ko'rgani, qanday reaksiya bo'lgani yoki
       mijoz nima yozgani ko'rinmasdi.

   ENDI: tovar qo'shish kabi — brauzerdan TO'G'RIDAN `catalog/stories` ga
   yoziladi (Render uxlab yotsa ham ishlaydi), ustiga har story bo'yicha
   ko'rishlar, reaksiyalar va mijoz javoblari ko'rinadi.

   MA'LUMOT JOYLASHUVI
     catalog/stories/{id}   — story'ning o'zi (bot ham shu yerdan o'qiydi)
     story_views/{id}/u/{uid}      — kim ko'rgan (kalit = foydalanuvchi)
     story_reactions/{id}/u/{uid}  — kim qanday reaksiya qo'ygan
     story_replies/{pushId}        — mijoz javoblari (Worker yozadi)
   ========================================================================== */

window.ZimmerStories = (function () {
  "use strict";

  const app = () => window.ZIMMER_APP || {};
  const fb = () => window.ZimmerFB;
  const shop = () => window.ZimmerShop || {};
  const up = () => window.ZimmerUpload;
  const $ = (id) => document.getElementById(id);

  const esc = (v) => (app().esc ? app().esc(v) : String(v == null ? "" : v));
  const toast = (m, ms) => (app().toast ? app().toast(m, ms) : void 0);
  const haptic = (k) => (app().haptic ? app().haptic(k) : void 0);
  const ask = (m) => (app().ask ? app().ask(m) : Promise.resolve(window.confirm(m)));

  const NODE = "catalog/stories";

  const S = {
    view: null, // list | add | replies
    rows: [], // stories
    views: {}, // {id: son}
    reacts: {}, // {id: {emoji: son}}
    replies: [], // hamma javoblar
    ring: null, // qo'shishda tanlangan bo'lim
    photo: "", // yuklangan rasm havolasi
    busy: false,
    openId: null, // javoblar ko'rilayotgan story
  };

  const body = () => $("admin-body");
  const setHead = (t, s) => (shop().setHead ? shop().setHead(t, s) : void 0);

  function loading(text) {
    body().innerHTML = '<div class="adm-loading">' + esc(text || "Yuklanmoqda...") + "</div>";
  }

  function fail(err, retry) {
    const code = (err && err.code) || "";
    const msg = (err && err.message) || "Xatolik yuz berdi";
    const hint =
      code === "rules"
        ? "Firebase Console -> Realtime Database -> Rules bo'limiga database.rules.json matnini qo'yib «Publish» bosing."
        : code === "no_db"
          ? "docs/config.js da FIREBASE_DB_URL ko'rsatilmagan."
          : "";
    body().innerHTML =
      '<div class="adm-fail"><div class="adm-fail-icon">⚠️</div><p>' +
      esc(msg) +
      "</p>" +
      (hint ? '<p class="adm-hint">' + esc(hint) + "</p>" : "") +
      '<button class="btn btn-ghost btn-sm" id="st-retry">Qayta urinish</button></div>';
    if ($("st-retry")) $("st-retry").onclick = retry;
  }

  /** Bo'limlar ro'yxati (`utils/stories.py` bilan bir xil manba). */
  function rings() {
    const off = window.ZimmerOffline;
    if (off && off.storyRings) return off.storyRings();
    return [{ key: "bugun", title: "Bugun", emoji: "⚡️", color_from: "#ff6b3d", color_to: "#3a0f00" }];
  }
  const ringOf = (key) => rings().find((r) => r.key === key) || rings()[0];

  /* ==================================================================
     O'QISH
     ================================================================== */

  async function load() {
    if (!fb() || !fb().available()) throw { code: "no_db", message: "Baza sozlanmagan" };

    const [node, views, reacts, replies] = await Promise.all([
      fb().get(NODE),
      fb().get("story_views").catch(() => null),
      fb().get("story_reactions").catch(() => null),
      fb().get("story_replies").catch(() => null),
    ]);

    S.rows = [];
    if (node && typeof node === "object") {
      Object.keys(node).forEach((k) => {
        const r = node[k];
        if (!r || typeof r !== "object" || r.deleted) return;
        S.rows.push({
          id: r.id == null ? k : r.id,
          category: String(r.category || "bugun"),
          title: String(r.title || ""),
          heading: String(r.heading || ""),
          body: String(r.body || ""),
          emoji: r.emoji || "",
          link: String(r.link || ""),
          photo_url: r.photo_url || null,
          video_url: r.video_url || null,
          is_active: r.is_active !== 0 && r.is_active !== false,
          sort: Number(r.sort) || 0,
          createdAt: Number(r.createdAt) || Number(r.updatedAt) || 0,
        });
      });
      S.rows.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0) || Number(b.id) - Number(a.id));
    }

    // Ko'rishlar: kalitlar soni = UNIKAL ko'rganlar soni
    S.views = {};
    Object.keys(views || {}).forEach((id) => {
      S.views[id] = Object.keys((views[id] && views[id].u) || {}).length;
    });

    // Reaksiyalar: {emoji: son}
    S.reacts = {};
    Object.keys(reacts || {}).forEach((id) => {
      const u = (reacts[id] && reacts[id].u) || {};
      const tally = {};
      Object.keys(u).forEach((uid) => {
        const e = u[uid];
        if (e) tally[e] = (tally[e] || 0) + 1;
      });
      S.reacts[id] = tally;
    });

    S.replies = Object.keys(replies || {})
      .map((k) => Object.assign({ _key: k }, replies[k]))
      .filter((r) => r && r.text)
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  }

  const repliesOf = (id) => S.replies.filter((r) => String(r.storyId) === String(id));

  /* ==================================================================
     RO'YXAT
     ================================================================== */

  async function open() {
    S.view = "list";
    S.openId = null;
    setHead("📸 Stories", "Yuklanmoqda...");
    loading("Stories o'qilmoqda...");
    try {
      await load();
    } catch (err) {
      return fail(err, open);
    }
    renderList();
  }

  function renderList() {
    S.view = "list";
    const total = S.rows.length;
    const seenAll = Object.keys(S.views).reduce((s, k) => s + S.views[k], 0);
    setHead("📸 Stories", total + " ta story");

    const groups = rings()
      .map((ring) => {
        const items = S.rows.filter((r) => r.category === ring.key);
        if (!items.length) return "";
        return (
          '<div class="adm-list-title">' +
          ring.emoji +
          " " +
          esc(ring.title) +
          " <i>" +
          items.length +
          "</i></div>" +
          items.map(card).join("")
        );
      })
      .join("");

    body().innerHTML =
      // ---- xulosa
      '<div class="st-sum">' +
      '<div class="st-sum-b"><b>' + total + "</b><span>story</span></div>" +
      '<div class="st-sum-b"><b>' + seenAll + "</b><span>ko'rish</span></div>" +
      '<div class="st-sum-b"><b>' + S.replies.length + "</b><span>javob</span></div>" +
      "</div>" +
      // ---- qo'shish
      '<button class="st-add" id="st-new"><span>＋</span><b>Yangi story qo\'shish</b>' +
      "<i>Rasm, sarlavha va bo'lim — 20 soniya</i></button>" +
      (S.replies.length
        ? '<button class="st-inbox" id="st-inbox">💬 Mijoz javoblari <i>' +
          S.replies.length +
          "</i></button>"
        : "") +
      (groups ||
        '<div class="st-empty"><div class="st-empty-ic">📸</div><b>Hali story yo\'q</b>' +
          "<p>Birinchi story'ni qo'shsangiz, u bosh sahifadagi halqalarda paydo bo'ladi.</p></div>");

    if ($("st-new")) $("st-new").onclick = () => openAdd();
    if ($("st-inbox")) $("st-inbox").onclick = () => openReplies(null);
    bindCards();
  }

  function card(r) {
    const id = esc(r.id);
    const views = S.views[r.id] || 0;
    const tally = S.reacts[r.id] || {};
    const reactTx = Object.keys(tally)
      .sort((a, b) => tally[b] - tally[a])
      .slice(0, 3)
      .map((e) => e + tally[e])
      .join(" ");
    const nReplies = repliesOf(r.id).length;
    const pic = r.photo_url;

    return (
      '<div class="st-card' + (r.is_active ? "" : " off") + '" id="st-card-' + id + '">' +
      '<div class="st-thumb">' +
      (pic
        ? '<img src="' + esc(pic) + '" alt="" loading="lazy">'
        : '<span>' + esc(r.emoji || "📸") + "</span>") +
      (r.video_url ? '<i class="st-play">▶</i>' : "") +
      "</div>" +
      '<div class="st-mid">' +
      "<b>" + esc(r.heading || r.title || "Sarlavhasiz") + "</b>" +
      (r.body ? '<span class="st-body">' + esc(r.body) + "</span>" : "") +
      '<div class="st-meta">' +
      '<span class="st-chip">👁 ' + views + "</span>" +
      (reactTx ? '<span class="st-chip">' + esc(reactTx) + "</span>" : "") +
      (nReplies ? '<span class="st-chip is-hot" data-replies="' + id + '">💬 ' + nReplies + "</span>" : "") +
      (r.is_active ? "" : '<span class="st-chip is-off">Yashirin</span>') +
      "</div>" +
      "</div>" +
      '<div class="st-acts">' +
      '<button class="st-mini st-eye" data-id="' + id + '">' + (r.is_active ? "👁" : "🙈") + "</button>" +
      '<button class="st-mini st-del" data-id="' + id + '">🗑</button>' +
      "</div>" +
      "</div>"
    );
  }

  function bindCards() {
    document.querySelectorAll(".st-eye").forEach((b) => {
      b.onclick = () => toggleActive(b.dataset.id);
    });
    document.querySelectorAll(".st-del").forEach((b) => {
      b.onclick = () => removeStory(b.dataset.id);
    });
    document.querySelectorAll("[data-replies]").forEach((b) => {
      b.onclick = () => openReplies(b.dataset.replies);
    });
  }

  const rowOf = (id) => S.rows.find((x) => String(x.id) === String(id));

  async function toggleActive(id) {
    const r = rowOf(id);
    if (!r) return;
    const next = !r.is_active;
    try {
      await fb().patch(NODE + "/" + id, { is_active: next ? 1 : 0, updatedAt: Date.now() });
      r.is_active = next;
      haptic("ok");
      toast(next ? "👁 Ko'rinadi" : "🙈 Yashirildi");
      freshen();
      renderList();
    } catch (err) {
      toast((err && err.message) || "Saqlanmadi");
    }
  }

  async function removeStory(id) {
    const r = rowOf(id);
    if (!r) return;
    const ok = await ask("«" + (r.heading || r.title || "Story") + "» o'chirilsinmi?");
    if (!ok) return;
    try {
      // «o'chirilgan» belgisi — bot import qilmasin, tarix qolsin
      await fb().patch(NODE + "/" + id, { deleted: true, is_active: 0, updatedAt: Date.now() });
      S.rows = S.rows.filter((x) => String(x.id) !== String(id));
      haptic("success");
      toast("🗑 O'chirildi");
      freshen();
      renderList();
    } catch (err) {
      toast((err && err.message) || "Saqlanmadi");
    }
  }

  /** Do'kon keshini tozalaydi — story darhol ko'rinadi/yo'qoladi. */
  function freshen() {
    if (app().state) app().state.home = null;
    try {
      if (window.ZimmerOffline && window.ZimmerOffline.clearCache) {
        window.ZimmerOffline.clearCache();
      }
    } catch (_) {}
  }

  /* ==================================================================
     QO'SHISH
     ================================================================== */

  function openAdd() {
    S.view = "add";
    S.photo = "";
    S.ring = S.ring || rings()[0].key;
    setHead("Yangi story", "Rasm va sarlavha");

    body().innerHTML =
      '<div class="adm-form">' +
      // ---- rasm
      '<div class="admin-form-group">' +
      '<div class="apx-sub" style="margin-top:0;">Rasm</div>' +
      '<div class="st-pick" id="st-pick"><span id="st-pick-ic">🖼</span>' +
      '<b id="st-pick-tx">Rasm tanlash</b><i>Telefon galereyasidan</i></div>' +
      '<input type="file" accept="image/*" id="st-file" class="hidden">' +
      '<div class="st-prev hidden" id="st-prev"></div>' +
      '<label class="adm-field" style="margin-top:12px;"><span>Yoki rasm havolasi</span>' +
      '<input type="text" class="admin-input" id="st-url" placeholder="https://..."></label>' +
      "</div>" +
      // ---- bo'lim
      '<div class="admin-form-group">' +
      '<div class="apx-sub" style="margin-top:0;">Bo\'lim</div>' +
      '<div class="st-rings" id="st-rings"></div>' +
      "</div>" +
      // ---- matn
      '<div class="admin-form-group">' +
      '<div class="apx-sub" style="margin-top:0;">Matn</div>' +
      '<label class="adm-field"><span>Sarlavha</span>' +
      '<input type="text" class="admin-input" id="st-head" maxlength="120" placeholder="Masalan: Bugun 3 ta mashina tayyor"></label>' +
      '<label class="adm-field"><span>Izoh (ixtiyoriy)</span>' +
      '<textarea class="admin-input" id="st-body" rows="3" maxlength="400" placeholder="Qisqa tafsilot"></textarea></label>' +
      '<label class="adm-field"><span>Havola (ixtiyoriy)</span>' +
      '<input type="text" class="admin-input" id="st-link" placeholder="Tovar ID (masalan 47) yoki https://..."></label>' +
      '<p class="adm-hint">Havola qo\'ysangiz, story ostida «Batafsil ko\'rish» tugmasi chiqadi.</p>' +
      "</div>" +
      "</div>" +
      '<div class="shop-footer">' +
      '<button class="btn btn-primary" id="st-save">💾 Saqlash</button>' +
      "</div>";

    renderRingPicker();

    const file = $("st-file");
    if ($("st-pick")) $("st-pick").onclick = () => file && file.click();
    if (file) file.onchange = () => pickPhoto(file.files && file.files[0]);
    if ($("st-url"))
      $("st-url").oninput = () => {
        const v = ($("st-url").value || "").trim();
        if (/^https?:\/\//i.test(v)) {
          S.photo = v;
          showPreview(v);
        }
      };
    if ($("st-save")) $("st-save").onclick = save;
  }

  function renderRingPicker() {
    const box = $("st-rings");
    if (!box) return;
    box.innerHTML = rings()
      .map(
        (r) =>
          '<button class="st-ring' +
          (S.ring === r.key ? " on" : "") +
          '" data-k="' +
          esc(r.key) +
          '" style="--rf:' +
          esc(r.color_from) +
          ";--rt:" +
          esc(r.color_to) +
          '"><span>' +
          r.emoji +
          "</span><i>" +
          esc(r.title) +
          "</i></button>"
      )
      .join("");
    box.querySelectorAll(".st-ring").forEach((b) => {
      b.onclick = () => {
        haptic("selection");
        S.ring = b.dataset.k;
        renderRingPicker();
      };
    });
  }

  function showPreview(url) {
    const box = $("st-prev");
    if (!box) return;
    box.innerHTML = '<img src="' + esc(url) + '" alt="">';
    box.classList.remove("hidden");
    const tx = $("st-pick-tx");
    if (tx) tx.textContent = "Rasmni almashtirish";
  }

  async function pickPhoto(f) {
    if (!f) return;
    if (!up() || !up().available()) {
      return toast("Rasm yuklash sozlanmagan (IMGBB_KEY)");
    }
    const tx = $("st-pick-tx");
    const ic = $("st-pick-ic");
    if (tx) tx.textContent = "Yuklanmoqda...";
    if (ic) ic.textContent = "⏳";
    try {
      const res = await up().uploadFile(f);
      const url = (res && (res.url || res.display_url)) || "";
      if (!url) throw { message: "Havola qaytmadi" };
      S.photo = url;
      showPreview(url);
      if (ic) ic.textContent = "✅";
      haptic("ok");
      toast("Rasm yuklandi");
    } catch (err) {
      if (tx) tx.textContent = "Rasm tanlash";
      if (ic) ic.textContent = "🖼";
      toast((err && err.message) || "Rasm yuklanmadi");
    }
  }

  async function save() {
    if (S.busy) return;
    const heading = ($("st-head").value || "").trim();
    if (heading.length < 2) return toast("Sarlavhani kiriting");
    if (!S.photo) return toast("Rasm tanlang yoki havola kiriting");

    const ring = ringOf(S.ring);
    const bodyTx = ($("st-body").value || "").trim();
    const link = ($("st-link").value || "").trim();

    const btn = $("st-save");
    S.busy = true;
    if (btn) {
      btn.disabled = true;
      btn.textContent = "Saqlanmoqda...";
    }
    try {
      const id = await fb().nextStoryId();
      /* Maydonlar `database/queries.py: EDITABLE["stories"]` bilan MOS —
         Render uyg'onganda bot uni SQLite'ga o'zi ko'chiradi. */
      await fb().put(NODE + "/" + id, {
        id: id,
        _key: heading, // CATALOG_KEY["stories"] = "title"/heading bo'yicha moslashtiriladi
        category: ring.key,
        title: heading,
        heading: heading,
        body: bodyTx || null,
        emoji: ring.emoji,
        color_from: ring.color_from,
        color_to: ring.color_to,
        photo_url: S.photo,
        photo_id: null,
        video_url: null,
        video_id: null,
        link: link || null,
        sort: 0,
        is_active: 1,
        deleted: false,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        source: "miniapp",
      });
      haptic("success");
      toast("✅ Story qo'shildi");
      freshen();
      S.photo = "";
      await open();
    } catch (err) {
      toast((err && err.message) || "Saqlanmadi");
    } finally {
      S.busy = false;
      if (btn) {
        btn.disabled = false;
        btn.textContent = "💾 Saqlash";
      }
    }
  }

  /* ==================================================================
     MIJOZ JAVOBLARI

     Worker (`/story-reply`) har javobni `story_replies` ga yozadi va
     ichida QAYSI story ekani turadi. Shu sababli javob "havoda" qolmaydi.
     ================================================================== */

  function openReplies(storyId) {
    S.view = "replies";
    S.openId = storyId || null;
    const list = storyId ? repliesOf(storyId) : S.replies;
    const r = storyId ? rowOf(storyId) : null;
    setHead("💬 Javoblar", r ? r.heading || r.title : list.length + " ta xabar");

    if (!list.length) {
      body().innerHTML =
        '<div class="st-empty"><div class="st-empty-ic">💬</div><b>Javob yo\'q</b>' +
        "<p>Mijoz story ostidagi maydonga yozsa, xabar shu yerda va Telegram'ingizda paydo bo'ladi.</p></div>";
      return;
    }

    body().innerHTML = list
      .map((m) => {
        const who = m.username ? "@" + m.username : "ID " + m.uid;
        const st = rowOf(m.storyId);
        const where = m.ringTitle || (st && st.heading) || "";
        return (
          '<div class="st-msg">' +
          '<div class="st-msg-top"><b>' +
          esc(m.name || "Mijoz") +
          "</b><span>" +
          esc(who) +
          "</span></div>" +
          (where ? '<div class="st-msg-src">📖 ' + esc(where) +
            (m.heading ? " · " + esc(m.heading) : "") + "</div>" : "") +
          '<div class="st-msg-tx">' + esc(m.text) + "</div>" +
          '<div class="st-msg-bot"><span>' +
          esc(when(m.createdAt)) +
          "</span>" +
          (m.username
            ? '<button class="st-reply" data-u="' + esc(m.username) + '">Javob berish →</button>'
            : "") +
          "</div>" +
          "</div>"
        );
      })
      .join("");

    document.querySelectorAll(".st-reply").forEach((b) => {
      b.onclick = () => {
        haptic();
        const url = "https://t.me/" + b.dataset.u;
        const wa = window.Telegram && window.Telegram.WebApp;
        if (wa && wa.openTelegramLink) wa.openTelegramLink(url);
        else window.open(url, "_blank");
      };
    });
  }

  function when(ms) {
    if (shop().timeLabel) return shop().timeLabel(ms);
    const d = new Date(Number(ms) || 0);
    return isNaN(d.getTime()) ? "" : d.toLocaleString();
  }

  /* ==================================================================
     TASHQI INTERFEYS
     ================================================================== */

  const isActive = () => S.view !== null;
  const close = () => (S.view = null);

  function back() {
    if (S.view === "add" || S.view === "replies") {
      renderList();
      return true;
    }
    return false; // ro'yxatda — ZimmerShop menyuga chiqaradi
  }

  function reload() {
    if (S.view === "replies") {
      const id = S.openId;
      return open().then(() => openReplies(id));
    }
    if (S.view === "add") return openAdd();
    return open();
  }

  return {
    open: open,
    openAdd: openAdd,
    back: back,
    reload: reload,
    isActive: isActive,
    close: close,
  };
})();
