// app.js

// ID admin – are voie să creeze categorii & canale
const ADMIN_ID = 7672256597;

// Cheie pentru localStorage (istoric + structura de canale la nivel de device)
const STORAGE_KEY = "tg-miniapp-discord-state-v1";

let tg = null;
let currentUser = {
  id: null,
  username: null,
  displayName: null,
  avatarUrl: null,
  isAdmin: false,
};

// State local (demo, doar în browserul fiecăruia)
let appState = {
  categories: [],
  channels: {},      // channelId -> {id, name, categoryId}
  messages: {},      // channelId -> [ {id, text, ts, username, displayName, ...} ]
  activeChannelId: null,
  onlineUsers: [],   // [ {id, username, displayName, lastSeen} ]
};

// -------------------------------------------------------------
// Utils
// -------------------------------------------------------------
function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      const defaultCategory = { id: "cat-default", name: "General" };
      const defaultChannel = {
        id: "ch-general",
        name: "#general",
        categoryId: "cat-default",
      };

      appState.categories = [defaultCategory];
      appState.channels[defaultChannel.id] = defaultChannel;
      appState.messages[defaultChannel.id] = [];
      appState.activeChannelId = defaultChannel.id;
      return;
    }
    appState = JSON.parse(raw);
  } catch (e) {
    console.error("Nu pot încărca state-ul:", e);
  }
}

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(appState));
  } catch (e) {
    console.error("Nu pot salva state-ul:", e);
  }
}

