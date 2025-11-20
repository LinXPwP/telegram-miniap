// app.js

// URL-ul Netlify function (proxy către bot.py)
const API_URL =
  "https://dancing-hotteok-480e3c.netlify.app/.netlify/functions/api";

document.addEventListener("DOMContentLoaded", () => {
  const pageType = document.body.dataset.page;

  // Tabs – segmented control, sincronizat cu CSS (data-active)
  document.querySelectorAll(".tabs").forEach((tabs) => {
    const buttons = tabs.querySelectorAll(".tab-btn");

    // setează tab-ul activ inițial
    let activeBtn =
      tabs.querySelector(".tab-btn.active") || tabs.querySelector(".tab-btn");
    if (activeBtn) {
      tabs.setAttribute("data-active", activeBtn.dataset.tab);
      const target = activeBtn.getAttribute("data-tab");
      if (target) {
        document
          .querySelectorAll(".tab-section")
          .forEach((s) => s.classList.remove("active"));
        const section = document.getElementById(target);
        if (section) section.classList.add("active");
      }
    }

    buttons.forEach((btn) => {
      btn.addEventListener("click", () => {
        buttons.forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");

        const target = btn.getAttribute("data-tab");
        tabs.setAttribute("data-active", target || "");

        // activăm secțiunea aferentă
        if (target) {
          document
            .querySelectorAll(".tab-section")
            .forEach((s) => s.classList.remove("active"));
          const section = document.getElementById(target);
          if (section) section.classList.add("active");
        }
      });
    });
  });

  // Pornește aplicația corectă
  if (pageType === "user") {
    initUserApp();
  } else if (pageType === "admin") {
    initAdminApp();
  }
});

/* ============================
   USER MINIAPP (index.html)
   ============================ */

