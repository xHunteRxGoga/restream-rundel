const config = await fetch("/api/config").then((response) => response.json());
const origin = `${location.protocol}//${location.host}`;
const dockUrl = `${origin}/dock`;
const overlayUrl = `${origin}/overlay`;
document.getElementById("url-dock").textContent = dockUrl;
document.getElementById("url-overlay").textContent = overlayUrl;
document.getElementById("copy-dock").addEventListener("click", () => copy(dockUrl, "copy-dock"));
document.getElementById("copy-overlay").addEventListener("click", () => copy(overlayUrl, "copy-overlay"));
document.getElementById("connect").addEventListener("click", connect);

for (const platform of ["twitch", "youtube", "kick", "vk"]) {
  document.getElementById(`link-${platform}`).value = savedLink(platform, config);
}

const statuses = {};
paint();
const socket = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`);
socket.addEventListener("message", (event) => {
  const data = JSON.parse(event.data);
  if (data.statuses) Object.assign(statuses, data.statuses);
  if (data.type === "status") statuses[data.platform] = { state: data.state, detail: data.detail };
  paint();
});

async function connect() {
  const button = document.getElementById("connect");
  button.disabled = true;
  button.textContent = "Подключаю...";
  banner("Ищу эфиры. Сообщения появятся в доке, когда стрим уже идёт.");
  try {
    const response = await fetch("/api/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        streams: {
          twitch: value("twitch"),
          youtube: value("youtube"),
          kick: value("kick"),
          vk: value("vk"),
        },
      }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      banner(body.error || "Не сохранилось.");
      return;
    }
    banner("Ссылки сохранены. Если эфир уже идёт, чат появится в доке и на экране.");
  } catch {
    banner("Чат не ответил. Проверь, что чёрное окно start.bat ещё открыто.");
  } finally {
    button.disabled = false;
    button.textContent = "Подключить чаты";
  }
}

function value(platform) {
  return document.getElementById(`link-${platform}`).value.trim();
}

function savedLink(platform, source) {
  if (platform === "twitch") return source.twitch.channel || "";
  if (platform === "kick") return source.kick.channel || "";
  if (platform === "vk") return source.vk.channel || "";
  if (source.youtube.handle) return `@${source.youtube.handle}`;
  return source.youtube.channelId || source.youtube.videoId || "";
}

function paint() {
  for (const platform of ["twitch", "youtube", "kick", "vk"]) {
    const status = statuses[platform];
    const node = document.getElementById(`who-${platform}`);
    if (!status) {
      node.textContent = "жду ответ чата";
      continue;
    }
    node.textContent = status.detail || (status.state === "live" ? "чат идёт" : "не подключено");
  }
}

async function copy(text, id) {
  const button = document.getElementById(id);
  await navigator.clipboard.writeText(text);
  const previous = button.textContent;
  button.textContent = "Скопировано";
  setTimeout(() => {
    button.textContent = previous;
  }, 1500);
}

function banner(text) {
  const node = document.getElementById("banner");
  node.hidden = false;
  node.textContent = text;
}