function formatTime(ts) {
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

function randomId(prefix = "id") {
  return prefix + "-" + Math.random().toString(36).slice(2, 10);
}

// -------------------------------------------------------------
// Telegram init – versiune FIXATĂ
//   - dacă există window.Telegram.WebApp => considerăm context valid Telegram
//   - nu mai verificăm tg.initData.length
// -------------------------------------------------------------
function initTelegramStrict() {
  if (!window.Telegram || !window.Telegram.WebApp) {
    // Nu există Telegram.WebApp => e browser obișnuit => arătăm eroarea
    return false;
  }

  tg = window.Telegram.WebApp;

  try {
    tg.ready();
    tg.expand();
  } catch (e) {
    console.warn("Eroare la tg.ready()/expand():", e);
  }

  const unsafe = tg.initDataUnsafe || {};
  const user = unsafe.user;

  if (user) {
    currentUser.id = user.id;
    currentUser.username = user.username || null;
    currentUser.displayName =
      user.first_name + (user.last_name ? " " + user.last_name : "");
    currentUser.isAdmin = user.id === ADMIN_ID;
    currentUser.avatarUrl = null; // poți pune URL real din backend
  } else {
    // WebApp există, dar nu avem user -> caz rar; nu punem „Guest”, doar generic
    currentUser.id = null;
    currentUser.username = null;
    currentUser.displayName = "Telegram user";
    currentUser.isAdmin = false;
    currentUser.avatarUrl = null;
  }

  return true;
}

// -------------------------------------------------------------
// Error screen vs app
// -------------------------------------------------------------
function showApp() {
  const errorScreen = document.getElementById("error-screen");
  const appRoot = document.getElementById("app-root");

  if (errorScreen) errorScreen.classList.add("hidden");
  if (appRoot) appRoot.classList.remove("hidden");
}

function showErrorOnly() {
  const errorScreen = document.getElementById("error-screen");
  const appRoot = document.getElementById("app-root");

  if (appRoot) appRoot.classList.add("hidden");
  if (errorScreen) errorScreen.classList.remove("hidden");
}

// -------------------------------------------------------------
// Online users – demo local (pe device)
// -------------------------------------------------------------
function touchCurrentUserOnline() {
  const now = Date.now();
  const existingIndex = appState.onlineUsers.findIndex((u) => u.id === currentUser.id);

  const userObj = {
    id: currentUser.id,
    username: currentUser.username,
    displayName: currentUser.displayName,
    lastSeen: now,
  };

  if (existingIndex === -1) {
    appState.onlineUsers.push(userObj);
  } else {
    appState.onlineUsers[existingIndex] = userObj;
  }

  const cutoff = now - 5 * 60 * 1000;
  appState.onlineUsers = appState.onlineUsers.filter((u) => u.lastSeen >= cutoff);

  saveState();
}

function renderOnlineUsers() {
  const container = document.getElementById("online-list");
  const countSpan = document.getElementById("online-count");
  if (!container) return;

  const now = Date.now();
  const cutoff = now - 5 * 60 * 1000;
  const online = appState.onlineUsers.filter((u) => u.lastSeen >= cutoff);

  container.innerHTML = "";

  online.forEach((u) => {
    const row = document.createElement("div");
    row.className = "online-user";

    const dot = document.createElement("div");
    dot.className = "online-dot";

    const textWrap = document.createElement("div");
    const main = document.createElement("div");
    main.className = "online-user-main";
    main.textContent = u.displayName || u.username || "User";

    const sub = document.createElement("div");
    sub.className = "online-user-sub";
    sub.textContent = "online";

    textWrap.appendChild(main);
    textWrap.appendChild(sub);

    row.appendChild(dot);
    row.appendChild(textWrap);
    container.appendChild(row);
  });

  if (countSpan) {
    countSpan.textContent = online.length.toString();
  }
}

// -------------------------------------------------------------
// Current user UI
// -------------------------------------------------------------
function renderCurrentUser() {
  const nameEl = document.getElementById("current-user-name");
  const tagEl = document.getElementById("current-user-tag");
  const avatarEl = document.getElementById("current-user-avatar");

  if (nameEl) {
    const label =
      currentUser.username != null
        ? `@${currentUser.username}`
        : currentUser.displayName || "User";
    nameEl.textContent = label;
  }

  if (tagEl) {
    tagEl.textContent = currentUser.isAdmin ? "Admin" : "Utilizator";
  }

  if (avatarEl) {
    avatarEl.innerHTML = "";
    if (currentUser.avatarUrl) {
      const img = document.createElement("img");
      img.src = currentUser.avatarUrl;
      img.alt = currentUser.username || currentUser.displayName || "avatar";
      avatarEl.appendChild(img);
    } else {
      const initials = (currentUser.displayName || currentUser.username || "U")
        .split(" ")
        .map((p) => p[0])
        .join("")
        .slice(0, 2)
        .toUpperCase();
      avatarEl.textContent = initials;
    }
  }

  const adminPanel = document.getElementById("admin-panel");
  if (adminPanel) {
    adminPanel.style.display = currentUser.isAdmin ? "block" : "none";
  }
}

// -------------------------------------------------------------
// Categories + channels
// -------------------------------------------------------------
function renderCategoriesAndChannels() {
  const container = document.getElementById("category-list");
  const categorySelect = document.getElementById("category-select");
  if (!container) return;

  container.innerHTML = "";

  if (categorySelect) {
    categorySelect.innerHTML = "";
    appState.categories.forEach((cat) => {
      const opt = document.createElement("option");
      opt.value = cat.id;
      opt.textContent = cat.name;
      categorySelect.appendChild(opt);
    });
  }

  appState.categories.forEach((cat) => {
    const block = document.createElement("div");
    block.className = "category-block";

    const header = document.createElement("div");
    header.className = "category-header";

    const left = document.createElement("span");
    const dot = document.createElement("span");
    dot.className = "category-dot";
    const name = document.createElement("span");
    name.textContent = cat.name.toUpperCase();

    left.appendChild(dot);
    left.appendChild(name);

    const count = document.createElement("span");
    const catChannels = Object.values(appState.channels).filter(
      (ch) => ch.categoryId === cat.id
    );
    count.textContent = catChannels.length.toString();

    header.appendChild(left);
    header.appendChild(count);

    const channelsWrap = document.createElement("div");
    channelsWrap.className = "category-channels";

    catChannels.forEach((ch) => {
      const item = document.createElement("div");
      item.className = "channel-item";
      if (appState.activeChannelId === ch.id) {
        item.classList.add("active");
      }

      const leftPart = document.createElement("div");
      leftPart.className = "channel-left";

      const hash = document.createElement("span");
      hash.className = "channel-hash";
      hash.textContent = "#";

      const label = document.createElement("span");
      label.textContent = ch.name.replace(/^#/, "");

      leftPart.appendChild(hash);
      leftPart.appendChild(label);

      const rightPart = document.createElement("span");
      rightPart.style.fontSize = "10px";
      rightPart.style.color = "var(--text-softer)";
      rightPart.textContent = ">";

      item.appendChild(leftPart);
      item.appendChild(rightPart);

      item.addEventListener("click", () => {
        appState.activeChannelId = ch.id;
        saveState();
        renderAll();
      });

      channelsWrap.appendChild(item);
    });

    block.appendChild(header);
    block.appendChild(channelsWrap);
    container.appendChild(block);
  });
}

// -------------------------------------------------------------
// Chat
// -------------------------------------------------------------
function renderChat() {
  const channelId = appState.activeChannelId;
  const active = appState.channels[channelId];
  const historyEl = document.getElementById("chat-history");
  const nameEl = document.getElementById("active-channel-name");
  const catEl = document.getElementById("active-channel-category");
  if (!historyEl || !active) return;

  const category = appState.categories.find((c) => c.id === active.categoryId);

  if (nameEl) {
    nameEl.textContent = active.name;
  }

  if (catEl) {
    catEl.textContent = category ? category.name : "Fără categorie";
  }

  historyEl.innerHTML = "";

  const msgs = appState.messages[channelId] || [];
  msgs.forEach((msg) => {
    const row = document.createElement("div");
    row.className = "message-row";

    const avatar = document.createElement("div");
    avatar.className = "message-avatar";

    if (msg.avatarUrl) {
      const img = document.createElement("img");
      img.src = msg.avatarUrl;
      img.alt = msg.username || msg.displayName || "avatar";
      avatar.appendChild(img);
    } else {
      const initials = (msg.displayName || msg.username || "U")
        .split(" ")
        .map((p) => p[0])
        .join("")
        .slice(0, 2)
        .toUpperCase();
      avatar.textContent = initials;
    }

    const body = document.createElement("div");
    body.className = "message-body";

    const header = document.createElement("div");
    header.className = "message-header";

    const uname = document.createElement("div");
    uname.className = "message-username";
    uname.textContent = msg.displayName || msg.username || "User";

    const meta = document.createElement("div");
    meta.className = "message-meta";
    const timeStr = formatTime(msg.ts);
    meta.textContent = timeStr + (msg.isAdmin ? " · Admin" : "");

    header.appendChild(uname);
    header.appendChild(meta);

    const content = document.createElement("div");
    content.className = "message-content";
    content.textContent = msg.text;

    body.appendChild(header);
    body.appendChild(content);

    row.appendChild(avatar);
    row.appendChild(body);

    historyEl.appendChild(row);
  });

  historyEl.scrollTop = historyEl.scrollHeight;
}

// -------------------------------------------------------------
// Mesaje – send
// -------------------------------------------------------------
function setupChatInput() {
  const input = document.getElementById("chat-input");
  const sendBtn = document.getElementById("send-btn");
  if (!input || !sendBtn) return;

  function sendMessage() {
    const text = input.value.trim();
    if (!text) return;
    const channelId = appState.activeChannelId;
    if (!channelId) return;

    const msg = {
      id: randomId("m"),
      text,
      ts: Date.now(),
      username: currentUser.username,
      displayName: currentUser.displayName,
      avatarUrl: currentUser.avatarUrl,
      isAdmin: currentUser.isAdmin,
    };

    if (!appState.messages[channelId]) {
      appState.messages[channelId] = [];
    }
    appState.messages[channelId].push(msg);
    saveState();

    input.value = "";
    renderChat();
    touchCurrentUserOnline();
    renderOnlineUsers();
  }

  sendBtn.addEventListener("click", sendMessage);

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });
}

