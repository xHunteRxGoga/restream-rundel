import { avatarUrlAllowed } from "../render.js";

const TAG_ESCAPES = [
  [/\\:/g, ";"],
  [/\\s/g, " "],
  [/\\r/g, ""],
  [/\\n/g, "\n"],
  [/\\\\/g, "\\"],
];

export function unescapeTag(value) {
  let text = value ?? "";
  for (const [pattern, replacement] of TAG_ESCAPES) text = text.replace(pattern, replacement);
  return text;
}

export function parseTags(source) {
  const tags = {};
  for (const part of source.split(";")) {
    if (!part) continue;
    const eq = part.indexOf("=");
    const key = eq === -1 ? part : part.slice(0, eq);
    const value = eq === -1 ? "" : part.slice(eq + 1);
    tags[key] = unescapeTag(value);
  }
  return tags;
}

export function emotesFromTag(tag, text) {
  if (!tag) return [];
  const emotes = [];
  for (const piece of tag.split("/")) {
    const [id, places] = piece.split(":");
    if (!id || !places) continue;
    for (const place of places.split(",")) {
      const [startText, endText] = place.split("-");
      const start = Number(startText);
      const inclusiveEnd = Number(endText);
      if (!Number.isInteger(start) || !Number.isInteger(inclusiveEnd)) continue;
      const end = inclusiveEnd + 1;
      emotes.push({
        name: text.slice(start, end),
        start,
        end,
        url: `https://static-cdn.jtvnw.net/emoticons/v2/${id}/default/dark/2.0`,
      });
    }
  }
  return emotes;
}

export function parseTwitchLine(raw) {
  const line = String(raw ?? "").replace(/\r$/, "");
  if (!line) return null;
  if (line.startsWith("PING ")) return { type: "ping", payload: line.slice(5) };

  let rest = line;
  let tags = {};
  if (rest.startsWith("@")) {
    const space = rest.indexOf(" ");
    tags = parseTags(rest.slice(1, space));
    rest = rest.slice(space + 1);
  }

  let prefix = "";
  if (rest.startsWith(":")) {
    const space = rest.indexOf(" ");
    prefix = rest.slice(1, space);
    rest = rest.slice(space + 1);
  }

  const trailingAt = rest.indexOf(" :");
  const head = trailingAt === -1 ? rest : rest.slice(0, trailingAt);
  const trailing = trailingAt === -1 ? "" : rest.slice(trailingAt + 2);
  const parts = head.split(" ");
  const command = parts[0];
  const nick = prefix.split("!")[0];

  if (command === "PRIVMSG" || command === "USERNOTICE") {
    const text = trailing || tags["system-msg"] || "";
    if (!text.trim()) return null;
    return {
      type: "message",
      platformMessageId: tags.id || "",
      author: tags["display-name"] || nick || "без ника",
      authorId: tags["user-id"] || "",
      text,
      color: tags.color || "",
      emotes: emotesFromTag(tags.emotes, text),
      isBot: badgeHasBot(tags.badges),
    };
  }

  if (command === "USERSTATE" || command === "GLOBALUSERSTATE") {
    return {
      type: "self",
      author: tags["display-name"] || "",
      authorId: tags["user-id"] || "",
    };
  }

  if (command === "NOTICE") {
    return { type: "notice", text: trailing };
  }

  return { type: "other", command };
}

function badgeHasBot(badges) {
  if (!badges) return false;
  return badges.split(",").some((badge) => badge.startsWith("bot/"));
}

