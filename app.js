// app.js – Versiune Finală User (Cu Pop-up Confirmare Custom)

const API_URL = "https://api.redgen.vip/";

/* ============================
   1. HELPER – SMART POLLING
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
    if (!isEnabledFn || !isEnabledFn()) { schedule(maxInterval); return; }

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
    start() { if (active) return; active = true; idleCount = 0; currentInterval = minInterval; tick(); },
    stop() { active = false; if (timeoutId) clearTimeout(timeoutId); timeoutId = null; },
    bumpFast() { if (!active) return; idleCount = 0; currentInterval = minInterval; schedule(currentInterval); },
  };
}

/* ============================
   2. UTILITARE
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

function timeAgo(ts) {
    if (!ts) return "";
    const now = new Date();
    const then = new Date(ts);
    const diff = Math.floor((now - then) / 1000); 

    if (diff < 60) return "acum";
    const min = Math.floor(diff / 60);
    if (min < 60) return `${min}m`;
    const h = Math.floor(min / 60);
    if (h < 24) return `${h}h`;
    const d = Math.floor(h / 24);
    return `${d}z`;
}

function isNearBottom(container, thresholdPx = 150) {
  if (!container) return true;
  const { scrollTop, scrollHeight, clientHeight } = container;
  return scrollHeight - (scrollTop + clientHeight) < thresholdPx;
}

function smartScrollToBottom(container, force = false) {
  if (!container) return;
  if (force || isNearBottom(container)) {
    requestAnimationFrame(() => { container.scrollTop = container.scrollHeight; });
  }
}

/* ============================
   3. RENDER MESAJE
   ============================ */
function renderDiscordMessages(messages, options) {
  const { container, ticket, canReply, onReply, onJumpTo, seenConfig } = options;

  if (!container) return;
  const wasNearBottom = isNearBottom(container);

  if (!messages || messages.length === 0) {
      if (!container.querySelector('.chat-placeholder')) {
         container.innerHTML = `
            <div class="chat-placeholder">
                <div class="icon">💬</div>
                <p>Începe conversația...</p>
            </div>`;
      }
      return;
  }
  
  const placeholder = container.querySelector('.chat-placeholder');
  if (placeholder) placeholder.remove();

  const msgById = {};
  messages.forEach((m) => { if (m && m.id) msgById[m.id] = m; });
  const processedIds = new Set();

  messages.forEach((m) => {
    if (!m) return;
    processedIds.add(String(m.id));

    let row = container.querySelector(`.msg-row[data-message-id="${m.id}"]`);

    let replyHtml = '';
    if (m.reply_to && msgById[m.reply_to]) {
        const origin = msgById[m.reply_to];
        replyHtml = `
            <div class="msg-reply-preview" data-jump-id="${origin.id}">
                <strong style="margin-right:5px;">${origin.sender || "User"}</strong>
                <span>${(origin.text || "").slice(0, 50)}...</span>
            </div>
        `;
    }

    const senderName = m.sender || (m.from === "system" ? "System" : "User");
    const initial = (senderName || "?").slice(0, 1).toUpperCase();
    const adminClass = m.from === "admin" ? "msg-username--admin" : "";
    
    let textClass = "msg-text";
    let textContent = m.text;
    if (m.deleted) {
        textClass += " msg-text--deleted";
        textContent = "Mesaj șters";
    }

    let actionButtons = "";
    if (canReply && !m.deleted) {
        actionButtons = `<button class="btn-reply-mini" title="Răspunde">↩ Reply</button>`;
    }

    const innerHTML = `
        <div class="msg-avatar">${initial}</div>
        <div class="msg-content">
            <div class="msg-header-line">
                <div class="msg-meta-group">
                    <span class="msg-username ${adminClass}">${senderName}</span>
                    <span class="msg-timestamp">${formatTimestamp(m.ts)}</span>
                </div>
                ${actionButtons}
            </div>
            <div class="msg-bubble">
                ${replyHtml}
                <div class="${textClass}">${textContent}</div>
            </div>
        </div>
    `;

    if (!row) {
        row = document.createElement("div");
        row.className = "msg-row";
        row.dataset.messageId = m.id;
        row.innerHTML = innerHTML;
        attachMessageEvents(row, m, onReply, onJumpTo);
        container.appendChild(row);
    } else {
        if (!row.innerHTML.includes(textContent)) { 
            row.innerHTML = innerHTML; 
            attachMessageEvents(row, m, onReply, onJumpTo);
        }
    }

    // Seen Footer
    const existingSeen = row.querySelector('.seen-footer');
    if (existingSeen) existingSeen.remove();

    if (seenConfig && m.id === seenConfig.targetId) {
        const seenDiv = document.createElement("div");
        seenDiv.className = "seen-footer";
        seenDiv.textContent = seenConfig.text;
        row.querySelector(".msg-content").appendChild(seenDiv);
    }
  });

  Array.from(container.children).forEach(child => {
      const id = child.dataset.messageId;
      if (id && !processedIds.has(id)) child.remove();
  });

  smartScrollToBottom(container, wasNearBottom);
}

