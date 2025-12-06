// app.js – R3DG3N (Repaired & Optimized)
const API_URL = "https://api.redgen.vip/";

// Helpers
const $ = (id) => document.getElementById(id);
const show = (el) => { if(el) el.style.display = ''; };
const hide = (el) => { if(el) el.style.display = 'none'; };
const formatTS = (ts) => {
    if(!ts) return ""; const d = new Date(ts);
    return `${d.getDate()}/${d.getMonth()+1} ${d.getHours()}:${String(d.getMinutes()).padStart(2,'0')}`;
};

// Global State
let STATE = { user: null, shop: null, tickets: [], selTicketId: null, sending: false };
let POLLER = null;

// UI Elements (Cached)
const E = {
    chatList: $("chatList"), msgs: $("chatMessages"), input: $("chatInput"), send: $("chatSendBtn"),
    title: $("ticketTitle"), back: $("backToShopBtn"),
    menuBtn: $("ticketsMenuToggle"), backdrop: $("ticketsBackdrop"), ticketsTab: $("ticketsTab"),
    reopen: $("userTicketReopenBtn"), closeT: $("userTicketCloseBtn"),
    catGrid: $("categoriesGrid"), prodGrid: $("productsGrid"),
    viewCat: $("viewCategories"), viewProd: $("viewProducts"),
    modal: $("productPanel"), mBuy: $("panelBuyBtn")
};

// --- API WRAPPER ---
async function api(action, data = {}) {
    const tg = window.Telegram?.WebApp;
    const initData = tg?.initData || "";
    try {
        const r = await fetch(API_URL, {
            method: "POST",
            headers: {"Content-Type": "application/json"},
            body: JSON.stringify({ action, initData, ...data })
        });
        if(r.status === 401) return { error: "auth" };
        return await r.json();
    } catch(e) { return { error: "network" }; }
}

// --- LOGICA DE CHAT & SEEN ---

// 1. Randare Mesaje
function renderMessages(t) {
    if(!t) return;
    E.msgs.innerHTML = "";
    
    // Găsim ultimul mesaj al userului pentru a pune "Seen"
    // Logica reparată: Căutăm ultimul mesaj user valid
    const userMsgs = (t.messages || []).filter(m => m.from === 'user' && !m.deleted);
    const lastUserMsg = userMsgs.length > 0 ? userMsgs[userMsgs.length - 1] : null;

    (t.messages || []).forEach(m => {
        const isMe = m.from === 'user';
        const div = document.createElement("div");
        div.className = "msg-row";
        
        // Verificăm dacă mesajul trebuie marcat ca văzut
        // Fix: Verificăm dacă adminul a citit un mesaj cu ID >= acest mesaj
        let seenHtml = "";
        if (isMe && lastUserMsg && m.id === lastUserMsg.id) {
            if (t.last_read_admin && t.last_read_admin >= m.id) {
                seenHtml = `<div class="seen-footer">Văzut</div>`;
            }
        }

        const senderName = isMe ? "Tu" : (m.sender || "Support");
        const initial = senderName[0].toUpperCase();
        
        div.innerHTML = `
            <div class="msg-avatar" style="${!isMe ? 'background:#333':''}">${initial}</div>
            <div class="msg-content">
                <div class="msg-header-line">
                    <span>${senderName}</span>
                    <span>${formatTS(m.ts)}</span>
                </div>
                <div class="msg-bubble" style="${isMe ? 'background:rgba(255,24,67,0.15);border:1px solid rgba(255,24,67,0.3);':''}">${m.text}</div>
                ${seenHtml}
            </div>
        `;
        E.msgs.appendChild(div);
    });

    // Scroll la fund
    requestAnimationFrame(() => E.msgs.scrollTop = E.msgs.scrollHeight);
}

// 2. Selectare Tichet
function selectTicket(id) {
    STATE.selTicketId = id;
    const t = STATE.tickets.find(x => x.id === id);
    if(!t) return;

    E.title.textContent = `${t.product_name || "Tichet"} #${t.id}`;
    
    // Închidem meniul (Drawer) pe mobil
    E.ticketsTab.classList.remove("tickets-drawer-open");

    // Marcare ca citit de user
    const adminMsgs = (t.messages||[]).filter(m => m.from === 'admin');
    const lastAdminMsg = adminMsgs.length ? adminMsgs[adminMsgs.length-1] : null;
    if(lastAdminMsg && (!t.last_read_user || t.last_read_user < lastAdminMsg.id)) {
        api("mark_seen", { ticket_id: id });
        t.last_read_user = lastAdminMsg.id; // Update local
    }

    renderMessages(t);
    updateChatInput(t);
}

