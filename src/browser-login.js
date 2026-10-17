import fs from "node:fs";
import path from "node:path";
import { slug } from "./config.js";

const LOGIN_MS = 180000;

export async function loginWithBrowser({ root, platform }) {
  let chromium;
  try {
    ({ chromium } = await import("playwright"));
  } catch {
    throw new Error("Окно входа не поставилось. Закрой чат и запусти start.bat ещё раз.");
  }

  const profile = path.join(root, "data", "browser", platform);
  const executablePath = findYandexBrowser();
  if (!executablePath) {
    throw new Error("Не нашёл Яндекс Браузер. Поставь его с https://browser.yandex.ru и нажми вход ещё раз.");
  }
  console.log(`Открываю Яндекс Браузер: ${executablePath}`);
  let context;
  try {
    context = await chromium.launchPersistentContext(profile, {
      executablePath,
      headless: false,
      viewport: { width: 1100, height: 800 },
      locale: "ru-RU",
      args: ["--no-first-run", "--no-default-browser-check"],
    });
  } catch {
    throw new Error("Яндекс Браузер не открылся. Закрой его окно входа, если оно уже висит, и нажми ещё раз.");
  }

  try {
    const page = context.pages()[0] || await context.newPage();
    if (platform === "twitch") return await loginTwitch(context, page);
    if (platform === "youtube") return await loginYouTube(context, page);
    if (platform === "kick") return await loginKick(context, page);
    if (platform === "vk") return await loginVk(page);
    throw new Error("Неизвестная площадка");
  } finally {
    await context.close().catch(() => {});
  }
}

async function loginTwitch(context, page) {
  await page.goto("https://www.twitch.tv/login", { waitUntil: "domcontentloaded" });
  const token = await waitFor(context, async () => {
    const cookies = await context.cookies("https://www.twitch.tv");
    return cookies.find((cookie) => cookie.name === "auth-token")?.value || "";
  });
  const response = await fetch("https://id.twitch.tv/oauth2/validate", {
    headers: { Authorization: `OAuth ${token}` },
  });
  if (!response.ok) throw new Error("Twitch не принял вход. Нажми ещё раз.");
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

async function loginYouTube(context, page) {
  await page.goto("https://studio.youtube.com/", { waitUntil: "domcontentloaded" });
  await page.waitForURL(/studio\.youtube\.com\/channel\/UC[\w-]+/, { timeout: LOGIN_MS }).catch(() => {
    throw new Error("Вход в YouTube не закончился.");
  });
  const channelId = page.url().match(/channel\/(UC[\w-]+)/)?.[1] || "";
  if (!channelId) throw new Error("YouTube не показал канал.");
  const cookies = await context.cookies(["https://www.youtube.com", "https://www.google.com"]);
  if (!cookies.some((cookie) => cookie.name === "SAPISID" || cookie.name === "__Secure-3PAPISID")) {
    throw new Error("YouTube не закончил вход. Нажми ещё раз.");
  }
  return {
    youtube: {
      channelId,
      cookies: JSON.stringify(cookies.map(plainCookie)),
      displayName: channelId,
    },
  };
}

async function loginKick(context, page) {
  await page.goto("https://kick.com/login", { waitUntil: "domcontentloaded" });
  const user = await waitFor(context, async () => page.evaluate(async () => {
    const response = await fetch("https://kick.com/api/v1/user", { credentials: "include" });
    if (!response.ok) return null;
    return response.json();
  }).catch(() => null));
  const name = user.username || user.slug || "";
  if (!name) throw new Error("Kick не показал аккаунт.");
  const channel = await page.evaluate(async (channelName) => {
    const response = await fetch(`https://kick.com/api/v2/channels/${channelName}`, { credentials: "include" });
    if (!response.ok) return null;
    return response.json();
  }, name).catch(() => null);
  const cookies = await context.cookies("https://kick.com");
  return {
    kick: {
      channel: String(name).toLowerCase(),
      username: String(name).toLowerCase(),
      broadcasterUserId: String(user.id || channel?.user_id || ""),
      chatroomId: String(channel?.chatroom?.id || ""),
      cookies: JSON.stringify(cookies.map(plainCookie)),
    },
  };
}

async function loginVk(page) {
  await page.goto("https://live.vkvideo.ru/", { waitUntil: "domcontentloaded" });
  const raw = await page.waitForFunction(() => {
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      const value = localStorage.getItem(key) || "";
      if (value.includes("accessToken")) return value;
    }
    return "";
  }, { timeout: LOGIN_MS }).then((handle) => handle.jsonValue()).catch(() => "");
  if (!raw) throw new Error("Вход во VK не закончился.");
  let auth = {};
  try {
    auth = JSON.parse(raw);
    if (auth.auth) auth = auth.auth;
  } catch {
    throw new Error("VK вернул странный вход. Нажми ещё раз.");
  }
  const token = auth.accessToken || auth.access_token || "";
  if (!token) throw new Error("VK не отдал вход. Нажми ещё раз.");
  const response = await fetch("https://api.live.vkvideo.ru/v1/user/current", {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      ...(auth.clientId ? { "X-From-Id": auth.clientId } : {}),
    },
  });
  const user = response.ok ? await response.json().catch(() => ({})) : {};
  const data = user.data || user.user || user;
  const channel = slug(data.blogUrl || data.blog_url || data.channel?.url || data.url || data.nick || "");
  return {
    vk: {
      accessToken: token,
      refreshToken: auth.refreshToken || auth.refresh_token || "",
      clientId: auth.clientId || "",
      expiresAt: Number(auth.expiresAt) || 0,
      displayName: data.displayName || data.nick || "",
      userId: String(data.id || data.userId || ""),
      channel,
    },
  };
}

async function waitFor(context, read) {
  const started = Date.now();
  while (Date.now() - started < LOGIN_MS) {
    if (!context.pages().length) throw new Error("Окно входа закрыли слишком рано.");
    const value = await read();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error("Вход не закончился. Нажми кнопку ещё раз.");
}

function plainCookie(cookie) {
  return { name: cookie.name, value: cookie.value, domain: cookie.domain };
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
