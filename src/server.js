import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createServer } from "node:http";
import { WebSocketServer } from "ws";
import { PLATFORMS } from "./platforms.js";
import { slug, sanitizeLook } from "./config.js";
import { personKey } from "./hub.js";
import { bridgePage, exchangeCode, implicitPatch, redirectUri, startUrl } from "./oauth.js";
import { finishLogin, openLoginTab } from "./browser-login.js";

const FILES = {
  "/app.css": ["app.css", "text/css; charset=utf-8"],
  "/app.js": ["app.js", "text/javascript; charset=utf-8"],
  "/settings.js": ["settings.js", "text/javascript; charset=utf-8"],
  "/dock": ["dock.html", "text/html; charset=utf-8"],
  "/overlay": ["overlay.html", "text/html; charset=utf-8"],
  "/settings": ["settings.html", "text/html; charset=utf-8"],
  "/look": ["look.html", "text/html; charset=utf-8"],
  "/look.js": ["look.js", "text/javascript; charset=utf-8"],
};

export function createApp({ root, store, hub, statuses, connectors, bindPublish }) {
  const publicDir = path.join(root, "public");

  function publish(event) {
    const data = JSON.stringify(event);
    for (const client of wss.clients) {
      if (client.readyState === 1) client.send(data);
    }
  }

  bindPublish(publish);
  hub.subscribe(publish);

  const server = createServer(async (request, response) => {
    try {
      await route(request, response);
    } catch (error) {
      console.error(error);
      sendJson(response, 500, { error: "Сбой на сервере чата." });
    }
  });

  const wss = new WebSocketServer({ server, path: "/ws" });
  let listenFailed = false;
  const onListenError = (error) => {
    if (listenFailed) return;
    listenFailed = true;
    if (error?.code === "EADDRINUSE") {
      console.log("Чат уже был запущен. Закрой старое чёрное окно и запусти start.bat ещё раз.");
    } else {
      console.log(error?.message || error);
    }
    process.exit(1);
  };
  server.on("error", onListenError);
  wss.on("error", onListenError);
  wss.on("connection", (socket) => {
    socket.send(JSON.stringify(publicState("snapshot")));
  });

  return server;

  async function route(request, response) {
    const url = new URL(request.url, "http://127.0.0.1");
    if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/dock")) {
      return sendFile(response, "/dock");
    }
    if (request.method === "GET" && FILES[url.pathname]) return sendFile(response, url.pathname);
    if (request.method === "GET" && url.pathname === "/api/state") {
      return sendJson(response, 200, publicState("state"));
    }
    if (request.method === "GET" && url.pathname === "/api/config") {
      return sendJson(response, 200, store.get());
    }
    if (request.method === "POST" && url.pathname === "/api/look") {
      const look = sanitizeLook(await readJson(request));
      store.save({ look });
      publish({ type: "look", look });
      return sendJson(response, 200, { ok: true, look });
    }
    if (request.method === "POST" && url.pathname === "/api/config") {
      const patch = normalizePatch(await readJson(request));
      store.save(patch, { clear: patch.clear || [] });
      connectors.reload();
      return sendJson(response, 200, { ok: true });
    }
    if (request.method === "POST" && url.pathname === "/api/send") {
      const body = await readJson(request);
      const text = String(body.text ?? "").trim();
      if (!text) return sendJson(response, 400, { error: "Пустое сообщение." });
      if (text.length > 500) return sendJson(response, 400, { error: "Длиннее 500 символов." });
      const message = hub.beginSend(text);
      const results = await connectors.send(text);
      hub.finishSend(message.id, results);
      return sendJson(response, 200, { ok: true });
    }
    if (request.method === "POST" && url.pathname === "/api/alias") {
      const body = await readJson(request);
      const key = String(body.personKey || personKey(body.platform, body.authorId, body.author));
      if (!/^(twitch|youtube|kick|vk|local):(id|name):/.test(key) || key.length > 120 || /[\r\n]/.test(key)) {
        return sendJson(response, 400, { error: "Не понял, чей это ник." });
      }
      const display = String(body.display ?? "").replace(/\s+/g, " ").trim().slice(0, 40);
      store.save({ aliases: { [key]: display } });
      hub.setAliases(store.get().aliases || {});
      return sendJson(response, 200, { ok: true, display });
    }
    if (request.method === "POST" && url.pathname === "/api/test/clear") {
      hub.clearSamples();
      return sendJson(response, 200, { ok: true });
    }
    if (request.method === "POST" && url.pathname === "/api/test") {
      injectSamples(hub);
      return sendJson(response, 200, { ok: true });
    }
    if (request.method === "POST" && /^\/api\/login\/(twitch|youtube|kick|vk)(\/finish)?$/.test(url.pathname)) {
      const parts = url.pathname.split("/");
      const platform = parts[3];
      const finish = parts[4] === "finish";
      try {
        if (!finish) {
          openLoginTab(platform);
          return sendJson(response, 200, { ok: true, opened: true });
        }
        const patch = await finishLogin(platform);
        store.save(patch);
        connectors.reload();
        return sendJson(response, 200, { ok: true, name: signedInName(patch) });
      } catch (error) {
        return sendJson(response, 400, { error: error.message || "Вход не удался." });
      }
    }
    if (request.method === "POST" && url.pathname === "/api/oauth/store") {
      const body = await readJson(request);
      const patch = implicitPatch(body.platform, body);
      if (!patch || !body.accessToken) return sendJson(response, 400, { error: "Нет токена." });
      store.save(patch);
      connectors.reload();
      return sendJson(response, 200, { ok: true });
    }
    const oauth = url.pathname.match(/^\/oauth\/(twitch|youtube|kick|vk)(\/start)?$/);
    if (request.method === "GET" && oauth) {
      const platform = oauth[1];
      if (oauth[2]) {
        const started = startUrl(platform, store.get());
        if (started.error) return sendText(response, 400, started.error);
        response.writeHead(302, { Location: started.url });
        response.end();
        return;
      }
      if (platform === "twitch" || platform === "vk") {
        response.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
        response.end(bridgePage(platform));
        return;
      }
      const exchanged = await exchangeCode(platform, Object.fromEntries(url.searchParams), store.get());
      if (exchanged.error) return sendText(response, 400, exchanged.error);
      store.save(exchanged.patch);
      connectors.reload();
      response.writeHead(302, { Location: `/settings?connected=${platform}` });
      response.end();
      return;
    }
    sendText(response, 404, "Нет такой страницы.");
  }

  function sendFile(response, routePath) {
    const [name, type] = FILES[routePath];
    const file = path.join(publicDir, name);
    response.writeHead(200, { "Content-Type": type, "Cache-Control": "no-store" });
    fs.createReadStream(file).pipe(response);
  }

  function publicState(type) {
    return {
      type,
      messages: hub.history(),
      statuses,
      redirects: redirectMap(),
      look: store.get().look,
    };
  }
}

