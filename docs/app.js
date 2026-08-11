/* ==========================================================================
   Zimmer Mini App
   Backend: bot ichidagi API (Render). Auth: Telegram initData (HMAC imzo).
   ========================================================================== */

const tg = window.Telegram ? window.Telegram.WebApp : null;

/* ----------------------------- yordamchilar ----------------------------- */

const $ = (id) => document.getElementById(id);
const el = (tag, cls, html) => {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (html !== undefined) node.innerHTML = html;
  return node;
};
const esc = (value) =>
  String(value ?? "").replace(/[&<>"']/g, (ch) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch])
  );

const state = {
  currency: "so'm",
  profile: null,
  services: [],
  catalog: [],
  categoryId: null,
  service: null,
  date: null,
  cart: loadCart(),
};

function fmtPrice(value) {
  const num = Number(value) || 0;
  return num.toLocaleString("ru-RU").replace(/,/g, " ") + " " + state.currency;
}

function toast(message, ms = 2600) {
  const node = $("toast");
  node.textContent = message;
  node.classList.remove("hidden");
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => node.classList.add("hidden"), ms);
}

function haptic(type = "light") {
  try {
    tg?.HapticFeedback?.impactOccurred(type);
  } catch (_) {}
}

function confirmDialog(message) {
  return new Promise((resolve) => {
    if (tg?.showConfirm) tg.showConfirm(message, (ok) => resolve(Boolean(ok)));
    else resolve(window.confirm(message));
  });
}

/* --------------------------------- API --------------------------------- */

function apiBase() {
  const fromUrl = new URLSearchParams(location.search).get("api");
  if (fromUrl) {
    localStorage.setItem("zimmer_api", fromUrl);
    return fromUrl.replace(/\/$/, "");
  }
  const saved = localStorage.getItem("zimmer_api");
  const base = saved || window.ZIMMER_CONFIG?.API_BASE || "";
  return base.replace(/\/$/, "");
}

const API = apiBase();

