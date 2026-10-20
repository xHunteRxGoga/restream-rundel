const ALLOWED_HOST_SUFFIXES = [
  "jtvnw.net",
  "kick.com",
  "kickcdn.com",
  "ggpht.com",
  "gstatic.com",
  "ytimg.com",
  "googleusercontent.com",
  "vkvideo.ru",
  "vk.com",
  "userapi.com",
];

export function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => {
    switch (char) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      default:
        return "&#39;";
    }
  });
}

export function emoteUrlAllowed(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return false;
    return ALLOWED_HOST_SUFFIXES.some(
      (suffix) => parsed.hostname === suffix || parsed.hostname.endsWith(`.${suffix}`),
    );
  } catch {
    return false;
  }
}

export function avatarUrlAllowed(url) {
  return emoteUrlAllowed(url);
}

export function renderSafeHtml(text, emotes = []) {
  const source = String(text ?? "");
  const sorted = emotes
    .filter((emote) => emote && emoteUrlAllowed(emote.url))
    .filter((emote) => Number.isInteger(emote.start) && Number.isInteger(emote.end))
    .filter((emote) => emote.start >= 0 && emote.end > emote.start && emote.end <= source.length)
    .sort((a, b) => a.start - b.start);

  let html = "";
  let cursor = 0;
  for (const emote of sorted) {
    if (emote.start < cursor) continue;
    html += escapeHtml(source.slice(cursor, emote.start));
    const name = escapeHtml(emote.name || "emote");
    const src = escapeHtml(emote.url);
    html += `<img class="emote" alt="${name}" src="${src}">`;
    cursor = emote.end;
  }
  html += escapeHtml(source.slice(cursor));
  return html;
}
