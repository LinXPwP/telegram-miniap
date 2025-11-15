// app.js

console.log("Miniapp version: 0.5.2");

// -------------------------------------------------------------
// CONFIG
// -------------------------------------------------------------
const ADMIN_ID = 7672256597;

// localStorage: structura de server, canale, mesaje (demo local)
const STORAGE_KEY = "tg-miniapp-discord-state-v1";

// cookie: token-ul de sesiune (nu expiră practic)
const SESSION_COOKIE = "tg_session_token";

// URL-UL API-ULUI TĂU DE SESIUNE (Flask)
// EX: const SESSION_API_BASE = "https://api.linx.ro/session";
const SESSION_API_BASE = "http://185.206.148.140:8140"; // <-- SCHIMBĂ AICI

// URL-ul site-ului (full version / redirect)
const FULL_SITE_URL = "https://linxpwp.github.io/telegram-miniap/";

// -------------------------------------------------------------
// STATE
// -------------------------------------------------------------
let tg = null;

let currentUser = {
  id: null,
  username: null,
  displayName: null,
  avatarUrl: null,
  isAdmin: false,
};

let appState = {
  categories: [],
  channels: {}, // channelId -> {id, name, categoryId}
  messages: {}, // channelId -> [ {id, text, ts, username, displayName, ...} ]
  activeChannelId: null,
  onlineUsers: [], // [ {id, username, displayName, lastSeen} ]
};

// -------------------------------------------------------------
// UTILS – localStorage
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

function randomId(prefix = "id") {
  return prefix + "-" + Math.random().toString(36).slice(2, 10);
}

function formatTime(ts) {
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

// -------------------------------------------------------------
// UTILS – cookies & token
// -------------------------------------------------------------
function getCookie(name) {
  const value = document.cookie
    .split("; ")
    .find((row) => row.startsWith(name + "="));
  return value ? decodeURIComponent(value.split("=")[1]) : null;
}

function setCookie(name, value, days) {
  let expires = "";
  if (days) {
    const d = new Date();
    d.setTime(d.getTime() + days * 24 * 60 * 60 * 1000);
    expires = "; expires=" + d.toUTCString();
  }
  document.cookie =
    name +
    "=" +
    encodeURIComponent(value) +
    expires +
    "; path=/; SameSite=Lax";
}

function getSessionToken() {
  return getCookie(SESSION_COOKIE);
}

function setSessionTokenCookie(token) {
  // 10 ani demo – practic „nu expiră”
  setCookie(SESSION_COOKIE, token, 365 * 10);
}

// Dacă URL are ?token=..., îl punem în cookie și curățăm URL-ul
function syncSessionFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const token = params.get("token");

  if (token) {
    setSessionTokenCookie(token);
    params.delete("token");
    const newSearch = params.toString();
    const newUrl =
      window.location.pathname +
      (newSearch ? "?" + newSearch : "") +
      window.location.hash;
    window.history.replaceState(null, "", newUrl);
  }

  return !!getSessionToken();
}

// Pentru redirect „Versiune completă” – dacă nu există cookie (rar), generăm unul random.
// ATENȚIE: în fluxul normal, cookie-ul vine din bot prin `?token=...` -> cookie.
function getOrCreateSessionToken() {
  let token = getSessionToken();
  if (!token) {
    token = randomId("local") + Date.now().toString(36);
    setSessionTokenCookie(token);
  }
  return token;
}

// -------------------------------------------------------------
// TELEGRAM – doar pentru openLink + look & feel (nu pentru username)
// -------------------------------------------------------------
function initTelegramObjectIfAny() {
  if (window.Telegram && window.Telegram.WebApp) {
    try {
      tg = window.Telegram.WebApp;
      tg.ready();
      tg.expand();
    } catch (e) {
      console.warn("Eroare la tg.ready()/expand():", e);
    }
  }
}

// -------------------------------------------------------------
// BACKEND – fetch user info din JSON (token -> info)
// -------------------------------------------------------------
async function fetchUserInfoByToken(token) {
  try {
    const url = `${SESSION_API_BASE}/${encodeURIComponent(token)}`;
    const res = await fetch(url, { credentials: "omit" });
    if (!res.ok) {
      console.warn("Token invalid sau API error:", res.status);
      return null;
    }
    const data = await res.json();

    return {
      id: data.user_id ?? null,
      username: data.username ?? null,
      displayName: data.full_name ?? null,
      isAdmin: !!data.is_admin,
      avatarUrl: null,
    };
  } catch (e) {
    console.error("Eroare la fetchUserInfoByToken:", e);
    return null;
  }
}