async function api(path, { method = "GET", body } = {}) {
  const headers = { Authorization: "tma " + (tg?.initData || "") };
  if (body !== undefined) headers["Content-Type"] = "application/json";

  let response;
  try {
    response = await fetch(API + path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (_) {
    throw { code: "network", message: "Internetga ulanish yo'q yoki server javob bermadi." };
  }

  let data = null;
  try {
    data = await response.json();
  } catch (_) {}

  if (!response.ok) {
    const error = data?.error || {};
    throw {
      code: error.code || "http_" + response.status,
      message: error.message || "Xatolik yuz berdi (" + response.status + ")",
      ...error,
    };
  }
  return data;
}

function handleError(error) {
  if (error?.code === "not_registered") {
    showGate("Ilovadan foydalanish uchun avval botda ism va telefon raqamingizni qoldiring.");
    return;
  }
  if (error?.code === "invalid_init_data") {
    showGate("Telegram ma'lumotlari tasdiqlanmadi. Ilovani bot ichidagi tugma orqali oching.");
    return;
  }
  toast(error?.message || "Xatolik yuz berdi");
}

/* -------------------------------- savatcha ------------------------------- */

function loadCart() {
  try {
    const raw = JSON.parse(localStorage.getItem("zimmer_cart") || "[]");
    return Array.isArray(raw) ? raw : [];
  } catch (_) {
    return [];
  }
}

function saveCart() {
  localStorage.setItem("zimmer_cart", JSON.stringify(state.cart));
  renderCartBadge();
}

function cartAdd(product) {
  const found = state.cart.find((item) => item.id === product.id);
  const inCart = found ? found.qty : 0;
  if (inCart + 1 > product.stock) {
    toast(`Omborda faqat ${product.stock} dona bor`);
    return;
  }
  if (found) found.qty += 1;
  else
    state.cart.push({
      id: product.id,
      name: product.name,
      price: product.price,
      qty: 1,
      stock: product.stock,
    });
  saveCart();
  haptic();
  toast(`«${product.name}» savatchaga qo'shildi`);
}

function cartChange(id, delta) {
  const item = state.cart.find((entry) => entry.id === id);
  if (!item) return;
  if (delta > 0 && item.qty + delta > item.stock) {
    toast(`Omborda ${item.stock} dona bor`);
    return;
  }
  item.qty += delta;
  if (item.qty < 1) state.cart = state.cart.filter((entry) => entry.id !== id);
  saveCart();
  renderCart();
}

function cartRemove(id) {
  state.cart = state.cart.filter((entry) => entry.id !== id);
  saveCart();
  renderCart();
}

const cartTotal = () => state.cart.reduce((sum, item) => sum + item.price * item.qty, 0);
const cartCount = () => state.cart.reduce((sum, item) => sum + item.qty, 0);

function renderCartBadge() {
  const count = cartCount();
  const badge = $("cart-badge");
  badge.textContent = count;
  badge.classList.toggle("hidden", count === 0);
}

/* ------------------------------ navigatsiya ------------------------------ */

function showTab(name) {
  ["book", "shop", "cart", "profile"].forEach((tab) => {
    $("screen-" + tab).classList.toggle("hidden", tab !== name);
    document
      .querySelector(`.tab[data-tab="${tab}"]`)
      .classList.toggle("active", tab === name);
  });
  state.tab = name;
  if (name === "cart") renderCart();
  if (name === "profile") loadProfileData();
  updateBackButton();
  window.scrollTo({ top: 0 });
}

function bookingStep(step) {
  state.step = step;
  $("step-service").classList.toggle("hidden", step !== 1);
  $("step-date").classList.toggle("hidden", step !== 2);
  $("step-time").classList.toggle("hidden", step !== 3);
  updateBackButton();
  window.scrollTo({ top: 0 });
}

function updateBackButton() {
  if (!tg?.BackButton) return;
  const show = state.tab === "book" && state.step > 1;
  if (show) tg.BackButton.show();
  else tg.BackButton.hide();
}

/* -------------------------------- navbat -------------------------------- */

function renderServices() {
  const box = $("services");
  box.innerHTML = "";
  if (!state.services.length) {
    box.append(el("p", "empty", "Hozircha xizmatlar qo'shilmagan."));
    return;
  }
  state.services.forEach((service) => {
    const item = el("button", "item");
    item.innerHTML = `
      <div>
        <div class="item-title">${esc(service.name)}</div>
        <div class="item-sub">⏱ ${service.duration_min} daqiqa</div>
      </div>
      <div class="item-price">${esc(service.price_label)}</div>`;
    item.onclick = () => selectService(service);
    box.append(item);
  });
}

async function selectService(service) {
  state.service = service;
  haptic();
  $("chosen-service").innerHTML =
    `🛠 <b>${esc(service.name)}</b> · ${esc(service.price_label)} · ${service.duration_min} daq.`;
  $("dates").innerHTML = '<p class="empty">Yuklanmoqda...</p>';
  bookingStep(2);

  try {
    const dates = await api("/api/dates?service_id=" + service.id);
    const box = $("dates");
    box.innerHTML = "";
    dates.forEach((day) => {
      const chip = el("button", "chip");
      chip.innerHTML = `${esc(day.short_label)}<small>${
        day.free_count ? day.free_count + " ta joy" : "band"
      }</small>`;
      chip.disabled = day.free_count === 0;
      chip.onclick = () => selectDate(day);
      box.append(chip);
    });
  } catch (error) {
    handleError(error);
    bookingStep(1);
  }
}

async function selectDate(day) {
  state.date = day.date;
  haptic();
  $("chosen-date").innerHTML =
    `🛠 <b>${esc(state.service.name)}</b><br>📅 <b>${esc(day.label)}</b>`;
  $("slots").innerHTML = '<p class="empty">Yuklanmoqda...</p>';
  $("slots-empty").classList.add("hidden");
  bookingStep(3);

  try {
    const data = await api(
      `/api/slots?service_id=${state.service.id}&date=${encodeURIComponent(day.date)}`
    );
    renderSlots(data.slots);
  } catch (error) {
    handleError(error);
    bookingStep(2);
  }
}

function renderSlots(slots) {
  const box = $("slots");
  box.innerHTML = "";
  $("slots-empty").classList.toggle("hidden", slots.length > 0);
  slots.forEach((time) => {
    const chip = el("button", "chip", time);
    chip.onclick = () => confirmBooking(time);
    box.append(chip);
  });
}

async function confirmBooking(time) {
  const service = state.service;
  const ok = await confirmDialog(
    `Navbatni tasdiqlaysizmi?\n\n${service.name}\n${state.date} · ${time}\n${service.price_label}`
  );
  if (!ok) return;

  try {
    const result = await api("/api/bookings", {
      method: "POST",
      body: { service_id: service.id, date: state.date, time },
    });
    haptic("medium");
    toast(`✅ Navbat olindi: #${result.booking.id} · ${time}`, 3200);
    bookingStep(1);
    showTab("profile");
  } catch (error) {
    if (error.code === "slot_taken" && Array.isArray(error.slots)) {
      renderSlots(error.slots);
      toast(error.message);
      return;
    }
    handleError(error);
  }
}

/* -------------------------------- do'kon -------------------------------- */

function renderCategories() {
  const box = $("categories");
  box.innerHTML = "";
  state.catalog.forEach((category) => {
    const chip = el("button", "chip" + (category.id === state.categoryId ? " active" : ""));
    chip.textContent = category.name;
    chip.onclick = () => {
      state.categoryId = category.id;
      haptic();
      renderCategories();
      renderProducts();
    };
    box.append(chip);
  });
}

function renderProducts() {
  const box = $("products");
  box.innerHTML = "";
  const category = state.catalog.find((entry) => entry.id === state.categoryId);
  const products = category ? category.products : [];
  $("products-empty").classList.toggle("hidden", products.length > 0);

  products.forEach((product) => {
    const card = el("div", "product");
    const photo = product.photo_url
      ? `<img class="product-photo" src="${API + product.photo_url}" alt="" loading="lazy">`
      : '<div class="product-photo placeholder">🛍</div>';
    const outOfStock = product.stock < 1;
    card.innerHTML = `
      ${photo}
      <div class="product-body">
        <div class="product-name">${esc(product.name)}</div>
        ${product.description ? `<div class="product-desc">${esc(product.description)}</div>` : ""}
        <div class="product-price">${esc(product.price_label)}</div>
        <div class="product-stock${outOfStock ? " out" : ""}">${
          outOfStock ? "Mavjud emas" : product.stock + " dona bor"
        }</div>
      </div>`;
    const button = el("button", "btn-add", outOfStock ? "Tugagan" : "➕ Savatchaga");
    button.disabled = outOfStock;
    button.onclick = () => cartAdd(product);
    card.append(button);
    box.append(card);
  });
}

/* ------------------------------- savatcha ------------------------------- */

function renderCart() {
  const box = $("cart-items");
  box.innerHTML = "";
  const empty = state.cart.length === 0;
  $("cart-empty").classList.toggle("hidden", !empty);
  $("cart-checkout").classList.toggle("hidden", empty);

  state.cart.forEach((item) => {
    const row = el("div", "item");
    row.innerHTML = `
      <div>
        <div class="item-title">${esc(item.name)}</div>
        <div class="item-sub">${fmtPrice(item.price)} × ${item.qty} = <b>${fmtPrice(
      item.price * item.qty
    )}</b></div>
      </div>`;
    const qty = el("div", "qty");
    const minus = el("button", null, "−");
    const plus = el("button", null, "+");
    const trash = el("button", null, "🗑");
    minus.onclick = () => cartChange(item.id, -1);
    plus.onclick = () => cartChange(item.id, 1);
    trash.onclick = () => cartRemove(item.id);
    qty.append(minus, el("span", null, String(item.qty)), plus, trash);
    row.append(qty);
    box.append(row);
  });

  $("cart-total").textContent = fmtPrice(cartTotal());
  renderCartBadge();
}

async function submitOrder() {
  const address = $("order-address").value.trim();
  const phone = $("order-phone").value.trim();

  if (address.length < 5) {
    toast("Manzilni to'liqroq yozing");
    return;
  }
  if (!state.cart.length) {
    toast("Savatcha bo'sh");
    return;
  }

  const button = $("order-submit");
  button.disabled = true;
  button.textContent = "Yuborilmoqda...";

  try {
    const result = await api("/api/orders", {
      method: "POST",
      body: {
        items: state.cart.map((item) => ({ product_id: item.id, qty: item.qty })),
        address,
        phone,
      },
    });
    state.cart = [];
    saveCart();
    renderCart();
    $("order-address").value = "";
    haptic("medium");
    toast(`✅ Buyurtma #${result.order.id} qabul qilindi`, 3400);
    await loadCatalog();
    showTab("profile");
  } catch (error) {
    handleError(error);
  } finally {
    button.disabled = false;
    button.textContent = "Buyurtma berish";
  }
}

/* -------------------------------- kabinet ------------------------------- */

async function loadProfileData() {
  try {
    const [bookings, orders] = await Promise.all([
      api("/api/bookings"),
      api("/api/orders"),
    ]);
    renderBookings(bookings);
    renderOrders(orders);
  } catch (error) {
    handleError(error);
  }
}

function renderBookings(bookings) {
  const box = $("my-bookings");
  box.innerHTML = "";
  $("bookings-empty").classList.toggle("hidden", bookings.length > 0);

  bookings.forEach((booking) => {
    const card = el("div", "card");
    card.innerHTML = `
      <div class="row">
        <b>#${booking.id} · ${esc(booking.service_name)}</b>
        <span class="status ${esc(booking.status)}">${esc(booking.status_label)}</span>
      </div>
      <div class="item-sub">📅 ${esc(booking.date_label)} · 🕐 <b>${esc(
      booking.time
    )}</b> · ${esc(booking.price_label)}</div>`;
    if (booking.can_cancel) {
      const cancel = el("button", "btn btn-danger btn-sm", "Bekor qilish");
      cancel.style.marginTop = "10px";
      cancel.onclick = async () => {
        if (!(await confirmDialog(`#${booking.id} navbatni bekor qilasizmi?`))) return;
        try {
          await api(`/api/bookings/${booking.id}/cancel`, { method: "POST" });
          toast("Navbat bekor qilindi");
          loadProfileData();
        } catch (error) {
          handleError(error);
        }
      };
      card.append(cancel);
    }
    box.append(card);
  });
}

function renderOrders(orders) {
  const box = $("my-orders");
  box.innerHTML = "";
  $("orders-empty").classList.toggle("hidden", orders.length > 0);

  orders.forEach((order) => {
    const goods = order.items
      .map((item) => `${esc(item.name)} ×${item.qty}`)
      .join(", ");
    const card = el("div", "card");
    card.innerHTML = `
      <div class="row">
        <b>#${order.id} · ${esc(order.total_label)}</b>
        <span class="status ${esc(order.status)}">${esc(order.status_label)}</span>
      </div>
      <div class="order-goods">🛍 ${goods}</div>
      <div class="order-goods">📍 ${esc(order.address || "-")}</div>`;
    box.append(card);
  });
}

/* --------------------------------- boot --------------------------------- */

function showGate(message) {
  $("loader").classList.add("hidden");
  $("app").classList.add("hidden");
  $("gate").classList.remove("hidden");
  if (message) $("gate-text").textContent = message;
}

async function loadCatalog() {
  state.catalog = await api("/api/catalog");
  if (!state.catalog.some((category) => category.id === state.categoryId)) {
    state.categoryId = state.catalog[0]?.id ?? null;
  }
  renderCategories();
  renderProducts();
}

async function boot() {
  if (tg) {
    tg.ready();
    tg.expand();
    tg.BackButton?.onClick(() => bookingStep(Math.max(1, (state.step || 1) - 1)));
  }

  if (!tg || !tg.initData) {
    showGate(
      "Ilovani Telegram ichidan oching — botga /start yuborib «🚀 Ilovani ochish» tugmasini bosing."
    );
    return;
  }

  try {
    const [config, me] = await Promise.all([api("/api/config"), api("/api/me")]);
    state.currency = config.currency || "so'm";
    state.profile = me;

    $("shop-name").textContent = config.shop_name || "Zimmer";
    $("work-hours").textContent =
      String(config.work_start_hour).padStart(2, "0") +
      ":00–" +
      String(config.work_end_hour).padStart(2, "0") +
      ":00";

    if (!me.registered) {
      showGate();
      return;
    }

    $("user-name").textContent = me.full_name || me.first_name || "";
    $("profile-name").textContent = me.full_name || "—";
    $("profile-phone").textContent = me.phone || "—";
    $("order-phone").value = me.phone || "";

    state.services = await api("/api/services");
    renderServices();
    await loadCatalog();
    renderCartBadge();

    $("loader").classList.add("hidden");
    $("app").classList.remove("hidden");
    bookingStep(1);
    showTab("book");
  } catch (error) {
    if (error?.code === "not_registered" || error?.code === "invalid_init_data") {
      handleError(error);
      return;
    }
    showGate(
      (error?.message || "Server javob bermadi") +
        "\n\nServer manzili: " +
        (API || "ko'rsatilmagan")
    );
  }
}

/* ------------------------------- hodisalar ------------------------------ */

document.querySelectorAll(".tab").forEach((tab) => {
  tab.onclick = () => {
    haptic();
    showTab(tab.dataset.tab);
  };
});

$("order-submit").onclick = submitOrder;
$("gate-close").onclick = () => (tg ? tg.close() : window.close());
$("gate-retry").onclick = () => location.reload();

boot();