function signedInName(patch) {
  return patch.twitch?.login || patch.youtube?.channelId || patch.kick?.channel || patch.vk?.displayName || patch.vk?.channel || "";
}

function redirectMap() {
  return Object.fromEntries(PLATFORMS.map((platform) => [platform, redirectUri(platform)]));
}

function normalizePatch(patch) {
  const next = { ...patch };
  for (const platform of ["twitch", "kick", "vk"]) {
    if (next[platform]?.channel) next[platform] = { ...next[platform], channel: slug(next[platform].channel) };
  }
  return next;
}

function injectSamples(hub) {
  const samples = [
    {
      platform: "twitch",
      author: "keks",
      text: "Kappa привет с твича",
      emotes: [{ name: "Kappa", start: 0, end: 5, url: "https://static-cdn.jtvnw.net/emoticons/v2/25/default/dark/2.0" }],
    },
    { platform: "youtube", author: "Маша", text: "а на ютубе слышно?" },
    { platform: "kick", author: "rain", text: "кик тоже здесь" },
    { platform: "vk", author: "вова", text: "вк на связи" },
    { platform: "twitch", author: "Nightbot", text: "Добро пожаловать на стрим!" },
    { platform: "youtube", author: "лера", text: "!song" },
  ];
  for (const sample of samples) {
    hub.ingest({
      ...sample,
      platformMessageId: `sample-${crypto.randomUUID()}`,
    });
  }
}

function sendJson(response, status, body) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  response.end(JSON.stringify(body));
}

function sendText(response, status, text) {
  response.writeHead(status, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
  response.end(text);
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > 1_000_000) {
        reject(new Error("Слишком большой запрос."));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => {
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        reject(new Error("Не JSON."));
      }
    });
    request.on("error", reject);
  });
}
