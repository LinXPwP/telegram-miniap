// app.js - HARDENED: Safer DOM (XSS-resistant) + Proof upload via ImgBB (client) with fallback to /api/upload_proxy (Worker -> Flask)

"use strict";

const API_URL = "https://api.redgen.vip/";

// ✅ ImgBB key back (NOTE: anything in client JS is public; users can see it in DevTools)
const IMGBB_API_KEY = "8b7eef65280614c71acd1e1ce317aa64"; // e.g. "8b7eef65280614c71acd1e1ce317aa64"

// ---------------------------
// Helpers
// ---------------------------
const $ = (id) => document.getElementById(id);
const show = (el, d = "flex") => { if (el) el.style.display = d; };
const hide = (el) => { if (el) el.style.display = "none"; };

let LAST_USER_ACTION = Date.now();
const updateActivity = () => { LAST_USER_ACTION = Date.now(); };
["mousemove", "keydown", "touchstart", "scroll", "click"].forEach((e) =>
  document.addEventListener(e, updateActivity, { passive: true })
);

// --- CONFIGURATION ---
const PACKAGES = [
  { credits: 110, price: 5, bonus: 10 },
  { credits: 240, price: 10, bonus: 40 },
  { credits: 500, price: 20, bonus: 100 },
];
const CREDIT_RATE = 20; // 1 USD = 20 CRD

const PAY_METHODS = {
  paypal: {
    name: "PayPal F&F",
    icon: "🅿️",
    detail: "linx02048@gmail.com",
    warning:
      "MUST be Friends & Family. If not available in your country, choose another method or you risk losing money.",
  },
  binance: { name: "Binance Pay", icon: "🔶", detail: "458753123" },
  ltc: { name: "Litecoin (LTC)", icon: "Ł", detail: "LWCryENgoijoT8LQWQgGsSSNk9eHgnfaTF" },
  btc: { name: "Bitcoin (BTC)", icon: "₿", detail: "1LReFxV4Zk7cQaWMzSjareRGMoFaQesGoo" },
};

// Safer URL check for images/links (avoid javascript: etc.)
function safeUrl(input) {
  const s = String(input || "").trim();
  if (!s) return null;
  try {
    const u = new URL(s, window.location.origin);
    if (u.protocol === "http:" || u.protocol === "https:") return u.toString();
    return null;
  } catch {
    return null;
  }
}

// Basic text sanitization for UI (we still use textContent everywhere for dynamic strings)
function safeText(v, max = 5000) {
  if (v === null || v === undefined) return "";
  const s = String(v);
  return s.length > max ? s.slice(0, max) : s;
}

const formatTimestamp = (ts) => {
  if (!ts) return "";
  const d = new Date(ts);
  if (isNaN(d.getTime())) return "";
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${dd}/${mm}, ${hh}:${mi}`;
};

const timeAgo = (ts) => {
  if (!ts) return "";
  const diff = Math.floor((new Date() - new Date(ts)) / 1000);
  if (diff < 60) return "now";
  const m = Math.floor(diff / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}h` : `${Math.floor(h / 24)}d`;
};

const smartScrollToBottom = (el, force) => {
  if (!el) return;
  if (force || el.scrollHeight - (el.scrollTop + el.clientHeight) < 150) {
    requestAnimationFrame(() => (el.scrollTop = el.scrollHeight));
  }
};

function createSmartPoll(fetchFn, isEnabledFn) {
  let timeoutId, active = false, isRunning = false;

  const schedule = (ms) => {
    if (!active) return;
    clearTimeout(timeoutId);
    timeoutId = setTimeout(tick, ms);
  };

  const tick = async () => {
    if (!active) return;

    let delay = document.hidden
      ? 60000
      : Date.now() - LAST_USER_ACTION > 45000
      ? 10000
      : 3000;

    if (isEnabledFn && !isEnabledFn()) {
      schedule(60000);
      return;
    }

    try {
      isRunning = true;
      await fetchFn();
    } catch {
      delay = 10000;
    } finally {
      isRunning = false;
      schedule(delay);
    }
  };

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && active && !isRunning && (!isEnabledFn || isEnabledFn())) {
      clearTimeout(timeoutId);
      tick();
    }
  });

  return {
    start: () => {
      if (!active) {
        active = true;
        updateActivity();
        tick();
      }
    },
    stop: () => {
      active = false;
      clearTimeout(timeoutId);
    },
    bumpFast: () => {
      updateActivity();
      if (!active) return;
      clearTimeout(timeoutId);
      schedule(100);
    },
  };
}

function copyToClipboard(text, btn) {
  navigator.clipboard.writeText(String(text || "")).then(() => {
    const original = btn.textContent || "📋";
    btn.textContent = "✔";
    btn.style.color = "#10b981";
    setTimeout(() => {
      btn.textContent = original;
      btn.style.color = "";
    }, 1200);
  });
}

function getSeenConfig(t) {
  if (!t || !t.messages) return null;
  const userMsgs = t.messages.filter((m) => m && m.from === "user" && !m.deleted);
  if (!userMsgs.length) return null;

  const lastUserM = userMsgs[userMsgs.length - 1];
  const lastReadAdmin = Number(t.last_read_admin || 0);
  const lastUserMsgId = Number(lastUserM.id);

  if (lastReadAdmin >= lastUserMsgId) {
    return {
      targetId: lastUserM.id,
      text: `Seen ${t.last_read_admin_at ? timeAgo(t.last_read_admin_at) : ""}`.trim(),
    };
  }
  return null;
}

function calculateUserUnread(ticket) {
  if (!ticket || !ticket.messages) return 0;
  const lastReadId = Number(ticket.last_read_user || 0);
  return ticket.messages.filter((m) => m && m.from === "admin" && Number(m.id) > lastReadId).length;
}

