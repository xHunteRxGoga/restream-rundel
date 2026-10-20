const config = await fetch("/api/config").then((response) => response.json());
const origin = `${location.protocol}//${location.host}`;
const dockUrl = `${origin}/dock`;
const overlayUrl = `${origin}/overlay`;
document.getElementById("url-dock").textContent = dockUrl;
document.getElementById("url-overlay").textContent = overlayUrl;

document.getElementById("copy-dock").addEventListener("click", () => copy(dockUrl, "copy-dock"));
document.getElementById("copy-overlay").addEventListener("click", () => copy(overlayUrl, "copy-overlay"));
for (const platform of ["twitch", "youtube", "kick", "vk"]) {
  document.getElementById(`login-${platform}`).addEventListener("click", () => login(platform));
  const who = document.getElementById(`who-${platform}`);
  const name = accountName(platform, config);
  who.textContent = name ? `Вошёл: ${name}` : "Ещё не вошёл";
}

async function login(platform) {
  const button = document.getElementById(`login-${platform}`);
  const previous = button.textContent;
  button.disabled = true;
  button.textContent = "Подключаю аккаунт...";
  banner("Яндекс сейчас закроется и откроется снова с твоими аккаунтами. Подожди, страницу не закрывай.");
  try {
    const response = await fetch(`/api/login/${platform}`, { method: "POST" });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      banner(body.error || "Вход не удался.");
      button.disabled = false;
      button.textContent = previous;
      return;
    }
    location.reload();
  } catch {
    banner("Чат не ответил. Проверь, что чёрное окно start.bat ещё открыто.");
    button.disabled = false;
    button.textContent = previous;
  }
}

function accountName(platform, config) {
  if (platform === "twitch") return config.twitch.login || config.twitch.channel || "";
  if (platform === "youtube") return config.youtube.displayName || config.youtube.handle || "";
  if (platform === "kick") return config.kick.channel || "";
  return config.vk.displayName || config.vk.channel || "";
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
