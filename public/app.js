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
let pinned = true;
if (mode === "dock") {
  log.addEventListener("wheel", (event) => {
    if (event.deltaY < 0) pinned = false;
    else pinned = log.scrollHeight - log.scrollTop - log.clientHeight < 64;
  }, { passive: true });
}
if (!preview) setInterval(() => { catchUp().catch(() => {}); }, 1000);
if (mode === "overlay") {
  fitFrame();
  window.addEventListener("resize", fitFrame);
}

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
      byId.clear();
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
  byId.set(message.id, message);
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
  const time = document.createElement("time");
  time.dateTime = new Date(message.at).toISOString();
  time.textContent = new Date(message.at).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
  const shown = mode === "overlay" ? message.author : (message.displayAuthor || message.author);
  head.append(plat);
  const person = document.createElement("span");
  person.className = "person";
  person.append(avatarNode(message));
  if (mode === "dock" && editingKey === message.personKey) {
    person.append(nickEditor(message));
  } else {
    const author = document.createElement(mode === "dock" ? "button" : "span");
    if (mode === "dock") author.type = "button";
    author.className = "author";
    author.textContent = shown;
    author.style.color = usableColor(message.color, meta.color);
    if (mode === "dock") author.addEventListener("click", () => openNick(message));
    person.append(author);
  }
  head.append(person);
  if (mode === "dock" && message.platform !== "local") {
    head.append(modButton(message, "timeout", "Мут"));
    head.append(modButton(message, "ban", "Бан"));
  }
  head.append(time);
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
  const strips = () => [...log.querySelectorAll(".strip")];
  let visible = strips();
  while (visible.length > overlayLimit) {
    dropStrip(visible[0]);
    visible = strips();
  }
  if (log.clientHeight > 0) {
    while (log.scrollHeight > log.clientHeight + 1 && strips().length > 1) {
      dropStrip(strips()[0]);
    }
  }
  fadeOverlay();
}

function dropStrip(node) {
  const id = [...rows.entries()].find(([, item]) => item === node)?.[0];
  if (id) rows.delete(id);
  node.remove();
}

function fitFrame() {
  const portrait = window.innerHeight > window.innerWidth;
  const tight = window.innerHeight <= 220;
  document.body.dataset.frame = portrait ? "portrait" : "wide";
  document.body.dataset.tight = tight ? "true" : "false";
  trimOverlay();
}

async function catchUp() {
  const response = await fetch("/api/state");
  if (!response.ok) return;
  const state = await response.json();
  for (const message of state.messages || []) {
    if (!rows.has(message.id)) upsert(message);
  }
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
  if (mode !== "dock" || !pinned) return;
  const jump = () => {
    log.scrollTop = log.scrollHeight;
  };
  jump();
  requestAnimationFrame(jump);
  setTimeout(jump, 60);
  setTimeout(jump, 240);
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
  empty.textContent = "Пока тихо. Ник для себя меняется кликом по имени, на стриме он останется настоящим.";
  log.append(empty);
}

const byId = new Map();
let editingKey = "";

function modButton(message, action, label) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "mod";
  button.textContent = label;
  button.addEventListener("click", async () => {
    const previous = button.textContent;
    button.disabled = true;
    button.textContent = "...";
    try {
      const response = await fetch("/api/mod", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          platform: message.platform,
          author: message.author,
          authorId: message.authorId || "",
          action,
          seconds: 600,
        }),
      });
      const body = await response.json().catch(() => ({}));
      button.textContent = response.ok ? "ок" : "нет";
      button.title = body.error || (response.ok ? "готово" : "не вышло");
    } catch {
      button.textContent = "нет";
      button.title = "чат не ответил";
    }
    setTimeout(() => {
      button.disabled = false;
      button.textContent = previous;
    }, 1800);
  });
  return button;
}

function avatarNode(message) {
  const url = String(message.avatar || "");
  if (/^https:\/\//.test(url)) {
    const img = document.createElement("img");
    img.className = "avatar";
    img.alt = "";
    img.referrerPolicy = "no-referrer";
    img.src = url;
    return img;
  }
  const letter = document.createElement("span");
  letter.className = "avatar letter";
  letter.textContent = String(message.author || "?").replace(/^@/, "").slice(0, 1).toUpperCase();
  return letter;
}

function nickEditor(message) {
  const form = document.createElement("form");
  form.className = "nick-inline";
  const input = document.createElement("input");
  input.id = "nick-input";
  input.maxLength = 40;
  input.autocomplete = "off";
  input.value = message.displayAuthor || message.author;
  input.setAttribute("aria-label", `Ник для ${message.author}, только в этом окне`);
  const save = document.createElement("button");
  save.type = "submit";
  save.textContent = "Ок";
  const reset = document.createElement("button");
  reset.type = "button";
  reset.className = "ghost";
  reset.textContent = "Сброс";
  const hint = document.createElement("span");
  hint.className = "nick-hint";
  hint.textContent = "на стриме не меняется";
  reset.addEventListener("click", () => saveNick(""));
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    saveNick(input.value);
  });
  form.append(input, save, reset, hint);
  queueMicrotask(() => {
    input.focus();
    input.select();
  });
  return form;
}

function openNick(message) {
  const previous = editingKey;
  editingKey = message.personKey;
  if (previous && previous !== message.personKey) {
    for (const stored of byId.values()) {
      if (stored.personKey !== previous) continue;
      const row = rows.get(stored.id);
      if (row) fill(row, stored);
    }
  }
  const row = rows.get(message.id);
  if (row) fill(row, message);
}

async function saveNick(display) {
  const personKey = editingKey;
  editingKey = "";
  if (!personKey) return;
  const response = await fetch("/api/alias", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ personKey, display }),
  });
  if (!response.ok) return;
  for (const stored of byId.values()) {
    if (stored.personKey !== personKey) continue;
    const row = rows.get(stored.id);
    if (row) fill(row, stored);
  }
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
