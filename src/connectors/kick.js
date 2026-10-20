export function parseKickContent(content) {
  const source = String(content ?? "");
  const emotes = [];
  let text = "";
  const pattern = /\[emote:(\d+):([^\]]+)\]/g;
  let last = 0;
  for (const match of source.matchAll(pattern)) {
    text += source.slice(last, match.index);
    const name = match[2];
    const start = text.length;
    text += name;
    emotes.push({
      name,
      start,
      end: text.length,
      url: `https://files.kick.com/emotes/${match[1]}/fullsize`,
    });
    last = match.index + match[0].length;
  }
  text += source.slice(last);
  return { text, emotes };
}

const KICK_CLIENT_TOKEN = "e1393935a959b4020a4491574f6490129f678acdaa92760471263db43487f823";

export function createKickConnector({ hub, learn, getConfig, setStatus }) {
  let generation = 0;
  let socket = null;
  let chatroomId = "";

  function stopSocket() {
    if (!socket) return;
    socket.removeAllListeners();
    socket.terminate();
    socket = null;
  }

  return {
    async start() {
      const gen = ++generation;
      stopSocket();
      const kick = getConfig().kick;
      const channel = kick.channel;
      if (!channel && !kick.chatroomId) {
        setStatus("kick", "off", "впиши ник канала");
        return;
      }
      setStatus("kick", "connecting", "подключаюсь");
      try {
        if (kick.accessToken) await learnSelf();
        chatroomId = String(getConfig().kick.chatroomId || "");
        if (!chatroomId) chatroomId = String(await fetchChatroomId(getConfig().kick.channel));
        if (!chatroomId) throw new Error("не нашёл ID чата Kick. Впиши его в подключениях.");
        learn({ kick: { chatroomId } });
        if (gen !== generation) return;
        await openSocket(gen, chatroomId, channel || chatroomId, () => this.start());
      } catch (error) {
        if (gen !== generation) return;
        setStatus("kick", "error", error.message);
        setTimeout(() => {
          if (gen === generation) this.start();
        }, 8000);
      }
    },
    stop() {
      generation += 1;
      stopSocket();
    },
    async send(text) {
      const kick = getConfig().kick;
      if (kick.cookies) return sendViaSite(text, kick);
      const token = kick.accessToken;
      if (!token) return { ok: false, error: "Kick не подключён" };
      const broadcaster = getConfig().kick.broadcasterUserId;
      const body = { type: "user", content: text };
      if (broadcaster) body.broadcaster_user_id = Number(broadcaster);
      let response = await fetch("https://api.kick.com/public/v1/chat", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
      if (response.status === 401 && (await refreshKick(getConfig, learn))) {
        response = await fetch("https://api.kick.com/public/v1/chat", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${getConfig().kick.accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
        });
      }
      if (!response.ok) {
        const detail = await response.text();
        return { ok: false, error: kickError(response.status, detail) };
      }
      return { ok: true };
    },
  };

  async function learnSelf() {
    const response = await fetch("https://api.kick.com/public/v1/users", {
      headers: { Authorization: `Bearer ${getConfig().kick.accessToken}` },
    });
    if (!response.ok) return;
    const json = await response.json();
    const user = Array.isArray(json.data) ? json.data[0] : json.data;
    if (!user) return;
    learn({
      kick: {
        broadcasterUserId: String(user.user_id || ""),
        username: getConfig().kick.channel || user.name || "",
      },
    });
  }

  async function openSocket(gen, roomId, label, restart) {
    const tokenResponse = await fetch("https://websockets.kick.com/viewer/v1/token", {
      headers: {
        "X-CLIENT-TOKEN": KICK_CLIENT_TOKEN,
        "User-Agent": browserAgent(),
        Accept: "application/json",
      },
    });
    if (!tokenResponse.ok) {
      throw new Error(`Kick не выдал сокет (${tokenResponse.status}). Чат читать не могу, отправка по токену останется.`);
    }
    const tokenJson = await tokenResponse.json();
    const token = tokenJson.data?.token || tokenJson.token;
    if (!token) throw new Error("Kick вернул пустой токен сокета");

    const WebSocket = (await import("ws")).default;
    const ws = new WebSocket(`wss://websockets.kick.com/viewer/v1/connect?token=${encodeURIComponent(token)}`);
    socket = ws;
    ws.on("open", () => {
      if (gen !== generation) return;
      setStatus("kick", "live", label);
    });
    ws.on("message", (data) => {
      if (gen !== generation) return;
      let frame;
      try {
        frame = JSON.parse(data.toString());
      } catch {
        return;
      }
      if (frame.event === "pusher:connection_established") {
        ws.send(JSON.stringify({
          event: "pusher:subscribe",
          data: { auth: "", channel: `chatrooms.${roomId}.v2` },
        }));
        return;
      }
      if (frame.event === "pusher:ping") {
        ws.send(JSON.stringify({ event: "pusher:pong", data: {} }));
        return;
      }
      if (frame.event !== "App\\Events\\ChatMessageEvent") return;
      const payload = typeof frame.data === "string" ? JSON.parse(frame.data) : frame.data;
      const parsed = kickMessage(payload);
      if (!parsed) return;
      hub.ingest({ platform: "kick", ...parsed });
    });
    ws.on("close", () => {
      if (gen !== generation) return;
      setStatus("kick", "error", "сокет Kick закрылся, пробую снова");
      setTimeout(() => {
        if (gen === generation) restart();
      }, 4000);
    });
    ws.on("error", () => {});
  }
}

function kickMessage(payload) {
  const content = payload?.content ?? payload?.message ?? "";
  if (!String(content).trim()) return null;
  const sender = payload.sender || payload.user || {};
  const badges = sender.identity?.badges || payload.badges || [];
  const { text, emotes } = parseKickContent(content);
  return {
    platformMessageId: payload.id || "",
    author: sender.username || sender.slug || sender.name || "без ника",
    authorId: sender.id ? String(sender.id) : "",
    text,
    color: sender.identity?.color || "",
    emotes,
    isBot: badges.some((badge) => String(badge.type || badge).toLowerCase() === "bot"),
  };
}

async function fetchChatroomId(channel) {
  const response = await fetch(`https://kick.com/api/v2/channels/${encodeURIComponent(channel)}`, {
    headers: {
      Accept: "application/json",
      "User-Agent": browserAgent(),
    },
  });
  if (!response.ok) {
    throw new Error(`Kick не отдал канал (${response.status}). Впиши ID чата вручную.`);
  }
  const json = await response.json();
  return json.chatroom?.id || json.chatroom_id || "";
}

async function refreshKick(getConfig, learn) {
  const kick = getConfig().kick;
  if (!kick.refreshToken || !kick.clientId || !kick.clientSecret) return false;
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: kick.refreshToken,
    client_id: kick.clientId,
    client_secret: kick.clientSecret,
  });
  const response = await fetch("https://id.kick.com/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!response.ok) return false;
  const json = await response.json();
  learn({
    kick: {
      accessToken: json.access_token,
      refreshToken: json.refresh_token || kick.refreshToken,
      expiresAt: Date.now() + (json.expires_in || 3600) * 1000,
    },
  });
  return true;
}

