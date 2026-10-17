const META = {
  twitch: { short: "TW", color: "#a970ff" },
  youtube: { short: "YT", color: "#ff3b30" },
  kick: { short: "KK", color: "#3dff7a" },
  vk: { short: "VK", color: "#2787f5" },
  local: { short: "ВСЕ", color: "#f3efe6" },
};

const mode = document.body.dataset.mode;
const preview = new URLSearchParams(location.search).has("preview");
const log = document.getElementById("log");
const rows = new Map();
let overlayLimit = 8;

if (mode === "dock") buildLamps();

const socket = connect();

document.getElementById("check")?.addEventListener("click", async () => {
  await fetch("/api/test", { method: "POST" });
});

document.getElementById("clear-check")?.addEventListener("click", async () => {
  await fetch("/api/test/clear", { method: "POST" });
});

document.getElementById("composer")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const input = document.getElementById("text");
  const text = input.value.trim();
  if (!text) return;
  input.disabled = true;
  try {
    const response = await fetch("/api/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    if (response.ok) input.value = "";
  } finally {
    input.disabled = false;
    input.focus();
  }
});

function connect() {
  const ws = new WebSocket(`ws://${location.host}/ws`);
  ws.addEventListener("message", (event) => {
    const data = JSON.parse(event.data);
    if (data.type === "snapshot") {
      rows.clear();
      log.replaceChildren();
      if (mode === "dock") ensureEmpty();
      for (const message of data.messages) upsert(message);
      for (const [platform, status] of Object.entries(data.statuses || {})) setLamp(platform, status);
      if (preview) paintPreview();
      applyLook(data.look);
    }
    if (data.type === "look") applyLook(data.look);
    if (data.type === "message" || data.type === "message-update") upsert(data.message);
    if (data.type === "clear") removeMessages(data.ids);
    if (data.type === "status") setLamp(data.platform, data);
  });
  ws.addEventListener("close", () => setTimeout(connect, 1500));
  return ws;
}

function removeMessages(ids) {
  for (const id of ids || []) {
    rows.get(id)?.remove();
    rows.delete(id);
  }
  if (mode === "overlay") fadeOverlay();
  if (mode === "dock" && !log.querySelector(".strip")) ensureEmpty();
}

function upsert(message) {
  if (!message) return;
  if (mode === "overlay" && !message.overlay) {
    rows.get(message.id)?.remove();
    rows.delete(message.id);
    fadeOverlay();
    return;
  }
  let row = rows.get(message.id);
  const fresh = !row;
  if (!row) {
    row = document.createElement("article");
    rows.set(message.id, row);
    log.append(row);
  }
  fill(row, message);
  if (fresh) row.classList.add("in");
  document.getElementById("empty")?.remove();
  if (mode === "overlay") trimOverlay();
  if (mode === "dock") stickToBottom();
}

function fill(row, message) {
  const meta = META[message.platform] || META.local;
  row.className = row.classList.contains("in") ? "strip in" : "strip";
  row.dataset.platform = message.platform;
  row.dataset.hidden = message.overlay ? "false" : "true";
  row.replaceChildren();

  const head = document.createElement("div");
  head.className = "meta";
  const plat = document.createElement("span");
  plat.className = "plat";
  plat.textContent = meta.short;
  const author = document.createElement(mode === "dock" ? "button" : "span");
  if (mode === "dock") author.type = "button";
  author.className = "author";
  author.textContent = message.displayAuthor || message.author;
  author.style.color = usableColor(message.color, meta.color);
  if (mode === "dock") author.addEventListener("click", () => openNick(message));
  const time = document.createElement("time");
  time.dateTime = new Date(message.at).toISOString();
  time.textContent = new Date(message.at).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
  head.append(plat, author, time);
  if (mode === "dock" && message.displayAuthor && message.displayAuthor !== message.author) {
    const was = document.createElement("span");
    was.className = "was";
    was.textContent = `было ${message.author}`;
    head.append(was);
  }
  if (mode === "dock" && !message.overlay) {
    const flag = document.createElement("span");
    flag.className = "flag";
    flag.textContent = "не на экране";
    head.append(flag);
  }

  const text = document.createElement("p");
  text.className = "text";
  text.innerHTML = message.safeHtml || "";
  row.append(head, text);

  if (mode === "dock" && message.deliveries?.length) {
    const line = document.createElement("p");
    line.className = "deliveries";
    for (const delivery of message.deliveries) {
      const bit = document.createElement("span");
      const short = (META[delivery.platform] || META.local).short;
      bit.textContent = delivery.status === "ok"
        ? `${short} ✓`
        : delivery.status === "error"
          ? `${short} ✕ ${delivery.error || "не ушло"}`
          : `${short} …`;
      bit.dataset.state = delivery.status;
      if (delivery.error) bit.title = delivery.error;
      line.append(bit);
    }
    row.append(line);
  }
}

