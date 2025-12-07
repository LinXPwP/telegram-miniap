// app.js - FIXED SEEN & UNREAD WITH NUMERIC IDs

const API_URL = "https://api.redgen.vip/";
const $ = (id) => document.getElementById(id);
const show = (el, d = 'flex') => { if(el) el.style.display = d; };
const hide = (el) => { if(el) el.style.display = 'none'; };

let LAST_USER_ACTION = Date.now();
const updateActivity = () => { LAST_USER_ACTION = Date.now(); };
['mousemove', 'keydown', 'touchstart', 'scroll', 'click'].forEach(e => document.addEventListener(e, updateActivity, { passive: true }));

// 1. SMART POLLING
function createSmartPoll(fetchFn, isEnabledFn) {
  let timeoutId, active = false, isRunning = false;
  const tick = async () => {
    if (!active) return;
    let delay = document.hidden ? 60000 : (Date.now() - LAST_USER_ACTION > 45000 ? 10000 : 3000);
    if (isEnabledFn && !isEnabledFn()) { schedule(60000); return; }
    try { isRunning = true; await fetchFn(); } catch (e) { delay = 10000; } 
    finally { isRunning = false; schedule(delay); }
  };
  const schedule = (ms) => { if (active) { clearTimeout(timeoutId); timeoutId = setTimeout(tick, ms); }};
  
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && active && !isRunning && (!isEnabledFn || isEnabledFn())) { clearTimeout(timeoutId); tick(); }
  });

  return {
    start: () => { if (!active) { active = true; updateActivity(); tick(); } },
    stop: () => { active = false; clearTimeout(timeoutId); },
    bumpFast: () => { updateActivity(); if (active) { clearTimeout(timeoutId); schedule(100); } }
  };
}

// 2. UTILS
const formatTimestamp = (ts) => {
    if (!ts) return ""; const d = new Date(ts);
    return isNaN(d.getTime()) ? "" : `${String(d.getDate()).padStart(2,"0")}/${String(d.getMonth()+1).padStart(2,"0")}, ${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`;
};
const timeAgo = (ts) => {
    if (!ts) return ""; const diff = Math.floor((new Date() - new Date(ts)) / 1000);
    if (diff < 60) return "acum"; const m = Math.floor(diff/60); if(m<60) return `${m}m`;
    const h = Math.floor(m/60); return h<24 ? `${h}h` : `${Math.floor(h/24)}z`;
};
const smartScrollToBottom = (el, force) => {
    if (!el) return;
    if (force || (el.scrollHeight - (el.scrollTop + el.clientHeight) < 150)) requestAnimationFrame(() => el.scrollTop = el.scrollHeight);
};
const getImageUrl = (s) => s?.trim() ? s : null;

// --- FIXED HELPER: Get Seen Config ---
function getSeenConfig(t) {
    if (!t || !t.messages) return null;
    const userMsgs = t.messages.filter(m => m.from === 'user' && !m.deleted);
    if (userMsgs.length === 0) return null;
    
    const lastUserM = userMsgs[userMsgs.length - 1];
    
    // Convert to number for strict comparison (Fixes the NaN issue)
    const lastReadAdmin = Number(t.last_read_admin || 0);
    const lastUserMsgId = Number(lastUserM.id);

    // Daca adminul a citit un mesaj cu ID >= ID-ul ultimului mesaj trimis de user
    if (lastReadAdmin >= lastUserMsgId) {
        return { targetId: lastUserM.id, text: `Văzut ${t.last_read_admin_at ? timeAgo(t.last_read_admin_at) : ''}` };
    }
    return null;
}

// --- FIXED HELPER: Calculate Unread ---
function calculateUserUnread(ticket) {
    if (!ticket || !ticket.messages) return 0;
    
    const lastReadId = Number(ticket.last_read_user || 0);
    
    // Count messages from admin that have an ID strictly greater than lastReadId
    const count = ticket.messages.filter(m => 
        m.from === 'admin' && Number(m.id) > lastReadId
    ).length;

    return count;
}

