// app.js - FIXED: Handles Access Denied Screen Properly

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
    if (diff < 60) return "now"; const m = Math.floor(diff/60); if(m<60) return `${m}m`;
    const h = Math.floor(m/60); return h<24 ? `${h}h` : `${Math.floor(h/24)}d`;
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
    
    const lastReadAdmin = Number(t.last_read_admin || 0);
    const lastUserMsgId = Number(lastUserM.id);

    if (lastReadAdmin >= lastUserMsgId) {
        return { targetId: lastUserM.id, text: `Seen ${t.last_read_admin_at ? timeAgo(t.last_read_admin_at) : ''}` };
    }
    return null;
}

// --- FIXED HELPER: Calculate Unread ---
function calculateUserUnread(ticket) {
    if (!ticket || !ticket.messages) return 0;
    const lastReadId = Number(ticket.last_read_user || 0);
    const count = ticket.messages.filter(m => m.from === 'admin' && Number(m.id) > lastReadId).length;
    return count;
}

// 3. UI RENDER
function renderDiscordMessages(msgs, { container, canReply, onReply, onJumpTo, seenConfig }) {
  if (!container) return;
  const wasNearBottom = container.scrollHeight - (container.scrollTop + container.clientHeight) < 150;
  if (!msgs?.length) {
      if (!container.querySelector('.chat-placeholder')) container.innerHTML = `<div class="chat-placeholder"><div class="icon">💬</div><p>Start conversation...</p></div>`;
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
    const content = m.deleted ? "Message deleted" : m.text;
    const btns = (canReply && !m.deleted) ? `<button class="btn-reply-mini" title="Reply">↩ Reply</button>` : '';

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
  let STATE = { user: null, shop: null, tickets: [], selTicketId: null, sending: false, buying: false, generating: false };
  let SELECTED_PRODUCT = null, SELECTED_VARIANT = null;
  let userMode = { type: null, msgId: null, txt: "", sender: "" };
  
  // Elements
  const els = {
      mainWrapper: $("mainAppWrapper"),
      linkError: $("linkAccountError"),
      credits: $("creditsValue"), creditsBtn: $("creditsBtn"), userLine: $("userLine"),
      catGrid: $("categoriesGrid"), prodGrid: $("productsGrid"), 
      viewCat: $("viewCategories"), viewProd: $("viewProducts"),
      backBtn: $("shopBackBtn"), title: $("headerTitle"), emptyMsg: $("emptyProductsMsg"),
      modal: $("productPanel"), mName: $("panelName"), mDesc: $("panelDesc"), mPrice: $("panelPrice"),
      mTypes: $("panelTypesContainer"), mTypesGrid: $("panelTypesGrid"), mBuy: $("panelBuyBtn"),
      mClose: $("panelCloseBtn"), mStatus: $("panelStatus"), mImg: $("panelImg"), mPlace: $("panelImgPlaceholder"),
      chatList: $("chatList"), tTitle: $("ticketTitle"), msgs: $("chatMessages"), 
      input: $("chatInput"), send: $("chatSendBtn"), 
      closeT: $("userTicketCloseBtn"), reopenT: $("userTicketReopenBtn"), 
      menu: $("ticketsMenuToggle"), backdrop: $("ticketsBackdrop"),
      shopTab: $("shopTab"), ticketsTab: $("ticketsTab"), genTab: $("generatorTab"), // New Tab
      shopHead: $("shopHeader"),
      goT: $("goToTicketsBtn"), goGen: $("goToGenBtn"), backShop: $("backToShopBtn"), backGen: $("backFromGenBtn"), inputCont: $(".chat-input"),
      confirm: $("confirmActionModal"), okConf: $("confirmOkBtn"), canConf: $("confirmCancelBtn"),
      creditsM: $("creditsModal"), closeCred: $("closeCreditsModalBtn"),
      // Generator Elements
      genBtnAction: $("btnGenAction"), genResult: $("genResultCard"), genStatus: $("genStatusArea"),
      resPlan: $("resPlan"), resCountry: $("resCountry"), resEmail: $("resEmail"), resCookieArea: $("resCookieArea"), 
      btnCopyCookie: $("btnCopyCookie"), btnCopyEmail: $("btnCopyEmail")
  };

  const setTab = (tabName) => {
    // Reset Views
    els.shopTab.classList.remove("active");
    els.ticketsTab.classList.remove("active");
    els.genTab.classList.remove("active");
    userTicketsPoller.stop();

    if(tabName === 'shop') {
        els.shopTab.classList.add("active");
        show(els.shopHead);
    } else if(tabName === 'tickets') {
        els.ticketsTab.classList.add("active");
        hide(els.shopHead);
        updateActivity(); 
        userTicketsPoller.start();
    } else if(tabName === 'generator') {
        els.genTab.classList.add("active");
        hide(els.shopHead);
    }
  };

  els.goT?.addEventListener("click", () => setTab('tickets'));
  els.backShop?.addEventListener("click", () => setTab('shop'));
  els.goGen?.addEventListener("click", () => setTab('generator'));
  els.backGen?.addEventListener("click", () => setTab('shop'));

  els.creditsBtn?.addEventListener("click", () => show(els.creditsM));
  els.closeCred?.addEventListener("click", () => hide(els.creditsM));
  els.creditsM?.addEventListener("click", (e) => { if(e.target===els.creditsM) hide(els.creditsM); });

  const modeBar = document.createElement("div"); modeBar.className = "chat-mode-bar"; modeBar.style.display = 'none';
  modeBar.innerHTML = `<span class="chat-mode-text"></span><button>Cancel</button>`;
  modeBar.querySelector("button").onclick = () => { userMode = {type:null}; hide(modeBar); };
  els.inputCont?.prepend(modeBar);

  const setReply = (msg) => {
    userMode = { type: "reply", msgId: msg.id, txt: (msg.text||"").slice(0,50), sender: msg.sender||"User" };
    modeBar.querySelector("span").textContent = `Replying to ${userMode.sender}: "${userMode.txt}..."`;
    show(modeBar); els.input.focus();
  };

  const updateChatUI = (t) => {
    if (!els.input || !els.send) return;
    if (!t) { els.input.disabled = els.send.disabled = true; els.input.placeholder = "Select a ticket..."; hide(modeBar); hide(els.closeT); hide(els.reopenT); els.tTitle.textContent = "No ticket"; return; }
    const closed = t.status === "closed";
    els.input.disabled = els.send.disabled = closed; els.input.placeholder = closed ? "Ticket closed." : "Type a message...";
    closed ? (hide(els.closeT), show(els.reopenT), hide(modeBar)) : (show(els.closeT), hide(els.reopenT));
  };
  updateChatUI(null);

  const apiCall = async (action, extra = {}) => {
    try {
        const r = await fetch(API_URL, { method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify({ action, initData: TG_INIT_DATA, ...extra }) });
        
        // Daca serverul raspunde cu 403, cel mai probabil este eroarea de link
        if (r.status === 403) {
            const data = await r.json();
            return data; // Returnam eroarea ca sa o putem procesa
        }
        if (r.status === 401) return { ok: false, error: "auth_failed" };
        
        return await r.json();
    } catch (e) { console.error(e); return { ok: false, error: "network" }; }
  };

  // --- GENERATOR LOGIC ---
  const handleNetflixGenerate = async () => {
    if(STATE.generating) return;
    STATE.generating = true;
    
    // UI Loading
    els.genBtnAction.classList.add("loading");
    els.genBtnAction.querySelector(".btn-txt").textContent = "PROCESSING...";
    hide(els.genResult);
    hide(els.genStatus);

    try {
        const res = await apiCall("generate_netflix");
        
        if (res.ok && res.cookies) {
             // Success
             els.resPlan.textContent = res.details?.plan || "Premium";
             els.resCountry.textContent = res.details?.country || "Global";
             // No more hiding logic - direct assignment
             els.resEmail.value = res.details?.email || "Unknown Email";
             els.resCookieArea.value = res.cookies;
             
             show(els.genResult, 'flex');
        } else {
             // Error Handling
             els.genStatus.className = "status-msg-v2 error";
             show(els.genStatus, 'block');
             
             if (res.error === "missing_role") {
                 els.genStatus.innerHTML = "❌ VIP Role Required. <a href='https://discord.gg/gc2VGGakQM' style='color:#fff;text-decoration:underline'>Join Discord</a>";
             } else if (res.error === "out_of_stock") {
                 els.genStatus.textContent = "❌ Stock Empty. Try later.";
             } else {
                 els.genStatus.textContent = "❌ Error: " + (res.error || "Unknown");
             }
        }
    } catch (e) {
        els.genStatus.textContent = "❌ Network Error";
        els.genStatus.className = "status-msg-v2 error";
        show(els.genStatus, 'block');
    } finally {
        STATE.generating = false;
        els.genBtnAction.classList.remove("loading");
        els.genBtnAction.querySelector(".btn-txt").textContent = "GENERATE ACCOUNT";
    }
  };

  els.genBtnAction?.addEventListener("click", handleNetflixGenerate);
  
  // Copy Cookie (Full)
  els.btnCopyCookie?.addEventListener("click", () => {
      els.resCookieArea.select();
      els.resCookieArea.setSelectionRange(0, 99999); // Mobile compatibility
      document.execCommand('copy');
      
      const originalText = els.btnCopyCookie.innerHTML;
      els.btnCopyCookie.innerHTML = "✓ COPIED";
      setTimeout(() => els.btnCopyCookie.innerHTML = originalText, 2000);
  });

  // Copy Email (Full)
  els.btnCopyEmail?.addEventListener("click", () => {
      els.resEmail.select();
      document.execCommand('copy');
      
      const originalText = els.btnCopyEmail.textContent;
      els.btnCopyEmail.textContent = "✓";
      setTimeout(() => els.btnCopyEmail.textContent = originalText, 1500);
  });
  // -----------------------

  const renderHeader = () => { if(STATE.user) { els.credits.textContent = STATE.user.credits; els.userLine.innerHTML = `User: <b>${STATE.user.username ? "@"+STATE.user.username : "ID "+STATE.user.id}</b>`; }};

  const renderCats = (shop) => {
    els.catGrid.innerHTML = "";
    shop?.categories?.forEach(cat => {
        const d = document.createElement("div"); d.className = "card-visual";
        const img = getImageUrl(cat.image);
        d.innerHTML = `<div class="card-img-container">${img ? `<img src="${img}" class="card-img">` : `<div class="img-placeholder">📁</div>`}<div class="card-overlay"><div class="cat-name">${cat.name}</div><div class="cat-count">${(cat.products||[]).length} products</div></div></div>`;
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
        d.innerHTML = `<div class="card-img-container" style="height:140px;aspect-ratio:unset;">${img ? `<img src="${img}" class="card-img">`:`<div class="img-placeholder">🎁</div>`}</div><div class="prod-info"><div class="prod-title">${p.name}</div><div class="prod-meta"><div class="prod-price">${p.types?.length ? "From ":""}${minP} CRD</div><div class="prod-btn-mini">&rarr;</div></div></div>`;
        d.onclick = () => openModal(p);
        els.prodGrid.appendChild(d);
    });
  };

  els.backBtn.onclick = () => {
    els.viewProd.classList.remove("active-view"); els.viewCat.classList.add("active-view"); hide(els.backBtn); show(els.title);
  };

  const openModal = (p) => {
    SELECTED_PRODUCT = p; SELECTED_VARIANT = null;
    els.mStatus.textContent = ""; els.mStatus.className = "status-message";
    els.mName.textContent = p.name; els.mBuy.disabled = false; els.mBuy.style.opacity = "1"; els.mBuy.textContent = "Buy Now";
    
    const img = getImageUrl(p.image);
    img ? (els.mImg.src = img, show(els.mImg), hide(els.mPlace)) : (hide(els.mImg), show(els.mPlace));

    if (p.types?.length) {
        show(els.mTypes); els.mTypesGrid.innerHTML = "";
        p.types.sort((a,b)=>a.price-b.price).forEach((t, i) => {
            const btn = document.createElement("div"); btn.className = "type-card";
            btn.innerHTML = `
                <div class="type-info"><span class="type-name">${t.name}</span></div>
                <div class="type-meta"><span class="type-price-pill">${t.price} CRD</span><div class="type-radio-circle"></div></div>
            `;
            btn.onclick = () => selVar(t, btn);
            els.mTypesGrid.appendChild(btn);
            if(i===0) selVar(t, btn);
        });
    } else {
        hide(els.mTypes); els.mPrice.textContent = `${p.price} CRD`; els.mDesc.textContent = p.description || "No description.";
    }
    show(els.modal);
  };
  const selVar = (t, btn) => {
    SELECTED_VARIANT = t; Array.from(els.mTypesGrid.children).forEach(c=>c.classList.remove('active')); btn.classList.add('active');
    els.mPrice.textContent = `${t.price} CRD`;
    els.mDesc.textContent = `${SELECTED_PRODUCT.description||""}\n\n🔹 Variant: ${t.name}\n${t.warranty?`🛡️ Warranty: ${t.warranty}\n`:""}${t.description?`📝 Notes: ${t.description}`:""}`;
  };
  const closeModal = () => { hide(els.modal); STATE.buying = false; };
  els.mClose.onclick = closeModal; els.modal.onclick = (e) => e.target===els.modal && closeModal();

  els.mBuy.onclick = async () => {
    if (!SELECTED_PRODUCT || !STATE.user || STATE.buying) return;
    if (SELECTED_PRODUCT.types?.length && !SELECTED_VARIANT) return (els.mStatus.textContent = "Select a variant!", els.mStatus.className = "status-message status-error");

    STATE.buying = true; els.mBuy.disabled = true; els.mBuy.textContent = "Processing...";
    els.mStatus.textContent = "Initializing...";
    
    const payload = { product_id: SELECTED_PRODUCT.id, qty: 1, ...(SELECTED_VARIANT && { type_id: SELECTED_VARIANT.id }) };
    try {
        const res = await apiCall("buy_product", payload);
        if (!res.ok) {
            STATE.buying = false; els.mBuy.disabled = false; els.mBuy.textContent = "Try again";
            els.mStatus.className = "status-message status-error";
            if (res.error === "not_enough_credits") {
                els.mStatus.innerHTML = `Insufficient funds! <span style="text-decoration:underline;cursor:pointer;font-weight:bold" onclick="document.getElementById('creditsModal').style.display='flex'">Add Funds</span>`;
            } else els.mStatus.textContent = "Error: " + res.error;
        } else {
            STATE.user.credits = res.new_balance; els.credits.textContent = STATE.user.credits;
            STATE.tickets.push(res.ticket); renderTickets(); selTicket(res.ticket.id);
            els.mStatus.className = "status-message status-ok"; els.mStatus.textContent = "Success!";
            setTimeout(() => { closeModal(); setTab('tickets'); STATE.buying = false; }, 1000);
            updateActivity(); userTicketsPoller.bumpFast();
        }
    } catch { STATE.buying = false; els.mBuy.disabled = false; els.mStatus.textContent = "Network error."; }
  };

  const renderTickets = () => {
    els.chatList.innerHTML = "";
    if(!STATE.tickets.length) return (els.chatList.innerHTML = '<div style="padding:20px;text-align:center;color:#555;">No tickets found.</div>');
    
    STATE.tickets.sort((a,b) => (a.status===b.status ? b.id-a.id : (a.status==='open'?-1:1))).forEach(t => {
        const item = document.createElement("div"); item.className = "chat-item " + (t.id === STATE.selTicketId ? "active":"");
        item.dataset.ticketId = t.id;
        let unread = (t.id !== STATE.selTicketId) ? calculateUserUnread(t) : 0;
        const lastMsg = t.messages?.length ? t.messages[t.messages.length-1].text : "New ticket";
        item.innerHTML = `<div class="chat-item-header-row"><div class="chat-item-title">${t.product_name||"Order"}</div><div>${unread>0?`<span class="unread-badge">${unread}</span>`:""}<span class="ticket-status-pill ${t.status}">${t.status}</span></div></div><div class="chat-item-line">${lastMsg}</div>`;
        item.onclick = () => { selTicket(t.id); updateActivity(); els.ticketsTab.classList.remove("tickets-drawer-open"); };
        els.chatList.appendChild(item);
    });
  };

  const selTicket = (id) => {
    STATE.selTicketId = id; 
    const t = STATE.tickets.find(x => x.id === id);
    if(t) {
       if(calculateUserUnread(t) > 0) { 
           apiCall("mark_seen", {ticket_id: id}); 
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
      els.reopenT.textContent = "Reopen"; els.reopenT.disabled = false;
      if(res.ok && res.ticket) {
           const idx = STATE.tickets.findIndex(x=>x.id===STATE.selTicketId);
           if(idx>=0) STATE.tickets[idx] = res.ticket;
           renderTickets(); selTicket(res.ticket.id);
      }
  });

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

  // INIT SI GESTIONARE ERORI
  (async () => {
      tg.ready(); tg.expand();
      const unsafe = tg.initDataUnsafe?.user;
      STATE.user = { id: unsafe?.id, username: unsafe?.username||"user", credits: 0 };
      renderHeader();
      
      const res = await apiCall("init", {});
      
      if(res.ok) {
        // Daca totul e ok, afisam magazinul
        STATE.user.credits = res.user.credits; STATE.shop = res.shop; STATE.tickets = res.tickets||[];
        renderHeader(); renderCats(STATE.shop); renderTickets(); setTab('shop');
      } else {
        // --- AICI ESTE FIX-UL PENTRU ECRANUL DE DISCORD ---
        if (res.error === "access_denied_link_required") {
            // Ascundem COMPLET interfata principala
            if(els.mainWrapper) els.mainWrapper.style.display = "none";
            // Afisam ecranul de eroare specific
            if(els.linkError) els.linkError.style.display = "flex";
            return;
        }

        // Alte erori (afisate in header)
        els.userLine.innerHTML = `<span style="color:red">Error: ${res.error||"Auth"}</span>`; show(els.userLine);
      }
  })();
}

document.addEventListener("DOMContentLoaded", initUserApp);

/* ============================
   CONFIG & VARIABLES
   ============================ */
:root {
  --bg-app: #000000;
  --bg-surface: #141414; /* Netflix Dark */
  --bg-surface-hover: #1f1f1f;
  --bg-input: #262626;
  --accent: #E50914; /* Netflix Red */
  --accent-hover: #f40612;
  --accent-glow: rgba(229, 9, 20, 0.4);
  --text-primary: #ffffff;
  --text-secondary: #b3b3b3;
  --text-muted: #6b7280;
  --success: #46d369;
  --danger: #ef4444;
  --radius-xl: 12px;
  --radius-lg: 8px;
  --radius-md: 6px;
  --radius-sm: 4px;
  --font-family: 'Inter', system-ui, -apple-system, sans-serif;
  --font-mono: 'JetBrains Mono', monospace;
  --shadow-card: 0 4px 20px rgba(0,0,0,0.4);
}

*, *::before, *::after { box-sizing: border-box; }

html, body {
  margin: 0; padding: 0; height: 100%; width: 100%;
  overflow: hidden; 
  font-family: var(--font-family);
  background-color: var(--bg-app); color: var(--text-primary);
  /* Subtle Background Gradient */
  background-image: radial-gradient(circle at 50% -10%, #1a0505 0%, var(--bg-app) 50%);
  -webkit-font-smoothing: antialiased;
}

/* ============================
   LAYOUT
   ============================ */
.app-wrapper {
  display: flex; flex-direction: column; height: 100%;
  max-width: 600px; margin: 0 auto;
  background: var(--bg-app); position: relative;
  box-shadow: 0 0 50px rgba(0,0,0,0.5);
}

/* ============================
   RESTRICTED ACCESS SCREENS (Errors)
   ============================ */
.access-error-screen {
    position: fixed;
    inset: 0;
    z-index: 9999;
    background: #050505;
    background-image: 
        radial-gradient(circle at 50% 40%, rgba(255, 24, 67, 0.15) 0%, transparent 60%),
        linear-gradient(to bottom, #0e0f11 0%, #000 100%);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
    animation: fadeIn 0.5s ease-out;
}

/* Glass Card */
.error-card {
    background: rgba(22, 23, 26, 0.6);
    backdrop-filter: blur(20px);
    -webkit-backdrop-filter: blur(20px);
    border: 1px solid rgba(255, 255, 255, 0.08);
    padding: 40px 30px;
    border-radius: 32px;
    width: 100%;
    max-width: 360px;
    text-align: center;
    box-shadow: 0 20px 50px rgba(0,0,0,0.5), inset 0 1px 1px rgba(255,255,255,0.1);
    display: flex;
    flex-direction: column;
    align-items: center;
    transform: translateY(0);
    animation: slideUp 0.6s cubic-bezier(0.16, 1, 0.3, 1);
}

@keyframes slideUp {
    from { opacity: 0; transform: translateY(30px) scale(0.95); }
    to { opacity: 1; transform: translateY(0) scale(1); }
}

/* Animated Lock Icon */
.lock-icon-wrapper {
    width: 80px;
    height: 80px;
    margin-bottom: 24px;
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--accent);
}

.lock-icon-wrapper svg {
    width: 42px;
    height: 42px;
    z-index: 2;
    filter: drop-shadow(0 0 10px rgba(255, 24, 67, 0.5));
}

.lock-glow {
    position: absolute;
    inset: 0;
    background: radial-gradient(circle, rgba(255, 24, 67, 0.2) 0%, transparent 70%);
    border-radius: 50%;
    animation: pulseRed 3s infinite;
}

@keyframes pulseRed {
    0% { transform: scale(0.8); opacity: 0.5; }
    50% { transform: scale(1.2); opacity: 0.8; }
    100% { transform: scale(0.8); opacity: 0.5; }
}

/* Typography */
.error-card h2 {
    font-size: 22px;
    font-weight: 800;
    margin: 0 0 10px;
    color: #fff;
    letter-spacing: -0.5px;
}

.error-card p {
    font-size: 14px;
    line-height: 1.6;
    color: var(--text-secondary);
    margin: 0 0 32px;
    padding: 0 10px;
}

/* Buttons */
.error-actions-modern {
    display: flex;
    flex-direction: column;
    gap: 12px;
    width: 100%;
}

.btn-modern {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
    text-decoration: none;
    font-weight: 600;
    font-size: 14px;
    padding: 14px;
    border-radius: 16px; 
    transition: all 0.2s cubic-bezier(0.2, 0, 0.2, 1);
    position: relative;
    overflow: hidden;
}

/* Telegram Button */
.btn-tg-gradient {
    color: #fff;
    background: linear-gradient(135deg, #2AABEE 0%, #229ED9 100%);
    box-shadow: 0 4px 15px rgba(42, 171, 238, 0.3), inset 0 1px 0 rgba(255,255,255,0.2);
    border: 1px solid rgba(255,255,255,0.1);
}

.btn-tg-gradient:hover {
    transform: translateY(-2px);
    box-shadow: 0 8px 25px rgba(42, 171, 238, 0.4), inset 0 1px 0 rgba(255,255,255,0.2);
}

/* Discord Button */
.btn-discord-glass {
    background: rgba(88, 101, 242, 0.1);
    color: #7289da; 
    border: 1px solid rgba(88, 101, 242, 0.2);
}

.btn-discord-glass:hover {
    background: rgba(88, 101, 242, 0.2);
    border-color: rgba(88, 101, 242, 0.5);
    color: #fff;
    transform: translateY(-2px);
}

.btn-discord-solid {
    background: #5865F2; /* Discord Blurple */
    color: #fff;
    border: none;
    margin-top: 15px;
    box-shadow: 0 4px 15px rgba(88, 101, 242, 0.3);
}
.btn-discord-solid:hover {
    background: #4752c4;
    transform: translateY(-2px);
    box-shadow: 0 8px 20px rgba(88, 101, 242, 0.5);
}

/* ----------------------------------- */

.main-content {
  flex: 1; overflow: hidden; position: relative;
  display: flex; flex-direction: column;
}

::-webkit-scrollbar { width: 4px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: #333; border-radius: 10px; }

/* ============================
   HEADER
   ============================ */
.header-bar {
  display: flex; justify-content: space-between; align-items: center;
  padding: 8px 12px; 
  background: rgba(20, 20, 20, 0.95);
  border-bottom: 1px solid rgba(255,255,255,0.05);
  z-index: 10; flex-shrink: 0; backdrop-filter: blur(10px);
}
.header-left { 
    display: flex; 
    align-items: center; 
    gap: 0px; 
}

/* Back Button Pill */
.btn-icon-back {
  background: var(--bg-surface); 
  border: 1px solid rgba(255,255,255,0.05);
  color: var(--text-secondary);
    
  width: auto; 
  height: 36px; 
  padding: 0 14px 0 8px; 
    
  border-radius: 99px; 
    
  display: flex; 
  align-items: center; 
  justify-content: center;
  gap: 6px; 
    
  cursor: pointer; 
  transition: all 0.2s;
  margin-right: 0; 
}

.btn-icon-back:hover {
    background: var(--bg-surface-hover);
    color: var(--accent);
    border-color: rgba(229, 9, 20, 0.3);
}

.back-btn-text {
    font-size: 13px;
    font-weight: 600;
    color: #fff; 
}
.btn-icon-back:hover .back-btn-text {
    color: var(--accent);
}


/* Logo Container */
.brand-logo { 
    display: flex;
    align-items: center;
    transition: 0.2s; 
    margin-left: -5px; 
    gap: 0px; 
}

.header-logo-img {
    height: 42px;
    width: auto;
    object-fit: contain;
    display: block;
}

.brand-text-suffix {
    font-family: 'Inter', sans-serif;
    font-weight: 800;
    font-size: 20px;
    color: var(--text-primary);
    letter-spacing: 0.5px;
    margin-left: -21px; 
    padding-top: 2px; 
}

.header-right { display: flex; align-items: center; gap: 12px; }

/* Credits Button */
.credits-pill-btn {
  background: rgba(255, 255, 255, 0.1); 
  border: 1px solid rgba(255, 255, 255, 0.1);
  padding: 5px 12px; border-radius: 99px; font-size: 12px;
  display: flex; gap: 6px; align-items: center;
  cursor: pointer; 
  transition: all 0.2s;
  color: var(--text-primary);
  font-family: inherit;
}

.credits-pill-btn:hover {
    background: rgba(255, 255, 255, 0.15);
    transform: scale(1.02);
}

.credits-pill-btn .label { color: #fff; font-weight: 600; opacity: 0.9; }
.credits-pill-btn .value { color: var(--text-primary); font-weight: 700; }
.credits-pill-btn .add-icon { 
    color: #fff; background: var(--accent); 
    border-radius: 50%; width: 14px; height: 14px; 
    display: flex; align-items: center; justify-content: center;
    font-size: 12px; font-weight: bold; margin-left: 2px;
}

.btn-icon {
  background: var(--bg-surface); border: none; color: var(--text-secondary);
  width: 34px; height: 34px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  cursor: pointer; transition: all 0.2s;
}
.btn-icon:hover { background: var(--bg-surface-hover); color: var(--accent); }

.user-info-bar { display: none; background: var(--bg-surface); padding: 8px 20px; font-size: 11px; color: var(--text-muted); text-align: center; flex-shrink: 0; }
.user-info-bar b { color: var(--text-primary); }

/* ============================
   VISUAL SHOP (GRID & IMAGES)
   ============================ */
.tab-section { display: none; flex-direction: column; height: 100%; width: 100%; position: relative; }
.tab-section.active { display: flex; }

/* Views Management */
.shop-view {
  position: absolute; inset: 0; 
  display: flex; flex-direction: column;
  background: var(--bg-app);
  transform: translateX(100%); opacity: 0;
  transition: transform 0.3s cubic-bezier(0.2, 0, 0.2, 1), opacity 0.3s;
  pointer-events: none; overflow-y: auto;
  padding-bottom: 40px;
}
.shop-view.active-view {
  transform: translateX(0); opacity: 1; pointer-events: auto; z-index: 5;
}

.hero-banner { padding: 30px 20px 10px; text-align: left; }
.hero-banner h1 { margin: 0; font-size: 28px; font-weight: 800; background: linear-gradient(to right, #fff, #aaa); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
.hero-banner p { margin: 6px 0 0; font-size: 14px; color: var(--text-secondary); }

/* GRID LAYOUT */
.visual-grid {
  padding: 20px;
  display: grid;
  grid-template-columns: repeat(2, 1fr); 
  gap: 16px;
}

.shop-footer-note { text-align: center; color: #444; font-size: 10px; padding: 20px; grid-column: 1 / -1; }
.empty-products-msg { text-align: center; padding: 40px; color: var(--text-muted); font-size: 14px; grid-column: 1 / -1; }

/* CATEGORY & PRODUCT CARDS */
.card-visual {
  position: relative;
  background: var(--bg-surface);
  border-radius: var(--radius-lg);
  overflow: hidden;
  cursor: pointer;
  border: 1px solid rgba(255,255,255,0.05);
  box-shadow: 0 4px 10px rgba(0,0,0,0.2);
  transition: transform 0.2s, box-shadow 0.2s;
  display: flex; flex-direction: column;
}
.card-visual:active { transform: scale(0.97); }

/* Card Image */
.card-img-container {
  width: 100%;
  aspect-ratio: 1 / 1; 
  position: relative;
  background: #202226;
  overflow: hidden;
}

.card-img {
  width: 100%; height: 100%;
  object-fit: cover;
  transition: transform 0.4s;
}
.card-visual:hover .card-img { transform: scale(1.05); }

/* Gradient Overlay */
.card-overlay {
  position: absolute; bottom: 0; left: 0; right: 0;
  padding: 12px;
  background: linear-gradient(to top, rgba(0,0,0,0.9), rgba(0,0,0,0));
  display: flex; flex-direction: column; justify-content: flex-end;
  height: 60%;
}

/* Category Text */
.cat-name { font-weight: 700; font-size: 15px; color: #fff; text-shadow: 0 2px 4px rgba(0,0,0,0.8); }
.cat-count { font-size: 11px; color: rgba(255,255,255,0.7); margin-top: 2px; }

/* Product Text */
.prod-info {
  padding: 12px;
  display: flex; flex-direction: column;
  flex: 1;
}
.prod-title { font-size: 13px; font-weight: 600; line-height: 1.4; margin-bottom: 6px; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.prod-meta { margin-top: auto; display: flex; justify-content: space-between; align-items: center; }
.prod-price { color: var(--accent); font-weight: 800; font-size: 14px; }
.prod-btn-mini { 
  background: rgba(255,255,255,0.1); width: 24px; height: 24px; 
  border-radius: 50%; display: flex; align-items: center; justify-content: center;
  font-size: 14px; color: #fff; 
}

/* Placeholder */
.img-placeholder {
  display: flex; align-items: center; justify-content: center;
  width: 100%; height: 100%; font-size: 32px;
  background: linear-gradient(135deg, #2a2d32, #1a1c20);
  color: rgba(255,255,255,0.1);
}

/* ============================
   CHAT STYLE
   ============================ */
.chat-mode { height: 100%; overflow: hidden; }
.chat-layout { display: flex; width: 100%; height: 100%; position: relative; }

.chat-sidebar {
  position: absolute; top: 0; left: 0; bottom: 0; width: 280px;
  background: #131417; border-right: 1px solid #222;
  transform: translateX(-100%); transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  z-index: 50; display: flex; flex-direction: column; padding-top: 20px; overflow-y: auto;
}
.tab-section.tickets-drawer-open .chat-sidebar { transform: translateX(0); box-shadow: 10px 0 30px rgba(0,0,0,0.5); }

.chat-item { padding: 14px 20px; border-bottom: 1px solid rgba(255,255,255,0.03); cursor: pointer; flex-shrink: 0; }
.chat-item:hover { background: rgba(255,255,255,0.03); }
.chat-item.active { background: rgba(255, 24, 67, 0.08); border-left: 3px solid var(--accent); }
.chat-item-header-row { display: flex; justify-content: space-between; margin-bottom: 4px; }
.chat-item-title { font-size: 13px; font-weight: 600; color: #fff; }
.chat-item-line { font-size: 11px; color: var(--text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

.ticket-status-pill { font-size: 9px; padding: 2px 6px; border-radius: 4px; text-transform: uppercase; font-weight: 700; margin-left: 4px; }
.ticket-status-pill.open { color: var(--success); background: rgba(70, 211, 105, 0.15); }
.ticket-status-pill.closed { color: var(--text-muted); background: rgba(255,255,255,0.05); }
.unread-badge { background: var(--danger); color: white; border-radius: 10px; padding: 0 5px; font-size: 10px; font-weight: bold; }

.chat-main { flex: 1; display: flex; flex-direction: column; min-width: 0; background: var(--bg-app); height: 100%; }

.chat-navbar {
  height: 56px; display: flex; align-items: center; justify-content: space-between;
  padding: 0 16px; background: rgba(22, 23, 26, 0.95);
  border-bottom: 1px solid rgba(255,255,255,0.05); z-index: 20; flex-shrink: 0;
}
.nav-left { display: flex; align-items: center; gap: 12px; }
.menu-toggle { background: transparent; border: none; padding: 4px; display: flex; flex-direction: column; gap: 4px; cursor: pointer; }
.menu-toggle span { display: block; width: 20px; height: 2px; background: var(--text-secondary); border-radius: 2px; transition: 0.3s; }
.tab-section.tickets-drawer-open .menu-toggle span:nth-child(1) { transform: rotate(45deg) translate(5px, 5px); }
.tab-section.tickets-drawer-open .menu-toggle span:nth-child(2) { opacity: 0; }
.tab-section.tickets-drawer-open .menu-toggle span:nth-child(3) { transform: rotate(-45deg) translate(4px, -4px); }
.chat-title { font-size: 14px; font-weight: 600; color: var(--text-primary); }

.chat-viewport { flex: 1; overflow-y: auto; padding: 16px; display: flex; flex-direction: column; }
.chat-placeholder { margin: auto; text-align: center; color: var(--text-muted); opacity: 0.5; }
.chat-placeholder .icon { font-size: 40px; margin-bottom: 10px; display: block; filter: grayscale(100%); }

.msg-row { display: flex; gap: 12px; margin-bottom: 16px; position: relative; animation: fadeIn 0.2s ease-out; flex-shrink: 0; }
@keyframes fadeIn { from { opacity: 0; transform: translateY(5px); } to { opacity: 1; transform: translateY(0); } }

.msg-avatar {
  width: 36px; height: 36px; border-radius: 50%;
  background: linear-gradient(135deg, var(--accent), #aa0526);
  color: #fff; font-weight: 700; font-size: 14px;
  display: flex; align-items: center; justify-content: center; flex-shrink: 0;
}

.msg-content { flex: 1; min-width: 0; }
.msg-header-line { display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px; }
.msg-meta-group { display: flex; align-items: baseline; gap: 8px; }
.msg-username { font-weight: 600; font-size: 14px; color: var(--text-primary); }
.msg-username--admin { color: var(--success); }
.msg-timestamp { font-size: 10px; color: var(--text-muted); }
.msg-text { font-size: 14px; line-height: 1.5; color: #d1d5db; word-wrap: break-word; }
.msg-text--deleted { color: #555; font-style: italic; }
.msg-reply-preview {
  margin-bottom: 4px; padding: 4px 8px; background: rgba(255,255,255,0.05);
  border-left: 2px solid var(--text-muted); font-size: 11px; color: var(--text-muted);
  border-radius: 0 4px 4px 0; cursor: pointer;
}
.msg-row--highlight { background: rgba(255, 255, 255, 0.05); border-radius: 8px; }
.seen-footer { font-size: 10px; color: #6b7280; text-align: right; margin-top: 2px; font-weight: 500; }
.btn-reply-mini { background: transparent; border: 1px solid rgba(255,255,255,0.1); color: var(--text-muted); font-size: 10px; padding: 2px 8px; border-radius: 4px; cursor: pointer; opacity: 0.6; transition: all 0.2s; }
.btn-reply-mini:hover { opacity: 1; border-color: var(--accent); color: var(--accent); }

.chat-footer {
  padding: 12px; background: var(--bg-surface);
  border-top: 1px solid rgba(255,255,255,0.05);
  display: flex; flex-direction: column; flex-shrink: 0;
}
.chat-mode-bar {
  background: #2a2d32; color: #fff; font-size: 11px; padding: 6px 12px;
  margin-bottom: 8px; border-radius: 6px;
  display: flex; justify-content: space-between; align-items: center;
  border-left: 2px solid var(--accent);
}
.chat-mode-bar button { background: transparent; border: 1px solid #555; color: #aaa; border-radius: 4px; cursor: pointer; }

.input-wrapper {
  display: flex; gap: 8px; align-items: center;
  background: var(--bg-input); border-radius: 24px; padding: 6px 6px 6px 16px;
  border: 1px solid transparent; transition: border-color 0.2s;
}
.input-wrapper:focus-within { border-color: var(--accent); }
#chatInput { flex: 1; background: transparent; border: none; color: #fff; font-size: 14px; outline: none; font-family: var(--font-family); }
.btn-send { background: var(--accent); color: #fff; border: none; width: 32px; height: 32px; border-radius: 50%; display: flex; align-items: center; justify-content: center; cursor: pointer; }

.btn-block-back {
  margin-top: 10px; width: 100%; padding: 12px;
  background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.1);
  border-radius: 12px; color: var(--text-secondary); font-size: 13px; font-weight: 500;
  cursor: pointer; display: flex; align-items: center; justify-content: center;
}
.btn-block-back:hover { background: rgba(255,255,255,0.08); color: var(--text-primary); }
.tickets-backdrop { position: absolute; inset: 0; background: rgba(0,0,0,0.8); opacity: 0; pointer-events: none; transition: 0.3s; z-index: 40; }
.tab-section.tickets-drawer-open .tickets-backdrop { opacity: 1; pointer-events: auto; }

/* =========================================
   MODAL - SIDE-BY-SIDE HEADER
   ========================================= */

.modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.85); backdrop-filter: blur(8px); display: none; align-items: center; justify-content: center; z-index: 100; animation: fadeInModal 0.2s ease-out; }
@keyframes fadeInModal { from { opacity: 0; } to { opacity: 1; } }

.modal-card { 
    width: 90%; 
    max-width: 380px; 
    background: #1a1c20; 
    border: 1px solid rgba(255,255,255,0.1); 
    border-radius: var(--radius-xl); 
    padding: 24px; 
    position: relative; 
    box-shadow: 0 20px 50px rgba(0,0,0,0.6); 
    transform: scale(1); 
    animation: scaleIn 0.2s cubic-bezier(0.175, 0.885, 0.32, 1.275); 

    /* SCROLL & LAYOUT */
    max-height: 90vh; 
    display: flex;
    flex-direction: column;
    overflow: hidden; 
}
@keyframes scaleIn { from { transform: scale(0.9) translateY(10px); } to { transform: scale(1) translateY(0); } }

/* Close Button */
.modal-close {
  position: absolute;
  top: 16px;
  right: 16px;
  background: rgba(0, 0, 0, 0.5); 
  border: 1px solid rgba(255, 255, 255, 0.1);
  color: #fff;
  width: 32px;  
  height: 32px;
  border-radius: 50%;
  cursor: pointer;
  z-index: 60;
  display: flex; align-items: center; justify-content: center;
  font-size: 18px; line-height: 1;
  transition: all 0.2s ease;
}
.modal-close:hover { background: var(--accent); border-color: transparent; }

/* HEADER: SPLIT */
.modal-top-split {
    display: flex;
    align-items: center;
    gap: 16px;
    margin-bottom: 20px;
    padding-bottom: 20px;
    border-bottom: 1px solid rgba(255,255,255,0.08);
}

.modal-img-wrapper {
    width: 100px;
    height: 100px;
    flex-shrink: 0;
    background: #111;
    border-radius: 16px;
    overflow: hidden;
    position: relative;
    border: 1px solid rgba(255,255,255,0.1);
}

.modal-img-wrapper img { width: 100%; height: 100%; object-fit: cover; }
.modal-img-placeholder { position: absolute; top:50%; left:50%; transform:translate(-50%, -50%); font-size: 32px; opacity: 0.5; }

.modal-header-compact {
    flex: 1;
    display: flex;
    flex-direction: column;
    justify-content: center;
}

.modal-header-compact h2 {
    margin: 0 0 8px 0;
    font-size: 20px;
    font-weight: 700;
    line-height: 1.2;
    color: #fff;
    text-align: left; 
}

.modal-price { 
    color: var(--accent); 
    font-weight: 800; 
    font-size: 18px;
    text-align: left; 
}

/* MODAL BODY */
.modal-body {
    flex: 1; 
    overflow-y: auto; 
    min-height: 0; 
    margin-bottom: 12px;
    padding-right: 4px;
}
.modal-body::-webkit-scrollbar { width: 4px; }
.modal-body::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.2); border-radius: 4px; }

/* DESCRIPTION */
.desc-container { margin-bottom: 20px; }
.desc-label { font-size: 12px; font-weight: 600; color: var(--text-muted); margin-bottom: 6px; text-transform: uppercase; }
.modal-desc { font-size: 13px; color: var(--text-secondary); line-height: 1.5; white-space: pre-wrap; margin: 0; text-align: left; }

/* TYPES (Variants) */
.types-section {
    display: flex; flex-direction: column !important;
    width: 100%; margin-bottom: 24px; gap: 10px;
}
.types-label { display: block !important; width: 100%; font-size: 11px; color: var(--text-muted); text-transform: uppercase; font-weight: 700; margin: 0 0 4px 4px; text-align: left; }
.types-grid { display: flex; flex-direction: column !important; gap: 10px; width: 100%; }

.type-card {
    display: flex; align-items: center; justify-content: space-between; width: 100%;
    background: rgba(255, 255, 255, 0.03); border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 12px; padding: 12px 14px; cursor: pointer; transition: all 0.2s;
}
.type-card:hover { background: rgba(255, 255, 255, 0.06); border-color: rgba(255, 255, 255, 0.15); }
.type-card.active { background: linear-gradient(90deg, rgba(255, 24, 67, 0.08) 0%, rgba(255, 24, 67, 0.02) 100%); border: 1px solid var(--accent); }

.type-info { display: flex; flex-direction: column; }
.type-name { font-size: 13px; font-weight: 600; color: #fff; }
.type-meta { display: flex; align-items: center; gap: 10px; }

.type-price-pill { font-size: 11px; font-weight: 700; color: #fff; background: rgba(255, 255, 255, 0.1); padding: 3px 8px; border-radius: 6px; }
.type-card.active .type-price-pill { background: var(--accent); }

.type-radio-circle { width: 18px; height: 18px; border-radius: 50%; border: 2px solid rgba(255, 255, 255, 0.2); position: relative; }
.type-card.active .type-radio-circle { border-color: var(--accent); }
.type-card.active .type-radio-circle::after { content: ''; position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); width: 8px; height: 8px; background: var(--accent); border-radius: 50%; box-shadow: 0 0 8px var(--accent-glow); }

/* FOOTER & STATUS */
.status-message { font-size: 12px; text-align: center; min-height: 16px; margin-bottom: 12px; }
.status-error { color: var(--danger); }
.status-ok { color: var(--success); }

.modal-footer { flex-shrink: 0; }
.btn-primary { background: linear-gradient(135deg, var(--accent), #d6002a); color: #fff; font-weight: 600; border: none; padding: 14px; border-radius: 16px; font-size: 14px; cursor: pointer; box-shadow: 0 0 15px var(--accent-glow); width: 100%; transition: transform 0.1s; }
.btn-primary:active { transform: scale(0.98); }

/* INSTRUCTIONS STEPS */
.instructions-list { text-align: left; margin: 20px 0; display: flex; flex-direction: column; gap: 12px; }
.instruction-step { background: rgba(255,255,255,0.03); padding: 10px; border-radius: 12px; display: flex; align-items: center; gap: 12px; font-size: 13px; border: 1px solid rgba(255,255,255,0.05); }
.step-num { background: var(--accent); color: #fff; width: 24px; height: 24px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: bold; font-size: 12px; flex-shrink: 0; }

/* =========================================
   BUTTONS & CONFIRM MODAL
   ========================================= */

.modal-actions-grid { 
    display: grid; 
    grid-template-columns: 1fr 1fr; 
    gap: 12px; 
    width: 100%;
}

.btn-secondary { 
    background: rgba(255,255,255,0.1); 
    color: #fff; 
    border: none; 
    padding: 14px; 
    border-radius: 16px; 
    cursor: pointer; 
    font-weight: 600; 
    font-size: 14px; 
    transition: 0.2s; 
    width: 100%;
}
.btn-secondary:hover { 
    background: rgba(255,255,255,0.2); 
}

.btn-danger-solid { 
    background: var(--danger); 
    box-shadow: 0 4px 15px rgba(239, 68, 68, 0.4); 
    color: #fff;
}
.btn-danger-solid:hover {
    background: #d32f2f;
}

.btn-sm {
    padding: 6px 12px;
    border-radius: 8px;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s;
}

.btn-danger-ghost { 
    background: rgba(239, 68, 68, 0.15); 
    color: var(--danger); 
    border: 1px solid rgba(239, 68, 68, 0.3); 
}
.btn-danger-ghost:hover {
    background: rgba(239, 68, 68, 0.25);
    border-color: var(--danger);
}

.btn-success-ghost { 
    background: rgba(70, 211, 105, 0.15); 
    color: var(--success); 
    border: 1px solid rgba(70, 211, 105, 0.3); 
}
.btn-success-ghost:hover {
    background: rgba(70, 211, 105, 0.25);
    border-color: var(--success);
}

/* =========================================
   REDESIGNED GENERATOR TAB (DASHBOARD STYLE)
   ========================================= */
.gen-layout-v2 {
    display: flex; flex-direction: column;
    height: 100%; padding: 0;
    overflow-y: auto; overflow-x: hidden;
    background: #000;
}

/* Header */
.gen-header-v2 {
    padding: 24px 20px;
    background: linear-gradient(to bottom, #1a0505 0%, #000 100%);
    border-bottom: 1px solid rgba(255,255,255,0.05);
}

.gen-title-row {
    display: flex; align-items: center; gap: 16px;
}

.netflix-n-badge {
    width: 50px; height: 50px; flex-shrink: 0;
    background: #E50914; color: #fff;
    font-size: 36px; font-weight: 900;
    display: flex; align-items: center; justify-content: center;
    border-radius: 8px;
    box-shadow: 0 0 20px rgba(229, 9, 20, 0.3);
}

.gen-texts h2 { margin: 0; font-size: 20px; font-weight: 700; color: #fff; letter-spacing: -0.5px; }
.vip-badge {
    display: inline-block; font-size: 10px; font-weight: 800;
    background: rgba(255,215,0,0.1); color: #FFD700;
    padding: 2px 6px; border-radius: 4px; margin-top: 4px;
    border: 1px solid rgba(255,215,0,0.3);
}

/* Controls */
.gen-controls {
    padding: 20px;
}

.status-msg-v2 {
    background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1);
    color: #ccc; font-size: 12px; padding: 10px; border-radius: 8px;
    text-align: center; margin-bottom: 12px;
}
.status-msg-v2.error { background: rgba(239, 68, 68, 0.1); color: #ef4444; border-color: rgba(239, 68, 68, 0.3); }

.btn-gen-main {
    width: 100%; height: 50px;
    background: #E50914; color: #fff;
    border: none; border-radius: 8px;
    font-size: 15px; font-weight: 700; letter-spacing: 0.5px;
    cursor: pointer; position: relative;
    box-shadow: 0 4px 15px rgba(229, 9, 20, 0.3);
    transition: transform 0.1s, background 0.2s;
}
.btn-gen-main:active { transform: scale(0.98); background: #b8070f; }
.btn-gen-main.loading { background: #333; pointer-events: none; color: transparent; box-shadow: none; }

/* Loading Spinner */
.btn-spinner {
    position: absolute; top: 50%; left: 50%;
    width: 20px; height: 20px; border: 2px solid rgba(255,255,255,0.3);
    border-top-color: #fff; border-radius: 50%;
    transform: translate(-50%, -50%);
    display: none; animation: spin 0.6s linear infinite;
}
.btn-gen-main.loading .btn-spinner { display: block; }
@keyframes spin { to { transform: translate(-50%, -50%) rotate(360deg); } }

/* Result Panel (Dashboard Card) */
.result-panel-v2 {
    margin: 0 20px; padding: 20px;
    background: #141414; border: 1px solid #333;
    border-radius: 12px;
    display: flex; flex-direction: column; gap: 20px;
    animation: slideUpFade 0.4s ease-out;
}
@keyframes slideUpFade { from { opacity:0; transform:translateY(10px); } to { opacity:1; transform:translateY(0); } }

/* Result Row 1: Plan & Country */
.result-top-row { display: flex; justify-content: space-between; padding-bottom: 16px; border-bottom: 1px solid #262626; }
.res-info-block label { font-size: 10px; color: #666; font-weight: 700; margin-bottom: 4px; display: block; }
.res-info-block .res-value { font-size: 14px; color: #fff; font-weight: 600; }
.res-info-block.right { text-align: right; }

/* Input Fields Style */
.res-field-group label {
    font-size: 11px; color: #888; font-weight: 600; margin-bottom: 8px; display: block;
}

/* Email Input with Copy */
.input-with-copy {
    display: flex; gap: 8px;
}
.input-with-copy input {
    flex: 1; background: #000; border: 1px solid #333; color: #fff;
    padding: 10px 12px; border-radius: 6px; font-family: var(--font-mono); font-size: 13px;
    outline: none;
}
.mini-copy-btn {
    background: #262626; color: #fff; border: 1px solid #333;
    padding: 0 16px; border-radius: 6px; font-size: 11px; font-weight: 700;
    cursor: pointer; transition: 0.2s;
}
.mini-copy-btn:active { background: #444; }

/* Cookie Textarea */
.textarea-wrapper {
    position: relative; margin-bottom: 8px;
}
.textarea-wrapper textarea {
    width: 100%; height: 120px;
    background: #000; border: 1px solid #333;
    color: #46d369; /* Matrix Green for code */
    font-family: var(--font-mono); font-size: 11px;
    padding: 12px; border-radius: 6px; resize: none;
    outline: none; line-height: 1.4;
}

.btn-copy-full {
    width: 100%; padding: 10px;
    background: #fff; color: #000; border: none; border-radius: 6px;
    font-size: 12px; font-weight: 700;
    display: flex; align-items: center; justify-content: center; gap: 6px;
    cursor: pointer;
}
.btn-copy-full:active { background: #ccc; }

.gen-spacer { flex: 1; min-height: 20px; }
.btn-text-simple {
    width: 100%; padding: 20px; background: none; border: none;
    color: #666; font-size: 13px; font-weight: 500; cursor: pointer;
}
.btn-text-simple:hover { color: #fff; }
