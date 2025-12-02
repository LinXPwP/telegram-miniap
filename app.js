// app.js – versiune simplificată, doar pentru USER
console.log("User dashboard v2.0");

const API_URL = "https://api.redgen.vip/";

/* ============================
   HELPER: SMART POLLING
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

    if (isEnabledFn && !isEnabledFn()) {
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
    } catch (err) {
      console.error("[smartPoll] error:", err);
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
   FORMAT TIMESTAMP & SCROLL
   ============================ */
function formatTimestamp(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  if (isNaN(d.getTime())) return "";
  const day = String(d.getDate()).padStart(2, "0");
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const year = String(d.getFullYear()).slice(-2);
  const hours = String(d.getHours()).padStart(2, "0");
  const mins = String(d.getMinutes()).padStart(2, "0");
  return `${day}/${month}/${year} · ${hours}:${mins}`;
}

function isNearBottom(container, thresholdPx = 80) {
  if (!container) return true;
  const { scrollTop, scrollHeight, clientHeight } = container;
  return scrollHeight - (scrollTop + clientHeight) < thresholdPx;
}

function scrollToBottom(container, force = false) {
  if (!container) return;
  if (force || isNearBottom(container)) {
    container.scrollTop = container.scrollHeight;
  }
}

/* ============================
   RENDER MESAJ CHAT
   ============================ */
function renderMessages(messages, options) {
  const {
    container,
    ticket,
    canReply,
    onReply,
    onJumpTo,
  } = options;

  if (!container) return;
  const keepAtBottom = isNearBottom(container);
  container.innerHTML = "";

  const msgById = {};
  (messages || []).forEach((m) => {
    if (m && m.id) msgById[m.id] = m;
  });

  (messages || []).forEach((m) => {
    if (!m) return;

    const row = document.createElement("div");
    row.className = "msg-row";
    row.dataset.messageId = m.id || "";

    const side = document.createElement("div");
    side.className = "msg-side";
    side.textContent = (m.sender || (m.from === "admin" ? "Admin" : "User"))
      .slice(0, 2)
      .toUpperCase();

    const main = document.createElement("div");
    main.className = "msg-main";

    const header = document.createElement("div");
    header.className = "msg-header";

    const nameEl = document.createElement("span");
    nameEl.className = "msg-name";
    if (m.from === "admin") nameEl.classList.add("msg-name--admin");
    nameEl.textContent = m.sender || (m.from === "admin" ? "Admin" : "User");

    const tsEl = document.createElement("span");
    tsEl.className = "msg-time";
    tsEl.textContent = formatTimestamp(m.ts);

    header.appendChild(nameEl);
    header.appendChild(tsEl);

    const body = document.createElement("div");
    body.className = "msg-body";

    if (m.reply_to && msgById[m.reply_to]) {
      const origin = msgById[m.reply_to];
      const reply = document.createElement("div");
      reply.className = "msg-reply-preview";
      reply.textContent = (origin.text || "").slice(0, 80) || "Mesaj anterior";

      reply.addEventListener("click", (e) => {
        e.stopPropagation();
        if (typeof onJumpTo === "function") {
          onJumpTo(origin.id);
        }
      });

      body.appendChild(reply);
    }

    const textEl = document.createElement("div");
    textEl.className = "msg-text";

    if (m.deleted) {
      textEl.classList.add("msg-text--deleted");
      textEl.textContent = "Mesaj șters";
    } else {
      textEl.textContent = m.text;
    }

    body.appendChild(textEl);

    if (!m.deleted && canReply) {
      const actions = document.createElement("div");
      actions.className = "msg-actions";

      const replyBtn = document.createElement("button");
      replyBtn.className = "msg-action";
      replyBtn.textContent = "Răspunde";
      replyBtn.addEventListener("click", () => {
        if (typeof onReply === "function") onReply(m);
      });

      actions.appendChild(replyBtn);
      body.appendChild(actions);
    }

    main.appendChild(header);
    main.appendChild(body);

    row.appendChild(side);
    row.appendChild(main);
    container.appendChild(row);
  });

  scrollToBottom(container, keepAtBottom);
}