// 3. Status Input
function updateChatInput(t) {
    const closed = t.status === 'closed';
    E.input.disabled = E.send.disabled = closed;
    E.input.placeholder = closed ? "Tichet închis." : "Scrie un mesaj...";
    
    if(closed) { show(E.reopen); hide(E.closeT); } 
    else { hide(E.reopen); show(E.closeT); }
}

// 4. Lista Tichete
function renderTicketList() {
    E.chatList.innerHTML = "";
    if(!STATE.tickets.length) {
        E.chatList.innerHTML = `<div style="padding:20px;color:#777;text-align:center">Niciun tichet.</div>`;
        return;
    }

    // Sortare: Open primele, apoi după ID desc
    const sorted = [...STATE.tickets].sort((a,b) => {
        if(a.status === b.status) return b.id - a.id;
        return a.status === 'open' ? -1 : 1;
    });

    sorted.forEach(t => {
        const el = document.createElement("div");
        el.className = `chat-item ${t.id === STATE.selTicketId ? 'active' : ''}`;
        
        // Calcul unread
        const unread = (t.messages||[]).filter(m => m.from === 'admin' && (!t.last_read_user || m.id > t.last_read_user)).length;
        const badge = unread > 0 ? `<span style="background:var(--accent);color:#fff;padding:1px 6px;border-radius:10px;font-size:10px;margin-left:5px;">${unread}</span>` : '';
        const statusColor = t.status === 'open' ? '#10b981' : '#666';

        const lastMsgObj = (t.messages && t.messages.length) ? t.messages[t.messages.length-1] : null;
        const lastText = lastMsgObj ? lastMsgObj.text : "Fără mesaje";

        el.innerHTML = `
            <div class="chat-item-header-row">
                <div class="chat-item-title">${t.product_name || "Comandă"} ${badge}</div>
                <div style="font-size:10px; color:${statusColor}; font-weight:bold; text-transform:uppercase;">${t.status}</div>
            </div>
            <div class="chat-item-line">${lastMsgObj && lastMsgObj.from==='user'?'Tu: ':''}${lastText}</div>
        `;
        el.onclick = () => selectTicket(t.id);
        E.chatList.appendChild(el);
    });
}

// --- POLLING ---
async function poll() {
    if(!STATE.user) return;
    const res = await api("user_get_tickets");
    if(res.tickets) {
        // Verificăm schimbări pentru update UI
        const oldJson = JSON.stringify(STATE.tickets);
        const newJson = JSON.stringify(res.tickets);
        
        if(oldJson !== newJson) {
            STATE.tickets = res.tickets;
            renderTicketList();
            if(STATE.selTicketId) {
                // Dacă suntem într-un tichet, re-randăm mesajele pentru a vedea "Seen" sau mesaje noi
                const t = STATE.tickets.find(x => x.id === STATE.selTicketId);
                if(t) renderMessages(t);
            }
        }
    }
    POLLER = setTimeout(poll, 3000); // 3 secunde
}

// --- SHOP LOGIC ---
function renderShop(shopData) {
    E.catGrid.innerHTML = "";
    (shopData.categories || []).forEach(cat => {
        const div = document.createElement("div"); div.className = "card-visual";
        div.innerHTML = `
            <div class="card-img-container"><img src="${cat.image||''}" class="card-img" onerror="this.style.display='none'"></div>
            <div class="card-overlay">
                <div class="cat-name">${cat.name}</div>
                <div class="cat-count">${(cat.products||[]).length} produse</div>
            </div>
        `;
        div.onclick = () => showProducts(cat);
        E.catGrid.appendChild(div);
    });
}

function showProducts(cat) {
    E.viewCat.classList.remove("active-view");
    E.viewProd.classList.add("active-view");
    E.prodGrid.innerHTML = "";
    
    // Header Logic
    $("headerTitle").style.display = 'none';
    const backBtn = $("shopBackBtn");
    show(backBtn);
    backBtn.querySelector(".back-btn-text").textContent = cat.name;
    backBtn.onclick = () => {
        E.viewProd.classList.remove("active-view");
        E.viewCat.classList.add("active-view");
        hide(backBtn);
        show($("headerTitle"));
    };

    if(!cat.products?.length) { show($("emptyProductsMsg")); return; }
    hide($("emptyProductsMsg"));

    cat.products.forEach(p => {
        const minPrice = p.types?.length ? Math.min(...p.types.map(x=>Number(x.price))) : p.price;
        const div = document.createElement("div"); div.className = "card-visual";
        div.innerHTML = `
            <div class="card-img-container"><img src="${p.image||''}" class="card-img" onerror="this.style.display='none'"></div>
            <div class="prod-info">
                <div class="prod-title">${p.name}</div>
                <div class="prod-meta"><div class="prod-price">${minPrice} CRD</div></div>
            </div>
        `;
        div.onclick = () => openProduct(p);
        E.prodGrid.appendChild(div);
    });
}

