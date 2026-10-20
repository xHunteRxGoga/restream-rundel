import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createHub } from "./hub.js";
import { createConfigStore, ownIds, ownNames } from "./config.js";
import { createConnectors } from "./connectors/index.js";
import { createApp } from "./server.js";
import { PLATFORMS } from "./platforms.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const configPath = process.env.CONFIG_PATH || path.join(root, "data", "config.json");
const store = createConfigStore(configPath);
const hub = createHub();
const statuses = Object.fromEntries(PLATFORMS.map((platform) => [platform, { state: "off", detail: "не настроено" }]));

function syncIdentity() {
  const config = store.get();
  hub.setBots(config.bots);
  hub.setOwnNames(ownNames(config));
  hub.setOwnIds(ownIds(config));
  hub.setAliases(config.aliases);
}

syncIdentity();

let publish = () => {};
const connectors = createConnectors({
  hub,
  getConfig: () => store.get(),
  learn(patch) {
    store.save(patch);
    syncIdentity();
  },
  setStatus(platform, state, detail) {
    statuses[platform] = { state, detail: detail || "" };
    publish({ type: "status", platform, state, detail: detail || "" });
  },
});

const server = createApp({
  root,
  store,
  hub,
  statuses,
  connectors,
  bindPublish(fn) {
    publish = fn;
  },
});

const port = Number(process.env.PORT) || 3921;
const host = "127.0.0.1";

server.listen(port, host, () => {
  const dock = `http://${host}:${port}/dock`;
  console.log(`Все чаты: ${dock}`);
  console.log(`Экран:    http://${host}:${port}/overlay`);
  console.log(`Вход:     http://${host}:${port}/settings`);
  console.log("сборка account-mod");
  const saved = store.get();
  const names = [
    saved.twitch.channel && `Twitch ${saved.twitch.channel}`,
    (saved.youtube.handle || saved.youtube.channelId || saved.youtube.videoId) && `YouTube ${saved.youtube.handle || saved.youtube.channelId || saved.youtube.videoId}`,
    saved.kick.channel && `Kick ${saved.kick.channel}`,
    saved.vk.channel && `VK ${saved.vk.channel}`,
  ].filter(Boolean);
  console.log(names.length ? `Настройки на месте: ${names.join(", ")}` : "Настройки пока пустые. Ссылки вводятся на странице Старт и больше не стираются.");
  connectors.start();
  if (!process.env.NO_OPEN) {
    const config = store.get();
    const signedIn = config.twitch.channel || config.twitch.oauthToken
      || config.youtube.handle || config.youtube.channelId || config.youtube.videoId || config.youtube.cookies || config.youtube.refreshToken
      || config.kick.channel || config.kick.cookies || config.kick.accessToken
      || config.vk.channel || config.vk.accessToken;
    const target = signedIn ? dock : `http://${host}:${port}/settings`;
    spawn("cmd", ["/c", "start", "", target], { detached: true, stdio: "ignore", windowsHide: true }).unref();
  }
});
