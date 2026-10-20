import crypto from "node:crypto";

const kickStates = new Map();

export function redirectUri(platform) {
  const port = Number(process.env.PORT) || 3921;
  const host = platform === "twitch" ? "localhost" : "127.0.0.1";
  return `http://${host}:${port}/oauth/${platform}`;
}

export function startUrl(platform, config) {
  const uri = redirectUri(platform);
  if (platform === "twitch") {
    if (!config.twitch.clientId) return { error: "Сначала впиши Client ID Twitch и нажми «Сохранить»." };
    const url = new URL("https://id.twitch.tv/oauth2/authorize");
    url.searchParams.set("client_id", config.twitch.clientId);
    url.searchParams.set("redirect_uri", uri);
    url.searchParams.set("response_type", "token");
    url.searchParams.set("scope", "chat:read chat:edit moderator:manage:banned_users");
    return { url };
  }
  if (platform === "youtube") {
    if (!config.youtube.clientId || !config.youtube.clientSecret) {
      return { error: "Сначала впиши Client ID и Client Secret YouTube и нажми «Сохранить»." };
    }
    const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    url.searchParams.set("client_id", config.youtube.clientId);
    url.searchParams.set("redirect_uri", uri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("access_type", "offline");
    url.searchParams.set("prompt", "consent");
    url.searchParams.set("scope", "https://www.googleapis.com/auth/youtube.force-ssl");
    return { url };
  }
  if (platform === "kick") {
    if (!config.kick.clientId || !config.kick.clientSecret) {
      return { error: "Сначала впиши Client ID и Client Secret Kick и нажми «Сохранить»." };
    }
    const verifier = crypto.randomBytes(32).toString("base64url");
    const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
    const state = crypto.randomBytes(16).toString("base64url");
    kickStates.set(state, verifier);
    const url = new URL("https://id.kick.com/oauth/authorize");
    url.searchParams.set("redirect", "127.0.0.1");
    url.searchParams.set("response_type", "code");
    url.searchParams.set("client_id", config.kick.clientId);
    url.searchParams.set("redirect_uri", uri);
    url.searchParams.set("scope", "user:read chat:write channel:read moderation:ban");
    url.searchParams.set("code_challenge", challenge);
    url.searchParams.set("code_challenge_method", "S256");
    url.searchParams.set("state", state);
    return { url };
  }
  if (platform === "vk") {
    if (!config.vk.clientId) return { error: "Сначала впиши Client ID VK Видео и нажми «Сохранить»." };
    const url = new URL("https://auth.live.vkvideo.ru/app/oauth2/authorize");
    url.searchParams.set("client_id", config.vk.clientId);
    url.searchParams.set("redirect_uri", uri);
    url.searchParams.set("response_type", "token");
    return { url };
  }
  return { error: "Неизвестная площадка" };
}

export function bridgePage(platform) {
  return `<!doctype html>
<meta charset="utf-8">
<title>Вход</title>
<p style="font-family: Segoe UI, sans-serif">Сохраняю вход…</p>
<script>
const hash = new URLSearchParams(location.hash.slice(1));
const accessToken = hash.get("access_token");
const error = hash.get("error") || new URLSearchParams(location.search).get("error");
if (error || !accessToken) {
  document.body.textContent = error ? "Вход отменён." : "Площадка не вернула токен. Проверь redirect в кабинете приложения.";
} else {
  fetch("/api/oauth/store", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      platform: ${JSON.stringify(platform)},
      accessToken,
      refreshToken: hash.get("refresh_token") || "",
      expiresIn: hash.get("expires_in") || ""
    })
  }).then((response) => {
    if (!response.ok) throw new Error("save");
    location.href = "/settings?connected=" + ${JSON.stringify(platform)};
  }).catch(() => {
    document.body.textContent = "Токен пришёл, но сохранить его не вышло.";
  });
}
</script>`;
}

export async function exchangeCode(platform, query, config) {
  if (query.error) return { error: "Вход отменён." };
  if (!query.code) return { error: "В ответе нет кода." };
  if (platform === "youtube") return exchangeYouTube(query.code, config);
  if (platform === "kick") return exchangeKick(query, config);
  return { error: "Эта площадка входит через другое окно." };
}

async function exchangeYouTube(code, config) {
  const body = new URLSearchParams({
    code,
    client_id: config.youtube.clientId,
    client_secret: config.youtube.clientSecret,
    redirect_uri: redirectUri("youtube"),
    grant_type: "authorization_code",
  });
  const response = await fetch("https://oauth2.googleapis.com/token", { method: "POST", body });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) return { error: json.error_description || "Google не выдал токен." };
  return {
    patch: {
      youtube: {
        accessToken: json.access_token,
        refreshToken: json.refresh_token || config.youtube.refreshToken,
        expiresAt: Date.now() + (json.expires_in || 3600) * 1000,
      },
    },
  };
}

async function exchangeKick(query, config) {
  const verifier = kickStates.get(query.state);
  kickStates.delete(query.state);
  if (!verifier) return { error: "Сессия входа Kick протухла. Нажми «Войти через Kick» ещё раз." };
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: query.code,
    client_id: config.kick.clientId,
    client_secret: config.kick.clientSecret,
    redirect_uri: redirectUri("kick"),
    code_verifier: verifier,
  });
  const response = await fetch("https://id.kick.com/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) return { error: json.message || json.error || "Kick не выдал токен." };
  return {
    patch: {
      kick: {
        accessToken: json.access_token,
        refreshToken: json.refresh_token || "",
        expiresAt: Date.now() + (json.expires_in || 3600) * 1000,
      },
    },
  };
}

export function implicitPatch(platform, body) {
  const expiresAt = body.expiresIn ? Date.now() + Number(body.expiresIn) * 1000 : 0;
  if (platform === "twitch") return { twitch: { oauthToken: body.accessToken } };
  if (platform === "vk") {
    return {
      vk: {
        accessToken: body.accessToken,
        refreshToken: body.refreshToken || undefined,
        expiresAt: expiresAt || undefined,
      },
    };
  }
  return null;
}
