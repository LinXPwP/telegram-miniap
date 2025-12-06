// --- CONFIG & UTILS ---
const API_URL = "https://api.redgen.vip/";
const $ = s => document.querySelector(s);
const $$ = s => document.querySelectorAll(s);
const on = (el, evt, fn) => el && el.addEventListener(evt, fn);
const show = (el, d='flex') => el && (el.classList.remove('hidden'), el.style.display = d);
const hide = el => el && (el.classList.add('hidden'), el.style.display = 'none');
const mk = (tag, cls, html) => { const e = document.createElement(tag); if(cls) e.className=cls; if(html) e.innerHTML=html; return e; };
const imgUrl = url => (url && url.trim()) ? url : null;
const fmtDate = ts => { const d=new Date(ts); return isNaN(d) ? '' : `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}, ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`; };

// --- STATE ---
const State = {
    user: null, shop: null, tickets: [],
    selTicketId: null, selProd: null, selVariant: null,
    sending: false, buying: false, lastAct: Date.now(),
    reply: { id: null, txt: '', sender: '' }
};

// --- API ---
async function api(act, pl = {}) {
    if (!window.Telegram?.WebApp?.initData) return { ok: false, error: 'auth_failed' };
    pl.action = act; pl.initData = window.Telegram.WebApp.initData;
    try {
        const r = await fetch(API_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(pl) });
        return r.status === 401 ? { ok: false, error: 'auth_failed' } : await r.json();
    } catch (e) { console.error(e); return { ok: false, error: 'network' }; }
}

// --- POLLING ---
function createPoll(fn, check) {
    let tId, active = false, running = false;
    const tick = async () => {
        if (!active) return;
        let delay = document.hidden ? 60000 : (Date.now() - State.lastAct > 45000 ? 10000 : 3000);
        if (check && !check()) delay = 60000;
        if (!running && (!check || check())) {
            running = true; try { await fn(); } catch(e){} running = false;
        }
        tId = setTimeout(tick, delay);
    };
    return {
        start: () => { if(!active){ active=true; State.lastAct=Date.now(); tick(); } },
        stop: () => { active=false; clearTimeout(tId); },
        bump: () => { State.lastAct=Date.now(); clearTimeout(tId); if(active) tId=setTimeout(tick, 100); }
    };
}

// --- UI RENDERING ---
function renderHeader() {
    if(!State.user) return;
    $('#creditsValue').textContent = State.user.credits;
    $('#userLine').innerHTML = `Utilizator: <b>${State.user.username ? '@'+State.user.username : 'ID '+State.user.id}</b>`;
}

function renderGrid(list, type) {
    const grid = $(type === 'cat' ? '#categoriesGrid' : '#productsGrid');
    grid.innerHTML = '';
    if (!list || !list.length) return type === 'prod' && show($('#emptyProductsMsg'), 'block');
    type === 'prod' && hide($('#emptyProductsMsg'));

    list.forEach(item => {
        const img = imgUrl(item.image);
        const card = mk('div', 'card-visual', `
            <div class="card-img-container" style="${type==='prod'?'height:140px;aspect-ratio:unset':''}">
                ${img ? `<img src="${img}" class="card-img">` : `<div class="img-placeholder">${type==='cat'?'📁':'🎁'}</div>`}
                ${type==='cat' ? `<div class="card-overlay"><div class="cat-name">${item.name}</div><div class="cat-count">${(item.products||[]).length} produse</div></div>` : ''}
            </div>
            ${type==='prod' ? `<div class="prod-info"><div class="prod-title">${item.name}</div><div class="prod-meta"><div class="prod-price">${item.types?.length ? `De la ${Math.min(...item.types.map(t=>Number(t.price)))}` : item.price} CRD</div><div class="prod-btn-mini">&rarr;</div></div></div>` : ''}
        `);
        // Event delegation logic handled by data attr would be cleaner but keeping simple click
        card.onclick = () => type === 'cat' ? openCategory(item) : openProd(item);
        grid.appendChild(card);
    });
}

function openCategory(cat) {
    $('#viewCategories').classList.remove('active-view');
    $('#viewProducts').classList.add('active-view');
    hide($('#headerTitle'));
    const btn = $('#shopBackBtn'); show(btn);
    btn.querySelector('span').textContent = cat.name;
    btn.onclick = () => {
        $('#viewProducts').classList.remove('active-view'); $('#viewCategories').classList.add('active-view');
        hide(btn); show($('#headerTitle'));
    };
    renderGrid(cat.products || [], 'prod');
}

