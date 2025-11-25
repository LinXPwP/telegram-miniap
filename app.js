// app.js

// URL-ul Netlify function (proxy către bot.py)
const API_URL = "https://api.redgen.vip/";

/* ============================
   HELPER – SMART POLLING
   ============================ */
function createSmartPoll(fetchFn, isEnabledFn, options = {}) {
  const minInterval = options.minInterval ?? 3000;
  const maxInterval = options.maxInterval ?? 8000;
  const backoffStep = options.backoffStep ?? 2000;
  const idleThreshold = options.idleThreshold ?? 4;

  let timeoutId = null;
  let active = false;
  let currentInterval = minInterval;
  let idleCount = 0;
  let lastSnapshot = null;

  async function tick() {
    if (!active) return;

    if (!isEnabledFn || !isEnabledFn()) {
      schedule(maxInterval);
      return;
    }

    try {
      const data = await fetchFn();
      if (!active) return;

      if (data !== undefined) {
        const snap = JSON.stringify(data);
        if (lastSnapshot === null || snap !== lastSnapshot) {
          lastSnapshot = snap;
          idleCount = 0;
          currentInterval = minInterval;
        } else {
          idleCount += 1;
          if (idleCount >= idleThreshold) {
            currentInterval = Math.min(maxInterval, currentInterval + backoffStep);
          }
        }
      }
    } catch (e) {
      console.error("[smartPoll] error:", e);
      currentInterval = Math.min(maxInterval, currentInterval + backoffStep);
    }

    schedule(currentInterval);
  }

  function schedule(delay) {
    if (!active) return;
    if (timeoutId) clearTimeout(timeoutId);
    timeoutId = setTimeout(tick, delay);
  }

  return {
    start() {
      if (active) return;
      active = true;
      idleCount = 0;
      currentInterval = minInterval;
      tick();
    },
    stop() {
      active = false;
      if (timeoutId) clearTimeout(timeoutId);
      timeoutId = null;
    },
    bumpFast() {
      if (!active) return;
      idleCount = 0;
      currentInterval = minInterval;
      schedule(currentInterval);
    },
  };
}

/* ============================
   BOOTSTRAP – Tabs + init
   ============================ */

document.addEventListener("DOMContentLoaded", () => {
  const pageType = document.body.dataset.page;

  document.querySelectorAll(".tabs").forEach((tabs) => {
    const buttons = tabs.querySelectorAll(".tab-btn");

    let activeBtn =
      tabs.querySelector(".tab-btn.active") || tabs.querySelector(".tab-btn");
    if (activeBtn) {
      tabs.setAttribute("data-active", activeBtn.dataset.tab);
    }

    buttons.forEach((btn) => {
      btn.addEventListener("click", () => {
        buttons.forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");

        const target = btn.getAttribute("data-tab");
        tabs.setAttribute("data-active", target || "");

        if (target) {
          document
            .querySelectorAll(".tab-section")
            .forEach((s) => s.classList.remove("active"));
          const section = document.getElementById(target);
          if (section) section.classList.add("active");
        }

        if (pageType === "user" && typeof window.onUserTabChange === "function") {
          window.onUserTabChange(target);
        }
        if (
          pageType === "admin" &&
          typeof window.onAdminTabChange === "function"
        ) {
          window.onAdminTabChange(target);
        }
      });
    });
  });

  if (pageType === "user") {
    initUserApp();
  } else if (pageType === "admin") {
    initAdminApp();
  }
});

/* ============================
   UTILS comune
   ============================ */

function isNearBottom(el, threshold = 64) {
  if (!el) return true;
  return el.scrollHeight - el.scrollTop - el.clientHeight < threshold;
}

function scrollToBottom(el) {
  if (!el) return;
  el.scrollTop = el.scrollHeight;
}

/* ============================
   USER MINIAPP (index.html)
   ============================ */

