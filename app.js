/* ============================
   THEME
   ============================ */

:root {
  --bg: #020308;
  --bg-elevated: rgba(8, 10, 24, 0.95);
  --bg-soft: rgba(9, 12, 32, 0.96);
  --accent: #5865f2;
  --accent-soft: #7983ff;
  --accent-muted: #3c45a5;
  --accent-glow: rgba(88, 101, 242, 0.55);
  --text: #f8f8ff;
  --muted: #a4a7be;
  --border-subtle: rgba(255, 255, 255, 0.05);
  --chip-bg: rgba(255, 255, 255, 0.06);
  --danger: #ff4b5c;
  --success: #3ad67a;
  --shadow-strong: 0 24px 60px rgba(0, 0, 0, 0.9);
  --radius-lg: 20px;
  --radius-md: 14px;
  --radius-sm: 10px;
  --transition-fast: 0.16s ease-out;
  --transition-med: 0.23s ease-out;
}

*,
*::before,
*::after {
  box-sizing: border-box;
  font-family: system-ui, -apple-system, BlinkMacSystemFont, "SF Pro Text",
    "Segoe UI", sans-serif;
}

/* ============================
   BACKGROUND / LAYOUT
   ============================ */

body {
  margin: 0;
  padding: 0;
  min-height: 100vh;
  background:
    radial-gradient(circle at 0% 0%, rgba(88, 101, 242, 0.2), transparent 55%),
    radial-gradient(circle at 100% 0%, rgba(77, 0, 153, 0.26), transparent 55%),
    radial-gradient(circle at 50% 100%, rgba(88, 101, 242, 0.18), transparent 60%),
    linear-gradient(160deg, #020308 0%, #050411 40%, #030308 100%);
  color: var(--text);
}

/* blur doar pe ecrane mari */
@media (min-width: 900px) {
  body::before,
  body::after {
    content: "";
    position: fixed;
    inset: 0;
    pointer-events: none;
    mix-blend-mode: screen;
    opacity: 0.7;
    z-index: -1;
  }

  body::before {
    background: radial-gradient(circle at 15% 0%, rgba(88, 101, 242, 0.4), transparent 60%);
    filter: blur(60px);
  }

  body::after {
    background: radial-gradient(circle at 90% 100%, rgba(92, 24, 255, 0.35), transparent 55%);
    filter: blur(80px);
  }
}

/* container general */

.container {
  max-width: 1180px;
  margin: 0 auto;
  padding: 12px 14px 20px;
}

/* MiniApp user mai compact pe orizontală, dar full height */
body[data-page="user"] .container {
  max-width: 560px;
}

/* Admin – ocupă aproape tot ecranul */
body[data-page="admin"] .container {
  max-width: 1180px;
  min-height: 100vh;
  display: flex;
}

/* ============================
   CARD PRINCIPAL
   ============================ */

.card {
  position: relative;
  border-radius: var(--radius-lg);
  padding: 14px 14px 16px;
  background: linear-gradient(
      135deg,
      rgba(255, 255, 255, 0.04),
      rgba(255, 255, 255, 0.01)
    )
    border-box;
  border: 1px solid rgba(255, 255, 255, 0.06);
  box-shadow: var(--shadow-strong);
  backdrop-filter: blur(22px) saturate(140%);
  -webkit-backdrop-filter: blur(22px) saturate(140%);
  overflow: hidden;
}

.card::before {
  content: "";
  position: absolute;
  inset: 0;
  border-radius: inherit;
  padding: 1px;
  background: linear-gradient(
    135deg,
    rgba(88, 101, 242, 0.7),
    rgba(150, 60, 255, 0.4),
    rgba(10, 10, 24, 0.2)
  );
  -webkit-mask: linear-gradient(#000 0 0) content-box,
    linear-gradient(#000 0 0);
  -webkit-mask-composite: xor;
  mask-composite: exclude;
  opacity: 0.55;
  pointer-events: none;
}

/* user card */

.card--user {
  max-width: 560px;
  margin: 0 auto;
}

/* admin card – full în container, layout coloană pentru tabs/chat */

.card--admin {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: calc(100vh - 24px);
}

/* ============================
   HEADER
   ============================ */

.header-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 8px;
}

.badge {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 11px;
  padding: 4px 12px;
  border-radius: 999px;
  background: radial-gradient(circle at 0 0, var(--accent-soft), var(--accent));
  color: #fff;
  text-transform: uppercase;
  letter-spacing: 0.12em;
}

.badge-dot {
  width: 8px;
  height: 8px;
  border-radius: 999px;
  background: #fff;
  box-shadow: 0 0 12px rgba(255, 255, 255, 0.75);
}

.credits {
  text-align: right;
  font-size: 12px;
  color: var(--muted);
}

.credits .value {
  font-weight: 700;
  color: var(--accent-soft);
}

.env-info {
  font-size: 11px;
  color: var(--muted);
  opacity: 0.8;
}

h1 {
  margin: 4px 0 2px;
  font-size: 20px;
  letter-spacing: 0.01em;
}

.subtitle {
  margin: 0 0 8px;
  font-size: 12px;
  color: var(--muted);
}

.user-line {
  font-size: 12px;
  color: var(--muted);
  margin: 0 0 8px;
}

.user-line b {
  color: var(--text);
}

.admin-header-row {
  display: flex;
  justify-content: space-between;
  align-items: flex-end;
  gap: 12px;
  margin-bottom: 6px;
}

/* ============================
   TABS – segmented control
   ============================ */

.tabs {
  position: relative;
  display: flex;
  align-items: center;
  padding: 3px;
  border-radius: 999px;
  background: rgba(8, 10, 24, 0.9);
  border: 1px solid rgba(255, 255, 255, 0.04);
  margin-bottom: 8px;
}

.tab-btn {
  position: relative;
  flex: 1;
  font-size: 12px;
  padding: 7px 8px;
  border-radius: 999px;
  border: none;
  background: transparent;
  color: var(--muted);
  cursor: pointer;
  z-index: 1;
  transition: color var(--transition-med), transform var(--transition-fast);
}

.tab-btn.active {
  color: #fff;
  transform: translateY(-0.5px);
}

.tabs::after {
  content: "";
  position: absolute;
  top: 3px;
  bottom: 3px;
  left: 3px;
  width: calc(50% - 4px);
  border-radius: 999px;
  background: linear-gradient(135deg, var(--accent), var(--accent-soft));
  box-shadow: 0 0 18px var(--accent-glow);
  transition: transform var(--transition-med);
}

.tabs[data-active="shopTab"]::after {
  transform: translateX(calc(100%));
}

.tabs[data-active="chatTab"]::after {
  transform: translateX(0);
}

.tabs--admin[data-active="shopTab"]::after {
  transform: translateX(calc(100%));
}

.tab-section {
  display: none;
}

.tab-section.active {
  display: block;
}

.section-title {
  font-size: 13px;
  text-transform: uppercase;
  letter-spacing: 0.12em;
  color: var(--muted);
  margin: 4px 0 6px;
}

/* ============================
   FOOTER
   ============================ */

.footer {
  margin-top: 8px;
  font-size: 10px;
  color: var(--muted);
  display: flex;
  justify-content: space-between;
  align-items: center;
  opacity: 0.8;
}

.footer--admin {
  margin-top: 10px;
}

.dot-red {
  width: 8px;
  height: 8px;
  border-radius: 999px;
  background: var(--accent);
  box-shadow: 0 0 12px var(--accent-glow);
}

/* ============================
   SHOP – USER LIST
   ============================ */

.categories {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 4px;
}

.category {
  border-radius: var(--radius-md);
  padding: 8px 10px;
  background: radial-gradient(circle at 0 0, rgba(255, 255, 255, 0.02), transparent 65%),
    radial-gradient(circle at 100% 100%, rgba(88, 101, 242, 0.15), transparent 65%),
    rgba(6, 8, 24, 0.94);
  border: 1px solid var(--border-subtle);
  transition: border-color var(--transition-fast),
    transform var(--transition-fast),
    box-shadow var(--transition-fast),
    background var(--transition-fast);
}

.category:hover {
  border-color: rgba(88, 101, 242, 0.7);
  transform: translateY(-1px);
  box-shadow: 0 14px 28px rgba(0, 0, 0, 0.55);
  background: radial-gradient(circle at 0 0, rgba(255, 255, 255, 0.04), transparent 65%),
    radial-gradient(circle at 100% 100%, rgba(88, 101, 242, 0.22), transparent 65%),
    rgba(8, 10, 30, 0.96);
}

.category-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 4px;
}

.category-name {
  font-size: 13px;
  font-weight: 600;
}

.category-pill {
  font-size: 10px;
  text-transform: uppercase;
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--chip-bg);
  border: 1px solid rgba(255, 255, 255, 0.06);
  color: var(--muted);
}