// --- PRODUCT LOGIC ---
function openProd(p) {
    State.selProd = p; State.selVariant = null;
    $('#panelName').textContent = p.name;
    $('#panelStatus').textContent = ''; $('#panelStatus').className = 'status-message';
    const btn = $('#panelBuyBtn'); btn.disabled = false; btn.textContent = 'Cumpără acum'; btn.style.opacity = '1';
    
    const img = imgUrl(p.image);
    const iEl = $('#panelImg'); const ph = $('#panelImgPlaceholder');
    if(img) { iEl.src = img; show(iEl); hide(ph); } else { hide(iEl); show(ph); }

    const tCont = $('#panelTypesContainer'); const tGrid = $('#panelTypesGrid');
    if (p.types?.length) {
        show(tCont, 'block'); tGrid.innerHTML = '';
        p.types.sort((a,b)=>a.price-b.price).forEach((t, i) => {
            const el = mk('div', 'type-card', `<div class="type-name">${t.name}</div><div class="type-price">${t.price} CRD</div>`);
            el.onclick = () => selVar(t, el);
            tGrid.appendChild(el);
            if(i===0) selVar(t, el);
        });
    } else {
        hide(tCont);
        $('#panelPrice').textContent = `${p.price} CRD`;
        $('#panelDesc').textContent = p.description || 'Fără descriere.';
    }
    show($('#productPanel'));
}

function selVar(t, el) {
    State.selVariant = t;
    Array.from($('#panelTypesGrid').children).forEach(c => c.classList.remove('active'));
    el.classList.add('active');
    $('#panelPrice').textContent = `${t.price} CRD`;
    $('#panelDesc').textContent = `${State.selProd.description || ''}\n\n🔹 ${t.name}\n${t.warranty ? '🛡️ '+t.warranty : ''}\n${t.description ? '📝 '+t.description : ''}`;
}

async function buy() {
    if (!State.selProd || State.buying) return;
    if (State.selProd.types?.length && !State.selVariant) return $('#panelStatus').innerHTML='<span class="status-error">Alege varianta!</span>';
    
    State.buying = true;
    const btn = $('#panelBuyBtn'); btn.textContent = 'Procesare...'; btn.style.opacity = '0.6';
    const pl = { product_id: State.selProd.id, qty: 1 };
    if (State.selVariant) pl.type_id = State.selVariant.id;

    const res = await api('buy_product', pl);
    State.buying = false;
    
    if (!res.ok) {
        btn.textContent = 'Încearcă din nou'; btn.style.opacity = '1';
        const msg = res.error === 'not_enough_credits' ? `Fonduri insuficiente! <span onclick="show($('#creditsModal'))" style="text-decoration:underline;cursor:pointer;font-weight:bold">Încarcă</span>` : res.error;
        $('#panelStatus').innerHTML = `<span class="status-error">${msg}</span>`;
    } else {
        State.user.credits = res.new_balance; renderHeader();
        State.tickets.push(res.ticket);
        $('#panelStatus').innerHTML = '<span class="status-ok">Succes!</span>';
        setTimeout(() => { hide($('#productPanel')); showTab('tickets'); poll.bump(); }, 1000);
    }
}

// --- TICKETS LOGIC ---
const poll = createPoll(async () => {
    const res = await api('user_get_tickets');
    if (res.ok && res.tickets) {
        // Sync open status
        if (State.selTicketId) {
            const loc = State.tickets.find(x=>x.id==State.selTicketId);
            const srv = res.tickets.find(x=>x.id==State.selTicketId);
            if(loc?.status==='closed' && srv?.status==='open') srv.status='open';
        }
        State.tickets = res.tickets;
        // Auto-refresh chat if open
        if (State.selTicketId) {
             const t = State.tickets.find(x=>x.id==State.selTicketId);
             if(t) { renderMsgs(t); if(calcUnread(t)>0) api('mark_seen', {ticket_id:t.id}); }
        }
        renderTicketList();
    }
}, () => $('#ticketsTab').classList.contains('active'));

function calcUnread(t) {
    if(!t.messages) return 0;
    const last = t.last_read_user;
    let c = 0, count = !last;
    for(let m of t.messages) { if(m.id===last) count=true; else if(count && m.from==='admin') c++; }
    return c;
}