function attachMessageEvents(rowElement, messageData, onReply, onJumpTo) {
    const replyBtn = rowElement.querySelector('.btn-reply-mini');
    if (replyBtn) {
        replyBtn.onclick = (e) => {
            e.stopPropagation();
            if (typeof onReply === 'function') onReply(messageData);
        };
    }
    const preview = rowElement.querySelector('.msg-reply-preview');
    if (preview) {
        preview.onclick = (e) => {
            e.stopPropagation();
            const targetId = preview.dataset.jumpId;
            if (targetId && typeof onJumpTo === 'function') onJumpTo(targetId);
        };
    }
}

function scrollToMessageElement(container, messageId) {
  if (!container) return;
  const row = container.querySelector(`.msg-row[data-message-id="${messageId}"]`);
  if (!row) return;
  row.classList.add("msg-row--highlight");
  row.scrollIntoView({ behavior: "smooth", block: "center" });
  setTimeout(() => { row.classList.remove("msg-row--highlight"); }, 1200);
}

/* ============================
   4. LOGICA PRINCIPALĂ (INIT USER APP)
   ============================ */

function initUserApp() {
  const tg = window.Telegram?.WebApp;

  let CURRENT_USER = null;
  let CURRENT_SHOP = null;
  let CURRENT_TICKETS = [];
  let SELECTED_TICKET_ID = null;

  let userActiveUntil = 0;
  function bumpUserActive(extraMs = 25000) {
    userActiveUntil = Math.max(userActiveUntil, Date.now() + extraMs);
  }

  // DOM Elements
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
  const chatInputContainer = document.querySelector(".chat-input");
  
  // -- NEW CONFIRMATION MODAL ELEMENTS --
  const confirmModal = document.getElementById("confirmActionModal");
  const confirmOkBtn = document.getElementById("confirmOkBtn");
  const confirmCancelBtn = document.getElementById("confirmCancelBtn");
  
  let userModeBar = null;
  let userMode = { type: null, messageId: null, previewText: "", sender: "" };

  /* ===== Navigare ===== */
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

  if (chatInputContainer && !chatInputContainer.querySelector(".chat-mode-bar")) {
    userModeBar = document.createElement("div");
    userModeBar.className = "chat-mode-bar";
    userModeBar.style.display = "none";
    const span = document.createElement("span");
    span.className = "chat-mode-text";
    const btn = document.createElement("button");
    btn.textContent = "Anulează";
    btn.addEventListener("click", clearUserMode);
    userModeBar.appendChild(span);
    userModeBar.appendChild(btn);
    chatInputContainer.prepend(userModeBar);
  }

  function clearUserMode() {
    if (!userModeBar) return;
    userMode = { type: null, messageId: null, previewText: "", sender: "" };
    userModeBar.style.display = "none";
  }

  function setUserReplyMode(msg) {
    if (!userModeBar) return;
    userMode.type = "reply";
    userMode.messageId = msg.id;
    userMode.previewText = (msg.text || "").slice(0, 50);
    userMode.sender = msg.sender || "User";
    const textEl = userModeBar.querySelector(".chat-mode-text");
    textEl.textContent = `Răspunzi lui ${userMode.sender}: "${userMode.previewText}..."`;
    userModeBar.style.display = "flex";
    chatInputEl.focus();
  }

  function updateUserChatState(ticket) {
    if (!chatInputEl || !chatSendBtn) return;
    if (!ticket) {
      chatInputEl.disabled = true; chatSendBtn.disabled = true;
      chatInputEl.placeholder = "Alege un tichet din meniu...";
      clearUserMode();
      if (userTicketCloseBtn) userTicketCloseBtn.style.display = "none";
      if (ticketTitleEl) ticketTitleEl.textContent = "Niciun tichet selectat";
      return;
    }
    const isClosed = ticket.status === "closed";
    chatInputEl.disabled = isClosed; chatSendBtn.disabled = isClosed;
    chatInputEl.placeholder = isClosed ? "Tichet închis." : "Scrie un mesaj...";
    if (userTicketCloseBtn) userTicketCloseBtn.style.display = isClosed ? "none" : "block";
    if (isClosed) clearUserMode();
  }
  updateUserChatState(null);

  function openTicketsDrawer() { if (ticketsTabEl) ticketsTabEl.classList.add("tickets-drawer-open"); }
  function closeTicketsDrawer() { if (ticketsTabEl) ticketsTabEl.classList.remove("tickets-drawer-open"); }
  function toggleTicketsDrawer() { if (ticketsTabEl) ticketsTabEl.classList.toggle("tickets-drawer-open"); }

  /* ===== API Call ===== */
  function apiCall(action, extraPayload = {}) {
    const payload = { action, user: CURRENT_USER, ...extraPayload };
    return fetch(API_URL, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }).then(async (r) => {
        if (!r.ok) {
            const txt = await r.text();
            throw new Error(`Server Error: ${r.status} - ${txt}`);
        }
        return r.json();
    });
  }

  function isTicketsTabActive() {
    const tab = document.getElementById("ticketsTab");
    return tab && tab.classList.contains("active");
  }

  function renderUserHeader() {
    if (!CURRENT_USER) return;
    creditsValueEl.textContent = CURRENT_USER.credits;
    const name = CURRENT_USER.username ? "@" + CURRENT_USER.username : `ID ${CURRENT_USER.id}`;
    userLineEl.innerHTML = `Utilizator: <b>${name}</b>`;
  }

  /* ===== SHOP Rendering ===== */
  function renderShop(shop) {
    categoriesContainer.innerHTML = "";
    if (!shop || !shop.categories) return;
    shop.categories.forEach((cat) => {
      const catDiv = document.createElement("div"); catDiv.className = "category";
      catDiv.innerHTML = `
        <div class="category-header">
            <div class="category-name">${cat.name}</div>
            <div class="category-pill">cat</div>
        </div>
        ${cat.description ? `<div class="category-desc">${cat.description}</div>` : ""}
        <div class="products"></div>
      `;
      const productsDiv = catDiv.querySelector(".products");
      (cat.products || []).forEach((prod) => {
        const prodDiv = document.createElement("div"); prodDiv.className = "product";
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
      categoriesContainer.appendChild(catDiv);
    });
  }

  /* ===== Modal Logic ===== */
  function openProductPanel(prod) {
    SELECTED_PRODUCT = prod;
    panelStatusEl.textContent = ""; panelStatusEl.className = "status-message";
    panelNameEl.textContent = prod.name;
    panelDescEl.textContent = prod.description || "";
    panelPriceEl.textContent = `${prod.price} CRD`;
    const min = prod.min_qty || 1; const max = prod.max_qty || min;
    panelQtyEl.min = min; panelQtyEl.max = max; panelQtyEl.value = min;
    panelQtyRangeEl.textContent = `(min ${min}, max ${max})`;
    productPanelEl.style.display = "flex";
  }
  function closeProductPanel() { SELECTED_PRODUCT = null; productPanelEl.style.display = "none"; }
  if (productPanelEl) productPanelEl.addEventListener("click", (e) => { if (e.target === productPanelEl) closeProductPanel(); });

  async function buySelectedProduct() {
    if (!SELECTED_PRODUCT || !CURRENT_USER) return;
    const qty = Number(panelQtyEl.value || 0);
    const prod = SELECTED_PRODUCT;
    panelStatusEl.textContent = "Se procesează..."; panelStatusEl.className = "status-message";
    try {
      const res = await apiCall("buy_product", { product_id: prod.id, qty: qty });
      if (!res.ok) {
        panelStatusEl.className = "status-message status-error";
        if (res.error === "not_enough_credits") panelStatusEl.textContent = `Fonduri insuficiente.`;
        else panelStatusEl.textContent = "Eroare: " + (res.error || "necunoscută");
        return;
      }
      CURRENT_USER.credits = res.new_balance; creditsValueEl.textContent = CURRENT_USER.credits;
      const newTicket = res.ticket;
      CURRENT_TICKETS.push(newTicket);
      renderTicketsListUser(); selectTicketUser(newTicket.id);
      panelStatusEl.className = "status-message status-ok"; panelStatusEl.textContent = `Succes! Tichet #${newTicket.id} creat.`;
      setTimeout(() => { closeProductPanel(); showTicketsTab(); }, 1000);
      bumpUserActive(); userTicketsPoller.bumpFast();
    } catch (err) {
      console.error(err); panelStatusEl.className = "status-message status-error"; panelStatusEl.textContent = "Eroare rețea.";
    }
  }
  if(panelCloseBtn) panelCloseBtn.onclick = closeProductPanel;
  if(panelBuyBtn) panelBuyBtn.onclick = buySelectedProduct;

  /* ===== Ticket List ===== */
  function renderTicketsListUser() {
    if (!CURRENT_TICKETS || CURRENT_TICKETS.length === 0) {
      if (!chatListEl.querySelector('.no-tickets-msg')) {
         chatListEl.innerHTML = '<div class="no-tickets-msg" style="padding:20px; text-align:center; color:#555;">Nu ai tichete.</div>';
      }
      return;
    }
    const noMsg = chatListEl.querySelector('.no-tickets-msg');
    if (noMsg) noMsg.remove();

    CURRENT_TICKETS.sort((a, b) => {
      if (a.status !== b.status) return a.status === "open" ? -1 : 1;
      return (b.id || 0) - (a.id || 0);
    });

    const processedIds = new Set();
    CURRENT_TICKETS.forEach((t) => {
      processedIds.add(String(t.id));
      let item = chatListEl.querySelector(`.chat-item[data-ticket-id="${t.id}"]`);
      const msgs = t.messages || [];
      const lastMsg = msgs.length ? msgs[msgs.length - 1].text : "Tichet nou";
      
      const isSelected = (t.id === SELECTED_TICKET_ID);
      
      let unreadCount = calculateUserUnread(t);
      if (isSelected) unreadCount = 0;

      const badgeHtml = (unreadCount > 0 && t.status === "open") ? `<span class="unread-badge">${unreadCount}</span>` : "";
      const statusClass = t.status === "open" ? "open" : "closed";
      const statusText = t.status === "open" ? "Open" : "Closed";

      const innerHTML = `
        <div class="chat-item-header-row">
            <div class="chat-item-title">${t.product_name || "Comandă"}</div>
            <div style="display:flex;align-items:center;">
                ${badgeHtml}<span class="ticket-status-pill ${statusClass}">${statusText}</span>
            </div>
        </div>
        <div class="chat-item-line">${lastMsg}</div>
      `;

      if (!item) {
        item = document.createElement("div"); item.className = "chat-item";
        item.setAttribute("data-ticket-id", t.id);
        item.onclick = () => { selectTicketUser(t.id); bumpUserActive(); closeTicketsDrawer(); userTicketsPoller.bumpFast(); };
        item.innerHTML = innerHTML; chatListEl.appendChild(item);
      } else {
        if (item.innerHTML !== innerHTML) item.innerHTML = innerHTML;
      }
      if (isSelected) item.classList.add("active");
      else item.classList.remove("active");
      chatListEl.appendChild(item);
    });
    Array.from(chatListEl.children).forEach(child => {
        const id = child.getAttribute("data-ticket-id");
        if (id && !processedIds.has(id)) child.remove();
    });
  }

  function calculateUserUnread(ticket) {
      if(!ticket.messages) return 0;
      const lastRead = ticket.last_read_user || "";
      let count = 0;
      let start = (lastRead === "") ? true : false;
      for (let m of ticket.messages) {
          if (m.id === lastRead) { start = true; continue; }
          if (start && m.from === 'admin') count++; 
      }
      if (!lastRead) return ticket.messages.filter(m => m.from === 'admin').length;
      return count;
  }

  function selectTicketUser(ticketId) {
    SELECTED_TICKET_ID = ticketId;
    const t = CURRENT_TICKETS.find((x) => x.id === ticketId);
    
    // Trigger Mark Seen
    if (t) {
        apiCall("mark_seen", { ticket_id: ticketId });
        if(t.messages.length) t.last_read_user = t.messages[t.messages.length - 1].id;
    }

    renderTicketsListUser();
    if (!t) { chatMessagesEl.innerHTML = ""; updateUserChatState(null); return; }
    if (ticketTitleEl) ticketTitleEl.textContent = `${t.product_name || "Tichet"} #${t.id}`;
    renderUserMessages(t); updateUserChatState(t);
  }

  function renderUserMessages(ticket) {
    let lastUserMsgId = null;
    if (ticket.messages) {
        for (let i = ticket.messages.length - 1; i >= 0; i--) {
            const m = ticket.messages[i];
            if (m.from === 'user' && !m.deleted) {
                lastUserMsgId = m.id;
                break;
            }
        }
    }

    let seenConfig = null;
    if (lastUserMsgId && ticket.last_read_admin) {
        const idxUserMsg = ticket.messages.findIndex(m => m.id === lastUserMsgId);
        const idxAdminRead = ticket.messages.findIndex(m => m.id === ticket.last_read_admin);

        if (idxAdminRead >= idxUserMsg) {
             const timeString = timeAgo(ticket.last_read_admin_at);
             seenConfig = {
                 targetId: lastUserMsgId,
                 text: `Văzut ${timeString}`
             };
        }
    }

    renderDiscordMessages(ticket.messages || [], {
      container: chatMessagesEl, 
      ticket, 
      canReply: ticket.status === "open",
      onReply: (msg) => { if (ticket.status === "open") setUserReplyMode(msg); },
      onJumpTo: (mid) => scrollToMessageElement(chatMessagesEl, mid),
      seenConfig: seenConfig 
    });
  }

  async function sendChatMessage() {
    const text = chatInputEl.value.trim();
    if (!text || !SELECTED_TICKET_ID) return;
    const t = CURRENT_TICKETS.find((x) => x.id === SELECTED_TICKET_ID);
    if (!t || t.status === "closed") return;
    const reply_to = (userMode.type === "reply" && userMode.messageId) ? userMode.messageId : null;
    chatInputEl.value = ""; clearUserMode();
    try {
      const res = await apiCall("user_send_message", { ticket_id: SELECTED_TICKET_ID, text, reply_to });
      if (!res.ok && res.error === "ticket_closed") {
          const updated = CURRENT_TICKETS.find(x => x.id === SELECTED_TICKET_ID);
          if(updated) updated.status = "closed";
          updateUserChatState(updated);
          return;
      }
      if(res.ticket) {
          const idx = CURRENT_TICKETS.findIndex(x => x.id === res.ticket.id);
          if (idx >= 0) CURRENT_TICKETS[idx] = res.ticket; else CURRENT_TICKETS.push(res.ticket);
          selectTicketUser(res.ticket.id);
      }
      bumpUserActive(); userTicketsPoller.bumpFast();
    } catch (err) { console.error(err); }
  }

  /* ============================
     NEW: CUSTOM POPUP LOGIC
     ============================ */
  function openConfirmModal(onConfirm) {
      if(!confirmModal) return;
      confirmModal.style.display = "flex";
      
      // Setup OK button
      confirmOkBtn.onclick = () => {
          confirmModal.style.display = "none";
          if (typeof onConfirm === "function") onConfirm();
      };

      // Setup Cancel button (and outside click)
      confirmCancelBtn.onclick = () => {
          confirmModal.style.display = "none";
      };
      
      confirmModal.onclick = (e) => {
          if(e.target === confirmModal) confirmModal.style.display = "none";
      }
  }

  function userCloseCurrentTicket() {
    if (!SELECTED_TICKET_ID) return;
    
    // Deschide Pop-up-ul Custom
    openConfirmModal(async () => {
        try {
          const res = await apiCall("user_close_ticket", { ticket_id: SELECTED_TICKET_ID });
          
          if (res.ok) {
              // 1. Găsim tichetul în lista locală
              const idx = CURRENT_TICKETS.findIndex(x => x.id === SELECTED_TICKET_ID);
              if (idx >= 0) {
                  // 2. Îl actualizăm cu ce vine de la server SAU îl forțăm local la 'closed'
                  if (res.ticket) {
                      CURRENT_TICKETS[idx] = res.ticket;
                  } else {
                      CURRENT_TICKETS[idx].status = "closed"; // Fallback sigur
                  }
                  
                  // 3. Re-selectăm tichetul actualizat pentru a refacere UI-ul (input disabled, buton ascuns)
                  selectTicketUser(CURRENT_TICKETS[idx].id);
              }
              
              // 4. Actualizăm și lista din stânga (să apară "Closed")
              renderTicketsListUser();
          }
          
          bumpUserActive(); 
          userTicketsPoller.bumpFast();
        } catch (err) { 
            console.error(err); 
            // Opțional: alert("Eroare la închidere tichet.");
        }
    });
  }

  chatSendBtn?.addEventListener("click", sendChatMessage);
  chatInputEl?.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendChatMessage(); } });
  ticketsMenuToggle?.addEventListener("click", () => { toggleTicketsDrawer(); bumpUserActive(); });
  ticketsBackdrop?.addEventListener("click", closeTicketsDrawer);
  if (userTicketCloseBtn) userTicketCloseBtn.addEventListener("click", userCloseCurrentTicket);

  async function pollTicketsUserCore() {
    if (!CURRENT_USER) return CURRENT_TICKETS;
    try {
      const res = await apiCall("user_get_tickets", {});
      if (!res.ok) return CURRENT_TICKETS;
      CURRENT_TICKETS = res.tickets || [];
      
      if (SELECTED_TICKET_ID) {
         const t = CURRENT_TICKETS.find(x => x.id === SELECTED_TICKET_ID);
         if(t) { 
             const realUnreads = calculateUserUnread(t);
             if (realUnreads > 0) {
                 apiCall("mark_seen", { ticket_id: t.id });
                 if(t.messages.length > 0) {
                     t.last_read_user = t.messages[t.messages.length - 1].id;
                 }
             }
             renderUserMessages(t); 
             updateUserChatState(t); 
         }
      }
      renderTicketsListUser();
      return CURRENT_TICKETS;
    } catch (err) { return CURRENT_TICKETS; }
  }

  const userTicketsPoller = createSmartPoll(
    pollTicketsUserCore,
    () => {
      if (!isTicketsTabActive()) return false;
      return Date.now() < userActiveUntil;
    }
  );

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      if (isTicketsTabActive()) { bumpUserActive(); userTicketsPoller.start(); }
    } else { userTicketsPoller.stop(); }
  });

  /* ===== INIT APP ===== */
  async function initApp() {
    if (!tg) { userLineEl.textContent = "Deschide din Telegram."; userLineEl.style.display = "block"; return; }
    tg.ready(); tg.expand();

    const user = tg.initDataUnsafe?.user;
    if (!user) {
       userLineEl.textContent = "Lipsă date user."; userLineEl.style.display = "block"; return;
    }
    
    CURRENT_USER = { 
        id: user.id, 
        username: user.username || null,
        first_name: user.first_name || null,
        last_name: user.last_name || null,
        credits: 0 
    };

    try {
      const res = await apiCall("init", {});
      if (!res.ok) throw new Error("Init failed");

      CURRENT_USER.credits = res.user.credits;
      CURRENT_SHOP = res.shop;
      CURRENT_TICKETS = res.tickets || [];

      renderUserHeader(); renderShop(CURRENT_SHOP); renderTicketsListUser();
      showShopTab();
    } catch (err) {
      console.error(err);
      userLineEl.textContent = `Eroare: ${err.message || "Conexiune"}`;
      userLineEl.style.display = "block";
    }
  }

  initApp();
}

document.addEventListener("DOMContentLoaded", initUserApp);