.category-desc {
  font-size: 11px;
  color: var(--muted);
  margin-bottom: 5px;
}

.products {
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.product {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 6px;
  padding: 6px 7px;
  border-radius: var(--radius-sm);
  background: rgba(9, 10, 30, 0.96);
  border: 1px solid rgba(255, 255, 255, 0.03);
  transition: background var(--transition-fast), transform var(--transition-fast),
    border-color var(--transition-fast);
}

.product:hover {
  background: rgba(14, 16, 40, 0.98);
  border-color: rgba(88, 101, 242, 0.45);
  transform: translateY(-0.5px);
}

.product-main {
  display: flex;
  flex-direction: column;
  gap: 2px;
  max-width: 70%;
}

.product-name {
  font-size: 13px;
  font-weight: 600;
}

.product-desc {
  font-size: 11px;
  color: var(--muted);
  white-space: nowrap;
  text-overflow: ellipsis;
  overflow: hidden;
}

.product-price {
  font-size: 12px;
  font-weight: 600;
  color: var(--accent-soft);
  text-align: right;
}

.product-btn {
  font-size: 11px;
  padding: 5px 9px;
}

/* ============================
   PRODUCT PANEL (USER)
   ============================ */

.product-panel {
  margin-top: 10px;
  border-radius: var(--radius-md);
  padding: 10px;
  background: linear-gradient(
      135deg,
      rgba(88, 101, 242, 0.18),
      rgba(0, 0, 0, 0.2)
    ),
    rgba(5, 5, 18, 0.98);
  border: 1px solid rgba(255, 255, 255, 0.08);
  animation: panelIn 0.22s ease-out;
}

@keyframes panelIn {
  from {
    opacity: 0;
    transform: translateY(-4px) scale(0.98);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}

.product-panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 4px;
}

.product-panel-name {
  font-size: 14px;
  font-weight: 700;
}

.product-panel-close {
  border: none;
  background: transparent;
  color: var(--muted);
  font-size: 18px;
  cursor: pointer;
  padding: 0 4px;
}

.product-panel-desc {
  font-size: 12px;
  color: var(--muted);
  margin-bottom: 4px;
}

.product-panel-price {
  font-size: 12px;
  margin-bottom: 6px;
}

.qty-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

.qty-label {
  font-size: 12px;
}

.qty-row input {
  width: 70px;
  padding: 5px 6px;
  border-radius: 999px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(4, 4, 14, 0.95);
  color: var(--text);
  font-size: 12px;
  text-align: center;
}

.qty-range {
  font-size: 11px;
  color: var(--muted);
}

.product-panel-buy {
  width: 100%;
}

/* ============================
   CHAT LAYOUT (USER & ADMIN)
   ============================ */

/* user */
.chat-layout {
  display: grid;
  grid-template-columns: 0.9fr 1.6fr;
  gap: 8px;
  max-height: 360px;
}

/* admin */
.chat-admin-layout {
  display: grid;
  grid-template-columns: minmax(260px, 0.8fr) minmax(0, 1.7fr);
  gap: 10px;
  margin-top: 4px;
  min-height: 0;
}

/* coloana stânga – listă tichete */
.chat-sidebar {
  border-radius: var(--radius-md);
  background: var(--bg-soft);
  border: 1px solid var(--border-subtle);
  overflow: hidden;
  font-size: 12px;

  display: flex;
  flex-direction: column;
  min-height: 0;
  max-height: 420px;
  overflow-y: auto;
}

/* chat item */

.chat-item {
  padding: 8px 10px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.04);
  cursor: pointer;
  transition: background var(--transition-fast), border-color var(--transition-fast),
    transform var(--transition-fast);
}

