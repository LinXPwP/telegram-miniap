// app.js – versiune cu Discord-like chat, reply / edit / delete funcționale
// + unread badge în admin + list preview corect pentru mesaje șterse
// + user chat input aranjat ca la admin (reply bar + input+buton pe rând)
// + user tickets drawer (3 linii stânga sus, listă de tichete care glisează)

// URL-ul Netlify / API (proxy către bot.py)
const API_URL = "https://api.redgen.vip/";

/* ============================
   HELPER – SMART POLLING
   ============================ */
/**
 * createSmartPoll:
 *  - fetchFn: async () => snapshot (or undefined). Trebuie să facă și update de UI.
 *  - isEnabledFn: () => boolean – dacă e false, nu se face request (tab închis, fereastră inactivă etc.)
 *  - options:
 *      minInterval   – ms, ex 3000
 *      maxInterval   – ms, ex 8000
 *      backoffStep   – ms, ex 2000
 *      idleThreshold – de câte ori la rând fără schimbări până creștem intervalul
 *
 *  snapshot-ul e comparat (JSON.stringify) cu cel anterior ca să vedem dacă s-a schimbat ceva.
 */
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
      schedule(maxInterval);
      return;
    }

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
    start() {
      if (active) return;
      active = true;
      idleCount = 0;
      currentInterval = minInterval;
      tick();
    },
    stop() {
      active = false;
      if (timeoutId) clearTimeout(timeoutId);
      timeoutId = null;
    },
    bumpFast() {
      if (!active) return;
      idleCount = 0;
      currentInterval = minInterval;
      schedule(currentInterval);
    },
  };
}

/* ============================
   BOOTSTRAP – Tabs + init
   ============================ */

document.addEventListener("DOMContentLoaded", () => {
  const pageType = document.body.dataset.page;

  // Tabs – segmented control, sincronizat cu CSS (data-active)
  document.querySelectorAll(".tabs").forEach((tabs) => {
    const buttons = tabs.querySelectorAll(".tab-btn");

    let activeBtn =
      tabs.querySelector(".tab-btn.active") || tabs.querySelector(".tab-btn");
    if (activeBtn) {
      tabs.setAttribute("data-active", activeBtn.dataset.tab);
    }

    buttons.forEach((btn) => {
      btn.addEventListener("click", () => {
        buttons.forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");

        const target = btn.getAttribute("data-tab");
        tabs.setAttribute("data-active", target || "");

        if (target) {
          document
            .querySelectorAll(".tab-section")
            .forEach((s) => s.classList.remove("active"));
          const section = document.getElementById(target);
          if (section) section.classList.add("active");
        }

        if (pageType === "user" && typeof window.onUserTabChange === "function") {
          window.onUserTabChange(target);
        }
        if (
          pageType === "admin" &&
          typeof window.onAdminTabChange === "function"
        ) {
          window.onAdminTabChange(target);
        }
      });
    });
  });

  if (pageType === "user") {
    initUserApp();
  } else if (pageType === "admin") {
    initAdminApp();
  }
});

/* ============================
   UTIL – API + timp + scroll
   ============================ */

function formatTimestamp(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  if (isNaN(d.getTime())) return "";
  const day = String(d.getDate()).padStart(2, "0");
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const year = String(d.getFullYear()).slice(-2);
  const hours = String(d.getHours()).padStart(2, "0");
  const mins = String(d.getMinutes()).padStart(2, "0");
  return `${day}/${month}/${year}, ${hours}:${mins}`;
}

function isNearBottom(container, thresholdPx = 80) {
  if (!container) return true;
  const { scrollTop, scrollHeight, clientHeight } = container;
  return scrollHeight - (scrollTop + clientHeight) < thresholdPx;
}

function smartScrollToBottom(container, force = false) {
  if (!container) return;
  if (force || isNearBottom(container)) {
    container.scrollTop = container.scrollHeight;
  }
}

/* ============================
   SHARED – Discord-like renderer
   ============================ */

/**
 * Render mesaje în stil Discord.
 * options:
 *  - container: element .chat-messages
 *  - ticket: tichetul curent
 *  - messages: array de mesaje
 *  - canReply: bool
 *  - canEditDelete: bool (doar admin & doar pe mesaje admin)
 *  - onReply(msg)
 *  - onEdit(msg)
 *  - onDelete(msg)
 *  - onJumpTo(messageId)
 */
function renderDiscordMessages(messages, options) {
  const {
    container,
    ticket,
    canReply,
    canEditDelete,
    onReply,
    onEdit,
    onDelete,
    onJumpTo,
  } = options;

  if (!container) return;
  const wasNearBottom = isNearBottom(container);
  container.innerHTML = "";

  const msgById = {};
  (messages || []).forEach((m) => {
    if (m && m.id) msgById[m.id] = m;
  });

  (messages || []).forEach((m) => {
    if (!m) return;
    const row = document.createElement("div");
    row.className = "msg-row";
    row.dataset.messageId = m.id || "";

    const avatar = document.createElement("div");
    avatar.className = "msg-avatar";
    const senderName = m.sender || (m.from === "system" ? "System" : "User");
    avatar.textContent = (senderName || "?").slice(0, 1).toUpperCase();

    const content = document.createElement("div");
    content.className = "msg-content";

    const headerLine = document.createElement("div");
    headerLine.className = "msg-header-line";

    const userEl = document.createElement("span");
    userEl.className = "msg-username";
    if (m.from === "admin") userEl.classList.add("msg-username--admin");
    userEl.textContent = senderName;

    const tsEl = document.createElement("span");
    tsEl.className = "msg-timestamp";
    tsEl.textContent = formatTimestamp(m.ts);

    headerLine.appendChild(userEl);
    headerLine.appendChild(tsEl);

    const bubble = document.createElement("div");
    bubble.className = "msg-bubble";

    // preview reply, dacă există
    if (m.reply_to && msgById[m.reply_to]) {
      const origin = msgById[m.reply_to];
      const preview = document.createElement("div");
      preview.className = "msg-reply-preview";
      const strong = document.createElement("strong");
      strong.textContent = origin.sender || "User";
      preview.appendChild(strong);
      const txt = document.createElement("span");
      txt.textContent = (origin.text || "").slice(0, 60);
      preview.appendChild(txt);

      preview.addEventListener("click", (e) => {
        e.stopPropagation();
        if (typeof onJumpTo === "function") {
          onJumpTo(origin.id);
        }
      });

      bubble.appendChild(preview);
    }

    const textEl = document.createElement("div");
    textEl.className = "msg-text";
    if (m.deleted) {
      textEl.classList.add("msg-text--deleted");
      textEl.textContent = "Mesaj șters";
    } else {
      textEl.textContent = m.text;
    }
    bubble.appendChild(textEl);

    if (m.edited && !m.deleted) {
      const meta = document.createElement("div");
      meta.className = "msg-meta";
      meta.textContent = "editat";
      bubble.appendChild(meta);
    }

    // acțiuni (Reply/Edit/Del) doar dacă avem drepturi
    if (!m.deleted && (canReply || canEditDelete)) {
      const actions = document.createElement("div");
      actions.className = "msg-actions";

      if (canReply) {
        const replyBtn = document.createElement("button");
        replyBtn.className = "msg-action-btn";
        replyBtn.textContent = "Reply";
        replyBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          if (typeof onReply === "function") onReply(m);
        });
        actions.appendChild(replyBtn);
      }

      if (canEditDelete && m.from === "admin") {
        const editBtn = document.createElement("button");
        editBtn.className = "msg-action-btn";
        editBtn.textContent = "Edit";
        editBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          if (typeof onEdit === "function") onEdit(m);
        });
        actions.appendChild(editBtn);

        const delBtn = document.createElement("button");
        delBtn.className = "msg-action-btn msg-action-btn--danger";
        delBtn.textContent = "Del";
        delBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          if (typeof onDelete === "function") onDelete(m);
        });
        actions.appendChild(delBtn);
      }

      bubble.appendChild(actions);
    }

    content.appendChild(headerLine);
    content.appendChild(bubble);
    row.appendChild(avatar);
    row.appendChild(content);
    container.appendChild(row);
  });

  smartScrollToBottom(container, wasNearBottom);
}

