import { runYouTubeSite, sendYouTubeSite } from "./youtube-web.js";

export function createYouTubeConnector({ hub, learn, getConfig, setStatus }) {
  let generation = 0;
  let liveChatId = "";
  const siteSession = {};

  return {
    async start() {
      const gen = ++generation;
      const youtube = getConfig().youtube;
      const handle = String(youtube.handle || "").replace(/^@/, "");
      const videoId = String(youtube.videoId || "");
      if (youtube.cookies || youtube.channelId || handle || videoId) {
        try {
          await runYouTubeSite({
            cookies: youtube.cookies ? JSON.parse(youtube.cookies) : [],
            channelId: youtube.channelId,
            handle,
            videoId,
            hub,
            setStatus,
            alive: () => gen === generation,
            session: siteSession,
          });
        } catch (error) {
          if (gen !== generation) return;
          setStatus("youtube", "error", error.message);
          setTimeout(() => {
            if (gen === generation) this.start();
          }, 8000);
        }
        return;
      }
      if (!youtube.refreshToken && !youtube.accessToken) {
        setStatus("youtube", "off", "ссылка не задана");
        return;
      }
      setStatus("youtube", "connecting", "ищу эфир");
      try {
        while (gen === generation) {
          const token = await accessToken(getConfig, learn);
          if (gen !== generation) return;
          await learnChannel(token, learn);
          liveChatId = await findLiveChatId(token);
          if (!liveChatId) {
            setStatus("youtube", "connecting", "эфир на YouTube не найден, жду");
            await sleep(15000);
            continue;
          }
          setStatus("youtube", "live", "чат эфира");
          await pullChat(gen, token, liveChatId);
        }
      } catch (error) {
        if (gen !== generation) return;
        setStatus("youtube", "error", error.message);
        const delay = /квот/.test(error.message) ? 10 * 60 * 1000 : 8000;
        setTimeout(() => {
          if (gen === generation) this.start();
        }, delay);
      }
    },
    stop() {
      generation += 1;
    },
    async send(text) {
      const youtube = getConfig().youtube;
      if (youtube.cookies) return sendYouTubeSite(text, siteSession);
      if (!youtube.refreshToken && !youtube.accessToken) return { ok: false, error: "YouTube не подключён" };
      if (!liveChatId) return { ok: false, error: "на YouTube нет активного эфира" };
      try {
        const token = await accessToken(getConfig, learn);
        const response = await fetch("https://www.googleapis.com/youtube/v3/liveChat/messages?part=snippet", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            snippet: {
              liveChatId,
              type: "textMessageEvent",
              textMessageDetails: { messageText: text },
            },
          }),
        });
        if (!response.ok) {
          const json = await response.json().catch(() => ({}));
          return { ok: false, error: youtubeError(json, response.status) };
        }
        return { ok: true };
      } catch (error) {
        return { ok: false, error: error.message };
      }
    },
  };

  async function pullChat(gen, token, chatId) {
    let pageToken = "";
    let primed = false;
    const freshAfter = Date.now() - 3 * 60 * 1000;
    while (gen === generation) {
      const url = new URL("https://www.googleapis.com/youtube/v3/liveChat/messages");
      url.searchParams.set("part", "snippet,authorDetails");
      url.searchParams.set("liveChatId", chatId);
      url.searchParams.set("maxResults", "200");
      if (pageToken) url.searchParams.set("pageToken", pageToken);
      const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      const json = await response.json().catch(() => ({}));
      if (response.status === 401) {
        learn({ youtube: { expiresAt: 0 } });
        token = await accessToken(getConfig, learn);
        continue;
      }
      if (!response.ok) throw new Error(youtubeError(json, response.status));
      for (const item of json.items || []) {
        const at = Date.parse(item.snippet?.publishedAt || "") || Date.now();
        if (!primed && at < freshAfter) continue;
        const message = youtubeMessage(item);
        if (message) hub.ingest(message);
      }
      primed = true;
      pageToken = json.nextPageToken || pageToken;
      if (json.offlineAt) {
        liveChatId = "";
        setStatus("youtube", "connecting", "эфир на YouTube закончился, жду новый");
        await sleep(15000);
        return;
      }
      const wait = Math.max(1000, Number(json.pollingIntervalMillis) || 5000);
      await sleep(wait);
    }
  }
}