// 3. UI RENDER
function renderDiscordMessages(msgs, { container, canReply, onReply, onJumpTo, seenConfig }) {
  if (!container) return;
  const wasNearBottom = container.scrollHeight - (container.scrollTop + container.clientHeight) < 150;
  if (!msgs?.length) {
     if (!container.querySelector('.chat-placeholder')) container.innerHTML = `<div class="chat-placeholder"><div class="icon">💬</div><p>Începe conversația...</p></div>`;
     return;
  }
  container.querySelector('.chat-placeholder')?.remove();
  
  const msgMap = Object.fromEntries(msgs.map(m => [m.id, m]));
  const renderedIds = new Set();

  msgs.forEach(m => {
    if(!m) return; renderedIds.add(String(m.id));
    let row = container.querySelector(`.msg-row[data-message-id="${m.id}"]`);
    
    const replyHtml = m.reply_to && msgMap[m.reply_to] ? `
        <div class="msg-reply-preview" data-jump-id="${msgMap[m.reply_to].id}">
            <strong style="margin-right:5px;">${msgMap[m.reply_to].sender||"User"}</strong><span>${(msgMap[m.reply_to].text||"").slice(0,50)}...</span>
        </div>` : '';
    const sender = m.sender || (m.from === "system" ? "System" : "User");
    const content = m.deleted ? "Mesaj șters" : m.text;
    const btns = (canReply && !m.deleted) ? `<button class="btn-reply-mini" title="Răspunde">↩ Reply</button>` : '';

    const html = `
        <div class="msg-avatar">${(sender||"?")[0].toUpperCase()}</div>
        <div class="msg-content">
            <div class="msg-header-line">
                <div class="msg-meta-group"><span class="msg-username ${m.from==="admin"?"msg-username--admin":""}">${sender}</span><span class="msg-timestamp">${formatTimestamp(m.ts)}</span></div>
                ${btns}
            </div>
            <div class="msg-bubble">${replyHtml}<div class="msg-text ${m.deleted?"msg-text--deleted":""}">${content}</div></div>
            <div class="seen-footer"></div>
        </div>`;

    if (!row) {
        row = document.createElement("div"); row.className = "msg-row"; row.dataset.messageId = m.id;
        row.innerHTML = html; container.appendChild(row);
        row.querySelector('.btn-reply-mini')?.addEventListener('click', (e) => { e.stopPropagation(); onReply?.(m); });
        row.querySelector('.msg-reply-preview')?.addEventListener('click', (e) => { e.stopPropagation(); onJumpTo?.(e.currentTarget.dataset.jumpId); });
    } else {
         const textEl = row.querySelector('.msg-text');
         if (textEl && textEl.textContent !== content) {
             textEl.textContent = content;
             if(m.deleted) textEl.className = "msg-text msg-text--deleted";
         }
    }

    // HANDLE SEEN FOOTER
    const seenEl = row.querySelector('.seen-footer');
    if (seenEl) {
        if (seenConfig && String(m.id) === String(seenConfig.targetId)) {
            seenEl.textContent = seenConfig.text;
            seenEl.style.display = 'block';
        } else {
            seenEl.textContent = '';
            seenEl.style.display = 'none';
        }
    }
  });

  Array.from(container.children).forEach(c => { if(c.dataset.messageId && !renderedIds.has(c.dataset.messageId)) c.remove(); });
  smartScrollToBottom(container, wasNearBottom);
}

