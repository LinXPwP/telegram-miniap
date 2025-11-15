// app.js

// -------------------------------------------------------------
// Constante
// -------------------------------------------------------------
const ADMIN_ID = 7672256597; // user id admin
const STORAGE_KEY = "tg-miniapp-discord-state-v1";

// -------------------------------------------------------------
// State local
// -------------------------------------------------------------
let tg = null;
let currentUser = {
  id: null,
  username: "guest",
  displayName: "Guest",
  avatarUrl: null,
  isAdmin: false,
};

let appState = {
  categories: [],
  channels: {}, // channelId -> {id, name, categoryId}
  messages: {}, // channelId -> [{id, author, text, ts}]
  activeChannelId: null,
  onlineUsers: [],
};

// -------------------------------------------------------------
// Utilitare
// -------------------------------------------------------------
function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      // state default cu o categorie și canal
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
// Init Telegram WebApp / Environment
// -------------------------------------------------------------
function initTelegram() {
  tg = window.Telegram && window.Telegram.WebApp ? window.Telegram.WebApp : null;

  if (tg) {
    tg.ready();
    tg.expand();

    const user = tg.initDataUnsafe && tg.initDataUnsafe.user;
    if (user) {
      currentUser.id = user.id;
      currentUser.username = user.username || `user${user.id}`;
      currentUser.displayName = user.first_name + (user.last_name ? " " + user.last_name : "");
      currentUser.isAdmin = user.id === ADMIN_ID;

      // Avatar: Telegram nu dă direct url aici, dar îl vom reprezenta ca inițiale,
      // sau, dacă ai un backend, poți genera avatar URL.
      currentUser.avatarUrl = null;
    }
  } else {
    // rulăm în browser normal – mod debug
    const params = new URLSearchParams(window.location.search);
    const mockAdmin = params.get("admin") === "1";

    currentUser.id = mockAdmin ? ADMIN_ID : 12345;
    currentUser.username = mockAdmin ? "admin_user" : "web_user";
    currentUser.displayName = mockAdmin ? "Admin User" : "Web User";
    currentUser.isAdmin = mockAdmin;
    currentUser.avatarUrl = null;
  }
}

function setupOpenFullButton() {
  const btn = document.getElementById("open-ful
