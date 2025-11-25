// app.js

// URL-ul Netlify function (proxy către bot.py)
const API_URL = "https://api.redgen.vip/";

/* ============================
   HELPER – SMART POLLING
   ============================ */
/**
 * createSmartPoll:
 *  - fetchFn: async () => snapshot (or undefined). Trebuie să facă și update de UI.
 *  - isEnabledFn: () => boolean – dacă e false, nu se face request (tab închis, fereastră inactivă etc.)
 *  - options:
 *      minInterval   – ms, ex 3000
 *      maxInterval   – ms, ex 8000
 *      backoffStep   – ms, ex 2000
 *      idleThreshold – de câte ori la rând fără schimbări până creștem intervalul
 *
 *  snapshot-ul e comparat (JSON.stringify) cu cel anterior ca să vedem dacă s-a schimbat ceva.
 */
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
      // nimic de urmărit acum -> mai încercăm peste un interval „rece”
      schedule(maxInterval);
      return;
    }

    try {
      const data = await fetchFn();
      if (!active) return;

      if (data !== undefined) {
        const snap = JSON.stringify(data);
        if (lastSnapshot === null || snap !== lastSnapshot) {
          // ceva s-a schimbat => resetăm backoff
          lastSnapshot = snap;
          idleCount = 0;
          currentInterval = minInterval;
        } else {
          // nimic nou
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
      tick(); // pornim imediat
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

  // Tabs – segmented control, sincronizat cu CSS (data-active)
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
   USER MINIAPP (index.html)
   ============================ */

function initUserApp() {
  const tg = window.Telegram?.WebApp;

  let CURRENT_USER = null;
  let CURRENT_SHOP = null;
  let CURRENT_TICKETS = [];
  let SELECTED_TICKET_ID = null;

  // fereastră activă user (în ms) – doar atunci poll-uim
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

      // mergem automat pe tab-ul de tichete
      const ticketsTabBtn = document.querySelector(
        '.tab-btn[data-tab="ticketsTab"]'
      );
      if (ticketsTabBtn) ticketsTabBtn.click();

      // sesiune activă de chat încă ~25s
      bumpUserActive();

      const snap = await pollTicketsUserCore();
      userTicketsPoller.bumpFast();
      return snap;
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
    return msgs[msgs.length - 1].text || "";
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

      item.addEventListener("click", async () => {
        selectTicket(t.id);
        bumpUserActive();
        const snap = await pollTicketsUserCore();
        userTicketsPoller.bumpFast();
        return snap;
      });

      chatListEl.appendChild(item);
    });
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

    renderChatMessages(t);
  }

  function renderChatMessages(ticket) {
    const msgs = ticket.messages || [];
    chatMessagesEl.innerHTML = "";

    msgs.forEach((m) => {
      const row = document.createElement("div");
      row.className = "msg-row " + m.from;

      const bubble = document.createElement("div");
      bubble.className = "msg-bubble " + m.from;
      bubble.textContent = m.text;

      const meta = document.createElement("div");
      meta.className = "msg-meta";
      meta.textContent = m.sender || "";

      bubble.appendChild(meta);
      row.appendChild(bubble);

      chatMessagesEl.appendChild(row);
    });

    chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
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

      const snap = await pollTicketsUserCore();
      userTicketsPoller.bumpFast();
      return snap;
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

  // funcția folosită de smartPoll – face refresh și întoarce snapshot
  async function pollTicketsUserCore() {
    if (!CURRENT_USER) return CURRENT_TICKETS;
    try {
      const res = await apiCall("user_get_tickets", {});
      if (!res.ok) return CURRENT_TICKETS;
      CURRENT_TICKETS = res.tickets || [];
      renderTicketsList();
      renderTicketsInfo();

      if (SELECTED_TICKET_ID) {
        const t = CURRENT_TICKETS.find((x) => x.id === SELECTED_TICKET_ID);
        if (t) {
          selectTicket(t.id);
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
      // activ doar când:
      // - tab-ul de tichete e deschis
      // - există tichete
      // - suntem în fereastra activă (25s după ultima acțiune)
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

  // tab change (user)
  window.onUserTabChange = (tabId) => {
    if (tabId === "ticketsTab") {
      bumpUserActive();
      userTicketsPoller.start();
    } else {
      userTicketsPoller.stop();
    }
  };

  // când fereastra nu e vizibilă, oprim polling-ul
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
  const envInfoEl = document.getElementById("envInfo");
  const liveDotEl = document.getElementById("liveDot");
  const liveTextEl = document.getElementById("liveText");
  const syncLineEl = document.getElementById("syncLine");
  const themeToggleBtn = document.getElementById("themeToggle");

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

  const ticketNoteEditEl = document.getElementById("ticketNoteEdit");
  const ticketNoteTextareaEl = document.getElementById("ticketNoteTextarea");
  const ticketNoteCancelBtn = document.getElementById("ticketNoteCancelBtn");
  const ticketNoteSaveBtn = document.getElementById("ticketNoteSaveBtn");

  const shopContainerEl = document.getElementById("shopContainer");
  const shopStatusBarEl = document.getElementById("shopStatusBar");
  const addCategoryBtn = document.getElementById("addCategoryBtn");
  const saveShopBtn = document.getElementById("saveShopBtn");
  const shopMetricsEl = document.getElementById("shopMetrics");
  const collapseAllBtn = document.getElementById("collapseAllBtn");
  const expandAllBtn = document.getElementById("expandAllBtn");

  const reasonModalEl = document.getElementById("reasonModal");
  const reasonInputEl = document.getElementById("reasonInput");
  const reasonCancelBtn = document.getElementById("reasonCancelBtn");
  const reasonConfirmBtn = document.getElementById("reasonConfirmBtn");

  const filterStatusEl = document.getElementById("filterStatus");
  const filterSearchEl = document.getElementById("filterSearch");
  const filterSortEl = document.getElementById("filterSort");
  const statTotalEl = document.getElementById("statTotal");
  const statOpenEl = document.getElementById("statOpen");
  const statClosedEl = document.getElementById("statClosed");

  const quickRepliesEl = document.getElementById("quickReplies");

  let ALL_TICKETS = [];
  let CURRENT_SHOP = null;
  let SELECTED_TICKET_ID = null;
  let lastSyncAt = null;

  // fereastră activă admin (în ms)
  let adminActiveUntil = 0;
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

  function setLiveIndicator(isLive) {
    if (!liveDotEl || !liveTextEl) return;
    liveDotEl.classList.toggle("live-dot--on", isLive);
    liveDotEl.classList.toggle("live-dot--off", !isLive);
    liveTextEl.textContent = isLive ? "Live" : "Oprit";
  }

  function updateSyncLine() {
    if (!syncLineEl) return;
    if (!lastSyncAt) {
      syncLineEl.textContent = "Ultimul refresh: -";
      return;
    }
    const hh = String(lastSyncAt.getHours()).padStart(2, "0");
    const mm = String(lastSyncAt.getMinutes()).padStart(2, "0");
    const ss = String(lastSyncAt.getSeconds()).padStart(2, "0");
    syncLineEl.textContent = `Ultimul refresh: ${hh}:${mm}:${ss}`;
  }

  function applyAdminThemeFromStorage() {
    if (!themeToggleBtn) return;
    let stored = null;
    try {
      stored = window.localStorage?.getItem("admin_theme") || null;
    } catch {
      stored = null;
    }
    const isLight = stored === "light";
    document.body.classList.toggle("theme-light", isLight);
    themeToggleBtn.textContent = isLight ? "🌙" : "☀️";
    themeToggleBtn.setAttribute(
      "aria-label",
      isLight ? "Comută pe tema închisă" : "Comută pe tema deschisă"
    );
  }

  function toggleAdminTheme() {
    const willBeLight = !document.body.classList.contains("theme-light");
    document.body.classList.toggle("theme-light", willBeLight);
    try {
      window.localStorage?.setItem("admin_theme", willBeLight ? "light" : "dark");
    } catch {
      // ignore
    }
    if (themeToggleBtn) {
      themeToggleBtn.textContent = willBeLight ? "🌙" : "☀️";
      themeToggleBtn.setAttribute(
        "aria-label",
        willBeLight ? "Comută pe tema închisă" : "Comută pe tema deschisă"
      );
    }
  }

  applyAdminThemeFromStorage();
  themeToggleBtn?.addEventListener("click", toggleAdminTheme);

  function renderTokenInfo() {
    if (!ADMIN_TOKEN) {
      userLineEl.innerHTML =
        "<span style='color:#ff5252;'>Token lipsă în URL.</span> Deschide admin.html?token=TOKENUL_TĂU.";
      if (envInfoEl) {
        envInfoEl.textContent = "MiniApp Admin – fără token";
      }
    } else {
      const short = ADMIN_TOKEN.slice(0, 4) + "..." + ADMIN_TOKEN.slice(-4);
      userLineEl.innerHTML = "Acces cu token: <b>" + short + "</b>";
      if (envInfoEl) {
        envInfoEl.textContent = "MiniApp Admin";
      }
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
    return msgs[msgs.length - 1].text || "";
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

    const sortMode = filterSortEl?.value || "recent_desc";

    list.sort((a, b) => {
      if (a.status !== b.status) {
        return a.status === "open" ? -1 : 1;
      }

      const aId = a.id || 0;
      const bId = b.id || 0;
      const aTotal = a.total_price || 0;
      const bTotal = b.total_price || 0;
      const aUser = ((a.username || a.user_id || "") + "").toLowerCase();
      const bUser = ((b.username || b.user_id || "") + "").toLowerCase();

      switch (sortMode) {
        case "recent_asc":
          return aId - bId;
        case "value_desc":
          return bTotal - aTotal;
        case "value_asc":
          return aTotal - bTotal;
        case "user_asc":
          if (aUser < bUser) return -1;
          if (aUser > bUser) return 1;
          return bId - aId;
        case "recent_desc":
        default:
          return bId - aId;
      }
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

      item.addEventListener("click", async () => {
        selectTicket(t.id);
        bumpAdminActive();
        const snap = await pollAdminCore();
        adminPoller.bumpFast();
        return snap;
      });

      ticketsListEl.appendChild(item);
    });
  }

  function hideNoteEditor() {
    if (ticketNoteEditEl) {
      ticketNoteEditEl.style.display = "none";
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
      hideNoteEditor();
      return;
    }

    chatHeaderEl.innerHTML = `
      <b>Tichet #${t.id}</b><br/>
      <span>User: ${t.username || t.user_id} · Produs: ${
      t.product_name
    } · ${t.qty} buc · total ${t.total_price} credite · status: ${
      t.status
    }</span>
    `;

    renderChatMessages(t);

    ticketDetailsEl.style.display = "block";
    ticketSummaryEl.innerHTML = `
      <b>Tichet #${t.id}</b><br/>
      User: <b>${t.username || t.user_id}</b><br/>
      Produs: <b>${t.product_name}</b> (${t.qty} buc, total ${
      t.total_price
    } credite)
    `;

    // Notă internă + buton edit
    ticketNoteInlineEl.innerHTML = "";
    const label = document.createElement("span");
    label.className = "ticket-note-label";
    label.textContent = "Notă internă:";
    ticketNoteInlineEl.appendChild(label);

    const noteSpan = document.createElement("span");
    noteSpan.className = "ticket-note-text";
    if (t.note) {
      noteSpan.textContent = " " + t.note;
    } else {
      noteSpan.textContent = " nu există (încă)";
      noteSpan.classList.add("ticket-note-empty");
    }
    ticketNoteInlineEl.appendChild(noteSpan);

    const editBtn = document.createElement("button");
    editBtn.type = "button";
    editBtn.className = "link-button";
    editBtn.textContent = t.note ? "Editează" : "Adaugă";
    editBtn.addEventListener("click", () => {
      if (!ticketNoteEditEl || !ticketNoteTextareaEl) return;
      ticketNoteEditEl.style.display = "block";
      ticketNoteTextareaEl.value = t.note || "";
      ticketNoteTextareaEl.focus();
    });
    ticketNoteInlineEl.appendChild(editBtn);

    hideNoteEditor();

    ticketStatusBarEl.textContent = "";
    ticketStatusBarEl.className = "status-bar";
  }

  function renderChatMessages(ticket) {
    const msgs = ticket.messages || [];
    chatMessagesEl.innerHTML = "";

    msgs.forEach((m) => {
      const row = document.createElement("div");
      row.className = "msg-row " + m.from;

      const bubble = document.createElement("div");
      bubble.className = "msg-bubble " + m.from;
      bubble.textContent = m.text;

      const meta = document.createElement("div");
      meta.className = "msg-meta";
      meta.textContent = m.sender || "";

      bubble.appendChild(meta);
      row.appendChild(bubble);

      chatMessagesEl.appendChild(row);
    });

    chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
  }

  async function sendAdminMessage() {
    const text = chatInputEl.value.trim();
    if (!text || !SELECTED_TICKET_ID) return;

    chatInputEl.value = "";

    try {
      const res = await apiCall("admin_send_message", {
        ticket_id: SELECTED_TICKET_ID,
        text,
        sender: "Admin",
      });

      if (!res.ok) {
        console.error("admin_send_message error:", res);
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
      selectTicket(updated.id);

      bumpAdminActive();

      const snap = await pollAdminCore();
      adminPoller.bumpFast();
      return snap;
    } catch (err) {
      console.error("admin_send_message error:", err);
    }
  }

  chatSendBtn?.addEventListener("click", sendAdminMessage);
  chatInputEl?.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendAdminMessage();
    }
  });

  // Răspunsuri rapide – doar pun text în input
  if (quickRepliesEl) {
    quickRepliesEl.addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-reply]");
      if (!btn) return;
      const text = btn.getAttribute("data-reply") || "";
      if (!text) return;
      if (chatInputEl.value.trim()) {
        chatInputEl.value = `${chatInputEl.value.trim()} ${text}`;
      } else {
        chatInputEl.value = text;
      }
      chatInputEl.focus();
    });
  }

  /* ---------- Notă internă tichet ---------- */

  ticketNoteCancelBtn?.addEventListener("click", () => {
    hideNoteEditor();
  });

  async function saveTicketNote() {
    if (!SELECTED_TICKET_ID) return;
    const t = ALL_TICKETS.find((x) => x.id === SELECTED_TICKET_ID);
    if (!t) return;

    const newNote = ticketNoteTextareaEl
      ? ticketNoteTextareaEl.value.trim()
      : "";

    ticketStatusBarEl.textContent = "Se salvează nota internă...";
    ticketStatusBarEl.className = "status-bar";

    try {
      const res = await apiCall("admin_update_ticket", {
        ticket_id: t.id,
        status: t.status,
        note: newNote,
      });

      if (!res.ok) {
        ticketStatusBarEl.textContent =
          "Eroare la salvarea notei: " + (res.error || "necunoscută");
        ticketStatusBarEl.className = "status-bar status-error";
        return;
      }

      t.note = newNote;
      ticketStatusBarEl.textContent = "Notă internă actualizată.";
      ticketStatusBarEl.className = "status-bar status-ok";

      updateTicketStats();
      renderTicketsList();
      selectTicket(t.id);
      hideNoteEditor();

      bumpAdminActive();
      const snap = await pollAdminCore();
      adminPoller.bumpFast();
      return snap;
    } catch (err) {
      console.error("admin_update_ticket note error:", err);
      ticketStatusBarEl.textContent = "Eroare la comunicarea cu serverul.";
      ticketStatusBarEl.className = "status-bar status-error";
    }
  }

  ticketNoteSaveBtn?.addEventListener("click", saveTicketNote);

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
      selectTicket(t.id);
      hideNoteEditor();

      bumpAdminActive();

      const snap = await pollAdminCore();
      adminPoller.bumpFast();
      return snap;
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
      if (typeof cat._collapsed === "undefined") {
        cat._collapsed = false;
      }

      const catDiv = document.createElement("div");
      catDiv.className = "cat-card";

      const header = document.createElement("div");
      header.className = "cat-header";

      const left = document.createElement("div");
      left.className = "cat-header-left";

      const toggleBtn = document.createElement("button");
      toggleBtn.className = "btn-ghost cat-toggle";
      toggleBtn.type = "button";
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
      });

      left.appendChild(toggleBtn);
      left.appendChild(nameInput);

      const right = document.createElement("div");
      right.className = "cat-header-right";

      const countBadge = document.createElement("div");
      countBadge.className = "ticket-status-pill open";
      countBadge.textContent = `${(cat.products || []).length} produse`;

      const moveUpBtn = document.createElement("button");
      moveUpBtn.className = "btn-ghost btn-ghost--icon";
      moveUpBtn.type = "button";
      moveUpBtn.textContent = "↑";
      moveUpBtn.title = "Mută categoria în sus";
      moveUpBtn.onclick = () => {
        if (catIndex <= 0) return;
        const arr = CURRENT_SHOP.categories;
        const tmp = arr[catIndex - 1];
        arr[catIndex - 1] = arr[catIndex];
        arr[catIndex] = tmp;
        renderShopEditor();
      };

      const moveDownBtn = document.createElement("button");
      moveDownBtn.className = "btn-ghost btn-ghost--icon";
      moveDownBtn.type = "button";
      moveDownBtn.textContent = "↓";
      moveDownBtn.title = "Mută categoria în jos";
      moveDownBtn.onclick = () => {
        const arr = CURRENT_SHOP.categories;
        if (catIndex >= arr.length - 1) return;
        const tmp = arr[catIndex + 1];
        arr[catIndex + 1] = arr[catIndex];
        arr[catIndex] = tmp;
        renderShopEditor();
      };

      const deleteBtn = document.createElement("button");
      deleteBtn.className = "btn-ghost";
      deleteBtn.textContent = "Șterge";
      deleteBtn.style.fontSize = "11px";
      deleteBtn.type = "button";
      deleteBtn.onclick = () => {
        if (confirm("Ștergi categoria?")) {
          CURRENT_SHOP.categories.splice(catIndex, 1);
          renderShopEditor();
        }
      };

      right.appendChild(countBadge);
      right.appendChild(moveUpBtn);
      right.appendChild(moveDownBtn);
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
          });
          const maxLabel = document.createElement("div");
          maxLabel.className = "small-input-label";
          maxLabel.textContent = "Max";
          colMax.appendChild(maxInput);
          colMax.appendChild(maxLabel);

          const colActions = document.createElement("div");
          colActions.className = "product-mini-actions";

          const moveUpProdBtn = document.createElement("button");
          moveUpProdBtn.className = "btn-ghost btn-ghost--icon";
          moveUpProdBtn.type = "button";
          moveUpProdBtn.textContent = "↑";
          moveUpProdBtn.title = "Mută produsul în sus";
          moveUpProdBtn.onclick = () => {
            if (prodIndex <= 0) return;
            const arr = cat.products;
            const tmp = arr[prodIndex - 1];
            arr[prodIndex - 1] = arr[prodIndex];
            arr[prodIndex] = tmp;
            renderShopEditor();
          };

          const moveDownProdBtn = document.createElement("button");
          moveDownProdBtn.className = "btn-ghost btn-ghost--icon";
          moveDownProdBtn.type = "button";
          moveDownProdBtn.textContent = "↓";
          moveDownProdBtn.title = "Mută produsul în jos";
          moveDownProdBtn.onclick = () => {
            const arr = cat.products;
            if (prodIndex >= arr.length - 1) return;
            const tmp = arr[prodIndex + 1];
            arr[prodIndex + 1] = arr[prodIndex];
            arr[prodIndex] = tmp;
            renderShopEditor();
          };

          const dupProdBtn = document.createElement("button");
          dupProdBtn.className = "btn-ghost btn-ghost--icon";
          dupProdBtn.type = "button";
          dupProdBtn.textContent = "⧉";
          dupProdBtn.title = "Duplichază produsul";
          dupProdBtn.onclick = () => {
            const clone = {
              ...prod,
              id: "prod_" + Date.now(),
            };
            cat.products.splice(prodIndex + 1, 0, clone);
            renderShopEditor();
          };

          const delProdBtn = document.createElement("button");
          delProdBtn.className = "btn-ghost btn-ghost--icon";
          delProdBtn.style.fontSize = "10px";
          delProdBtn.textContent = "X";
          delProdBtn.type = "button";
          delProdBtn.onclick = () => {
            if (confirm("Ștergi produsul?")) {
              cat.products.splice(prodIndex, 1);
              renderShopEditor();
            }
          };

          colActions.appendChild(moveUpProdBtn);
          colActions.appendChild(moveDownProdBtn);
          colActions.appendChild(dupProdBtn);
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
        addProdBtn.type = "button";
        addProdBtn.onclick = () => {
          cat.products.push({
            id: "prod_" + Date.now(),
            name: "Produs nou",
            price: 0,
            description: "",
            min_qty: 1,
            max_qty: 1,
          });
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

  function validateShop() {
    const issues = [];
    if (!CURRENT_SHOP || !CURRENT_SHOP.categories) return issues;
    CURRENT_SHOP.categories.forEach((cat, ci) => {
      const catName = (cat.name || "").trim();
      if (!catName) {
        issues.push(`Categoria ${ci + 1} nu are nume.`);
      }
      (cat.products || []).forEach((prod, pi) => {
        const pName = (prod.name || "").trim();
        if (!pName) {
          issues.push(
            `Produsul ${pi + 1} din categoria "${catName || "fără nume"}" nu are nume.`
          );
        }
        if (!prod.price || prod.price <= 0) {
          issues.push(
            `Produsul "${pName || "#" + (pi + 1)}" din categoria "${
              catName || "fără nume"
            }" are preț invalid.`
          );
        }
        if (!prod.min_qty || prod.min_qty <= 0) {
          issues.push(
            `Produsul "${pName || "#" + (pi + 1)}" are cantitate minimă invalidă.`
          );
        }
        if (!prod.max_qty || prod.max_qty < prod.min_qty) {
          issues.push(
            `Produsul "${pName || "#" + (pi + 1)}" are max < min.`
          );
        }
      });
    });
    return issues;
  }

  async function saveShop() {
    if (!CURRENT_SHOP) return;
    shopStatusBarEl.textContent = "Se verifică și se salvează shop-ul...";
    shopStatusBarEl.className = "status-bar";

    const issues = validateShop();
    if (issues.length > 0) {
      const msg =
        issues.slice(0, 3).join(" · ") +
        (issues.length > 3 ? ` · și încă ${issues.length - 3} probleme.` : "");
      shopStatusBarEl.textContent =
        "Verifică shop-ul înainte de salvare: " + msg;
      shopStatusBarEl.className = "status-bar status-error";
      return;
    }

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

      bumpAdminActive();

      const snap = await pollAdminCore();
      adminPoller.bumpFast();
      return snap;
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
      _collapsed: false,
    });
    renderShopEditor();
  }

  addCategoryBtn?.addEventListener("click", addCategory);
  saveShopBtn?.addEventListener("click", saveShop);

  collapseAllBtn?.addEventListener("click", () => {
    if (!CURRENT_SHOP || !CURRENT_SHOP.categories) return;
    CURRENT_SHOP.categories.forEach((c) => {
      c._collapsed = true;
    });
    renderShopEditor();
  });

  expandAllBtn?.addEventListener("click", () => {
    if (!CURRENT_SHOP || !CURRENT_SHOP.categories) return;
    CURRENT_SHOP.categories.forEach((c) => {
      c._collapsed = false;
    });
    renderShopEditor();
  });

  /* ---------- CORE POLL ADMIN (folosit de smartPoll) ---------- */

  async function pollAdminCore() {
    if (!ADMIN_TOKEN) {
      setLiveIndicator(false);
      return { tickets: ALL_TICKETS, shop: CURRENT_SHOP };
    }

    try {
      const res = await apiCall("admin_get_tickets", {});
      if (!res.ok) {
        if (res.error === "forbidden") {
          userLineEl.innerHTML =
            "<span style='color:#ff5252;'>Token invalid.</span>";
        }
        setLiveIndicator(false);
        return { tickets: ALL_TICKETS, shop: CURRENT_SHOP };
      }

      setLiveIndicator(true);
      lastSyncAt = new Date();
      updateSyncLine();

      ALL_TICKETS = res.tickets || [];
      CURRENT_SHOP = res.shop || { categories: [] };

      updateTicketStats();
      renderTicketsList();
      renderShopEditor();

      if (SELECTED_TICKET_ID) {
        const t = ALL_TICKETS.find((x) => x.id === SELECTED_TICKET_ID);
        if (t) {
          selectTicket(t.id);
        }
      }

      return { tickets: ALL_TICKETS, shop: CURRENT_SHOP };
    } catch (err) {
      console.error("admin_get_tickets error:", err);
      userLineEl.innerHTML =
        "<span style='color:#ff5252;'>Eroare la rețea.</span>";
      setLiveIndicator(false);
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

  // filtre – doar redesenează din datele existente, fără request nou
  function onFilterChange() {
    renderTicketsList();
  }

  let searchTimeout = null;
  filterStatusEl?.addEventListener("change", onFilterChange);
  filterSortEl?.addEventListener("change", onFilterChange);
  filterSearchEl?.addEventListener("input", () => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(onFilterChange, 150);
  });

  // schimbare de tab în admin (chat / shop)
  window.onAdminTabChange = () => {
    if (isAnyAdminTabActive()) {
      bumpAdminActive();
      adminPoller.start();
    } else {
      adminPoller.stop();
    }
  };

  // când fereastra nu e vizibilă, oprim polling-ul
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
    if (!ADMIN_TOKEN) {
      setLiveIndicator(false);
      return;
    }

    await pollAdminCore();
    bumpAdminActive();
    adminPoller.start();
  }

  setLiveIndicator(false);
  initAdmin();
}
