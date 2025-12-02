// app.js – versiune doar USER (Shop + Tickets + Chat)
// - Discord-like chat cu reply
// - Drawer cu lista de tichete (3 linii stânga sus)
// - Popup overlay pentru produse
// - Smart polling pentru tichete

// URL-ul Netlify / API (proxy către bot.py)
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
   UTIL – format timp + scroll
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
  return `${day}/${month}/${year}, ${hours}:${mins}`;
}

function isNearBottom(container, thresholdPx = 80) {
  if (!container) return true;
  const { scrollTop, scrollHeight, clientHeight } = container;
  return scrollHeight - (scrollTop + clientHeight) < thresholdPx;
}

function smartScrollToBottom(container, force = false) {
  if (!container) return;
  if (force || isNearBottom(container)) {
    container.scrollTop = container.scrollHeight;
  }
}

/* ============================
   RENDER – mesaje Discord-like
   ============================ */

function renderDiscordMessages(messages, options) {
  const {
    container,
    ticket,
    canReply,
    onReply,
    onJumpTo,
  } = options;

  if (!container) return;
  const wasNearBottom = isNearBottom(container);
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

    const avatar = document.createElement("div");
    avatar.className = "msg-avatar";
    const senderName = m.sender || (m.from === "system" ? "System" : "User");
    avatar.textContent = (senderName || "?").slice(0, 1).toUpperCase();

    const content = document.createElement("div");
    content.className = "msg-content";

    const headerLine = document.createElement("div");
    headerLine.className = "msg-header-line";

    const userEl = document.createElement("span");
    userEl.className = "msg-username";
    if (m.from === "admin") userEl.classList.add("msg-username--admin");
    userEl.textContent = senderName;

    const tsEl = document.createElement("span");
    tsEl.className = "msg-timestamp";
    tsEl.textContent = formatTimestamp(m.ts);

    headerLine.appendChild(userEl);
    headerLine.appendChild(tsEl);

    const bubble = document.createElement("div");
    bubble.className = "msg-bubble";

    if (m.reply_to && msgById[m.reply_to]) {
      const origin = msgById[m.reply_to];
      const preview = document.createElement("div");
      preview.className = "msg-reply-preview";
      const strong = document.createElement("strong");
      strong.textContent = origin.sender || "User";
      preview.appendChild(strong);
      const txt = document.createElement("span");
      txt.textContent = (origin.text || "").slice(0, 60);
      preview.appendChild(txt);

      preview.addEventListener("click", (e) => {
        e.stopPropagation();
        if (typeof onJumpTo === "function") {
          onJumpTo(origin.id);
        }
      });

      bubble.appendChild(preview);
    }

    const textEl = document.createElement("div");
    textEl.className = "msg-text";
    if (m.deleted) {
      textEl.classList.add("msg-text--deleted");
      textEl.textContent = "Mesaj șters";
    } else {
      textEl.textContent = m.text;
    }
    bubble.appendChild(textEl);

    content.appendChild(headerLine);
    content.appendChild(bubble);
    row.appendChild(avatar);
    row.appendChild(content);
    container.appendChild(row);
  });

  smartScrollToBottom(container, wasNearBottom);
}

