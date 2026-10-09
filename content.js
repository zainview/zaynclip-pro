let snippets = [];
let expanderOn = true;
let lastEditable = null;
let widgetEl = null;
let lastSaved = "";
let lastSavedAt = 0;
let selectionText = "";
let lastLinkUrl = "";        // last right-clicked link ka URL

async function loadSettings() {
  const d = await chrome.storage.local.get(["snippets", "settings"]);
  snippets = d.snippets || [];
  expanderOn = d.settings?.expanderOn !== false;
}
loadSettings();
chrome.storage.onChanged.addListener((ch, area) => {
  if (area === "local" && (ch.snippets || ch.settings)) loadSettings();
});

function saveClip(text) {
  text = (text || "").trim();
  if (!text) return;
  if (text === lastSaved && Date.now() - lastSavedAt < 3000) return;
  lastSaved = text;
  lastSavedAt = Date.now();
  chrome.runtime.sendMessage({ type: "SAVE_CLIP", text });
}

// ===== 1) NORMAL COPY EVENT (Ctrl+C, right-click → Copy) =====
document.addEventListener("copy", () => {
  const text = window.getSelection()?.toString();
  if (text) saveClip(text);
}, true);

// ===== 2) SELECTION TRACK (Opera mini-popup fallback) =====
document.addEventListener("mouseup", () => {
  setTimeout(() => {
    const t = window.getSelection()?.toString();
    if (t && t.trim()) selectionText = t;
  }, 10);
}, true);

document.addEventListener("selectionchange", () => {
  const t = window.getSelection()?.toString();
  if (t && t.trim()) selectionText = t;
});

// ===== 3) LINK TRACK (right-click "Copy link address" ke liye) =====
document.addEventListener("contextmenu", (e) => {
  const a = e.target.closest?.("a[href]");
  if (a) lastLinkUrl = a.href;
}, true);

// ===== 4) CLIPBOARD POLLING — Opera popup + links + address bar URL =====
// Sirf tab save karta hai jab clipboard ka content in mein se kisi ek se
// match kare: (a) aapki selection, (b) right-click kiya hua link,
// (c) current page ka URL. Random clipboard data kabhi save nahi hota.
function expectedTexts() {
  const out = [];
  if (selectionText && selectionText.trim()) out.push(selectionText.trim());
  if (lastLinkUrl) out.push(lastLinkUrl);
  try {
    const href = location.href;
    if (href && !/^(chrome|opera|about|edge|brave|vivaldi):/.test(href)) out.push(href);
  } catch (e) {}
  return out;
}

let lastClipCheck = "";
setInterval(async () => {
  const expected = expectedTexts();
  if (!expected.length) return;
  try {
    const text = await navigator.clipboard.readText();
    if (!text || text === lastClipCheck) return;
    const t = text.trim();
    if (expected.includes(t)) {
      lastClipCheck = text;
      saveClip(text);
    }
  } catch (e) {
    // page focused nahi / permission nahi — ignore
  }
}, 800);

// ===== TEXT EXPANDER =====
function findMatch(beforeCaret) {
  for (const s of snippets) {
    if (!s.key || !s.value) continue;
    if (beforeCaret.endsWith(s.key)) {
      const cb = beforeCaret[beforeCaret.length - s.key.length - 1];
      if (cb && /\S/.test(cb)) continue;
      return s;
    }
  }
  return null;
}