function trimOverlay() {
  const visible = [...log.querySelectorAll(".strip")];
  while (visible.length > overlayLimit) {
    const extra = visible.shift();
    rows.delete([...rows.entries()].find(([, node]) => node === extra)?.[0]);
    extra.remove();
  }
  fadeOverlay();
}

function fadeOverlay() {
  const visible = [...log.querySelectorAll(".strip")];
  const fade = document.body.dataset.fade !== "false";
  visible.forEach((row, index) => {
    if (!fade) {
      row.style.opacity = "";
      return;
    }
    const fromEnd = visible.length - 1 - index;
    row.style.opacity = String(Math.max(0.38, 1 - fromEnd * 0.1));
  });
}

function applyLook(look) {
  if (!look || mode !== "overlay") return;
  overlayLimit = look.maxMessages || 8;
  const root = document.documentElement;
  root.style.setProperty("--msg-size", `${look.fontSize}px`);
  root.style.setProperty("--name-size", `${look.nameSize}px`);
  root.style.setProperty("--strip-alpha", String(Number(look.opacity) / 100));
  document.body.dataset.align = look.align === "top" ? "top" : "bottom";
  document.body.dataset.showPlatform = look.showPlatform === false ? "false" : "true";
  document.body.dataset.showTime = look.showTime === false ? "false" : "true";
  document.body.dataset.fade = look.fade === false ? "false" : "true";
  trimOverlay();
}

function paintPreview() {
  const now = Date.now();
  const examples = [
    ["twitch", "keks", "привет с твича"],
    ["youtube", "Маша", "а на ютубе слышно?"],
    ["kick", "rain", "кик тоже здесь"],
    ["vk", "вова", "вк на связи"],
  ];
  examples.forEach(([platform, author, text], index) => {
    upsert({
      id: `preview-${index}`,
      platform,
      author,
      displayAuthor: author,
      text,
      safeHtml: text,
      overlay: true,
      at: now,
    });
  });
}

function stickToBottom() {
  const distance = log.scrollHeight - log.scrollTop - log.clientHeight;
  if (distance < 80) log.scrollTop = log.scrollHeight;
}

function buildLamps() {
  const host = document.getElementById("lamps");
  for (const [platform, short, color] of [
    ["twitch", "TW", "#a970ff"],
    ["youtube", "YT", "#ff3b30"],
    ["kick", "KK", "#3dff7a"],
    ["vk", "VK", "#2787f5"],
  ]) {
    const card = document.createElement("div");
    card.className = "lamp-card";
    card.dataset.platform = platform;
    const lamp = document.createElement("i");
    lamp.className = "lamp";
    lamp.style.color = color;
    const name = document.createElement("span");
    name.textContent = short;
    card.append(lamp, name);
    host.append(card);
  }
}

function setLamp(platform, status) {
  const card = document.querySelector(`.lamp-card[data-platform="${platform}"]`);
  if (!card) return;
  const lamp = card.querySelector(".lamp");
  lamp.dataset.state = status.state;
  card.title = status.detail || "";
}

function ensureEmpty() {
  if (log.querySelector(".strip")) return;
  const empty = document.createElement("p");
  empty.className = "empty";
  empty.id = "empty";
  empty.textContent = "Пока тихо. Сначала «Войти», потом «Проверить». Ник меняется кликом по имени.";
  log.append(empty);
}

let editing = null;

function openNick(message) {
  editing = message;
  const form = document.getElementById("nick");
  form.hidden = false;
  document.getElementById("nick-label").textContent = `Ник для ${message.author}`;
  const input = document.getElementById("nick-input");
  input.value = message.displayAuthor || message.author;
  input.focus();
  input.select();
}

document.getElementById("nick")?.addEventListener("submit", (event) => {
  event.preventDefault();
  saveNick(document.getElementById("nick-input").value);
});

document.getElementById("nick-reset")?.addEventListener("click", () => saveNick(""));

async function saveNick(display) {
  if (!editing) return;
  const response = await fetch("/api/alias", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ personKey: editing.personKey, display }),
  });
  if (!response.ok) return;
  document.getElementById("nick").hidden = true;
  editing = null;
}

function usableColor(color, fallback) {
  if (!/^#[0-9a-fA-F]{6}$/.test(color || "")) return fallback;
  const value = Number.parseInt(color.slice(1), 16);
  const red = (value >> 16) & 255;
  const green = (value >> 8) & 255;
  const blue = value & 255;
  if (red + green + blue < 90) return fallback;
  return color;
}

void socket;