// -------------------------------------------------------------
// UI – error vs app
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
// ONLINE – demo local
// -------------------------------------------------------------
function touchCurrentUserOnline() {
  const now = Date.now();
  const existingIndex = appState.onlineUsers.findIndex(
    (u) => u.id === currentUser.id
  );

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
  appState.onlineUsers = appState.onlineUsers.filter(
    (u) => u.lastSeen >= cutoff
  );

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
    const label =
      (u.username ? "@" + u.username : u.displayName || "User") +
      (u.id ? " · #" + u.id : "");
    main.textContent = label;

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
// CURRENT USER UI
// -------------------------------------------------------------
function renderCurrentUser() {
  const nameEl = document.getElementById("current-user-name");
  const tagEl = document.getElementById("current-user-tag");
  const avatarEl = document.getElementById("current-user-avatar");

  if (nameEl) {
    let label;
    if (currentUser.username) {
      label = `@${currentUser.username}`;
    } else if (currentUser.displayName) {
      label =
        currentUser.displayName +
        (currentUser.id ? ` · #${currentUser.id}` : "");
    } else {
      label = "User";
    }
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
      img.alt =
        currentUser.username || currentUser.displayName || "avatar";
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
// CATEGORIES + CHANNELS
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
// CHAT
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
    const label =
      (msg.username ? "@" + msg.username : msg.displayName || "User") +
      (msg.isAdmin ? " · Admin" : "");
    uname.textContent = label;

    const meta = document.createElement("div");
    meta.className = "message-meta";
    meta.textContent = formatTime(msg.ts);

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
// CHAT INPUT
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
// ADMIN – categorie + canal
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
// BUTON „VERSIUNE COMPLETĂ” – redirect cu token în URL
// -------------------------------------------------------------
function setupOpenFullButton() {
  const btn = document.getElementById("open-full-btn");
  if (!btn) return;

  const isMobile =
    /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) &&
    window.innerWidth < 900;

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
  const token = getOrCreateSessionToken();
  const url =
    FULL_SITE_URL +
    (FULL_SITE_URL.includes("?") ? "&" : "?") +
    "token=" +
    encodeURIComponent(token);

  if (tg) {
    tg.openLink(url, { try_browser: true });
  } else {
    window.open(url, "_blank");
  }
}

// -------------------------------------------------------------
// MOBILE TABS – #Canale / Chat / Online
// -------------------------------------------------------------
function setupMobileTabs() {
  const tabs = document.querySelectorAll(".mobile-tab-btn");
  const channelsPanel = document.getElementById("channels-panel");
  const chatPanel = document.getElementById("chat-panel");
  const onlinePanel = document.getElementById("online-panel");

  if (!tabs.length || !channelsPanel || !chatPanel || !onlinePanel) return;

  function applyMobileState() {
    const isMobile = window.innerWidth <= 900;
    if (!isMobile) {
      channelsPanel.classList.remove("mobile-hidden");
      chatPanel.classList.remove("mobile-hidden");
      onlinePanel.classList.remove("mobile-hidden");
      return;
    }

    const activeTab =
      document.querySelector(".mobile-tab-btn.active") || tabs[0];
    const target = activeTab.getAttribute("data-panel");

    [channelsPanel, chatPanel, onlinePanel].forEach((panel) => {
      panel.classList.add("mobile-hidden");
    });

    if (target === "channels-panel")
      channelsPanel.classList.remove("mobile-hidden");
    if (target === "chat-panel") chatPanel.classList.remove("mobile-hidden");
    if (target === "online-panel")
      onlinePanel.classList.remove("mobile-hidden");
  }

  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      tabs.forEach((t) => t.classList.remove("active"));
      tab.classList.add("active");
      applyMobileState();
    });
  });

  window.addEventListener("resize", applyMobileState);
  applyMobileState();
}

// -------------------------------------------------------------
// RENDER ROOT
// -------------------------------------------------------------
function renderAll() {
  renderCurrentUser();
  renderCategoriesAndChannels();
  renderChat();
  renderOnlineUsers();
}

// -------------------------------------------------------------
// INIT
// -------------------------------------------------------------
document.addEventListener("DOMContentLoaded", async () => {
  // 1) Telegram object (doar pentru openLink + expand)
  initTelegramObjectIfAny();

  // 2) token din URL -> cookie & cleanup
  syncSessionFromUrl();
  const token = getSessionToken();

  if (!token) {
    console.warn("Fără token în URL/cookie -> blocare acces");
    showErrorOnly();
    return;
  }

  // 3) luăm user info din backend JSON (token -> {user_id, username, full_name, is_admin})
  const info = await fetchUserInfoByToken(token);
  if (!info) {
    console.warn("Token nu există în JSON sau API nu merge -> blocare acces");
    showErrorOnly();
    return;
  }

  currentUser.id = info.id;
  currentUser.username = info.username;
  currentUser.displayName = info.displayName || "User";
  currentUser.isAdmin = info.isAdmin;
  currentUser.avatarUrl = info.avatarUrl;

  // 4) pornim aplicația
  showApp();
  loadState();
  touchCurrentUserOnline();
  renderAll();
  setupChatInput();
  setupAdminControls();
  setupOpenFullButton();
  setupMobileTabs();

  setInterval(() => {
    touchCurrentUserOnline();
    renderOnlineUsers();
  }, 30000);
});