function highlightMessage(container, messageId) {
  if (!container) return;
  const row = container.querySelector(
    `.msg-row[data-message-id="${messageId}"]`
  );
  if (!row) return;
  row.classList.add("msg-row--highlight");
  row.scrollIntoView({ behavior: "smooth", block: "center" });
  setTimeout(() => row.classList.remove("msg-row--highlight"), 800);
}

/* ============================
   USER MINIAPP
   ============================ */

document.addEventListener("DOMContentLoaded", () => {
  initUserApp();
});

function initUserApp() {
  const tg = window.Telegram?.WebApp;

  let CURRENT_USER = null;
  let CURRENT_SHOP = null;
  let CURRENT_TICKETS = [];
  let SELECTED_TICKET_ID = null;

  let USER_LAST_SEEN = {};

  /* --- localStorage unread --- */
  function loadUserSeen() {
    try {
      const raw = localStorage.getItem("user_ticket_seen");
      USER_LAST_SEEN = raw ? JSON.parse(raw) : {};
    } catch {
      USER_LAST_SEEN = {};
    }
  }

  function saveUserSeen() {
    try {
      localStorage.setItem("user_ticket_seen", JSON.stringify(USER_LAST_SEEN));
    } catch {
      // ignore
    }
  }

  function markTicketRead(ticket) {
    if (!ticket) return;
    const msgs = ticket.messages || [];
    if (!msgs.length) return;
    const last = msgs[msgs.length - 1];
    if (!last || !last.id) return;
    USER_LAST_SEEN[String(ticket.id)] = last.id;
    saveUserSeen();
  }

  function getUnreadCount(ticket) {
    const msgs = ticket.messages || [];
    if (!msgs.length) return 0;

    const key = String(ticket.id);
    const lastSeenId = USER_LAST_SEEN[key];

    let startIndex = -1;
    if (lastSeenId) {
      startIndex = msgs.findIndex((m) => m && m.id === lastSeenId);
    }

    let count = 0;
    for (let i = startIndex + 1; i < msgs.length; i++) {
      const m = msgs[i];
      if (!m || m.deleted) continue;
      if (m.from === "admin") count++;
    }
    return count;
  }

  loadUserSeen();

  /* --- DOM --- */
  const userLineEl = document.getElementById("userLine");
  const creditsValueEl = document.getElementById("creditsValue");

  const shopTabEl = document.getElementById("shopTab");
  const ticketsTabEl = document.getElementById("ticketsTab");

  const categoriesContainer = document.getElementById("categoriesContainer");

  const productPanelEl = document.getElementById("productPanel");
  const panelNameEl = document.getElementById("panelName");
  const panelDescEl = document.getElementById("panelDesc");
  const panelPriceEl = document.getElementById("panelPrice");
  const panelQtyEl = document.getElementById("panelQty");
  const panelQtyRangeEl = document.getElementById("panelQtyRange");
  const panelStatusEl = document.getElementById("panelStatus");
  const panelCloseBtn = document.getElementById("panelCloseBtn");
  const panelBuyBtn = document.getElementById("panelBuyBtn");

  const goToTicketsBtn = document.getElementById("goToTicketsBtn");
  const backToShopBtn = document.getElementById("backToShopBtn");

  const chatListEl = document.getElementById("chatList");
  const ticketsBackdrop = document.getElementById("ticketsBackdrop");
  const ticketsMenuToggle = document.getElementById("ticketsMenuToggle");

  const ticketTitleEl = document.getElementById("ticketTitle");
  const chatMessagesEl = document.getElementById("chatMessages");
  const chatInputEl = document.getElementById("chatInput");
  const chatSendBtn = document.getElementById("chatSendBtn");
  const chatInputAreaEl = document.getElementById("chatInputArea");
  const userTicketCloseBtn = document.getElementById("userTicketCloseBtn");

  let SELECTED_PRODUCT = null;

  // reply mode
  let replyState = {
    active: false,
    messageId: null,
    preview: "",
  };
  let replyBarEl = null;

  function showUserLine(text) {
    if (!userLineEl) return;
    userLineEl.textContent = text;
    userLineEl.style.display = text ? "block" : "none";
  }

  /* --- API helper --- */
  function apiCall(action, extra = {}) {
    const payload = {
      action,
      user: CURRENT_USER,
      ...extra,
    };

    return fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }).then((r) => r.json());
  }

  /* --- NAVIGAȚIE ECRANE --- */
  function showShop() {
    shopTabEl.classList.add("screen--active");
    ticketsTabEl.classList.remove("screen--active");
    closeTicketsDrawer();
    ticketsPoller.stop();
  }

  function showTickets() {
    shopTabEl.classList.remove("screen--active");
    ticketsTabEl.classList.add("screen--active");
    bumpUserActive();
    ticketsPoller.start();
  }

  goToTicketsBtn?.addEventListener("click", () => {
    showTickets();
  });

  backToShopBtn?.addEventListener("click", () => {
    showShop();
  });

  function isTicketsTabActive() {
    return ticketsTabEl.classList.contains("screen--active");
  }

  /* --- DRAWER TICHETE (MOBILE) --- */
  function openTicketsDrawer() {
    ticketsTabEl.classList.add("tickets-drawer-open");
  }

  function closeTicketsDrawer() {
    ticketsTabEl.classList.remove("tickets-drawer-open");
  }

  ticketsMenuToggle?.addEventListener("click", () => {
    if (ticketsTabEl.classList.contains("tickets-drawer-open")) {
      closeTicketsDrawer();
    } else {
      openTicketsDrawer();
    }
  });

  ticketsBackdrop?.addEventListener("click", closeTicketsDrawer);

  /* --- SHOP RENDER --- */
  function renderShop(shop) {
    categoriesContainer.innerHTML = "";
    if (!shop || !shop.categories || !shop.categories.length) {
      const empty = document.createElement("div");
      empty.className = "empty-state";
      empty.textContent = "Nu există produse disponibile momentan.";
      categoriesContainer.appendChild(empty);
      return;
    }

    shop.categories.forEach((cat) => {
      const catEl = document.createElement("section");
      catEl.className = "category";

      const header = document.createElement("div");
      header.className = "category-header";

      const nameEl = document.createElement("h2");
      nameEl.className = "category-name";
      nameEl.textContent = cat.name || "Categorie";

      const descEl = document.createElement("p");
      descEl.className = "category-desc";
      descEl.textContent = cat.description || "";

      header.appendChild(nameEl);

      const productsEl = document.createElement("div");
      productsEl.className = "products";

      (cat.products || []).forEach((prod) => {
        const item = document.createElement("article");
        item.className = "product";

        const left = document.createElement("div");
        left.className = "product-main";

        const pName = document.createElement("div");
        pName.className = "product-name";
        pName.textContent = prod.name;

        const pDesc = document.createElement("div");
        pDesc.className = "product-text";
        pDesc.textContent = prod.description || "";

        left.appendChild(pName);
        left.appendChild(pDesc);

        const right = document.createElement("div");
        right.className = "product-right";

        const pPrice = document.createElement("div");
        pPrice.className = "product-price";
        pPrice.textContent = `${prod.price} credite`;

        const btn = document.createElement("button");
        btn.className = "btn-secondary btn-secondary--small";
        btn.textContent = "Detalii";
        btn.addEventListener("click", () => openProductPanel(prod));

        right.appendChild(pPrice);
        right.appendChild(btn);

        item.appendChild(left);
        item.appendChild(right);
        productsEl.appendChild(item);
      });

      catEl.appendChild(header);
      if (cat.description) catEl.appendChild(descEl);
      catEl.appendChild(productsEl);

      categoriesContainer.appendChild(catEl);
    });
  }

  /* --- POPUP PRODUS --- */
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

    productPanelEl.setAttribute("aria-hidden", "false");
    productPanelEl.classList.add("product-panel--visible");
  }

  function closeProductPanel() {
    SELECTED_PRODUCT = null;
    productPanelEl.setAttribute("aria-hidden", "true");
    productPanelEl.classList.remove("product-panel--visible");
  }

  panelCloseBtn?.addEventListener("click", closeProductPanel);
  productPanelEl?.addEventListener("click", (e) => {
    if (e.target === productPanelEl) {
      closeProductPanel();
    }
  });

  panelBuyBtn?.addEventListener("click", buySelectedProduct);

  async function buySelectedProduct() {
    if (!SELECTED_PRODUCT || !CURRENT_USER) return;

    const qty = Number(panelQtyEl.value || 0);
    const prod = SELECTED_PRODUCT;

    panelStatusEl.textContent = "Se trimite comanda...";
    panelStatusEl.className = "status-bar";

    try {
      const res = await apiCall("buy_product", {
        product_id: prod.id,
        qty,
      });

      if (!res.ok) {
        panelStatusEl.className = "status-bar status-bar--error";
        if (res.error === "not_enough_credits") {
          panelStatusEl.textContent = `Nu ai suficiente credite. Ai ${res.have}, ai nevoie de ${res.need}.`;
        } else if (res.error === "qty_out_of_range") {
          panelStatusEl.textContent = `Cantitate invalidă. Min ${res.min_qty}, max ${res.max_qty}.`;
        } else {
          panelStatusEl.textContent = "Eroare la cumpărare.";
        }
        return;
      }

      CURRENT_USER.credits = res.new_balance;
      creditsValueEl.textContent = CURRENT_USER.credits;

      const newTicket = res.ticket;
      CURRENT_TICKETS.push(newTicket);

      panelStatusEl.className = "status-bar status-bar--ok";
      panelStatusEl.textContent = `Comandă trimisă. S-a creat tichet #${newTicket.id}.`;

      renderTicketList();
      selectTicket(newTicket.id);
      showTickets();
      ticketsPoller.bumpFast();
    } catch (err) {
      console.error("buy_product error:", err);
      panelStatusEl.className = "status-bar status-bar--error";
      panelStatusEl.textContent = "Eroare de rețea.";
    }
  }

  /* --- LISTĂ TICHETE --- */
  function lastMessagePreview(t) {
    const msgs = t.messages || [];
    if (!msgs.length) return "Fără mesaje încă.";
    const last = msgs[msgs.length - 1];
    if (!last) return "";
    if (last.deleted) return "Mesaj șters";
    return last.text || "";
  }

  function renderTicketList() {
    chatListEl.innerHTML = "";

    if (!CURRENT_TICKETS || !CURRENT_TICKETS.length) {
      const empty = document.createElement("div");
      empty.className = "empty-state empty-state--sidebar";
      empty.textContent = "Nu ai tichete încă.";
      chatListEl.appendChild(empty);
      return;
    }

    const sorted = [...CURRENT_TICKETS].sort((a, b) => {
      if (a.status !== b.status) {
        return a.status === "open" ? -1 : 1;
      }
      return (b.id || 0) - (a.id || 0);
    });

    sorted.forEach((t) => {
      const item = document.createElement("div");
      item.className = "ticket-item";
      if (t.id === SELECTED_TICKET_ID) item.classList.add("ticket-item--active");

      const top = document.createElement("div");
      top.className = "ticket-item-top";

      const title = document.createElement("div");
      title.className = "ticket-item-title";
      title.textContent = t.product_name || "Produs";

      const status = document.createElement("span");
      status.className =
        "ticket-status " +
        (t.status === "open" ? "ticket-status--open" : "ticket-status--closed");
      status.textContent = t.status === "open" ? "DESCHIS" : "ÎNCHIS";

      const unread = getUnreadCount(t);
      if (unread > 0 && t.status === "open") {
        const badge = document.createElement("span");
        badge.className = "ticket-unread";
        badge.textContent = unread > 99 ? "99+" : String(unread);
        top.appendChild(badge);
      }

      top.appendChild(title);
      top.appendChild(status);

      const bottom = document.createElement("div");
      bottom.className = "ticket-item-bottom";
      bottom.textContent = lastMessagePreview(t);

      item.appendChild(top);
      item.appendChild(bottom);

      item.addEventListener("click", async () => {
        selectTicket(t.id);
        closeTicketsDrawer();
        const snap = await pollTicketsCore();
        ticketsPoller.bumpFast();
        return snap;
      });

      chatListEl.appendChild(item);
    });
  }

  function updateChatState(ticket) {
    if (!chatInputEl || !chatSendBtn) return;

    if (!ticket) {
      chatInputEl.disabled = true;
      chatSendBtn.disabled = true;
      chatInputEl.placeholder = "Selectează un tichet pentru a scrie...";
      userTicketCloseBtn.style.display = "none";
      ticketTitleEl.textContent = "Niciun tichet selectat";
      clearReplyState();
      return;
    }

    const closed = ticket.status === "closed";
    chatInputEl.disabled = closed;
    chatSendBtn.disabled = closed;
    chatInputEl.placeholder = closed
      ? "Tichet închis. Nu mai poți trimite mesaje."
      : "Scrie un mesaj către admin...";

    userTicketCloseBtn.style.display = closed ? "none" : "inline-flex";
    if (closed) clearReplyState();
  }

  function selectTicket(ticketId) {
    SELECTED_TICKET_ID = ticketId;
    const ticket = CURRENT_TICKETS.find((t) => t.id === ticketId);

    if (!ticket) {
      chatMessagesEl.innerHTML = "";
      updateChatState(null);
      renderTicketList();
      return;
    }

    ticketTitleEl.textContent = `${ticket.product_name || "Produs"} · #${
      ticket.id
    }`;

    markTicketRead(ticket);
    renderTicketList();
    renderTicketMessages(ticket);
    updateChatState(ticket);
  }

  function renderTicketMessages(ticket) {
    renderMessages(ticket.messages || [], {
      container: chatMessagesEl,
      ticket,
      canReply: ticket.status === "open",
      onReply: (msg) => setReplyState(msg),
      onJumpTo: (id) => highlightMessage(chatMessagesEl, id),
    });
  }

  /* --- REPLY STATE --- */
  function ensureReplyBar() {
    if (replyBarEl) return replyBarEl;
    const bar = document.createElement("div");
    bar.className = "reply-bar";
    bar.style.display = "none";

    const text = document.createElement("span");
    text.className = "reply-bar-text";

    const close = document.createElement("button");
    close.className = "reply-bar-close";
    close.textContent = "Anulează";
    close.addEventListener("click", clearReplyState);

    bar.appendChild(text);
    bar.appendChild(close);

    chatInputAreaEl.insertBefore(bar, chatInputAreaEl.firstChild);
    replyBarEl = bar;
    return bar;
  }

  function setReplyState(msg) {
    const bar = ensureReplyBar();
    replyState.active = true;
    replyState.messageId = msg.id;
    replyState.preview = (msg.text || "").slice(0, 80);

    const textEl = bar.querySelector(".reply-bar-text");
    textEl.textContent = `Răspuns la: "${replyState.preview}"`;
    bar.style.display = "flex";
    chatInputEl.focus();
  }

  function clearReplyState() {
    replyState = {
      active: false,
      messageId: null,
      preview: "",
    };
    if (replyBarEl) {
      replyBarEl.style.display = "none";
    }
  }

  /* --- TRIMITERE MESAJ --- */
  async function sendMessage() {
    const text = chatInputEl.value.trim();
    if (!text || !SELECTED_TICKET_ID) return;

    const ticket = CURRENT_TICKETS.find((t) => t.id === SELECTED_TICKET_ID);
    if (!ticket || ticket.status === "closed") {
      updateChatState(ticket || null);
      return;
    }

    const reply_to = replyState.active ? replyState.messageId : null;

    chatInputEl.value = "";

    try {
      const res = await apiCall("user_send_message", {
        ticket_id: SELECTED_TICKET_ID,
        text,
        reply_to,
      });

      if (!res.ok) {
        console.error("user_send_message error:", res);
        if (res.error === "ticket_closed") {
          const updated = CURRENT_TICKETS.find((t) => t.id === SELECTED_TICKET_ID);
          updateChatState(updated || null);
        }
        return;
      }

      const updated = res.ticket;
      const idx = CURRENT_TICKETS.findIndex((t) => t.id === updated.id);
      if (idx >= 0) CURRENT_TICKETS[idx] = updated;
      else CURRENT_TICKETS.push(updated);

      clearReplyState();
      renderTicketList();
      selectTicket(updated.id);
      bumpUserActive();
      const snap = await pollTicketsCore();
      ticketsPoller.bumpFast();
      return snap;
    } catch (err) {
      console.error("user_send_message error:", err);
    }
  }

  chatSendBtn?.addEventListener("click", sendMessage);
  chatInputEl?.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  /* --- ÎNCHIDERE TICHIET --- */
  async function closeCurrentTicket() {
    if (!SELECTED_TICKET_ID) return;

    if (!confirm("Sigur vrei să închizi acest tichet?")) return;

    try {
      const res = await apiCall("user_close_ticket", {
        ticket_id: SELECTED_TICKET_ID,
      });

      if (!res.ok) {
        console.error("user_close_ticket error:", res);
        return;
      }

      const updated = res.ticket;
      const idx = CURRENT_TICKETS.findIndex((t) => t.id === updated.id);
      if (idx >= 0) CURRENT_TICKETS[idx] = updated;
      else CURRENT_TICKETS.push(updated);

      renderTicketList();
      selectTicket(updated.id);
      bumpUserActive();
      const snap = await pollTicketsCore();
      ticketsPoller.bumpFast();
      return snap;
    } catch (err) {
      console.error("user_close_ticket error:", err);
    }
  }

  userTicketCloseBtn?.addEventListener("click", closeCurrentTicket);

  /* --- POLLING TICHETE --- */
  let userActiveUntil = 0;
  function bumpUserActive(extraMs = 25000) {
    const now = Date.now();
    userActiveUntil = Math.max(userActiveUntil, now + extraMs);
  }

  async function pollTicketsCore() {
    if (!CURRENT_USER) return CURRENT_TICKETS;

    try {
      const res = await apiCall("user_get_tickets", {});
      if (!res.ok) return CURRENT_TICKETS;

      CURRENT_TICKETS = res.tickets || [];

      CURRENT_TICKETS.forEach((t) => {
        const key = String(t.id);
        if (!USER_LAST_SEEN[key]) {
          const msgs = t.messages || [];
          if (msgs.length) {
            USER_LAST_SEEN[key] = msgs[msgs.length - 1].id;
          }
        }
      });
      saveUserSeen();

      renderTicketList();

      if (SELECTED_TICKET_ID) {
        const t = CURRENT_TICKETS.find((x) => x.id === SELECTED_TICKET_ID);
        if (t) {
          selectTicket(t.id);
        } else {
          SELECTED_TICKET_ID = null;
          chatMessagesEl.innerHTML = "";
          updateChatState(null);
        }
      }

      return CURRENT_TICKETS;
    } catch (err) {
      console.error("user_get_tickets error:", err);
      return CURRENT_TICKETS;
    }
  }

  const ticketsPoller = createSmartPoll(
    pollTicketsCore,
    () => {
      if (!isTicketsTabActive()) return false;
      if (!CURRENT_TICKETS || !CURRENT_TICKETS.length) return false;
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

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      if (isTicketsTabActive()) {
        bumpUserActive();
        ticketsPoller.start();
      }
    } else {
      ticketsPoller.stop();
    }
  });

  /* --- INIT APP --- */
  async function initApp() {
    if (!tg) {
      showUserLine(
        "Nu ești în Telegram MiniApp. Deschide link-ul din bot în Telegram."
      );
      return;
    }

    tg.ready();
    tg.expand();

    const user = tg.initDataUnsafe?.user;
    if (!user) {
      showUserLine(
        "Telegram nu a trimis datele utilizatorului. Deschide MiniApp-ul din butonul botului."
      );
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
        showUserLine("Eroare la inițializare (server).");
        return;
      }

      CURRENT_USER.credits = res.user.credits;
      CURRENT_USER.username = res.user.username;

      creditsValueEl.textContent = CURRENT_USER.credits;

      const displayName =
        CURRENT_USER.username && CURRENT_USER.username !== "fara_username"
          ? "@" + CURRENT_USER.username
          : `ID ${CURRENT_USER.id}`;
      showUserLine(`Utilizator: ${displayName}`);

      CURRENT_SHOP = res.shop;
      CURRENT_TICKETS = res.tickets || [];

      CURRENT_TICKETS.forEach((t) => {
        const key = String(t.id);
        if (!USER_LAST_SEEN[key]) {
          const msgs = t.messages || [];
          if (msgs.length) {
            USER_LAST_SEEN[key] = msgs[msgs.length - 1].id;
          }
        }
      });
      saveUserSeen();

      renderShop(CURRENT_SHOP);
      renderTicketList();
      showShop();
    } catch (err) {
      console.error("init error:", err);
      showUserLine("Eroare la inițializare (rețea).");
    }
  }

  initApp();
}
