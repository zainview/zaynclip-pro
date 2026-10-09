let snippets = [];
let expanderOn = true;
let lastEditable = null;
let widgetEl = null;

async function loadSettings() {
  const d = await chrome.storage.local.get(["snippets", "settings"]);
  snippets = d.snippets || [];
  expanderOn = d.settings?.expanderOn !== false;
}
loadSettings();
chrome.storage.onChanged.addListener((ch, area) => {
  if (area === "local" && (ch.snippets || ch.settings)) loadSettings();
});

// ===== COPY CAPTURE =====
document.addEventListener("copy", () => {
  const text = window.getSelection()?.toString();
  if (text && text.trim()) {
    chrome.runtime.sendMessage({ type: "SAVE_CLIP", text });
  }
}, true);

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

// ===== FOCUS TRACK (widget paste ke liye) =====
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

// ===== 4) ON-PAGE WIDGET (Alt+Shift+C) =====
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
    <div class="head"><span>⚡ CLIPBOARD PRO</span><span class="close">✕</span></div>
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
    if (window.top === window.self) toggleWidget(); // sirf top frame mein
  }
  if (msg.type === "INSERT_TEXT") {
    if (!document.hasFocus()) return;
    insertInto(document.activeElement, msg.text);
  }
});
