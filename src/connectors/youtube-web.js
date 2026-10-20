import crypto from "node:crypto";

const WEB_KEY = "AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8";
const AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

export function sapisidAuthorization(sapisid, now = Date.now()) {
  const seconds = Math.floor(now / 1000);
  const hash = crypto.createHash("sha1").update(`${seconds} ${sapisid} https://www.youtube.com`).digest("hex");
  return `SAPISIDHASH ${seconds}_${hash}`;
}

export function parseYouTubeLivePage(html, pageUrl = "") {
  const videoId = String(pageUrl).match(/[?&]v=([\w-]{11})/)?.[1]
    || html.match(/"videoId":"([\w-]{11})"/)?.[1]
    || "";
  const continuation = html.match(/reloadContinuationData":\{"continuation":"([^"]+)"/)?.[1]
    || html.match(/invalidationContinuationData":\{[^}]*"continuation":"([^"]+)"/)?.[1]
    || "";
  const sendParams = html.match(/sendLiveChatMessageEndpoint":\{"params":"([^"]+)"/)?.[1] || "";
  const apiKey = html.match(/"INNERTUBE_API_KEY":"([^"]+)"/)?.[1] || WEB_KEY;
  const clientVersion = html.match(/"INNERTUBE_CLIENT_VERSION":"([^"]+)"/)?.[1] || "2.20250101.00.00";
  return {
    videoId,
    continuation,
    sendParams,
    apiKey,
    clientVersion,
    isLive: Boolean(continuation),
  };
}

export function readYouTubeActions(json) {
  const block = json?.continuationContents?.liveChatContinuation;
  const messages = [];
  for (const action of block?.actions || []) {
    const item = action.addChatItemAction?.item;
    const renderer = item?.liveChatTextMessageRenderer || item?.liveChatPaidMessageRenderer;
    if (!renderer) continue;
    const text = (renderer.message?.runs || []).map((run) => run.text || run.emoji?.shortcuts?.[0] || "").join("").trim();
    if (!text) continue;
    messages.push({
      platform: "youtube",
      platformMessageId: renderer.id || "",
      author: renderer.authorName?.simpleText || "без ника",
      authorId: renderer.authorExternalChannelId || "",
      text,
    });
  }
  const nextBlock = block?.continuations?.[0] || {};
  const timed = nextBlock.timedContinuationData || nextBlock.invalidationContinuationData || {};
  return {
    messages,
    continuation: timed.continuation || "",
    timeout: Number(timed.timeoutMs) || 5000,
  };
}

export async function runYouTubeSite({ cookies, channelId, handle, videoId, hub, setStatus, alive, session }) {
  if (!channelId && !handle && !videoId) throw new Error("YouTube: ссылка не задана");
  let currentChannel = channelId || "";
  let currentHandle = String(handle || "").replace(/^@/, "");
  let currentVideo = videoId || "";
  session.cookies = cookies || [];
  while (alive()) {
    const page = await loadLivePage(session.cookies, {
      channelId: currentChannel,
      handle: currentHandle,
      videoId: currentVideo,
    });
    if (page?.channelId) currentChannel = page.channelId;
    if (page?.handle) currentHandle = page.handle;
    if (!page?.isLive) {
      setStatus("youtube", "connecting", "эфира на YouTube нет, жду");
      await sleep(15000);
      if (!alive()) return;
      continue;
    }
    Object.assign(session, page, { cookies });
    setStatus("youtube", "live", "чат эфира");
    let continuation = page.continuation;
    while (alive() && continuation) {
      const response = await fetch(`https://www.youtube.com/youtubei/v1/live_chat/get_live_chat?key=${encodeURIComponent(session.apiKey)}`, {
        method: "POST",
        headers: youtubeHeaders(cookies, session.clientVersion),
        body: JSON.stringify({
          context: clientContext(session.clientVersion),
          continuation,
        }),
      });
      if ((response.status === 401 || response.status === 403) && session.cookies?.length) {
        throw new Error("Сессия YouTube кончилась. Войди ещё раз.");
      }
      if (!response.ok) break;
      const json = await response.json();
      const batch = readYouTubeActions(json);
      for (const message of batch.messages) hub.ingest(message);
      if (!batch.continuation) {
        setStatus("youtube", "connecting", "эфир на YouTube закончился, жду новый");
        await sleep(15000);
        break;
      }
      continuation = batch.continuation;
      session.continuation = continuation;
      await sleep(Math.max(1000, batch.timeout));
    }
  }
}

export async function sendYouTubeSite(text, session) {
  if (!session?.sendParams || !session.apiKey) return { ok: false, error: "на YouTube нет активного эфира" };
  const response = await fetch(`https://www.youtube.com/youtubei/v1/live_chat/send_message?key=${encodeURIComponent(session.apiKey)}`, {
    method: "POST",
    headers: youtubeHeaders(session.cookies || [], session.clientVersion),
    body: JSON.stringify({
      context: clientContext(session.clientVersion),
      params: session.sendParams,
      richMessage: { textSegments: [{ text }] },
    }),
  });
  if (!response.ok) return { ok: false, error: "YouTube не принял сообщение. Войди ещё раз." };
  return { ok: true };
}

async function loadLivePage(cookies, { channelId, handle, videoId }) {
  const url = channelId
    ? `https://www.youtube.com/channel/${encodeURIComponent(channelId)}/live`
    : handle
      ? `https://www.youtube.com/@${encodeURIComponent(handle)}/live`
      : `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;
  const response = await fetch(url, {
    headers: {
      cookie: cookieHeader(cookies),
      "user-agent": AGENT,
      accept: "text/html",
    },
    redirect: "follow",
  });
  const html = await response.text();
  const page = parseYouTubeLivePage(html, response.url);
  page.channelId = html.match(/"channelId":"(UC[\w-]{20,})"/)?.[1] || "";
  page.handle = html.match(/"canonicalBaseUrl":"\/@([^"]+)"/)?.[1]
    || html.match(/youtube\.com\/@([\w.-]+)/)?.[1]
    || "";
  return page;
}

function youtubeHeaders(cookies, clientVersion) {
  const sapisid = (cookies || []).find((cookie) => cookie.name === "SAPISID" || cookie.name === "__Secure-3PAPISID")?.value;
  const headers = {
    cookie: cookieHeader(cookies),
    "content-type": "application/json",
    origin: "https://www.youtube.com",
    referer: "https://www.youtube.com/",
    "user-agent": AGENT,
    "x-youtube-client-name": "1",
    "x-youtube-client-version": clientVersion || "2.20250101.00.00",
  };
  if (sapisid) headers.authorization = sapisidAuthorization(sapisid);
  return headers;
}

function clientContext(clientVersion) {
  return {
    client: {
      clientName: "WEB",
      clientVersion: clientVersion || "2.20250101.00.00",
      hl: "ru",
      gl: "RU",
    },
  };
}

function cookieHeader(cookies) {
  return (cookies || []).map((cookie) => `${cookie.name}=${cookie.value}`).join("; ");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
