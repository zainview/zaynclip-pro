const listEl = document.getElementById("list");
const searchEl = document.getElementById("search");
const emptyEl = document.getElementById("empty");
const RENDER_LIMIT = 300;
let clips = [];

function timeAgo(t) {
  const s = Math.floor((Date.now() - t) / 1000);
  if (s < 60) return "abhi";
  const m = Math.floor(s / 60);
  if (m < 60) return m + " min";
  const h = Math.floor(m / 60);
  if (h < 24) return h + " hr";
  return Math.floor(h / 24) + " din";
}

// ===== LOCK =====
async function checkLock() {
  const d = await chrome.storage.local.get("settings");
  if (!d.settings?.passHash) return false;
  const ses = await chrome.storage.session.get("unlocked");
  if (ses.unlocked) return false;
  document.getElementById("lockScreen").style.display = "flex";
  document.getElementById("appMain").style.display = "none";
  document.getElementById("lockPass").focus();
  return true;
}

async function tryUnlock() {
  const pass = document.getElementById("lockPass").value;
  const resp = await chrome.runtime.sendMessage({ type: "UNLOCK", pass });
  if (resp?.ok) {
    document.getElementById("lockScreen").style.display = "none";
    document.getElementById("appMain").style.display = "block";
    load();
  } else {
    document.getElementById("lockError").textContent = "Galat passcode!";
    document.getElementById("lockPass").value = "";
  }
}
document.getElementById("unlockBtn").onclick = tryUnlock;
document.getElementById("lockPass").addEventListener("keydown", (e) => {
  if (e.key === "Enter") tryUnlock();
});

// ===== RENDER =====
function render() {
  const q = searchEl.value.trim().toLowerCase();
  const shown = clips
    .filter((c) => !q || c.text.toLowerCase().includes(q))
    .sort((a, b) => b.pinned - a.pinned || b.time - a.time)
    .slice(0, RENDER_LIMIT);

  listEl.innerHTML = "";
  emptyEl.style.display = shown.length ? "none" : "block";

  for (const c of shown) {
    const div = document.createElement("div");
    div.className = "clip" + (c.pinned ? " pinned" : "");

    const txt = document.createElement("div");
    txt.className = "text";
    txt.textContent = c.text;
    txt.title = "Click to copy";
    txt.onclick = () => copyClip(c, txt);

    const meta = document.createElement("div");
    meta.className = "meta";
    meta.textContent = timeAgo(c.time);
    txt.appendChild(meta);

    const btns = document.createElement("div");
    btns.className = "btns";

    const pin = document.createElement("button");
    pin.textContent = c.pinned ? "★" : "☆";
    pin.className = "pin-btn" + (c.pinned ? " active" : "");
    pin.title = "Pin / Unpin";
    pin.onclick = async () => {
      c.pinned = !c.pinned;
      await chrome.storage.local.set({ clips });
    };

    const del = document.createElement("button");
    del.textContent = "🗑";
    del.title = "Delete";
    del.onclick = async () => {
      clips = clips.filter((x) => x.id !== c.id);
      await chrome.storage.local.set({ clips });
    };

    btns.append(pin, del);
    div.append(txt, btns);
    listEl.appendChild(div);
  }
}

async function copyClip(c, el) {
  await navigator.clipboard.writeText(c.text);
  el.classList.add("copied-flash");
  setTimeout(() => el.classList.remove("copied-flash"), 500);
}

async function load() {
  const d = await chrome.storage.local.get(["clips", "settings"]);
  clips = d.clips || [];
  document.getElementById("syncBadge").classList.toggle("on", !!d.settings?.syncOn);
  render();
}

searchEl.addEventListener("input", render);
chrome.storage.onChanged.addListener((ch, area) => {
  if (area === "local" && ch.clips) load();
});

// ===== FOOTER =====
document.getElementById("clear").onclick = async () => {
  if (confirm("Saare unpinned clips delete karein?")) {
    clips = clips.filter((c) => c.pinned);
    await chrome.storage.local.set({ clips });
  }
};
document.getElementById("options").onclick = () => chrome.runtime.openOptionsPage();
document.getElementById("floatBtn").onclick = async () => {
  await chrome.runtime.sendMessage({ type: "OPEN_FLOATING" });
  window.close();
};
document.getElementById("lockBtn").onclick = async () => {
  await chrome.storage.session.remove("unlocked");
  window.close();
};

// ===== INIT =====
(async () => {
  const locked = await checkLock();
  if (!locked) load();
})();