// ---------------------------
// Hardened renderer (no innerHTML with untrusted data)
// ---------------------------
function renderDiscordMessages(msgs, { container, canReply, onReply, onJumpTo, seenConfig }) {
  if (!container) return;

  const wasNearBottom = container.scrollHeight - (container.scrollTop + container.clientHeight) < 150;

  if (!msgs || !msgs.length) {
    if (!container.querySelector(".chat-placeholder")) {
      container.innerHTML = "";
      const ph = document.createElement("div");
      ph.className = "chat-placeholder";
      const icon = document.createElement("div");
      icon.className = "icon";
      icon.textContent = "💬";
      const p = document.createElement("p");
      p.textContent = "Start conversation...";
      ph.appendChild(icon);
      ph.appendChild(p);
      container.appendChild(ph);
    }
    return;
  }

  container.querySelector(".chat-placeholder")?.remove();

  const msgMap = new Map();
  msgs.forEach((m) => { if (m && m.id != null) msgMap.set(String(m.id), m); });

  const renderedIds = new Set();

  msgs.forEach((m) => {
    if (!m || m.id == null) return;
    const mid = String(m.id);
    renderedIds.add(mid);

    let row = container.querySelector(`.msg-row[data-message-id="${CSS.escape(mid)}"]`);

    const sender = safeText(m.sender || (m.from === "system" ? "System" : "User"), 80);
    const content = m.deleted ? "Message deleted" : safeText(m.text || "", 5000);

    if (!row) {
      row = document.createElement("div");
      row.className = "msg-row";
      row.dataset.messageId = mid;

      const avatar = document.createElement("div");
      avatar.className = "msg-avatar";
      avatar.textContent = sender ? sender[0].toUpperCase() : "?";

      const contentWrap = document.createElement("div");
      contentWrap.className = "msg-content";

      const headerLine = document.createElement("div");
      headerLine.className = "msg-header-line";

      const metaGroup = document.createElement("div");
      metaGroup.className = "msg-meta-group";

      const uname = document.createElement("span");
      uname.className = "msg-username" + (m.from === "admin" ? " msg-username--admin" : "");
      uname.textContent = sender;

      const ts = document.createElement("span");
      ts.className = "msg-timestamp";
      ts.textContent = formatTimestamp(m.ts);

      metaGroup.appendChild(uname);
      metaGroup.appendChild(ts);

      headerLine.appendChild(metaGroup);

      if (canReply && !m.deleted) {
        const btn = document.createElement("button");
        btn.className = "btn-reply-mini";
        btn.title = "Reply";
        btn.textContent = "↩ Reply";
        btn.addEventListener("click", (e) => {
          e.stopPropagation();
          onReply?.(m);
        });
        headerLine.appendChild(btn);
      }

      const bubble = document.createElement("div");
      bubble.className = "msg-bubble";

      if (m.reply_to && msgMap.has(String(m.reply_to))) {
        const ref = msgMap.get(String(m.reply_to));
        const prev = document.createElement("div");
        prev.className = "msg-reply-preview";
        prev.dataset.jumpId = String(ref.id);

        const strong = document.createElement("strong");
        strong.style.marginRight = "5px";
        strong.textContent = safeText(ref.sender || "User", 50);

        const span = document.createElement("span");
        span.textContent = safeText(ref.text || "", 50) + "...";

        prev.appendChild(strong);
        prev.appendChild(span);

        prev.addEventListener("click", (e) => {
          e.stopPropagation();
          onJumpTo?.(prev.dataset.jumpId);
        });

        bubble.appendChild(prev);
      }

      const textEl = document.createElement("div");
      textEl.className = "msg-text" + (m.deleted ? " msg-text--deleted" : "");
      textEl.textContent = content;

      bubble.appendChild(textEl);

      const seenFooter = document.createElement("div");
      seenFooter.className = "seen-footer";

      contentWrap.appendChild(headerLine);
      contentWrap.appendChild(bubble);
      contentWrap.appendChild(seenFooter);

      row.appendChild(avatar);
      row.appendChild(contentWrap);
      container.appendChild(row);
    } else {
      const textEl = row.querySelector(".msg-text");
      if (textEl && textEl.textContent !== content) {
        textEl.textContent = content;
        textEl.className = "msg-text" + (m.deleted ? " msg-text--deleted" : "");
      }
      const uname = row.querySelector(".msg-username");
      if (uname && uname.textContent !== sender) uname.textContent = sender;
      const ts = row.querySelector(".msg-timestamp");
      const nts = formatTimestamp(m.ts);
      if (ts && ts.textContent !== nts) ts.textContent = nts;
    }

    const seenEl = row.querySelector(".seen-footer");
    if (seenEl) {
      if (seenConfig && String(seenConfig.targetId) === mid) {
        seenEl.textContent = seenConfig.text || "";
        seenEl.style.display = "block";
      } else {
        seenEl.textContent = "";
        seenEl.style.display = "none";
      }
    }
  });

  Array.from(container.children).forEach((c) => {
    if (c?.dataset?.messageId && !renderedIds.has(String(c.dataset.messageId))) c.remove();
  });

  smartScrollToBottom(container, wasNearBottom);
}