.chat-item:hover {
  background: rgba(255, 255, 255, 0.02);
  transform: translateY(-0.5px);
}

.chat-item.active {
  background: radial-gradient(circle at 0 0, rgba(88, 101, 242, 0.34), transparent 70%);
  border-left: 3px solid var(--accent-soft);
}

.chat-item-title {
  font-weight: 600;
  font-size: 12px;
}

.chat-item-line {
  font-size: 11px;
  color: var(--muted);
  white-space: nowrap;
  text-overflow: ellipsis;
  overflow: hidden;
}

/* chat main – coloana dreaptă */

.chat-main {
  border-radius: var(--radius-md);
  background: var(--bg-soft);
  border: 1px solid var(--border-subtle);
  display: flex;
  flex-direction: column;
  min-height: 0;
  max-height: 420px;
}

.chat-header {
  padding: 7px 10px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.04);
  font-size: 12px;
}

.chat-header span {
  color: var(--muted);
}

.chat-messages {
  flex: 1;
  padding: 4px 8px 6px;
  overflow-y: auto;
}

/* bar pentru mode (reply / edit) ca Discord */

.chat-mode-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 4px 10px;
  margin: 4px 8px 2px;
  border-radius: 8px;
  background: rgba(88, 101, 242, 0.18);
  border: 1px solid rgba(88, 101, 242, 0.45);
  font-size: 11px;
}