function expandInput(el) {
  const caret = el.selectionStart;
  if (caret == null) return;
  const before = el.value.slice(0, caret);
  const s = findMatch(before);
  if (!s) return;
  const start = caret - s.key.length;
  el.value = el.value.slice(0, start) + s.value + el.value.slice(caret);
  el.selectionStart = el.selectionEnd = start + s.value.length;
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

function expandEditable() {
  const sel = window.getSelection();
  if (!sel.rangeCount) return;
  const range = sel.getRangeAt(0);
  if (!range.collapsed || range.startContainer.nodeType !== Node.TEXT_NODE) return;
  const node = range.startContainer;
  const caret = range.startOffset;
  const s = findMatch(node.textContent.slice(0, caret));
  if (!s) return;
  const r = document.createRange();
  r.setStart(node, caret - s.key.length);
  r.setEnd(node, caret);
  r.deleteContents();
  const t = document.createTextNode(s.value);
  r.insertNode(t);
  r.setStartAfter(t);
  r.collapse(true);
  sel.removeAllRanges();
  sel.addRange(r);
}

document.addEventListener("input", (e) => {
  if (!expanderOn || !snippets.length) return;
  const el = e.target;
  if (el.tagName === "TEXTAREA" || (el.tagName === "INPUT" && /text|search|url|email/.test(el.type))) {
    expandInput(el);
  } else if (el.isContentEditable) {
    expandEditable();
  }
}, true);

// ===== FOCUS TRACK =====
document.addEventListener("focusin", (e) => {
  const el = e.target;
  if (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable) {
    lastEditable = el;
  }
}, true);

function insertInto(el, text) {
  if (el && (el.tagName === "TEXTAREA" || el.tagName === "INPUT")) {
    el.focus();
    const st = el.selectionStart ?? el.value.length;
    const en = el.selectionEnd ?? el.value.length;
    el.value = el.value.slice(0, st) + text + el.value.slice(en);
    el.selectionStart = el.selectionEnd = st + text.length;
    el.dispatchEvent(new Event("input", { bubbles: true }));
  } else if (el && el.isContentEditable) {
    el.focus();
    document.execCommand("insertText", false, text);
  } else {
    navigator.clipboard.writeText(text);
  }
}

// ===== ON-PAGE WIDGET (Alt+Shift+C) =====
async function toggleWidget() {
  if (widgetEl) { widgetEl.remove(); widgetEl = null; return; }

  const resp = await chrome.runtime.sendMessage({ type: "GET_CLIPS" });
  const clips = resp?.clips || [];
  const locked = resp?.locked;

  const host = document.createElement("div");
  const shadow = host.attachShadow({ mode: "open" });
  shadow.innerHTML = `
  <style>
    :host { all: initial; }
    .panel {
      position: fixed; top: 80px; right: 16px; z-index: 2147483647;
      width: 320px; max-height: 60vh; display: flex; flex-direction: column;
      background: rgba(13, 17, 30, 0.94);
      border: 1px solid rgba(0, 229, 255, 0.3);
      border-radius: 16px; backdrop-filter: blur(14px);
      box-shadow: 0 12px 40px rgba(0,0,0,0.5), 0 0 24px rgba(0,229,255,0.15);
      font-family: 'Segoe UI', Arial, sans-serif; color: #e6edf7;
      overflow: hidden; animation: pop 0.2s ease;
    }
    @keyframes pop { from { opacity:0; transform: translateY(-8px) scale(.97);} to { opacity:1; transform:none;} }
    .head {
      display: flex; justify-content: space-between; align-items: center;
      padding: 10px 14px; border-bottom: 1px solid rgba(0,229,255,0.15);
      font-weight: 700; font-size: 12px; letter-spacing: 1.5px; color: #00e5ff;
    }
    .close { cursor: pointer; color: #8a9ab8; padding: 2px 8px; border-radius: 6px; font-size: 14px; }
    .close:hover { background: rgba(255,255,255,0.08); color: #fff; }
    .items { overflow-y: auto; padding: 4px; }
    .items::-webkit-scrollbar { width: 5px; }
    .items::-webkit-scrollbar-thumb { background: linear-gradient(#00e5ff66,#8b5cf666); border-radius: 8px; }
    .item {
      padding: 9px 12px; margin: 4px; border-radius: 10px;
      background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.07);
      font-size: 12px; line-height: 1.45; cursor: pointer;
      max-height: 52px; overflow: hidden; word-break: break-word; transition: all .15s;
    }
    .item:hover { border-color: rgba(0,229,255,0.45); background: rgba(0,229,255,0.08); }
    .pin { color: #fbbf24; margin-right: 6px; }
    .empty { padding: 26px; text-align: center; color: #5a6b8a; font-size: 12px; }
  </style>
  <div class="panel">
    <div class="head"><span>⚡ ZAYNCLIP PRO</span><span class="close">✕</span></div>
    <div class="items"></div>
  </div>`;

  const itemsEl = shadow.querySelector(".items");
  shadow.querySelector(".close").onclick = () => toggleWidget();

  if (locked) {
    itemsEl.innerHTML = `<div class="empty">🔒 Locked — unlock from the popup first</div>`;
  } else if (!clips.length) {
    itemsEl.innerHTML = `<div class="empty">No clips yet</div>`;
  } else {
    clips.slice(0, 40).forEach((c) => {
      const d = document.createElement("div");
      d.className = "item";
      if (c.pinned) {
        const star = document.createElement("span");
        star.className = "pin";
        star.textContent = "★";
        d.appendChild(star);
      }
      d.appendChild(document.createTextNode(c.text.slice(0, 200)));
      d.onclick = () => { insertInto(lastEditable, c.text); toggleWidget(); };
      itemsEl.appendChild(d);
    });
  }

  document.documentElement.appendChild(host);
  widgetEl = host;
}

// ===== MESSAGE HANDLER =====
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === "WIDGET_TOGGLE") {
    if (window.top === window.self) toggleWidget();
  }
  if (msg.type === "INSERT_TEXT") {
    if (!document.hasFocus()) return;
    insertInto(document.activeElement, msg.text);
  }
});
