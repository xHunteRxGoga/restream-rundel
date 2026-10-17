import crypto from "node:crypto";
import { hiddenOnOverlay, DEFAULT_BOTS } from "./filter.js";
import { renderSafeHtml } from "./render.js";

const MAX_MESSAGES = 400;

export function personKey(platform, authorId, author) {
  if (authorId) return `${platform}:id:${authorId}`;
  return `${platform}:name:${String(author ?? "").trim().toLowerCase()}`;
}

export function createHub() {
  let bots = [...DEFAULT_BOTS];
  let ownNames = {};
  let ownIds = {};
  let aliases = {};
  const messages = [];
  const seen = new Set();
  const listeners = new Set();
  const pending = [];

  function emit(event) {
    for (const listener of listeners) listener(event);
  }

  function remember(key) {
    seen.add(key);
    if (seen.size > 5000) seen.clear();
  }

  function add(message) {
    messages.push(message);
    if (messages.length > MAX_MESSAGES) {
      messages.splice(0, messages.length - MAX_MESSAGES);
    }
    emit({ type: "message", message });
  }

  function update(message) {
    emit({ type: "message-update", message });
  }

  function syncOwnOverlay(message) {
    if (!message?.deliveries) return;
    const anyOk = message.deliveries.some((item) => item.status === "ok");
    message.overlay = anyOk && !hiddenOnOverlay(message, bots);
  }

  function isOwn(message) {
    const ownId = ownIds[message.platform];
    if (ownId && message.authorId) return String(ownId) === String(message.authorId);
    const ownName = ownNames[message.platform];
    if (!ownName || !message.author) return false;
    return message.author.trim().toLowerCase() === String(ownName).trim().toLowerCase();
  }

  function decorate(input) {
    const text = String(input.text ?? "").replace(/\r/g, "");
    const author = String(input.author ?? "").trim() || "без ника";
    const message = {
      id: input.id || crypto.randomUUID(),
      platform: input.platform,
      author,
      authorId: input.authorId ? String(input.authorId) : "",
      personKey: personKey(input.platform, input.authorId, author),
      displayAuthor: aliases[personKey(input.platform, input.authorId, author)] || author,
      text,
      safeHtml: renderSafeHtml(text, input.emotes),
      color: input.color || null,
      at: input.at || Date.now(),
      isBot: Boolean(input.isBot),
      own: Boolean(input.own),
      sample: Boolean(input.sample) || String(input.platformMessageId || "").startsWith("sample-"),
      deliveries: input.deliveries || null,
    };
    message.overlay = !hiddenOnOverlay(message, bots);
    return message;
  }

  return {
    history() {
      return messages;
    },
    setBots(list) {
      bots = (list?.length ? list : DEFAULT_BOTS).map((name) => String(name).trim()).filter(Boolean);
    },
    setOwnNames(map) {
      ownNames = map || {};
    },
    setOwnIds(map) {
      ownIds = map || {};
    },
    setAliases(map) {
      aliases = map || {};
      for (const message of messages) {
        const next = aliases[message.personKey] || message.author;
        if (next === message.displayAuthor) continue;
        message.displayAuthor = next;
        update(message);
      }
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    ingest(input) {
      if (!input?.platform || input.platform === "local") return null;
      const platformMessageId = input.platformMessageId ? String(input.platformMessageId) : "";
      if (platformMessageId) {
        const key = `${input.platform}:${platformMessageId}`;
        if (seen.has(key)) return null;
        remember(key);
      }

      const text = String(input.text ?? "").replace(/\r/g, "");
      const echo = pending.find(
        (item) =>
          item.text === text &&
          Date.now() - item.at < 20000 &&
          !item.seen.has(input.platform),
      );
      if (echo && isOwn({ ...input, text })) {
        echo.seen.add(input.platform);
        const own = messages.find((message) => message.id === echo.id);
        const delivery = own?.deliveries?.find((item) => item.platform === input.platform);
        if (delivery) {
          delivery.status = "ok";
          delivery.error = "";
          syncOwnOverlay(own);
          update(own);
        }
        return own ?? null;
      }

      const message = decorate(input);
      add(message);
      return message;
    },
    beginSend(text) {
      const clean = String(text ?? "").replace(/\r/g, "").trim();
      const message = decorate({
        id: `own-${crypto.randomUUID()}`,
        platform: "local",
        author: "ты",
        text: clean,
        own: true,
        deliveries: ["twitch", "youtube", "kick", "vk"].map((platform) => ({
          platform,
          status: "pending",
          error: "",
        })),
      });
      message.own = true;
      message.overlay = false;
      pending.push({ id: message.id, text: clean, at: message.at, seen: new Set() });
      if (pending.length > 30) pending.shift();
      add(message);
      return message;
    },
    finishSend(id, results) {
      const message = messages.find((item) => item.id === id);
      if (!message?.deliveries) return null;
      for (const result of results) {
        const delivery = message.deliveries.find((item) => item.platform === result.platform);
        if (!delivery || delivery.status === "ok") continue;
        delivery.status = result.ok ? "ok" : "error";
        delivery.error = result.ok ? "" : result.error || "не ушло";
      }
      syncOwnOverlay(message);
      update(message);
      return message;
    },
    clearSamples() {
      const ids = [];
      for (let index = messages.length - 1; index >= 0; index -= 1) {
        if (!messages[index].sample) continue;
        ids.push(messages[index].id);
        messages.splice(index, 1);
      }
      if (ids.length) emit({ type: "clear", ids });
      return ids;
    },
  };
}
