let snippets = [];

async function sha256(str) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function toast(msg) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.classList.add("show");
  setTimeout(() => t.classList.remove("show"), 2600);
}

async function loadAll() {
  const d = await chrome.storage.local.get(["snippets", "settings"]);
  snippets = d.snippets || [];
  document.getElementById("expanderOn").checked = d.settings?.expanderOn !== false;
  document.getElementById("maxClips").value = d.settings?.maxClips ?? 0;
  document.getElementById("syncOn").checked = !!d.settings?.syncOn;
  document.getElementById("passStatus").textContent = d.settings?.passHash
    ? "🔒 Passcode is SET — clipboard protected"
    : "🔓 No passcode set";
  renderSnips();
}

function renderSnips() {
  const list = document.getElementById("snipList");
  list.innerHTML = "";
  snippets.forEach((s, i) => {
    const row = document.createElement("div");
    row.className = "snip-item";
    const k = document.createElement("b");
    k.className = "key";
    k.textContent = s.key;
    const v = document.createElement("span");
    v.className = "val";
    v.textContent = s.value.length > 60 ? s.value.slice(0, 60) + "…" : s.value;
    const del = document.createElement("button");
    del.textContent = "Delete";
    del.className = "danger del";
    del.onclick = async () => {
      snippets.splice(i, 1);
      await chrome.storage.local.set({ snippets });
      renderSnips();
    };
    row.append(k, v, del);
    list.appendChild(row);
  });
}

document.getElementById("addSnip").onclick = async () => {
  const key = document.getElementById("newKey").value.trim();
  const value = document.getElementById("newVal").value;
  if (!key || !value) return toast("⚠️ Both key and value are required");
  snippets.push({ key, value });
  await chrome.storage.local.set({ snippets });
  document.getElementById("newKey").value = "";
  document.getElementById("newVal").value = "";
  renderSnips();
  toast("✅ Snippet added!");
};

document.getElementById("saveSettings").onclick = async () => {
  const d = await chrome.storage.local.get("settings");
  await chrome.storage.local.set({
    settings: {
      ...(d.settings || {}),
      expanderOn: document.getElementById("expanderOn").checked,
      maxClips: parseInt(document.getElementById("maxClips").value, 10) || 0,
      syncOn: document.getElementById("syncOn").checked
    }
  });
  toast("✅ Settings saved!");
};

// ===== PASSCODE =====
document.getElementById("setPass").onclick = async () => {
  const p = document.getElementById("passInput").value;
  if (p.length < 4) return toast("⚠️ At least 4 characters");
  const d = await chrome.storage.local.get("settings");
  const settings = d.settings || {};
  settings.passHash = await sha256(p);
  await chrome.storage.local.set({ settings });
  await chrome.storage.session.remove("unlocked");
  document.getElementById("passInput").value = "";
  toast("🔒 Passcode set!");
  loadAll();
};

document.getElementById("removePass").onclick = async () => {
  const d = await chrome.storage.local.get("settings");
  const settings = d.settings || {};
  delete settings.passHash;
  await chrome.storage.local.set({ settings });
  await chrome.storage.session.set({ unlocked: true });
  toast("🔓 Passcode removed");
  loadAll();
};

// ===== FLOATING =====
document.getElementById("floatOpen").onclick = () => {
  chrome.runtime.sendMessage({ type: "OPEN_FLOATING" });
};

// ===== EXPORT =====
document.getElementById("exportBtn").onclick = async () => {
  const data = await chrome.storage.local.get(null);
  if (data.settings) delete data.settings.passHash;
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "zaynclip-backup.json";
  a.click();
  toast("⬇ Exported!");
};

