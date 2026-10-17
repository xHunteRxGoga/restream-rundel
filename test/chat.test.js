import assert from "node:assert/strict";
import test from "node:test";
import { hiddenOnOverlay } from "../src/filter.js";
import { createHub } from "../src/hub.js";
import { renderSafeHtml } from "../src/render.js";
import { parseTwitchLine } from "../src/connectors/twitch.js";
import { parseKickContent } from "../src/connectors/kick.js";
import { vkTextFromBlocks } from "../src/connectors/vk.js";
import { mergeConfig, defaultConfig } from "../src/config.js";

test("commands and known bots stay off the overlay", () => {
  assert.equal(hiddenOnOverlay({ text: "!song", author: "лера" }), true);
  assert.equal(hiddenOnOverlay({ text: "привет", author: "Nightbot" }), true);
  assert.equal(hiddenOnOverlay({ text: "привет", author: "лера", isBot: true }), true);
  assert.equal(hiddenOnOverlay({ text: "привет", author: "лера" }), false);
});

test("chat html escapes text and keeps a real emote", () => {
  const html = renderSafeHtml('Kappa <script>', [
    { name: "Kappa", start: 0, end: 5, url: "https://static-cdn.jtvnw.net/emoticons/v2/25/default/dark/2.0" },
  ]);
  assert.match(html, /<img class="emote"/);
  assert.match(html, /&lt;script&gt;/);
  assert.equal(html.includes("<script>"), false);
});

test("foreign image addresses are not turned into images", () => {
  const html = renderSafeHtml("x", [{ name: "x", start: 0, end: 1, url: "https://evil.example/x.png" }]);
  assert.equal(html.includes("<img"), false);
  assert.equal(html, "x");
});

test("twitch line keeps the author, color and emote range", () => {
  const event = parseTwitchLine(
    "@color=#FF00FF;display-name=Keks;emotes=25:0-4;id=abc;user-id=42;badges= :keks!keks@keks.tmi.twitch.tv PRIVMSG #chan :Kappa hello",
  );
  assert.equal(event.author, "Keks");
  assert.equal(event.authorId, "42");
  assert.equal(event.text, "Kappa hello");
  assert.equal(event.emotes[0].end, 5);
  assert.equal(event.emotes[0].name, "Kappa");
});

test("kick emote marker becomes a name plus an image", () => {
  const parsed = parseKickContent("go [emote:1730752:KEKW] now");
  assert.equal(parsed.text, "go KEKW now");
  assert.equal(parsed.emotes[0].name, "KEKW");
  assert.match(parsed.emotes[0].url, /^https:\/\/files\.kick\.com\/emotes\/1730752\//);
});

test("vk blocks become one line", () => {
  const parsed = vkTextFromBlocks([
    { type: "text", content: JSON.stringify(["привет ", "unstyled", []]), modificator: "" },
    { type: "text", content: "", modificator: "BLOCK_END" },
    { type: "smile", id: "1", name: "kappa" },
  ]);
  assert.equal(parsed.text, "привет kappa");
});

test("the streamer's own echo does not become a second row", () => {
  const hub = createHub();
  hub.setOwnNames({ twitch: "streamer" });
  hub.setOwnIds({ twitch: "7" });
  const own = hub.beginSend("привет");
  hub.ingest({
    platform: "twitch",
    platformMessageId: "echo-1",
    author: "streamer",
    authorId: "7",
    text: "привет",
  });
  hub.ingest({
    platform: "twitch",
    platformMessageId: "viewer-1",
    author: "viewer",
    authorId: "9",
    text: "привет",
  });
  const history = hub.history();
  assert.equal(history.length, 2);
  assert.equal(history[0].id, own.id);
  assert.equal(history[0].deliveries.find((item) => item.platform === "twitch").status, "ok");
  assert.equal(history[1].author, "viewer");
});

test("a command typed by the streamer is hidden from viewers", () => {
  const hub = createHub();
  const message = hub.beginSend("!song");
  hub.finishSend(message.id, [{ platform: "twitch", ok: true }]);
  assert.equal(message.overlay, false);
});

test("a reply shows on the overlay only after a platform accepts it", () => {
  const hub = createHub();
  const message = hub.beginSend("привет");
  assert.equal(message.overlay, false);
  hub.finishSend(message.id, [
    { platform: "twitch", ok: false, error: "нет" },
    { platform: "youtube", ok: false, error: "нет" },
    { platform: "kick", ok: false, error: "нет" },
    { platform: "vk", ok: false, error: "нет" },
  ]);
  assert.equal(message.overlay, false);
  hub.finishSend(message.id, [{ platform: "kick", ok: true }]);
  assert.equal(message.overlay, true);
});

test("an alias renames a person on screen and still hides the original bot nick", () => {
  const hub = createHub();
  hub.setAliases({ "twitch:name:nightbot": "Ночной" });
  const bot = hub.ingest({
    platform: "twitch",
    platformMessageId: "bot-1",
    author: "Nightbot",
    text: "привет",
  });
  assert.equal(bot.displayAuthor, "Ночной");
  assert.equal(bot.author, "Nightbot");
  assert.equal(bot.overlay, false);

  const viewer = hub.ingest({
    platform: "twitch",
    platformMessageId: "viewer-2",
    author: "keks",
    authorId: "5",
    text: "йо",
  });
  assert.equal(viewer.displayAuthor, "keks");
  hub.setAliases({ "twitch:id:5": "Кекс" });
  assert.equal(hub.history().find((item) => item.id === viewer.id).displayAuthor, "Кекс");
  assert.equal(hub.history().find((item) => item.id === bot.id).displayAuthor, "Nightbot");
});

test("an empty secret does not wipe a saved token", () => {
  const saved = defaultConfig();
  saved.twitch.oauthToken = "secret-token";
  const next = mergeConfig(saved, { twitch: { oauthToken: "", channel: "MyChannel" } });
  assert.equal(next.twitch.oauthToken, "secret-token");
  assert.equal(next.twitch.channel, "MyChannel");
});
