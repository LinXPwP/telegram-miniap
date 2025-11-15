// app.js

console.log("Miniapp version: 0.5.0");

// ID admin – are voie să creeze categorii & canale
const ADMIN_ID = 7672256597;

// Cheie pentru localStorage (istoric + structura de canale la nivel de device)
const STORAGE_KEY = "tg-miniapp-discord-state-v1";
const SESSION_COOKIE = "tg_session_token";

let currentUser = {
  id: null,
  username: null,
  displayName: null,
  avatarUrl: null,
  isAdmin: false,
};

let tg = null; // doar pentru tg.openLink (opțional)

// State local
let appState = {
  categories: [],
  channels: {},
  messages: {},
  activeChannelId: null,
  onlineUsers: [],
};

// -------------------------------------------------------------
// LocalStorage – chat state
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
// Cookies + token
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

// 1) ia tokenul din URL, dacă există, îl pune în cookie, apoi curăță URL-ul
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
}

// -------------------------------------------------------------
// Decode user din token (Base64 URL-safe -> JSON {uid, uname, name})
// -------------------------------------------------------------
function decodeUserFromToken(token) {
  if (!token) return null;
  try {
    let b64 = token.replace(/-/g, "+").replace(/_/g, "/");
    while (b64.length % 4 !== 0) b64 += "=";
    const json = atob(b64);
    const data = JSON.parse(json);
    if (!data || typeof data.uid === "undefined") return null;
    return {
      id: data.uid,
      username: data.uname || null,
      displayName: data.name || null,
      isAdmin: data.uid === ADMIN_ID,
      avatarUrl: null,
    };
  } catch (e) {
    console.warn("Token invalid, nu pot decoda user:", e);
    return null;
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
// Chat input
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
// Admin controls
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
// Versiune completă – păstrăm același token
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
  const token = getSessionToken();
  if (!token) {
    alert("Nu există token de sesiune. Deschide mini-app-ul din /start.");
    return;
  }

  const url =
    FULL_SITE_URL + (FULL_SITE_URL.includes("?") ? "&" : "?") + "token=" +
    encodeURIComponent(token);

  if (window.Telegram && window.Telegram.WebApp) {
    tg = window.Telegram.WebApp;
    tg.openLink(url, { try_browser: true });
  } else {
    window.open(url, "_blank");
  }
}

// -------------------------------------------------------------
// Mobile tabs (Canale / Chat / Online)
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
// Init
// -------------------------------------------------------------
document.addEventListener("DOMContentLoaded", () => {
  // 1) token din URL -> cookie
  syncSessionFromUrl();
  const token = getSessionToken();

  if (!token) {
    console.warn("Nu există token în URL/cookie -> acces blocat");
    showErrorOnly();
    return;
  }

  // 2) decodăm user-ul din token
  const userInfo = decodeUserFromToken(token);
  if (!userInfo) {
    console.warn("Token invalid -> acces blocat");
    showErrorOnly();
    return;
  }

  currentUser = userInfo;

  // 3) pornim app
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
