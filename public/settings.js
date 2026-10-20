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
  document.getElementById(`app-${platform}`).value = config[platform].clientId || "";
  document.getElementById(`redir-${platform}`).textContent = redirectFor(platform);
  document.getElementById(`copy-redir-${platform}`).addEventListener("click", () => copy(redirectFor(platform), `copy-redir-${platform}`));
  document.getElementById(`allow-${platform}`).addEventListener("click", () => allow(platform));
  document.getElementById(`auth-${platform}`).textContent = hasAccess(platform, config)
    ? "Доступ есть. Можно писать, мутить и банить."
    : "Доступа ещё нет.";
}
const secretYouTube = document.getElementById("secret-youtube");
const secretKick = document.getElementById("secret-kick");
if (config.youtube.clientSecret) secretYouTube.placeholder = "уже сохранён";
if (config.kick.clientSecret) secretKick.placeholder = "уже сохранён";
const connected = new URLSearchParams(location.search).get("connected");
if (connected) banner(`${nameOf(connected)} разрешил доступ. Он сохранён на этом компьютере и не сотрётся при обновлении.`);

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
        ...appPatch(),
      }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      banner(body.error || "Не сохранилось.");
      return;
    }
    banner("Ссылки сохранены на этом компьютере. Если эфир уже идёт, чат появится в доке и на экране.");
  } catch {
    banner("Чат не ответил. Проверь, что чёрное окно start.bat ещё открыто.");
  } finally {
    button.disabled = false;
    button.textContent = "Подключить чаты";
  }
}

function redirectFor(platform) {
  const port = location.port || "3921";
  const host = platform === "twitch" ? "localhost" : "127.0.0.1";
  return `http://${host}:${port}/oauth/${platform}`;
}

function value(platform) {
  return document.getElementById(`link-${platform}`).value.trim();
}

function appPatch() {
  const patch = { twitch: {}, youtube: {}, kick: {}, vk: {} };
  for (const platform of ["twitch", "youtube", "kick", "vk"]) {
    const id = document.getElementById(`app-${platform}`).value.trim();
    if (id) patch[platform].clientId = id;
  }
  const youtubeSecret = document.getElementById("secret-youtube").value.trim();
  const kickSecret = document.getElementById("secret-kick").value.trim();
  if (youtubeSecret) patch.youtube.clientSecret = youtubeSecret;
  if (kickSecret) patch.kick.clientSecret = kickSecret;
  return patch;
}

async function allow(platform) {
  const button = document.getElementById(`allow-${platform}`);
  button.disabled = true;
  try {
    const response = await fetch("/api/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(appPatch()),
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      banner(body.error || "Номер не сохранился.");
      return;
    }
    window.open(`/oauth/${platform}/start`, "_blank");
    banner("Откроется вкладка площадки. Нажми «Разрешить». После этого доступ останется на этом компьютере.");
  } catch {
    banner("Чат не ответил. Проверь, что чёрное окно start.bat ещё открыто.");
  } finally {
    button.disabled = false;
  }
}

function hasAccess(platform, source) {
  if (platform === "twitch") return Boolean(source.twitch.oauthToken);
  if (platform === "youtube") return Boolean(source.youtube.refreshToken || source.youtube.accessToken);
  if (platform === "kick") return Boolean(source.kick.accessToken);
  return Boolean(source.vk.accessToken);
}

function nameOf(platform) {
  return { twitch: "Twitch", youtube: "YouTube", kick: "Kick", vk: "VK" }[platform] || platform;
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