function renderTicketList() {
    const list = $('#chatList');
    if (!State.tickets.length) { list.innerHTML=''; return show($('#noTicketsMsg')); }
    hide($('#noTicketsMsg'));
    
    State.tickets.sort((a,b) => (a.status==='open'?-1:1) - (b.status==='open'?-1:1) || b.id-a.id);
    
    // Simple Diffing to prevent full redraw flickering
    const ids = new Set(State.tickets.map(t=>String(t.id)));
    Array.from(list.children).forEach(c => !ids.has(c.dataset.tid) && c.id !== 'noTicketsMsg' && c.remove());

    State.tickets.forEach(t => {
        let el = list.querySelector(`.chat-item[data-tid="${t.id}"]`);
        const unread = (State.selTicketId !== t.id && t.status==='open') ? calcUnread(t) : 0;
        const html = `
            <div class="chat-item-header-row"><div class="chat-item-title">${t.product_name||'Comandă'}</div><div>${unread?`<span class="unread-badge">${unread}</span>`:''}<span class="ticket-status-pill ${t.status}">${t.status}</span></div></div>
            <div class="chat-item-line">${(t.messages?.length?t.messages.at(-1).text:'Tichet nou').slice(0,30)}</div>
        `;
        if(!el) {
            el = mk('div', 'chat-item'); el.dataset.tid = t.id;
            el.onclick = () => { State.selTicketId=t.id; renderTicketList(); hide($('#ticketsTab'),'flex'); $('#ticketsTab').classList.remove('tickets-drawer-open'); renderMsgs(t); poll.bump(); };
            list.appendChild(el);
        }
        if(el.innerHTML !== html) el.innerHTML = html;
        t.id === State.selTicketId ? el.classList.add('active') : el.classList.remove('active');
    });
}