function kickError(status, detail) {
  if (status === 401) return "Kick не принял токен";
  if (status === 403) return "Kick запретил отправку";
  return `Kick ответил ${status}`;
}

function browserAgent() {
  return "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
}

async function sendViaSite(text, kick) {
  let cookies = [];
  try {
    cookies = JSON.parse(kick.cookies);
  } catch {
    return { ok: false, error: "Сессия Kick сломалась. Войди ещё раз." };
  }
  if (!kick.chatroomId) return { ok: false, error: "Kick не нашёл чат. Войди ещё раз." };
  const xsrf = cookies.find((cookie) => cookie.name === "XSRF-TOKEN");
  const headers = {
    cookie: cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join("; "),
    "content-type": "application/json",
    accept: "application/json",
    origin: "https://kick.com",
    referer: `https://kick.com/${kick.channel || ""}`,
    "user-agent": browserAgent(),
  };
  if (xsrf?.value) headers["x-xsrf-token"] = decodeURIComponent(xsrf.value);
  const response = await fetch(`https://kick.com/api/v2/messages/send/${kick.chatroomId}`, {
    method: "POST",
    headers,
    body: JSON.stringify({ content: text, type: "message" }),
  });
  if (!response.ok) return { ok: false, error: "Kick не принял сообщение. Войди ещё раз." };
  return { ok: true };
}