.chat-mode-text {
  color: #dfe3ff;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* tickets info (user) */

.tickets-info {
  margin-top: 6px;
  font-size: 11px;
  color: var(--muted);
}

/* chat input */

.chat-input {
  border-top: 1px solid rgba(255, 255, 255, 0.04);
  padding: 6px;
  display: flex;
  gap: 6px;
  align-items: center;
}

.chat-input input {
  flex: 1;
  border-radius: 999px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(4, 4, 14, 0.95);
  color: var(--text);
  padding: 6px 10px;
  font-size: 12px;
}

.chat-input button {
  white-space: nowrap;
}

/* ============================
   MESAJE – DISCORD STYLE
   ============================ */

.msg-row {
  display: flex;
  gap: 8px;
  padding: 6px 10px;
  border-radius: 8px;
  transition: background 0.15s ease-out;
}

.msg-row:hover {
  background: rgba(255, 255, 255, 0.03);
}

.msg-row--highlight {
  background: rgba(88, 101, 242, 0.25);
}

/* avatar */

.msg-avatar {
  width: 32px;
  height: 32px;
  border-radius: 999px;
  background: linear-gradient(135deg, #ff7a55, #ffb347);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  font-weight: 700;
  color: #111;
  flex-shrink: 0;
}

/* conținut */

.msg-content {
  flex: 1;
}

/* header line (nume + timp) */

.msg-header-line {
  display: flex;
  align-items: baseline;
  gap: 6px;
  margin-bottom: 2px;
}

.msg-username {
  font-size: 13px;
  font-weight: 600;
  color: #f5f5ff;
}

.msg-username--admin {
  color: #3ba55d;
}

.msg-timestamp {
  font-size: 11px;
  color: var(--muted);
}

/* bubble */

.msg-bubble {
  position: relative;
  padding: 2px 0 2px 0;
  font-size: 13px;
}

/* text */

.msg-text {
  white-space: pre-wrap;
  word-break: break-word;
}

.msg-text--deleted {
  font-style: italic;
  color: rgba(255, 255, 255, 0.6);
}

/* meta (editat) */

.msg-meta {
  margin-top: 2px;
  font-size: 10px;
  color: var(--muted);
}

/* acțiuni (Reply/Edit/Del) – dreapta sus la hover */

.msg-actions {
  position: absolute;
  top: -6px;
  right: 0;
  display: flex;
  gap: 4px;
  opacity: 0;
  transform: translateY(-4px);
  transition: opacity 0.12s ease-out, transform 0.12s ease-out;
  pointer-events: none;
}

.msg-row:hover .msg-actions {
  opacity: 1;
  transform: translateY(0);
  pointer-events: auto;
}

.msg-action-btn {
  border: none;
  border-radius: 6px;
  padding: 2px 6px;
  font-size: 10px;
  background: rgba(32, 34, 37, 0.9);
  color: #f5f5f5;
  cursor: pointer;
}

.msg-action-btn:hover {
  background: rgba(54, 57, 63, 0.95);
}

.msg-action-btn--danger {
  color: #ff4b5c;
}

/* reply preview în mesaj */

.msg-reply-preview {
  margin-bottom: 2px;
  padding: 2px 6px;
  border-left: 2px solid rgba(88, 101, 242, 0.85);
  border-radius: 4px;
  background: rgba(32, 34, 37, 0.85);
  font-size: 11px;
  color: var(--muted);
  max-width: 100%;
  cursor: pointer;
}

.msg-reply-preview strong {
  margin-right: 4px;
  color: #dfe3ff;
}

/* ============================
   ADMIN – TICKET DETAILS
   ============================ */

.ticket-details {
  margin-top: 10px;
  border-radius: var(--radius-md);
  background: rgba(6, 8, 24, 0.96);
  border: 1px solid var(--border-subtle);
  padding: 8px 10px;
  font-size: 12px;
}

.ticket-summary {
  margin-bottom: 4px;
}

.ticket-actions {
  margin-top: 6px;
  display: flex;
  gap: 6px;
}

/* Notă internă */

.ticket-note-inline {
  margin-top: 4px;
  font-size: 11px;
  color: var(--muted);
}

.ticket-note-label {
  font-weight: 600;
  margin-right: 4px;
}

.ticket-note-text {
  opacity: 0.9;
}

.ticket-note-empty {
  font-style: italic;
  opacity: 0.7;
}

/* ============================
   ADMIN – SHOP EDITOR
   ============================ */

.shop-flex {
  display: grid;
  grid-template-columns: minmax(0, 2.1fr) minmax(260px, 0.9fr);
  gap: 10px;
  margin-top: 4px;
  min-height: 0;
}

.shop-container {
  max-height: 460px;
  overflow: auto;
  border-radius: var(--radius-md);
  background: var(--bg-soft);
  border: 1px solid var(--border-subtle);
  padding: 8px;
}

.shop-sidepanel {
  border-radius: var(--radius-md);
  background: rgba(7, 7, 22, 0.96);
  border: 1px solid var(--border-subtle);
  padding: 10px;
  font-size: 12px;
}

.shop-sidepanel-title {
  font-size: 14px;
  margin: 0 0 4px;
}

.shop-sidepanel-text {
  font-size: 11px;
  color: var(--muted);
  margin: 0 0 8px;
}

/* category editor */

.cat-card {
  border-radius: var(--radius-md);
  padding: 8px;
  margin-bottom: 8px;
  background: rgba(10, 11, 30, 0.96);
  border: 1px solid var(--border-subtle);
}

.cat-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
}

.cat-header-left {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: 1;
}

.cat-header-right {
  display: flex;
  align-items: center;
  gap: 6px;
}

.cat-header input {
  flex: 1;
  border-radius: 999px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(4, 4, 14, 0.96);
  color: var(--text);
  padding: 6px 10px;
  font-size: 12px;
}

.cat-desc textarea {
  width: 100%;
  margin-top: 4px;
  border-radius: 12px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(3, 3, 15, 0.96);
  color: var(--text);
  padding: 6px 8px;
  font-size: 12px;
  resize: vertical;
}

.cat-toggle {
  padding-inline: 6px;
  min-width: 30px;
}

/* product rows */

.products-list {
  margin-top: 6px;
  border-radius: var(--radius-sm);
  border: 1px solid rgba(255, 255, 255, 0.05);
  padding: 6px;
  background: rgba(5, 6, 20, 0.96);
}

.product-row {
  display: grid;
  grid-template-columns: 1.6fr 0.7fr 0.7fr 0.7fr auto;
  gap: 4px;
  align-items: center;
  margin-bottom: 4px;
}

.product-row input {
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(4, 4, 14, 0.96);
  color: var(--text);
  padding: 4px 6px;
  font-size: 11px;
}

.products-list input[type="text"] {
  width: 100%;
}

.product-mini-actions {
  display: flex;
  gap: 4px;
}

.small-input-label {
  font-size: 10px;
  color: var(--muted);
  margin-top: 2px;
}

/* shop metrics */

.shop-metrics {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  margin-bottom: 8px;
}

/* ============================
   STATUS BARS
   ============================ */

.status-bar {
  margin-top: 6px;
  font-size: 11px;
  min-height: 14px;
  color: var(--muted);
}

.status-ok {
  color: var(--success);
}

.status-error {
  color: var(--danger);
}

/* ============================
   BUTTONS
   ============================ */

.btn-primary,
.product-panel-buy,
.chat-input button,
.product-btn {
  border: none;
  border-radius: 999px;
  background: linear-gradient(135deg, var(--accent), var(--accent-soft));
  color: #fff;
  font-size: 12px;
  padding: 7px 12px;
  cursor: pointer;
  box-shadow: 0 10px 25px var(--accent-glow);
  transition: transform var(--transition-fast), box-shadow var(--transition-fast),
    filter var(--transition-fast);
}

.btn-primary:hover,
.product-panel-buy:hover,
.chat-input button:hover,
.product-btn:hover {
  transform: translateY(-1px);
  box-shadow: 0 14px 28px var(--accent-glow);
  filter: brightness(1.05);
}

.btn-ghost {
  border-radius: 999px;
  padding: 6px 10px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(5, 5, 15, 0.98);
  font-size: 11px;
  color: var(--muted);
  cursor: pointer;
  transition: background var(--transition-fast), border-color var(--transition-fast),
    transform var(--transition-fast), color var(--transition-fast);
}

.btn-ghost:hover {
  background: rgba(10, 10, 26, 0.98);
  border-color: rgba(255, 255, 255, 0.16);
  color: var(--text);
  transform: translateY(-0.5px);
}

.full-width {
  width: 100%;
}

/* ============================
   ADMIN TOOLBAR & STATS
   ============================ */

.admin-toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 10px;
  margin-bottom: 8px;
  padding: 6px 8px;
  border-radius: 14px;
  background: rgba(5, 6, 20, 0.9);
  border: 1px solid rgba(255, 255, 255, 0.04);
}

