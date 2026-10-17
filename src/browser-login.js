import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { slug } from "./config.js";
import { readVkAuthFromProfile, readYandexCookies } from "./yandex-profile.js";

const PAGES = {
  twitch: "https://www.twitch.tv/",
  youtube: "https://studio.youtube.com/",
  kick: "https://kick.com/",
  vk: "https://live.vkvideo.ru/",
};

export function openLoginTab(platform) {
  const executablePath = findYandexBrowser();
  if (!executablePath) {
    throw new Error("Не нашёл Яндекс Браузер. Поставь его с https://browser.yandex.ru и нажми вход ещё раз.");
  }
  const url = PAGES[platform];
  if (!url) throw new Error("Неизвестная площадка");
  const child = spawn(executablePath, [url], { detached: true, stdio: "ignore" });
  child.unref();
  console.log(`Открыл вкладку ${platform} в Яндекс Браузере`);
  return url;
}

export async function finishLogin(platform) {
  if (platform === "twitch") return finishTwitch();
  if (platform === "youtube") return finishYouTube();
  if (platform === "kick") return finishKick();
  if (platform === "vk") return finishVk();
  throw new Error("Неизвестная площадка");
}

async function finishTwitch() {
  const token = cookieValue(readYandexCookies(["twitch.tv"]), "auth-token");
  if (!token) {
    throw new Error("Во вкладке Twitch не видно входа. Открой нужный аккаунт и нажми «Это я» ещё раз.");
  }
  const response = await fetch("https://id.twitch.tv/oauth2/validate", {
    headers: { Authorization: `OAuth ${token}` },
  });
  if (!response.ok) throw new Error("Twitch не принял этот аккаунт. Нажми «Это я» ещё раз.");
  const profile = await response.json();
  const login = String(profile.login || "").toLowerCase();
  return {
    twitch: {
      oauthToken: token,
      login,
      userId: String(profile.user_id || ""),
      channel: login,
    },
  };
}

async function finishYouTube() {
  const cookies = readYandexCookies(["youtube.com", "google.com"]);
  if (!cookies.some((cookie) => cookie.name === "SAPISID" || cookie.name === "__Secure-3PAPISID")) {
    throw new Error("Во вкладке YouTube не видно входа. Открой нужный аккаунт и нажми «Это я» ещё раз.");
  }
  const channelId = await youtubeChannelId(cookies);
  if (!channelId) throw new Error("YouTube не показал канал. Открой свою студию во вкладке и нажми «Это я» ещё раз.");
  return {
    youtube: {
      channelId,
      cookies: JSON.stringify(cookies.map(plainCookie)),
      displayName: channelId,
    },
  };
}

async function finishKick() {
  const cookies = readYandexCookies(["kick.com"]);
  if (!cookies.length) {
    throw new Error("Во вкладке Kick не видно входа. Открой нужный аккаунт и нажми «Это я» ещё раз.");
  }
  const headers = {
    cookie: cookieHeader(cookies),
    accept: "application/json",
    "user-agent": agent(),
  };
  const userResponse = await fetch("https://kick.com/api/v1/user", { headers });
  if (!userResponse.ok) throw new Error("Kick не показал аккаунт. Нажми «Это я» ещё раз.");
  const user = await userResponse.json();
  const name = String(user.username || user.slug || "").toLowerCase();
  if (!name) throw new Error("Kick не показал имя аккаунта.");
  const channelResponse = await fetch(`https://kick.com/api/v2/channels/${name}`, { headers });
  const channel = channelResponse.ok ? await channelResponse.json() : {};
  return {
    kick: {
      channel: name,
      username: name,
      broadcasterUserId: String(user.id || channel.user_id || ""),
      chatroomId: String(channel.chatroom?.id || ""),
      cookies: JSON.stringify(cookies.map(plainCookie)),
    },
  };
}

async function finishVk() {
  const auth = readVkAuthFromProfile();
  if (!auth?.accessToken) {
    throw new Error("Во вкладке VK не видно входа. Открой свой канал на live.vkvideo.ru и нажми «Это я» ещё раз.");
  }
  const response = await fetch("https://api.live.vkvideo.ru/v1/user/current", {
    headers: {
      Authorization: `Bearer ${auth.accessToken}`,
      Accept: "application/json",
      ...(auth.clientId ? { "X-From-Id": auth.clientId } : {}),
    },
  });
  const user = response.ok ? await response.json().catch(() => ({})) : {};
  const data = user.data || user.user || user;
  return {
    vk: {
      accessToken: auth.accessToken,
      refreshToken: auth.refreshToken || "",
      clientId: auth.clientId || "",
      displayName: data.displayName || data.nick || "",
      userId: String(data.id || data.userId || ""),
      channel: slug(data.blogUrl || data.blog_url || data.channel?.url || data.url || data.nick || ""),
    },
  };
}

async function youtubeChannelId(cookies) {
  const headers = { cookie: cookieHeader(cookies), "user-agent": agent(), accept: "text/html" };
  const response = await fetch("https://studio.youtube.com/", { headers, redirect: "follow" });
  const html = await response.text();
  return response.url.match(/channel\/(UC[\w-]+)/)?.[1]
    || html.match(/"channelId":"(UC[\w-]+)"/)?.[1]
    || html.match(/"externalId":"(UC[\w-]+)"/)?.[1]
    || "";
}

function cookieValue(cookies, name) {
  return cookies.find((cookie) => cookie.name === name)?.value || "";
}

function cookieHeader(cookies) {
  return cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join("; ");
}

function plainCookie(cookie) {
  return { name: cookie.name, value: cookie.value, domain: cookie.domain };
}

function agent() {
  return "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
}

function findYandexBrowser() {
  const local = process.env.LOCALAPPDATA || "";
  const roots = [
    path.join(local, "Yandex", "YandexBrowser", "Application", "browser.exe"),
    path.join(process.env.ProgramFiles || "C:\\Program Files", "Yandex", "YandexBrowser", "Application", "browser.exe"),
    path.join(process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)", "Yandex", "YandexBrowser", "Application", "browser.exe"),
  ];
  for (const candidate of roots) {
    if (fs.existsSync(candidate)) return candidate;
    const folder = path.dirname(candidate);
    if (!fs.existsSync(folder)) continue;
    for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const nested = path.join(folder, entry.name, "browser.exe");
      if (fs.existsSync(nested)) return nested;
    }
  }
  return "";
}
