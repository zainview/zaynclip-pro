const g = (k) => chrome.storage.local.get(k);
const s = (o) => chrome.storage.local.set(o);

async function sha256(str) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function isUnlocked() {
  const { unlocked } = await chrome.storage.session.get("unlocked");
  return !!unlocked;
}

// ===== 1) UNLIMITED HISTORY =====
async function addClip(text, pinned = false) {
  text = (text || "").trim();
  if (!text) return;
  const { clips = [], settings = {} } = await g(["clips", "settings"]);
  const max = settings.maxClips ?? 0; // 0 = UNLIMITED

  let list = clips.filter((c) => c.text !== text);
  list.unshift({
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    text, pinned, time: Date.now()
  });

  if (max > 0) {
    const pins = list.filter((c) => c.pinned);
    const rest = list.filter((c) => !c.pinned).slice(0, max);
    list = [...pins, ...rest];
  }
  await s({ clips: list });
  scheduleSync();
}

// ===== 2) CLOUD SYNC (pinned clips + snippets, aapke Google account se) =====
let syncTimer = null;
function scheduleSync() {
  clearTimeout(syncTimer);
  syncTimer = setTimeout(doSync, 2500);
}

async function doSync() {
  const { settings = {}, clips = [], snippets = [] } = await g(["settings", "clips", "snippets"]);
  if (!settings.syncOn) return;
  const out = { clips: [], snippets: [], t: Date.now() };
  for (const sn of snippets) {
    if (JSON.stringify(out).length + JSON.stringify(sn).length > 7000) break;
    out.snippets.push(sn);
  }
  for (const c of clips.filter((x) => x.pinned)) {
    const item = { text: c.text.slice(0, 2000), pinned: true, time: c.time };
    if (JSON.stringify(out).length + JSON.stringify(item).length > 7800) break;
    out.clips.push(item);
  }
  try { await chrome.storage.sync.set({ syncData: out }); } catch (e) {}
}

async function importSync() {
  const { settings = {} } = await g(["settings"]);
  if (!settings.syncOn) return;
  const { syncData } = await chrome.storage.sync.get("syncData");
  if (!syncData) return;
  const { clips = [], snippets = [] } = await g(["clips", "snippets"]);
  const texts = new Set(clips.map((c) => c.text));
  const newClips = (syncData.clips || [])
    .filter((c) => !texts.has(c.text))
    .map((c) => ({
      id: "sync" + Math.random().toString(36).slice(2, 10),
      text: c.text, pinned: true, time: c.time || Date.now()
    }));
  const keys = new Set(snippets.map((x) => x.key));
  const newSnips = (syncData.snippets || []).filter((x) => !keys.has(x.key));
  if (newClips.length || newSnips.length) {
    await s({ clips: [...newClips, ...clips], snippets: [...snippets, ...newSnips] });
  }
}

chrome.runtime.onStartup.addListener(importSync);
chrome.storage.onChanged.addListener((ch, area) => {
  if (area === "sync" && ch.syncData) importSync(); // doosre device se aaya data
});

// ===== 3) FLOATING MODE =====
let floatWinId = null;
async function openFloating() {
  if (floatWinId != null) {
    try { await chrome.windows.update(floatWinId, { focused: true }); return; }
    catch (e) { floatWinId = null; }
  }
  const win = await chrome.windows.create({
    url: "floating.html", type: "popup", width: 400, height: 560
  });
  floatWinId = win.id;
}
chrome.windows.onRemoved.addListener((id) => { if (id === floatWinId) floatWinId = null; });

// ===== MESSAGES =====
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    switch (msg.type) {
      case "SAVE_CLIP":
        await addClip(msg.text);
        sendResponse({ ok: true });
        break;
      case "GET_CLIPS": {
        const { clips = [], settings = {} } = await g(["clips", "settings"]);
        if (settings.passHash && !(await isUnlocked())) {
          sendResponse({ locked: true });
        } else {
          sendResponse({ clips });
        }
        break;
      }
      case "UNLOCK": {
        const { settings = {} } = await g(["settings"]);
        const hash = await sha256(msg.pass || "");
        if (settings.passHash && hash === settings.passHash) {
          await chrome.storage.session.set({ unlocked: true });
          sendResponse({ ok: true });
        } else sendResponse({ ok: false });
        break;
      }
      case "OPEN_FLOATING":
        await openFloating();
        sendResponse({ ok: true });
        break;
    }
  })();
  return true;
});

// ===== CONTEXT MENU =====
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "save-pin",
    title: "Clipboard Pro mein pin karo",
    contexts: ["selection"]
  });
  importSync();
});
chrome.contextMenus.onClicked.addListener((info) => {
  if (info.menuItemId === "save-pin" && info.selectionText) {
    addClip(info.selectionText, true);
  }
});

// ===== 5) ADVANCED SHORTCUTS =====
chrome.commands.onCommand.addListener(async (command) => {
  if (command === "floatingMode") { openFloating(); return; }
  if (command === "lockNow") { await chrome.storage.session.remove("unlocked"); return; }

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  if (command === "toggleWidget") {
    if (tab?.id) chrome.tabs.sendMessage(tab.id, { type: "WIDGET_TOGGLE" });
    return;
  }

  if (command.startsWith("paste-fav-")) {
    const { clips = [], settings = {} } = await g(["clips", "settings"]);
    if (settings.passHash && !(await isUnlocked())) return; // locked = no paste
    const idx = parseInt(command.split("-").pop(), 10) - 1;
    const favs = clips.filter((c) => c.pinned);
    if (!favs[idx] || !tab?.id) return;
    chrome.tabs.sendMessage(tab.id, { type: "INSERT_TEXT", text: favs[idx].text });
  }
});