.toolbar-group {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: 1;
  min-width: 0;
}

.toolbar-select {
  border-radius: 999px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(4, 4, 14, 0.96);
  color: var(--text);
  padding: 5px 10px;
  font-size: 12px;
}

.toolbar-search {
  flex: 1;
  border-radius: 999px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(4, 4, 14, 0.96);
  color: var(--text);
  padding: 6px 10px;
  font-size: 12px;
}

.toolbar-stats {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  justify-content: flex-end;
}

/* stat pills */

.stat-pill {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 10px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.06);
  font-size: 11px;
}

.stat-pill--open {
  background: rgba(58, 214, 122, 0.08);
  border-color: rgba(58, 214, 122, 0.35);
}

.stat-pill--closed {
  background: rgba(255, 75, 92, 0.08);
  border-color: rgba(255, 75, 92, 0.35);
}

.stat-pill--soft {
  background: rgba(255, 255, 255, 0.02);
}

.stat-label {
  color: var(--muted);
}

.stat-value {
  font-weight: 600;
}

/* status pills în listă tichete */

.chat-item-header-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 6px;
}

.ticket-status-pill {
  position: relative;
  font-size: 10px;
  padding: 2px 8px;
  border-radius: 999px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  border: 1px solid rgba(255, 255, 255, 0.12);
}

