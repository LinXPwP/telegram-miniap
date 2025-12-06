// app.js – SECURIZED: Uses Telegram initData for Auth + Anti-Spam + Smart Polling + Optimized Network Calls

// ⚠️ URL-ul către Cloudflare Worker sau Serverul tău
const API_URL = "https://api.redgen.vip/";

// GLOBAL: Urmărim ultima interacțiune a utilizatorului pentru Anti-Spam
let LAST_USER_ACTION = Date.now();
const updateActivity = () => { LAST_USER_ACTION = Date.now(); };
['mousemove', 'keydown', 'touchstart', 'scroll', 'click'].forEach(evt => 
    document.addEventListener(evt, updateActivity, { passive: true })
);

/* ============================
   1. HELPER – SUPER SMART POLLING (ECONOMY MODE)
   ============================ */
function createSmartPoll(fetchFn, isEnabledFn) {
  let timeoutId = null;
  let active = false;
  let isRunning = false;

  // Setări intervale (milisecunde)
  const INTERVAL_ACTIVE = 3000;       // 3 secunde (când lucrezi/scrii)
  const INTERVAL_IDLE = 10000;        // 10 secunde (când te uiți la ecran dar nu miști mouse-ul)
  const INTERVAL_BACKGROUND = 60000; // 60 secunde (când ești în alt tab/aplicație)
  const IDLE_THRESHOLD = 45000;       // 45 secunde până intră în modul Idle

  async function tick() {
    if (!active) return;
    
    // 1. Calculăm delay-ul bazat pe starea utilizatorului
    let nextDelay = INTERVAL_ACTIVE;

    if (document.hidden) {
        nextDelay = INTERVAL_BACKGROUND;
    } else if (Date.now() - LAST_USER_ACTION > IDLE_THRESHOLD) {
        nextDelay = INTERVAL_IDLE;
    }

    // 2. Verificăm dacă polling-ul e permis logic
    if (isEnabledFn && !isEnabledFn()) {
        schedule(INTERVAL_BACKGROUND);
        return;
    }

    try {
        isRunning = true;
        await fetchFn();
    } catch (e) {
        nextDelay = Math.max(nextDelay, 10000);
    } finally {
        isRunning = false;
        schedule(nextDelay);
    }
  }

  function schedule(delay) {
    if (!active) return;
    if (timeoutId) clearTimeout(timeoutId);
    timeoutId = setTimeout(tick, delay);
  }

  document.addEventListener("visibilitychange", () => {
      if (!document.hidden && active && !isRunning) {
          if (isEnabledFn && isEnabledFn()) {
             if (timeoutId) clearTimeout(timeoutId);
             tick();
          }
      }
  });

  return {
    start: () => { 
        if (!active) { 
            active = true; 
            updateActivity(); 
            tick(); 
        } 
    },
    stop: () => { 
        active = false; 
        if (timeoutId) clearTimeout(timeoutId); 
        timeoutId = null;
    },
    bumpFast: () => { 
        updateActivity();
        if (active) { 
            if (timeoutId) clearTimeout(timeoutId); 
            schedule(100); 
        } 
    }
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

function getImageUrl(imgStr) {
    if (!imgStr || imgStr.trim() === "") return null;
    return imgStr;
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
  
  // ============================================
  // 🔒 SECURITY CHECK: FORCE TELEGRAM ENV
  // ============================================
  // Verificăm dacă initData există. În browser extern, de obicei este string gol.
  if (!tg || !tg.initData) {
      const appWrapper = document.getElementById("mainAppWrapper");
      const errorScreen = document.getElementById("onlyTelegramError");
      
      if(appWrapper) appWrapper.style.display = "none";
      if(errorScreen) errorScreen.style.display = "flex";
      
      console.warn("Access Denied: Not in Telegram WebApp environment.");
      return; // OPRIM SCRIPUL AICI
  }

  // 🔒 InitData Valid
  const TG_INIT_DATA = tg.initData;

  let CURRENT_USER = null;
  let CURRENT_SHOP = null;
  let CURRENT_TICKETS = [];
  let SELECTED_TICKET_ID = null;
  let isSending = false; // PREVINE DUBLUL CLICK

  function bumpUserActive() {
    updateActivity();
  }

  // DOM Elements
  const creditsValueEl = document.getElementById("creditsValue");
  const userLineEl = document.getElementById("userLine");
  
  // -- NEW SHOP ELEMENTS --
  const categoriesGrid = document.getElementById("categoriesGrid");
  const productsGrid = document.getElementById("productsGrid");
  const viewCategories = document.getElementById("viewCategories");
  const viewProducts = document.getElementById("viewProducts");
  const shopBackBtn = document.getElementById("shopBackBtn");
  const headerTitle = document.getElementById("headerTitle");
  const emptyProductsMsg = document.getElementById("emptyProductsMsg");

  // -- MODAL ELEMENTS --
  const productPanelEl = document.getElementById("productPanel");
  const panelNameEl = document.getElementById("panelName");
  const panelDescEl = document.getElementById("panelDesc");
  const panelPriceEl = document.getElementById("panelPrice");
  // REMOVE QTY ELEMENTS
  // const panelQtyEl = document.getElementById("panelQty");
  // const panelQtyRangeEl = document.getElementById("panelQtyRange");
  const panelBuyBtn = document.getElementById("panelBuyBtn");
  const panelCloseBtn = document.getElementById("panelCloseBtn");
  const panelStatusEl = document.getElementById("panelStatus");
  const panelImgEl = document.getElementById("panelImg");
  const panelImgPlaceholderEl = document.getElementById("panelImgPlaceholder");

  let SELECTED_PRODUCT = null;

  // -- CHAT ELEMENTS --
  const chatListEl = document.getElementById("chatList");
  const ticketTitleEl = document.getElementById("ticketTitle");
  const chatMessagesEl = document.getElementById("chatMessages");
  const chatInputEl = document.getElementById("chatInput");
  const chatSendBtn = document.getElementById("chatSendBtn");
  
  // BUTTONS
  const userTicketCloseBtn = document.getElementById("userTicketCloseBtn");
  const userTicketReopenBtn = document.getElementById("userTicketReopenBtn");
  
  const ticketsMenuToggle = document.getElementById("ticketsMenuToggle");
  const ticketsBackdrop = document.getElementById("ticketsBackdrop");
  const shopTabEl = document.getElementById("shopTab");
  const ticketsTabEl = document.getElementById("ticketsTab");
  const shopHeaderEl = document.getElementById("shopHeader");
  const goToTicketsBtn = document.getElementById("goToTicketsBtn");
  const backToShopBtn = document.getElementById("backToShopBtn");
  const chatInputContainer = document.querySelector(".chat-input");
  
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
    
    // 1. Niciun tichet selectat
    if (!ticket) {
      chatInputEl.disabled = true; chatSendBtn.disabled = true;
      chatInputEl.placeholder = "Alege un tichet din meniu...";
      clearUserMode();
      
      // Ascunde ambele butoane
      if (userTicketCloseBtn) userTicketCloseBtn.style.display = "none";
      if (userTicketReopenBtn) userTicketReopenBtn.style.display = "none";
      
      if (ticketTitleEl) ticketTitleEl.textContent = "Niciun tichet selectat";
      return;
    }

    // 2. Tichet Selectat
    const isClosed = ticket.status === "closed";
    
    // Logică Input: Dacă e închis, nu poți scrie până nu redeschizi
    chatInputEl.disabled = isClosed; 
    chatSendBtn.disabled = isClosed;
    chatInputEl.placeholder = isClosed ? "Tichet închis. Redeschide pentru a scrie." : "Scrie un mesaj...";

    // Logică Butoane Header (Toggle între Close și Reopen)
    if (isClosed) {
        if (userTicketCloseBtn) userTicketCloseBtn.style.display = "none";
        if (userTicketReopenBtn) userTicketReopenBtn.style.display = "block";
        clearUserMode();
    } else {
        if (userTicketCloseBtn) userTicketCloseBtn.style.display = "block";
        if (userTicketReopenBtn) userTicketReopenBtn.style.display = "none";
    }
  }
  updateUserChatState(null);

  function openTicketsDrawer() { if (ticketsTabEl) ticketsTabEl.classList.add("tickets-drawer-open"); }
  function closeTicketsDrawer() { if (ticketsTabEl) ticketsTabEl.classList.remove("tickets-drawer-open"); }
  function toggleTicketsDrawer() { if (ticketsTabEl) ticketsTabEl.classList.toggle("tickets-drawer-open"); }

  /* ===== API Call (SECURIZAT) ===== */
  async function apiCall(action, extraPayload = {}) {
    // 🔒 SECURITATE: Trimitem initData în loc de user obiect
    const payload = { 
        action, 
        initData: TG_INIT_DATA, // Backend-ul va verifica asta
        ...extraPayload 
    };
    
    try {
        const r = await fetch(API_URL, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });

        // Backend-ul va returna 401 dacă initData e invalid sau lipsește
        if (r.status === 401) {
            console.error("Auth Failed");
            return { ok: false, error: "auth_failed" };
        }

        const data = await r.json();
        return data;
        
    } catch (err) {
        console.error("Network fatal:", err);
        throw new Error("Conexiune eșuată");
    }
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

  /* ============================
        NEW SHOP RENDER LOGIC
        ============================ */
  
  function renderCategoriesGrid(shop) {
    categoriesGrid.innerHTML = "";
    if (!shop || !shop.categories) return;

    shop.categories.forEach((cat) => {
        const catCard = document.createElement("div");
        catCard.className = "card-visual";
        
        const imgUrl = getImageUrl(cat.image);
        const imgHtml = imgUrl 
             ? `<img src="${imgUrl}" class="card-img" alt="${cat.name}">` 
             : `<div class="img-placeholder">📁</div>`;
        
        catCard.innerHTML = `
            <div class="card-img-container">
                ${imgHtml}
                <div class="card-overlay">
                    <div class="cat-name">${cat.name}</div>
                    <div class="cat-count">${(cat.products || []).length} produse</div>
                </div>
            </div>
        `;

        catCard.onclick = () => openCategory(cat);
        categoriesGrid.appendChild(catCard);
    });
  }

  function openCategory(category) {
      viewCategories.classList.remove("active-view");
      viewProducts.classList.add("active-view");
      
      headerTitle.style.display = "none";
      
      shopBackBtn.style.display = "flex";
      shopBackBtn.innerHTML = `
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>
        <span class="back-btn-text">${category.name}</span>
      `;
      
      renderProductsGrid(category.products || []);
  }

  function renderProductsGrid(products) {
      productsGrid.innerHTML = "";
      if (!products || products.length === 0) {
          emptyProductsMsg.style.display = "block";
          return;
      }
      emptyProductsMsg.style.display = "none";

      products.forEach((prod) => {
          const prodCard = document.createElement("div");
          prodCard.className = "card-visual";
          
          const imgUrl = getImageUrl(prod.image);
          const imgHtml = imgUrl 
               ? `<img src="${imgUrl}" class="card-img" alt="${prod.name}">` 
               : `<div class="img-placeholder">🎁</div>`;
          
          prodCard.innerHTML = `
             <div class="card-img-container" style="height: 140px; aspect-ratio: unset;">
                ${imgHtml}
             </div>
             <div class="prod-info">
                 <div class="prod-title">${prod.name}</div>
                 <div class="prod-meta">
                     <div class="prod-price">${prod.price} CRD</div>
                     <div class="prod-btn-mini">&rarr;</div>
                 </div>
             </div>
          `;

          prodCard.onclick = () => openProductPanel(prod);
          productsGrid.appendChild(prodCard);
      });
  }

  function goBackToCategories() {
      viewProducts.classList.remove("active-view");
      viewCategories.classList.add("active-view");
      
      shopBackBtn.style.display = "none"; 
      headerTitle.style.display = "flex"; 
  }

  if (shopBackBtn) shopBackBtn.onclick = goBackToCategories;

  /* ===== Modal Logic ===== */
  function openProductPanel(prod) {
    SELECTED_PRODUCT = prod;
    panelStatusEl.textContent = ""; panelStatusEl.className = "status-message";
    panelNameEl.textContent = prod.name;
    panelDescEl.textContent = prod.description || "";
    panelPriceEl.textContent = `${prod.price} CRD`;
    
    const imgUrl = getImageUrl(prod.image);
    if (imgUrl) {
        panelImgEl.src = imgUrl;
        panelImgEl.style.display = "block";
        panelImgPlaceholderEl.style.display = "none";
    } else {
        panelImgEl.style.display = "none";
        panelImgPlaceholderEl.style.display = "block";
    }

    // REMOVED QTY LOGIC
    // const min = prod.min_qty || 1; const max = prod.max_qty || min;
    // panelQtyEl.min = min; panelQtyEl.max = max; panelQtyEl.value = min;
    // panelQtyRangeEl.textContent = `(min ${min}, max ${max})`;
    
    productPanelEl.style.display = "flex";
  }
  function closeProductPanel() { SELECTED_PRODUCT = null; productPanelEl.style.display = "none"; }
  if (productPanelEl) productPanelEl.addEventListener("click", (e) => { if (e.target === productPanelEl) closeProductPanel(); });

  async function buySelectedProduct() {
    if (!SELECTED_PRODUCT || !CURRENT_USER) return;
    
    // HARDCODED QUANTITY = 1
    const qty = 1;
    const prod = SELECTED_PRODUCT;
    
    panelStatusEl.textContent = "Se procesează..."; 
    panelStatusEl.className = "status-message";
    
    try {
      const res = await apiCall("buy_product", { product_id: prod.id, qty: qty });
      
      if (!res.ok) {
        panelStatusEl.className = "status-message status-error";
        if (res.error === "not_enough_credits") {
            panelStatusEl.textContent = "Fonduri insuficiente!";
        } else if (res.error === "auth_failed") {
            panelStatusEl.textContent = "Eroare autentificare!";
        } else {
            panelStatusEl.textContent = "Eroare: " + res.error;
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
      panelStatusEl.textContent = `Succes! Tichet #${newTicket.id} creat.`;
      
      setTimeout(() => { closeProductPanel(); showTicketsTab(); }, 1000);
      bumpUserActive(); 
      userTicketsPoller.bumpFast();
      
    } catch (err) {
      console.error(err); 
      panelStatusEl.className = "status-message status-error"; 
      panelStatusEl.textContent = "Eroare rețea.";
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
      if (isSelected) unreadCount = 0; // Vizual e citit dacă e selectat

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
    
    if (t) {
        // OPTIMIZARE: Trimitem mark_seen DOAR dacă sunt mesaje necitite
        const unreadCount = calculateUserUnread(t);
        if (unreadCount > 0) {
            apiCall("mark_seen", { ticket_id: ticketId });
            // Update local imediat
            if(t.messages.length) t.last_read_user = t.messages[t.messages.length - 1].id;
        }
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

  // --- SEND MESSAGE OPTIMIZED (1 Request Only) ---
  async function sendChatMessage() {
    const text = chatInputEl.value.trim();
    if (!text || !SELECTED_TICKET_ID) return;
    
    // 1. LOCK (Prevenire spam)
    if (isSending) return;
    isSending = true;

    // UI Feedback
    chatSendBtn.disabled = true;
    chatSendBtn.style.opacity = "0.5";

    const t = CURRENT_TICKETS.find((x) => x.id === SELECTED_TICKET_ID);
    if (!t || t.status === "closed") {
        isSending = false;
        return;
    }
    const reply_to = (userMode.type === "reply" && userMode.messageId) ? userMode.messageId : null;
    
    // Clear Input
    chatInputEl.value = ""; 
    clearUserMode();

    try {
      const res = await apiCall("user_send_message", { ticket_id: SELECTED_TICKET_ID, text, reply_to });
      
      if (!res.ok) {
        if(res.error === "ticket_closed") {
            const updated = CURRENT_TICKETS.find(x => x.id === SELECTED_TICKET_ID);
            if(updated) updated.status = "closed";
            updateUserChatState(updated);
        } else if (res.error === "auth_failed") {
            alert("Sesiune expirată.");
        }
        chatInputEl.value = text; // Restore text
        return;
      }

      if(res.ticket) {
          // 2. LOCAL UPDATE (fără re-fetch)
          const idx = CURRENT_TICKETS.findIndex(x => x.id === res.ticket.id);
          if (idx >= 0) CURRENT_TICKETS[idx] = res.ticket; else CURRENT_TICKETS.push(res.ticket);
          
          // Render direct (fără selectTicketUser pentru a evita mark_seen)
          renderTicketsListUser();
          renderUserMessages(res.ticket);
          smartScrollToBottom(chatMessagesEl, true);
      }
      
      bumpUserActive(); 
      // NOTĂ: Nu mai apelăm bumpFast() pentru a evita request-ul suplimentar de get_tickets

    } catch (err) { 
        console.error(err);
        chatInputEl.value = text;
    } finally {
        isSending = false;
        chatSendBtn.disabled = false;
        chatSendBtn.style.opacity = "1";
        setTimeout(() => chatInputEl.focus(), 50);
    }
  }

  function openConfirmModal(onConfirm) {
      if(!confirmModal) {
          console.error("Modal not found");
          return;
      }
      confirmModal.style.display = "flex";
      
      confirmOkBtn.onclick = () => {
          confirmModal.style.display = "none";
          if (typeof onConfirm === "function") onConfirm();
      };
      confirmCancelBtn.onclick = () => {
          confirmModal.style.display = "none";
      };
      
      confirmModal.onclick = (e) => {
          if(e.target === confirmModal) confirmModal.style.display = "none";
      }
  }

  function userCloseCurrentTicket() {
    if (!SELECTED_TICKET_ID) return;
    
    openConfirmModal(async () => {
        try {
          const res = await apiCall("user_close_ticket", { ticket_id: SELECTED_TICKET_ID });
          
          if (res.ok) {
              const idx = CURRENT_TICKETS.findIndex(x => x.id === SELECTED_TICKET_ID);
              if (idx >= 0) {
                  if (res.ticket) {
                      CURRENT_TICKETS[idx] = res.ticket;
                  } else {
                      CURRENT_TICKETS[idx].status = "closed";
                  }
                  CURRENT_TICKETS[idx].status = "closed"; 
                  renderTicketsListUser();
                  const updatedTicket = CURRENT_TICKETS[idx];
                  updateUserChatState(updatedTicket); 
              }
          }
          bumpUserActive(); 
          userTicketsPoller.bumpFast();
        } catch (err) { 
            console.error(err); 
            alert("Eroare de conexiune la închiderea tichetului.");
        }
    });
  }

  // --- NEW FUNCTION: REDESCHIDE TICKET ---
  async function userReopenCurrentTicket() {
      if (!SELECTED_TICKET_ID) return;
      
      const btn = document.getElementById("userTicketReopenBtn");
      if(btn) { btn.disabled = true; btn.textContent = "..."; }

      try {
          const res = await apiCall("user_reopen_ticket", { ticket_id: SELECTED_TICKET_ID });
          
          if (res.ok && res.ticket) {
              // Update local array
              const idx = CURRENT_TICKETS.findIndex(x => x.id === SELECTED_TICKET_ID);
              if (idx >= 0) {
                  CURRENT_TICKETS[idx] = res.ticket;
              }
              
              renderTicketsListUser();
              renderUserMessages(res.ticket);
              updateUserChatState(res.ticket);
              smartScrollToBottom(chatMessagesEl, true);
          } else {
              alert("Nu s-a putut redeschide tichetul.");
          }
          
          bumpUserActive();
          userTicketsPoller.bumpFast();

      } catch (err) {
          console.error(err);
          alert("Eroare de rețea.");
      } finally {
          if(btn) { btn.disabled = false; btn.textContent = "Redeschide"; }
      }
  }

  chatSendBtn?.addEventListener("click", sendChatMessage);
  chatInputEl?.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendChatMessage(); } });
  ticketsMenuToggle?.addEventListener("click", () => { toggleTicketsDrawer(); bumpUserActive(); });
  ticketsBackdrop?.addEventListener("click", closeTicketsDrawer);
  
  if (userTicketCloseBtn) userTicketCloseBtn.addEventListener("click", userCloseCurrentTicket);
  if (userTicketReopenBtn) userTicketReopenBtn.addEventListener("click", userReopenCurrentTicket); // BIND BUTTON

  async function pollTicketsUserCore() {
    if (!CURRENT_USER) return CURRENT_TICKETS;
    try {
      const res = await apiCall("user_get_tickets", {});
      if (!res.ok) return CURRENT_TICKETS;
      
      const newTickets = res.tickets || [];
      
      if (SELECTED_TICKET_ID) {
          const localT = CURRENT_TICKETS.find(x => x.id === SELECTED_TICKET_ID);
          const serverT = newTickets.find(x => x.id === SELECTED_TICKET_ID);
          
          // Detect status change externally (admin closed/opened)
          if (localT && serverT && localT.status !== serverT.status) {
              localT.status = serverT.status;
              updateUserChatState(localT); // Refresh buttons immediately
          }
      }

      CURRENT_TICKETS = newTickets;
      
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

  // --- POLLED CREATION ---
  const userTicketsPoller = createSmartPoll(
    pollTicketsUserCore,
    () => isTicketsTabActive()
  );

  /* ===== INIT APP ===== */
  async function initApp() {
    tg.ready(); tg.expand();

    // 1. Luăm datele doar pentru UI (nesigur, doar vizual)
    const unsafeUser = tg.initDataUnsafe?.user;
    
    // Setăm datele locale pentru a avea UI rapid
    CURRENT_USER = { 
        id: unsafeUser?.id, 
        username: unsafeUser?.username || "user",
        first_name: unsafeUser?.first_name,
        credits: 0 
    };
    
    renderUserHeader(); // Afișăm userul imediat

    // 2. Apelăm API-ul (Secure Init)
    try {
      // Backend-ul verifică initData și ne dă creditele reale
      const res = await apiCall("init", {});
      
      if (!res.ok) {
          if (res.error === "auth_failed") {
            userLineEl.innerHTML = "<span style='color:red'>Autentificare eșuată!</span>";
            return;
          }
          throw new Error("Init failed: " + res.error);
      }

      // 3. Actualizăm cu datele reale de pe server
      CURRENT_USER.credits = res.user.credits;
      CURRENT_SHOP = res.shop;
      CURRENT_TICKETS = res.tickets || [];

      renderUserHeader(); // Actualizăm cu creditele reale
      renderCategoriesGrid(CURRENT_SHOP);
      renderTicketsListUser();
      
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