function scrollToMessageElement(container, messageId) {
  if (!container) return;
  const row = container.querySelector(
    `.msg-row[data-message-id="${messageId}"]`
  );
  if (!row) return;
  row.classList.add("msg-row--highlight");
  row.scrollIntoView({ behavior: "smooth", block: "center" });
  setTimeout(() => {
    row.classList.remove("msg-row--highlight");
  }, 1200);
}

/* ============================
   USER MINIAPP (index.html)
   ============================ */

function initUserApp() {
  const tg = window.Telegram?.WebApp;

  let CURRENT_USER = null;
  let CURRENT_SHOP = null;
  let CURRENT_TICKETS = [];
  let SELECTED_TICKET_ID = null;

  let userActiveUntil = 0;
  function bumpUserActive(extraMs = 25000) {
    const now = Date.now();
    userActiveUntil = Math.max(userActiveUntil, now + extraMs);
  }

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
  const chatHeaderEl = document.getElementById("chatHeader");
  const chatMessagesEl = document.getElementById("chatMessages");
  const chatInputEl = document.getElementById("chatInput");
  const chatSendBtn = document.getElementById("chatSendBtn");

  // elemente pentru drawer-ul de tichete (3 linii + backdrop)
  const ticketsMenuToggle = document.getElementById("ticketsMenuToggle");
  const ticketsBackdrop = document.getElementById("ticketsBackdrop");
  const ticketsTabEl = document.getElementById("ticketsTab");

  // bară „reply” user + aranjare input ca la admin
  const chatInputContainer = document.querySelector(
    '#ticketsTab .chat-input, .chat-input'
  );
  let userModeBar = null;
  let userMode = {
    type: null, // "reply" sau null
    messageId: null,
    previewText: "",
    sender: "",
  };

  if (chatInputContainer && !chatInputContainer.querySelector(".chat-mode-bar")) {
    // bara de deasupra input-ului (Reply mode)
    userModeBar = document.createElement("div");
    userModeBar.className = "chat-mode-bar";
    userModeBar.style.display = "none";
    const span = document.createElement("span");
    span.className = "chat-mode-text";
    const btn = document.createElement("button");
    btn.className = "btn-ghost";
    btn.style.fontSize = "10px";
    btn.textContent = "Anulează";
    btn.addEventListener("click", () => {
      userMode.type = null;
      userMode.messageId = null;
      userMode.previewText = "";
      userMode.sender = "";
      userModeBar.style.display = "none";
    });
    userModeBar.appendChild(span);
    userModeBar.appendChild(btn);
    chatInputContainer.prepend(userModeBar);

    // input + buton pe un singur rând, ca la admin
    const row = document.createElement("div");
    row.className = "chat-input-row";
    if (chatInputEl && chatSendBtn) {
      chatInputContainer.insertBefore(row, chatInputEl);
      row.appendChild(chatInputEl);
      row.appendChild(chatSendBtn);
    }
  }

  function setUserReplyMode(msg) {
    if (!userModeBar) return;
    userMode.type = "reply";
    userMode.messageId = msg.id;
    userMode.previewText = (msg.text || "").slice(0, 80);
    userMode.sender = msg.sender || "User";
    const textEl = userModeBar.querySelector(".chat-mode-text");
    textEl.textContent = `Răspunzi lui ${userMode.sender}: "${userMode.previewText}"`;
    userModeBar.style.display = "flex";
    chatInputEl.focus();
  }

  function clearUserMode() {
    if (!userModeBar) return;
    userMode.type = null;
    userMode.messageId = null;
    userMode.previewText = "";
    userMode.sender = "";
    userModeBar.style.display = "none";
  }

  // drawer pentru lista de tichete (3 linii stânga sus)
  function openTicketsDrawer() {
    if (!ticketsTabEl) return;
    ticketsTabEl.classList.add("tickets-drawer-open");
  }

  function closeTicketsDrawer() {
    if (!ticketsTabEl) return;
    ticketsTabEl.classList.remove("tickets-drawer-open");
  }

  function toggleTicketsDrawer() {
    if (!ticketsTabEl) return;
    if (ticketsTabEl.classList.contains("tickets-drawer-open")) {
      ticketsTabEl.classList.remove("tickets-drawer-open");
    } else {
      ticketsTabEl.classList.add("tickets-drawer-open");
    }
  }

  function apiCall(action, extraPayload = {}) {
    const payload = {
      action,
      user: CURRENT_USER,
      ...extraPayload,
    };
    return fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }).then((r) => r.json());
  }

  function isTicketsTabActive() {
    const tab = document.getElementById("ticketsTab");
    return tab && tab.classList.contains("active");
  }

  function renderUserHeader() {
    if (!CURRENT_USER) return;
    creditsValueEl.textContent = CURRENT_USER.credits;
    const name =
      CURRENT_USER.username && CURRENT_USER.username !== "fara_username"
        ? "@" + CURRENT_USER.username
        : `ID ${CURRENT_USER.id}`;
    userLineEl.innerHTML = `Utilizator: <b>${name}</b>`;
  }

  /* ---------- SHOP (user) ---------- */

  function renderShop(shop) {
    categoriesContainer.innerHTML = "";
    if (!shop || !shop.categories) return;

    shop.categories.forEach((cat) => {
      const catDiv = document.createElement("div");
      catDiv.className = "category";

      const header = document.createElement("div");
      header.className = "category-header";

      const nameSpan = document.createElement("div");
      nameSpan.className = "category-name";
      nameSpan.textContent = cat.name;

      const pill = document.createElement("div");
      pill.className = "category-pill";
      pill.textContent = "categorie";

      header.appendChild(nameSpan);
      header.appendChild(pill);

      const desc = document.createElement("div");
      desc.className = "category-desc";
      desc.textContent = cat.description || "";

      const productsDiv = document.createElement("div");
      productsDiv.className = "products";

      (cat.products || []).forEach((prod) => {
        const prodDiv = document.createElement("div");
        prodDiv.className = "product";

        const main = document.createElement("div");
        main.className = "product-main";

        const title = document.createElement("div");
        title.className = "product-name";
        title.textContent = prod.name;

        const pdesc = document.createElement("div");
        pdesc.className = "product-desc";
        pdesc.textContent = prod.description || "";

        main.appendChild(title);
        main.appendChild(pdesc);

        const right = document.createElement("div");
        right.className = "product-right";

        const price = document.createElement("div");
        price.className = "product-price";
        price.textContent = prod.price + " credite";

        const btn = document.createElement("button");
        btn.className = "product-btn";
        btn.textContent = "Detalii";
        btn.onclick = () => openProductPanel(prod);

        right.appendChild(price);
        right.appendChild(btn);

        prodDiv.appendChild(main);
        prodDiv.appendChild(right);

        productsDiv.appendChild(prodDiv);
      });

      catDiv.appendChild(header);
      catDiv.appendChild(desc);
      catDiv.appendChild(productsDiv);

      categoriesContainer.appendChild(catDiv);
    });
  }

  function openProductPanel(prod) {
    SELECTED_PRODUCT = prod;
    panelStatusEl.textContent = "";
    panelStatusEl.className = "status-bar";

    panelNameEl.textContent = prod.name;
    panelDescEl.textContent = prod.description || "";
    panelPriceEl.textContent = `Preț: ${prod.price} credite / buc.`;

    const min = prod.min_qty || 1;
    const max = prod.max_qty || min;

    panelQtyEl.min = min;
    panelQtyEl.max = max;
    panelQtyEl.value = min;
    panelQtyRangeEl.textContent = `(min ${min}, max ${max})`;

    productPanelEl.style.display = "block";
  }

  function closeProductPanel() {
    SELECTED_PRODUCT = null;
    productPanelEl.style.display = "none";
  }

  async function buySelectedProduct() {
    if (!SELECTED_PRODUCT || !CURRENT_USER) return;

    const qty = Number(panelQtyEl.value || 0);
    const prod = SELECTED_PRODUCT;

    panelStatusEl.textContent = "Se trimite comanda...";
    panelStatusEl.className = "status-bar";

    try {
      const res = await apiCall("buy_product", {
        product_id: prod.id,
        qty: qty,
      });

      if (!res.ok) {
        panelStatusEl.className = "status-bar status-error";
        if (res.error === "not_enough_credits") {
          panelStatusEl.textContent = `Nu ai suficiente credite (ai ${res.have}, ai nevoie de ${res.need}).`;
        } else if (res.error === "qty_out_of_range") {
          panelStatusEl.textContent = `Cantitate invalidă. Min ${res.min_qty}, max ${res.max_qty}.`;
        } else {
          panelStatusEl.textContent =
            "Eroare la cumpărare: " + (res.error || "necunoscută");
        }
        return;
      }

      CURRENT_USER.credits = res.new_balance;
      creditsValueEl.textContent = CURRENT_USER.credits;

      const newTicket = res.ticket;
      CURRENT_TICKETS.push(newTicket);
      renderTicketsList();
      selectTicket(newTicket.id);

      panelStatusEl.className = "status-bar status-ok";
      panelStatusEl.textContent = `Comandă trimisă, tichet #${newTicket.id} creat.`;

      const ticketsTabBtn = document.querySelector(
        '.tab-btn[data-tab="ticketsTab"]'
      );
      if (ticketsTabBtn) ticketsTabBtn.click();

      bumpUserActive();

      const snap = await pollTicketsUserCore();
      userTicketsPoller.bumpFast();
      return snap;
    } catch (err) {
      console.error("buy_product error:", err);
      panelStatusEl.className = "status-bar status-error";
      panelStatusEl.textContent = "Eroare la comunicarea cu serverul.";
    }
  }

  panelCloseBtn?.addEventListener("click", closeProductPanel);
  panelBuyBtn?.addEventListener("click", buySelectedProduct);

  /* ---------- CHAT (user) ---------- */

  function getTicketLastMessageUser(t) {
    const msgs = t.messages || [];
    if (msgs.length === 0) return "";
    const last = msgs[msgs.length - 1];
    if (!last) return "";
    if (last.deleted) return "Mesaj șters";
    return last.text || "";
  }

  function renderTicketsList() {
    chatListEl.innerHTML = "";
    if (!CURRENT_TICKETS || CURRENT_TICKETS.length === 0) {
      chatListEl.innerHTML =
        '<div style="padding:8px;font-size:12px;color:var(--muted);">Nu ai tichete încă. Când cumperi un produs se creează automat unul.</div>';
      return;
    }

    CURRENT_TICKETS.sort((a, b) => {
      if (a.status !== b.status) {
        return a.status === "open" ? -1 : 1;
      }
      return (b.id || 0) - (a.id || 0);
    });

    CURRENT_TICKETS.forEach((t) => {
      const item = document.createElement("div");
      item.className = "chat-item";
      if (t.id === SELECTED_TICKET_ID) item.classList.add("active");

      const title = document.createElement("div");
      title.className = "chat-item-title";
      title.textContent = t.product_name || "Produs";

      const statusText = t.status === "open" ? "DESCHIS" : "ÎNCHIS";
      const lastMsg = getTicketLastMessageUser(t);

      const line = document.createElement("div");
      line.className = "chat-item-line";
      line.textContent = `[${statusText}] ${
        lastMsg || "Fără mesaje încă."
      }`;

      item.appendChild(title);
      item.appendChild(line);

      item.addEventListener("click", async () => {
        selectTicket(t.id);
        bumpUserActive();
        closeTicketsDrawer();
        const snap = await pollTicketsUserCore();
        userTicketsPoller.bumpFast();
        return snap;
      });

      chatListEl.appendChild(item);
    });
  }

  function selectTicket(ticketId) {
    SELECTED_TICKET_ID = ticketId;
    renderTicketsList();

    const t = CURRENT_TICKETS.find((x) => x.id === ticketId);
    if (!t) {
      chatHeaderEl.innerHTML = "<span>Niciun tichet selectat</span>";
      chatMessagesEl.innerHTML = "";
      return;
    }

    chatHeaderEl.innerHTML = `
      <b>Tichet #${t.id}</b><br/>
      <span>${t.product_name} · ${t.qty} buc · total ${
      t.total_price
    } credite · status: ${t.status}</span>
    `;

    renderUserMessages(t);
  }

  function renderUserMessages(ticket) {
    renderDiscordMessages(ticket.messages || [], {
      container: chatMessagesEl,
      ticket,
      canReply: true,
      canEditDelete: false,
      onReply: (msg) => setUserReplyMode(msg),
      onEdit: null,
      onDelete: null,
      onJumpTo: (messageId) =>
        scrollToMessageElement(chatMessagesEl, messageId),
    });
  }

  async function sendChatMessage() {
    const text = chatInputEl.value.trim();
    if (!text || !SELECTED_TICKET_ID) return;

    const reply_to =
      userMode.type === "reply" && userMode.messageId
        ? userMode.messageId
        : null;

    chatInputEl.value = "";

    try {
      const res = await apiCall("user_send_message", {
        ticket_id: SELECTED_TICKET_ID,
        text,
        reply_to,
      });

      if (!res.ok) {
        console.error("user_send_message error:", res);
        return;
      }

      const updated = res.ticket;
      const idx = CURRENT_TICKETS.findIndex((t) => t.id === updated.id);
      if (idx >= 0) {
        CURRENT_TICKETS[idx] = updated;
      } else {
        CURRENT_TICKETS.push(updated);
      }

      renderTicketsList();
      selectTicket(updated.id);

      clearUserMode();
      bumpUserActive();

      const snap = await pollTicketsUserCore();
      userTicketsPoller.bumpFast();
      return snap;
    } catch (err) {
      console.error("user_send_message error:", err);
    }
  }

  chatSendBtn?.addEventListener("click", sendChatMessage);
  chatInputEl?.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendChatMessage();
    }
  });

  // controle drawer – buton 3 linii + backdrop + ESC
  ticketsMenuToggle?.addEventListener("click", () => {
    toggleTicketsDrawer();
    bumpUserActive();
  });

  ticketsBackdrop?.addEventListener("click", () => {
    closeTicketsDrawer();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      closeTicketsDrawer();
    }
  });

  async function pollTicketsUserCore() {
    if (!CURRENT_USER) return CURRENT_TICKETS;
    try {
      const res = await apiCall("user_get_tickets", {});
      if (!res.ok) return CURRENT_TICKETS;
      CURRENT_TICKETS = res.tickets || [];
      renderTicketsList();

      if (SELECTED_TICKET_ID) {
        const t = CURRENT_TICKETS.find((x) => x.id === SELECTED_TICKET_ID);
        if (t) {
          selectTicket(t.id);
        }
      }
      return CURRENT_TICKETS;
    } catch (err) {
      console.error("user_get_tickets error:", err);
      return CURRENT_TICKETS;
    }
  }

  const userTicketsPoller = createSmartPoll(
    pollTicketsUserCore,
    () => {
      if (!isTicketsTabActive()) return false;
      if (!CURRENT_TICKETS || CURRENT_TICKETS.length === 0) return false;

      const now = Date.now();
      if (now > userActiveUntil) return false;

      const hasOpen = CURRENT_TICKETS.some((t) => t.status === "open");
      const hasSelected = !!SELECTED_TICKET_ID;
      return hasOpen || hasSelected;
    },
    {
      minInterval: 3000,
      maxInterval: 8000,
      backoffStep: 2000,
      idleThreshold: 4,
    }
  );

  window.onUserTabChange = (tabId) => {
    if (tabId === "ticketsTab") {
      bumpUserActive();
      userTicketsPoller.start();
    } else {
      userTicketsPoller.stop();
      closeTicketsDrawer();
    }
  };

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      if (isTicketsTabActive()) {
        bumpUserActive();
        userTicketsPoller.start();
      }
    } else {
      userTicketsPoller.stop();
    }
  });

  async function initApp() {
    if (!tg) {
      userLineEl.textContent =
        "Nu ești în Telegram MiniApp. Deschide link-ul prin bot.";
      return;
    }

    tg.ready();
    tg.expand();

    const user = tg.initDataUnsafe?.user;
    if (!user) {
      userLineEl.textContent =
        "Telegram nu a trimis datele userului. Deschide MiniApp-ul din butonul inline al botului.";
      return;
    }

    CURRENT_USER = {
      id: user.id,
      username: user.username || null,
      first_name: user.first_name || null,
      last_name: user.last_name || null,
      credits: 0,
    };

    try {
      const res = await apiCall("init", {});
      if (!res.ok) {
        userLineEl.textContent =
          "Eroare la inițializare (server nu a răspuns ok).";
        return;
      }

      CURRENT_USER.credits = res.user.credits;
      CURRENT_USER.username = res.user.username;

      CURRENT_SHOP = res.shop;
      CURRENT_TICKETS = res.tickets || [];

      renderUserHeader();
      renderShop(CURRENT_SHOP);
      renderTicketsList();

      if (isTicketsTabActive()) {
        bumpUserActive();
        userTicketsPoller.start();
      }
    } catch (err) {
      console.error("init error:", err);
      userLineEl.textContent = "Eroare la inițializare (network).";
    }
  }

  initApp();
}