export function createTwitchConnector({ hub, learn, getConfig, setStatus }) {
  let generation = 0;
  let socket = null;

  function stopSocket() {
    if (!socket) return;
    socket.removeAllListeners();
    socket.close();
    socket = null;
  }

  const avatarCache = new Map();

  function attachTwitchAvatar(event) {
    const login = String(event.author || "").trim().toLowerCase();
    const known = login ? avatarCache.get(login) : "";
    hub.ingest({ platform: "twitch", ...event, avatar: known || "" });
    if (!login || avatarCache.has(login)) return;
    avatarCache.set(login, "");
    fetch(`https://api.ivr.fi/v2/twitch/user?login=${encodeURIComponent(login)}`, {
      headers: { accept: "application/json" },
    })
      .then((response) => (response.ok ? response.json() : null))
      .then((json) => {
        const logo = Array.isArray(json) ? json[0]?.logo : "";
        if (!logo || !avatarUrlAllowed(logo)) return;
        avatarCache.set(login, logo);
        hub.setAvatar("twitch", event.authorId, event.author, logo);
      })
      .catch(() => {});
  }

  async function identify() {
    const token = cleanToken(getConfig().twitch.oauthToken);
    if (!token) return;
    const response = await fetch("https://id.twitch.tv/oauth2/validate", {
      headers: { Authorization: `OAuth ${token}` },
    });
    if (!response.ok) throw new Error("Twitch не принял токен. Войди ещё раз.");
    const profile = await response.json();
    learn({
      twitch: {
        login: profile.login || getConfig().twitch.login,
        userId: String(profile.user_id || ""),
      },
    });
  }

  return {
    async start() {
      const gen = ++generation;
      stopSocket();
      const twitch = getConfig().twitch;
      const channel = (twitch.channel || twitch.login || "").replace(/^#/, "").toLowerCase();
      const token = cleanToken(twitch.oauthToken);
      if (!channel) {
        setStatus("twitch", "off", "ссылка не задана");
        return;
      }

      setStatus("twitch", "connecting", token ? "подключаюсь" : "читаю чат трансляции");
      if (token) {
        try {
          await identify();
        } catch (error) {
          if (gen !== generation) return;
          setStatus("twitch", "error", error.message);
          setTimeout(() => {
            if (gen === generation) this.start();
          }, 8000);
          return;
        }
      }
      if (gen !== generation) return;

      const WebSocket = (await import("ws")).default;
      const ws = new WebSocket("wss://irc-ws.chat.twitch.tv:443");
      socket = ws;
      const nick = token
        ? (getConfig().twitch.login || channel).toLowerCase()
        : `justinfan${Math.floor(10000 + Math.random() * 89999)}`;
      ws.on("open", () => {
        if (gen !== generation) return;
        ws.send("CAP REQ :twitch.tv/tags twitch.tv/commands");
        if (token) ws.send(`PASS oauth:${token}`);
        else ws.send("PASS SCHMOOPIIE");
        ws.send(`NICK ${nick}`);
        ws.send(`JOIN #${channel}`);
      });
      ws.on("message", (data) => {
        if (gen !== generation) return;
        for (const raw of data.toString().split("\n")) {
          const event = parseTwitchLine(raw);
          if (!event) continue;
          if (event.type === "ping") {
            ws.send(`PONG ${event.payload}`);
            continue;
          }
          if (event.type === "self") {
            if (event.author || event.authorId) {
              learn({
                twitch: {
                  login: event.author || getConfig().twitch.login,
                  userId: event.authorId || getConfig().twitch.userId,
                },
              });
            }
            setStatus("twitch", "live", `#${channel}`);
            continue;
          }
          if (event.type === "notice") {
            if (/auth/i.test(event.text)) setStatus("twitch", "error", "Twitch не пустил в чат");
            continue;
          }
          if (event.type === "message") {
            setStatus("twitch", "live", `#${channel}`);
            attachTwitchAvatar(event);
          }
        }
      });
      ws.on("close", () => {
        if (gen !== generation) return;
        setStatus("twitch", "error", "соединение оборвалось, пробую снова");
        setTimeout(() => {
          if (gen === generation) this.start();
        }, 4000);
      });
      ws.on("error", () => {});
    },
    stop() {
      generation += 1;
      stopSocket();
    },
    async send(text) {
      const channel = (getConfig().twitch.channel || getConfig().twitch.login || "").replace(/^#/, "").toLowerCase();
      if (!cleanToken(getConfig().twitch.oauthToken)) {
        return { ok: false, error: "чат Twitch читается, ответить из гостя нельзя" };
      }
      if (!socket || socket.readyState !== 1 || !channel) {
        return { ok: false, error: "Twitch не подключён" };
      }
      socket.send(`PRIVMSG #${channel} :${text}`);
      return { ok: true };
    },
  };
}

function cleanToken(token) {
  return String(token ?? "").trim().replace(/^oauth:/i, "");
}
