import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import { slug } from "./config.js";
import { readCookiesFromBrowsers, readVkFromBrowsers } from "./yandex-profile.js";

const PAGES = {
  twitch: "https://www.twitch.tv/",
  youtube: "https://www.youtube.com/",
  kick: "https://kick.com/",
  vk: "https://live.vkvideo.ru/",
};

export function openLoginTab(platform) {
  return PAGES[platform] || "";
}

export async function finishLogin(platform) {
  const pageUrl = PAGES[platform];
  if (!pageUrl) throw new Error("Неизвестная площадка");
  openDefaultBrowser(pageUrl);
  await new Promise((resolve) => setTimeout(resolve, 1200));
  const cookies = readCookiesFromBrowsers(hostsFor(platform));
  if (platform === "twitch") return finishTwitch(cookies);
  if (platform === "youtube") return finishYouTube(cookies);
  if (platform === "kick") return finishKick(cookies);
  if (platform === "vk") return finishVk(readVkFromBrowsers());
  throw new Error("Неизвестная площадка");
}

function openDefaultBrowser(url) {
  const exe = foregroundBrowser();
  const child = exe
    ? spawn(exe, [url], { detached: true, stdio: "ignore", windowsHide: true })
    : spawn("cmd", ["/c", "start", "", url], { detached: true, stdio: "ignore", windowsHide: true });
  child.unref();
}

function foregroundBrowser() {
  const script = `
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class RundelFore {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
}
'@
$hwnd = [RundelFore]::GetForegroundWindow()
$procId = [uint32]0
[void][RundelFore]::GetWindowThreadProcessId($hwnd, [ref]$procId)
$names = @('chrome','msedge','browser')
$running = Get-CimInstance Win32_Process | Where-Object { $_.Name -match '^(chrome|msedge|browser)\\.exe$' }
$front = $running | Where-Object { $_.ProcessId -eq $procId } | Select-Object -First 1
$pick = if ($front) { $front } else { $running | Select-Object -First 1 }
if ($pick) { [Console]::Out.Write($pick.ExecutablePath) }
`;
  try {
    const output = execFileSync("powershell", ["-NoProfile", "-Command", script], { encoding: "utf8" }).trim();
    return output && fs.existsSync(output) ? output : "";
  } catch {
    return "";
  }
}

function hostsFor(platform) {
  if (platform === "twitch") return ["twitch.tv"];
  if (platform === "youtube") return ["youtube.com", "google.com"];
  if (platform === "kick") return ["kick.com"];
  return ["vkvideo.ru", "vk.com"];
}

async function finishTwitch(cookies) {
  const token = cookieValue(cookies, "auth-token");
  if (!token) {
    throw new Error("В открытом браузере нет входа Twitch. Зайди на twitch.tv там, где уже есть аккаунт, и нажми Войти ещё раз.");
  }
  const response = await fetch("https://id.twitch.tv/oauth2/validate", {
    headers: { Authorization: `OAuth ${token}` },
  });
  if (!response.ok) throw new Error("Twitch не принял этот аккаунт. Нажми Войти ещё раз.");
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

async function finishYouTube(cookies) {
  if (!cookies.some((cookie) => cookie.name === "SAPISID" || cookie.name === "__Secure-3PAPISID")) {
    throw new Error("В открытом браузере нет входа YouTube. Зайди на youtube.com там, где уже есть аккаунт, и нажми Войти ещё раз.");
  }
  const channelId = await youtubeChannelId(cookies);
  if (!channelId) throw new Error("YouTube не показал канал. Открой свой канал на YouTube и нажми Войти ещё раз.");
  return {
    youtube: {
      channelId,
      cookies: JSON.stringify(cookies.map(plainCookie)),
      displayName: channelId,
    },
  };
}

async function finishKick(cookies) {
  if (!cookies.length) {
    throw new Error("В открытом браузере нет входа Kick. Зайди на kick.com там, где уже есть аккаунт, и нажми Войти ещё раз.");
  }
  const headers = {
    cookie: cookieHeader(cookies),
    accept: "application/json",
    "user-agent": agent(),
  };
  const userResponse = await fetch("https://kick.com/api/v1/user", { headers });
  if (!userResponse.ok) throw new Error("Kick не показал аккаунт. Нажми Войти ещё раз.");
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

async function finishVk(auth) {
  if (auth?.vkAuth) auth = auth.vkAuth;
  if (auth?.auth) auth = auth.auth;
  if (auth?.access_token && !auth.accessToken) auth = { ...auth, accessToken: auth.access_token };
  if (!auth?.accessToken) {
    throw new Error("В открытом браузере нет входа VK. Зайди на live.vkvideo.ru там, где уже есть аккаунт, и нажми Войти ещё раз.");
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
  for (const url of ["https://www.youtube.com/", "https://studio.youtube.com/"]) {
    const response = await fetch(url, { headers, redirect: "follow" });
    const html = await response.text();
    const channelId = response.url.match(/channel\/(UC[\w-]+)/)?.[1]
      || html.match(/"externalId":"(UC[\w-]+)"/)?.[1]
      || html.match(/"channelId":"(UC[\w-]+)"/)?.[1];
    if (channelId) return channelId;
  }
  return "";
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
