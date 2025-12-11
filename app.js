// app.js - UPDATED: Payment Flow Fixes (No Warning, Compact Copy)

const API_URL = "https://api.redgen.vip/";
const $ = (id) => document.getElementById(id);
const show = (el, d = 'flex') => { if(el) el.style.display = d; };
const hide = (el) => { if(el) el.style.display = 'none'; };

let LAST_USER_ACTION = Date.now();
const updateActivity = () => { LAST_USER_ACTION = Date.now(); };
['mousemove', 'keydown', 'touchstart', 'scroll', 'click'].forEach(e => document.addEventListener(e, updateActivity, { passive: true }));

// --- CONFIGURATION ---
const PACKAGES = [
    { credits: 110, price: 5, bonus: 10 },
    { credits: 240, price: 10, bonus: 40 },
    { credits: 500, price: 20, bonus: 100 }
];
const CREDIT_RATE = 20; // 1 USD = 20 CRD

const PAY_METHODS = {
    paypal: { 
        name: "PayPal F&F", 
        icon: "🅿️", 
        detail: "linx02048@gmail.com", 
        warning: "MUST be Friends & Family. If not available in your country, choose another method or you risk losing money." 
    },
    binance: { name: "Binance Pay", icon: "🔶", detail: "458753123" },
    ltc: { name: "Litecoin (LTC)", icon: "Ł", detail: "LWCryENgoijoT8LQWQgGsSSNk9eHgnfaTF" },
    btc: { name: "Bitcoin (BTC)", icon: "₿", detail: "1LReFxV4Zk7cQaWMzSjareRGMoFaQesGoo" }
};

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
    if (!ts) return ""; 
    const d = new Date(ts);
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