/* ============================
   ADMIN MINIAPP (admin.html)
   ============================ */

function initAdminApp() {
  const params = new URLSearchParams(window.location.search);
  const ADMIN_TOKEN = params.get("token") || "";

  const userLineEl = document.getElementById("userLine");

  const ticketsListEl = document.getElementById("ticketsList");
  const chatHeaderEl = document.getElementById("chatHeader");
  const chatMessagesEl = document.getElementById("chatMessages");
  const chatInputEl = document.getElementById("chatInput");
  const chatSendBtn = document.getElementById("chatSendBtn");

  const ticketDetailsEl = document.getElementById("ticketDetails");
  const ticketSummaryEl = document.getElementById("ticketSummary");
  const ticketNoteInlineEl = document.getElementById("ticketNoteInline");
  const ticketStatusBarEl = document.getElementById("ticketStatusBar");
  const ticketCloseBtn = document.getElementById("ticketCloseBtn");
  const ticketCloseWithReasonBtn = document.getElementById(
    "ticketCloseWithReasonBtn"
  );

  const shopContainerEl = document.getElementById("shopContainer");
  const shopStatusBarEl = document.getElementById("shopStatusBar");
  const addCategoryBtn = document.getElementById("addCategoryBtn");
  const saveShopBtn = document.getElementById("saveShopBtn");
  const shopMetricsEl = document.getElementById("shopMetrics");

  const reasonModalEl = document.getElementById("reasonModal");
  const reasonInputEl = document.getElementById("reasonInput");
  const reasonCancelBtn = document.getElementById("reasonCancelBtn");
  const reasonConfirmBtn = document.getElementById("reasonConfirmBtn");

  const filterStatusEl = document.getElementById("filterStatus");
  const filterSearchEl = document.getElementById("filterSearch");
  const statTotalEl = document.getElementById("statTotal");
  const statOpenEl = document.getElementById("statOpen");
  const statClosedEl = document.getElementById("statClosed");

  const chatInputContainer = document.querySelector(
    "#chatTab .chat-input"
  );

  // bară pentru reply / edit în admin
  let adminModeBar = null;
  const adminMode = {
    type: null, // "reply" / "edit" / null
    ticketId: null,
    messageId: null,
    previewText: "",
    sender: "",
  };

  if (chatInputContainer && !chatInputContainer.querySelector(".chat-mode-bar")) {
    adminModeBar = document.createElement("div");
    adminModeBar.className = "chat-mode-bar";
    adminModeBar.style.display = "none";

    const span = document.createElement("span");
    span.className = "chat-mode-text";

    const btn = document.createElement("button");
    btn.className = "btn-ghost";
    btn.style.fontSize = "10px";
    btn.textContent = "Anulează";
    btn.addEventListener("click", () => {
      clearAdminMode();
    });

    adminModeBar.appendChild(span);
    adminModeBar.appendChild(btn);
    chatInputContainer.prepend(adminModeBar);

    // re-aranjăm input + buton într-un rând
    const row = document.createElement("div");
    row.className = "chat-input-row";
    chatInputEl.parentNode.insertBefore(row, chatInputEl);
    row.appendChild(chatInputEl);
    row.appendChild(chatSendBtn);
  }

  function setAdminReplyMode(ticketId, msg) {
    if (!adminModeBar) return;
    adminMode.type = "reply";
    adminMode.ticketId = ticketId;
    adminMode.messageId = msg.id;
    adminMode.previewText = (msg.text || "").slice(0, 80);
    adminMode.sender = msg.sender || "User";
    const textEl = adminModeBar.querySelector(".chat-mode-text");
    textEl.textContent = `Răspunzi lui ${adminMode.sender}: "${adminMode.previewText}"`;
    adminModeBar.style.display = "flex";
    chatInputEl.focus();
  }

  function setAdminEditMode(ticketId, msg) {
    if (!adminModeBar) return;
    adminMode.type = "edit";
    adminMode.ticketId = ticketId;
    adminMode.messageId = msg.id;
    adminMode.previewText = (msg.text || "").slice(0, 80);
    adminMode.sender = msg.sender || "Admin";
    const textEl = adminModeBar.querySelector(".chat-mode-text");
    textEl.textContent = `Editezi mesajul: "${adminMode.previewText}"`;
    adminModeBar.style.display = "flex";
    chatInputEl.value = msg.text || "";
    chatInputEl.focus();
  }

  function clearAdminMode() {
    if (!adminModeBar) return;
    adminMode.type = null;
    adminMode.ticketId = null;
    adminMode.messageId = null;
    adminMode.previewText = "";
    adminMode.sender = "";
    adminModeBar.style.display = "none";
  }

  let ALL_TICKETS = [];
  let CURRENT_SHOP = null;
  let SELECTED_TICKET_ID = null;

  let adminActiveUntil = 0;
  function bumpAdminActive(extraMs = 30000) {
    const now = Date.now();
    adminActiveUntil = Math.max(adminActiveUntil, now + extraMs);
  }

  // UNREAD SYSTEM (doar în admin, localStorage)
  let ADMIN_LAST_SEEN = {};

  function loadAdminSeen() {
    try {
      const raw = localStorage.getItem("admin_ticket_seen");
      if (raw) {
        ADMIN_LAST_SEEN = JSON.parse(raw);
      } else {
        ADMIN_LAST_SEEN = {};
      }
    } catch (e) {
      ADMIN_LAST_SEEN = {};
    }
  }

  function saveAdminSeen() {
    try {
      localStorage.setItem("admin_ticket_seen", JSON.stringify(ADMIN_LAST_SEEN));
    } catch (e) {
      // ignore
    }
  }

  loadAdminSeen();

  function markTicketRead(ticket) {
    if (!ticket) return;
    const msgs = ticket.messages || [];
    if (!msgs.length) return;
    const last = msgs[msgs.length - 1];
    if (!last || !last.id) return;
    const key = String(ticket.id);
    ADMIN_LAST_SEEN[key] = last.id;
    saveAdminSeen();
  }

  function getUnreadCount(ticket) {
    const msgs = ticket.messages || [];
    if (!msgs.length) return 0;
    const key = String(ticket.id);
    const lastSeenId = ADMIN_LAST_SEEN[key];
    let startIndex = -1;
    if (lastSeenId) {
      startIndex = msgs.findIndex((m) => m && m.id === lastSeenId);
    }
    let count = 0;
    for (let i = startIndex + 1; i < msgs.length; i++) {
      const m = msgs[i];
      if (!m) continue;
      if (m.deleted) continue; // nu numărăm mesaje șterse
      if (m.from === "user") count++;
    }
    return count;
  }

  function apiCall(action, extraPayload = {}) {
    const payload = {
      action,
      token: ADMIN_TOKEN,
      ...extraPayload,
    };
    return fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }).then((r) => r.json());
  }

  function renderTokenInfo() {
    if (!ADMIN_TOKEN) {
      userLineEl.innerHTML =
        "<span style='color:#ff5252;'>Token lipsă în URL.</span> Deschide admin.html?token=TOKENUL_TĂU.";
    } else {
      const short = ADMIN_TOKEN.slice(0, 4) + "..." + ADMIN_TOKEN.slice(-4);
      userLineEl.innerHTML = "Acces cu token: <b>" + short + "</b>";
    }
  }

  function isAnyAdminTabActive() {
    const chatTab = document.getElementById("chatTab");
    const shopTab = document.getElementById("shopTab");
    return (
      (chatTab && chatTab.classList.contains("active")) ||
      (shopTab && shopTab.classList.contains("active"))
    );
  }

  /* ---------- STATISTICI & FILTRE ---------- */

  function updateTicketStats() {
    const total = ALL_TICKETS.length;
    const open = ALL_TICKETS.filter((t) => t.status === "open").length;
    const closed = ALL_TICKETS.filter((t) => t.status === "closed").length;

    if (statTotalEl) statTotalEl.textContent = total;
    if (statOpenEl) statOpenEl.textContent = open;
    if (statClosedEl) statClosedEl.textContent = closed;
  }

  function getFilteredTickets() {
    let list = ALL_TICKETS.slice();
    const statusFilter = filterStatusEl?.value || "all";
    const query = (filterSearchEl?.value || "").toLowerCase().trim();

    if (statusFilter !== "all") {
      list = list.filter((t) => (t.status || "") === statusFilter);
    }

    if (query) {
      list = list.filter((t) => {
        const user = (t.username || t.user_id || "").toString().toLowerCase();
        const product = (t.product_name || "").toLowerCase();
        const idStr = ("#" + t.id).toLowerCase();
        return (
          user.includes(query) ||
          product.includes(query) ||
          idStr.includes(query)
        );
      });
    }

    return list;
  }

  /* ---------- CHAT ADMIN ---------- */

  function getTicketLastMessageAdmin(t) {
    const msgs = t.messages || [];
    if (msgs.length === 0) return "";
    const last = msgs[msgs.length - 1];
    if (!last) return "";
    if (last.deleted) return "Mesaj șters";
    return last.text || "";
  }

  function renderTicketsList() {
    ticketsListEl.innerHTML = "";
    const list = getFilteredTickets();

    if (!list || list.length === 0) {
      ticketsListEl.innerHTML =
        '<div style="padding:8px;font-size:12px;color:var(--muted);">Nu există tichete pentru filtrele curente.</div>';
      if (!SELECTED_TICKET_ID) {
        ticketDetailsEl.style.display = "none";
        chatHeaderEl.innerHTML = "<span>Niciun tichet selectat</span>";
        chatMessagesEl.innerHTML = "";
      }
      return;
    }

    list.sort((a, b) => {
      if (a.status !== b.status) {
        return a.status === "open" ? -1 : 1;
      }
      return (b.id || 0) - (a.id || 0);
    });

    list.forEach((t) => {
      const item = document.createElement("div");
      item.className = "chat-item";
      if (t.id === SELECTED_TICKET_ID) item.classList.add("active");

      const headerRow = document.createElement("div");
      headerRow.className = "chat-item-header-row";

      const title = document.createElement("div");
      title.className = "chat-item-title";
      title.textContent =
        (t.username || t.user_id) + " · " + (t.product_name || "");

      const rightWrap = document.createElement("div");
      rightWrap.style.display = "flex";
      rightWrap.style.alignItems = "center";
      rightWrap.style.gap = "4px";

      const statusChip = document.createElement("span");
      statusChip.className =
        "ticket-status-pill " + (t.status === "open" ? "open" : "closed");
      statusChip.textContent = t.status === "open" ? "DESCHIS" : "ÎNCHIS";

      rightWrap.appendChild(statusChip);

      const unreadCount = getUnreadCount(t);
      if (unreadCount > 0 && t.status === "open") {
        const badge = document.createElement("span");
        badge.className = "unread-badge";
        badge.textContent = unreadCount > 99 ? "99+" : String(unreadCount);
        rightWrap.appendChild(badge);
      }

      headerRow.appendChild(title);
      headerRow.appendChild(rightWrap);

      const lastMsg = getTicketLastMessageAdmin(t);
      const line = document.createElement("div");
      line.className = "chat-item-line";
      line.textContent = lastMsg ? lastMsg : "Fără mesaje încă.";

      item.appendChild(headerRow);
      item.appendChild(line);

      item.addEventListener("click", async () => {
        selectTicket(t.id);
        bumpAdminActive();
        const snap = await pollAdminCore();
        adminPoller.bumpFast();
        return snap;
      });

      ticketsListEl.appendChild(item);
    });
  }

  function selectTicket(ticketId) {
    SELECTED_TICKET_ID = ticketId;
    renderTicketsList();

    const t = ALL_TICKETS.find((x) => x.id === ticketId);
    if (!t) {
      ticketDetailsEl.style.display = "none";
      chatHeaderEl.innerHTML = "<span>Niciun tichet selectat</span>";
      chatMessagesEl.innerHTML = "";
      return;
    }

    chatHeaderEl.innerHTML = `
      <b>Tichet #${t.id}</b><br/>
      <span>User: ${t.username || t.user_id} · Produs: ${
      t.product_name
    } · ${t.qty} buc · total ${t.total_price} credite · status: ${
      t.status
    }</span>
    `;

    renderAdminMessages(t);
    ticketDetailsEl.style.display = "block";
    ticketSummaryEl.innerHTML = `
      <b>Tichet #${t.id}</b><br/>
      User: <b>${t.username || t.user_id}</b><br/>
      Produs: <b>${t.product_name}</b> (${t.qty} buc, total ${
      t.total_price
    } credite)
    `;

    if (t.note) {
      ticketNoteInlineEl.innerHTML =
        '<span class="ticket-note-label">Notă internă:</span> ' +
        `<span class="ticket-note-text">${t.note}</span>`;
    } else {
      ticketNoteInlineEl.innerHTML =
        '<span class="ticket-note-label">Notă internă:</span> ' +
        '<span class="ticket-note-text ticket-note-empty">nu există (încă)</span>';
    }

    ticketStatusBarEl.textContent = "";
    ticketStatusBarEl.className = "status-bar";

    // marcam ca citit când deschidem tichetul
    markTicketRead(t);
    renderTicketsList();
  }

  function renderAdminMessages(ticket) {
    renderDiscordMessages(ticket.messages || [], {
      container: chatMessagesEl,
      ticket,
      canReply: true,
      canEditDelete: true,
      onReply: (msg) => setAdminReplyMode(ticket.id, msg),
      onEdit: (msg) => setAdminEditMode(ticket.id, msg),
      onDelete: (msg) => deleteAdminMessage(ticket.id, msg.id),
      onJumpTo: (messageId) =>
        scrollToMessageElement(chatMessagesEl, messageId),
    });
  }

  async function sendAdminMessage() {
    const text = chatInputEl.value.trim();
    if (!text || !SELECTED_TICKET_ID) return;

    const modeType = adminMode.type;
    const msgId = adminMode.messageId;

    try {
      let res;

      if (modeType === "edit" && msgId) {
        // EDIT
        res = await apiCall("admin_edit_message", {
          ticket_id: SELECTED_TICKET_ID,
          message_id: msgId,
          text,
        });
      } else {
        // NEW sau REPLY
        const reply_to =
          modeType === "reply" && msgId ? msgId : null;
        res = await apiCall("admin_send_message", {
          ticket_id: SELECTED_TICKET_ID,
          text,
          sender: "Admin",
          reply_to,
        });
      }

      if (!res || !res.ok) {
        console.error("admin send/edit error:", res);
        return;
      }

      const updated = res.ticket;
      const idx = ALL_TICKETS.findIndex((t) => t.id === updated.id);
      if (idx >= 0) {
        ALL_TICKETS[idx] = updated;
      } else {
        ALL_TICKETS.push(updated);
      }

      updateTicketStats();
      renderTicketsList();
      selectTicket(updated.id);

      chatInputEl.value = "";
      clearAdminMode();
      bumpAdminActive();

      const snap = await pollAdminCore();
      adminPoller.bumpFast();
      return snap;
    } catch (err) {
      console.error("admin_send/edit_message error:", err);
    }
  }

  chatSendBtn?.addEventListener("click", sendAdminMessage);
  chatInputEl?.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendAdminMessage();
    }
  });

  async function deleteAdminMessage(ticketId, messageId) {
    if (!confirm("Sigur vrei să marchezi acest mesaj ca șters?")) return;

    try {
      const res = await apiCall("admin_delete_message", {
        ticket_id: ticketId,
        message_id: messageId,
      });

      if (!res.ok) {
        console.error("admin_delete_message error:", res);
        return;
      }

      const updated = res.ticket;
      const idx = ALL_TICKETS.findIndex((t) => t.id === updated.id);
      if (idx >= 0) ALL_TICKETS[idx] = updated;

      updateTicketStats();
      renderTicketsList();
      if (SELECTED_TICKET_ID === updated.id) {
        selectTicket(updated.id);
      }

      bumpAdminActive();

      const snap = await pollAdminCore();
      adminPoller.bumpFast();
      return snap;
    } catch (err) {
      console.error("admin_delete_message error:", err);
    }
  }

  /* ---------- Închidere tichet ---------- */

  async function closeTicket(noteText) {
    if (!SELECTED_TICKET_ID) return;
    const t = ALL_TICKETS.find((x) => x.id === SELECTED_TICKET_ID);
    if (!t) return;

    ticketStatusBarEl.textContent = "Se închide tichetul...";
    ticketStatusBarEl.className = "status-bar";

    try {
      const res = await apiCall("admin_update_ticket", {
        ticket_id: t.id,
        status: "closed",
        note: noteText || "",
      });

      if (!res.ok) {
        ticketStatusBarEl.textContent =
          "Eroare la închidere: " + (res.error || "necunoscută");
        ticketStatusBarEl.className = "status-bar status-error";
        return;
      }

      t.status = "closed";
      t.note = noteText || "";

      ticketStatusBarEl.textContent = "Tichet închis.";
      ticketStatusBarEl.className = "status-bar status-ok";

      updateTicketStats();
      renderTicketsList();
      selectTicket(t.id);

      bumpAdminActive();

      const snap = await pollAdminCore();
      adminPoller.bumpFast();
      return snap;
    } catch (err) {
      console.error("admin_update_ticket error:", err);
      ticketStatusBarEl.textContent = "Eroare la comunicarea cu serverul.";
      ticketStatusBarEl.className = "status-bar status-error";
    }
  }

  ticketCloseBtn?.addEventListener("click", () => {
    if (!SELECTED_TICKET_ID) return;
    if (confirm("Sigur vrei să închizi tichetul fără motiv?")) {
      closeTicket("");
    }
  });

  ticketCloseWithReasonBtn?.addEventListener("click", () => {
    if (!SELECTED_TICKET_ID) return;
    reasonInputEl.value = "";
    reasonModalEl.style.display = "flex";
    reasonInputEl.focus();
  });

  reasonCancelBtn?.addEventListener("click", () => {
    reasonModalEl.style.display = "none";
  });

  reasonConfirmBtn?.addEventListener("click", () => {
    const text = reasonInputEl.value.trim();
    reasonModalEl.style.display = "none";
    closeTicket(text);
  });

  /* ---------- SHOP EDITOR ADMIN ---------- */

  function updateShopMetrics() {
    if (!shopMetricsEl) return;
    if (!CURRENT_SHOP || !CURRENT_SHOP.categories) {
      shopMetricsEl.innerHTML =
        '<div class="stat-pill stat-pill--soft"><span class="stat-label">Categorii</span><span class="stat-value">0</span></div>' +
        '<div class="stat-pill stat-pill--soft"><span class="stat-label">Produse</span><span class="stat-value">0</span></div>';
      return;
    }

    const catCount = CURRENT_SHOP.categories.length;
    let prodCount = 0;
    CURRENT_SHOP.categories.forEach((c) => {
      prodCount += (c.products || []).length;
    });

    shopMetricsEl.innerHTML = `
      <div class="stat-pill stat-pill--soft">
        <span class="stat-label">Categorii</span>
        <span class="stat-value">${catCount}</span>
      </div>
      <div class="stat-pill stat-pill--soft">
        <span class="stat-label">Produse</span>
        <span class="stat-value">${prodCount}</span>
      </div>
    `;
  }

  function renderShopEditor() {
    shopContainerEl.innerHTML = "";
    if (!CURRENT_SHOP || !CURRENT_SHOP.categories) {
      shopContainerEl.innerHTML =
        '<div style="font-size:12px;color:var(--muted);">Nu există categorii. Adaugă una nouă.</div>';
      updateShopMetrics();
      return;
    }

    CURRENT_SHOP.categories.forEach((cat, catIndex) => {
      const catDiv = document.createElement("div");
      catDiv.className = "cat-card";

      const header = document.createElement("div");
      header.className = "cat-header";

      const left = document.createElement("div");
      left.className = "cat-header-left";

      const toggleBtn = document.createElement("button");
      toggleBtn.className = "btn-ghost cat-toggle";
      toggleBtn.textContent = cat._collapsed ? "▸" : "▾";
      toggleBtn.onclick = () => {
        cat._collapsed = !cat._collapsed;
        renderShopEditor();
      };

      const nameInput = document.createElement("input");
      nameInput.placeholder = "Nume categorie";
      nameInput.value = cat.name || "";
      nameInput.addEventListener("input", () => {
        cat.name = nameInput.value;
      });

      left.appendChild(toggleBtn);
      left.appendChild(nameInput);

      const right = document.createElement("div");
      right.className = "cat-header-right";

      const countBadge = document.createElement("div");
      countBadge.className = "ticket-status-pill open";
      countBadge.textContent = `${(cat.products || []).length} produse`;

      const deleteBtn = document.createElement("button");
      deleteBtn.className = "btn-ghost";
      deleteBtn.textContent = "Șterge";
      deleteBtn.style.fontSize = "11px";
      deleteBtn.onclick = () => {
        if (confirm("Ștergi categoria?")) {
          CURRENT_SHOP.categories.splice(catIndex, 1);
          renderShopEditor();
        }
      };

      right.appendChild(countBadge);
      right.appendChild(deleteBtn);

      header.appendChild(left);
      header.appendChild(right);

      catDiv.appendChild(header);

      if (!cat._collapsed) {
        const descDiv = document.createElement("div");
        descDiv.className = "cat-desc";
        const descArea = document.createElement("textarea");
        descArea.placeholder = "Descriere categorie";
        descArea.value = cat.description || "";
        descArea.addEventListener("input", () => {
          cat.description = descArea.value;
        });
        descDiv.appendChild(descArea);

        const productsWrap = document.createElement("div");
        productsWrap.className = "products-list";

        (cat.products = cat.products || []).forEach((prod, prodIndex) => {
          const row = document.createElement("div");
          row.className = "product-row";

          const colName = document.createElement("div");
          const nameInputProd = document.createElement("input");
          nameInputProd.placeholder = "Nume produs";
          nameInputProd.value = prod.name || "";
          nameInputProd.addEventListener("input", () => {
            prod.name = nameInputProd.value;
          });
          const nameLabel = document.createElement("div");
          nameLabel.className = "small-input-label";
          nameLabel.textContent = "Nume";
          colName.appendChild(nameInputProd);
          colName.appendChild(nameLabel);

          const colPrice = document.createElement("div");
          const priceInput = document.createElement("input");
          priceInput.type = "number";
          priceInput.placeholder = "Preț";
          priceInput.value = prod.price || 0;
          priceInput.addEventListener("input", () => {
            prod.price = Number(priceInput.value || 0);
          });
          const priceLabel = document.createElement("div");
          priceLabel.className = "small-input-label";
          priceLabel.textContent = "Preț";
          colPrice.appendChild(priceInput);
          colPrice.appendChild(priceLabel);

          const colMin = document.createElement("div");
          const minInput = document.createElement("input");
          minInput.type = "number";
          minInput.placeholder = "Min";
          minInput.value = prod.min_qty || 1;
          minInput.addEventListener("input", () => {
            prod.min_qty = Number(minInput.value || 1);
          });
          const minLabel = document.createElement("div");
          minLabel.className = "small-input-label";
          minLabel.textContent = "Min";
          colMin.appendChild(minInput);
          colMin.appendChild(minLabel);

          const colMax = document.createElement("div");
          const maxInput = document.createElement("input");
          maxInput.type = "number";
          maxInput.placeholder = "Max";
          maxInput.value = prod.max_qty || prod.min_qty || 1;
          maxInput.addEventListener("input", () => {
            prod.max_qty = Number(maxInput.value || prod.min_qty || 1);
          });
          const maxLabel = document.createElement("div");
          maxLabel.className = "small-input-label";
          maxLabel.textContent = "Max";
          colMax.appendChild(maxInput);
          colMax.appendChild(maxLabel);

          const colActions = document.createElement("div");
          colActions.className = "product-mini-actions";
          const delProdBtn = document.createElement("button");
          delProdBtn.className = "btn-ghost";
          delProdBtn.style.fontSize = "10px";
          delProdBtn.textContent = "X";
          delProdBtn.onclick = () => {
            if (confirm("Ștergi produsul?")) {
              cat.products.splice(prodIndex, 1);
              renderShopEditor();
            }
          };
          colActions.appendChild(delProdBtn);

          row.appendChild(colName);
          row.appendChild(colPrice);
          row.appendChild(colMin);
          row.appendChild(colMax);
          row.appendChild(colActions);

          productsWrap.appendChild(row);

          const descRow = document.createElement("div");
          descRow.style.gridColumn = "1 / -1";
          descRow.style.marginBottom = "4px";
          const descInput = document.createElement("input");
          descInput.placeholder = "Descriere produs";
          descInput.value = prod.description || "";
          descInput.addEventListener("input", () => {
            prod.description = descInput.value;
          });
          descRow.appendChild(descInput);

          const extraInfo = document.createElement("div");
          extraInfo.className = "small-input-label";
          extraInfo.textContent = "ID: " + (prod.id || "(auto)");

          descRow.appendChild(extraInfo);
          productsWrap.appendChild(descRow);
        });

        const addProdBtn = document.createElement("button");
        addProdBtn.className = "btn-ghost";
        addProdBtn.style.fontSize = "11px";
        addProdBtn.textContent = "+ Produs";
        addProdBtn.onclick = () => {
          cat.products.push({
            id: "prod_" + Date.now(),
            name: "Produs nou",
            price: 0,
            description: "",
            min_qty: 1,
            max_qty: 1,
          });
          renderShopEditor();
        };

        productsWrap.appendChild(addProdBtn);

        catDiv.appendChild(descDiv);
        catDiv.appendChild(productsWrap);
      }

      shopContainerEl.appendChild(catDiv);
    });

    updateShopMetrics();
  }

  async function saveShop() {
    if (!CURRENT_SHOP) return;
    shopStatusBarEl.textContent = "Se salvează shop-ul...";
    shopStatusBarEl.className = "status-bar";

    try {
      const res = await apiCall("admin_save_shop", { shop: CURRENT_SHOP });
      if (!res.ok) {
        shopStatusBarEl.textContent =
          "Eroare la salvare: " + (res.error || "necunoscută");
        shopStatusBarEl.className = "status-bar status-error";
        return;
      }
      shopStatusBarEl.textContent = "Shop salvat.";
      shopStatusBarEl.className = "status-bar status-ok";

      bumpAdminActive();

      const snap = await pollAdminCore();
      adminPoller.bumpFast();
      return snap;
    } catch (err) {
      console.error("admin_save_shop error:", err);
      shopStatusBarEl.textContent = "Eroare la comunicarea cu serverul.";
      shopStatusBarEl.className = "status-bar status-error";
    }
  }

  function addCategory() {
    if (!CURRENT_SHOP) CURRENT_SHOP = { categories: [] };
    CURRENT_SHOP.categories.push({
      id: "cat_" + Date.now(),
      name: "Categorie nouă",
      description: "",
      products: [],
    });
    renderShopEditor();
  }

  addCategoryBtn?.addEventListener("click", addCategory);
  saveShopBtn?.addEventListener("click", saveShop);

  /* ---------- CORE POLL ADMIN ---------- */

  async function pollAdminCore() {
    if (!ADMIN_TOKEN) return { tickets: ALL_TICKETS, shop: CURRENT_SHOP };

    try {
      const res = await apiCall("admin_get_tickets", {});
      if (!res.ok) {
        if (res.error === "forbidden") {
          userLineEl.innerHTML =
            "<span style='color:#ff5252;'>Token invalid.</span>";
        }
        return { tickets: ALL_TICKETS, shop: CURRENT_SHOP };
      }

      ALL_TICKETS = res.tickets || [];
      CURRENT_SHOP = res.shop || { categories: [] };

      // inițial, marcăm ca citite toate mesajele existente (prima încărcare)
      ALL_TICKETS.forEach((t) => {
        const key = String(t.id);
        if (!ADMIN_LAST_SEEN[key]) {
          const msgs = t.messages || [];
          if (msgs.length) {
            ADMIN_LAST_SEEN[key] = msgs[msgs.length - 1].id;
          }
        }
      });
      saveAdminSeen();

      updateTicketStats();
      renderTicketsList();
      renderShopEditor();

      if (SELECTED_TICKET_ID) {
        const t = ALL_TICKETS.find((x) => x.id === SELECTED_TICKET_ID);
        if (t) {
          selectTicket(t.id);
        }
      }

      return { tickets: ALL_TICKETS, shop: CURRENT_SHOP };
    } catch (err) {
      console.error("admin_get_tickets error:", err);
      userLineEl.innerHTML =
        "<span style='color:#ff5252;'>Eroare la rețea.</span>";
      return { tickets: ALL_TICKETS, shop: CURRENT_SHOP };
    }
  }

  const adminPoller = createSmartPoll(
    pollAdminCore,
    () => {
      if (!ADMIN_TOKEN) return false;
      if (!isAnyAdminTabActive()) return false;

      const now = Date.now();
      if (now > adminActiveUntil) return false;

      const hasTickets = ALL_TICKETS.length > 0;
      const hasOpen = ALL_TICKETS.some((t) => t.status === "open");
      return hasTickets || hasOpen;
    },
    {
      minInterval: 2000,
      maxInterval: 8000,
      backoffStep: 2000,
      idleThreshold: 4,
    }
  );

  function onFilterChange() {
    renderTicketsList();
  }

  let searchTimeout = null;
  filterStatusEl?.addEventListener("change", onFilterChange);
  filterSearchEl?.addEventListener("input", () => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(onFilterChange, 150);
  });

  window.onAdminTabChange = () => {
    if (isAnyAdminTabActive()) {
      bumpAdminActive();
      adminPoller.start();
    } else {
      adminPoller.stop();
    }
  };

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      if (isAnyAdminTabActive()) {
        bumpAdminActive();
        adminPoller.start();
      }
    } else {
      adminPoller.stop();
    }
  });

  async function initAdmin() {
    renderTokenInfo();
    if (!ADMIN_TOKEN) return;

    await pollAdminCore();
    bumpAdminActive();
    adminPoller.start();
  }

  initAdmin();
}
