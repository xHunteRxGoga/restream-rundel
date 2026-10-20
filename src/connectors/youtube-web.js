import crypto from "node:crypto";
import { shortcodeEmoji } from "../emoji-shortcodes.js";
import { emoteUrlAllowed } from "../render.js";

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
  const block = json?.continuationContents?.liveChatContinuation || json?.contents?.liveChatContinuation;
  const messages = [];
  for (const action of block?.actions || []) collectYouTubeAction(action, messages);
  const nextBlock = block?.continuations?.[0] || {};
  const timed = nextBlock.timedContinuationData || nextBlock.invalidationContinuationData || nextBlock.reloadContinuationData || {};
  const asked = Number(timed.timeoutMs);
  return {
    messages,
    continuation: timed.continuation || "",
    timeout: Math.min(900, Math.max(350, Number.isFinite(asked) && asked > 0 ? asked : 700)),
  };
}

function collectYouTubeAction(action, messages) {
  const nested = action?.replayChatItemAction?.actions;
  if (Array.isArray(nested)) {
    for (const child of nested) collectYouTubeAction(child, messages);
    return;
  }
  const item = action?.addChatItemAction?.item;
  const renderer = item?.liveChatTextMessageRenderer || item?.liveChatPaidMessageRenderer;
  if (!renderer) return;
  const parts = youtubeRuns(renderer.message?.runs);
  if (!parts.text) return;
  messages.push({
    platform: "youtube",
    platformMessageId: renderer.id || "",
    author: renderer.authorName?.simpleText || "без ника",
    authorId: renderer.authorExternalChannelId || "",
    text: parts.text,
    emotes: parts.emotes,
  });
}

export function youtubeRuns(runs) {
  let text = "";
  const emotes = [];
  for (const run of runs || []) {
    if (typeof run?.text === "string") {
      text += run.text;
      continue;
    }
    const emoji = run?.emoji;
    if (!emoji) continue;
    const image = emojiImage(emoji);
    const unicode = unicodeEmoji(emoji, image);
    if (unicode) {
      text += unicode;
      continue;
    }
    if (image && emoteUrlAllowed(image)) {
      const name = String(emoji.shortcuts?.[0] || emoji.searchTerms?.[0] || "emoji").replace(/:/g, "");
      const start = text.length;
      text += "\uFFFC";
      emotes.push({ name, start, end: text.length, url: image });
    }
  }
  const leading = text.length - text.trimStart().length;
  const trimmed = text.trim();
  return {
    text: trimmed,
    emotes: emotes
      .map((emote) => ({ ...emote, start: emote.start - leading, end: emote.end - leading }))
      .filter((emote) => emote.start >= 0 && emote.end <= trimmed.length),
  };
}

function emojiImage(emoji) {
  const thumbs = emoji.image?.thumbnails || [];
  const best = [...thumbs].sort((a, b) => (b.width || 0) - (a.width || 0))[0];
  return best?.url || "";
}

function unicodeEmoji(emoji, image) {
  const id = String(emoji.emojiId || "");
  if (/^\p{Extended_Pictographic}/u.test(id) && [...id].length <= 4) return id;
  const fromImage = codepointsFromUrl(image);
  if (fromImage) return fromImage;
  for (const shortcut of emoji.shortcuts || []) {
    const hit = shortcodeEmoji(shortcut);
    if (hit) return hit;
  }
  return "";
}

function codepointsFromUrl(url) {
  const match = String(url).match(/notoemoji\/[^/]+\/([0-9a-f]+(?:_[0-9a-f]+)*)\//i);
  if (!match) return "";
  try {
    return String.fromCodePoint(...match[1].split("_").map((hex) => Number.parseInt(hex, 16)));
  } catch {
    return "";
  }
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
      await sleep(batch.timeout);
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