function scrollToMessageElement(container, messageId) {
  if (!container) return;
  const row = container.querySelector(
    `.msg-row[data-message-id="${messageId}"]`
  );
  if (!row) return;
  row.classList.add("msg-row--highlight");
  row.scrollIntoView({ behavior: "smooth", block: "center" });
  setTimeout(() => {
    row.classList.remove("msg-row--highlight");
  }, 1200);
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

  let USER_LAST_SEEN = {};

  function loadUserSeen() {
    try {
      const raw = localStorage.getItem("user_ticket_seen");
      if (raw) {
        USER_LAST_SEEN = JSON.parse(raw);
      } else {
        USER_LAST_SEEN = {};
      }
    } catch (e) {
      USER_LAST_SEEN = {};
    }
  }

  function saveUserSeen() {
    try {
      localStorage.setItem("user_ticket_seen", JSON.stringify(USER_LAST_SEEN));
    } catch (e) {}
  }

  function markTicketReadUser(ticket) {
    if (!ticket) return;
    const msgs = ticket.messages || [];
    if (!msgs.length) return;
    const last = msgs[msgs.length - 1];
    if (!last || !last.id) return;
    const key = String(ticket.id);
    USER_LAST_SEEN[key] = last.id;
    saveUserSeen();
  }

  function getUnreadCountUser(ticket) {
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
      if (!m) continue;
      if (m.deleted) continue;
      if (m.from === "admin") count++;
    }
    return count;
  }

  loadUserSeen();

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
  const ticketTitleEl = document.getElementById("ticketTitle");
  const chatMessagesEl = document.getElementById("chatMessages");
  const chatInputEl = document.getElementById("chatInput");
  const chatSendBtn = document.getElementById("chatSendBtn");

  const userTicketCloseBtn = document.getElementById("userTicketCloseBtn");

  const ticketsMenuToggle = document.getElementById("ticketsMenuToggle");
  const ticketsBackdrop = document.getElementById("ticketsBackdrop");

  const shopTabEl = document.getElementById("shopTab");
  const ticketsTabEl = document.getElementById("ticketsTab");
  const shopHeaderEl = document.getElementById("shopHeader");
  const goToTicketsBtn = document.getElementById("goToTicketsBtn");
  const backToShopBtn = document.getElementById("backToShopBtn");

  const chatInputContainer = document.querySelector(
    "#ticketsTab .chat-input, .chat-input"
  );
  let userModeBar = null;
  let userMode = {
    type: null,
    messageId: null,
    previewText: "",
    sender: "",
  };

  /* ===== Shop <-> Tickets vizual ===== */
  function showShopTab() {
    if (shopTabEl) shopTabEl.classList.add("active");
    if (ticketsTabEl) ticketsTabEl.classList.remove("active");
    if (shopHeaderEl) shopHeaderEl.style.display = "flex";
    userTicketsPoller.stop();
  }

  function showTicketsTab() {
    if (shopTabEl) shopTabEl.classList.remove("active");
    if (ticketsTabEl) ticketsTabEl.classList.add("active");
    if (shopHeaderEl) shopHeaderEl.style.display = "none";
    bumpUserActive();
    userTicketsPoller.start();
  }

  if (goToTicketsBtn) {
    goToTicketsBtn.addEventListener("click", () => {
      showTicketsTab();
    });
  }

  if (backToShopBtn) {
    backToShopBtn.addEventListener("click", () => {
      showShopTab();
    });
  }

  /* ===== Reply bar + rând input+buton ===== */
  if (chatInputContainer && !chatInputContainer.querySelector(".chat-mode-bar")) {
    userModeBar = document.createElement("div");
    userModeBar.className = "chat-mode-bar";
    userModeBar.style.display = "none";
    const span = document.createElement("span");
    span.className = "chat-mode-text";
    const btn = document.createElement("button");
    btn.className = "btn-ghost";
    btn.style.fontSize = "10px";
    btn.textContent = "Anulează";
    btn.addEventListener("click", () => {
      userMode.type = null;
      userMode.messageId = null;
      userMode.previewText = "";
      userMode.sender = "";
      userModeBar.style.display = "none";
    });
    userModeBar.appendChild(span);
    userModeBar.appendChild(btn);
    chatInputContainer.prepend(userModeBar);

    const row = document.createElement("div");
    row.className = "chat-input-row";
    if (chatInputEl && chatSendBtn) {
      chatInputContainer.insertBefore(row, chatInputEl);
      row.appendChild(chatInputEl);
      row.appendChild(chatSendBtn);
    }
  }

  function clearUserMode() {
    if (!userModeBar) return;
    userMode.type = null;
    userMode.messageId = null;
    userMode.previewText = "";
    userMode.sender = "";
    userModeBar.style.display = "none";
  }

  function updateUserChatState(ticket) {
    if (!chatInputEl || !chatSendBtn) return;

    if (!ticket) {
      chatInputEl.disabled = true;
      chatSendBtn.disabled = true;
      chatInputEl.placeholder =
        "Selectează un tichet pentru a începe chat-ul...";
      clearUserMode();
      if (userTicketCloseBtn) {
        userTicketCloseBtn.style.display = "none";
      }
      if (ticketTitleEl) {
        ticketTitleEl.textContent = "Niciun tichet selectat";
      }
      return;
    }

    const isClosed = ticket.status === "closed";
    chatInputEl.disabled = isClosed;
    chatSendBtn.disabled = isClosed;
    chatInputEl.placeholder = isClosed
      ? "Acest tichet este închis. Nu mai poți trimite mesaje."
      : "Scrie un mesaj către admin...";

    if (userTicketCloseBtn) {
      userTicketCloseBtn.style.display = isClosed ? "none" : "inline-flex";
    }

    if (isClosed) {
      clearUserMode();
    }
  }

  updateUserChatState(null);

  function setUserReplyMode(msg) {
    if (!userModeBar) return;
    userMode.type = "reply";
    userMode.messageId = msg.id;
    userMode.previewText = (msg.text || "").slice(0, 80);
    userMode.sender = msg.sender || "User";
    const textEl = userModeBar.querySelector(".chat-mode-text");
    textEl.textContent = `Răspunzi lui ${userMode.sender}: "${userMode.previewText}"`;
    userModeBar.style.display = "flex";
    chatInputEl.focus();
  }

  /* ===== Drawer cu lista de tichete ===== */

  function openTicketsDrawer() {
    if (!ticketsTabEl) return;
    ticketsTabEl.classList.add("tickets-drawer-open");
  }

  function closeTicketsDrawer() {
    if (!ticketsTabEl) return;
    ticketsTabEl.classList.remove("tickets-drawer-open");
  }

  function toggleTicketsDrawer() {
    if (!ticketsTabEl) return;
    if (ticketsTabEl.classList.contains("tickets-drawer-open")) {
      ticketsTabEl.classList.remove("tickets-drawer-open");
    } else {
      ticketsTabEl.classList.add("tickets-drawer-open");
    }
  }

  /* ===== API simplu pentru user ===== */

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
    // dacă vrei să vezi mereu linia, poți scoate "display:none" din CSS
  }

  /* ===== SHOP – categorii + produse ===== */

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
        right.className = "product-right";

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

  /* ===== PANEL PRODUS – popup overlay ===== */

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

    productPanelEl.style.display = "flex";
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
      renderTicketsListUser();
      selectTicketUser(newTicket.id);

      panelStatusEl.className = "status-bar status-ok";
      panelStatusEl.textContent = `Comandă trimisă, tichet #${newTicket.id} creat.`;

      showTicketsTab();
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

  /* ===== Tickets list user ===== */

  function getTicketLastMessageUser(t) {
    const msgs = t.messages || [];
    if (msgs.length === 0) return "";
    const last = msgs[msgs.length - 1];
    if (!last) return "";
    if (last.deleted) return "Mesaj șters";
    return last.text || "";
  }

  function renderTicketsListUser() {
    chatListEl.innerHTML = "";
    if (!CURRENT_TICKETS || CURRENT_TICKETS.length === 0) {
      chatListEl.innerHTML =
        '<div style="padding:8px;font-size:12px;color:var(--muted);">Nu ai tichete încă. Când cumperi un produs se creează automat unul.</div>';
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

      const headerRow = document.createElement("div");
      headerRow.className = "chat-item-header-row";

      const title = document.createElement("div");
      title.className = "chat-item-title";
      title.textContent = t.product_name || "Produs";

      const rightWrap = document.createElement("div");
      rightWrap.style.display = "flex";
      rightWrap.style.alignItems = "center";
      rightWrap.style.gap = "4px";

      const statusText = t.status === "open" ? "DESCHIS" : "ÎNCHIS";
      const statusChip = document.createElement("span");
      statusChip.className =
        "ticket-status-pill " + (t.status === "open" ? "open" : "closed");
      statusChip.textContent = statusText;
      rightWrap.appendChild(statusChip);

      const unreadCount = getUnreadCountUser(t);
      if (unreadCount > 0 && t.status === "open") {
        const badge = document.createElement("span");
        badge.className = "unread-badge";
        badge.textContent = unreadCount > 99 ? "99+" : String(unreadCount);
        rightWrap.appendChild(badge);
      }

      headerRow.appendChild(title);
      headerRow.appendChild(rightWrap);

      const lastMsg = getTicketLastMessageUser(t);
      const line = document.createElement("div");
      line.className = "chat-item-line";
      line.textContent = lastMsg || "Fără mesaje încă.";

      item.appendChild(headerRow);
      item.appendChild(line);

      item.addEventListener("click", async () => {
        selectTicketUser(t.id);
        bumpUserActive();
        closeTicketsDrawer();
        const snap = await pollTicketsUserCore();
        userTicketsPoller.bumpFast();
        return snap;
      });

      chatListEl.appendChild(item);
    });
  }

  function selectTicketUser(ticketId) {
    SELECTED_TICKET_ID = ticketId;

    const t = CURRENT_TICKETS.find((x) => x.id === ticketId);
    if (t) {
      markTicketReadUser(t);
    }

    renderTicketsListUser();

    if (!t) {
      chatMessagesEl.innerHTML = "";
      updateUserChatState(null);
      return;
    }

    const uname =
      t.username ||
      (CURRENT_USER &&
        (CURRENT_USER.username || `ID ${CURRENT_USER.id}`)) ||
      t.user_id ||
      "User";

    if (ticketTitleEl) {
      ticketTitleEl.textContent = `${uname} - ${t.product_name || "Produs"}`;
    }

    renderUserMessages(t);
    updateUserChatState(t);
  }

  function renderUserMessages(ticket) {
    renderDiscordMessages(ticket.messages || [], {
      container: chatMessagesEl,
      ticket,
      canReply: ticket.status === "open",
      onReply: (msg) => {
        if (ticket.status === "open") setUserReplyMode(msg);
      },
      onJumpTo: (messageId) =>
        scrollToMessageElement(chatMessagesEl, messageId),
    });
  }

  /* ===== Trimitere mesaje user ===== */

  async function sendChatMessage() {
    const text = chatInputEl.value.trim();
    if (!text || !SELECTED_TICKET_ID) return;

    const t = CURRENT_TICKETS.find((x) => x.id === SELECTED_TICKET_ID);
    if (!t || t.status === "closed") {
      updateUserChatState(t || null);
      return;
    }

    const reply_to =
      userMode.type === "reply" && userMode.messageId
        ? userMode.messageId
        : null;

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
          const updatedTicket = CURRENT_TICKETS.find(
            (x) => x.id === SELECTED_TICKET_ID
          );
          updateUserChatState(updatedTicket || null);
        }
        return;
      }

      const updated = res.ticket;
      const idx = CURRENT_TICKETS.findIndex((t) => t.id === updated.id);
      if (idx >= 0) {
        CURRENT_TICKETS[idx] = updated;
      } else {
        CURRENT_TICKETS.push(updated);
      }

      renderTicketsListUser();
      selectTicketUser(updated.id);

      bumpUserActive();

      const snap = await pollTicketsUserCore();
      userTicketsPoller.bumpFast();
      return snap;
    } catch (err) {
      console.error("user_send_message error:", err);
    }
  }

  async function userCloseCurrentTicket() {
    if (!SELECTED_TICKET_ID) return;
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
      if (idx >= 0) {
        CURRENT_TICKETS[idx] = updated;
      } else {
        CURRENT_TICKETS.push(updated);
      }

      renderTicketsListUser();
      selectTicketUser(updated.id);
      bumpUserActive();

      const snap = await pollTicketsUserCore();
      userTicketsPoller.bumpFast();
      return snap;
    } catch (err) {
      console.error("user_close_ticket error:", err);
    }
  }

  chatSendBtn?.addEventListener("click", sendChatMessage);
  chatInputEl?.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendChatMessage();
    }
  });

  ticketsMenuToggle?.addEventListener("click", () => {
    toggleTicketsDrawer();
    bumpUserActive();
  });

  ticketsBackdrop?.addEventListener("click", () => {
    closeTicketsDrawer();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      closeTicketsDrawer();
      closeProductPanel();
    }
  });

  userTicketCloseBtn?.addEventListener("click", () => {
    if (!SELECTED_TICKET_ID) return;
    if (!confirm("Sigur vrei să închizi acest tichet?")) return;
    userCloseCurrentTicket();
  });

  /* ===== Polling tichete user ===== */

  async function pollTicketsUserCore() {
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

      renderTicketsListUser();

      if (SELECTED_TICKET_ID) {
        const t = CURRENT_TICKETS.find((x) => x.id === SELECTED_TICKET_ID);
        if (t) {
          selectTicketUser(t.id);
        } else {
          SELECTED_TICKET_ID = null;
          chatMessagesEl.innerHTML = "";
          updateUserChatState(null);
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

  /* ===== INIT APP USER ===== */

  async function initApp() {
    if (!tg) {
      userLineEl.textContent =
        "Nu ești în Telegram MiniApp. Deschide link-ul prin bot.";
      userLineEl.style.display = "block";
      return;
    }

    tg.ready();
    tg.expand();

    const user = tg.initDataUnsafe?.user;
    if (!user) {
      userLineEl.textContent =
        "Telegram nu a trimis datele userului. Deschide MiniApp-ul din butonul inline al botului.";
      userLineEl.style.display = "block";
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
        userLineEl.style.display = "block";
        return;
      }

      CURRENT_USER.credits = res.user.credits;
      CURRENT_USER.username = res.user.username;

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

      renderUserHeader();
      renderShop(CURRENT_SHOP);
      renderTicketsListUser();

      // start din shop
      showShopTab();
    } catch (err) {
      console.error("init error:", err);
      userLineEl.textContent = "Eroare la inițializare (network).";
      userLineEl.style.display = "block";
    }
  }

  initApp();
}

/* ============================
   BOOTSTRAP – doar user
   ============================ */

document.addEventListener("DOMContentLoaded", () => {
  initUserApp();
});
