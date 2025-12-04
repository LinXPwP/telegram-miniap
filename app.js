// app.js – Versiune User FINALĂ (Fixed Flicker + Style + Reply)

const API_URL = "https://api.redgen.vip/api"; 
const PLACEHOLDER_IMG = "https://placehold.co/400x300/202226/FFF?text=No+Image";

/* ============================
   1. HELPER – SMART POLLING
   ============================ */
function createSmartPoll(fetchFn, isEnabledFn, options = {}) {
  const minInterval = 3000;
  const maxInterval = 8000;
  const backoffStep = 2000;
  let timeoutId = null, active = false, currentInterval = minInterval, idleCount = 0;

  async function tick() {
    if (!active) return;
    if (!isEnabledFn || !isEnabledFn()) { schedule(maxInterval); return; }
    try {
      const data = await fetchFn();
      if (!active) return;
      if (data !== undefined) {
         // Logic simplu: daca primim date, resetam intervalul
         idleCount = 0;
         currentInterval = minInterval;
      }
    } catch (e) { 
        console.error("[Poll Error]", e); 
        currentInterval = Math.min(maxInterval, currentInterval + backoffStep); 
    }
    schedule(currentInterval);
  }
  function schedule(delay) { if (!active) return; if (timeoutId) clearTimeout(timeoutId); timeoutId = setTimeout(tick, delay); }
  return { start() { if (active) return; active = true; idleCount = 0; currentInterval = minInterval; tick(); }, stop() { active = false; if (timeoutId) clearTimeout(timeoutId); timeoutId = null; }, bumpFast() { if (!active) return; idleCount = 0; currentInterval = minInterval; schedule(currentInterval); } };
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

function smartScrollToBottom(container, force = false) {
  if (!container) return;
  const { scrollTop, scrollHeight, clientHeight } = container;
  const isNearBottom = scrollHeight - (scrollTop + clientHeight) < 150;
  if (force || isNearBottom) requestAnimationFrame(() => { container.scrollTop = container.scrollHeight; });
}

/* ============================
   3. MAIN APP LOGIC
   ============================ */
function initUserApp() {
  const tg = window.Telegram?.WebApp;
  let CURRENT_USER = null;
  let CURRENT_SHOP = null;
  let CURRENT_TICKETS = [];
  let SELECTED_TICKET_ID = null;
  let SELECTED_PRODUCT = null;
  let CURRENT_CATEGORY = null;
  let userActiveUntil = 0;

  function bumpUserActive(extraMs = 25000) { userActiveUntil = Math.max(userActiveUntil, Date.now() + extraMs); }

  // DOM Elements
  const creditsValueEl = document.getElementById("creditsValue");
  const userLineEl = document.getElementById("userLine");
  const categoriesView = document.getElementById("categoriesView");
  const categoriesGrid = document.getElementById("categoriesGrid");
  const productsView = document.getElementById("productsView");
  const productsGrid = document.getElementById("productsGrid");
  const currentCatTitle = document.getElementById("currentCatTitle");
  const currentCatDesc = document.getElementById("currentCatDesc");
  const backToCatsBtn = document.getElementById("backToCatsBtn");
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
  const userModeBar = document.getElementById("userModeBar");
  const cancelReplyBtn = document.getElementById("cancelReplyBtn");
  let userMode = { type: null, messageId: null };
  const productPanelEl = document.getElementById("productPanel");
  const panelImageEl = document.getElementById("panelImage");
  const panelNameEl = document.getElementById("panelName");
  const panelDescEl = document.getElementById("panelDesc");
  const panelPriceEl = document.getElementById("panelPrice");
  const panelQtyEl = document.getElementById("panelQty");
  const panelQtyRangeEl = document.getElementById("panelQtyRange");
  const panelBuyBtn = document.getElementById("panelBuyBtn");
  const panelCloseBtn = document.getElementById("panelCloseBtn");
  const panelStatusEl = document.getElementById("panelStatus");
  const confirmModal = document.getElementById("confirmActionModal");
  const confirmOkBtn = document.getElementById("confirmOkBtn");
  const confirmCancelBtn = document.getElementById("confirmCancelBtn");

  // Navigation
  function showShopTab() {
    shopTabEl.classList.add("active");
    ticketsTabEl.classList.remove("active");
    shopHeaderEl.style.display = "flex";
    userTicketsPoller.stop();
  }
  function showTicketsTab() {
    shopTabEl.classList.remove("active");
    ticketsTabEl.classList.add("active");
    shopHeaderEl.style.display = "none";
    bumpUserActive(); userTicketsPoller.start();
  }
  if (goToTicketsBtn) goToTicketsBtn.addEventListener("click", showTicketsTab);
  if (backToShopBtn) backToShopBtn.addEventListener("click", showShopTab);

  // API Call
  function apiCall(action, extraPayload = {}) {
    const payload = { action, user: CURRENT_USER, ...extraPayload };
    return fetch(API_URL, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }).then(async (r) => {
        if (!r.ok) { const txt = await r.text(); throw new Error(`HTTP ${r.status}: ${txt}`); }
        return r.json();
    });
  }

  function renderUserHeader() {
    if (!CURRENT_USER) return;
    if (creditsValueEl) creditsValueEl.textContent = CURRENT_USER.credits;
    const name = CURRENT_USER.username ? "@" + CURRENT_USER.username : `ID ${CURRENT_USER.id}`;
    if (userLineEl) userLineEl.innerHTML = `Utilizator: <b>${name}</b>`;
  }

  // --- RENDER SHOP ---
  function renderCategories(shop) {
      if(!categoriesGrid) return;
      categoriesGrid.innerHTML = "";
      if (!shop || !shop.categories) return;
      shop.categories.forEach(cat => {
          const card = document.createElement("div");
          card.className = "shop-card category-card";
          const imgSrc = cat.image || PLACEHOLDER_IMG;
          card.innerHTML = `<div class="card-img-wrapper"><img class="shop-card-img" src="${imgSrc}" loading="lazy" onerror="this.src='${PLACEHOLDER_IMG}'" /><div class="card-overlay-title">${cat.name}</div></div>`;
          card.onclick = () => openCategory(cat);
          categoriesGrid.appendChild(card);
      });
  }

  function openCategory(cat) {
      CURRENT_CATEGORY = cat;
      if(currentCatTitle) currentCatTitle.textContent = cat.name;
      if(currentCatDesc) currentCatDesc.textContent = cat.description || "Produse disponibile:";
      if(categoriesView) categoriesView.style.display = "none";
      if(productsView) productsView.style.display = "block";
      renderCategoryProducts(cat);
      if(shopTabEl) shopTabEl.scrollTop = 0;
  }

  function backToCategories() {
      if(productsView) productsView.style.display = "none";
      if(categoriesView) categoriesView.style.display = "block";
      CURRENT_CATEGORY = null;
  }
  if(backToCatsBtn) backToCatsBtn.onclick = backToCategories;

  function renderCategoryProducts(cat) {
      if(!productsGrid) return;
      productsGrid.innerHTML = "";
      (cat.products || []).forEach(prod => {
          const card = document.createElement("div");
          card.className = "shop-card product-card";
          const imgSrc = prod.image || PLACEHOLDER_IMG;
          card.innerHTML = `<div class="card-img-wrapper"><img class="shop-card-img" src="${imgSrc}" loading="lazy" onerror="this.src='${PLACEHOLDER_IMG}'" /></div><div class="product-card-details"><div class="prod-name">${prod.name}</div><div class="prod-price">${prod.price} CRD</div><button class="btn-buy-mini">Detalii</button></div>`;
          card.onclick = () => openProductPanel(prod);
          productsGrid.appendChild(card);
      });
  }

  // --- PRODUCT MODAL ---
  function openProductPanel(prod) {
    SELECTED_PRODUCT = prod;
    panelStatusEl.textContent = ""; panelStatusEl.className = "status-message";
    panelNameEl.textContent = prod.name;
    panelDescEl.textContent = prod.description || "Fără descriere.";
    panelPriceEl.textContent = `${prod.price} CRD`;
    panelImageEl.style.display = 'block'; 
    panelImageEl.src = (prod.image && prod.image.trim() !== "") ? prod.image : PLACEHOLDER_IMG;
    const min = prod.min_qty || 1; const max = prod.max_qty || 10;
    panelQtyEl.min = min; panelQtyEl.max = max; panelQtyEl.value = min;
    panelQtyRangeEl.textContent = `(max ${max})`;
    productPanelEl.style.display = "flex";
  }
  function closeProductPanel() { SELECTED_PRODUCT = null; productPanelEl.style.display = "none"; }
  productPanelEl.addEventListener("click", (e) => { if (e.target === productPanelEl) closeProductPanel(); });
  panelCloseBtn.onclick = closeProductPanel;

  async function buySelectedProduct() {
    if (!SELECTED_PRODUCT || !CURRENT_USER) return;
    const qty = Number(panelQtyEl.value || 0);
    const prod = SELECTED_PRODUCT;
    panelStatusEl.textContent = "Se procesează..."; panelStatusEl.className = "status-message";
    try {
      const res = await apiCall("buy_product", { product_id: prod.id, qty: qty });
      if (!res.ok) {
        panelStatusEl.className = "status-message status-error";
        if (res.error === "no_credits") panelStatusEl.textContent = `Fonduri insuficiente.`;
        else panelStatusEl.textContent = "Eroare: " + (res.error || "necunoscută");
        return;
      }
      CURRENT_USER.credits = res.new_balance; creditsValueEl.textContent = CURRENT_USER.credits;
      const newTicket = res.ticket;
      CURRENT_TICKETS.push(newTicket);
      panelStatusEl.className = "status-message status-ok"; panelStatusEl.textContent = `Succes!`;
      setTimeout(() => { closeProductPanel(); renderTicketsListUser(); selectTicketUser(newTicket.id); showTicketsTab(); }, 800);
      bumpUserActive(); userTicketsPoller.bumpFast();
    } catch (err) { console.error(err); panelStatusEl.className = "status-message status-error"; panelStatusEl.textContent = "Eroare rețea."; }
  }
  if(panelBuyBtn) panelBuyBtn.onclick = buySelectedProduct;

  // --- CHAT LOGIC (SMART UPDATE - NO FLICKER) ---
  function getUnread(t) {
      if(!t.messages) return 0;
      const lastRead = t.last_read_user || "";
      let count = 0; let start = (lastRead === "");
      for (let m of t.messages) {
          if (m.id === lastRead) { start = true; continue; }
          if (start && m.from === 'admin') count++;
      }
      return count;
  }

  function renderTicketsListUser() {
      if (!CURRENT_TICKETS || CURRENT_TICKETS.length === 0) {
          chatListEl.innerHTML = '<div style="padding:20px; text-align:center; color:#555;">Nu ai tichete.</div>';
          return;
      }
      // Sterge mesaj "Nu ai tichete"
      const emptyMsg = chatListEl.querySelector('div[style*="text-align:center"]');
      if (emptyMsg) emptyMsg.remove();

      CURRENT_TICKETS.sort((a,b) => (a.status==='open'?-1:1) || (b.id - a.id));
      const processedIds = new Set();
      
      CURRENT_TICKETS.forEach(t => {
          processedIds.add(String(t.id));
          let item = chatListEl.querySelector(`.chat-item[data-ticket-id="${t.id}"]`);
          
          const isSelected = (t.id === SELECTED_TICKET_ID);
          let unread = isSelected ? 0 : getUnread(t);
          const badgeHtml = unread > 0 ? `<span class="unread-badge">${unread}</span>` : "";
          const stClass = t.status==='open' ? 'open' : 'closed';
          const title = t.product_name || "Comandă";
          
          // Reconstruim HTML-ul pentru a compara
          const innerHTML = `
             <div class="chat-item-header-row">
                <div class="chat-item-title">${title}</div>
                <div>${badgeHtml}<span class="ticket-status-pill ${stClass}">${t.status}</span></div>
             </div>
             <div class="chat-item-line">#${t.id}</div>
          `;

          if (!item) {
              item = document.createElement("div");
              item.className = "chat-item";
              item.setAttribute("data-ticket-id", t.id);
              item.onclick = () => { selectTicketUser(t.id); bumpUserActive(); closeTicketsDrawer(); };
              item.innerHTML = innerHTML;
              chatListEl.appendChild(item);
          } else {
              // DOM UPDATE DOAR DACA DIFERA
              if (item.innerHTML !== innerHTML) item.innerHTML = innerHTML;
          }
          if (isSelected) item.classList.add("active"); else item.classList.remove("active");
      });

      // Cleanup
      Array.from(chatListEl.children).forEach(child => {
          const id = child.getAttribute("data-ticket-id");
          if (id && !processedIds.has(id)) child.remove();
      });
  }

  function selectTicketUser(tid) {
      SELECTED_TICKET_ID = tid;
      renderTicketsListUser();
      
      const t = CURRENT_TICKETS.find(x => x.id === tid);
      if(!t) { chatMessagesEl.innerHTML=""; return; }
      
      apiCall("mark_seen", { ticket_id: tid });
      if(t.messages.length) t.last_read_user = t.messages[t.messages.length-1].id;

      ticketTitleEl.textContent = `${t.product_name} #${t.id}`;
      // Butonul Inchide
      if(userTicketCloseBtn) userTicketCloseBtn.style.display = t.status==='closed' ? 'none' : 'block';
      
      chatInputEl.disabled = (t.status === 'closed');
      chatSendBtn.disabled = (t.status === 'closed');
      if(t.status === 'closed') clearUserReplyMode();
      
      renderChatMessagesSmart(t);
  }

  // --- REPLY LOGIC ---
  function setUserReplyMode(msg) {
      userMode = { type: "reply", messageId: msg.id };
      if(userModeBar) {
          userModeBar.querySelector(".chat-mode-text").textContent = `Răspunzi lui ${msg.sender}: "${(msg.text||"").slice(0,30)}..."`;
          userModeBar.style.display = "flex";
      }
      chatInputEl.focus();
  }
  function clearUserReplyMode() {
      userMode = { type: null, messageId: null };
      if(userModeBar) userModeBar.style.display = "none";
  }
  if(cancelReplyBtn) cancelReplyBtn.onclick = clearUserReplyMode;

  // --- SMART MESSAGES RENDER ---
  function renderChatMessagesSmart(t) {
      if(!t.messages || t.messages.length === 0) {
           chatMessagesEl.innerHTML = `<div class="chat-placeholder"><p>Începe conversația...</p></div>`;
           return;
      }
      const placeholder = chatMessagesEl.querySelector('.chat-placeholder');
      if(placeholder) placeholder.remove();

      const msgMap = {}; t.messages.forEach(m => msgMap[m.id] = m);

      // Seen Logic
      let lastAdminMsgId = null;
      for (let i = t.messages.length - 1; i >= 0; i--) { 
          if (t.messages[i].from === 'admin' && !t.messages[i].deleted) { 
              lastAdminMsgId = t.messages[i].id; break; 
          } 
      }
      let showSeenLabel = false;
      if (lastAdminMsgId && t.last_read_user) {
          const idxAdmin = t.messages.findIndex(m => m.id === lastAdminMsgId);
          const idxUserRead = t.messages.findIndex(m => m.id === t.last_read_user);
          if (idxUserRead >= idxAdmin) showSeenLabel = true;
      }

      t.messages.forEach(m => {
           let row = chatMessagesEl.querySelector(`.msg-row[data-id="${m.id}"]`);
           const senderName = m.sender || (m.from==='system'?'System': (m.from==='admin'?'Admin':'Tu'));
           const clsAdmin = m.from==='admin' ? 'msg-username--admin' : '';
           const initial = senderName[0].toUpperCase();
           
           let replyHtml = '';
           if(m.reply_to && msgMap[m.reply_to]) {
               const orig = msgMap[m.reply_to];
               replyHtml = `<div class="msg-reply-preview"><strong>${orig.sender||"User"}</strong> ${orig.text.slice(0,40)}</div>`;
           }

           let replyBtn = '';
           if(t.status === 'open' && !m.deleted) {
               replyBtn = `<button class="btn-reply-mini">↩</button>`;
           }

           const innerHTML = `
             <div class="msg-avatar">${initial}</div>
             <div class="msg-content">
                <div class="msg-header-line">
                   <div class="msg-meta-group">
                       <span class="msg-username ${clsAdmin}">${senderName}</span>
                       <span class="msg-timestamp">${formatTimestamp(m.ts)}</span>
                   </div>
                   ${replyBtn}
                </div>
                <div class="msg-bubble">
                    ${replyHtml}
                    <div class="msg-text ${m.deleted?'msg-text--deleted':''}">${m.deleted?'Șters':m.text}</div>
                </div>
             </div>
           `;

           if(!row) {
               row = document.createElement("div");
               row.className = "msg-row";
               row.setAttribute("data-id", m.id);
               row.innerHTML = innerHTML;
               
               // Reply Event
               const rBtn = row.querySelector('.btn-reply-mini');
               if(rBtn) rBtn.onclick = (e) => { e.stopPropagation(); setUserReplyMode(m); };
               
               chatMessagesEl.appendChild(row);
           } else {
               // Update only if text changed (rare)
               if(row.innerHTML !== innerHTML) {
                   row.innerHTML = innerHTML;
                   const rBtn = row.querySelector('.btn-reply-mini');
                   if(rBtn) rBtn.onclick = (e) => { e.stopPropagation(); setUserReplyMode(m); };
               }
           }

           // Seen Label Handling
           const existingSeen = row.querySelector('.seen-footer');
           if(existingSeen) existingSeen.remove();
           if(showSeenLabel && m.id === lastAdminMsgId) {
                const seenDiv = document.createElement("div");
                seenDiv.className = "seen-footer";
                seenDiv.innerHTML = `Văzut ${timeAgo(t.last_read_user_at)}`;
                row.querySelector(".msg-content").appendChild(seenDiv);
           }
      });
      smartScrollToBottom(chatMessagesEl);
  }

  async function sendChatMessage() {
      const txt = chatInputEl.value.trim();
      if(!txt || !SELECTED_TICKET_ID) return;
      
      const replyTo = userMode.type === 'reply' ? userMode.messageId : null;
      chatInputEl.value=""; 
      clearUserReplyMode();

      try {
          const res = await apiCall("user_send_message", { ticket_id: SELECTED_TICKET_ID, text: txt, reply_to: replyTo });
          if(res.ok && res.ticket) {
              const idx = CURRENT_TICKETS.findIndex(x=>x.id===res.ticket.id);
              if(idx!==-1) CURRENT_TICKETS[idx] = res.ticket;
              selectTicketUser(res.ticket.id);
          }
      } catch(e) {}
  }
  if(chatSendBtn) chatSendBtn.onclick = sendChatMessage;
  // Enter key support
  if(chatInputEl) chatInputEl.onkeydown = (e) => {
      if(e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChatMessage(); }
  };

  // Drawer
  function closeTicketsDrawer() { if(ticketsTabEl) ticketsTabEl.classList.remove("tickets-drawer-open"); }
  if(ticketsMenuToggle) ticketsMenuToggle.onclick = () => ticketsTabEl.classList.add("tickets-drawer-open");
  if(ticketsBackdrop) ticketsBackdrop.onclick = closeTicketsDrawer;

  // Confirm Close Ticket
  function userCloseCurrentTicket() {
      if (!SELECTED_TICKET_ID) return;
      if(confirmModal) confirmModal.style.display = "flex";
      
      if(confirmOkBtn) confirmOkBtn.onclick = async () => {
          confirmModal.style.display = "none";
          try {
             const res = await apiCall("user_close_ticket", { ticket_id: SELECTED_TICKET_ID });
             if(res.ok) {
                 const t = CURRENT_TICKETS.find(x=>x.id===SELECTED_TICKET_ID);
                 if(t) t.status = "closed";
                 renderTicketsListUser();
                 selectTicketUser(SELECTED_TICKET_ID);
             }
          } catch(e){}
      };
      if(confirmCancelBtn) confirmCancelBtn.onclick = () => confirmModal.style.display = "none";
  }
  if(userTicketCloseBtn) userTicketCloseBtn.onclick = userCloseCurrentTicket;

  // Polling
  const userTicketsPoller = createSmartPoll(
      async () => {
         if(!CURRENT_USER) return;
         try {
            const res = await apiCall("user_get_tickets");
            if(res.ok) {
                const newTickets = res.tickets || [];
                // Merge logic for optimistic updates
                newTickets.forEach(nt => {
                    const local = CURRENT_TICKETS.find(lt => lt.id === nt.id);
                    if(local && local.status === 'closed') nt.status = 'closed';
                });
                CURRENT_TICKETS = newTickets;

                if(SELECTED_TICKET_ID) {
                    const t = CURRENT_TICKETS.find(x=>x.id===SELECTED_TICKET_ID);
                    if(t) selectTicketUser(SELECTED_TICKET_ID); 
                }
                renderTicketsListUser();
            }
         } catch(e){}
      },
      () => ticketsTabEl.classList.contains("active")
  );

  // INIT
  async function initApp() {
    if (!tg) { userLineEl.textContent = "Deschide din Telegram."; userLineEl.style.display="block"; return; }
    tg.ready(); tg.expand();
    
    const user = tg.initDataUnsafe?.user || { id: "test", username: "TestUser", first_name: "Test" };
    
    CURRENT_USER = { id: user.id, username: user.username, credits: 0 };
    try {
      const res = await apiCall("init", {});
      if(!res.ok) throw new Error(res.error || "Init failed");
      
      CURRENT_USER.credits = res.user.credits;
      CURRENT_SHOP = res.shop;
      CURRENT_TICKETS = res.tickets || [];
      renderUserHeader();
      renderCategories(CURRENT_SHOP); 
      renderTicketsListUser();
      showShopTab();
    } catch (err) {
      console.error(err);
      userLineEl.innerHTML = `<span style="color: #ff4b4b">Err: ${err.message}</span>`;
      userLineEl.style.display="block"; 
    }
  }
  initApp();
}
document.addEventListener("DOMContentLoaded", initUserApp);
