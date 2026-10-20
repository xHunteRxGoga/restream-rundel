import test from "node:test";
import assert from "node:assert/strict";
import { parseYouTubeLivePage, readYouTubeActions, sapisidAuthorization } from "../src/connectors/youtube-web.js";
import { hiddenOnOverlay } from "../src/filter.js";
import { createHub } from "../src/hub.js";
import { renderSafeHtml } from "../src/render.js";
import { parseTwitchLine, takeIrcLines } from "../src/connectors/twitch.js";
import { parseKickContent } from "../src/connectors/kick.js";
import { vkTextFromBlocks } from "../src/connectors/vk.js";
import crypto from "node:crypto";
import { mergeConfig, defaultConfig, sanitizeLook } from "../src/config.js";
import { decryptCookieValue, extractVkAuth } from "../src/yandex-profile.js";
import { streamsFromInput } from "../src/stream-link.js";

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
  hub.setAliases({ [viewer.personKey]: "Кекс" });
  assert.equal(hub.history().find((item) => item.id === viewer.id).displayAuthor, "Кекс");
  assert.equal(hub.history().find((item) => item.id === bot.id).displayAuthor, "Nightbot");
});

test("one renamed person does not rename everyone who shares an id", () => {
  const hub = createHub();
  const gosha = hub.ingest({
    platform: "youtube",
    platformMessageId: "1",
    author: "Гоша",
    authorId: "UC-same",
    text: "раз",
  });
  const akim = hub.ingest({
    platform: "youtube",
    platformMessageId: "2",
    author: "Аким",
    authorId: "UC-same",
    text: "два",
  });
  hub.setAliases({ [gosha.personKey]: "Админ" });
  assert.equal(gosha.displayAuthor, "Админ");
  assert.equal(gosha.author, "Гоша");
  assert.equal(akim.displayAuthor, "Аким");
  assert.equal(akim.author, "Аким");
});

test("youtube page gives the chat continuation and a stable login hash", () => {
  const page = parseYouTubeLivePage(
    '{"INNERTUBE_API_KEY":"key","INNERTUBE_CLIENT_VERSION":"2.1","reloadContinuationData":{"continuation":"abc"},"sendLiveChatMessageEndpoint":{"params":"prm"}}',
    "https://www.youtube.com/watch?v=abcdefghijk",
  );
  assert.equal(page.isLive, true);
  assert.equal(page.videoId, "abcdefghijk");
  assert.equal(page.continuation, "abc");
  assert.equal(page.sendParams, "prm");
  assert.equal(sapisidAuthorization("sap", 1_700_000_000_000), "SAPISIDHASH 1700000000_296453377efedeefa95e96dccae831344ae92830");
  const batch = readYouTubeActions({
    continuationContents: {
      liveChatContinuation: {
        actions: [{
          addChatItemAction: {
            item: {
              liveChatTextMessageRenderer: {
                id: "m1",
                authorName: { simpleText: "Маша" },
                authorExternalChannelId: "UC1",
                message: { runs: [{ text: "привет" }] },
              },
            },
          },
        }],
        continuations: [{ timedContinuationData: { continuation: "next", timeoutMs: 3000 } }],
      },
    },
  });
  assert.equal(batch.messages[0].author, "Маша");
  assert.equal(batch.messages[0].text, "привет");
  assert.equal(batch.continuation, "next");
  assert.ok(batch.timeout <= 1800);
  const emoji = readYouTubeActions({
    continuationContents: {
      liveChatContinuation: {
        actions: [{
          addChatItemAction: {
            item: {
              liveChatTextMessageRenderer: {
                id: "m2",
                authorName: { simpleText: "Алён4ик34" },
                message: {
                  runs: [
                    { emoji: { shortcuts: [":rolling_on_the_floor_laughing:"], image: { thumbnails: [{ url: "https://fonts.gstatic.com/s/e/notoemoji/15.1/1f923/72.png" }] } } },
                    { emoji: { emojiId: "😂" } },
                    { emoji: { shortcuts: [":custom_cat:"], image: { thumbnails: [{ url: "https://yt3.ggpht.com/emoji/cat" }] } } },
                  ],
                },
              },
            },
          },
        }],
        continuations: [{ timedContinuationData: { continuation: "n", timeoutMs: 8000 } }],
      },
    },
  });
  assert.equal(emoji.messages[0].text, "🤣😂\uFFFC");
  assert.equal(emoji.messages[0].emotes[0].url, "https://yt3.ggpht.com/emoji/cat");
  assert.equal(emoji.timeout, 1800);
});

test("clearing the check removes only the fake messages", () => {
  const hub = createHub();
  hub.ingest({ platform: "twitch", platformMessageId: "sample-1", author: "keks", text: "тест" });
  hub.ingest({ platform: "kick", platformMessageId: "real-1", author: "лера", text: "живой" });
  hub.clearSamples();
  assert.deepEqual(hub.history().map((item) => item.text), ["живой"]);
});

test("chat look stays inside readable bounds", () => {
  const look = sanitizeLook({ fontSize: 999, opacity: -4, maxMessages: 0, align: "top", showTime: false });
  assert.equal(look.fontSize, 48);
  assert.equal(look.opacity, 0);
  assert.equal(look.maxMessages, 1);
  assert.equal(look.align, "top");
  assert.equal(look.showTime, false);
  assert.equal(look.showPlatform, true);
});

test("yandex cookie and vk token can be read back", () => {
  const key = crypto.randomBytes(32);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([cipher.update("auth-token-value"), cipher.final()]);
  const packed = Buffer.concat([Buffer.from("v10"), iv, data, cipher.getAuthTag()]);
  assert.equal(decryptCookieValue(packed, key), "auth-token-value");
  const found = extractVkAuth(Buffer.from('{"accessToken":"abc","refreshToken":"def","clientId":"g"}', "utf8"));
  assert.equal(found.accessToken, "abc");
  assert.equal(found.refreshToken, "def");
});

test("an empty secret does not wipe a saved token", () => {
  const saved = defaultConfig();
  saved.twitch.oauthToken = "secret-token";
  const next = mergeConfig(saved, { twitch: { oauthToken: "", channel: "MyChannel" } });
  assert.equal(next.twitch.oauthToken, "secret-token");
  assert.equal(next.twitch.channel, "MyChannel");
});

test("a stream link becomes the channel that chat should read", () => {
  const parsed = streamsFromInput({
    twitch: "https://www.twitch.tv/popout/Goga/chat",
    youtube: "https://www.youtube.com/@GogaLive/live",
    kick: "https://kick.com/goga",
    vk: "https://live.vkvideo.ru/goga",
  });
  assert.equal(parsed.twitch.channel, "goga");
  assert.equal(parsed.youtube.handle, "GogaLive");
  assert.equal(parsed.youtube.videoId, "");
  assert.equal(parsed.kick.channel, "goga");
  assert.equal(parsed.vk.channel, "goga");
  const video = streamsFromInput({ youtube: "https://youtu.be/dQw4w9wgxcQ" });
  assert.equal(video.youtube.videoId, "dQw4w9wgxcQ");
  assert.equal(video.youtube.handle, "");
});

test("a twitch line split across two packets still becomes one message", () => {
  const first = takeIrcLines("", "@id=m1 :user!u@h PRIVMSG #chan :при");
  assert.deepEqual(first.lines, []);
  const second = takeIrcLines(first.rest, "вет\r\n");
  assert.equal(second.lines.length, 1);
  assert.equal(parseTwitchLine(second.lines[0]).text, "привет");
});
