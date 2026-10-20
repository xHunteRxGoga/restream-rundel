import fs from "node:fs";
import path from "node:path";
import { DEFAULT_BOTS } from "./filter.js";

export function defaultLook() {
  return {
    fontSize: 18,
    nameSize: 14,
    opacity: 62,
    maxMessages: 8,
    align: "bottom",
    showPlatform: true,
    showTime: true,
    fade: true,
  };
}

export function sanitizeLook(input) {
  const base = defaultLook();
  const source = input || {};
  const clamp = (key, min, max) => {
    const value = Number(source[key]);
    if (!Number.isFinite(value)) return base[key];
    return Math.min(max, Math.max(min, Math.round(value)));
  };
  return {
    fontSize: clamp("fontSize", 12, 48),
    nameSize: clamp("nameSize", 10, 32),
    opacity: clamp("opacity", 0, 100),
    maxMessages: clamp("maxMessages", 1, 20),
    align: source.align === "top" ? "top" : "bottom",
    showPlatform: source.showPlatform !== false,
    showTime: source.showTime !== false,
    fade: source.fade !== false,
  };
}

export function defaultConfig() {
  return {
    twitch: { channel: "", login: "", userId: "", oauthToken: "", clientId: "" },
    youtube: {
      clientId: "",
      clientSecret: "",
      refreshToken: "",
      accessToken: "",
      expiresAt: 0,
      displayName: "",
      channelId: "",
      handle: "",
      videoId: "",
      cookies: "",
    },
    kick: {
      channel: "",
      accessToken: "",
      refreshToken: "",
      expiresAt: 0,
      clientId: "",
      clientSecret: "",
      broadcasterUserId: "",
      chatroomId: "",
      username: "",
      cookies: "",
    },
    vk: {
      channel: "",
      accessToken: "",
      refreshToken: "",
      expiresAt: 0,
      clientId: "",
      displayName: "",
      userId: "",
    },
    bots: [...DEFAULT_BOTS],
    aliases: {},
    look: defaultLook(),
  };
}

const SECRET_KEYS = new Set([
  "oauthToken",
  "clientSecret",
  "refreshToken",
  "accessToken",
  "cookies",
]);

export function createConfigStore(filePath) {
  function read() {
    const base = defaultConfig();
    if (!fs.existsSync(filePath)) return base;
    try {
      const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
      return mergeConfig(base, parsed);
    } catch {
      return base;
    }
  }

  let current = read();

  function write(next) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
    current = next;
  }

  return {
    get() {
      return current;
    },
    save(patch, { clear = [] } = {}) {
      const next = mergeConfig(current, patch, clear);
      write(next);
      return current;
    },
    replace(next) {
      write(mergeConfig(defaultConfig(), next));
      return current;
    },
  };
}

export function mergeConfig(base, patch, clear = []) {
  const next = structuredClone(base);
  for (const key of ["twitch", "youtube", "kick", "vk"]) {
    if (!patch?.[key]) continue;
    for (const [field, value] of Object.entries(patch[key])) {
      if (value === undefined) continue;
      if (SECRET_KEYS.has(field) && value === "") continue;
      next[key][field] = value;
    }
  }
  if (Array.isArray(patch?.bots)) {
    next.bots = patch.bots.map((name) => String(name).trim()).filter(Boolean);
  }
  if (patch?.aliases && typeof patch.aliases === "object") {
    next.aliases = { ...(next.aliases || {}) };
    for (const [key, value] of Object.entries(patch.aliases)) {
      const display = String(value ?? "").trim();
      if (!display) delete next.aliases[key];
      else next.aliases[key] = display;
    }
  }
  if (patch?.look) next.look = sanitizeLook({ ...next.look, ...patch.look });
  for (const pathKey of clear) {
    const [section, field] = String(pathKey).split(".");
    if (next[section] && field in next[section]) next[section][field] = defaultConfig()[section][field];
  }
  return next;
}

export function ownNames(config) {
  return {
    twitch: config.twitch.login,
    youtube: config.youtube.displayName,
    kick: config.kick.username || config.kick.channel,
    vk: config.vk.displayName,
  };
}

export function ownIds(config) {
  return {
    twitch: config.twitch.userId,
    youtube: config.youtube.channelId,
    kick: config.kick.broadcasterUserId,
    vk: config.vk.userId,
  };
}

export function slug(value) {
  return String(value ?? "")
    .trim()
    .replace(/^https?:\/\/[^/]+\//i, "")
    .replace(/[?#].*$/, "")
    .replace(/^@/, "")
    .replace(/^#/, "")
    .replace(/\/+$/, "")
    .split("/")
    .pop()
    .toLowerCase();
}