// 4. MAIN APP
function initUserApp() {
  const tg = window.Telegram?.WebApp;
  if (!tg?.initData) {
     hide($("mainAppWrapper")); show($("onlyTelegramError"));
     return console.warn("Access Denied: Not in Telegram.");
  }

  const TG_INIT_DATA = tg.initData;
  let STATE = { user: null, shop: null, tickets: [], selTicketId: null, sending: false, buying: false };
  let SELECTED_PRODUCT = null, SELECTED_VARIANT = null;
  let userMode = { type: null, msgId: null, txt: "", sender: "" };
  
  // Elements
  const els = {
     credits: $("creditsValue"), creditsBtn: $("creditsBtn"), userLine: $("userLine"),
     catGrid: $("categoriesGrid"), prodGrid: $("productsGrid"), 
     viewCat: $("viewCategories"), viewProd: $("viewProducts"),
     backBtn: $("shopBackBtn"), title: $("headerTitle"), emptyMsg: $("emptyProductsMsg"),
     // Modal
     modal: $("productPanel"), mName: $("panelName"), mDesc: $("panelDesc"), mPrice: $("panelPrice"),
     mTypes: $("panelTypesContainer"), mTypesGrid: $("panelTypesGrid"), mBuy: $("panelBuyBtn"),
     mClose: $("panelCloseBtn"), mStatus: $("panelStatus"), mImg: $("panelImg"), mPlace: $("panelImgPlaceholder"),
     // Chat
     chatList: $("chatList"), tTitle: $("ticketTitle"), msgs: $("chatMessages"), 
     input: $("chatInput"), send: $("chatSendBtn"), 
     closeT: $("userTicketCloseBtn"), reopenT: $("userTicketReopenBtn"), 
     menu: $("ticketsMenuToggle"), backdrop: $("ticketsBackdrop"),
     shopTab: $("shopTab"), ticketsTab: $("ticketsTab"), shopHead: $("shopHeader"),
     goT: $("goToTicketsBtn"), backShop: $("backToShopBtn"), inputCont: $(".chat-input"),
     confirm: $("confirmActionModal"), okConf: $("confirmOkBtn"), canConf: $("confirmCancelBtn"),
     creditsM: $("creditsModal"), closeCred: $("closeCreditsModalBtn")
  };

  // Nav
  const setTab = (isShop) => {
    if(isShop) { els.shopTab.classList.add("active"); els.ticketsTab.classList.remove("active"); show(els.shopHead); userTicketsPoller.stop(); }
    else { els.shopTab.classList.remove("active"); els.ticketsTab.classList.add("active"); hide(els.shopHead); updateActivity(); userTicketsPoller.start(); }
  };
  els.goT?.addEventListener("click", () => setTab(false));
  els.backShop?.addEventListener("click", () => setTab(true));

  // Credits Modal
  els.creditsBtn?.addEventListener("click", () => show(els.creditsM));
  els.closeCred?.addEventListener("click", () => hide(els.creditsM));
  els.creditsM?.addEventListener("click", (e) => { if(e.target===els.creditsM) hide(els.creditsM); });

  // Chat Mode UI
  const modeBar = document.createElement("div"); modeBar.className = "chat-mode-bar"; modeBar.style.display = 'none';
  modeBar.innerHTML = `<span class="chat-mode-text"></span><button>Anulează</button>`;
  modeBar.querySelector("button").onclick = () => { userMode = {type:null}; hide(modeBar); };
  els.inputCont?.prepend(modeBar);

  const setReply = (msg) => {
    userMode = { type: "reply", msgId: msg.id, txt: (msg.text||"").slice(0,50), sender: msg.sender||"User" };
    modeBar.querySelector("span").textContent = `Răspunzi lui ${userMode.sender}: "${userMode.txt}..."`;
    show(modeBar); els.input.focus();
  };

  const updateChatUI = (t) => {
    if (!els.input || !els.send) return;
    if (!t) { els.input.disabled = els.send.disabled = true; els.input.placeholder = "Alege un tichet..."; hide(modeBar); hide(els.closeT); hide(els.reopenT); els.tTitle.textContent = "Niciun tichet"; return; }
    const closed = t.status === "closed";
    els.input.disabled = els.send.disabled = closed; els.input.placeholder = closed ? "Tichet închis." : "Scrie un mesaj...";
    closed ? (hide(els.closeT), show(els.reopenT), hide(modeBar)) : (show(els.closeT), hide(els.reopenT));
  };
  updateChatUI(null);

  // API
  const apiCall = async (action, extra = {}) => {
    try {
        const r = await fetch(API_URL, { method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify({ action, initData: TG_INIT_DATA, ...extra }) });
        if (r.status === 401) return { ok: false, error: "auth_failed" };
        return await r.json();
    } catch (e) { console.error(e); return { ok: false, error: "network" }; }
  };

  const renderHeader = () => { if(STATE.user) { els.credits.textContent = STATE.user.credits; els.userLine.innerHTML = `Utilizator: <b>${STATE.user.username ? "@"+STATE.user.username : "ID "+STATE.user.id}</b>`; }};

  // Shop Logic
  const renderCats = (shop) => {
    els.catGrid.innerHTML = "";
    shop?.categories?.forEach(cat => {
        const d = document.createElement("div"); d.className = "card-visual";
        const img = getImageUrl(cat.image);
        d.innerHTML = `<div class="card-img-container">${img ? `<img src="${img}" class="card-img">` : `<div class="img-placeholder">📁</div>`}<div class="card-overlay"><div class="cat-name">${cat.name}</div><div class="cat-count">${(cat.products||[]).length} produse</div></div></div>`;
        d.onclick = () => {
            els.viewCat.classList.remove("active-view"); els.viewProd.classList.add("active-view"); hide(els.title);
            show(els.backBtn); els.backBtn.querySelector(".back-btn-text").textContent = cat.name;
            renderProds(cat.products||[]);
        };
        els.catGrid.appendChild(d);
    });
  };

  const renderProds = (prods) => {
    els.prodGrid.innerHTML = "";
    if(!prods.length) { show(els.emptyMsg); return; }
    hide(els.emptyMsg);
    prods.forEach(p => {
        const d = document.createElement("div"); d.className = "card-visual";
        const img = getImageUrl(p.image);
        const minP = p.types?.length ? Math.min(...p.types.map(t=>Number(t.price||0))) : p.price;
        d.innerHTML = `<div class="card-img-container" style="height:140px;aspect-ratio:unset;">${img ? `<img src="${img}" class="card-img">`:`<div class="img-placeholder">🎁</div>`}</div><div class="prod-info"><div class="prod-title">${p.name}</div><div class="prod-meta"><div class="prod-price">${p.types?.length ? "De la ":""}${minP} CRD</div><div class="prod-btn-mini">&rarr;</div></div></div>`;
        d.onclick = () => openModal(p);
        els.prodGrid.appendChild(d);
    });
  };

  els.backBtn.onclick = () => {
    els.viewProd.classList.remove("active-view"); els.viewCat.classList.add("active-view"); hide(els.backBtn); show(els.title);
  };

  // Modal
  const openModal = (p) => {
    SELECTED_PRODUCT = p; SELECTED_VARIANT = null;
    els.mStatus.textContent = ""; els.mStatus.className = "status-message";
    els.mName.textContent = p.name; els.mBuy.disabled = false; els.mBuy.style.opacity = "1"; els.mBuy.textContent = "Cumpără acum";
    
    const img = getImageUrl(p.image);
    img ? (els.mImg.src = img, show(els.mImg), hide(els.mPlace)) : (hide(els.mImg), show(els.mPlace));

    if (p.types?.length) {
        show(els.mTypes); els.mTypesGrid.innerHTML = "";
        p.types.sort((a,b)=>a.price-b.price).forEach((t, i) => {
            const btn = document.createElement("div"); btn.className = "type-card";
            // NEW STRUCTURE FOR POLISHED LOOK
            btn.innerHTML = `
                <div class="type-radio-indicator"></div>
                <div class="type-details">
                    <div class="type-name">${t.name}</div>
                    <div class="type-price">${t.price} CRD</div>
                </div>
            `;
            btn.onclick = () => selVar(t, btn);
            els.mTypesGrid.appendChild(btn);
            if(i===0) selVar(t, btn);
        });
    } else {
        hide(els.mTypes); els.mPrice.textContent = `${p.price} CRD`; els.mDesc.textContent = p.description || "Fără descriere.";
    }
    show(els.modal);
  };
  const selVar = (t, btn) => {
    SELECTED_VARIANT = t; Array.from(els.mTypesGrid.children).forEach(c=>c.classList.remove('active')); btn.classList.add('active');
    els.mPrice.textContent = `${t.price} CRD`;
    els.mDesc.textContent = `${SELECTED_PRODUCT.description||""}\n\n🔹 Varianta: ${t.name}\n${t.warranty?`🛡️ Garanție: ${t.warranty}\n`:""}${t.description?`📝 Note: ${t.description}`:""}`;
  };
  const closeModal = () => { hide(els.modal); STATE.buying = false; };
  els.mClose.onclick = closeModal; els.modal.onclick = (e) => e.target===els.modal && closeModal();

  els.mBuy.onclick = async () => {
    if (!SELECTED_PRODUCT || !STATE.user || STATE.buying) return;
    if (SELECTED_PRODUCT.types?.length && !SELECTED_VARIANT) return (els.mStatus.textContent = "Selectează o variantă!", els.mStatus.className = "status-message status-error");

    STATE.buying = true; els.mBuy.disabled = true; els.mBuy.textContent = "Se procesează...";
    els.mStatus.textContent = "Se inițializează...";
    
    const payload = { product_id: SELECTED_PRODUCT.id, qty: 1, ...(SELECTED_VARIANT && { type_id: SELECTED_VARIANT.id }) };
    try {
        const res = await apiCall("buy_product", payload);
        if (!res.ok) {
            STATE.buying = false; els.mBuy.disabled = false; els.mBuy.textContent = "Încearcă din nou";
            els.mStatus.className = "status-message status-error";
            if (res.error === "not_enough_credits") {
                els.mStatus.innerHTML = `Fonduri insuficiente! <span style="text-decoration:underline;cursor:pointer;font-weight:bold" onclick="document.getElementById('creditsModal').style.display='flex'">Încarcă</span>`;
            } else els.mStatus.textContent = "Eroare: " + res.error;
        } else {
            STATE.user.credits = res.new_balance; els.credits.textContent = STATE.user.credits;
            STATE.tickets.push(res.ticket); renderTickets(); selTicket(res.ticket.id);
            els.mStatus.className = "status-message status-ok"; els.mStatus.textContent = "Succes!";
            setTimeout(() => { closeModal(); setTab(false); STATE.buying = false; }, 1000);
            updateActivity(); userTicketsPoller.bumpFast();
        }
    } catch { STATE.buying = false; els.mBuy.disabled = false; els.mStatus.textContent = "Eroare rețea."; }
  };

  // Tickets
  const renderTickets = () => {
    els.chatList.innerHTML = "";
    if(!STATE.tickets.length) return (els.chatList.innerHTML = '<div style="padding:20px;text-align:center;color:#555;">Nu ai tichete.</div>');
    
    STATE.tickets.sort((a,b) => (a.status===b.status ? b.id-a.id : (a.status==='open'?-1:1))).forEach(t => {
        const item = document.createElement("div"); item.className = "chat-item " + (t.id === STATE.selTicketId ? "active":"");
        item.dataset.ticketId = t.id;
        
        let unread = 0;
        if (t.id !== STATE.selTicketId) {
             unread = calculateUserUnread(t);
        }

        const lastMsg = t.messages?.length ? t.messages[t.messages.length-1].text : "Tichet nou";
        item.innerHTML = `<div class="chat-item-header-row"><div class="chat-item-title">${t.product_name||"Comandă"}</div><div>${unread>0?`<span class="unread-badge">${unread}</span>`:""}<span class="ticket-status-pill ${t.status}">${t.status}</span></div></div><div class="chat-item-line">${lastMsg}</div>`;
        item.onclick = () => { selTicket(t.id); updateActivity(); els.ticketsTab.classList.remove("tickets-drawer-open"); };
        els.chatList.appendChild(item);
    });
  };

  const selTicket = (id) => {
    STATE.selTicketId = id; 
    const t = STATE.tickets.find(x => x.id === id);
    if(t) {
       const unread = calculateUserUnread(t);
       if(unread > 0) { 
           apiCall("mark_seen", {ticket_id: id}); 
           // Local update for instant feel
           if(t.messages.length) t.last_read_user = t.messages[t.messages.length-1].id; 
       }
    }
    renderTickets();
    if(!t) { els.msgs.innerHTML = ""; updateChatUI(null); return; }
    els.tTitle.textContent = `${t.product_name} #${t.id}`;
    
    const seen = getSeenConfig(t);

    renderDiscordMessages(t.messages, { container: els.msgs, ticket: t, canReply: t.status==="open", onReply: setReply, onJumpTo: (mid) => {
        const el = els.msgs.querySelector(`.msg-row[data-message-id="${mid}"]`);
        if(el) { el.classList.add("msg-row--highlight"); el.scrollIntoView({behavior:"smooth",block:"center"}); setTimeout(()=>el.classList.remove("msg-row--highlight"),1200); }
    }, seenConfig: seen });
    updateChatUI(t);
  };

  const sendMsg = async () => {
    const text = els.input.value.trim();
    if(!text || !STATE.selTicketId || STATE.sending) return;
    STATE.sending = true; els.send.disabled = true; els.input.value = ""; hide(modeBar);
    
    try {
        const res = await apiCall("user_send_message", { ticket_id: STATE.selTicketId, text, reply_to: userMode.type==="reply"?userMode.msgId:null });
        if(res.ok && res.ticket) {
            const idx = STATE.tickets.findIndex(x=>x.id===res.ticket.id);
            if(idx>=0) STATE.tickets[idx] = res.ticket; else STATE.tickets.push(res.ticket);
            renderTickets(); 
            const t = res.ticket;
            const seen = getSeenConfig(t);
            renderDiscordMessages(t.messages, {container: els.msgs, ticket:t, seenConfig: seen}); 
            smartScrollToBottom(els.msgs, true);
        } else if(res.error === "ticket_closed") {
            const t = STATE.tickets.find(x=>x.id===STATE.selTicketId); if(t) t.status="closed"; updateChatUI(t);
        }
    } finally { STATE.sending = false; els.send.disabled = false; setTimeout(()=>els.input.focus(),50); userMode={type:null}; }
  };
  els.send?.addEventListener("click", sendMsg);
  els.input?.addEventListener("keydown", e => { if(e.key==="Enter"&&!e.shiftKey) { e.preventDefault(); sendMsg(); }});

  // Ticket Actions
  els.menu?.addEventListener("click", () => els.ticketsTab.classList.toggle("tickets-drawer-open"));
  els.backdrop?.addEventListener("click", () => els.ticketsTab.classList.remove("tickets-drawer-open"));
  
  els.closeT?.addEventListener("click", () => {
      show(els.confirm);
      els.okConf.onclick = async () => {
          hide(els.confirm);
          if(!STATE.selTicketId) return;
          const res = await apiCall("user_close_ticket", {ticket_id: STATE.selTicketId});
          if(res.ok) {
              const idx = STATE.tickets.findIndex(x=>x.id===STATE.selTicketId);
              if(idx>=0) { STATE.tickets[idx] = res.ticket || {...STATE.tickets[idx], status:'closed'}; }
              renderTickets(); updateChatUI(STATE.tickets[idx]);
          }
      };
      els.canConf.onclick = () => hide(els.confirm);
      els.confirm.onclick = (e) => { if(e.target===els.confirm) hide(els.confirm); }
  });

  els.reopenT?.addEventListener("click", async () => {
      if(!STATE.selTicketId) return;
      els.reopenT.textContent = "..."; els.reopenT.disabled = true;
      const res = await apiCall("user_reopen_ticket", {ticket_id: STATE.selTicketId});
      els.reopenT.textContent = "Redeschide"; els.reopenT.disabled = false;
      if(res.ok && res.ticket) {
           const idx = STATE.tickets.findIndex(x=>x.id===STATE.selTicketId);
           if(idx>=0) STATE.tickets[idx] = res.ticket;
           renderTickets(); selTicket(res.ticket.id);
      }
  });

  // Polling
  const userTicketsPoller = createSmartPoll(async () => {
     if(!STATE.user) return;
     const res = await apiCall("user_get_tickets", {});
     if(res.ok && res.tickets) {
         STATE.tickets = res.tickets;
         if(STATE.selTicketId) {
             const t = STATE.tickets.find(x=>x.id===STATE.selTicketId);
             if(t) {
                const unread = calculateUserUnread(t);
                if(unread>0) { 
                    apiCall("mark_seen", {ticket_id:t.id}); 
                    if(t.messages.length) t.last_read_user=t.messages[t.messages.length-1].id; 
                }
                
                const seen = getSeenConfig(t);
                renderDiscordMessages(t.messages, {container: els.msgs, ticket:t, canReply:t.status==="open", onReply:setReply, seenConfig: seen });
                updateChatUI(t);
             }
         }
         renderTickets();
     }
  }, () => els.ticketsTab.classList.contains("active"));

  // Init
  (async () => {
     tg.ready(); tg.expand();
     const unsafe = tg.initDataUnsafe?.user;
     STATE.user = { id: unsafe?.id, username: unsafe?.username||"user", credits: 0 };
     renderHeader();
     const res = await apiCall("init", {});
     if(res.ok) {
        STATE.user.credits = res.user.credits; STATE.shop = res.shop; STATE.tickets = res.tickets||[];
        renderHeader(); renderCats(STATE.shop); renderTickets(); setTab(true);
     } else {
        els.userLine.innerHTML = `<span style="color:red">Eroare: ${res.error||"Auth"}</span>`; show(els.userLine);
     }
  })();
}

document.addEventListener("DOMContentLoaded", initUserApp);
