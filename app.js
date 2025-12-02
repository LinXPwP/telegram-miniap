console.log("Admin dashboard v2.2");
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

    if (isEnabledFn && !isEnabledFn()) {
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
   UTILS
   ============================ */

function formatTimestamp(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "";
  const day = String(d.getDate()).padStart(2, "0");
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const hours = String(d.getHours()).padStart(2, "0");
  const mins = String(d.getMinutes()).padStart(2, "0");
  return `${day}/${month} ${hours}:${mins}`;
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

function escapeHTML(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/* ============================
   MAIN – USER APP
   ============================ */

function initUserApp() {
  const tg = window.Telegram?.WebApp;

  // State
  let CURRENT_USER = null;
  let CURRENT_SHOP = null;
  let CURRENT_TICKETS = [];
  let SELECTED_TICKET_ID = null;
  let SELECTED_PRODUCT = null;

  let USER_LAST_SEEN = {};
  let userActiveUntil = 0;
  let userTicketsPoller = null;

  // DOM
  const creditsValueEl = document.getElementById("creditsValue");
  const userLineEl = document.getElementById("userLine");

  const shopViewEl = document.getElementById("shopView");
  const ticketsViewEl = document.getElementById("ticketsView");
  const tabShopBtn = document.getElementById("tabShop");
  const tabTicketsBtn = document.getElementById("tabTickets");
  const openTicketsTabBtn = document.getElementById("openTicketsTabBtn");

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

  const chatListEl = document.getElementById("chatList");
  const chatMessagesEl = document.getElementById("chatMessages");
  const chatInputEl = document.getElementById("chatInput");
  const chatSendBtn = document.getElementById("chatSendBtn");
  const ticketTitleEl = document.getElementById("ticketTitle");
  const userTicketCloseBtn = document.getElementById("userTicketCloseBtn");

  /* ---------- helpers ---------- */

  function setUserInfoMessage(text, isError = false) {
    if (!userLineEl) return;
    userLineEl.textContent = text || "";
    if (text) {
      userLineEl.style.display = "block";
    } else {
      userLineEl.style.display = "none";
    }
    userLineEl.classList.toggle("user-info--error", !!isError);
  }

  function bumpUserActive(extraMs = 25000) {
    const now = Date.now();
    userActiveUntil = Math.max(userActiveUntil, now + extraMs);
  }

  function loadUserSeen() {
    try {
      const raw = localStorage.getItem("user_ticket_seen");
      USER_LAST_SEEN = raw ? JSON.parse(raw) : {};
    } catch (e) {
      USER_LAST_SEEN = {};
    }
  }

  function saveUserSeen() {
    try {
      localStorage.setItem("user_ticket_seen", JSON.stringify(USER_LAST_SEEN));
    } catch (e) {
      // ignore
    }
  }

  function markTicketReadUser(ticket) {
    if (!ticket) return;
    const msgs = ticket.messages || [];
    if (!msgs.length) return;
    const last = msgs[msgs.length - 1];
    if (!last || !last.id) return;
    const key = String(ticket.id);
    USER_LAST_SEEN[key] = last.id;
    saveUserSeen();
  }

  function getUnreadCountUser(ticket) {
    const msgs = ticket.messages || [];
    if (!msgs.length) return 0;
    const key = String(ticket.id);
    const lastSeenId = USER_LAST_SEEN[key];

    let startIndex = -1;
    if (lastSeenId) {
      startIndex = msgs.findIndex((m) => m && m.id === lastSeenId);
    }

    let count = 0;
    for (let i = startIndex + 1; i < msgs.length; i++) {
      const m = msgs[i];
      if (!m) continue;
      if (m.deleted) continue;
      if (m.from === "admin") count++;
    }
    return count;
  }

  loadUserSeen();

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

  function isTicketsViewActive() {
    return ticketsViewEl?.classList.contains("view--active");
  }

  function showView(view) {
    if (!shopViewEl || !ticketsViewEl || !tabShopBtn || !tabTicketsBtn) return;

    if (view === "tickets") {
      shopViewEl.classList.remove("view--active");
      tabShopBtn.classList.remove("active");

      ticketsViewEl.classList.add("view--active");
      tabTicketsBtn.classList.add("active");

      bumpUserActive();
      if (userTicketsPoller) userTicketsPoller.start();
    } else {
      // default: shop
      ticketsViewEl.classList.remove("view--active");
      tabTicketsBtn.classList.remove("active");

      shopViewEl.classList.add("view--active");
      tabShopBtn.classList.add("active");

      if (userTicketsPoller) userTicketsPoller.stop();
    }
  }

  function renderHeader() {
    if (!CURRENT_USER || !creditsValueEl) return;
    creditsValueEl.textContent = CURRENT_USER.credits;

    const name =
      CURRENT_USER.username && CURRENT_USER.username !== "fara_username"
        ? `@${CURRENT_USER.username}`
        : `ID ${CURRENT_USER.id}`;
    setUserInfoMessage(`Conectat ca ${name}`);
  }

  /* ---------- SHOP ---------- */

  function renderShop(shop) {
    if (!categoriesContainer) return;
    categoriesContainer.innerHTML = "";

    if (!shop || !Array.isArray(shop.categories) || !shop.categories.length) {
      categoriesContainer.innerHTML =
        '<p class="empty-text">Nu există produse de afișat momentan.</p>';
      return;
    }

    shop.categories.forEach((cat) => {
      const catCard = document.createElement("section");
      catCard.className = "category-card";

      const header = document.createElement("div");
      header.className = "category-header";

      const title = document.createElement("div");
      title.className = "category-name";
      title.textContent = cat.name || "Categorie";

      const chip = document.createElement("div");
      chip.className = "category-chip";
      chip.textContent = "Categorie";

      header.appendChild(title);
      header.appendChild(chip);

      const desc = document.createElement("p");
      desc.className = "category-desc";
      desc.textContent = cat.description || "";

      const productsWrap = document.createElement("div");
      productsWrap.className = "products";

      (cat.products || []).forEach((prod) => {
        const row = document.createElement("div");
        row.className = "product-row";

        const info = document.createElement("div");
        info.className = "product-info";

        const pName = document.createElement("div");
        pName.className = "product-name";
        pName.textContent = prod.name;

        const pDesc = document.createElement("div");
        pDesc.className = "product-desc";
        pDesc.textContent = prod.description || "";

        info.appendChild(pName);
        info.appendChild(pDesc);

        const right = document.createElement("div");
        right.className = "product-right";

        const price = document.createElement("div");
        price.className = "product-price";
        price.textContent = `${prod.price} credite`;

        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "btn-primary btn-small";
        btn.textContent = "Detalii";
        btn.addEventListener("click", () => openProductPanel(prod));

        right.appendChild(price);
        right.appendChild(btn);

        row.appendChild(info);
        row.appendChild(right);
        productsWrap.appendChild(row);
      });

      catCard.appendChild(header);
      if (cat.description) catCard.appendChild(desc);
      catCard.appendChild(productsWrap);
      categoriesContainer.appendChild(catCard);
    });
  }

  function openProductPanel(prod) {
    if (!productPanelEl) return;
    SELECTED_PRODUCT = prod;
    if (panelStatusEl) {
      panelStatusEl.textContent = "";
      panelStatusEl.className = "status-text";
    }

    if (panelNameEl) panelNameEl.textContent = prod.name || "";
    if (panelDescEl) panelDescEl.textContent = prod.description || "";
    if (panelPriceEl)
      panelPriceEl.textContent = `Preț: ${prod.price} credite / buc.`;

    const min = prod.min_qty || 1;
    const max = prod.max_qty || min;

    if (panelQtyEl) {
      panelQtyEl.min = String(min);
      panelQtyEl.max = String(max);
      panelQtyEl.value = String(min);
    }
    if (panelQtyRangeEl) {
      panelQtyRangeEl.textContent = `(min ${min}, max ${max})`;
    }

    productPanelEl.classList.add("modal--visible");
  }

  function closeProductPanel() {
    if (!productPanelEl) return;
    SELECTED_PRODUCT = null;
    productPanelEl.classList.remove("modal--visible");
  }

  async function buySelectedProduct() {
    if (!SELECTED_PRODUCT || !CURRENT_USER) return;
    if (!panelQtyEl) return;

    const qty = Number(panelQtyEl.value || 0);
    const prod = SELECTED_PRODUCT;

    if (panelStatusEl) {
      panelStatusEl.textContent = "Se trimite comanda...";
      panelStatusEl.className = "status-text";
    }

    try {
      const res = await apiCall("buy_product", {
        product_id: prod.id,
        qty,
      });

      if (!res.ok) {
        if (panelStatusEl) {
          panelStatusEl.classList.add("status-text--error");
          if (res.error === "not_enough_credits") {
            panelStatusEl.textContent = `Nu ai suficiente credite (ai ${res.have}, ai nevoie de ${res.need}).`;
          } else if (res.error === "qty_out_of_range") {
            panelStatusEl.textContent = `Cantitate invalidă. Min ${res.min_qty}, max ${res.max_qty}.`;
          } else {
            panelStatusEl.textContent =
              "Eroare la cumpărare: " + (res.error || "necunoscută");
          }
        }
        return;
      }

      // update credits
      CURRENT_USER.credits = res.new_balance;
      if (creditsValueEl) creditsValueEl.textContent = CURRENT_USER.credits;

      // add new ticket
      const newTicket = res.ticket;
      CURRENT_TICKETS.push(newTicket);

      renderTicketsListUser();
      selectTicketUser(newTicket.id);

      if (panelStatusEl) {
        panelStatusEl.classList.remove("status-text--error");
        panelStatusEl.classList.add("status-text--ok");
        panelStatusEl.textContent = `Tichet #${newTicket.id} a fost creat.`;
      }

      // switch to tickets
      showView("tickets");
      bumpUserActive();

      const snap = await pollTicketsUserCore();
      if (userTicketsPoller) userTicketsPoller.bumpFast();
      return snap;
    } catch (err) {
      console.error("buy_product error:", err);
      if (panelStatusEl) {
        panelStatusEl.classList.add("status-text--error");
        panelStatusEl.textContent =
          "Eroare la comunicarea cu serverul. Încearcă din nou.";
      }
    }
  }

  /* ---------- TICKETS & CHAT ---------- */

  function getTicketLastMessageUser(t) {
    const msgs = t.messages || [];
    if (!msgs.length) return "";
    const last = msgs[msgs.length - 1];
    if (!last) return "";
    if (last.deleted) return "Mesaj șters";
    return last.text || "";
  }

  function renderTicketsListUser() {
    if (!chatListEl) return;
    chatListEl.innerHTML = "";

    if (!CURRENT_TICKETS || !CURRENT_TICKETS.length) {
      chatListEl.innerHTML =
        '<p class="empty-text">Nu ai tichete încă. Când cumperi un produs, se creează automat unul.</p>';
      return;
    }

    const sorted = [...CURRENT_TICKETS].sort((a, b) => {
      if (a.status !== b.status) {
        return a.status === "open" ? -1 : 1;
      }
      return (b.id || 0) - (a.id || 0);
    });

    sorted.forEach((t) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "ticket-item";
      if (t.id === SELECTED_TICKET_ID) {
        btn.classList.add("ticket-item--active");
      }

      const unread = getUnreadCountUser(t);
      const productName = t.product_name || "Produs";
      const userLabel = t.username || t.user_id || "user";

      const lastText = getTicketLastMessageUser(t) || "Fără mesaje încă.";

      btn.innerHTML = `
        <div class="ticket-item__row">
          <div>
            <div class="ticket-item__name">${escapeHTML(productName)}</div>
            <div class="ticket-item__meta">#${t.id} · ${escapeHTML(
        String(userLabel)
      )}</div>
          </div>
          <div class="ticket-item__aside">
            <span class="ticket-item__status ticket-item__status--${
              t.status === "open" ? "open" : "closed"
            }">
              ${t.status === "open" ? "Deschis" : "Închis"}
            </span>
            ${
              unread > 0 && t.status === "open"
                ? `<span class="ticket-item__badge">${
                    unread > 99 ? "99+" : unread
                  }</span>`
                : ""
            }
          </div>
        </div>
        <div class="ticket-item__preview">${escapeHTML(lastText)}</div>
      `;

      btn.addEventListener("click", async () => {
        selectTicketUser(t.id);
        bumpUserActive();
        const snap = await pollTicketsUserCore();
        if (userTicketsPoller) userTicketsPoller.bumpFast();
        return snap;
      });

      chatListEl.appendChild(btn);
    });
  }

  function updateUserChatState(ticket) {
    if (!chatInputEl || !chatSendBtn || !userTicketCloseBtn || !ticketTitleEl)
      return;

    if (!ticket) {
      chatInputEl.disabled = true;
      chatSendBtn.disabled = true;
      chatInputEl.placeholder =
        "Alege un tichet pentru a începe conversația...";
      userTicketCloseBtn.style.display = "none";
      ticketTitleEl.textContent = "Niciun tichet selectat";
      return;
    }

    const isClosed = ticket.status === "closed";
    chatInputEl.disabled = isClosed;
    chatSendBtn.disabled = isClosed;
    chatInputEl.placeholder = isClosed
      ? "Acest tichet este închis. Nu mai poți trimite mesaje."
      : "Scrie un mesaj către admin...";

    userTicketCloseBtn.style.display = isClosed ? "none" : "inline-flex";

    const labelUser =
      ticket.username || ticket.user_id || (CURRENT_USER && CURRENT_USER.id);
    ticketTitleEl.textContent = `${ticket.product_name || "Produs"} · #${
      ticket.id
    } · ${labelUser}`;
  }

  function renderUserChat(ticket) {
    if (!chatMessagesEl) return;
    const wasNearBottom = isNearBottom(chatMessagesEl);
    chatMessagesEl.innerHTML = "";

    if (!ticket || !ticket.messages || !ticket.messages.length) {
      const empty = document.createElement("p");
      empty.className = "empty-text";
      empty.textContent =
        "Nu există încă mesaje pe acest tichet. Scrie primul mesaj către admin.";
      chatMessagesEl.appendChild(empty);
      smartScrollToBottom(chatMessagesEl, true);
      return;
    }

    ticket.messages.forEach((m) => {
      if (!m) return;
      const role =
        m.from === "admin"
          ? "admin"
          : m.from === "system"
          ? "system"
          : "user";

      const wrapper = document.createElement("div");
      wrapper.className = `chat-message chat-message--${role}`;

      const bubble = document.createElement("div");
      bubble.className = "chat-bubble";

      const textEl = document.createElement("div");
      textEl.className = "chat-text";

      if (m.deleted) {
        textEl.textContent = "Mesaj șters";
        textEl.classList.add("chat-text--muted");
      } else {
        textEl.textContent = m.text || "";
      }
      bubble.appendChild(textEl);

      const meta = document.createElement("div");
      meta.className = "chat-meta";
      if (role === "system") {
        meta.textContent = formatTimestamp(m.ts);
      } else {
        const sender =
          m.sender ||
          (role === "admin"
            ? "Admin"
            : CURRENT_USER && CURRENT_USER.username
            ? `@${CURRENT_USER.username}`
            : "Tu");
        meta.textContent = `${sender} · ${formatTimestamp(m.ts)}`;
      }
      bubble.appendChild(meta);

      wrapper.appendChild(bubble);
      chatMessagesEl.appendChild(wrapper);
    });

    smartScrollToBottom(chatMessagesEl, wasNearBottom);
  }

  function selectTicketUser(ticketId) {
    SELECTED_TICKET_ID = ticketId;

    const t = CURRENT_TICKETS.find((x) => x.id === ticketId);
    if (t) {
      markTicketReadUser(t);
    }

    renderTicketsListUser();

    if (!t) {
      if (chatMessagesEl) chatMessagesEl.innerHTML = "";
      updateUserChatState(null);
      return;
    }

    renderUserChat(t);
    updateUserChatState(t);
  }

  async function sendChatMessage() {
    if (!chatInputEl) return;
    const text = chatInputEl.value.trim();
    if (!text || !SELECTED_TICKET_ID) return;

    const ticket = CURRENT_TICKETS.find((t) => t.id === SELECTED_TICKET_ID);
    if (!ticket || ticket.status === "closed") {
      updateUserChatState(ticket || null);
      return;
    }

    chatInputEl.value = "";

    try {
      const res = await apiCall("user_send_message", {
        ticket_id: SELECTED_TICKET_ID,
        text,
      });

      if (!res.ok) {
        console.error("user_send_message error:", res);
        if (res.error === "ticket_closed") {
          const updatedTicket = CURRENT_TICKETS.find(
            (t) => t.id === SELECTED_TICKET_ID
          );
          updateUserChatState(updatedTicket || null);
        }
        return;
      }

      const updated = res.ticket;
      const idx = CURRENT_TICKETS.findIndex((t) => t.id === updated.id);
      if (idx >= 0) {
        CURRENT_TICKETS[idx] = updated;
      } else {
        CURRENT_TICKETS.push(updated);
      }

      renderTicketsListUser();
      selectTicketUser(updated.id);

      bumpUserActive();

      const snap = await pollTicketsUserCore();
      if (userTicketsPoller) userTicketsPoller.bumpFast();
      return snap;
    } catch (err) {
      console.error("user_send_message error:", err);
    }
  }

  async function userCloseCurrentTicket() {
    if (!SELECTED_TICKET_ID) return;
    if (!confirm("Sigur vrei să închizi acest tichet?")) return;

    try {
      const res = await apiCall("user_close_ticket", {
        ticket_id: SELECTED_TICKET_ID,
      });

      if (!res.ok) {
        console.error("user_close_ticket error:", res);
        return;
      }

      const updated = res.ticket;
      const idx = CURRENT_TICKETS.findIndex((t) => t.id === updated.id);
      if (idx >= 0) {
        CURRENT_TICKETS[idx] = updated;
      } else {
        CURRENT_TICKETS.push(updated);
      }

      renderTicketsListUser();
      selectTicketUser(updated.id);

      bumpUserActive();

      const snap = await pollTicketsUserCore();
      if (userTicketsPoller) userTicketsPoller.bumpFast();
      return snap;
    } catch (err) {
      console.error("user_close_ticket error:", err);
    }
  }

  async function pollTicketsUserCore() {
    if (!CURRENT_USER) return CURRENT_TICKETS;

    try {
      const res = await apiCall("user_get_tickets", {});
      if (!res.ok) return CURRENT_TICKETS;

      CURRENT_TICKETS = res.tickets || [];

      CURRENT_TICKETS.forEach((t) => {
        const key = String(t.id);
        if (!USER_LAST_SEEN[key]) {
          const msgs = t.messages || [];
          if (msgs.length) {
            USER_LAST_SEEN[key] = msgs[msgs.length - 1].id;
          }
        }
      });
      saveUserSeen();

      renderTicketsListUser();

      if (SELECTED_TICKET_ID) {
        const t = CURRENT_TICKETS.find((x) => x.id === SELECTED_TICKET_ID);
        if (t) {
          selectTicketUser(t.id);
        } else {
          SELECTED_TICKET_ID = null;
          if (chatMessagesEl) chatMessagesEl.innerHTML = "";
          updateUserChatState(null);
        }
      }

      return CURRENT_TICKETS;
    } catch (err) {
      console.error("user_get_tickets error:", err);
      return CURRENT_TICKETS;
    }
  }

  // Poller configurat acum (logic simplu)
  userTicketsPoller = createSmartPoll(
    pollTicketsUserCore,
    () => {
      if (!isTicketsViewActive()) return false;
      if (!CURRENT_TICKETS || !CURRENT_TICKETS.length) return false;

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

  /* ---------- Event listeners ---------- */

  if (tabShopBtn) {
    tabShopBtn.addEventListener("click", () => showView("shop"));
  }
  if (tabTicketsBtn) {
    tabTicketsBtn.addEventListener("click", () => {
      showView("tickets");
      bumpUserActive();
    });
  }
  if (openTicketsTabBtn) {
    openTicketsTabBtn.addEventListener("click", () => {
      showView("tickets");
      bumpUserActive();
    });
  }

  if (chatSendBtn) {
    chatSendBtn.addEventListener("click", sendChatMessage);
  }
  if (chatInputEl) {
    chatInputEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        sendChatMessage();
      }
    });
  }

  if (userTicketCloseBtn) {
    userTicketCloseBtn.addEventListener("click", userCloseCurrentTicket);
  }

  if (panelCloseBtn) {
    panelCloseBtn.addEventListener("click", closeProductPanel);
  }
  if (panelBuyBtn) {
    panelBuyBtn.addEventListener("click", buySelectedProduct);
  }
  if (productPanelEl) {
    productPanelEl.addEventListener("click", (e) => {
      if (e.target === productPanelEl) {
        closeProductPanel();
      }
    });
  }

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      if (isTicketsViewActive() && userTicketsPoller) {
        bumpUserActive();
        userTicketsPoller.start();
      }
    } else {
      if (userTicketsPoller) userTicketsPoller.stop();
    }
  });

  // Initial
  updateUserChatState(null);

  /* ---------- INIT cu Telegram ---------- */

  async function initApp() {
    if (!tg) {
      setUserInfoMessage(
        "Nu ești în Telegram MiniApp. Deschide link-ul prin bot.",
        true
      );
      return;
    }

    try {
      tg.ready();
      tg.expand();
    } catch (e) {
      console.warn("Telegram WebApp API not fully disponibil:", e);
    }

    const user = tg.initDataUnsafe?.user;
    if (!user) {
      setUserInfoMessage(
        "Telegram nu a trimis datele utilizatorului. Deschide MiniApp-ul din butonul inline al botului.",
        true
      );
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
        setUserInfoMessage(
          "Eroare la inițializare (serverul nu a răspuns ok).",
          true
        );
        return;
      }

      CURRENT_USER.credits = res.user.credits;
      CURRENT_USER.username = res.user.username;

      CURRENT_SHOP = res.shop;
      CURRENT_TICKETS = res.tickets || [];

      CURRENT_TICKETS.forEach((t) => {
        const key = String(t.id);
        if (!USER_LAST_SEEN[key]) {
          const msgs = t.messages || [];
          if (msgs.length) {
            USER_LAST_SEEN[key] = msgs[msgs.length - 1].id;
          }
        }
      });
      saveUserSeen();

      renderHeader();
      renderShop(CURRENT_SHOP);
      renderTicketsListUser();
      showView("shop");
    } catch (err) {
      console.error("init error:", err);
      setUserInfoMessage(
        "Eroare la inițializare (problemă de rețea). Încearcă din nou.",
        true
      );
    }
  }

  initApp();
}

document.addEventListener("DOMContentLoaded", initUserApp);