function initUserApp() {
  const tg = window.Telegram?.WebApp;

  let CURRENT_USER = null;
  let CURRENT_SHOP = null;
  let CURRENT_TICKETS = [];
  let SELECTED_TICKET_ID = null;
  let POLL_INTERVAL = null;

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
  const ticketsInfoEl = document.getElementById("ticketsInfo");

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
        right.style.textAlign = "right";

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

      // schimbă pe tab-ul de tichete
      const ticketsTabBtn = document.querySelector(
        '.tab-btn[data-tab="ticketsTab"]'
      );
      if (ticketsTabBtn) ticketsTabBtn.click();
    } catch (err) {
      console.error("buy_product error:", err);
      panelStatusEl.className = "status-bar status-error";
      panelStatusEl.textContent = "Eroare la comunicarea cu serverul.";
    }
  }

  panelCloseBtn?.addEventListener("click", closeProductPanel);
  panelBuyBtn?.addEventListener("click", buySelectedProduct);

  /* ---------- CHAT (user) ---------- */

  function renderTicketsInfo() {
    if (!CURRENT_TICKETS || CURRENT_TICKETS.length === 0) {
      ticketsInfoEl.textContent =
        "Nu ai tichete încă. Când cumperi un produs se creează automat un tichet.";
    } else {
      const openCount = CURRENT_TICKETS.filter((t) => t.status === "open")
        .length;
      ticketsInfoEl.innerHTML = `Ai <b>${CURRENT_TICKETS.length}</b> tichete, dintre care <b>${openCount}</b> deschise.`;
    }
  }

  function getTicketLastMessage(t) {
    const msgs = t.messages || [];
    if (msgs.length === 0) return "";
    return msgs[msgs.length - 1].text || "";
  }

  function renderTicketsList() {
    chatListEl.innerHTML = "";
    if (!CURRENT_TICKETS || CURRENT_TICKETS.length === 0) {
      chatListEl.innerHTML =
        '<div style="padding:8px;font-size:12px;color:var(--muted);">Nu ai tichete încă.</div>';
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
      const lastMsg = getTicketLastMessage(t);

      const line = document.createElement("div");
      line.className = "chat-item-line";
      line.textContent = `[${statusText}] ${lastMsg}`;

      item.appendChild(title);
      item.appendChild(line);

      item.addEventListener("click", () => selectTicket(t.id));

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
      <span>${t.product_name} · ${t.qty} buc · total ${t.total_price} credite · status: ${t.status}</span>
    `;

    renderChatMessages(t);
  }

  function renderChatMessages(ticket) {
    const msgs = ticket.messages || [];
    chatMessagesEl.innerHTML = "";

    msgs.forEach((m) => {
      const row = document.createElement("div");
      row.className = "msg-row " + m.from;

      const bubble = document.createElement("div");
      bubble.className = "msg-bubble " + m.from;
      bubble.textContent = m.text;

      const meta = document.createElement("div");
      meta.className = "msg-meta";
      meta.textContent = m.sender || "";

      bubble.appendChild(meta);
      row.appendChild(bubble);

      chatMessagesEl.appendChild(row);
    });

    chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
  }

  async function sendChatMessage() {
    const text = chatInputEl.value.trim();
    if (!text || !SELECTED_TICKET_ID) return;

    chatInputEl.value = "";

    try {
      const res = await apiCall("user_send_message", {
        ticket_id: SELECTED_TICKET_ID,
        text,
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

  async function pollTickets() {
    if (!CURRENT_USER) return;
    try {
      const res = await apiCall("user_get_tickets", {});
      if (!res.ok) return;
      CURRENT_TICKETS = res.tickets || [];
      renderTicketsList();
      renderTicketsInfo();

      if (SELECTED_TICKET_ID) {
        const t = CURRENT_TICKETS.find((x) => x.id === SELECTED_TICKET_ID);
        if (t) {
          selectTicket(t.id);
        }
      }
    } catch (err) {
      console.error("user_get_tickets error:", err);
    }
  }

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
      renderTicketsInfo();

      POLL_INTERVAL = setInterval(pollTickets, 3000);
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
  const ticketStatusSelect = document.getElementById("ticketStatusSelect");
  const ticketNoteEl = document.getElementById("ticketNote");
  const ticketStatusBarEl = document.getElementById("ticketStatusBar");

  const shopContainerEl = document.getElementById("shopContainer");
  const shopStatusBarEl = document.getElementById("shopStatusBar");
  const addCategoryBtn = document.getElementById("addCategoryBtn");
  const saveShopBtn = document.getElementById("saveShopBtn");
  const ticketSaveBtn = document.getElementById("ticketSaveBtn");
  const ticketCloseBtn = document.getElementById("ticketCloseBtn");

  let ALL_TICKETS = [];
  let CURRENT_SHOP = null;
  let SELECTED_TICKET_ID = null;
  let POLL_INTERVAL = null;

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

  /* ---------- CHAT ADMIN ---------- */

  function getTicketLastMessage(t) {
    const msgs = t.messages || [];
    if (msgs.length === 0) return "";
    return msgs[msgs.length - 1].text || "";
  }

  function renderTicketsList() {
    ticketsListEl.innerHTML = "";
    if (!ALL_TICKETS || ALL_TICKETS.length === 0) {
      ticketsListEl.innerHTML =
        '<div style="padding:8px;font-size:12px;color:var(--muted);">Nu există tichete încă.</div>';
      ticketDetailsEl.style.display = "none";
      chatHeaderEl.innerHTML = "<span>Niciun tichet selectat</span>";
      chatMessagesEl.innerHTML = "";
      return;
    }

    ALL_TICKETS.sort((a, b) => {
      if (a.status !== b.status) {
        return a.status === "open" ? -1 : 1;
      }
      return (b.id || 0) - (a.id || 0);
    });

    ALL_TICKETS.forEach((t) => {
      const item = document.createElement("div");
      item.className = "chat-item";
      if (t.id === SELECTED_TICKET_ID) item.classList.add("active");

      const title = document.createElement("div");
      title.className = "chat-item-title";
      title.textContent = (t.username || t.user_id) + " · " + (t.product_name || "");

      const statusText = t.status === "open" ? "DESCHIS" : "ÎNCHIS";
      const lastMsg = getTicketLastMessage(t);

      const line = document.createElement("div");
      line.className = "chat-item-line";
      line.textContent = `[${statusText}] ${lastMsg}`;

      item.appendChild(title);
      item.appendChild(line);

      item.addEventListener("click", () => selectTicket(t.id));

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

    renderChatMessages(t);

    ticketDetailsEl.style.display = "block";
    ticketSummaryEl.innerHTML = `
      <b>Tichet #${t.id}</b><br/>
      User: <b>${t.username || t.user_id}</b><br/>
      Produs: <b>${t.product_name}</b> (${t.qty} buc, total ${
      t.total_price
    } credite)
    `;
    ticketStatusSelect.value = t.status || "open";
    ticketNoteEl.value = t.note || "";
    ticketStatusBarEl.textContent = "";
    ticketStatusBarEl.className = "status-bar";
  }

  function renderChatMessages(ticket) {
    const msgs = ticket.messages || [];
    chatMessagesEl.innerHTML = "";

    msgs.forEach((m) => {
      const row = document.createElement("div");
      row.className = "msg-row " + m.from;

      const bubble = document.createElement("div");
      bubble.className = "msg-bubble " + m.from;
      bubble.textContent = m.text;

      const meta = document.createElement("div");
      meta.className = "msg-meta";
      meta.textContent = m.sender || "";

      bubble.appendChild(meta);
      row.appendChild(bubble);

      chatMessagesEl.appendChild(row);
    });

    chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
  }

  async function sendAdminMessage() {
    const text = chatInputEl.value.trim();
    if (!text || !SELECTED_TICKET_ID) return;

    chatInputEl.value = "";

    try {
      const res = await apiCall("admin_send_message", {
        ticket_id: SELECTED_TICKET_ID,
        text,
        sender: "Admin",
      });

      if (!res.ok) {
        console.error("admin_send_message error:", res);
        return;
      }

      const updated = res.ticket;
      const idx = ALL_TICKETS.findIndex((t) => t.id === updated.id);
      if (idx >= 0) {
        ALL_TICKETS[idx] = updated;
      } else {
        ALL_TICKETS.push(updated);
      }

      renderTicketsList();
      selectTicket(updated.id);
    } catch (err) {
      console.error("admin_send_message error:", err);
    }
  }

  chatSendBtn?.addEventListener("click", sendAdminMessage);
  chatInputEl?.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendAdminMessage();
    }
  });

  async function saveSelectedTicket(closed = false) {
    if (!SELECTED_TICKET_ID) return;
    const t = ALL_TICKETS.find((x) => x.id === SELECTED_TICKET_ID);
    if (!t) return;

    const newStatus = closed ? "closed" : ticketStatusSelect.value;
    const note = ticketNoteEl.value || "";

    ticketStatusBarEl.textContent = "Se salvează tichetul...";
    ticketStatusBarEl.className = "status-bar";

    try {
      const res = await apiCall("admin_update_ticket", {
        ticket_id: t.id,
        status: newStatus,
        note: note,
      });

      if (!res.ok) {
        ticketStatusBarEl.textContent =
          "Eroare la salvare: " + (res.error || "necunoscută");
        ticketStatusBarEl.className = "status-bar status-error";
        return;
      }

      t.status = newStatus;
      t.note = note;

      ticketStatusBarEl.textContent = "Tichet salvat.";
      ticketStatusBarEl.className = "status-bar status-ok";

      renderTicketsList();
    } catch (err) {
      console.error("admin_update_ticket error:", err);
      ticketStatusBarEl.textContent = "Eroare la comunicarea cu serverul.";
      ticketStatusBarEl.className = "status-bar status-error";
    }
  }

  ticketSaveBtn?.addEventListener("click", () => saveSelectedTicket(false));
  ticketCloseBtn?.addEventListener("click", () => saveSelectedTicket(true));

  /* ---------- SHOP EDITOR ADMIN ---------- */

  function renderShopEditor() {
    shopContainerEl.innerHTML = "";
    if (!CURRENT_SHOP || !CURRENT_SHOP.categories) {
      shopContainerEl.innerHTML =
        '<div style="font-size:12px;color:var(--muted);">Nu există categorii. Adaugă una nouă.</div>';
      return;
    }

    CURRENT_SHOP.categories.forEach((cat, catIndex) => {
      const catDiv = document.createElement("div");
      catDiv.className = "cat-card";

      const header = document.createElement("div");
      header.className = "cat-header";

      const nameInput = document.createElement("input");
      nameInput.placeholder = "Nume categorie";
      nameInput.value = cat.name || "";
      nameInput.addEventListener("input", () => {
        cat.name = nameInput.value;
      });

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

      header.appendChild(nameInput);
      header.appendChild(deleteBtn);

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

      catDiv.appendChild(header);
      catDiv.appendChild(descDiv);
      catDiv.appendChild(productsWrap);

      shopContainerEl.appendChild(catDiv);
    });
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

  /* ---------- POLLING ADMIN ---------- */

  async function pollAdminTickets() {
    if (!ADMIN_TOKEN) return;
    try {
      const res = await apiCall("admin_get_tickets", {});
      if (!res.ok) {
        if (res.error === "forbidden") {
          userLineEl.innerHTML =
            "<span style='color:#ff5252;'>Token invalid.</span>";
        }
        return;
      }
      ALL_TICKETS = res.tickets || [];
      CURRENT_SHOP = res.shop || { categories: [] };

      renderTicketsList();
      renderShopEditor();

      if (SELECTED_TICKET_ID) {
        const t = ALL_TICKETS.find((x) => x.id === SELECTED_TICKET_ID);
        if (t) {
          selectTicket(t.id);
        }
      }
    } catch (err) {
      console.error("admin_get_tickets error:", err);
      userLineEl.innerHTML =
        "<span style='color:#ff5252;'>Eroare la rețea.</span>";
    }
  }

  async function initAdmin() {
    renderTokenInfo();
    if (!ADMIN_TOKEN) return;
    await pollAdminTickets();
    POLL_INTERVAL = setInterval(pollAdminTickets, 3000);
  }

  initAdmin();
}
