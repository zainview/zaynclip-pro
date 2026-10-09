let snippets = [];

// ===== Helpers =====
async function sha256(str) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function toast(msg) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.classList.add("show");
  setTimeout(() => t.classList.remove("show"), 2000);
}

// ===== Load Everything =====
async function loadAll() {
  const d = await chrome.storage.local.get(["snippets", "settings"]);
  snippets = d.snippets || [];
  document.getElementById("expanderOn").checked = d.settings?.expanderOn !== false;
  document.getElementById("maxClips").value = d.settings?.maxClips ?? 0;
  document.getElementById("syncOn").checked = !!d.settings?.syncOn;
  document.getElementById("passStatus").textContent = d.settings?.passHash
    ? "🔒 Passcode is SET — your clipboard is protected"
    : "🔓 No passcode set";
  renderSnips();
}

// ===== Snippets =====
function renderSnips() {
  const list = document.getElementById("snipList");
  list.innerHTML = "";

  if (!snippets.length) {
    const empty = document.createElement("div");
    empty.style.cssText = "color:var(--dim);font-size:13px;padding:6px 0 12px";
    empty.textContent = "No snippets yet — add your first one below (e.g. ;sig → your email signature).";
    list.appendChild(empty);
    return;
  }

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
      toast("🗑 Snippet deleted");
    };

    row.append(k, v, del);
    list.appendChild(row);
  });
}

document.getElementById("addSnip").onclick = async () => {
  const key = document.getElementById("newKey").value.trim();
  const value = document.getElementById("newVal").value;

  if (!key || !value) return toast("⚠️ Both key and value are required");
  if (snippets.some((x) => x.key === key)) return toast("⚠️ This key already exists");

  snippets.push({ key, value });
  await chrome.storage.local.set({ snippets });
  document.getElementById("newKey").value = "";
  document.getElementById("newVal").value = "";
  renderSnips();
  toast("✅ Snippet added!");
};

// ===== General Settings =====
document.getElementById("saveSettings").onclick = async () => {
  const d = await chrome.storage.local.get("settings");
  await chrome.storage.local.set({
    settings: {
      ...(d.settings || {}),
      expanderOn: document.getElementById("expanderOn").checked,
      maxClips: Math.max(0, parseInt(document.getElementById("maxClips").value, 10) || 0),
      syncOn: document.getElementById("syncOn").checked
    }
  });
  toast("✅ Settings saved!");
};

// ===== Password Lock =====
document.getElementById("setPass").onclick = async () => {
  const p = document.getElementById("passInput").value;
  if (p.length < 4) return toast("⚠️ Passcode must be at least 4 characters");

  const d = await chrome.storage.local.get("settings");
  const settings = d.settings || {};
  settings.passHash = await sha256(p);
  await chrome.storage.local.set({ settings });
  await chrome.storage.session.remove("unlocked");
  document.getElementById("passInput").value = "";
  toast("🔒 Passcode set! Clipboard is now locked.");
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

// ===== Floating Mode =====
document.getElementById("floatOpen").onclick = () => {
  chrome.runtime.sendMessage({ type: "OPEN_FLOATING" });
};

// ===== Backup =====
document.getElementById("exportBtn").onclick = async () => {
  const data = await chrome.storage.local.get(null);
  if (data.settings) delete data.settings.passHash; // never export the hash
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "zaynclip-backup.json";
  a.click();
  toast("⬇ Backup exported!");
};

document.getElementById("importBtn").onclick = () => document.getElementById("importFile").click();

document.getElementById("importFile").onchange = (e) => {
  const f = e.target.files[0];
  if (!f) return;
  const r = new FileReader();
  r.onload = async () => {
    try {
      const parsed = JSON.parse(r.result);
      await chrome.storage.local.set(parsed);
      toast("✅ Import complete!");
      loadAll();
    } catch (err) {
      toast("⚠️ Invalid backup file");
    }
  };
  r.readAsText(f);
};

document.getElementById("wipeBtn").onclick = async () => {
  if (confirm("Everything will be permanently deleted. Are you sure?")) {
    await chrome.storage.local.clear();
    await chrome.storage.sync.clear();
    toast("🗑 All data wiped");
    loadAll();
  }
};

// ===== Init =====
loadAll();