function initUserApp() {
  const tg = window.Telegram?.WebApp;

  let CURRENT_USER = null;
  let CURRENT_SHOP = null;
  let CURRENT_TICKETS = [];
  let SELECTED_TICKET_ID = null;

  let lastUserTicketsHash = null;

  let userActiveUntil = 0;
  function bumpUserActive(extraMs = 25000) {
    const now = Date.now();
    userActiveUntil = Math.max(userActiveUntil, now + extraMs);
  }

  const creditsValueEl = document.getElementById("creditsValue");
  const userLineEl = document.getElementById("userLine");

  const categoriesContainer = document.getElementById("categoriesContainer");
  const productPanelEl = document.getElementById("productPanel");
  const panelNameEl = document.getElementById("panelName");
  const panelDescEl = document.getElementById("panelDesc");
  const panelPriceEl = document.getElementById("panelPrice");
  const panelQtyEl = document.getElementById("panelQty");
  const panelQtyRangeEl = document.getElementById("panelQtyRange");
  const panelBuyBtn = document.getElementById("panelBuyBtn");
  const panelCloseBtn = document.getElementById("panelCloseBtn");
  const panelStatusEl = document.getElementById("panelStatus");
  let SELECTED_PRODUCT = null;

  const chatListEl = document.getElementById("chatList");
  const chatHeaderEl = document.getElementById("chatHeader");
  const chatMessagesEl = document.getElementById("chatMessages");
  const chatInputEl = document.getElementById("chatInput");
  const chatSendBtn = document.getElementById("chatSendBtn");
  const ticketsInfoEl = document.getElementById("ticketsInfo");

  function apiCall(action, extraPayload = {}) {
    const payload = {
      action,
      user: CURRENT_USER,
      ...extraPayload,
    };
    return fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }).then((r) => r.json());
  }

  function isTicketsTabActive() {
    const tab = document.getElementById("ticketsTab");
    return tab && tab.classList.contains("active");
  }

  function renderUserHeader() {
    if (!CURRENT_USER) return;
    creditsValueEl.textContent = CURRENT_USER.credits;
    const name =
      CURRENT_USER.username && CURRENT_USER.username !== "fara_username"
        ? "@" + CURRENT_USER.username
        : `ID ${CURRENT_USER.id}`;
    userLineEl.innerHTML = `Utilizator: <b>${name}</b>`;
  }

  /* ---------- SHOP (user) ---------- */

  function renderShop(shop) {
    categoriesContainer.innerHTML = "";
    if (!shop || !shop.categories) return;

    shop.categories.forEach((cat) => {
      const catDiv = document.createElement("div");
      catDiv.className = "category";

      const header = document.createElement("div");
      header.className = "category-header";

      const nameSpan = document.createElement("div");
      nameSpan.className = "category-name";
      nameSpan.textContent = cat.name;

      const pill = document.createElement("div");
      pill.className = "category-pill";
      pill.textContent = "categorie";

      header.appendChild(nameSpan);
      header.appendChild(pill);

      const desc = document.createElement("div");
      desc.className = "category-desc";
      desc.textContent = cat.description || "";

      const productsDiv = document.createElement("div");
      productsDiv.className = "products";

      (cat.products || []).forEach((prod) => {
        const prodDiv = document.createElement("div");
        prodDiv.className = "product";

        const main = document.createElement("div");
        main.className = "product-main";

        const title = document.createElement("div");
        title.className = "product-name";
        title.textContent = prod.name;

        const pdesc = document.createElement("div");
        pdesc.className = "product-desc";
        pdesc.textContent = prod.description || "";

        main.appendChild(title);
        main.appendChild(pdesc);

        const right = document.createElement("div");
        right.style.textAlign = "right";

        const price = document.createElement("div");
        price.className = "product-price";
        price.textContent = prod.price + " credite";

        const btn = document.createElement("button");
        btn.className = "product-btn";
        btn.textContent = "Detalii";
        btn.onclick = () => openProductPanel(prod);

        right.appendChild(price);
        right.appendChild(btn);

        prodDiv.appendChild(main);
        prodDiv.appendChild(right);

        productsDiv.appendChild(prodDiv);
      });

      catDiv.appendChild(header);
      catDiv.appendChild(desc);
      catDiv.appendChild(productsDiv);

      categoriesContainer.appendChild(catDiv);
    });
  }

  function openProductPanel(prod) {
    SELECTED_PRODUCT = prod;
    panelStatusEl.textContent = "";
    panelStatusEl.className = "status-bar";

    panelNameEl.textContent = prod.name;
    panelDescEl.textContent = prod.description || "";
    panelPriceEl.textContent = `Preț: ${prod.price} credite / buc.`;

    const min = prod.min_qty || 1;
    const max = prod.max_qty || min;

    panelQtyEl.min = min;
    panelQtyEl.max = max;
    panelQtyEl.value = min;
    panelQtyRangeEl.textContent = `(min ${min}, max ${max})`;

    productPanelEl.style.display = "block";
  }

  function closeProductPanel() {
    SELECTED_PRODUCT = null;
    productPanelEl.style.display = "none";
  }

  async function buySelectedProduct() {
    if (!SELECTED_PRODUCT || !CURRENT_USER) return;

    const qty = Number(panelQtyEl.value || 0);
    const prod = SELECTED_PRODUCT;

    panelStatusEl.textContent = "Se trimite comanda...";
    panelStatusEl.className = "status-bar";

    try {
      const res = await apiCall("buy_product", {
        product_id: prod.id,
        qty: qty,
      });

      if (!res.ok) {
        panelStatusEl.className = "status-bar status-error";
        if (res.error === "not_enough_credits") {
          panelStatusEl.textContent = `Nu ai suficiente credite (ai ${res.have}, ai nevoie de ${res.need}).`;
        } else if (res.error === "qty_out_of_range") {
          panelStatusEl.textContent = `Cantitate invalidă. Min ${res.min_qty}, max ${res.max_qty}.`;
        } else {
          panelStatusEl.textContent =
            "Eroare la cumpărare: " + (res.error || "necunoscută");
        }
        return;
      }

      CURRENT_USER.credits = res.new_balance;
      creditsValueEl.textContent = CURRENT_USER.credits;

      const newTicket = res.ticket;
      CURRENT_TICKETS.push(newTicket);
      renderTicketsList();
      selectTicket(newTicket.id);
      renderTicketsInfo();

      panelStatusEl.className = "status-bar status-ok";
      panelStatusEl.textContent = `Comandă trimisă, tichet #${newTicket.id} creat.`;

      const ticketsTabBtn = document.querySelector(
        '.tab-btn[data-tab="ticketsTab"]'
      );
      if (ticketsTabBtn) ticketsTabBtn.click();

      bumpUserActive();
      userTicketsPoller.bumpFast();
    } catch (err) {
      console.error("buy_product error:", err);
      panelStatusEl.className = "status-bar status-error";
      panelStatusEl.textContent = "Eroare la comunicarea cu serverul.";
    }
  }

  panelCloseBtn?.addEventListener("click", closeProductPanel);
  panelBuyBtn?.addEventListener("click", buySelectedProduct);

  /* ---------- CHAT (user) ---------- */

  function renderTicketsInfo() {
    if (!CURRENT_TICKETS || CURRENT_TICKETS.length === 0) {
      ticketsInfoEl.textContent =
        "Nu ai tichete încă. Când cumperi un produs se creează automat un tichet.";
    } else {
      const openCount = CURRENT_TICKETS.filter((t) => t.status === "open")
        .length;
      ticketsInfoEl.innerHTML = `Ai <b>${CURRENT_TICKETS.length}</b> tichete, dintre care <b>${openCount}</b> deschise.`;
    }
  }

  function getTicketLastMessage(t) {
    const msgs = t.messages || [];
    if (msgs.length === 0) return "";
    const last = msgs[msgs.length - 1];
    if (last.deleted) return "[mesaj șters]";
    return last.text || "";
  }

  function renderTicketsList() {
    chatListEl.innerHTML = "";
    if (!CURRENT_TICKETS || CURRENT_TICKETS.length === 0) {
      chatListEl.innerHTML =
        '<div style="padding:8px;font-size:12px;color:var(--muted);">Nu ai tichete încă.</div>';
      return;
    }

    CURRENT_TICKETS.sort((a, b) => {
      if (a.status !== b.status) {
        return a.status === "open" ? -1 : 1;
      }
      return (b.id || 0) - (a.id || 0);
    });

    CURRENT_TICKETS.forEach((t) => {
      const item = document.createElement("div");
      item.className = "chat-item";
      if (t.id === SELECTED_TICKET_ID) item.classList.add("active");

      const title = document.createElement("div");
      title.className = "chat-item-title";
      title.textContent = t.product_name || "Produs";

      const statusText = t.status === "open" ? "DESCHIS" : "ÎNCHIS";
      const lastMsg = getTicketLastMessage(t);

      const line = document.createElement("div");
      line.className = "chat-item-line";
      line.textContent = `[${statusText}] ${lastMsg}`;

      item.appendChild(title);
      item.appendChild(line);

      item.addEventListener("click", () => {
        selectTicket(t.id);
        bumpUserActive();
        userTicketsPoller.bumpFast();
      });

      chatListEl.appendChild(item);
    });
  }

  function renderChatMessages(ticket, options = {}) {
    const container = chatMessagesEl;
    const scrollMode = options.scrollMode || "auto"; // auto / force / none
    const wasNearBottom = isNearBottom(container);

    const msgs = ticket.messages || [];
    container.innerHTML = "";

    msgs.forEach((m) => {
      const row = document.createElement("div");
      row.className = "msg-row " + (m.from || "system");

      const bubble = document.createElement("div");
      bubble.className = "msg-bubble " + (m.from || "system");

      const textNode = document.createElement("div");
      textNode.className = "msg-text";
      if (m.deleted) {
        textNode.classList.add("msg-text--deleted");
        textNode.textContent = "[mesaj șters]";
      } else {
        textNode.textContent = m.text || "";
      }
      bubble.appendChild(textNode);

      const meta = document.createElement("div");
      meta.className = "msg-meta";
      const parts = [];
      if (m.sender) parts.push(m.sender);
      if (m.edited) parts.push("editat");
      meta.textContent = parts.join(" · ");
      bubble.appendChild(meta);

      row.appendChild(bubble);
      container.appendChild(row);
    });

    if (scrollMode === "force" || (scrollMode === "auto" && wasNearBottom)) {
      scrollToBottom(container);
    }
  }

  function selectTicket(ticketId) {
    SELECTED_TICKET_ID = ticketId;
    renderTicketsList();

    const t = CURRENT_TICKETS.find((x) => x.id === ticketId);
    if (!t) {
      chatHeaderEl.innerHTML = "<span>Niciun tichet selectat</span>";
      chatMessagesEl.innerHTML = "";
      return;
    }

    chatHeaderEl.innerHTML = `
      <b>Tichet #${t.id}</b><br/>
      <span>${t.product_name} · ${t.qty} buc · total ${t.total_price} credite · status: ${t.status}</span>
    `;

    renderChatMessages(t, { scrollMode: "force" });
  }

  async function sendChatMessage() {
    const text = chatInputEl.value.trim();
    if (!text || !SELECTED_TICKET_ID) return;

    chatInputEl.value = "";

    try {
      const res = await apiCall("user_send_message", {
        ticket_id: SELECTED_TICKET_ID,
        text,
      });

      if (!res.ok) {
        console.error("user_send_message error:", res);
        return;
      }

      const updated = res.ticket;
      const idx = CURRENT_TICKETS.findIndex((t) => t.id === updated.id);
      if (idx >= 0) {
        CURRENT_TICKETS[idx] = updated;
      } else {
        CURRENT_TICKETS.push(updated);
      }

      renderTicketsList();
      selectTicket(updated.id);
      renderTicketsInfo();

      bumpUserActive();
      userTicketsPoller.bumpFast();
    } catch (err) {
      console.error("user_send_message error:", err);
    }
  }

  chatSendBtn?.addEventListener("click", sendChatMessage);
  chatInputEl?.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendChatMessage();
    }
  });

  async function pollTicketsUserCore() {
    if (!CURRENT_USER) return CURRENT_TICKETS;
    try {
      const res = await apiCall("user_get_tickets", {});
      if (!res.ok) return CURRENT_TICKETS;

      const newTickets = res.tickets || [];
      const snapStr = JSON.stringify(newTickets);

      if (snapStr === lastUserTicketsHash) {
        return CURRENT_TICKETS;
      }
      lastUserTicketsHash = snapStr;

      CURRENT_TICKETS = newTickets;
      renderTicketsList();
      renderTicketsInfo();

      if (SELECTED_TICKET_ID) {
        const t = CURRENT_TICKETS.find((x) => x.id === SELECTED_TICKET_ID);
        if (t) {
          renderChatMessages(t, { scrollMode: "auto" });
        }
      }
      return CURRENT_TICKETS;
    } catch (err) {
      console.error("user_get_tickets error:", err);
      return CURRENT_TICKETS;
    }
  }

  const userTicketsPoller = createSmartPoll(
    pollTicketsUserCore,
    () => {
      if (!isTicketsTabActive()) return false;
      if (!CURRENT_TICKETS || CURRENT_TICKETS.length === 0) return false;

      const now = Date.now();
      if (now > userActiveUntil) return false;

      const hasOpen = CURRENT_TICKETS.some((t) => t.status === "open");
      const hasSelected = !!SELECTED_TICKET_ID;
      return hasOpen || hasSelected;
    },
    {
      minInterval: 3000,
      maxInterval: 8000,
      backoffStep: 2000,
      idleThreshold: 4,
    }
  );

  window.onUserTabChange = (tabId) => {
    if (tabId === "ticketsTab") {
      bumpUserActive();
      userTicketsPoller.start();
    } else {
      userTicketsPoller.stop();
    }
  };

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      if (isTicketsTabActive()) {
        bumpUserActive();
        userTicketsPoller.start();
      }
    } else {
      userTicketsPoller.stop();
    }
  });

  async function initApp() {
    if (!tg) {
      userLineEl.textContent =
        "Nu ești în Telegram MiniApp. Deschide link-ul prin bot.";
      return;
    }

    tg.ready();
    tg.expand();

    const user = tg.initDataUnsafe?.user;
    if (!user) {
      userLineEl.textContent =
        "Telegram nu a trimis datele userului. Deschide MiniApp-ul din butonul inline al botului.";
      return;
    }

    CURRENT_USER = {
      id: user.id,
      username: user.username || null,
      first_name: user.first_name || null,
      last_name: user.last_name || null,
      credits: 0,
    };

    try {
      const res = await apiCall("init", {});
      if (!res.ok) {
        userLineEl.textContent =
          "Eroare la inițializare (server nu a răspuns ok).";
        return;
      }

      CURRENT_USER.credits = res.user.credits;
      CURRENT_USER.username = res.user.username;

      CURRENT_SHOP = res.shop;
      CURRENT_TICKETS = res.tickets || [];

      renderUserHeader();
      renderShop(CURRENT_SHOP);
      renderTicketsList();
      renderTicketsInfo();

      if (isTicketsTabActive()) {
        bumpUserActive();
        userTicketsPoller.start();
      }
    } catch (err) {
      console.error("init error:", err);
      userLineEl.textContent = "Eroare la inițializare (network).";
    }
  }

  initApp();
}