function renderMsgs(t) {
    const c = $('#chatMessages');
    $('#ticketTitle').textContent = `Tichet #${t.id}`;
    
    // Controls
    const closed = t.status === 'closed';
    $('#chatInput').disabled = $('#chatSendBtn').disabled = closed;
    $('#chatInput').placeholder = closed ? 'Tichet închis.' : 'Scrie un mesaj...';
    closed ? (hide($('#userTicketCloseBtn')), show($('#userTicketReopenBtn'))) : (show($('#userTicketCloseBtn')), hide($('#userTicketReopenBtn')));
    if(closed) resetReply();

    // Messages
    if(!t.messages?.length) return c.innerHTML = '<div class="chat-placeholder"><div class="icon">💬</div><p>Începe conversația...</p></div>';
    
    // Message Rendering Optimized
    const frag = document.createDocumentFragment();
    const map = {}; t.messages.forEach(m=>map[m.id]=m);
    
    t.messages.forEach(m => {
        const div = mk('div', 'msg-row'); div.dataset.mid = m.id;
        const rep = m.reply_to && map[m.reply_to] ? `<div class="msg-reply-preview" onclick="this.closest('.chat-viewport').querySelector('[data-mid=\\'${m.reply_to}\\']')?.scrollIntoView({behavior:'smooth',block:'center'})"><strong>${map[m.reply_to].sender}</strong>: ${(map[m.reply_to].text||'').slice(0,20)}...</div>` : '';
        div.innerHTML = `
            <div class="msg-avatar">${(m.sender||'U')[0].toUpperCase()}</div>
            <div class="msg-content">
                <div class="msg-header-line"><span class="msg-username ${m.from==='admin'?'msg-username--admin':''}">${m.sender||'User'}</span><span class="msg-timestamp">${fmtDate(m.ts)}</span>${!closed && !m.deleted?`<button class="btn-reply-mini" onclick="setReply(${m.id}, '${m.sender}', '${(m.text||'').replace(/'/g,"\\'")}')">↩</button>`:''}</div>
                <div class="msg-bubble">${rep}<div class="msg-text ${m.deleted?'msg-text--deleted':''}">${m.deleted?'Șters':m.text}</div></div>
            </div>`;
        frag.appendChild(div);
    });
    c.innerHTML = ''; c.appendChild(frag);
    c.scrollTop = c.scrollHeight;
}

// --- CHAT ACTIONS ---
window.setReply = (id, sender, txt) => {
    State.reply = { id, sender, txt };
    let bar = $('.chat-mode-bar');
    if(!bar) {
        bar = mk('div', 'chat-mode-bar'); 
        $('.chat-input').prepend(bar);
    }
    bar.innerHTML = `<span>Replying to ${sender}</span><button onclick="resetReply()">✕</button>`;
    show(bar); $('#chatInput').focus();
};
window.resetReply = () => { State.reply={id:null,txt:'',sender:''}; const b=$('.chat-mode-bar'); if(b) b.remove(); };

async function sendMsg() {
    const txt = $('#chatInput').value.trim();
    if(!txt || !State.selTicketId || State.sending) return;
    State.sending = true; $('#chatSendBtn').style.opacity = '0.5';
    $('#chatInput').value = ''; resetReply();

    const res = await api('user_send_message', { ticket_id: State.selTicketId, text: txt, reply_to: State.reply.id });
    State.sending = false; $('#chatSendBtn').style.opacity = '1'; $('#chatInput').focus();

    if(res.ticket) {
        const idx = State.tickets.findIndex(x=>x.id==res.ticket.id);
        if(idx>-1) State.tickets[idx] = res.ticket;
        renderMsgs(res.ticket);
    } else if(res.error) alert(res.error);
}

function showTab(t) {
    if(t==='shop') { show($('#shopTab')); $('#ticketsTab').classList.remove('active'); show($('#shopHeader')); poll.stop(); }
    else { hide($('#shopTab')); $('#ticketsTab').classList.add('active'); hide($('#shopHeader')); poll.start(); }
}

// --- INIT ---
on(document, 'DOMContentLoaded', async () => {
    const tg = window.Telegram?.WebApp;
    if(!tg?.initData) return show($('#onlyTelegramError')) & hide($('#mainAppWrapper'));
    tg.ready(); tg.expand();

    // Event Bindings
    on($('#shopBackBtn'), 'click', () => {$('#viewProducts').classList.remove('active-view'); $('#viewCategories').classList.add('active-view'); hide($('#shopBackBtn')); show($('#headerTitle'));});
    on($('#creditsBtn'), 'click', () => show($('#creditsModal')));
    on($('#closeCreditsModalBtn'), 'click', () => hide($('#creditsModal')));
    on($('#goToTicketsBtn'), 'click', () => showTab('tickets'));
    on($('#backToShopBtn'), 'click', () => showTab('shop'));
    on($('#ticketsMenuToggle'), 'click', () => $('#ticketsTab').classList.toggle('tickets-drawer-open'));
    on($('#ticketsBackdrop'), 'click', () => $('#ticketsTab').classList.remove('tickets-drawer-open'));
    on($('#panelCloseBtn'), 'click', () => hide($('#productPanel')));
    on($('#panelBuyBtn'), 'click', buy);
    on($('#chatSendBtn'), 'click', sendMsg);
    on($('#chatInput'), 'keydown', e => e.key==='Enter' && !e.shiftKey && (e.preventDefault(), sendMsg()));
    
    // Ticket Actions
    on($('#userTicketCloseBtn'), 'click', () => show($('#confirmActionModal')));
    on($('#confirmCancelBtn'), 'click', () => hide($('#confirmActionModal')));
    on($('#confirmOkBtn'), 'click', async () => {
        hide($('#confirmActionModal'));
        const res = await api('user_close_ticket', {ticket_id: State.selTicketId});
        if(res.ok) { 
            const t = State.tickets.find(x=>x.id==State.selTicketId); if(t) t.status='closed';
            renderTicketList(); renderMsgs(t);
        }
    });
    on($('#userTicketReopenBtn'), 'click', async () => {
         const res = await api('user_reopen_ticket', {ticket_id: State.selTicketId});
         if(res.ok && res.ticket) {
             const idx = State.tickets.findIndex(x=>x.id==res.ticket.id);
             if(idx>-1) State.tickets[idx]=res.ticket;
             renderTicketList(); renderMsgs(res.ticket);
         }
    });

    // Tracking
    ['mousemove','touchstart','click'].forEach(e => on(document, e, () => State.lastAct=Date.now()));

    // Load Data
    const res = await api('init');
    if(!res.ok) return $('#userLine').textContent = 'Eroare init.';
    State.user = res.user; State.shop = res.shop; State.tickets = res.tickets || [];
    renderHeader(); renderGrid(State.shop.categories, 'cat'); renderTicketList();
    showTab('shop');
});
