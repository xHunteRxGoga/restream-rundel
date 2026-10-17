import { slug } from "./config.js";
import { grabSession } from "./yandex-cdp.js";

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
  const session = await grabSession(platform, pageUrl);
  if (platform === "twitch") return finishTwitch(session.cookies);
  if (platform === "youtube") return finishYouTube(session.cookies);
  if (platform === "kick") return finishKick(session.cookies);
  if (platform === "vk") return finishVk(session);
  throw new Error("Неизвестная площадка");
}

async function finishTwitch(cookies) {
  const token = cookieValue(cookies, "auth-token");
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

async function finishYouTube(cookies) {
  if (!cookies.some((cookie) => cookie.name === "SAPISID" || cookie.name === "__Secure-3PAPISID")) {
    throw new Error("Во вкладке YouTube не видно входа. Открой нужный аккаунт и нажми «Это я» ещё раз.");
  }
  const channelId = await youtubeChannelId(cookies);
  if (!channelId) throw new Error("YouTube не показал канал. На вкладке должен быть открыт твой аккаунт, потом снова «Это я».");
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

async function finishVk(session) {
  let auth = session.vkAuth;
  if (auth?.auth) auth = auth.auth;
  if (auth?.access_token && !auth.accessToken) auth = { ...auth, accessToken: auth.access_token };
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