/* ============================
   ADMIN MINIAPP (admin.html)
   ============================ */

function initAdminApp() {
  const params = new URLSearchParams(window.location.search);
  const ADMIN_TOKEN = params.get("token") || "";

  const userLineEl = document.getElementById("userLine");

  const ticketsListEl = document.getElementById("ticketsList");
  const chatHeaderEl = document.getElementById("chatHeader");
  const chatMessagesEl = document.getElementById("chatMessages");
  const chatInputEl = document.getElementById("chatInput");
  const chatSendBtn = document.getElementById("chatSendBtn");

  const ticketDetailsEl = document.getElementById("ticketDetails");
  const ticketSummaryEl = document.getElementById("ticketSummary");
  const ticketNoteInlineEl = document.getElementById("ticketNoteInline");
  const ticketStatusBarEl = document.getElementById("ticketStatusBar");
  const ticketCloseBtn = document.getElementById("ticketCloseBtn");
  const ticketCloseWithReasonBtn = document.getElementById(
    "ticketCloseWithReasonBtn"
  );

  const shopContainerEl = document.getElementById("shopContainer");
  const shopStatusBarEl = document.getElementById("shopStatusBar");
  const addCategoryBtn = document.getElementById("addCategoryBtn");
  const saveShopBtn = document.getElementById("saveShopBtn");
  const shopMetricsEl = document.getElementById("shopMetrics");

  const reasonModalEl = document.getElementById("reasonModal");
  const reasonInputEl = document.getElementById("reasonInput");
  const reasonCancelBtn = document.getElementById("reasonCancelBtn");
  const reasonConfirmBtn = document.getElementById("reasonConfirmBtn");

  const filterStatusEl = document.getElementById("filterStatus");
  const filterSearchEl = document.getElementById("filterSearch");
  const statTotalEl = document.getElementById("statTotal");
  const statOpenEl = document.getElementById("statOpen");
  const statClosedEl = document.getElementById("statClosed");

  let ALL_TICKETS = [];
  let CURRENT_SHOP = null;
  let SELECTED_TICKET_ID = null;

  // pentru reply / edit
  let ACTIVE_REPLY = null; // { ticketId, msgId, sender, text }
  let ACTIVE_EDIT = null; // { ticketId, msgId }

  // când editezi shop, nu mai suprascriem UI din polling
  let SHOP_EDIT_MODE = false;

  let adminActiveUntil = 0;
  let lastAdminSnapshotJSON = null;

  function bumpAdminActive(extraMs = 30000) {
    const now = Date.now();
    adminActiveUntil = Math.max(adminActiveUntil, now + extraMs);
  }

  function apiCall(action, extraPayload = {}) {
    const payload = {
      action,
      token: ADMIN_TOKEN,
      ...extraPayload,
    };
    return fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }).then((r) => r.json());
  }

  function renderTokenInfo() {
    if (!ADMIN_TOKEN) {
      userLineEl.innerHTML =
        "<span style='color:#ff5252;'>Token lipsă în URL.</span> Deschide admin.html?token=TOKENUL_TĂU.";
    } else {
      const short = ADMIN_TOKEN.slice(0, 4) + "..." + ADMIN_TOKEN.slice(-4);
      userLineEl.innerHTML = "Acces cu token: <b>" + short + "</b>";
    }
  }

  function isAnyAdminTabActive() {
    const chatTab = document.getElementById("chatTab");
    const shopTab = document.getElementById("shopTab");
    return (
      (chatTab && chatTab.classList.contains("active")) ||
      (shopTab && shopTab.classList.contains("active"))
    );
  }

  /* ---------- Input mode (normal / reply / edit) ---------- */

  function refreshInputMode() {
    if (!chatInputEl || !chatSendBtn) return;

    if (ACTIVE_EDIT) {
      chatSendBtn.textContent = "Salvează";
      chatInputEl.placeholder = "Editezi un mesaj trimis de tine...";
    } else if (ACTIVE_REPLY) {
      chatSendBtn.textContent = "Răspunde";
      chatInputEl.placeholder =
        "Răspunzi lui " + (ACTIVE_REPLY.sender || "user") + "...";
    } else {
      chatSendBtn.textContent = "Trimite";
      chatInputEl.placeholder = "Răspunde utilizatorului...";
    }
  }

  function clearInputMode() {
    ACTIVE_EDIT = null;
    ACTIVE_REPLY = null;
    refreshInputMode();
  }

  chatInputEl?.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      clearInputMode();
      chatInputEl.value = "";
    }
  });

  /* ---------- STATISTICI & FILTRE ---------- */

  function updateTicketStats() {
    const total = ALL_TICKETS.length;
    const open = ALL_TICKETS.filter((t) => t.status === "open").length;
    const closed = ALL_TICKETS.filter((t) => t.status === "closed").length;

    if (statTotalEl) statTotalEl.textContent = total;
    if (statOpenEl) statOpenEl.textContent = open;
    if (statClosedEl) statClosedEl.textContent = closed;
  }

  function getFilteredTickets() {
    let list = ALL_TICKETS.slice();
    const statusFilter = filterStatusEl?.value || "all";
    const query = (filterSearchEl?.value || "").toLowerCase().trim();

    if (statusFilter !== "all") {
      list = list.filter((t) => (t.status || "") === statusFilter);
    }

    if (query) {
      list = list.filter((t) => {
        const user = (t.username || t.user_id || "").toString().toLowerCase();
        const product = (t.product_name || "").toLowerCase();
        const idStr = ("#" + t.id).toLowerCase();
        return (
          user.includes(query) ||
          product.includes(query) ||
          idStr.includes(query)
        );
      });
    }

    return list;
  }

  /* ---------- CHAT ADMIN ---------- */

  function getTicketLastMessage(t) {
    const msgs = t.messages || [];
    if (msgs.length === 0) return "";
    const last = msgs[msgs.length - 1];
    if (last.deleted) return "[mesaj șters]";
    return last.text || "";
  }

  function renderTicketsList() {
    ticketsListEl.innerHTML = "";
    const list = getFilteredTickets();

    if (!list || list.length === 0) {
      ticketsListEl.innerHTML =
        '<div style="padding:8px;font-size:12px;color:var(--muted);">Nu există tichete pentru filtrele curente.</div>';
      if (!SELECTED_TICKET_ID) {
        ticketDetailsEl.style.display = "none";
        chatHeaderEl.innerHTML = "<span>Niciun tichet selectat</span>";
        chatMessagesEl.innerHTML = "";
      }
      return;
    }

    list.sort((a, b) => {
      if (a.status !== b.status) {
        return a.status === "open" ? -1 : 1;
      }
      return (b.id || 0) - (a.id || 0);
    });

    list.forEach((t) => {
      const item = document.createElement("div");
      item.className = "chat-item";
      if (t.id === SELECTED_TICKET_ID) item.classList.add("active");

      const headerRow = document.createElement("div");
      headerRow.className = "chat-item-header-row";

      const title = document.createElement("div");
      title.className = "chat-item-title";
      title.textContent =
        (t.username || t.user_id) + " · " + (t.product_name || "");

      const statusChip = document.createElement("span");
      statusChip.className =
        "ticket-status-pill " + (t.status === "open" ? "open" : "closed");
      statusChip.textContent = t.status === "open" ? "DESCHIS" : "ÎNCHIS";

      headerRow.appendChild(title);
      headerRow.appendChild(statusChip);

      const lastMsg = getTicketLastMessage(t);
      const line = document.createElement("div");
      line.className = "chat-item-line";
      line.textContent = lastMsg ? lastMsg : "Fără mesaje încă.";

      item.appendChild(headerRow);
      item.appendChild(line);

      item.addEventListener("click", () => {
        if (SELECTED_TICKET_ID !== t.id) {
          clearInputMode();
          chatInputEl.value = "";
        }
        selectTicket(t.id);
        bumpAdminActive();
        adminPoller.bumpFast();
      });

      ticketsListEl.appendChild(item);
    });
  }

  function scrollToMessageById(msgId) {
    if (!msgId || !chatMessagesEl) return;
    let selectorId = msgId;
    if (window.CSS && CSS.escape) {
      selectorId = CSS.escape(msgId);
    } else {
      selectorId = msgId.replace(/"/g, '\\"');
    }
    const target = chatMessagesEl.querySelector(
      `.msg-row[data-msg-id="${selectorId}"]`
    );
    if (!target) return;

    const top = target.offsetTop - 20;
    chatMessagesEl.scrollTo({
      top,
      behavior: "smooth",
    });

    target.classList.add("msg-row--highlight");
    setTimeout(() => {
      target.classList.remove("msg-row--highlight");
    }, 1600);
  }

  function renderChatMessages(ticket, options = {}) {
    const container = chatMessagesEl;
    const scrollMode = options.scrollMode || "auto"; // auto / force / none
    const wasNearBottom = isNearBottom(container);

    const msgs = ticket.messages || [];
    container.innerHTML = "";

    msgs.forEach((m) => {
      const row = document.createElement("div");
      row.className = "msg-row " + (m.from || "system");
      if (m.id) row.dataset.msgId = m.id;

      const bubble = document.createElement("div");
      bubble.className = "msg-bubble " + (m.from || "system");

      // reply preview
      if (m.reply_to) {
        const replied = msgs.find((mm) => mm.id === m.reply_to);
        if (replied) {
          const rp = document.createElement("button");
          rp.type = "button";
          rp.className = "msg-reply-preview";
          const textPreview = (replied.text || "").slice(0, 80);
          const more = replied.text && replied.text.length > 80 ? "…" : "";
          rp.innerHTML =
            "<strong>" +
            (replied.sender || "user") +
            ":</strong> " +
            (textPreview || "") +
            more;
          rp.addEventListener("click", () => {
            scrollToMessageById(m.reply_to);
          });
          bubble.appendChild(rp);
        }
      }

      const textSpan = document.createElement("div");
      textSpan.className = "msg-text";
      if (m.deleted) {
        textSpan.classList.add("msg-text--deleted");
        textSpan.textContent = "[mesaj șters]";
      } else {
        textSpan.textContent = m.text || "";
      }
      bubble.appendChild(textSpan);

      const meta = document.createElement("div");
      meta.className = "msg-meta";
      const metaParts = [];
      if (m.sender) metaParts.push(m.sender);
      if (m.edited) metaParts.push("editat");
      meta.textContent = metaParts.join(" · ");
      bubble.appendChild(meta);

      // acțiuni (reply / edit / delete)
      const actions = document.createElement("div");
      actions.className = "msg-actions";

      const replyBtn = document.createElement("button");
      replyBtn.className = "msg-action-btn";
      replyBtn.title = "Răspunde";
      replyBtn.textContent = "↩";
      replyBtn.addEventListener("click", () => {
        ACTIVE_REPLY = {
          ticketId: ticket.id,
          msgId: m.id,
          sender: m.sender,
          text: m.text || "",
        };
        ACTIVE_EDIT = null;
        refreshInputMode();
        chatInputEl.focus();
      });
      actions.appendChild(replyBtn);

      const canEdit = m.from === "admin" && !m.deleted && m.id;
      const editBtn = document.createElement("button");
      editBtn.className = "msg-action-btn";
      editBtn.title = "Editează";
      editBtn.textContent = "✎";
      editBtn.disabled = !canEdit;
      editBtn.addEventListener("click", () => {
        if (!canEdit) return;
        ACTIVE_EDIT = { ticketId: ticket.id, msgId: m.id };
        ACTIVE_REPLY = null;
        chatInputEl.value = m.text || "";
        refreshInputMode();
        chatInputEl.focus();
      });
      actions.appendChild(editBtn);

      const canDelete = !!m.id && !m.deleted;
      const deleteBtn = document.createElement("button");
      deleteBtn.className = "msg-action-btn msg-action-btn--danger";
      deleteBtn.title = "Șterge";
      deleteBtn.textContent = "🗑";
      deleteBtn.disabled = !canDelete;
      deleteBtn.addEventListener("click", () => {
        if (!canDelete) return;
        if (!confirm("Sigur ștergi acest mesaj?")) return;
        deleteAdminMessage(ticket.id, m.id);
      });
      actions.appendChild(deleteBtn);

      bubble.appendChild(actions);
      row.appendChild(bubble);
      container.appendChild(row);
    });

    if (scrollMode === "force" || (scrollMode === "auto" && wasNearBottom)) {
      scrollToBottom(container);
    }
  }

  function selectTicket(ticketId) {
    SELECTED_TICKET_ID = ticketId;
    renderTicketsList();

    const t = ALL_TICKETS.find((x) => x.id === ticketId);
    if (!t) {
      ticketDetailsEl.style.display = "none";
      chatHeaderEl.innerHTML = "<span>Niciun tichet selectat</span>";
      chatMessagesEl.innerHTML = "";
      return;
    }

    const statusClass = t.status === "open" ? "open" : "closed";
    const statusLabel = t.status === "open" ? "DESCHIS" : "ÎNCHIS";

    chatHeaderEl.innerHTML = `
      <b>Tichet #${t.id}</b><br/>
      <span>User: ${t.username || t.user_id} · Produs: ${
      t.product_name
    } · ${t.qty} buc · total ${t.total_price} credite</span>
      <div class="chat-header-status">
        <span class="ticket-status-pill ${statusClass}">${statusLabel}</span>
      </div>
    `;

    renderChatMessages(t, { scrollMode: "force" });

    ticketDetailsEl.style.display = "block";
    ticketSummaryEl.innerHTML = `
      <b>Tichet #${t.id}</b><br/>
      User: <b>${t.username || t.user_id}</b><br/>
      Produs: <b>${t.product_name}</b> (${t.qty} buc, total ${
      t.total_price
    } credite)
    `;

    if (t.note) {
      ticketNoteInlineEl.innerHTML =
        '<span class="ticket-note-label">Notă internă:</span> ' +
        `<span class="ticket-note-text">${t.note}</span>`;
    } else {
      ticketNoteInlineEl.innerHTML =
        '<span class="ticket-note-label">Notă internă:</span> ' +
        '<span class="ticket-note-text ticket-note-empty">nu există (încă)</span>';
    }

    ticketStatusBarEl.textContent = "";
    ticketStatusBarEl.className = "status-bar";
  }

  async function deleteAdminMessage(ticketId, messageId) {
    try {
      const res = await apiCall("admin_delete_message", {
        ticket_id: ticketId,
        message_id: messageId,
      });
      if (!res.ok) {
        console.error("admin_delete_message error:", res);
        return;
      }

      const updated = res.ticket;
      const idx = ALL_TICKETS.findIndex((t) => t.id === updated.id);
      if (idx >= 0) {
        ALL_TICKETS[idx] = updated;
      } else {
        ALL_TICKETS.push(updated);
      }

      updateTicketStats();
      renderTicketsList();
      if (SELECTED_TICKET_ID === updated.id) {
        renderChatMessages(updated, { scrollMode: "auto" });
      }
    } catch (err) {
      console.error("admin_delete_message error:", err);
    }
  }

  async function sendAdminMessage() {
    const text = chatInputEl.value.trim();
    if (!text || !SELECTED_TICKET_ID) return;

    const currentTicketId = SELECTED_TICKET_ID;
    const editingThisTicket =
      ACTIVE_EDIT && ACTIVE_EDIT.ticketId === currentTicketId;

    chatInputEl.value = "";

    try {
      let res;
      if (editingThisTicket) {
        res = await apiCall("admin_edit_message", {
          ticket_id: ACTIVE_EDIT.ticketId,
          message_id: ACTIVE_EDIT.msgId,
          text,
        });
      } else {
        const payload = {
          ticket_id: currentTicketId,
          text,
          sender: "Admin",
        };
        if (
          ACTIVE_REPLY &&
          ACTIVE_REPLY.ticketId === currentTicketId &&
          ACTIVE_REPLY.msgId
        ) {
          payload.reply_to = ACTIVE_REPLY.msgId;
        }
        res = await apiCall("admin_send_message", payload);
      }

      if (!res.ok) {
        console.error("admin_send_message/admin_edit_message error:", res);
        return;
      }

      const updated = res.ticket;
      const idx = ALL_TICKETS.findIndex((t) => t.id === updated.id);
      if (idx >= 0) {
        ALL_TICKETS[idx] = updated;
      } else {
        ALL_TICKETS.push(updated);
      }

      updateTicketStats();
      renderTicketsList();
      SELECTED_TICKET_ID = updated.id;
      renderChatMessages(updated, { scrollMode: "force" });

      clearInputMode();
      bumpAdminActive();
      adminPoller.bumpFast();
    } catch (err) {
      console.error("admin_send_message/admin_edit_message error:", err);
    }
  }

  chatSendBtn?.addEventListener("click", sendAdminMessage);
  chatInputEl?.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendAdminMessage();
    }
  });

  /* ---------- Închidere tichet ---------- */

  async function closeTicket(noteText) {
    if (!SELECTED_TICKET_ID) return;
    const t = ALL_TICKETS.find((x) => x.id === SELECTED_TICKET_ID);
    if (!t) return;

    ticketStatusBarEl.textContent = "Se închide tichetul...";
    ticketStatusBarEl.className = "status-bar";

    try {
      const res = await apiCall("admin_update_ticket", {
        ticket_id: t.id,
        status: "closed",
        note: noteText || "",
      });

      if (!res.ok) {
        ticketStatusBarEl.textContent =
          "Eroare la închidere: " + (res.error || "necunoscută");
        ticketStatusBarEl.className = "status-bar status-error";
        return;
      }

      t.status = "closed";
      t.note = noteText || "";

      ticketStatusBarEl.textContent = "Tichet închis.";
      ticketStatusBarEl.className = "status-bar status-ok";

      updateTicketStats();
      renderTicketsList();
      renderChatMessages(t, { scrollMode: "auto" });

      bumpAdminActive();
      adminPoller.bumpFast();
    } catch (err) {
      console.error("admin_update_ticket error:", err);
      ticketStatusBarEl.textContent = "Eroare la comunicarea cu serverul.";
      ticketStatusBarEl.className = "status-bar status-error";
    }
  }

  ticketCloseBtn?.addEventListener("click", () => {
    if (!SELECTED_TICKET_ID) return;
    if (confirm("Sigur vrei să închizi tichetul fără motiv?")) {
      closeTicket("");
    }
  });

  ticketCloseWithReasonBtn?.addEventListener("click", () => {
    if (!SELECTED_TICKET_ID) return;
    reasonInputEl.value = "";
    reasonModalEl.style.display = "flex";
    reasonInputEl.focus();
  });

  reasonCancelBtn?.addEventListener("click", () => {
    reasonModalEl.style.display = "none";
  });

  reasonConfirmBtn?.addEventListener("click", () => {
    const text = reasonInputEl.value.trim();
    reasonModalEl.style.display = "none";
    closeTicket(text);
  });

  /* ---------- SHOP EDITOR ADMIN ---------- */

  function markShopDirty() {
    SHOP_EDIT_MODE = true;
    if (shopStatusBarEl) {
      shopStatusBarEl.textContent = "Ai modificări nesalvate în shop.";
      shopStatusBarEl.className = "status-bar";
    }
  }

  function updateShopMetrics() {
    if (!shopMetricsEl) return;
    if (!CURRENT_SHOP || !CURRENT_SHOP.categories) {
      shopMetricsEl.innerHTML =
        '<div class="stat-pill stat-pill--soft"><span class="stat-label">Categorii</span><span class="stat-value">0</span></div>' +
        '<div class="stat-pill stat-pill--soft"><span class="stat-label">Produse</span><span class="stat-value">0</span></div>';
      return;
    }

    const catCount = CURRENT_SHOP.categories.length;
    let prodCount = 0;
    CURRENT_SHOP.categories.forEach((c) => {
      prodCount += (c.products || []).length;
    });

    shopMetricsEl.innerHTML = `
      <div class="stat-pill stat-pill--soft">
        <span class="stat-label">Categorii</span>
        <span class="stat-value">${catCount}</span>
      </div>
      <div class="stat-pill stat-pill--soft">
        <span class="stat-label">Produse</span>
        <span class="stat-value">${prodCount}</span>
      </div>
    `;
  }

  function renderShopEditor() {
    shopContainerEl.innerHTML = "";
    if (!CURRENT_SHOP || !CURRENT_SHOP.categories) {
      shopContainerEl.innerHTML =
        '<div style="font-size:12px;color:var(--muted);">Nu există categorii. Adaugă una nouă.</div>';
      updateShopMetrics();
      return;
    }

    CURRENT_SHOP.categories.forEach((cat, catIndex) => {
      const catDiv = document.createElement("div");
      catDiv.className = "cat-card";

      const header = document.createElement("div");
      header.className = "cat-header";

      const left = document.createElement("div");
      left.className = "cat-header-left";

      const toggleBtn = document.createElement("button");
      toggleBtn.className = "btn-ghost cat-toggle";
      toggleBtn.textContent = cat._collapsed ? "▸" : "▾";
      toggleBtn.onclick = () => {
        cat._collapsed = !cat._collapsed;
        renderShopEditor();
      };

      const nameInput = document.createElement("input");
      nameInput.placeholder = "Nume categorie";
      nameInput.value = cat.name || "";
      nameInput.addEventListener("input", () => {
        cat.name = nameInput.value;
        markShopDirty();
      });

      left.appendChild(toggleBtn);
      left.appendChild(nameInput);

      const right = document.createElement("div");
      right.className = "cat-header-right";

      const countBadge = document.createElement("div");
      countBadge.className = "ticket-status-pill open";
      countBadge.textContent = `${(cat.products || []).length} produse`;

      const deleteBtn = document.createElement("button");
      deleteBtn.className = "btn-ghost";
      deleteBtn.textContent = "Șterge";
      deleteBtn.style.fontSize = "11px";
      deleteBtn.onclick = () => {
        if (confirm("Ștergi categoria?")) {
          CURRENT_SHOP.categories.splice(catIndex, 1);
          markShopDirty();
          renderShopEditor();
        }
      };

      right.appendChild(countBadge);
      right.appendChild(deleteBtn);

      header.appendChild(left);
      header.appendChild(right);

      catDiv.appendChild(header);

      if (!cat._collapsed) {
        const descDiv = document.createElement("div");
        descDiv.className = "cat-desc";
        const descArea = document.createElement("textarea");
        descArea.placeholder = "Descriere categorie";
        descArea.value = cat.description || "";
        descArea.addEventListener("input", () => {
          cat.description = descArea.value;
          markShopDirty();
        });
        descDiv.appendChild(descArea);

        const productsWrap = document.createElement("div");
        productsWrap.className = "products-list";

        (cat.products = cat.products || []).forEach((prod, prodIndex) => {
          const row = document.createElement("div");
          row.className = "product-row";

          const colName = document.createElement("div");
          const nameInputProd = document.createElement("input");
          nameInputProd.placeholder = "Nume produs";
          nameInputProd.value = prod.name || "";
          nameInputProd.addEventListener("input", () => {
            prod.name = nameInputProd.value;
            markShopDirty();
          });
          const nameLabel = document.createElement("div");
          nameLabel.className = "small-input-label";
          nameLabel.textContent = "Nume";
          colName.appendChild(nameInputProd);
          colName.appendChild(nameLabel);

          const colPrice = document.createElement("div");
          const priceInput = document.createElement("input");
          priceInput.type = "number";
          priceInput.placeholder = "Preț";
          priceInput.value = prod.price || 0;
          priceInput.addEventListener("input", () => {
            prod.price = Number(priceInput.value || 0);
            markShopDirty();
          });
          const priceLabel = document.createElement("div");
          priceLabel.className = "small-input-label";
          priceLabel.textContent = "Preț";
          colPrice.appendChild(priceInput);
          colPrice.appendChild(priceLabel);

          const colMin = document.createElement("div");
          const minInput = document.createElement("input");
          minInput.type = "number";
          minInput.placeholder = "Min";
          minInput.value = prod.min_qty || 1;
          minInput.addEventListener("input", () => {
            prod.min_qty = Number(minInput.value || 1);
            markShopDirty();
          });
          const minLabel = document.createElement("div");
          minLabel.className = "small-input-label";
          minLabel.textContent = "Min";
          colMin.appendChild(minInput);
          colMin.appendChild(minLabel);

          const colMax = document.createElement("div");
          const maxInput = document.createElement("input");
          maxInput.type = "number";
          maxInput.placeholder = "Max";
          maxInput.value = prod.max_qty || prod.min_qty || 1;
          maxInput.addEventListener("input", () => {
            prod.max_qty = Number(maxInput.value || prod.min_qty || 1);
            markShopDirty();
          });
          const maxLabel = document.createElement("div");
          maxLabel.className = "small-input-label";
          maxLabel.textContent = "Max";
          colMax.appendChild(maxInput);
          colMax.appendChild(maxLabel);

          const colActions = document.createElement("div");
          colActions.className = "product-mini-actions";
          const delProdBtn = document.createElement("button");
          delProdBtn.className = "btn-ghost";
          delProdBtn.style.fontSize = "10px";
          delProdBtn.textContent = "X";
          delProdBtn.onclick = () => {
            if (confirm("Ștergi produsul?")) {
              cat.products.splice(prodIndex, 1);
              markShopDirty();
              renderShopEditor();
            }
          };
          colActions.appendChild(delProdBtn);

          row.appendChild(colName);
          row.appendChild(colPrice);
          row.appendChild(colMin);
          row.appendChild(colMax);
          row.appendChild(colActions);

          productsWrap.appendChild(row);

          const descRow = document.createElement("div");
          descRow.style.gridColumn = "1 / -1";
          descRow.style.marginBottom = "4px";
          const descInput = document.createElement("input");
          descInput.placeholder = "Descriere produs";
          descInput.value = prod.description || "";
          descInput.addEventListener("input", () => {
            prod.description = descInput.value;
            markShopDirty();
          });
          descRow.appendChild(descInput);

          const extraInfo = document.createElement("div");
          extraInfo.className = "small-input-label";
          extraInfo.textContent = "ID: " + (prod.id || "(auto)");

          descRow.appendChild(extraInfo);
          productsWrap.appendChild(descRow);
        });

        const addProdBtn = document.createElement("button");
        addProdBtn.className = "btn-ghost";
        addProdBtn.style.fontSize = "11px";
        addProdBtn.textContent = "+ Produs";
        addProdBtn.onclick = () => {
          cat.products.push({
            id: "prod_" + Date.now(),
            name: "Produs nou",
            price: 0,
            description: "",
            min_qty: 1,
            max_qty: 1,
          });
          markShopDirty();
          renderShopEditor();
        };

        productsWrap.appendChild(addProdBtn);

        catDiv.appendChild(descDiv);
        catDiv.appendChild(productsWrap);
      }

      shopContainerEl.appendChild(catDiv);
    });

    updateShopMetrics();
  }

  async function saveShop() {
    if (!CURRENT_SHOP) return;
    shopStatusBarEl.textContent = "Se salvează shop-ul...";
    shopStatusBarEl.className = "status-bar";

    try {
      const res = await apiCall("admin_save_shop", { shop: CURRENT_SHOP });
      if (!res.ok) {
        shopStatusBarEl.textContent =
          "Eroare la salvare: " + (res.error || "necunoscută");
        shopStatusBarEl.className = "status-bar status-error";
        return;
      }
      shopStatusBarEl.textContent = "Shop salvat.";
      shopStatusBarEl.className = "status-bar status-ok";

      SHOP_EDIT_MODE = false;
      bumpAdminActive();
      adminPoller.bumpFast();
    } catch (err) {
      console.error("admin_save_shop error:", err);
      shopStatusBarEl.textContent = "Eroare la comunicarea cu serverul.";
      shopStatusBarEl.className = "status-bar status-error";
    }
  }

  function addCategory() {
    if (!CURRENT_SHOP) CURRENT_SHOP = { categories: [] };
    CURRENT_SHOP.categories.push({
      id: "cat_" + Date.now(),
      name: "Categorie nouă",
      description: "",
      products: [],
    });
    markShopDirty();
    renderShopEditor();
  }

  addCategoryBtn?.addEventListener("click", addCategory);
  saveShopBtn?.addEventListener("click", saveShop);

  /* ---------- CORE POLL ADMIN ---------- */

  async function pollAdminCore() {
    if (!ADMIN_TOKEN) return { tickets: ALL_TICKETS, shop: CURRENT_SHOP };

    try {
      const res = await apiCall("admin_get_tickets", {});
      if (!res.ok) {
        if (res.error === "forbidden") {
          userLineEl.innerHTML =
            "<span style='color:#ff5252;'>Token invalid.</span>";
        }
        return { tickets: ALL_TICKETS, shop: CURRENT_SHOP };
      }

      const newTickets = res.tickets || [];
      const newShop = res.shop || { categories: [] };

      const snapshot = { tickets: newTickets, shop: newShop };
      const snapshotStr = JSON.stringify(snapshot);

      const changed = snapshotStr !== lastAdminSnapshotJSON;
      lastAdminSnapshotJSON = snapshotStr;

      if (changed) {
        ALL_TICKETS = newTickets;

        if (!SHOP_EDIT_MODE) {
          CURRENT_SHOP = newShop;
        }

        updateTicketStats();
        renderTicketsList();
        if (!SHOP_EDIT_MODE) {
          renderShopEditor();
        }

        if (SELECTED_TICKET_ID) {
          const t = ALL_TICKETS.find((x) => x.id === SELECTED_TICKET_ID);
          if (t) {
            renderChatMessages(t, { scrollMode: "auto" });
          }
        }
      }

      return snapshot;
    } catch (err) {
      console.error("admin_get_tickets error:", err);
      userLineEl.innerHTML =
        "<span style='color:#ff5252;'>Eroare la rețea.</span>";
      return { tickets: ALL_TICKETS, shop: CURRENT_SHOP };
    }
  }

  /* ---------- SMART POLLER ADMIN ---------- */

  const adminPoller = createSmartPoll(
    pollAdminCore,
    () => {
      if (!ADMIN_TOKEN) return false;
      if (!isAnyAdminTabActive()) return false;

      const now = Date.now();
      if (now > adminActiveUntil) return false;

      const hasTickets = ALL_TICKETS.length > 0;
      const hasOpen = ALL_TICKETS.some((t) => t.status === "open");
      return hasTickets || hasOpen;
    },
    {
      minInterval: 2000,
      maxInterval: 8000,
      backoffStep: 2000,
      idleThreshold: 4,
    }
  );

  /* ---------- FILTRE ---------- */

  function onFilterChange() {
    renderTicketsList();
  }

  let searchTimeout = null;
  filterStatusEl?.addEventListener("change", onFilterChange);
  filterSearchEl?.addEventListener("input", () => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(onFilterChange, 150);
  });

  /* ---------- TAB CHANGE ADMIN ---------- */

  window.onAdminTabChange = () => {
    if (isAnyAdminTabActive()) {
      bumpAdminActive();
      adminPoller.start();
    } else {
      adminPoller.stop();
    }
  };

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      if (isAnyAdminTabActive()) {
        bumpAdminActive();
        adminPoller.start();
      }
    } else {
      adminPoller.stop();
    }
  });

  /* ---------- INIT ADMIN ---------- */

  async function initAdmin() {
    renderTokenInfo();
    refreshInputMode();
    if (!ADMIN_TOKEN) return;

    await pollAdminCore();
    bumpAdminActive();
    adminPoller.start();
  }

  initAdmin();
}