.ticket-status-pill.open {
  background: rgba(58, 214, 122, 0.1);
  border-color: rgba(58, 214, 122, 0.6);
  color: #9bffb9;
}

.ticket-status-pill.closed {
  background: rgba(255, 75, 92, 0.08);
  border-color: rgba(255, 75, 92, 0.6);
  color: #ff9ba4;
}

/* badge pentru mesaje noi */

.ticket-unread-badge {
  position: absolute;
  top: -6px;
  right: -6px;
  min-width: 16px;
  height: 16px;
  padding: 0 4px;
  border-radius: 999px;
  background: #f04747;
  color: #fff;
  font-size: 9px;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 0 8px rgba(240, 71, 71, 0.8);
}

/* ============================
   MODAL – Închide cu motiv
   ============================ */

.modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(2, 3, 10, 0.78);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  display: none;
  align-items: center;
  justify-content: center;
  z-index: 40;
}

.modal {
  width: min(420px, 92vw);
  border-radius: 18px;
  background: radial-gradient(circle at 0 0, rgba(88, 101, 242, 0.3), transparent 65%),
    rgba(6, 6, 20, 0.98);
  border: 1px solid rgba(255, 255, 255, 0.12);
  box-shadow: 0 20px 50px rgba(0, 0, 0, 0.85);
  padding: 12px 14px 14px;
  animation: panelIn 0.18s ease-out;
}

