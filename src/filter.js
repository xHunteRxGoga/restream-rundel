export const DEFAULT_BOTS = [
  "nightbot",
  "streamelements",
  "streamlabs",
  "fossabot",
  "moobot",
  "wizebot",
  "soundalerts",
  "botrix",
  "sery_bot",
  "streamstickers",
  "kofistreambot",
  "own3d",
  "streamholics",
  "livetools",
];

export function isCommand(text) {
  return /^\s*!/.test(text ?? "");
}

export function hiddenOnOverlay(message, botNames = DEFAULT_BOTS) {
  if (isCommand(message.text)) return true;
  if (message.isBot) return true;
  const author = (message.author ?? "").trim().toLowerCase();
  return botNames.some((name) => author === String(name).trim().toLowerCase());
}