// ---------------------------
// MAIN APP
// ---------------------------
function initUserApp() {
  const tg = window.Telegram?.WebApp;
  if (!tg?.initData) {
    hide($("mainAppWrapper"));
    show($("onlyTelegramError"));
    console.warn("Access Denied: Not in Telegram.");
    return;
  }

  const TG_INIT_DATA = tg.initData;

  let STATE = { user: null, shop: null, tickets: [], selTicketId: null, sending: false, buying: false };
  let SELECTED_PRODUCT = null;
  let SELECTED_VARIANT = null;
  let userMode = { type: null, msgId: null, txt: "", sender: "" };
  let CLAIM_TARGET_ID = null;

  // Wizard state
  let WIZ = { step: 1, amount: 0, credits: 0, method: null, file: null };

  const els = {
    mainWrapper: $("mainAppWrapper"),
    linkError: $("linkAccountError"),
    credits: $("creditsValue"),
    creditsBtn: $("creditsBtn"),
    userLine: $("userLine"),
    catGrid: $("categoriesGrid"),
    prodGrid: $("productsGrid"),
    viewCat: $("viewCategories"),
    viewProd: $("viewProducts"),
    backBtn: $("shopBackBtn"),
    title: $("headerTitle"),
    emptyMsg: $("emptyProductsMsg"),
    modal: $("productPanel"),
    mName: $("panelName"),
    mDesc: $("panelDesc"),
    mPrice: $("panelPrice"),
    mTypes: $("panelTypesContainer"),
    mTypesGrid: $("panelTypesGrid"),
    mBuy: $("panelBuyBtn"),
    mClose: $("panelCloseBtn"),
    mStatus: $("panelStatus"),
    mImg: $("panelImg"),
    mPlace: $("panelImgPlaceholder"),
    chatList: $("chatList"),
    tTitle: $("ticketTitle"),
    msgs: $("chatMessages"),
    input: $("chatInput"),
    send: $("chatSendBtn"),
    closeT: $("userTicketCloseBtn"),
    reopenT: $("userTicketReopenBtn"),
    menu: $("ticketsMenuToggle"),
    backdrop: $("ticketsBackdrop"),
    shopTab: $("shopTab"),
    ticketsTab: $("ticketsTab"),
    purchasesTab: $("purchasesTab"),
    shopHead: $("shopHeader"),
    goT: $("goToTicketsBtn"),
    goPurch: $("goToPurchasesBtn"),
    backShop: $("backToShopBtn"),
    backPurch: $("backFromPurchases"),
    inputCont: $("chatFooter"),
    confirm: $("confirmActionModal"),
    okConf: $("confirmOkBtn"),
    canConf: $("confirmCancelBtn"),
    creditsM: $("creditsModal"),
    closeCred: $("closeCreditsModalBtn"),
    purchasesList: $("purchasesList"),

    // Claim modal
    claimM: $("claimWarrantyModal"),
    claimIn: $("claimReasonInput"),
    claimSub: $("claimSubmitBtn"),
    claimCan: $("claimCancelBtn"),
    claimStatus: $("claimStatus"),

    // Wizard
    wStep1: $("step-packages"),
    wStep2: $("step-method"),
    wStep3: $("step-details"),
    wStep4: $("step-success"),
    pkgGrid: $("pkgGrid"),
    custIn: $("customAmtInput"),
    custRes: $("customCalcRes"),
    wNext1: $("wizNext1"),
    wBack2: $("wizBack2"),
    wBack3: $("wizBack3"),
    wSubmit: $("wizSubmit"),
    wClose: $("wizCloseFinal"),
    mGrid: $("methodGrid"),
    payBox: $("paymentDetailsBox"),
    sumTot: $("sumTotal"),
    sumCred: $("sumCredits"),
    wStatus: $("wizStatus"),
    proofSec: $("proofSection"),
    proofIn: $("proofFileInput"),
    proofTxt: $("uploadText"),
  };

  // ---------------------------
  // API layer (compat: tries /api first, then root)
  // ---------------------------
  const joinUrl = (base, path) => {
    const b = base.endsWith("/") ? base : base + "/";
    const p = path.startsWith("/") ? path.slice(1) : path;
    return b + p;
  };

  async function postJsonWithFallback(bodyObj) {
    const endpoints = [joinUrl(API_URL, "api"), API_URL];
    let lastErr = null;

    for (const url of endpoints) {
      try {
        const r = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(bodyObj),
        });

        if (r.status === 401) return { ok: false, error: "auth_failed" };
        const data = await r.json().catch(() => null);
        if (data) return data;

        lastErr = new Error("Bad JSON");
      } catch (e) {
        lastErr = e;
      }
    }
    console.error(lastErr);
    return { ok: false, error: "network" };
  }

  const apiCall = (action, extra = {}) => {
    return postJsonWithFallback({ action, initData: TG_INIT_DATA, ...extra });
  };

  // ---------------------------
  // Upload proof: ImgBB first, fallback to /api/upload_proxy
  // ---------------------------
  async function uploadProofToImgBB(file) {
    // If key not set or placeholder, skip
    if (!IMGBB_API_KEY || IMGBB_API_KEY === "PUT_YOUR_IMGBB_KEY_HERE") return null;

    const fd = new FormData();
    fd.append("image", file);
    fd.append("key", IMGBB_API_KEY);

    try {
      const res = await fetch("https://api.imgbb.com/1/upload", { method: "POST", body: fd });
      const data = await res.json().catch(() => null);
      const url = data?.data?.url || data?.data?.display_url || "";
      return safeUrl(url);
    } catch (e) {
      console.error("uploadProofToImgBB error:", e);
      return null;
    }
  }

  async function uploadProofViaProxy(file) {
    const endpoint = joinUrl(API_URL, "api/upload_proxy");
    const fd = new FormData();
    fd.append("file", file, file.name);

    try {
      const res = await fetch(endpoint, { method: "POST", body: fd });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data) return null;

      const url = data.link || data.url || data.data?.url || data.data?.display_url || "";
      return safeUrl(url);
    } catch (e) {
      console.error("uploadProofViaProxy error:", e);
      return null;
    }
  }

  async function uploadProof(file) {
    // 1) try ImgBB (direct)
    const a = await uploadProofToImgBB(file);
    if (a) return a;

    // 2) fallback to backend proxy
    const b = await uploadProofViaProxy(file);
    if (b) return b;

    return null;
  }

  async function markSeen(ticketId) {
    const res1 = await apiCall("mark_seen", { ticket_id: ticketId });
    if (res1 && (res1.ok || res1.error !== "unknown_action")) return res1;
    return await apiCall("user_mark_seen", { ticket_id: ticketId });
  }

  // ---------------------------
  // Tabs
  // ---------------------------
  const setTab = (tabName) => {
    els.shopTab?.classList.remove("active");
    els.ticketsTab?.classList.remove("active");
    els.purchasesTab?.classList.remove("active");

    userTicketsPoller.stop();

    if (tabName === "shop") {
      els.shopTab?.classList.add("active");
      show(els.shopHead);
    } else if (tabName === "tickets") {
      els.ticketsTab?.classList.add("active");
      hide(els.shopHead);
      updateActivity();
      userTicketsPoller.start();
    } else if (tabName === "purchases") {
      els.purchasesTab?.classList.add("active");
      hide(els.shopHead);
      loadPurchases();
    }
  };

  els.goT?.addEventListener("click", () => setTab("tickets"));
  els.goPurch?.addEventListener("click", () => setTab("purchases"));
  els.backShop?.addEventListener("click", () => setTab("shop"));
  els.backPurch?.addEventListener("click", () => setTab("shop"));

  // ---------------------------
  // Credits wizard
  // ---------------------------
  els.creditsBtn?.addEventListener("click", () => {
    resetWizard();
    show(els.creditsM);
  });
  els.closeCred?.addEventListener("click", () => hide(els.creditsM));
  els.wClose?.addEventListener("click", () => hide(els.creditsM));

  const resetWizard = () => {
    WIZ = { step: 1, amount: 0, credits: 0, method: null, file: null };
    showStep(1);
    if (els.custIn) els.custIn.value = "";
    if (els.custRes) els.custRes.textContent = "0 Credits";
    renderPackages();
  };

  const showStep = (step) => {
    [els.wStep1, els.wStep2, els.wStep3, els.wStep4].forEach((el) => hide(el));
    if (step === 1) show(els.wStep1);
    if (step === 2) { renderMethods(); show(els.wStep2); }
    if (step === 3) { renderDetails(); show(els.wStep3); }
    if (step === 4) show(els.wStep4);
    WIZ.step = step;
  };

  const renderPackages = () => {
    if (!els.pkgGrid) return;
    els.pkgGrid.innerHTML = "";
    PACKAGES.forEach((pkg) => {
      const card = document.createElement("div");
      card.className = "pkg-card" + (WIZ.amount === pkg.price ? " active" : "");

      const top = document.createElement("div");
      top.className = "pkg-top";
      top.textContent = `${pkg.credits} CRD`;

      const price = document.createElement("div");
      price.className = "pkg-price";
      price.textContent = `$${pkg.price}`;

      const bonus = document.createElement("div");
      bonus.className = "pkg-bonus";
      bonus.textContent = `+${pkg.bonus} Bonus`;

      card.appendChild(top);
      card.appendChild(price);
      card.appendChild(bonus);

      card.addEventListener("click", () => {
        WIZ.amount = pkg.price;
        WIZ.credits = pkg.credits + pkg.bonus;
        if (els.custIn) els.custIn.value = "";
        if (els.custRes) els.custRes.textContent = "0 Credits";
        Array.from(els.pkgGrid.children).forEach((c) => c.classList.remove("active"));
        card.classList.add("active");
      });

      els.pkgGrid.appendChild(card);
    });
  };

  els.custIn?.addEventListener("input", (e) => {
    const val = parseFloat(e.target.value);
    if (els.pkgGrid) Array.from(els.pkgGrid.children).forEach((c) => c.classList.remove("active"));
    if (val && val > 0) {
      WIZ.amount = val;
      WIZ.credits = Math.floor(val * CREDIT_RATE);
      if (els.custRes) els.custRes.textContent = `${WIZ.credits} Credits`;
    } else {
      WIZ.amount = 0;
      WIZ.credits = 0;
      if (els.custRes) els.custRes.textContent = "0 Credits";
    }
  });

  els.wNext1 && (els.wNext1.onclick = () => {
    if (!(WIZ.amount > 0)) return alert("Please select a package or enter an amount.");
    showStep(2);
  });
  els.wBack2 && (els.wBack2.onclick = () => showStep(1));
  els.wBack3 && (els.wBack3.onclick = () => showStep(2));

  const renderMethods = () => {
    if (!els.mGrid) return;
    els.mGrid.innerHTML = "";
    Object.keys(PAY_METHODS).forEach((key) => {
      const m = PAY_METHODS[key];
      const div = document.createElement("div");
      div.className = "method-card";

      const icon = document.createElement("span");
      icon.className = "method-icon";
      icon.textContent = m.icon;

      const name = document.createElement("span");
      name.textContent = m.name;

      div.appendChild(icon);
      div.appendChild(name);

      div.addEventListener("click", () => {
        WIZ.method = key;
        showStep(3);
      });

      els.mGrid.appendChild(div);
    });
  };

  const renderDetails = () => {
    const m = PAY_METHODS[WIZ.method];
    if (!m) return;

    if (els.sumTot) els.sumTot.textContent = `Total: $${WIZ.amount}`;
    if (els.sumCred) els.sumCred.textContent = `${WIZ.credits} CRD`;

    if (els.payBox) {
      els.payBox.innerHTML = "";
      const info = document.createElement("div");
      info.className = "info-block";

      const label = document.createElement("div");
      label.className = "info-label";
      label.innerHTML = `Send exactly <b>$${WIZ.amount}</b> to:`; // numeric only

      const copyBox = document.createElement("div");
      copyBox.className = "copy-box";

      const span = document.createElement("span");
      span.textContent = m.detail;

      const btn = document.createElement("button");
      btn.className = "btn-icon-copy";
      btn.type = "button";
      btn.textContent = "📋";
      btn.addEventListener("click", () => copyToClipboard(m.detail, btn));

      copyBox.appendChild(span);
      copyBox.appendChild(btn);

      info.appendChild(label);
      info.appendChild(copyBox);

      if (m.warning) {
        const warn = document.createElement("div");
        warn.className = "warning-box";
        warn.textContent = m.warning;
        info.appendChild(warn);
      }

      els.payBox.appendChild(info);
    }

    if (els.wStatus) {
      els.wStatus.textContent = "";
      els.wStatus.className = "status-message";
    }

    WIZ.file = null;
    if (els.proofTxt) els.proofTxt.textContent = "Click to upload payment screenshot";
    show(els.proofSec);
  };

  els.proofIn?.addEventListener("change", (e) => {
    const f = e.target.files?.[0];
    if (!f) return;

    const maxMB = 8;
    if (f.size > maxMB * 1024 * 1024) {
      alert(`File too large. Max ${maxMB}MB.`);
      e.target.value = "";
      return;
    }

    WIZ.file = f;
    if (els.proofTxt) els.proofTxt.textContent = `Selected: ${f.name}`;
  });

  els.wSubmit && (els.wSubmit.onclick = async () => {
    const hasHistory = STATE.user && STATE.user.has_successful_payments;

    if (!(WIZ.amount > 0) || WIZ.amount > 10000) {
      els.wStatus.textContent = "Invalid amount.";
      els.wStatus.className = "status-message status-error";
      return;
    }
    if (!PAY_METHODS[WIZ.method]) {
      els.wStatus.textContent = "Invalid method.";
      els.wStatus.className = "status-message status-error";
      return;
    }
    if (!hasHistory && !WIZ.file) {
      els.wStatus.textContent = "Screenshot proof is required.";
      els.wStatus.className = "status-message status-error";
      return;
    }

    els.wSubmit.textContent = "Processing...";
    els.wSubmit.disabled = true;
    els.wStatus.textContent = "Uploading proof...";
    els.wStatus.className = "status-message";

    let proofUrl = "";
    if (WIZ.file) {
      proofUrl = await uploadProof(WIZ.file);
      if (!proofUrl) {
        els.wSubmit.textContent = "Try Again";
        els.wSubmit.disabled = false;
        els.wStatus.textContent = "Failed to upload image. Please try again.";
        els.wStatus.className = "status-message status-error";
        return;
      }
    } else {
      els.wStatus.textContent = "Sending request...";
    }

    const payload = { amount: WIZ.amount, method: WIZ.method, proof_url: proofUrl };

    try {
      const res = await apiCall("user_request_credits", payload);
      if (res.ok) {
        showStep(4);
        els.wSubmit.textContent = "I Sent the Payment";
        els.wSubmit.disabled = false;
      } else {
        els.wStatus.textContent = "Error: " + safeText(res.error || "Server error", 200);
        els.wStatus.className = "status-message status-error";
        els.wSubmit.textContent = "Try Again";
        els.wSubmit.disabled = false;
      }
    } catch {
      els.wStatus.textContent = "Network Error.";
      els.wStatus.className = "status-message status-error";
      els.wSubmit.textContent = "Try Again";
      els.wSubmit.disabled = false;
    }
  });

  // ---------------------------
  // Reply bar
  // ---------------------------
  const modeBar = document.createElement("div");
  modeBar.className = "chat-mode-bar";
  modeBar.style.display = "none";

  const modeText = document.createElement("span");
  modeText.className = "chat-mode-text";

  const modeCancel = document.createElement("button");
  modeCancel.type = "button";
  modeCancel.textContent = "Cancel";
  modeCancel.style.color = "var(--text-muted)";
  modeCancel.style.border = "1px solid var(--text-muted)";
  modeCancel.style.padding = "2px 8px";

  modeCancel.onclick = () => {
    userMode = { type: null, msgId: null, txt: "", sender: "" };
    hide(modeBar);
  };

  modeBar.appendChild(modeText);
  modeBar.appendChild(modeCancel);
  if (els.inputCont) els.inputCont.prepend(modeBar);

  const setReply = (msg) => {
    userMode = {
      type: "reply",
      msgId: msg.id,
      txt: safeText(msg.text || "", 50),
      sender: safeText(msg.sender || "User", 50),
    };
    modeText.textContent = `Replying to ${userMode.sender}: "${userMode.txt}..."`;
    show(modeBar, "flex");
    els.input?.focus();
  };

  const updateChatUI = (t) => {
    if (!els.input || !els.send) return;
    if (!t) {
      els.input.disabled = true;
      els.send.disabled = true;
      els.input.placeholder = "Select a ticket...";
      hide(modeBar);
      hide(els.closeT);
      if (els.tTitle) els.tTitle.textContent = "No ticket";
      return;
    }
    const closed = t.status === "closed";
    els.input.disabled = closed;
    els.send.disabled = closed;
    els.input.placeholder = closed ? "Ticket closed." : "Type a message...";
    closed ? (hide(els.closeT), hide(modeBar)) : show(els.closeT);
  };
  updateChatUI(null);

  // ---------------------------
  // Purchases
  // ---------------------------
  const loadPurchases = async () => {
    if (!els.purchasesList) return;
    els.purchasesList.innerHTML = '<div class="chat-placeholder">Loading orders...</div>';

    const res = await apiCall("user_get_purchases", {});
    els.purchasesList.innerHTML = "";

    if (res.ok && Array.isArray(res.purchases) && res.purchases.length) {
      res.purchases.sort((a, b) => Number(b.id) - Number(a.id)).forEach((p) => renderPurchaseItem(p));
    } else {
      els.purchasesList.innerHTML = '<div class="chat-placeholder">No orders found.</div>';
    }
  };

  const renderPurchaseItem = (p) => {
    const card = document.createElement("div");
    card.className = "purchase-card";

    const dateStr = formatTimestamp(p.created_at);

    let isWarrantyActive = false;
    let warrantyText = "No Warranty";
    let warrantyClass = "expired";

    if (p.warranty_ends_at) {
      const expiry = new Date(p.warranty_ends_at);
      const now = new Date();
      isWarrantyActive = expiry.getTime() > now.getTime();

      if (isWarrantyActive) {
        const diffDays = Math.ceil((expiry - now) / (1000 * 60 * 60 * 24));
        warrantyText = `Warranty Active (${diffDays}d left)`;
        warrantyClass = "active";
      } else {
        warrantyText = "Warranty Expired";
        warrantyClass = "expired";
      }
    }

    const header = document.createElement("div");
    header.className = "pch-header";

    const id = document.createElement("span");
    id.className = "pch-id";
    id.textContent = `#${safeText(p.id, 40)}`;

    const date = document.createElement("span");
    date.className = "pch-date";
    date.textContent = dateStr;

    header.appendChild(id);
    header.appendChild(date);

    const body = document.createElement("div");
    body.className = "pch-body";

    const title = document.createElement("div");
    title.className = "pch-title";
    title.textContent = safeText(p.product_name || "Order", 200);

    const info = document.createElement("div");
    info.className = "pch-info";
    info.textContent = `Total: ${safeText(p.total_price, 20)} CRD`;

    const badgeWrap = document.createElement("div");
    badgeWrap.style.marginTop = "8px";

    const badge = document.createElement("span");
    badge.className = `badge-warranty ${warrantyClass}`;
    badge.textContent = warrantyText;

    badgeWrap.appendChild(badge);

    body.appendChild(title);
    body.appendChild(info);
    body.appendChild(badgeWrap);

    const actions = document.createElement("div");
    actions.className = "pch-actions";

    const btn = document.createElement("button");
    btn.className = "btn-sm " + (isWarrantyActive ? "btn-support-active" : "btn-support-disabled");
    btn.textContent = isWarrantyActive ? "🛠️ Support / Claim" : "⛔ Support Ended";
    btn.disabled = !isWarrantyActive;

    if (isWarrantyActive) {
      btn.addEventListener("click", () => openClaimModal(p));
    }

    actions.appendChild(btn);

    card.appendChild(header);
    card.appendChild(body);
    card.appendChild(actions);

    els.purchasesList.appendChild(card);
  };

  const openClaimModal = (p) => {
    CLAIM_TARGET_ID = p.id;
    if (els.claimIn) els.claimIn.value = "";
    if (els.claimStatus) {
      els.claimStatus.textContent = "";
      els.claimStatus.className = "status-message";
    }
    show(els.claimM);
  };

  els.claimCan && (els.claimCan.onclick = () => { hide(els.claimM); CLAIM_TARGET_ID = null; });
  els.claimM && (els.claimM.onclick = (e) => { if (e.target === els.claimM) { hide(els.claimM); CLAIM_TARGET_ID = null; } });

  els.claimSub && (els.claimSub.onclick = async () => {
    if (!CLAIM_TARGET_ID) return;
    const reason = (els.claimIn?.value || "").trim();

    if (!reason) {
      els.claimStatus.textContent = "Please describe the issue.";
      els.claimStatus.className = "status-message status-error";
      return;
    }

    els.claimSub.textContent = "Sending...";
    els.claimSub.disabled = true;

    const res = await apiCall("user_claim_warranty", { ticket_id: CLAIM_TARGET_ID, reason });

    els.claimSub.textContent = "Submit Claim";
    els.claimSub.disabled = false;

    if (res.ok) {
      hide(els.claimM);
      setTab("tickets");
      userTicketsPoller.bumpFast();
    } else {
      const msg = res.error === "warranty_expired" ? "Warranty Expired!" : safeText(res.error, 200);
      els.claimStatus.textContent = "Error: " + msg;
      els.claimStatus.className = "status-message status-error";
    }
  });

  // ---------------------------
  // Header + Shop rendering (safe)
  // ---------------------------
  const renderHeader = () => {
    if (!STATE.user) return;
    if (els.credits) els.credits.textContent = String(STATE.user.credits ?? 0);

    if (els.userLine) {
      const uname = STATE.user.username ? "@" + STATE.user.username : "ID " + STATE.user.id;
      els.userLine.innerHTML = "";
      const t1 = document.createTextNode("User: ");
      const b = document.createElement("b");
      b.textContent = uname;
      els.userLine.appendChild(t1);
      els.userLine.appendChild(b);
    }
  };

  const renderCats = (shop) => {
    if (!els.catGrid) return;
    els.catGrid.innerHTML = "";

    (shop?.categories || []).forEach((cat) => {
      const d = document.createElement("div");
      d.className = "card-visual";

      const imgContainer = document.createElement("div");
      imgContainer.className = "card-img-container";

      const imgUrl = safeUrl(cat?.image);
      if (imgUrl) {
        const img = document.createElement("img");
        img.className = "card-img";
        img.src = imgUrl;
        img.alt = safeText(cat?.name || "Category", 60);
        imgContainer.appendChild(img);
      } else {
        const ph = document.createElement("div");
        ph.className = "img-placeholder";
        ph.textContent = "📁";
        imgContainer.appendChild(ph);
      }

      const overlay = document.createElement("div");
      overlay.className = "card-overlay";

      const name = document.createElement("div");
      name.className = "cat-name";
      name.textContent = safeText(cat?.name || "Category", 120);

      const count = document.createElement("div");
      count.className = "cat-count";
      count.textContent = `${(cat?.products || []).length} products`;

      overlay.appendChild(name);
      overlay.appendChild(count);

      imgContainer.appendChild(overlay);
      d.appendChild(imgContainer);

      d.addEventListener("click", () => {
        els.viewCat?.classList.remove("active-view");
        els.viewProd?.classList.add("active-view");
        hide(els.title);
        show(els.backBtn);

        const backTxt = els.backBtn?.querySelector(".back-btn-text");
        if (backTxt) backTxt.textContent = safeText(cat?.name || "Back", 120);

        renderProds(cat?.products || []);
      });

      els.catGrid.appendChild(d);
    });
  };

  const renderProds = (prods) => {
    if (!els.prodGrid) return;
    els.prodGrid.innerHTML = "";

    if (!prods || !prods.length) {
      show(els.emptyMsg);
      return;
    }
    hide(els.emptyMsg);

    prods.forEach((p) => {
      const d = document.createElement("div");
      d.className = "card-visual";

      const imgContainer = document.createElement("div");
      imgContainer.className = "card-img-container";
      imgContainer.style.height = "140px";
      imgContainer.style.aspectRatio = "unset";

      const imgUrl = safeUrl(p?.image);
      if (imgUrl) {
        const img = document.createElement("img");
        img.className = "card-img";
        img.src = imgUrl;
        img.alt = safeText(p?.name || "Product", 60);
        imgContainer.appendChild(img);
      } else {
        const ph = document.createElement("div");
        ph.className = "img-placeholder";
        ph.textContent = "🎁";
        imgContainer.appendChild(ph);
      }

      const info = document.createElement("div");
      info.className = "prod-info";

      const title = document.createElement("div");
      title.className = "prod-title";
      title.textContent = safeText(p?.name || "Product", 200);

      const meta = document.createElement("div");
      meta.className = "prod-meta";

      const price = document.createElement("div");
      price.className = "prod-price";
      const minP = Array.isArray(p?.types) && p.types.length
        ? Math.min(...p.types.map((t) => Number(t.price || 0)))
        : Number(p?.price || 0);
      price.textContent = `${Array.isArray(p?.types) && p.types.length ? "From " : ""}${minP} CRD`;

      const arrow = document.createElement("div");
      arrow.className = "prod-btn-mini";
      arrow.textContent = "→";

      meta.appendChild(price);
      meta.appendChild(arrow);

      info.appendChild(title);
      info.appendChild(meta);

      d.appendChild(imgContainer);
      d.appendChild(info);

      d.addEventListener("click", () => openModal(p));
      els.prodGrid.appendChild(d);
    });
  };

  els.backBtn && (els.backBtn.onclick = () => {
    els.viewProd?.classList.remove("active-view");
    els.viewCat?.classList.add("active-view");
    hide(els.backBtn);
    show(els.title);
  });

  // ---------------------------
  // Product modal (safe)
  // ---------------------------
  const closeModal = () => {
    hide(els.modal);
    STATE.buying = false;
  };
  els.mClose && (els.mClose.onclick = closeModal);
  els.modal && (els.modal.onclick = (e) => e.target === els.modal && closeModal());

  const selVar = (t, btn) => {
    SELECTED_VARIANT = t;
    Array.from(els.mTypesGrid?.children || []).forEach((c) => c.classList.remove("active"));
    btn.classList.add("active");

    if (els.mPrice) els.mPrice.textContent = `${Number(t.price || 0)} CRD`;

    const lines = [];
    if (SELECTED_PRODUCT?.description) lines.push(safeText(SELECTED_PRODUCT.description, 1200));
    lines.push(`🔹 Variant: ${safeText(t.name || "Standard", 120)}`);
    if (t.warranty_days) lines.push(`🛡️ Warranty: ${safeText(t.warranty_days, 20)} days`);
    if (t.description) lines.push(`📝 Notes: ${safeText(t.description, 800)}`);

    if (els.mDesc) els.mDesc.textContent = lines.join("\n");
  };

  const openModal = (p) => {
    SELECTED_PRODUCT = p;
    SELECTED_VARIANT = null;

    if (els.mStatus) {
      els.mStatus.textContent = "";
      els.mStatus.className = "status-message";
    }

    if (els.mName) els.mName.textContent = safeText(p?.name || "Product", 200);
    if (els.mBuy) {
      els.mBuy.disabled = false;
      els.mBuy.style.opacity = "1";
      els.mBuy.textContent = "Buy Now";
    }

    const img = safeUrl(p?.image);
    if (img && els.mImg) {
      els.mImg.src = img;
      show(els.mImg);
      hide(els.mPlace);
    } else {
      hide(els.mImg);
      show(els.mPlace);
    }

    if (Array.isArray(p?.types) && p.types.length) {
      show(els.mTypes);
      if (els.mTypesGrid) els.mTypesGrid.innerHTML = "";

      const typesSorted = [...p.types].sort((a, b) => Number(a.price) - Number(b.price));
      typesSorted.forEach((t, i) => {
        const btn = document.createElement("div");
        btn.className = "type-card";

        const info = document.createElement("div");
        info.className = "type-info";
        const nm = document.createElement("span");
        nm.className = "type-name";
        nm.textContent = safeText(t.name || "Type", 120);
        info.appendChild(nm);

        const meta = document.createElement("div");
        meta.className = "type-meta";
        const pill = document.createElement("span");
        pill.className = "type-price-pill";
        pill.textContent = `${Number(t.price || 0)} CRD`;

        const circle = document.createElement("div");
        circle.className = "type-radio-circle";

        meta.appendChild(pill);
        meta.appendChild(circle);

        btn.appendChild(info);
        btn.appendChild(meta);

        btn.addEventListener("click", () => selVar(t, btn));

        els.mTypesGrid.appendChild(btn);
        if (i === 0) selVar(t, btn);
      });
    } else {
      hide(els.mTypes);
      if (els.mPrice) els.mPrice.textContent = `${Number(p?.price || 0)} CRD`;
      if (els.mDesc) els.mDesc.textContent = safeText(p?.description || "No description.", 2000);
    }

    show(els.modal);
  };

  els.mBuy && (els.mBuy.onclick = async () => {
    if (!SELECTED_PRODUCT || !STATE.user || STATE.buying) return;

    if (Array.isArray(SELECTED_PRODUCT.types) && SELECTED_PRODUCT.types.length && !SELECTED_VARIANT) {
      els.mStatus.textContent = "Select a variant!";
      els.mStatus.className = "status-message status-error";
      return;
    }

    STATE.buying = true;
    els.mBuy.disabled = true;
    els.mBuy.textContent = "Processing...";
    els.mStatus.textContent = "Initializing...";

    const payload = {
      product_id: SELECTED_PRODUCT.id,
      qty: 1,
      ...(SELECTED_VARIANT ? { type_id: SELECTED_VARIANT.id } : {}),
    };

    try {
      const res = await apiCall("buy_product", payload);
      if (!res.ok) {
        STATE.buying = false;
        els.mBuy.disabled = false;
        els.mBuy.textContent = "Try again";
        els.mStatus.className = "status-message status-error";

        if (res.error === "not_enough_credits") {
          els.mStatus.textContent = "Insufficient funds! Open Add Funds.";
        } else {
          els.mStatus.textContent = "Error: " + safeText(res.error, 200);
        }
      } else {
        STATE.user.credits = res.new_balance;
        if (els.credits) els.credits.textContent = String(STATE.user.credits);

        els.mStatus.className = "status-message status-ok";
        els.mStatus.textContent = "Success!";

        setTimeout(() => {
          closeModal();
          setTab("tickets");
          STATE.buying = false;
        }, 900);

        updateActivity();
        userTicketsPoller.bumpFast();
      }
    } catch {
      STATE.buying = false;
      els.mBuy.disabled = false;
      els.mBuy.textContent = "Try again";
      els.mStatus.className = "status-message status-error";
      els.mStatus.textContent = "Network error.";
    }
  });

  // ---------------------------
  // Tickets
  // ---------------------------
  const renderTickets = () => {
    if (!els.chatList) return;
    els.chatList.innerHTML = "";

    if (!STATE.tickets.length) {
      els.chatList.innerHTML = '<div style="padding:20px;text-align:center;color:#555;">No open tickets.</div>';
      return;
    }

    STATE.tickets
      .slice()
      .sort((a, b) => Number(b.id) - Number(a.id))
      .forEach((t) => {
        const item = document.createElement("div");
        item.className = "chat-item" + (t.id === STATE.selTicketId ? " active" : "");
        item.dataset.ticketId = String(t.id);

        const header = document.createElement("div");
        header.className = "chat-item-header-row";

        const title = document.createElement("div");
        title.className = "chat-item-title";
        title.textContent = safeText(t.product_name || "Order", 200);

        const right = document.createElement("div");

        const unread = t.id !== STATE.selTicketId ? calculateUserUnread(t) : 0;
        if (unread > 0) {
          const ub = document.createElement("span");
          ub.className = "unread-badge";
          ub.textContent = String(unread);
          right.appendChild(ub);
        }

        const pill = document.createElement("span");
        pill.className = "ticket-status-pill " + safeText(t.status || "open", 20);
        pill.textContent = safeText(t.status || "open", 20);
        right.appendChild(pill);

        header.appendChild(title);
        header.appendChild(right);

        const line = document.createElement("div");
        line.className = "chat-item-line";
        const lastMsg = t.messages?.length ? safeText(t.messages[t.messages.length - 1].text || "", 120) : "New ticket";
        line.textContent = lastMsg;

        item.appendChild(header);
        item.appendChild(line);

        item.addEventListener("click", () => {
          selTicket(t.id);
          updateActivity();
          els.ticketsTab?.classList.remove("tickets-drawer-open");
        });

        els.chatList.appendChild(item);
      });
  };

  const selTicket = (id) => {
    STATE.selTicketId = id;
    const t = STATE.tickets.find((x) => x.id === id);

    if (t) {
      if (calculateUserUnread(t) > 0) {
        markSeen(id);
        if (t.messages?.length) t.last_read_user = t.messages[t.messages.length - 1].id;
      }
    }

    renderTickets();

    if (!t) {
      if (els.msgs) els.msgs.innerHTML = "";
      updateChatUI(null);
      return;
    }

    if (els.tTitle) els.tTitle.textContent = `${safeText(t.product_name || "Order", 120)} #${safeText(t.id, 30)}`;

    const seen = getSeenConfig(t);
    renderDiscordMessages(t.messages || [], {
      container: els.msgs,
      canReply: t.status === "open",
      onReply: setReply,
      onJumpTo: (mid) => {
        const el = els.msgs?.querySelector(`.msg-row[data-message-id="${CSS.escape(String(mid))}"]`);
        if (el) {
          el.classList.add("msg-row--highlight");
          el.scrollIntoView({ behavior: "smooth", block: "center" });
          setTimeout(() => el.classList.remove("msg-row--highlight"), 1200);
        }
      },
      seenConfig: seen,
    });

    updateChatUI(t);
  };

  const sendMsg = async () => {
    const text = (els.input?.value || "").trim();
    if (!text || !STATE.selTicketId || STATE.sending) return;

    STATE.sending = true;
    if (els.send) els.send.disabled = true;
    if (els.input) els.input.value = "";
    hide(modeBar);

    try {
      const res = await apiCall("user_send_message", {
        ticket_id: STATE.selTicketId,
        text,
        reply_to: userMode.type === "reply" ? userMode.msgId : null,
      });

      if (res.ok && res.ticket) {
        const idx = STATE.tickets.findIndex((x) => x.id === res.ticket.id);
        if (idx >= 0) STATE.tickets[idx] = res.ticket;

        renderTickets();

        const t = res.ticket;
        const seen = getSeenConfig(t);
        renderDiscordMessages(t.messages || [], { container: els.msgs, canReply: t.status === "open", onReply: setReply, seenConfig: seen });
        smartScrollToBottom(els.msgs, true);
      } else if (res.error === "ticket_closed") {
        const t = STATE.tickets.find((x) => x.id === STATE.selTicketId);
        if (t) t.status = "closed";
        updateChatUI(t);
      }
    } finally {
      STATE.sending = false;
      if (els.send) els.send.disabled = false;
      setTimeout(() => els.input?.focus(), 50);
      userMode = { type: null, msgId: null, txt: "", sender: "" };
    }
  };

  els.send?.addEventListener("click", sendMsg);
  els.input?.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMsg();
    }
  });

  els.menu?.addEventListener("click", () => els.ticketsTab?.classList.toggle("tickets-drawer-open"));
  els.backdrop?.addEventListener("click", () => els.ticketsTab?.classList.remove("tickets-drawer-open"));

  els.closeT?.addEventListener("click", () => {
    show(els.confirm);

    els.okConf.onclick = async () => {
      hide(els.confirm);
      if (!STATE.selTicketId) return;

      const res = await apiCall("user_close_ticket", { ticket_id: STATE.selTicketId });
      if (res.ok) {
        const idx = STATE.tickets.findIndex((x) => x.id === STATE.selTicketId);
        if (idx >= 0) STATE.tickets[idx] = res.ticket || { ...STATE.tickets[idx], status: "closed" };
        renderTickets();
        selTicket(STATE.selTicketId);
      }
    };

    els.canConf.onclick = () => hide(els.confirm);
    els.confirm.onclick = (e) => { if (e.target === els.confirm) hide(els.confirm); };
  });

  const userTicketsPoller = createSmartPoll(
    async () => {
      if (!STATE.user) return;

      const res = await apiCall("user_get_tickets", {});
      if (res.ok && Array.isArray(res.tickets)) {
        STATE.tickets = res.tickets;

        if (STATE.selTicketId) {
          const t = STATE.tickets.find((x) => x.id === STATE.selTicketId);
          if (t) {
            const unread = calculateUserUnread(t);
            if (unread > 0) {
              markSeen(t.id);
              if (t.messages?.length) t.last_read_user = t.messages[t.messages.length - 1].id;
            }
            const seen = getSeenConfig(t);
            renderDiscordMessages(t.messages || [], {
              container: els.msgs,
              canReply: t.status === "open",
              onReply: setReply,
              seenConfig: seen,
            });
            updateChatUI(t);
          }
        }

        renderTickets();
      }
    },
    () => els.ticketsTab?.classList.contains("active")
  );

  // ---------------------------
  // INIT
  // ---------------------------
  (async () => {
    tg.ready();
    tg.expand();

    const unsafe = tg.initDataUnsafe?.user;
    STATE.user = {
      id: unsafe?.id,
      username: unsafe?.username || "user",
      credits: 0,
      has_successful_payments: false,
    };
    renderHeader();

    const res = await apiCall("init", {});
    if (res.ok) {
      STATE.user.credits = res.user?.credits ?? 0;
      STATE.shop = res.shop || { categories: [] };
      STATE.tickets = res.tickets || [];
      if (res.user?.has_successful_payments !== undefined) {
        STATE.user.has_successful_payments = !!res.user.has_successful_payments;
      }

      renderHeader();
      renderCats(STATE.shop);
      renderTickets();
      setTab("shop");
    } else {
      if (res.error === "access_denied_link_required") {
        if (els.mainWrapper) els.mainWrapper.style.display = "none";
        if (els.linkError) els.linkError.style.display = "flex";
        return;
      }
      if (els.userLine) {
        els.userLine.innerHTML = "";
        const sp = document.createElement("span");
        sp.style.color = "red";
        sp.textContent = `Error: ${safeText(res.error || "Auth", 200)}`;
        els.userLine.appendChild(sp);
        show(els.userLine);
      }
    }
  })();
}

document.addEventListener("DOMContentLoaded", initUserApp);
