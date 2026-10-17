const config = await fetch("/api/config").then((response) => response.json());
const origin = `${location.protocol}//${location.host}`;
const dockUrl = `${origin}/dock`;
const overlayUrl = `${origin}/overlay`;
document.getElementById("url-dock").textContent = dockUrl;
document.getElementById("url-overlay").textContent = overlayUrl;

showWho("twitch", config.twitch.oauthToken ? config.twitch.login || "вошёл" : "");
showWho("youtube", config.youtube.cookies || config.youtube.refreshToken ? "вошёл" : "");
showWho("kick", config.kick.cookies || config.kick.accessToken ? config.kick.channel || "вошёл" : "");
showWho("vk", config.vk.accessToken ? config.vk.displayName || config.vk.channel || "вошёл" : "");

document.getElementById("copy-dock").addEventListener("click", () => copy(dockUrl, "copy-dock"));
document.getElementById("copy-overlay").addEventListener("click", () => copy(overlayUrl, "copy-overlay"));

for (const platform of ["twitch", "youtube", "kick", "vk"]) {
  document.getElementById(`login-${platform}`).addEventListener("click", () => login(platform));
}

for (const button of document.querySelectorAll("[data-clear]")) {
  button.addEventListener("click", () => logout(button.dataset.clear.split(",")));
}

async function login(platform) {
  const button = document.getElementById(`login-${platform}`);
  const previous = button.textContent;
  button.disabled = true;
  button.textContent = "Открываю Яндекс...";
  banner("Яндекс на секунду закроется и откроется снова с твоими аккаунтами. Чат заберёт вход сам.");
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
  }
}

async function logout(clear) {
  const response = await fetch("/api/config", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ clear }),
  });
  if (response.ok) location.reload();
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

function showWho(platform, name) {
  const node = document.getElementById(`who-${platform}`);
  node.textContent = name ? `Вошёл: ${name}` : "Ещё не вошёл";
}

function banner(text) {
  const node = document.getElementById("banner");
  node.hidden = false;
  node.textContent = text;
}
