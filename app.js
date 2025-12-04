// app.js – Versiune User cu Imagini (Categorii -> Produse)

const API_URL = "https://api.redgen.vip/";

/* ============================
   HELPER – SMART POLLING
   ============================ */
function createSmartPoll(fetchFn, isEnabledFn, options = {}) {
  const minInterval = options.minInterval ?? 3000;
  const maxInterval = options.maxInterval ?? 8000;
  const backoffStep = options.backoffStep ?? 2000;
  const idleThreshold = options.idleThreshold ?? 4;
  let timeoutId = null, active = false, currentInterval = minInterval, idleCount = 0, lastSnapshot = null;
  async function tick() {
    if (!active) return;
    if (!isEnabledFn || !isEnabledFn()) { schedule(maxInterval); return; }
    try {
      const data = await fetchFn();
      if (!active) return;
      if (data !== undefined) {
        const snap = JSON.stringify(data);
        if (lastSnapshot === null || snap !== lastSnapshot) {
          lastSnapshot = snap; idleCount = 0; currentInterval = minInterval;
        } else {
          idleCount++;
          if (idleCount >= idleThreshold) currentInterval = Math.min(maxInterval, currentInterval + backoffStep);
        }
      }
    } catch (e) { console.error("[smartPoll]", e); currentInterval = Math.min(maxInterval, currentInterval + backoffStep); }
    schedule(currentInterval);
  }
  function schedule(delay) { if (!active) return; if (timeoutId) clearTimeout(timeoutId); timeoutId = setTimeout(tick, delay); }
  return { start() { if (active) return; active = true; idleCount = 0; currentInterval = minInterval; tick(); }, stop() { active = false; if (timeoutId) clearTimeout(timeoutId); timeoutId = null; }, bumpFast() { if (!active) return; idleCount = 0; currentInterval = minInterval; schedule(currentInterval); } };
}