// UPDATED COPY FUNCTION: No text change, just icon
const copyToClipboard = (text, btn) => {
    navigator.clipboard.writeText(text).then(() => {
        const originalIcon = "📋";
        const successIcon = "✔";
        btn.innerHTML = successIcon;
        btn.style.color = "#10b981"; // Green color
        setTimeout(() => {
            btn.innerHTML = originalIcon;
            btn.style.color = ""; // Reset color
        }, 1500);
    });
};

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
  let STATE = { user: null, shop: null, tickets: [], selTicketId: null, sending: false, buying: false };
  let SELECTED_PRODUCT = null, SELECTED_VARIANT = null;
  let userMode = { type: null, msgId: null, txt: "", sender: "" };
  let CLAIM_TARGET_ID = null; 
  
  // WIZARD STATE
  let WIZ = { step: 1, amount: 0, credits: 0, method: null, file: null };

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
     shopTab: $("shopTab"), ticketsTab: $("ticketsTab"), purchasesTab: $("purchasesTab"),
     shopHead: $("shopHeader"),
     goT: $("goToTicketsBtn"), goPurch: $("goToPurchasesBtn"), backShop: $("backToShopBtn"), backPurch: $("backFromPurchases"),
     inputCont: $("chatFooter"), 
     confirm: $("confirmActionModal"), okConf: $("confirmOkBtn"), canConf: $("confirmCancelBtn"),
     creditsM: $("creditsModal"), closeCred: $("closeCreditsModalBtn"),
     purchasesList: $("purchasesList"),
     // CLAIM MODAL ELS
     claimM: $("claimWarrantyModal"), claimIn: $("claimReasonInput"), claimSub: $("claimSubmitBtn"), claimCan: $("claimCancelBtn"), claimStatus: $("claimStatus"),
     // WIZARD ELS
     wStep1: $("step-packages"), wStep2: $("step-method"), wStep3: $("step-details"), wStep4: $("step-success"),
     pkgGrid: $("pkgGrid"), custIn: $("customAmtInput"), custRes: $("customCalcRes"),
     wNext1: $("wizNext1"), wBack2: $("wizBack2"), wBack3: $("wizBack3"), wSubmit: $("wizSubmit"), wClose: $("wizCloseFinal"),
     mGrid: $("methodGrid"), payBox: $("paymentDetailsBox"), sumTot: $("sumTotal"), sumCred: $("sumCredits"),
     wStatus: $("wizStatus"), proofSec: $("proofSection"), proofIn: $("proofFileInput"), proofTxt: $("uploadText")
  };

  const setTab = (tabName) => {
    els.shopTab.classList.remove("active");
    els.ticketsTab.classList.remove("active");
    if(els.purchasesTab) els.purchasesTab.classList.remove("active");
    
    userTicketsPoller.stop();

    if(tabName === "shop") {
        els.shopTab.classList.add("active");
        show(els.shopHead);
    } else if(tabName === "tickets") {
        els.ticketsTab.classList.add("active");
        hide(els.shopHead);
        updateActivity();
        userTicketsPoller.start();
    } else if (tabName === "purchases") {
        els.purchasesTab.classList.add("active");
        hide(els.shopHead);
        loadPurchases(); 
    }
  };

  els.goT?.addEventListener("click", () => setTab("tickets"));
  els.goPurch?.addEventListener("click", () => setTab("purchases"));
  els.backShop?.addEventListener("click", () => setTab("shop"));
  els.backPurch?.addEventListener("click", () => setTab("shop"));

  // --- CREDITS WIZARD LOGIC ---
  els.creditsBtn?.addEventListener("click", () => {
    resetWizard();
    show(els.creditsM);
  });
  els.closeCred?.addEventListener("click", () => hide(els.creditsM));
  els.wClose?.addEventListener("click", () => hide(els.creditsM));

  const resetWizard = () => {
    WIZ = { step: 1, amount: 0, credits: 0, method: null, file: null };
    showStep(1);
    els.custIn.value = "";
    els.custRes.textContent = "0 Credits";
    renderPackages();
  };

  const showStep = (step) => {
      [els.wStep1, els.wStep2, els.wStep3, els.wStep4].forEach(el => hide(el));
      if(step === 1) show(els.wStep1);
      if(step === 2) { renderMethods(); show(els.wStep2); }
      if(step === 3) { renderDetails(); show(els.wStep3); }
      if(step === 4) show(els.wStep4);
      WIZ.step = step;
  };

  const renderPackages = () => {
      els.pkgGrid.innerHTML = "";
      PACKAGES.forEach(pkg => {
          const card = document.createElement("div");
          card.className = "pkg-card";
          if(WIZ.amount === pkg.price) card.classList.add("active");
          card.innerHTML = `
            <div class="pkg-top">${pkg.credits} CRD</div>
            <div class="pkg-price">$${pkg.price}</div>
            <div class="pkg-bonus">+${pkg.bonus} Bonus</div>
          `;
          card.onclick = () => {
              WIZ.amount = pkg.price;
              WIZ.credits = pkg.credits + pkg.bonus; 
              els.custIn.value = ""; els.custRes.textContent = "0 Credits"; 
              Array.from(els.pkgGrid.children).forEach(c => c.classList.remove("active"));
              card.classList.add("active");
          };
          els.pkgGrid.appendChild(card);
      });
  };

  els.custIn.addEventListener("input", (e) => {
    const val = parseFloat(e.target.value);
    Array.from(els.pkgGrid.children).forEach(c => c.classList.remove("active")); 
    if(val && val > 0) {
        WIZ.amount = val;
        WIZ.credits = val * CREDIT_RATE;
        els.custRes.textContent = `${WIZ.credits} Credits`;
    } else {
        WIZ.amount = 0; WIZ.credits = 0;
        els.custRes.textContent = "0 Credits";
    }
  });

  els.wNext1.onclick = () => {
      if(WIZ.amount <= 0) return alert("Please select a package or enter an amount.");
      showStep(2);
  };
  els.wBack2.onclick = () => showStep(1);

  const renderMethods = () => {
      els.mGrid.innerHTML = "";
      Object.keys(PAY_METHODS).forEach(key => {
          const m = PAY_METHODS[key];
          const div = document.createElement("div");
          div.className = "method-card";
          div.innerHTML = `<span class="method-icon">${m.icon}</span><span>${m.name}</span>`;
          div.onclick = () => {
              WIZ.method = key;
              showStep(3);
          };
          els.mGrid.appendChild(div);
      });
  };

  els.wBack3.onclick = () => showStep(2);

  const renderDetails = () => {
      const m = PAY_METHODS[WIZ.method];
      els.sumTot.textContent = `Total: $${WIZ.amount}`;
      els.sumCred.textContent = `${WIZ.credits} CRD`;
      
      let html = `<div class="info-block">
        <div class="info-label">Send exactly <b>$${WIZ.amount}</b> to:</div>
        <div class="copy-box">
            <span>${m.detail}</span>
            <button class="btn-icon-copy" onclick="copyToClipboard('${m.detail}', this)">📋</button>
        </div>`;
      
      if(m.warning) {
          html += `<div class="warning-box">${m.warning}</div>`;
      }
      html += `</div>`;
      els.payBox.innerHTML = html;
      els.wStatus.textContent = "";
      els.wStatus.className = "status-message";
      WIZ.file = null; els.proofTxt.textContent = "Click to upload payment screenshot";

      // ALWAYS SHOW PROOF SECTION FOR NOW (Simplified based on request, no warning text)
      show(els.proofSec);
  };

  els.proofIn.addEventListener("change", (e) => {
      if(e.target.files && e.target.files[0]) {
          WIZ.file = e.target.files[0];
          els.proofTxt.textContent = `Selected: ${WIZ.file.name}`;
      }
  });

  els.wSubmit.onclick = async () => {
      // Basic check
      if(!WIZ.file) {
          els.wStatus.textContent = "Screenshot proof is required.";
          els.wStatus.className = "status-message status-error";
          return;
      }

      els.wSubmit.textContent = "Sending...";
      els.wSubmit.disabled = true;

      // Simulate sending
      setTimeout(() => {
          showStep(4);
          els.wSubmit.textContent = "I Sent the Payment";
          els.wSubmit.disabled = false;
      }, 1500);
  };

  // --- REST OF APP LOGIC ---

  // REPLAY BAR
  const modeBar = document.createElement("div"); 
  modeBar.className = "chat-mode-bar"; 
  modeBar.style.display = 'none';
  modeBar.innerHTML = `<span class="chat-mode-text"></span><button style="color:var(--text-muted);border:1px solid var(--text-muted);padding:2px 8px;">Cancel</button>`;
  modeBar.querySelector("button").onclick = () => { userMode = {type:null}; hide(modeBar); };
  if(els.inputCont) els.inputCont.prepend(modeBar);

  const setReply = (msg) => {
    userMode = { type: "reply", msgId: msg.id, txt: (msg.text||"").slice(0,50), sender: msg.sender||"User" };
    modeBar.querySelector("span").textContent = `Replying to ${userMode.sender}: "${userMode.txt}..."`;
    show(modeBar, 'flex'); els.input.focus();
  };

  const updateChatUI = (t) => {
    if (!els.input || !els.send) return;
    if (!t) { els.input.disabled = els.send.disabled = true; els.input.placeholder = "Select a ticket..."; hide(modeBar); hide(els.closeT); els.tTitle.textContent = "No ticket"; return; }
    const closed = t.status === "closed";
    els.input.disabled = els.send.disabled = closed; els.input.placeholder = closed ? "Ticket closed." : "Type a message...";
    closed ? (hide(els.closeT), hide(modeBar)) : (show(els.closeT));
  };
  updateChatUI(null);

  const apiCall = async (action, extra = {}) => {
    try {
        const r = await fetch(API_URL, { method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify({ action, initData: TG_INIT_DATA, ...extra }) });
        if (r.status === 403) return await r.json();
        if (r.status === 401) return { ok: false, error: "auth_failed" };
        return await r.json();
    } catch (e) { console.error(e); return { ok: false, error: "network" }; }
  };

  // --- PURCHASES LOGIC ---
  const loadPurchases = async () => {
      els.purchasesList.innerHTML = '<div class="chat-placeholder">Loading orders...</div>';
      const res = await apiCall("user_get_purchases", {});
      els.purchasesList.innerHTML = '';
      if(res.ok && res.purchases && res.purchases.length) {
          res.purchases.sort((a,b) => b.id - a.id).forEach(p => renderPurchaseItem(p));
      } else {
          els.purchasesList.innerHTML = '<div class="chat-placeholder">No orders found.</div>';
      }
  };

  const renderPurchaseItem = (p) => {
      const card = document.createElement("div"); card.className = "purchase-card";
      const dateStr = formatTimestamp(p.created_at);
      
      let warrantyBadge = "";
      let isWarrantyActive = false;
      
      if(p.warranty_ends_at) {
          const expiryDate = new Date(p.warranty_ends_at); 
          const now = new Date();
          isWarrantyActive = expiryDate.getTime() > now.getTime();
          
          if(isWarrantyActive) {
              const diffTime = Math.abs(expiryDate - now);
              const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
              warrantyBadge = `<span class="badge-warranty active">Warranty Active (${diffDays}d left)</span>`;
          } else {
              warrantyBadge = `<span class="badge-warranty expired">Warranty Expired</span>`;
          }
      } else {
          warrantyBadge = `<span class="badge-warranty expired">No Warranty</span>`;
      }

      card.innerHTML = `
        <div class="pch-header">
            <span class="pch-id">#${p.id}</span>
            <span class="pch-date">${dateStr}</span>
        </div>
        <div class="pch-body">
            <div class="pch-title">${p.product_name}</div>
            <div class="pch-info">Total: ${p.total_price} CRD</div>
            <div style="margin-top:8px;">${warrantyBadge}</div>
        </div>
        <div class="pch-actions">
            <button class="btn-sm ${isWarrantyActive ? 'btn-support-active' : 'btn-support-disabled'}">
                ${isWarrantyActive ? '🛠️ Support / Claim' : '⛔ Support Ended'}
            </button>
        </div>
      `;
      
      const btn = card.querySelector("button");
      if(isWarrantyActive) {
          btn.onclick = () => openClaimModal(p);
      } else {
          btn.disabled = true;
      }
      els.purchasesList.appendChild(card);
  };

  const openClaimModal = (p) => {
      CLAIM_TARGET_ID = p.id;
      els.claimIn.value = ""; 
      els.claimStatus.textContent = ""; 
      els.claimStatus.className = "status-message";
      show(els.claimM);
  };

  els.claimCan.onclick = () => { hide(els.claimM); CLAIM_TARGET_ID = null; };
  els.claimM.onclick = (e) => { if(e.target===els.claimM) { hide(els.claimM); CLAIM_TARGET_ID = null; }};

  els.claimSub.onclick = async () => {
      if(!CLAIM_TARGET_ID) return;
      const reason = els.claimIn.value.trim();
      
      if(!reason) {
          els.claimStatus.textContent = "Please describe the issue.";
          els.claimStatus.className = "status-message status-error";
          return;
      }
      
      els.claimSub.textContent = "Sending...";
      els.claimSub.disabled = true;
      
      const res = await apiCall("user_claim_warranty", { ticket_id: CLAIM_TARGET_ID, reason: reason });
      
      els.claimSub.textContent = "Submit Claim";
      els.claimSub.disabled = false;
      
      if(res.ok) {
          hide(els.claimM);
          setTab("tickets");
          userTicketsPoller.bumpFast();
      } else {
          els.claimStatus.textContent = "Error: " + (res.error === "warranty_expired" ? "Warranty Expired!" : res.error);
          els.claimStatus.className = "status-message status-error";
      }
  };

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
    els.mDesc.textContent = `${SELECTED_PRODUCT.description||""}\n\n🔹 Variant: ${t.name}\n${t.warranty_days?`🛡️ Warranty: ${t.warranty_days} days\n`:""}${t.description?`📝 Notes: ${t.description}`:""}`;
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
            els.mStatus.className = "status-message status-ok"; els.mStatus.textContent = "Success!";
            setTimeout(() => { closeModal(); setTab("tickets"); STATE.buying = false; }, 1000);
            updateActivity(); userTicketsPoller.bumpFast();
        }
    } catch { STATE.buying = false; els.mBuy.disabled = false; els.mStatus.textContent = "Network error."; }
  };

  const renderTickets = () => {
    els.chatList.innerHTML = "";
    if(!STATE.tickets.length) return (els.chatList.innerHTML = '<div style="padding:20px;text-align:center;color:#555;">No open tickets.</div>');
    
    STATE.tickets.sort((a,b) => b.id-a.id).forEach(t => {
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
            if(idx>=0) STATE.tickets[idx] = res.ticket;
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
              renderTickets(); selTicket(STATE.selTicketId); 
          }
      };
      els.canConf.onclick = () => hide(els.confirm);
      els.confirm.onclick = (e) => { if(e.target===els.confirm) hide(els.confirm); }
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

  // INIT
  (async () => {
      tg.ready(); tg.expand();
      const unsafe = tg.initDataUnsafe?.user;
      STATE.user = { id: unsafe?.id, username: unsafe?.username||"user", credits: 0, has_successful_payments: false }; 
      renderHeader();
      const res = await apiCall("init", {});
      if(res.ok) {
        STATE.user.credits = res.user.credits; 
        STATE.shop = res.shop; 
        STATE.tickets = res.tickets||[];
        if(res.user.has_successful_payments !== undefined) STATE.user.has_successful_payments = res.user.has_successful_payments;
        
        renderHeader(); renderCats(STATE.shop); renderTickets(); setTab("shop");
      } else {
        if (res.error === "access_denied_link_required") {
            if(els.mainWrapper) els.mainWrapper.style.display = "none";
            if(els.linkError) els.linkError.style.display = "flex";
            return;
        }
        els.userLine.innerHTML = `<span style="color:red">Error: ${res.error||"Auth"}</span>`; show(els.userLine);
      }
  })();
}

document.addEventListener("DOMContentLoaded", initUserApp);
