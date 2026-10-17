const config = await fetch("/api/config").then((response) => response.json());
const state = await fetch("/api/state").then((response) => response.json());

const fields = {
  "twitch-channel": config.twitch.channel,
  "twitch-client": config.twitch.clientId,
  "youtube-client": config.youtube.clientId,
  "kick-channel": config.kick.channel,
  "kick-room": config.kick.chatroomId,
  "kick-client": config.kick.clientId,
  "vk-channel": config.vk.channel,
  "vk-client": config.vk.clientId,
};

for (const [id, value] of Object.entries(fields)) {
  const input = document.getElementById(id);
  if (input) input.value = value || "";
}
document.getElementById("bots").value = (config.bots || []).join(", ");

hint("twitch-token-hint", config.twitch.oauthToken, "Токен Twitch уже сохранён. Новое поле заменит его.");
hint("youtube-secret-hint", config.youtube.clientSecret, "Секрет уже сохранён. Новое поле заменит его.");
hint("kick-token-hint", config.kick.accessToken, "Токен Kick уже сохранён. Новое поле заменит его.");
hint("vk-token-hint", config.vk.accessToken, "Токен VK уже сохранён. Новое поле заменит его.");

for (const platform of ["twitch", "youtube", "kick", "vk"]) {
  const code = document.getElementById(`redirect-${platform}`);
  if (code) code.textContent = state.redirects?.[platform] || "";
  const status = state.statuses?.[platform];
  const line = document.getElementById(`status-${platform}`);
  if (line && status) line.textContent = status.detail || status.state;
}

const origin = `${location.protocol}//${location.host}`;
document.getElementById("url-dock").textContent = `${origin}/dock`;
document.getElementById("url-overlay").textContent = `${origin}/overlay`;

const connected = new URLSearchParams(location.search).get("connected");
if (connected) {
  const banner = document.getElementById("banner");
  banner.hidden = false;
  banner.textContent = `${label(connected)} подключён. Можно возвращаться к чату.`;
}

document.getElementById("save").addEventListener("click", () => save());
document.getElementById("twitch-login").addEventListener("click", () => login("twitch"));
document.getElementById("youtube-login").addEventListener("click", () => login("youtube"));
document.getElementById("kick-login").addEventListener("click", () => login("kick"));
document.getElementById("vk-login").addEventListener("click", () => login("vk"));

for (const button of document.querySelectorAll("[data-clear]")) {
  button.addEventListener("click", async () => {
    await save({ clear: button.dataset.clear.split(",") });
    location.reload();
  });
}

async function login(platform) {
  await save();
  location.href = `/oauth/${platform}/start`;
}

async function save(extra = {}) {
  const body = {
    twitch: {
      channel: value("twitch-channel"),
      clientId: value("twitch-client"),
      oauthToken: value("twitch-token"),
    },
    youtube: {
      clientId: value("youtube-client"),
      clientSecret: value("youtube-secret"),
    },
    kick: {
      channel: value("kick-channel"),
      chatroomId: value("kick-room"),
      clientId: value("kick-client"),
      clientSecret: value("kick-secret"),
      accessToken: value("kick-token"),
    },
    vk: {
      channel: value("vk-channel"),
      clientId: value("vk-client"),
      accessToken: value("vk-token"),
      refreshToken: value("vk-refresh"),
    },
    bots: value("bots").split(/[,\n]/).map((name) => name.trim()).filter(Boolean),
    clear: extra.clear || [],
  };
  const response = await fetch("/api/config", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error("Не сохранилось");
  if (!extra.clear) {
    const banner = document.getElementById("banner");
    banner.hidden = false;
    banner.textContent = "Сохранено. Лампы в чате обновятся сами.";
  }
}

function value(id) {
  return document.getElementById(id).value.trim();
}

function hint(id, filled, text) {
  const node = document.getElementById(id);
  if (filled) node.textContent = text;
}

function label(platform) {
  return { twitch: "Twitch", youtube: "YouTube", kick: "Kick", vk: "VK" }[platform] || platform;
}
