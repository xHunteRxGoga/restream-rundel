export function streamsFromInput(input) {
  const source = input || {};
  return {
    twitch: { channel: twitchChannel(source.twitch) },
    youtube: youtubeFrom(source.youtube),
    kick: { channel: kickChannel(source.kick) },
    vk: { channel: vkChannel(source.vk) },
  };
}

export function twitchChannel(raw) {
  return channelName(raw, ["popout", "videos", "directory", "settings", "moderator"]);
}

export function kickChannel(raw) {
  return channelName(raw, ["popout", "categories", "following"]);
}

export function vkChannel(raw) {
  return channelName(raw, ["video", "clip", "app"]);
}

export function youtubeFrom(raw) {
  const empty = { handle: "", channelId: "", videoId: "", displayName: "" };
  const text = String(raw ?? "").trim();
  if (!text) return empty;
  if (!/^https?:/i.test(text) && !/youtube\.com|youtu\.be/i.test(text)) {
    if (/^UC[\w-]{20,}$/.test(text)) return { ...empty, channelId: text, displayName: text };
    const handle = text.replace(/^@/, "");
    return { ...empty, handle, displayName: `@${handle}` };
  }
  let url;
  try {
    url = new URL(/^https?:/i.test(text) ? text : `https://${text}`);
  } catch {
    return empty;
  }
  if (url.hostname.replace(/^www\./, "") === "youtu.be") {
    const videoId = url.pathname.split("/").filter(Boolean)[0] || "";
    return { ...empty, videoId, displayName: videoId };
  }
  const parts = url.pathname.split("/").filter(Boolean).map((part) => decodeURIComponent(part));
  const watchId = url.searchParams.get("v");
  if (watchId) return { ...empty, videoId: watchId, displayName: watchId };
  if (parts[0] === "live" && parts[1]) return { ...empty, videoId: parts[1], displayName: parts[1] };
  if (parts[0] === "shorts" && parts[1]) return { ...empty, videoId: parts[1], displayName: parts[1] };
  if (parts[0]?.startsWith("@")) {
    const handle = parts[0].slice(1);
    return { ...empty, handle, displayName: `@${handle}` };
  }
  if (parts[0] === "channel" && parts[1]) return { ...empty, channelId: parts[1], displayName: parts[1] };
  if ((parts[0] === "c" || parts[0] === "user") && parts[1]) {
    return { ...empty, handle: parts[1], displayName: parts[1] };
  }
  return empty;
}

function channelName(raw, skip) {
  const text = String(raw ?? "").trim();
  if (!text) return "";
  if (!/^https?:/i.test(text) && !text.includes("/")) {
    return text.replace(/^@/, "").replace(/^#/, "").toLowerCase();
  }
  let pathname = text;
  try {
    const url = new URL(/^https?:/i.test(text) ? text : `https://${text}`);
    pathname = url.pathname;
  } catch {
    pathname = text.replace(/^https?:\/\/[^/]+/i, "");
  }
  const parts = pathname.split("/").filter(Boolean).map((part) => decodeURIComponent(part).replace(/^@/, ""));
  if (skip.includes(parts[0]?.toLowerCase())) parts.shift();
  const name = parts[0] || "";
  if (!name || skip.includes(name.toLowerCase())) return "";
  return name.toLowerCase();
}