.modal h3 {
  margin: 0 0 4px;
  font-size: 15px;
}

.modal-text {
  margin: 0 0 8px;
  font-size: 12px;
  color: var(--muted);
}

.modal textarea {
  width: 100%;
  min-height: 80px;
  border-radius: 12px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  background: rgba(3, 3, 15, 0.98);
  color: var(--text);
  padding: 6px 8px;
  font-size: 12px;
  resize: vertical;
  margin-bottom: 8px;
}

.modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 6px;
}

/* ============================
   SCROLLBARS CUSTOM – chat
   ============================ */

.chat-sidebar,
.chat-messages {
  scrollbar-width: thin;
  scrollbar-color: var(--accent-soft) rgba(255, 255, 255, 0.04);
}

.chat-sidebar::-webkit-scrollbar,
.chat-messages::-webkit-scrollbar {
  width: 6px;
}

.chat-sidebar::-webkit-scrollbar-track,
.chat-messages::-webkit-scrollbar-track {
  background: transparent;
}

.chat-sidebar::-webkit-scrollbar-thumb,
.chat-messages::-webkit-scrollbar-thumb {
  background: linear-gradient(180deg, var(--accent), var(--accent-soft));
  border-radius: 999px;
}

/* ============================
   RESPONSIVE
   ============================ */

@media (max-width: 900px) {
  .chat-layout,
  .chat-admin-layout,
  .shop-flex {
    grid-template-columns: 1fr;
    max-height: none;
  }

  .chat-sidebar,
  .chat-main {
    max-height: none;
  }

  .container {
    padding-inline: 10px;
  }
}