// --- MODAL PRODUCT ---
let SEL_PROD = null, SEL_TYPE = null;
function openProduct(p) {
    SEL_PROD = p; SEL_TYPE = null;
    $("panelName").textContent = p.name;
    $("panelImg").src = p.image || "";
    E.mBuy.textContent = "Cumpără acum"; E.mBuy.disabled = false;
    
    const typesGrid = $("panelTypesGrid"); typesGrid.innerHTML = "";
    const typeCont = $("panelTypesContainer");
    
    if(p.types?.length) {
        show(typeCont);
        p.types.forEach(t => {
            const btn = document.createElement("div"); btn.className = "type-card";
            btn.innerHTML = `<div>${t.name}</div><div style="font-weight:bold;color:var(--accent)">${t.price} CRD</div>`;
            btn.onclick = () => {
                SEL_TYPE = t;
                Array.from(typesGrid.children).forEach(c=>c.classList.remove('active'));
                btn.classList.add('active');
                $("panelPrice").textContent = t.price + " CRD";
            };
            typesGrid.appendChild(btn);
        });
        $("panelPrice").textContent = "Alege";
    } else {
        hide(typeCont);
        $("panelPrice").textContent = p.price + " CRD";
    }
    
    $("panelDesc").textContent = p.description || "";
    show(E.modal);
}
E.mBuy.onclick = async () => {
    if(!SEL_PROD) return;
    if(SEL_PROD.types?.length && !SEL_TYPE) return alert("Alege o variantă!");
    
    E.mBuy.textContent = "Se procesează..."; E.mBuy.disabled = true;
    const res = await api("buy_product", {
        product_id: SEL_PROD.id,
        type_id: SEL_TYPE?.id,
        qty: 1
    });
    
    if(res.ok) {
        alert("Succes!");
        hide(E.modal);
        // Switch to tickets
        $("shopTab").classList.remove("active");
        $("ticketsTab").classList.add("active");
        STATE.tickets.push(res.ticket);
        renderTicketList();
        selectTicket(res.ticket.id);
        // Refresh Credits
        STATE.user.credits = res.new_balance;
        $("creditsValue").textContent = STATE.user.credits;
    } else {
        alert("Eroare: " + res.error);
        E.mBuy.textContent = "Încearcă din nou"; E.mBuy.disabled = false;
    }
};
$("panelCloseBtn").onclick = () => hide(E.modal);


// --- INIT ---
async function init() {
    const tg = window.Telegram?.WebApp;
    tg?.ready(); tg?.expand();

    // Check Auth
    const res = await api("init");
    if(res.error) {
        hide($("mainAppWrapper")); show($("onlyTelegramError"));
        return;
    }

    STATE.user = res.user;
    STATE.shop = res.shop;
    STATE.tickets = res.tickets || [];
    
    $("creditsValue").textContent = STATE.user.credits;
    renderShop(STATE.shop);
    renderTicketList();
    poll();
}

// Events
E.send.onclick = async () => {
    const text = E.input.value.trim();
    if(!text || !STATE.selTicketId) return;
    E.input.value = "";
    
    // Optimistic UI update
    const t = STATE.tickets.find(x => x.id === STATE.selTicketId);
    if(t) {
        t.messages.push({ from: 'user', text, ts: Date.now(), id: 99999999 }); // Fake ID până la refresh
        renderMessages(t);
    }
    
    await api("user_send_message", { ticket_id: STATE.selTicketId, text });
    // Poll-ul va aduce mesajul real confirmat de server
};

E.menuBtn.onclick = () => E.ticketsTab.classList.toggle("tickets-drawer-open");
E.backdrop.onclick = () => E.ticketsTab.classList.remove("tickets-drawer-open");
$("backToShopBtn").onclick = () => {
    $("ticketsTab").classList.remove("active");
    $("shopTab").classList.add("active");
};
$("goToTicketsBtn").onclick = () => {
    $("shopTab").classList.remove("active");
    $("ticketsTab").classList.add("active");
};

// Start
document.addEventListener("DOMContentLoaded", init);
