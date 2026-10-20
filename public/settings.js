const config = await fetch("/api/config").then((response) => response.json());
const origin = `${location.protocol}//${location.host}`;
const dockUrl = `${origin}/dock`;
const overlayUrl = `${origin}/overlay`;
document.getElementById("url-dock").textContent = dockUrl;
document.getElementById("url-overlay").textContent = overlayUrl;

document.getElementById("twitch-channel").value = config.twitch.channel || "";
document.getElementById("youtube-handle").value = config.youtube.handle || "";
document.getElementById("kick-channel").value = config.kick.channel || "";
document.getElementById("vk-channel").value = config.vk.channel || "";

document.getElementById("copy-dock").addEventListener("click", () => copy(dockUrl, "copy-dock"));
document.getElementById("copy-overlay").addEventListener("click", () => copy(overlayUrl, "copy-overlay"));
document.getElementById("connect").addEventListener("click", connect);

async function connect() {
  const button = document.getElementById("connect");
  button.disabled = true;
  button.textContent = "Подключаю...";
  try {
    const response = await fetch("/api/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        twitch: { channel: value("twitch-channel") },
        youtube: { handle: value("youtube-handle") },
        kick: { channel: value("kick-channel") },
        vk: { channel: value("vk-channel") },
      }),
    });
    if (!response.ok) throw new Error("Не сохранилось");
    banner("Ники сохранены. Чат трансляции подключается. Открой «К чату».");
    button.textContent = "Подключить чаты";
  } catch {
    banner("Чат не ответил. Проверь, что чёрное окно start.bat ещё открыто.");
    button.textContent = "Подключить чаты";
  } finally {
    button.disabled = false;
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

function value(id) {
  return document.getElementById(id).value.trim();
}

function banner(text) {
  const node = document.getElementById("banner");
  node.hidden = false;
  node.textContent = text;
}
