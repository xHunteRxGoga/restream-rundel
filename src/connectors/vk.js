export function vkTextFromBlocks(blocks) {
  if (!Array.isArray(blocks)) return { text: "", emotes: [] };
  let text = "";
  const emotes = [];
  for (const block of blocks) {
    if (!block || block.modificator === "BLOCK_END") continue;
    if (block.type === "text" || block.type === "link") {
      let piece = "";
      if (block.content) {
        try {
          const parsed = JSON.parse(block.content);
          piece = Array.isArray(parsed) ? String(parsed[0] ?? "") : String(block.content);
        } catch {
          piece = String(block.content);
        }
      }
      text += piece;
      continue;
    }
    if (block.type === "smile") {
      const name = block.name || "smile";
      const start = text.length;
      text += name;
      const url = block.smallUrl || block.mediumUrl || block.url || "";
      if (url) emotes.push({ name, start, end: text.length, url });
      continue;
    }
    if (block.type === "mention") {
      text += block.displayName || block.nick || "";
    }
  }
  return { text: text.replace(/\s+/g, " ").trim(), emotes };
}

export function createVkConnector({ hub, learn, getConfig, setStatus }) {
  let generation = 0;
  let socket = null;

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
      const channel = getConfig().vk.channel;
      if (!channel) {
        setStatus("vk", "off", "впиши ник канала");
        return;
      }
      setStatus("vk", "connecting", "подключаюсь");
      try {
        if (getConfig().vk.accessToken) await learnSelf();
        const blog = await getBlog(channel);
        const room = channelRoom(blog);
        if (!room) throw new Error("VK не отдал канал чата");
        if (gen !== generation) return;
        await openSocket(gen, room, channel, () => this.start());
      } catch (error) {
        if (gen !== generation) return;
        setStatus("vk", "error", error.message);
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
      const vk = getConfig().vk;
      if (!vk.accessToken || !vk.channel) return { ok: false, error: "VK не подключён" };
      const payload = JSON.stringify([
        {
          type: "text",
          content: JSON.stringify([`${text} `, "unstyled", []]),
          modificator: "",
        },
      ]);
      const body = new URLSearchParams({ data: payload });
      const response = await vkFetch(getConfig, learn, `/blog/${encodeURIComponent(vk.channel)}/public_video_stream/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
      });
      if (!response.ok) {
        if (response.status === 401) return { ok: false, error: "VK не принял токен" };
        return { ok: false, error: `VK ответил ${response.status}` };
      }
      return { ok: true };
    },
  };

  async function learnSelf() {
    const response = await vkFetch(getConfig, learn, "/user/current");
    if (!response.ok) return;
    const json = await response.json();
    const user = json.data || json.user || json;
    learn({
      vk: {
        userId: String(user.id || user.userId || ""),
        displayName: user.displayName || user.nick || getConfig().vk.displayName,
      },
    });
  }

  async function openSocket(gen, room, label, restart) {
    const tokenResponse = await vkFetch(getConfig, learn, "/ws/connect");
    if (!tokenResponse.ok) throw new Error(`VK не выдал сокет (${tokenResponse.status})`);
    const tokenJson = await tokenResponse.json();
    const token = tokenJson.token || tokenJson.data?.token;
    if (!token) throw new Error("VK вернул пустой токен сокета");

    const WebSocket = (await import("ws")).default;
    const ws = new WebSocket("wss://pubsub.live.vkvideo.ru/connection/websocket?cf_protocol_version=v2", {
      headers: { Origin: "https://live.vkvideo.ru" },
    });
    socket = ws;
    let methodId = 0;
    let subscribed = false;
    ws.on("open", () => {
      if (gen !== generation) return;
      methodId += 1;
      ws.send(JSON.stringify({ connect: { token, name: "js" }, id: methodId }));
    });
    ws.on("message", (data) => {
      if (gen !== generation) return;
      const raw = data.toString();
      if (raw === "{}") {
        ws.send("{}");
        return;
      }
      let frame;
      try {
        frame = JSON.parse(raw);
      } catch {
        return;
      }
      if (!subscribed && !frame.push && (frame.connect || frame.id)) {
        subscribed = true;
        methodId += 1;
        ws.send(JSON.stringify({ subscribe: { channel: `public-chat:${room}` }, id: methodId }));
        setStatus("vk", "live", label);
        return;
      }
      const event = frame.push?.pub?.data;
      if (event?.type !== "message") return;
      const body = event.data || {};
      const { text, emotes } = vkTextFromBlocks(body.data);
      if (!text) return;
      hub.ingest({
        platform: "vk",
        platformMessageId: body.id ? String(body.id) : "",
        author: body.author?.displayName || body.author?.nick || "без ника",
        authorId: body.author?.id ? String(body.author.id) : "",
        text,
        emotes,
        at: body.createdAt ? Date.parse(body.createdAt) || Date.now() : Date.now(),
      });
    });
    ws.on("close", () => {
      if (gen !== generation) return;
      setStatus("vk", "error", "сокет VK закрылся, пробую снова");
      setTimeout(() => {
        if (gen === generation) restart();
      }, 4000);
    });
    ws.on("error", () => {});
  }
}

async function getBlog(channel) {
  const response = await fetch(`https://api.live.vkvideo.ru/v1/blog/${encodeURIComponent(channel)}`, {
    headers: { Accept: "application/json" },
  });
  if (!response.ok) throw new Error(`VK не отдал канал (${response.status})`);
  const json = await response.json();
  return json.publicWebSocketChannel ? json : json.data || json;
}

function channelRoom(blog) {
  const raw = blog?.publicWebSocketChannel || blog?.web_socket_channels?.chat || "";
  if (!raw) return "";
  const value = String(raw);
  return value.includes(":") ? value.split(":").pop() : value;
}

async function vkFetch(getConfig, learn, endpoint, options = {}) {
  const send = async () => {
    const vk = getConfig().vk;
    const headers = new Headers(options.headers || {});
    headers.set("Accept", "application/json");
    if (vk.accessToken) headers.set("Authorization", `Bearer ${vk.accessToken}`);
    if (vk.clientId) headers.set("X-From-Id", vk.clientId);
    return fetch(`https://api.live.vkvideo.ru/v1${endpoint}`, { ...options, headers });
  };
  let response = await send();
  if (response.status === 401 && (await refreshVk(getConfig, learn))) response = await send();
  return response;
}

async function refreshVk(getConfig, learn) {
  const vk = getConfig().vk;
  if (!vk.refreshToken) return false;
  const body = new URLSearchParams({
    response_type: "code",
    refresh_token: vk.refreshToken,
    grant_type: "refresh_token",
    device_id: vk.clientId || "",
    device_os: "streams_web",
  });
  const response = await fetch("https://api.live.vkvideo.ru/oauth/token/", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!response.ok) return false;
  const json = await response.json();
  learn({
    vk: {
      accessToken: json.access_token,
      refreshToken: json.refresh_token || vk.refreshToken,
      expiresAt: Date.now() + (json.expires_in || 3600) * 1000,
    },
  });
  return Boolean(json.access_token);
}