// -------------------------------------------------------------
// Admin – create category + channel
// -------------------------------------------------------------
function setupAdminControls() {
  if (!currentUser.isAdmin) return;

  const catInput = document.getElementById("new-category-name");
  const catBtn = document.getElementById("create-category-btn");
  const chInput = document.getElementById("new-channel-name");
  const chBtn = document.getElementById("create-channel-btn");
  const catSelect = document.getElementById("category-select");

  if (catBtn && catInput) {
    catBtn.addEventListener("click", () => {
      const name = catInput.value.trim();
      if (!name) return;
      const id = randomId("cat");
      appState.categories.push({ id, name });
      catInput.value = "";
      saveState();
      renderCategoriesAndChannels();
    });
  }

  if (chBtn && chInput && catSelect) {
    chBtn.addEventListener("click", () => {
      const nameRaw = chInput.value.trim();
      const catId = catSelect.value;
      if (!nameRaw || !catId) return;

      const name = nameRaw.startsWith("#") ? nameRaw : "#" + nameRaw;
      const id = randomId("ch");
      const ch = { id, name, categoryId: catId };
      appState.channels[id] = ch;
      appState.messages[id] = [];
      appState.activeChannelId = id;

      chInput.value = "";
      saveState();
      renderCategoriesAndChannels();
      renderChat();
    });
  }
}

// -------------------------------------------------------------
// Buton „Versiune completă” – redirect
// -------------------------------------------------------------
function setupOpenFullButton() {
  const btn = document.getElementById("open-full-btn");
  if (!btn) return;

  const isMobile =
    /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) && window.innerWidth < 900;

  if (isMobile) {
    btn.style.display = "none";
    return;
  }

  btn.style.display = "inline-flex";

  btn.addEventListener("click", () => {
    openFullVersionWithSession();
  });
}

function openFullVersionWithSession() {
  if (!tg) {
    window.open("https://linxpwp.github.io/telegram-miniap", "_blank");
    return;
  }

  // TODO: aici pui logica ta cu backend + cookie securizat
  tg.openLink("https://linxpwp.github.io/telegram-miniap", { try_browser: true });
}

// -------------------------------------------------------------
// Render principal
// -------------------------------------------------------------
function renderAll() {
  renderCurrentUser();
  renderCategoriesAndChannels();
  renderChat();
  renderOnlineUsers();
}

// -------------------------------------------------------------
// Init general
// -------------------------------------------------------------
document.addEventListener("DOMContentLoaded", () => {
  const ok = initTelegramStrict();

  if (!ok) {
    // Nu e context Telegram WebApp valid => doar mesaj de eroare
    showErrorOnly();
    return;
  }

  // Context Telegram valid
  showApp();
  loadState();
  touchCurrentUserOnline();
  renderAll();
  setupChatInput();
  setupAdminControls();
  setupOpenFullButton();

  setInterval(() => {
    touchCurrentUserOnline();
    renderOnlineUsers();
  }, 30000);
});
