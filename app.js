// app.js – Versiune Completă & FIXATĂ
// Include: Smart Polling, Anti-Flicker List & Chat, Modal Close fix, Reply Button logic UI

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
      schedule(maxInterval); return;
    }
    try {
      const data = await fetchFn();
      if (!active) return;
      if (data !== undefined) {
        const snap = JSON.stringify(data);
        if (lastSnapshot === null || snap !== lastSnapshot) {
          lastSnapshot = snap; idleCount = 0; currentInterval = minInterval;
        } else {
          idleCount += 1;
          if (idleCount >= idleThreshold) currentInterval = Math.min(maxInterval, currentInterval + backoffStep);
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
   UTIL
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
   RENDER – MESAJE (ANTI-FLICKER + UI FIX)
   ============================ */
function renderDiscordMessages(messages, options) {
  const { container, ticket, canReply, onReply, onJumpTo } = options;
  if (!container) return;
  
  const wasNearBottom = isNearBottom(container);

  if (!messages || messages.length === 0) {
      if (!container.querySelector('.chat-placeholder')) {
         container.innerHTML = `<div class="chat-placeholder"><div class="icon">💬</div><p>Începe conversația...</p></div>`;
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
    
    // --- HTML Components ---
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

    // --- BUTTON REPLY NOU (Sus în header, dreapta) ---
    let replyBtnHtml = "";
    if (canReply && !m.deleted) {
        replyBtnHtml = `<button class="btn-reply-mini">↩ Reply</button>`;
    }

    const innerHTML = `
        <div class="msg-avatar">${initial}</div>
        <div class="msg-content">
            <div class="msg-header-line">
                <div class="msg-meta-group">
                    <span class="msg-username ${adminClass}">${senderName}</span>
                    <span class="msg-timestamp">${formatTimestamp(m.ts)}</span>
                </div>
                ${replyBtnHtml}
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
        if (row.innerHTML !== innerHTML) {
            row.innerHTML = innerHTML;
            attachMessageEvents(row, m, onReply, onJumpTo);
        }
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
  setTimeout(() => { row.classList.remove("msg-row--highlight"); }, 1500);
}

/* ============================
   USER MINIAPP MAIN
   ============================ */
function initUserApp() {
  const tg = window.Telegram?.WebApp;
  let CURRENT_USER = null;
  let CURRENT_SHOP = null;
  let CURRENT_TICKETS = [];
  let SELECTED_TICKET_ID = null;
  let USER_LAST_SEEN = {};

  function loadUserSeen() { try { const r=localStorage.getItem("user_ticket_seen"); if(r) USER_LAST_SEEN=JSON.parse(r); else USER_LAST_SEEN={}; } catch(e){ USER_LAST_SEEN={}; } }
  function saveUserSeen() { try { localStorage.setItem("user_ticket_seen", JSON.stringify(USER_LAST_SEEN)); } catch(e){} }
  function markTicketReadUser(t) { if(!t)return; const msgs=t.messages||[]; if(!msgs.length)return; USER_LAST_SEEN[String(t.id)]=msgs[msgs.length-1].id; saveUserSeen(); }
  function getUnreadCountUser(t) { 
      const msgs=t.messages||[]; if(!msgs.length)return 0; 
      const last=USER_LAST_SEEN[String(t.id)]; 
      let idx = last ? msgs.findIndex(m=>m.id===last) : -1;
      let c=0; for(let i=idx+1; i<msgs.length; i++){ if(msgs[i]&&!msgs[i].deleted&&msgs[i].from==="admin") c++; }
      return c; 
  }

  loadUserSeen();
  let userActiveUntil = 0;
  function bumpUserActive(extraMs=25000) { userActiveUntil = Math.max(userActiveUntil, Date.now()+extraMs); }

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
  
  let userModeBar = null;
  let userMode = { type: null, messageId: null, previewText: "", sender: "" };

  /* Navigation */
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

  /* Reply Bar UI */
  if (chatInputContainer && !chatInputContainer.querySelector(".chat-mode-bar")) {
    userModeBar = document.createElement("div");
    userModeBar.className = "chat-mode-bar";
    userModeBar.style.display = "none";
    const span = document.createElement("span"); span.className = "chat-mode-text";
    const btn = document.createElement("button"); btn.textContent = "Anulează";
    btn.onclick = clearUserMode;
    userModeBar.appendChild(span); userModeBar.appendChild(btn);
    chatInputContainer.prepend(userModeBar);
  }
  function clearUserMode() {
    if (!userModeBar) return;
    userMode = { type: null, messageId: null, previewText: "", sender: "" };
    userModeBar.style.display = "none";
  }
  function setUserReplyMode(msg) {
    if (!userModeBar) return;
    userMode.type = "reply"; userMode.messageId = msg.id;
    userMode.previewText = (msg.text||"").slice(0, 50); userMode.sender = msg.sender||"User";
    userModeBar.querySelector(".chat-mode-text").textContent = `Răspunzi lui ${userMode.sender}: "${userMode.previewText}..."`;
    userModeBar.style.display = "flex";
    chatInputEl.focus();
  }

  function updateUserChatState(ticket) {
    if (!chatInputEl || !chatSendBtn) return;
    if (!ticket) {
      chatInputEl.disabled = true; chatSendBtn.disabled = true;
      chatInputEl.placeholder = "Selectează un tichet...";
      clearUserMode();
      if(userTicketCloseBtn) userTicketCloseBtn.style.display = "none";
      if(ticketTitleEl) ticketTitleEl.textContent = "Niciun tichet selectat";
      return;
    }
    const isClosed = ticket.status === "closed";
    chatInputEl.disabled = isClosed; chatSendBtn.disabled = isClosed;
    chatInputEl.placeholder = isClosed ? "Tichet închis." : "Scrie un mesaj...";
    if(userTicketCloseBtn) userTicketCloseBtn.style.display = isClosed ? "none" : "block";
    if(isClosed) clearUserMode();
  }

  /* Drawer */
  function closeTicketsDrawer() { if(ticketsTabEl) ticketsTabEl.classList.remove("tickets-drawer-open"); }
  function toggleTicketsDrawer() { if(ticketsTabEl) ticketsTabEl.classList.toggle("tickets-drawer-open"); }

  /* API */
  function apiCall(action, extraPayload={}) {
    return fetch(API_URL, {
      method: "POST", headers:{"Content-Type":"application/json"},
      body: JSON.stringify({ action, user: CURRENT_USER, ...extraPayload })
    }).then(r=>r.json());
  }

  /* Shop Logic */
  function renderShop(shop) {
    categoriesContainer.innerHTML = "";
    if(!shop?.categories) return;
    shop.categories.forEach(cat => {
        const d=document.createElement("div"); d.className="category";
        d.innerHTML = `
          <div class="category-header"><div class="category-name">${cat.name}</div><div class="category-pill">cat</div></div>
          ${cat.description ? `<div class="category-desc">${cat.description}</div>` : ""}
          <div class="products"></div>
        `;
        const pCont = d.querySelector(".products");
        (cat.products||[]).forEach(prod => {
            const p = document.createElement("div"); p.className="product";
            p.innerHTML=`
              <div class="product-main"><div class="product-name">${prod.name}</div><div class="product-desc">${prod.description||""}</div></div>
              <div class="product-right"><div class="product-price">${prod.price} CRD</div><button class="product-btn">DETALII</button></div>
            `;
            p.onclick = () => openProductPanel(prod);
            pCont.appendChild(p);
        });
        categoriesContainer.appendChild(d);
    });
  }

  /* Modal Logic */
  function openProductPanel(prod) {
      SELECTED_PRODUCT = prod;
      panelStatusEl.className="status-message"; panelStatusEl.textContent="";
      panelNameEl.textContent = prod.name; panelDescEl.textContent = prod.description||"";
      panelPriceEl.textContent = `${prod.price} CRD`;
      panelQtyEl.min = prod.min_qty||1; panelQtyEl.max = prod.max_qty||prod.min_qty||1; panelQtyEl.value = panelQtyEl.min;
      panelQtyRangeEl.textContent = `(min ${panelQtyEl.min}, max ${panelQtyEl.max})`;
      productPanelEl.style.display = "flex";
  }
  function closeProductPanel() { SELECTED_PRODUCT=null; productPanelEl.style.display="none"; }
  if(productPanelEl) productPanelEl.addEventListener("click", e => { if(e.target===productPanelEl) closeProductPanel(); });
  if(panelCloseBtn) panelCloseBtn.onclick = closeProductPanel;
  
  async function buySelectedProduct() {
      if(!SELECTED_PRODUCT || !CURRENT_USER) return;
      const qty = Number(panelQtyEl.value);
      panelStatusEl.textContent = "Procesare...";
      try {
          const res = await apiCall("buy_product", { product_id: SELECTED_PRODUCT.id, qty });
          if(!res.ok) {
              panelStatusEl.className="status-message status-error";
              panelStatusEl.textContent = res.error === "not_enough_credits" ? `Fonduri insuficiente.` : `Eroare: ${res.error}`;
              return;
          }
          CURRENT_USER.credits = res.new_balance; creditsValueEl.textContent = CURRENT_USER.credits;
          CURRENT_TICKETS.push(res.ticket);
          renderTicketsListUser(); selectTicketUser(res.ticket.id);
          panelStatusEl.className="status-message status-ok"; panelStatusEl.textContent="Succes!";
          setTimeout(()=>{ closeProductPanel(); showTicketsTab(); }, 1000);
          bumpUserActive(); userTicketsPoller.bumpFast();
      } catch(e) { panelStatusEl.className="status-message status-error"; panelStatusEl.textContent="Eroare rețea."; }
  }
  if(panelBuyBtn) panelBuyBtn.onclick = buySelectedProduct;

  /* Ticket List (Anti-Flicker) */
  function renderTicketsListUser() {
      if(!CURRENT_TICKETS.length) {
          if(!chatListEl.querySelector('.no-tickets-msg')) chatListEl.innerHTML='<div class="no-tickets-msg" style="padding:20px;text-align:center;color:#555">Nu ai tichete.</div>';
          return;
      }
      const noMsg = chatListEl.querySelector('.no-tickets-msg'); if(noMsg) noMsg.remove();
      
      CURRENT_TICKETS.sort((a,b) => (a.status===b.status ? (b.id-a.id) : (a.status==="open"?-1:1)));
      const processed = new Set();
      
      CURRENT_TICKETS.forEach(t => {
          processed.add(String(t.id));
          let item = chatListEl.querySelector(`.chat-item[data-ticket-id="${t.id}"]`);
          const unread = getUnreadCountUser(t);
          const badge = (unread>0 && t.status==="open") ? `<span class="unread-badge">${unread}</span>` : "";
          const html = `
            <div class="chat-item-header-row">
                <div class="chat-item-title">${t.product_name||"Comandă"}</div>
                <div style="display:flex;align-items:center;">${badge}<span class="ticket-status-pill ${t.status}">${t.status}</span></div>
            </div>
            <div class="chat-item-line">${(t.messages||[]).slice(-1)[0]?.text || "Nou"}</div>
          `;
          
          if(!item) {
              item = document.createElement("div"); item.className="chat-item"; item.dataset.ticketId = t.id;
              item.innerHTML = html;
              item.onclick = () => { selectTicketUser(t.id); bumpUserActive(); closeTicketsDrawer(); userTicketsPoller.bumpFast(); };
              chatListEl.appendChild(item);
          } else if(item.innerHTML!==html) { item.innerHTML = html; }
          
          if(t.id===SELECTED_TICKET_ID) item.classList.add("active"); else item.classList.remove("active");
          chatListEl.appendChild(item); // Reorder
      });
      
      Array.from(chatListEl.children).forEach(c => { if(!processed.has(c.dataset.ticketId)) c.remove(); });
  }

  function selectTicketUser(tid) {
      SELECTED_TICKET_ID = tid;
      const t = CURRENT_TICKETS.find(x=>x.id===tid);
      if(t) markTicketReadUser(t);
      renderTicketsListUser();
      
      if(!t) { chatMessagesEl.innerHTML=""; updateUserChatState(null); return; }
      if(ticketTitleEl) ticketTitleEl.textContent = `${t.product_name||"Tichet"} #${t.id}`;
      
      renderUserMessages(t);
      updateUserChatState(t);
  }

  function renderUserMessages(ticket) {
      renderDiscordMessages(ticket.messages||[], {
          container: chatMessagesEl, ticket, canReply: ticket.status==="open",
          onReply: (msg) => { if(ticket.status==="open") setUserReplyMode(msg); },
          onJumpTo: (mid) => scrollToMessageElement(chatMessagesEl, mid)
      });
  }

  async function sendChatMessage() {
      const txt = chatInputEl.value.trim();
      if(!txt || !SELECTED_TICKET_ID) return;
      
      const replyTo = userMode.type==="reply" ? userMode.messageId : null;
      chatInputEl.value = ""; clearUserMode();
      
      try {
          const res = await apiCall("user_send_message", { ticket_id: SELECTED_TICKET_ID, text: txt, reply_to: replyTo });
          if(res.ok && res.ticket) {
              const idx = CURRENT_TICKETS.findIndex(x=>x.id===res.ticket.id);
              if(idx>=0) CURRENT_TICKETS[idx]=res.ticket; else CURRENT_TICKETS.push(res.ticket);
              selectTicketUser(res.ticket.id);
          } else if(res.error==="ticket_closed") {
              const t = CURRENT_TICKETS.find(x=>x.id===SELECTED_TICKET_ID);
              if(t) { t.status="closed"; updateUserChatState(t); }
          }
          bumpUserActive(); userTicketsPoller.bumpFast();
      } catch(e) { console.error(e); }
  }

  async function closeCurrentTicket() {
      if(!SELECTED_TICKET_ID || !confirm("Închizi tichetul?")) return;
      try {
          const res = await apiCall("user_close_ticket", { ticket_id: SELECTED_TICKET_ID });
          if(res.ok && res.ticket) {
              const idx = CURRENT_TICKETS.findIndex(x=>x.id===res.ticket.id);
              if(idx>=0) CURRENT_TICKETS[idx]=res.ticket;
              selectTicketUser(res.ticket.id);
          }
          bumpUserActive(); userTicketsPoller.bumpFast();
      } catch(e) { console.error(e); }
  }

  // Listeners
  chatSendBtn?.addEventListener("click", sendChatMessage);
  chatInputEl?.addEventListener("keydown", e => { if(e.key==="Enter" && !e.shiftKey) { e.preventDefault(); sendChatMessage(); } });
  ticketsMenuToggle?.addEventListener("click", () => { toggleTicketsDrawer(); bumpUserActive(); });
  ticketsBackdrop?.addEventListener("click", closeTicketsDrawer);
  userTicketCloseBtn?.addEventListener("click", closeCurrentTicket);

  // Poller Logic
  async function pollCore() {
      if(!CURRENT_USER) return CURRENT_TICKETS;
      try {
          const res = await apiCall("user_get_tickets", {});
          if(res.ok) {
              CURRENT_TICKETS = res.tickets||[];
              if(SELECTED_TICKET_ID) {
                  const t = CURRENT_TICKETS.find(x=>x.id===SELECTED_TICKET_ID);
                  if(t) { markTicketReadUser(t); renderUserMessages(t); updateUserChatState(t); }
              }
              renderTicketsListUser();
          }
      } catch(e){}
      return CURRENT_TICKETS;
  }
  
  const userTicketsPoller = createSmartPoll(pollCore, () => {
      if(!document.getElementById("ticketsTab").classList.contains("active")) return false;
      return Date.now() < userActiveUntil;
  });

  // Init
  async function initApp() {
      if(!tg) { userLineEl.innerHTML="Deschide din Telegram."; userLineEl.style.display="block"; return; }
      tg.ready(); tg.expand();
      const u = tg.initDataUnsafe?.user;
      if(!u) { userLineEl.innerHTML="No user data."; userLineEl.style.display="block"; return; }
      CURRENT_USER = { id: u.id, username: u.username, credits: 0 };
      
      try {
          const res = await apiCall("init", {});
          if(res.ok) {
              CURRENT_USER.credits = res.user.credits;
              CURRENT_SHOP = res.shop;
              CURRENT_TICKETS = res.tickets||[];
              renderUserHeader(); renderShop(CURRENT_SHOP); renderTicketsListUser();
              showShopTab();
          }
      } catch(e) { userLineEl.innerHTML="Connection Error."; userLineEl.style.display="block"; }
  }
  
  document.addEventListener("visibilitychange", () => {
      if(document.visibilityState==="visible" && document.getElementById("ticketsTab").classList.contains("active")) {
          bumpUserActive(); userTicketsPoller.start();
      } else { userTicketsPoller.stop(); }
  });

  initApp();
}

document.addEventListener("DOMContentLoaded", initUserApp);