// ===== 🧠 SMART IMPORT — kisi bhi format ko ZaynClip format mein convert karta hai =====
function normalizeImportedData(raw) {
  const result = { clips: [], snippets: [], settings: {} };

  // Native ZaynClip settings / snippets
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    if (raw.settings && typeof raw.settings === "object") result.settings = raw.settings;
    if (Array.isArray(raw.snippets)) {
      for (const s of raw.snippets) {
        if (s && s.key && s.value) result.snippets.push({ key: String(s.key), value: String(s.value) });
      }
    }
  }

  // Clips array dhoondo — root array ya common keys mein
  let arr = null;
  if (Array.isArray(raw)) arr = raw;
  else if (raw && typeof raw === "object") {
    for (const k of ["clips", "history", "items", "entries", "data", "clipboard",
                     "clipboardHistory", "copiedItems", "list", "records", "clipsList"]) {
      if (Array.isArray(raw[k])) { arr = raw[k]; break; }
    }
  }
  if (!arr) return result;

  const TEXT_KEYS = ["text", "content", "copiedItem", "value", "clip", "data",
                     "item", "string", "snippet", "body", "title", "label"];
  const TIME_KEYS = ["time", "timestamp", "date", "created", "createdAt",
                     "copiedAt", "datetime", "addedAt", "ts"];
  const PIN_KEYS  = ["pinned", "favorite", "isFavorite", "favourite",
                     "isFavourite", "starred", "fav", "isPinned"];

  const seen = new Set();
  for (const it of arr) {
    let text = "", time = Date.now(), pinned = false;

    if (typeof it === "string") {
      text = it;
    } else if (it && typeof it === "object") {
      for (const k of TEXT_KEYS) {
        if (typeof it[k] === "string" && it[k].trim()) { text = it[k]; break; }
      }
      for (const k of TIME_KEYS) {
        if (it[k] != null) {
          let t = it[k];
          if (typeof t === "string") {
            const p = Date.parse(t);
            t = !isNaN(p) ? p : Number(t);
          }
          if (typeof t === "number" && isFinite(t) && t > 0) {
            if (t < 1e12) t *= 1000; // seconds → milliseconds
            time = t;
            break;
          }
        }
      }
      for (const k of PIN_KEYS) if (it[k] === true) { pinned = true; break; }
    }

    text = (text || "").trim();
    if (!text || seen.has(text)) continue;
    seen.add(text);
    result.clips.push({
      id: "imp" + Math.random().toString(36).slice(2, 10),
      text, pinned, time
    });
  }
  result.clips.sort((a, b) => b.time - a.time);
  return result;
}

document.getElementById("importBtn").onclick = () => document.getElementById("importFile").click();

document.getElementById("importFile").onchange = (e) => {
  const f = e.target.files[0];
  if (!f) return;
  const r = new FileReader();
  r.onload = async () => {
    let raw;
    try {
      raw = JSON.parse(r.result);
    } catch {
      toast("⚠️ Not a valid JSON file");
      return;
    }

    const norm = normalizeImportedData(raw);
    if (!norm.clips.length && !norm.snippets.length && !Object.keys(norm.settings).length) {
      toast("⚠️ No clips found — unrecognized file format");
      return;
    }

    // MERGE with existing (kuch delete nahi hota)
    const cur = await chrome.storage.local.get(["clips", "snippets", "settings"]);

    const existingTexts = new Set((cur.clips || []).map((c) => c.text));
    const newClips = norm.clips.filter((c) => !existingTexts.has(c.text));
    const clips = [...(cur.clips || []), ...newClips].sort((a, b) => b.time - a.time);

    const existingKeys = new Set((cur.snippets || []).map((s) => s.key));
    const newSnips = norm.snippets.filter((s) => !existingKeys.has(s.key));
    const allSnips = [...(cur.snippets || []), ...newSnips];

    // Imported settings sirf missing keys bharte hain — aapki settings overwrite nahi hoti
    const settings = { ...norm.settings, ...(cur.settings || {}) };
    delete settings.passHash; // security: kabhi import na ho

    await chrome.storage.local.set({ clips, snippets: allSnips, settings });

    const parts = [];
    if (newClips.length) parts.push(newClips.length + " clips");
    if (newSnips.length) parts.push(newSnips.length + " snippets");
    toast(parts.length ? "✅ Imported " + parts.join(" + ") + "!" : "ℹ️ Everything already exists — nothing new");
    loadAll();
  };
  r.readAsText(f);
  e.target.value = ""; // same file dobara select ho sake
};

// ===== WIPE =====
document.getElementById("wipeBtn").onclick = async () => {
  if (confirm("Everything will be permanently deleted. Are you sure?")) {
    await chrome.storage.local.clear();
    await chrome.storage.sync.clear();
    toast("🗑 All data wiped");
    loadAll();
  }
};

loadAll();