/* ============================
   UTILITARE
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

// Fallback image if URL is empty or error
const PLACEHOLDER_IMG = "https://placehold.co/400x300/202226/FFF?text=No+Image";

/* ============================
   MAIN LOGIC
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

  // DOM
  const creditsValueEl = document.getElementById("creditsValue");
  const userLineEl = document.getElementById("userLine");
  
  // Views
  const categoriesView = document.getElementById("categoriesView");
  const categoriesGrid = document.getElementById("categoriesGrid");
  const productsView = document.getElementById("productsView");
  const productsGrid = document.getElementById("productsGrid");
  const currentCatTitle = document.getElementById("currentCatTitle");
  const currentCatDesc = document.getElementById("currentCatDesc");
  const backToCatsBtn = document.getElementById("backToCatsBtn");

  // Modal
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

  // Chat
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
  
  // Confirm Modal
  const confirmModal = document.getElementById("confirmActionModal");
  const confirmOkBtn = document.getElementById("confirmOkBtn");
  const confirmCancelBtn = document.getElementById("confirmCancelBtn");

  // --- NAVIGATION ---
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
    bumpUserActive(); userTicketsPoller.start();
  }

  if (goToTicketsBtn) goToTicketsBtn.addEventListener("click", showTicketsTab);
  if (backToShopBtn) backToShopBtn.addEventListener("click", showShopTab);

  // --- API CALL ---
  function apiCall(action, extraPayload = {}) {
    const payload = { action, user: CURRENT_USER, ...extraPayload };
    return fetch(API_URL, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }).then(async (r) => {
        if (!r.ok) { const txt = await r.text(); throw new Error(`Server Error: ${r.status}`); }
        return r.json();
    });
  }

  // --- HEADER ---
  function renderUserHeader() {
    if (!CURRENT_USER) return;
    creditsValueEl.textContent = CURRENT_USER.credits;
    const name = CURRENT_USER.username ? "@" + CURRENT_USER.username : `ID ${CURRENT_USER.id}`;
    userLineEl.innerHTML = `Utilizator: <b>${name}</b>`;
  }

  // --- SHOP RENDER (VISUAL UPDATE) ---
  
  // 1. Render Categories Grid
  function renderCategories(shop) {
      categoriesGrid.innerHTML = "";
      if (!shop || !shop.categories) return;

      shop.categories.forEach(cat => {
          const card = document.createElement("div");
          card.className = "shop-card category-card";
          
          const imgSrc = cat.image || PLACEHOLDER_IMG;
          
          card.innerHTML = `
             <div class="card-img-wrapper">
                 <img class="shop-card-img" src="${imgSrc}" loading="lazy" onerror="this.src='${PLACEHOLDER_IMG}'" />
                 <div class="card-overlay-title">${cat.name}</div>
             </div>
          `;
          
          card.onclick = () => openCategory(cat);
          categoriesGrid.appendChild(card);
      });
  }

  // 2. Open Category -> Show Products
  function openCategory(cat) {
      CURRENT_CATEGORY = cat;
      currentCatTitle.textContent = cat.name;
      currentCatDesc.textContent = cat.description || "Produse disponibile:";
      
      // Hide Categories, Show Products
      categoriesView.style.display = "none";
      productsView.style.display = "block";
      
      renderCategoryProducts(cat);
      // Scroll top
      shopTabEl.scrollTop = 0;
  }

  function backToCategories() {
      productsView.style.display = "none";
      categoriesView.style.display = "block";
      CURRENT_CATEGORY = null;
  }
  backToCatsBtn.onclick = backToCategories;

  // 3. Render Products Grid
  function renderCategoryProducts(cat) {
      productsGrid.innerHTML = "";
      (cat.products || []).forEach(prod => {
          const card = document.createElement("div");
          card.className = "shop-card product-card";
          
          const imgSrc = prod.image || PLACEHOLDER_IMG;

          card.innerHTML = `
              <div class="card-img-wrapper">
                 <img class="shop-card-img" src="${imgSrc}" loading="lazy" onerror="this.src='${PLACEHOLDER_IMG}'" />
              </div>
              <div class="product-card-details">
                  <div class="prod-name">${prod.name}</div>
                  <div class="prod-price">${prod.price} CRD</div>
                  <button class="btn-buy-mini">Detalii</button>
              </div>
          `;
          card.onclick = () => openProductPanel(prod);
          productsGrid.appendChild(card);
      });
  }

  // --- PRODUCT MODAL ---
  function openProductPanel(prod) {
    SELECTED_PRODUCT = prod;
    panelStatusEl.textContent = ""; panelStatusEl.className = "status-message";
    
    // Set Data
    panelNameEl.textContent = prod.name;
    panelDescEl.textContent = prod.description || "Fără descriere.";
    panelPriceEl.textContent = `${prod.price} CRD`;
    panelImageEl.src = prod.image || PLACEHOLDER_IMG;
    
    // Qty
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
    } catch (err) {
      console.error(err); panelStatusEl.className = "status-message status-error"; panelStatusEl.textContent = "Eroare rețea.";
    }
  }
  panelBuyBtn.onclick = buySelectedProduct;

  // --- TICKET LOGIC (Same as before) ---
  function renderTicketsListUser() {
      // (Păstrăm logica anterioară, doar ne asigurăm că face update corect)
      chatListEl.innerHTML = "";
      if (!CURRENT_TICKETS || CURRENT_TICKETS.length === 0) {
          chatListEl.innerHTML = '<div style="padding:20px; text-align:center; color:#555;">Nu ai tichete.</div>';
          return;
      }
      CURRENT_TICKETS.sort((a,b) => (a.status==='open'?-1:1) || (b.id - a.id));
      CURRENT_TICKETS.forEach(t => {
          const item = document.createElement("div"); item.className = "chat-item";
          if(t.id === SELECTED_TICKET_ID) item.classList.add("active");
          item.onclick = () => { selectTicketUser(t.id); bumpUserActive(); closeTicketsDrawer(); };
          
          let unread = 0; // Calcul simplificat pentru demo
          if(t.id !== SELECTED_TICKET_ID) {
              // Logica unread
          }
          const badgeHtml = unread > 0 ? `<span class="unread-badge">${unread}</span>` : "";
          const stClass = t.status==='open' ? 'open' : 'closed';
          item.innerHTML = `
             <div class="chat-item-header-row">
                <div class="chat-item-title">${t.product_name || "Comandă"}</div>
                <div>${badgeHtml}<span class="ticket-status-pill ${stClass}">${t.status}</span></div>
             </div>
             <div class="chat-item-line">#${t.id}</div>
          `;
          chatListEl.appendChild(item);
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
      userTicketCloseBtn.style.display = t.status==='closed' ? 'none' : 'block';
      chatInputEl.disabled = (t.status === 'closed');
      chatSendBtn.disabled = (t.status === 'closed');
      
      chatMessagesEl.innerHTML = "";
      if(!t.messages?.length) {
           chatMessagesEl.innerHTML = `<div class="chat-placeholder"><p>Începe conversația...</p></div>`;
      } else {
           t.messages.forEach(m => {
               const row = document.createElement("div"); row.className = "msg-row";
               const senderName = m.sender || (m.from==='system'?'System': (m.from==='admin'?'Admin':'Tu'));
               const clsAdmin = m.from==='admin' ? 'msg-username--admin' : '';
               const initial = senderName[0].toUpperCase();
               row.innerHTML = `
                 <div class="msg-avatar">${initial}</div>
                 <div class="msg-content">
                    <div class="msg-header-line">
                       <span class="msg-username ${clsAdmin}">${senderName}</span>
                       <span class="msg-timestamp">${formatTimestamp(m.ts)}</span>
                    </div>
                    <div class="msg-text">${m.text}</div>
                 </div>
               `;
               chatMessagesEl.appendChild(row);
           });
           smartScrollToBottom(chatMessagesEl, true);
      }
  }

  async function sendChatMessage() {
      const txt = chatInputEl.value.trim();
      if(!txt || !SELECTED_TICKET_ID) return;
      chatInputEl.value="";
      try {
          const res = await apiCall("user_send_message", { ticket_id: SELECTED_TICKET_ID, text: txt });
          if(res.ok && res.ticket) {
              const idx = CURRENT_TICKETS.findIndex(x=>x.id===res.ticket.id);
              if(idx!==-1) CURRENT_TICKETS[idx] = res.ticket;
              selectTicketUser(res.ticket.id);
          }
      } catch(e) {}
  }
  chatSendBtn.onclick = sendChatMessage;

  // Drawer
  function closeTicketsDrawer() { ticketsTabEl.classList.remove("tickets-drawer-open"); }
  ticketsMenuToggle.onclick = () => ticketsTabEl.classList.add("tickets-drawer-open");
  ticketsBackdrop.onclick = closeTicketsDrawer;

  // Confirm Close Ticket
  function userCloseCurrentTicket() {
      if (!SELECTED_TICKET_ID) return;
      confirmModal.style.display = "flex";
      confirmOkBtn.onclick = async () => {
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
      confirmCancelBtn.onclick = () => confirmModal.style.display = "none";
  }
  userTicketCloseBtn.onclick = userCloseCurrentTicket;

  // Polling logic simplified for brevity
  const userTicketsPoller = createSmartPoll(
      async () => {
         if(!CURRENT_USER) return;
         try {
            const res = await apiCall("user_get_tickets");
            if(res.ok) {
                CURRENT_TICKETS = res.tickets || [];
                if(SELECTED_TICKET_ID) {
                    const t = CURRENT_TICKETS.find(x=>x.id===SELECTED_TICKET_ID);
                    if(t) selectTicketUser(SELECTED_TICKET_ID); 
                } else {
                    renderTicketsListUser();
                }
            }
         } catch(e){}
      },
      () => ticketsTabEl.classList.contains("active")
  );

  // INIT
  async function initApp() {
    if (!tg) { userLineEl.textContent = "Deschide din Telegram."; userLineEl.style.display="block"; return; }
    tg.ready(); tg.expand();
    const user = tg.initDataUnsafe?.user;
    if (!user) { userLineEl.textContent = "Lipsă date user."; userLineEl.style.display="block"; return; }
    
    CURRENT_USER = { id: user.id, username: user.username, credits: 0 };
    try {
      const res = await apiCall("init", {});
      CURRENT_USER.credits = res.user.credits;
      CURRENT_SHOP = res.shop;
      CURRENT_TICKETS = res.tickets || [];
      renderUserHeader();
      renderCategories(CURRENT_SHOP); // Initial render
      renderTicketsListUser();
      showShopTab();
    } catch (err) { userLineEl.textContent = "Err init."; userLineEl.style.display="block"; }
  }
  initApp();
}
document.addEventListener("DOMContentLoaded", initUserApp);