function youtubeMessage(item) {
  const snippet = item.snippet || {};
  const author = item.authorDetails || {};
  if (snippet.type === "chatEndedEvent") return null;
  const text = messageText(snippet);
  if (!text) return null;
  return {
    platform: "youtube",
    platformMessageId: item.id,
    author: author.displayName || "без ника",
    authorId: author.channelId || "",
    text,
    at: Date.parse(snippet.publishedAt || "") || Date.now(),
    isBot: Boolean(author.isChatSponsor && false),
    emotes: [],
  };
}

function messageText(snippet) {
  if (snippet.displayMessage) return snippet.displayMessage;
  if (snippet.textMessageDetails?.messageText) return snippet.textMessageDetails.messageText;
  const amount = snippet.superChatDetails?.amountDisplayString;
  const comment = snippet.superChatDetails?.userComment || "";
  if (amount) return comment ? `${amount} · ${comment}` : amount;
  const labels = {
    newSponsorEvent: "новый спонсор",
    memberMilestoneChatEvent: "отметка участника",
    membershipGiftingEvent: "подарил спонсорство",
    giftMembershipReceivedEvent: "получил спонсорство",
  };
  return labels[snippet.type] || "";
}

async function learnChannel(token, learn) {
  const response = await fetch("https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true", {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) return;
  const json = await response.json();
  const channel = json.items?.[0];
  if (!channel) return;
  learn({
    youtube: {
      channelId: channel.id,
      displayName: channel.snippet?.title || "",
    },
  });
}

async function findLiveChatId(token) {
  const response = await fetch(
    "https://www.googleapis.com/youtube/v3/liveBroadcasts?part=snippet&broadcastStatus=active&mine=true",
    { headers: { Authorization: `Bearer ${token}` } },
  );
  const json = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(youtubeError(json, response.status));
  return json.items?.[0]?.snippet?.liveChatId || "";
}

async function accessToken(getConfig, learn) {
  const youtube = getConfig().youtube;
  if (youtube.accessToken && youtube.expiresAt > Date.now() + 30000) return youtube.accessToken;
  if (!youtube.refreshToken || !youtube.clientId || !youtube.clientSecret) {
    throw new Error("нужен вход через Google");
  }
  const body = new URLSearchParams({
    client_id: youtube.clientId,
    client_secret: youtube.clientSecret,
    refresh_token: youtube.refreshToken,
    grant_type: "refresh_token",
  });
  const response = await fetch("https://oauth2.googleapis.com/token", { method: "POST", body });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(json.error_description || "Google не обновил токен");
  learn({
    youtube: {
      accessToken: json.access_token,
      expiresAt: Date.now() + (json.expires_in || 3600) * 1000,
      refreshToken: json.refresh_token || youtube.refreshToken,
    },
  });
  return json.access_token;
}

function youtubeError(json, status) {
  const reason = json?.error?.errors?.[0]?.reason || "";
  if (reason === "quotaExceeded" || reason === "dailyLimitExceeded") {
    return "у YouTube кончилась дневная квота. Завтра оживёт или подними квоту в Google Cloud";
  }
  if (reason === "liveChatDisabled" || reason === "liveChatEnded") return "чат YouTube закрыт";
  if (status === 403 && /accessNotConfigured|youtube\.v3/i.test(JSON.stringify(json))) {
    return "в Google Cloud не включён YouTube Data API";
  }
  const message = json?.error?.message;
  return message || `YouTube ответил ${status}`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
