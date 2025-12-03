// app.js - Logică Shop & Chat
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
  const hours = String(d.getHours()).padStart(2, "0");
  const mins = String(d.getMinutes()).padStart(2, "0");
  return `${day}/${month}, ${hours}:${mins}`;
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
  const { container, ticket, canReply, onReply, onJumpTo } = options;

  if (!container) return;
  const wasNearBottom = isNearBottom(container);
  container.innerHTML = "";

  if(!messages || messages.length === 0) {
      container.innerHTML = `<div class="chat-placeholder"><div class="icon">💬</div><p>Începe conversația...</p></div>`;
      return;
  }

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
      strong.style.marginRight = "5px";
      preview.appendChild(strong);
      const txt = document.createElement("span");
      txt.textContent = (origin.text || "").slice(0, 50) + "...";
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
    
    // Click pe mesaj pt reply
    textEl.addEventListener("click", () => {
        if(canReply && typeof onReply === 'function') onReply(m);
    });

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
  const row = container.querySelector(`.msg-row[data-message-id="${messageId}"]`);
  if (!row) return;
  row.classList.add("msg-row--highlight");
  row.scrollIntoView({ behavior: "smooth", block: "center" });
  setTimeout(() => {
    row.classList.remove("msg-row--highlight");
  }, 1500);
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
      if (raw) USER_LAST_SEEN = JSON.parse(raw);
    } catch (e) { USER_LAST_SEEN = {}; }
  }

  function saveUserSeen() {
    try { localStorage.setItem("user_ticket_seen", JSON.stringify(USER_LAST_SEEN)); } catch (e) {}
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
      if (!m || m.deleted) continue;
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

  // Elements
  const creditsValueEl = document.getElementById("creditsValue");
  const userLineEl = document.getElementById("userLine");
  const categoriesContainer = document.getElementById("categoriesContainer");
  
  // Modal Elements
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

  // Chat Elements
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

  // Chat Input Container pentru Reply bar
  // In noul HTML clasa 'chat-input' este pe footer div
  const chatInputContainer = document.querySelector(".chat-input");
  
  let userModeBar = null;
  let userMode = { type: null, messageId: null, previewText: "", sender: "" };

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

  if (goToTicketsBtn) goToTicketsBtn.addEventListener("click", showTicketsTab);
  if (backToShopBtn) backToShopBtn.addEventListener("click", showShopTab);

  /* ===== Reply bar logic ===== */
  if (chatInputContainer && !chatInputContainer.querySelector(".chat-mode-bar")) {
    userModeBar = document.createElement("div");
    userModeBar.className = "chat-mode-bar";
    userModeBar.style.display = "none";
    
    const span = document.createElement("span");
    span.className = "chat-mode-text";
    
    const btn = document.createElement("button");
    btn.textContent = "Anulează";
    btn.addEventListener("click", () => {
      clearUserMode();
    });
    
    userModeBar.appendChild(span);
    userModeBar.appendChild(btn);
    // Adaugam bara de reply inainte de input-wrapper
    chatInputContainer.prepend(userModeBar);
  }

  function clearUserMode() {
    if (!userModeBar) return;
    userMode.type = null;
    userMode.messageId = null;
    userMode.previewText = "";
    userMode.sender = "";
    userModeBar.style.display = "none";
  }

  function setUserReplyMode(msg) {
    if (!userModeBar) return;
    userMode.type = "reply";
    userMode.messageId = msg.id;
    userMode.previewText = (msg.text || "").slice(0, 80);
    userMode.sender = msg.sender || "User";
    
    const textEl = userModeBar.querySelector(".chat-mode-text");
    textEl.textContent = `Răspunzi lui ${userMode.sender}`;
    userModeBar.style.display = "flex";
    chatInputEl.focus();
  }

  function updateUserChatState(ticket) {
    if (!chatInputEl || !chatSendBtn) return;

    if (!ticket) {
      chatInputEl.disabled = true;
      chatSendBtn.disabled = true;
      chatInputEl.placeholder = "Alege un tichet din meniu...";
      clearUserMode();
      if (userTicketCloseBtn) userTicketCloseBtn.style.display = "none";
      if (ticketTitleEl) ticketTitleEl.textContent = "Niciun tichet selectat";
      return;
    }

    const isClosed = ticket.status === "closed";
    chatInputEl.disabled = isClosed;
    chatSendBtn.disabled = isClosed;
    chatInputEl.placeholder = isClosed
      ? "Tichet închis."
      : "Scrie un mesaj...";

    if (userTicketCloseBtn) {
      userTicketCloseBtn.style.display = isClosed ? "none" : "block";
    }

    if (isClosed) clearUserMode();
  }

  updateUserChatState(null);

  /* ===== Drawer logic ===== */
  function openTicketsDrawer() {
    if (ticketsTabEl) ticketsTabEl.classList.add("tickets-drawer-open");
  }
  function closeTicketsDrawer() {
    if (ticketsTabEl) ticketsTabEl.classList.remove("tickets-drawer-open");
  }
  function toggleTicketsDrawer() {
    if (ticketsTabEl) {
        if(ticketsTabEl.classList.contains("tickets-drawer-open")) closeTicketsDrawer();
        else openTicketsDrawer();
    }
  }

  /* ===== API ===== */
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
    const name = CURRENT_USER.username 
        ? "@" + CURRENT_USER.username 
        : `ID ${CURRENT_USER.id}`;
    userLineEl.innerHTML = `Utilizator: <b>${name}</b>`;
  }

  /* ===== SHOP RENDER ===== */
  function renderShop(shop) {
    categoriesContainer.innerHTML = "";
    if (!shop || !shop.categories) return;

    shop.categories.forEach((cat) => {
      const catDiv = document.createElement("div");
      catDiv.className = "category";

      const header = document.createElement("div");
      header.className = "category-header";
      header.innerHTML = `
        <div class="category-name">${cat.name}</div>
        <div class="category-pill">categorie</div>
      `;

      const desc = document.createElement("div");
      desc.className = "category-desc";
      desc.textContent = cat.description || "";

      const productsDiv = document.createElement("div");
      productsDiv.className = "products";

      (cat.products || []).forEach((prod) => {
        const prodDiv = document.createElement("div");
        prodDiv.className = "product";
        
        prodDiv.innerHTML = `
            <div class="product-main">
                <div class="product-name">${prod.name}</div>
                <div class="product-desc">${prod.description || ""}</div>
            </div>
            <div class="product-right">
                <div class="product-price">${prod.price} CRD</div>
                <button class="product-btn">DETALII</button>
            </div>
        `;
        prodDiv.onclick = () => openProductPanel(prod);
        productsDiv.appendChild(prodDiv);
      });

      catDiv.appendChild(header);
      if(cat.description) catDiv.appendChild(desc);
      catDiv.appendChild(productsDiv);

      categoriesContainer.appendChild(catDiv);
    });
  }

  /* ===== MODAL PRODUS ===== */
  function openProductPanel(prod) {
    SELECTED_PRODUCT = prod;
    panelStatusEl.textContent = "";
    panelStatusEl.className = "status-message";

    panelNameEl.textContent = prod.name;
    panelDescEl.textContent = prod.description || "";
    panelPriceEl.textContent = `${prod.price} CRD`;

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

    panelStatusEl.textContent = "Se procesează...";
    panelStatusEl.className = "status-message";

    try {
      const res = await apiCall("buy_product", {
        product_id: prod.id,
        qty: qty,
      });

      if (!res.ok) {
        panelStatusEl.className = "status-message status-error";
        if (res.error === "not_enough_credits") {
            panelStatusEl.textContent = `Fonduri insuficiente. (Ai ${res.have})`;
        } else {
            panelStatusEl.textContent = "Eroare: " + (res.error || "necunoscută");
        }
        return;
      }

      CURRENT_USER.credits = res.new_balance;
      creditsValueEl.textContent = CURRENT_USER.credits;

      const newTicket = res.ticket;
      CURRENT_TICKETS.push(newTicket);
      renderTicketsListUser();
      selectTicketUser(newTicket.id);

      panelStatusEl.className = "status-message status-ok";
      panelStatusEl.textContent = "Succes! Tichet deschis.";
      
      setTimeout(() => {
          closeProductPanel();
          showTicketsTab();
      }, 1000);

      bumpUserActive();
      userTicketsPoller.bumpFast();
    } catch (err) {
      panelStatusEl.className = "status-message status-error";
      panelStatusEl.textContent = "Eroare rețea.";
    }
  }

  if(panelCloseBtn) panelCloseBtn.onclick = closeProductPanel;
  if(panelBuyBtn) panelBuyBtn.onclick = buySelectedProduct;

  /* ===== TICKET LIST ===== */
  function renderTicketsListUser() {
    chatListEl.innerHTML = "";
    if (!CURRENT_TICKETS || CURRENT_TICKETS.length === 0) {
      chatListEl.innerHTML = '<div style="padding:20px; text-align:center; color:#555;">Nu ai tichete.</div>';
      return;
    }

    // Sortare: Open first, then ID desc
    CURRENT_TICKETS.sort((a, b) => {
      if (a.status !== b.status) return a.status === "open" ? -1 : 1;
      return (b.id || 0) - (a.id || 0);
    });

    CURRENT_TICKETS.forEach((t) => {
      const item = document.createElement("div");
      item.className = "chat-item";
      if (t.id === SELECTED_TICKET_ID) item.classList.add("active");

      const msgs = t.messages || [];
      const lastMsg = msgs.length ? msgs[msgs.length - 1].text : "Tichet nou";
      const unreadCount = getUnreadCountUser(t);
      
      let badgeHtml = "";
      if(unreadCount > 0 && t.status === "open") {
          badgeHtml = `<span class="unread-badge">${unreadCount}</span>`;
      }
      
      const statusClass = t.status === "open" ? "open" : "closed";
      const statusText = t.status === "open" ? "Open" : "Closed";

      item.innerHTML = `
        <div class="chat-item-header-row">
            <div class="chat-item-title">${t.product_name || "Comandă"}</div>
            <div style="display:flex;align-items:center;">
                ${badgeHtml}
                <span class="ticket-status-pill ${statusClass}">${statusText}</span>
            </div>
        </div>
        <div class="chat-item-line">${lastMsg}</div>
      `;

      item.onclick = async () => {
        selectTicketUser(t.id);
        bumpUserActive();
        closeTicketsDrawer();
        userTicketsPoller.bumpFast();
      };

      chatListEl.appendChild(item);
    });
  }

  function selectTicketUser(ticketId) {
    SELECTED_TICKET_ID = ticketId;
    const t = CURRENT_TICKETS.find((x) => x.id === ticketId);
    if (t) markTicketReadUser(t);

    renderTicketsListUser(); // pt refresh active class

    if (!t) {
      chatMessagesEl.innerHTML = "";
      updateUserChatState(null);
      return;
    }

    const uname = t.user_id; 
    if (ticketTitleEl) {
      ticketTitleEl.textContent = `${t.product_name || "Tichet"} #${t.id}`;
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
      onJumpTo: (messageId) => scrollToMessageElement(chatMessagesEl, messageId),
    });
  }

  /* ===== SEND MSG ===== */
  async function sendChatMessage() {
    const text = chatInputEl.value.trim();
    if (!text || !SELECTED_TICKET_ID) return;

    const t = CURRENT_TICKETS.find((x) => x.id === SELECTED_TICKET_ID);
    if (!t || t.status === "closed") return;

    const reply_to = (userMode.type === "reply" && userMode.messageId) ? userMode.messageId : null;
    chatInputEl.value = "";
    clearUserMode();

    try {
      const res = await apiCall("user_send_message", {
        ticket_id: SELECTED_TICKET_ID,
        text,
        reply_to,
      });

      if (!res.ok && res.error === "ticket_closed") {
          updateUserChatState(CURRENT_TICKETS.find(x => x.id === SELECTED_TICKET_ID));
          return;
      }

      if(res.ticket) {
          const idx = CURRENT_TICKETS.findIndex(x => x.id === res.ticket.id);
          if(idx >= 0) CURRENT_TICKETS[idx] = res.ticket;
          else CURRENT_TICKETS.push(res.ticket);
          
          selectTicketUser(res.ticket.id);
      }
      
      bumpUserActive();
      userTicketsPoller.bumpFast();
    } catch (err) { console.error(err); }
  }
  
  async function userCloseCurrentTicket() {
    if (!SELECTED_TICKET_ID) return;
    try {
      const res = await apiCall("user_close_ticket", { ticket_id: SELECTED_TICKET_ID });
      if (res.ok && res.ticket) {
         const idx = CURRENT_TICKETS.findIndex(x => x.id === res.ticket.id);
         if(idx >= 0) CURRENT_TICKETS[idx] = res.ticket;
         selectTicketUser(res.ticket.id);
      }
      bumpUserActive();
      userTicketsPoller.bumpFast();
    } catch (e) { console.error(e); }
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
  ticketsBackdrop?.addEventListener("click", closeTicketsDrawer);

  userTicketCloseBtn?.addEventListener("click", () => {
    if(confirm("Închizi tichetul?")) userCloseCurrentTicket();
  });

  /* ===== POLL ===== */
  async function pollTicketsUserCore() {
    if (!CURRENT_USER) return CURRENT_TICKETS;
    try {
      const res = await apiCall("user_get_tickets", {});
      if (res.ok) {
          CURRENT_TICKETS = res.tickets || [];
          
          // update last seen locally if new msgs
          CURRENT_TICKETS.forEach(t => {
             // logic de last seen doar cand userul deschide
          });
          
          renderTicketsListUser();
          
          if (SELECTED_TICKET_ID) {
              const t = CURRENT_TICKETS.find(x => x.id === SELECTED_TICKET_ID);
              if(t) selectTicketUser(t.id);
          }
      }
    } catch(e){}
    return CURRENT_TICKETS;
  }

  const userTicketsPoller = createSmartPoll(
    pollTicketsUserCore,
    () => {
      if (!isTicketsTabActive()) return false;
      const now = Date.now();
      if (now > userActiveUntil) return false;
      return true;
    }
  );

  /* ===== INIT ===== */
  async function initApp() {
    if (!tg) {
      userLineEl.innerHTML = "Deschide din Telegram.";
      userLineEl.style.display = "block";
      return;
    }
    tg.ready(); tg.expand();
    const user = tg.initDataUnsafe?.user;
    if (!user) {
        // Fallback testing
        // CURRENT_USER = { id: 999, username: "TestUser", credits: 0 };
        userLineEl.innerHTML = "Lipsă date user Telegram.";
        userLineEl.style.display = "block";
        return;
    } else {
        CURRENT_USER = { id: user.id, username: user.username, credits: 0 };
    }

    try {
      const res = await apiCall("init", {});
      if (!res.ok) throw new Error("Init failed");

      CURRENT_USER.credits = res.user.credits;
      CURRENT_SHOP = res.shop;
      CURRENT_TICKETS = res.tickets || [];
      
      renderUserHeader();
      renderShop(CURRENT_SHOP);
      renderTicketsListUser();
      
      showShopTab();
    } catch (err) {
      userLineEl.innerHTML = "Eroare conectare server.";
      userLineEl.style.display = "block";
    }
  }

  initApp();
}

document.addEventListener("DOMContentLoaded", initUserApp);
