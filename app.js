// app.js

console.log("Miniapp version: 0.4.1");

// ID admin – are voie să creeze categorii & canale
const ADMIN_ID = 7672256597;

// Cheie pentru localStorage (istoric + structura de canale la nivel de device)
const STORAGE_KEY = "tg-miniapp-discord-state-v1";
const SESSION_COOKIE = "tg_session_token";

// cheie pentru user info per token
const USER_INFO_PREFIX = "tg_userinfo_";

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
  channels: {},
  messages: {},
  activeChannelId: null,
  onlineUsers: [],
};

// -------------------------------------------------------------
// Utils: localStorage
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
// Cookies & token
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
  setCookie(SESSION_COOKIE, token, 365 * 10); // practic "nu expiră"
}

// dacă în URL există ?token=..., îl punem în cookie și curățăm URL-ul
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

function getOrCreateSessionToken() {
  let token = getSessionToken();
  if (!token) {
    // normal, nu ar trebui să se întâmple, Bot-ul tot timpul pune token în URL
    token = randomId("fallback") + Date.now().toString(36);
    setSessionTokenCookie(token);
  }
  return token;
}

// -------------------------------------------------------------
// User info per token (salvat local, ca să îl știm și în website)
// -------------------------------------------------------------
function userInfoKeyForToken(token) {
  return USER_INFO_PREFIX + token;
}

function saveUserInfoForToken(token, info) {
  if (!token || !info) return;
  try {
    const safe = {
      id: info.id ?? null,
      username: info.username ?? null,
      displayName: info.displayName ?? null,
      isAdmin: info.isAdmin ?? false,
      avatarUrl: info.avatarUrl ?? null,
    };
    localStorage.setItem(userInfoKeyForToken(token), JSON.stringify(safe));
  } catch (e) {
    console.warn("Nu pot salva user info pentru token:", e);
  }
}

function loadUserInfoForToken(token) {
  if (!token) return null;
  try {
    const raw = localStorage.getItem(userInfoKeyForToken(token));
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (e) {
    console.warn("Nu pot citi user info pentru token:", e);
    return null;
  }
}

// -------------------------------------------------------------
// Telegram helpers – doar pentru EXTRAS username + id
// (nu mai folosim asta la gating, gating-ul se face DOAR pe token)
// -------------------------------------------------------------
function tryParseUserFromInitData(initDataString) {
  if (!initDataString) return null;
  try {
    const params = new URLSearchParams(initDataString);
    const userParam = params.get("user");
    if (!userParam) return null;
    return JSON.parse(userParam);
  } catch (e) {
    console.warn("Nu pot parsa user din initData:", e);
    return null;
  }
}

function initTelegramUserIfAvailable(sessionToken) {
  let info = null;

  if (window.Telegram && window.Telegram.WebApp) {
    tg = window.Telegram.WebApp;

    try {
      tg.ready();
      tg.expand();
    } catch (e) {
      console.warn("Eroare la tg.ready()/expand():", e);
    }

    const unsafe = tg.initDataUnsafe || {};
    let user = unsafe.user;

    if (!user && typeof tg.initData === "string" && tg.initData.length > 0) {
      const parsed = tryParseUserFromInitData(tg.initData);
      if (parsed) user = parsed;
    }

    if (user) {
      info = {
        id: user.id,
        username: user.username || null,
        displayName:
          user.first_name + (user.last_name ? " " + user.last_name : ""),
        isAdmin: user.id === ADMIN_ID,
        avatarUrl: null,
      };
      console.log("User din Telegram WebApp:", info);
    }
  }

  // dacă am reușit să citim user-ul acum, îl salvăm pentru token
  if (info && sessionToken) {
    saveUserInfoForToken(sessionToken, info);
  }

  // dacă NU am reușit din Telegram, încercăm să încărcăm din localStorage
  if (!info && sessionToken) {
    const stored = loadUserInfoForToken(sessionToken);
    if (stored) {
      info = stored;
      console.log("User încărcat din localStorage pentru token:", stored);
    }
  }

  // aplicăm info pe currentUser
  if (info) {
    currentUser.id = info.id;
    currentUser.username = info.username;
    currentUser.displayName = info.displayName;
    currentUser.isAdmin = info.isAdmin;
    currentUser.avatarUrl = info.avatarUrl;
  } else {
    // fallback complet
    currentUser.displayName = "User anonim";
    currentUser.username = null;
    currentUser.id = null;
    currentUser.isAdmin = false;
    currentUser.avatarUrl = null;
  }
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
// Online demo
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
// Current user UI
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
    const label =
      (msg.username ? "@" + msg.username : msg.displayName || "User") +
      (msg.isAdmin ? " · Admin" : "");
    uname.textContent = label;

    const meta = document.createElement("div");
    meta.className = "message-meta";
    const timeStr = formatTime(msg.ts);
    meta.textContent = timeStr;

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
// Buton „Versiune completă” – redirect cu token în URL
// -------------------------------------------------------------
const FULL_SITE_URL = "https://linxpwp.github.io/telegram-miniap/";

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
    FULL_SITE_URL + (FULL_SITE_URL.includes("?") ? "&" : "?") + "token=" +
    encodeURIComponent(token);

  if (tg) {
    tg.openLink(url, { try_browser: true });
  } else {
    window.open(url, "_blank");
  }
}

// -------------------------------------------------------------
// Mobile tabs (Canale / Chat / Online) – deja ai CSS pentru asta
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
  // 1) token din URL -> cookie + curățăm URL-ul
  const syncOk = syncSessionFromUrl();
  const token = getSessionToken();

  // 2) gating: dacă nu avem token nici în URL, nici în cookie => eroare
  if (!token) {
    console.warn("Nu există token în URL/cookie -> acces blocat");
    showErrorOnly();
    return;
  }

  // 3) extragem username/id din Telegram dacă suntem în WebApp,
  //    sau din localStorage dacă suntem pe website simplu
  initTelegramUserIfAvailable(token);

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
