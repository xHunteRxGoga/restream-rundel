import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = 3927;
const outDir = path.join(root, "test-results");
fs.mkdirSync(outDir, { recursive: true });
fs.rmSync(path.join(outDir, "config.json"), { force: true });

const child = spawn(process.execPath, ["src/index.js"], {
  cwd: root,
  env: {
    ...process.env,
    PORT: String(port),
    NO_OPEN: "1",
    CONFIG_PATH: path.join(outDir, "config.json"),
  },
  stdio: ["ignore", "pipe", "pipe"],
});

let log = "";
child.stdout.on("data", (chunk) => {
  log += chunk.toString();
});
child.stderr.on("data", (chunk) => {
  log += chunk.toString();
});

try {
  await waitForReady();
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  const dock = await browser.newPage({ viewport: { width: 420, height: 760 } });
  const overlay = await browser.newPage({ viewport: { width: 480, height: 640 } });
  await dock.goto(`http://127.0.0.1:${port}/dock`);
  await overlay.goto(`http://127.0.0.1:${port}/overlay`);
  await dock.getByRole("button", { name: "Проверить" }).click();
  await dock.getByText("привет с твича").waitFor();
  await overlay.getByText("кик тоже здесь").waitFor();

  const dockText = await dock.locator("#log").innerText();
  const overlayText = await overlay.locator("#log").innerText();
  assertIncludes(dockText, ["привет с твича", "а на ютубе слышно?", "кик тоже здесь", "вк на связи", "Nightbot", "!song", "не на экране"]);
  assertIncludes(overlayText, ["привет с твича", "а на ютубе слышно?", "кик тоже здесь", "вк на связи"]);
  if (overlayText.includes("Nightbot") || overlayText.includes("!song")) {
    throw new Error(`На экране зрителей видны скрытые сообщения:\n${overlayText}`);
  }

  await dock.locator("#text").fill("проверка связи");
  await dock.getByRole("button", { name: "Во все" }).click();
  await dock.getByText("Twitch не подключён").waitFor();
  await dock.getByText("не на экране").nth(2).waitFor();
  const ownOnOverlay = await overlay.getByText("проверка связи").count();
  if (ownOnOverlay !== 0) throw new Error("На экран попало сообщение, которое никуда не ушло");

  await dock.getByRole("button", { name: "keks" }).click();
  await dock.locator("#nick-input").fill("Кекс");
  await dock.getByRole("button", { name: "Сохранить ник" }).click();
  await overlay.getByText("Кекс").waitFor();
  await dock.getByText("было keks").waitFor();
  const renamed = await overlay.locator("#log").innerText();
  if (renamed.includes("keks")) throw new Error(`На экране остался старый ник:\n${renamed}`);

  await dock.getByRole("button", { name: "Убрать проверку" }).click();
  await dock.getByText("привет с твича").waitFor({ state: "detached" });
  await overlay.getByText("кик тоже здесь").waitFor({ state: "detached" });
  const afterClear = await dock.locator("#log").innerText();
  if (afterClear.includes("Nightbot") || afterClear.includes("вк на связи")) {
    throw new Error(`Тестовые сообщения остались:\n${afterClear}`);
  }
  if (!afterClear.includes("проверка связи")) throw new Error("Убралось и своё сообщение");

  const editor = await browser.newPage({ viewport: { width: 1100, height: 760 } });
  await editor.goto(`http://127.0.0.1:${port}/look`);
  const frame = editor.frameLocator("iframe");
  await frame.getByText("привет с твича").waitFor();
  await editor.locator("#fontSize").fill("32");
  await editor.waitForFunction(() => {
    const text = document.querySelector("iframe")?.contentDocument?.querySelector(".text");
    return text && getComputedStyle(text).fontSize === "32px";
  });

  const settings = await browser.newPage({ viewport: { width: 900, height: 900 } });
  await settings.goto(`http://127.0.0.1:${port}/settings`);
  await settings.getByRole("heading", { name: "Старт" }).waitFor();
  await settings.getByRole("button", { name: "Войти через Twitch" }).waitFor();
  await settings.getByText("Пользовательские доки браузера").waitFor();
  const settingsText = await settings.locator("body").innerText();
  if (settingsText.includes("Client ID")) throw new Error("На старте опять просят Client ID");
  await settings.screenshot({ path: path.join(outDir, "settings.png") });

  await dock.screenshot({ path: path.join(outDir, "dock.png") });
  await overlay.screenshot({ path: path.join(outDir, "overlay.png"), omitBackground: true });
  await browser.close();
  console.log("browser ok");
} catch (error) {
  console.error(log);
  throw error;
} finally {
  child.kill();
}

function assertIncludes(text, parts) {
  for (const part of parts) {
    if (!text.includes(part)) throw new Error(`Не нашёл «${part}» в:\n${text}`);
  }
}

async function waitForReady() {
  const started = Date.now();
  while (Date.now() - started < 15000) {
    if (log.includes("Все чаты")) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Сервер не поднялся:\n${log}`);
}
