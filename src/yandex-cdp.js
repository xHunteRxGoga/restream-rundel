import fs from "node:fs";
import path from "node:path";
import { spawn, execFileSync } from "node:child_process";
import { yandexUserData } from "./yandex-profile.js";

const DEBUG_PORT = 9333;

export async function grabSession(platform, pageUrl) {
  const browser = await ensureYandex(pageUrl);
  try {
    const context = browser.contexts()[0];
    if (!context) throw new Error("Яндекс открылся без твоего профиля.");
    const page = await context.newPage();
    await page.goto(pageUrl, { waitUntil: "domcontentloaded", timeout: 45000 }).catch(() => {});
    let vkAuth = null;
    if (platform === "vk") {
      const raw = await page.evaluate(() => localStorage.getItem("auth")).catch(() => "");
      if (raw) {
        try {
          vkAuth = JSON.parse(raw);
        } catch {
          vkAuth = null;
        }
      }
    }
    await page.close().catch(() => {});
    const cookies = await context.cookies(cookieUrls(platform));
    return { cookies, vkAuth };
  } finally {
    await browser.disconnect();
  }
}

async function ensureYandex(url) {
  const { chromium } = await import("playwright");
  if (await debugUp()) return chromium.connectOverCDP(`http://127.0.0.1:${DEBUG_PORT}`);

  const executablePath = findYandexBrowser();
  if (!executablePath) {
    throw new Error("Не нашёл Яндекс Браузер. Поставь его с https://browser.yandex.ru и нажми вход ещё раз.");
  }
  stopYandex();
  await pause(1200);
  const userData = yandexUserData();
  for (const name of ["SingletonLock", "SingletonCookie", "SingletonSocket"]) {
    fs.rmSync(`${userData}\\${name}`, { force: true });
  }
  const child = spawn(executablePath, [
    `--remote-debugging-port=${DEBUG_PORT}`,
    "--remote-allow-origins=*",
    `--user-data-dir=${userData}`,
    "--restore-last-session",
    "--no-first-run",
    "--no-default-browser-check",
    url,
  ], { detached: true, stdio: "ignore" });
  child.unref();
  await waitForDebug();
  return chromium.connectOverCDP(`http://127.0.0.1:${DEBUG_PORT}`);
}

function stopYandex() {
  const script = "Get-CimInstance Win32_Process -Filter \"name = 'browser.exe'\" | Where-Object { $_.ExecutablePath -like '*YandexBrowser*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }";
  try {
    execFileSync("powershell", ["-NoProfile", "-NonInteractive", "-Command", script], {
      stdio: "pipe",
      windowsHide: true,
    });
  } catch {
    // браузер уже закрыт
  }
}

async function debugUp() {
  try {
    const response = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/version`);
    return response.ok;
  } catch {
    return false;
  }
}

async function waitForDebug() {
  const started = Date.now();
  while (Date.now() - started < 25000) {
    if (await debugUp()) return;
    await pause(300);
  }
  throw new Error("Яндекс не открылся заново. Нажми вход ещё раз.");
}

function cookieUrls(platform) {
  if (platform === "twitch") return ["https://www.twitch.tv", "https://twitch.tv"];
  if (platform === "youtube") return ["https://www.youtube.com", "https://accounts.google.com", "https://www.google.com"];
  if (platform === "kick") return ["https://kick.com", "https://www.kick.com"];
  return ["https://live.vkvideo.ru"];
}

function pause(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function findYandexBrowser() {
  const local = process.env.LOCALAPPDATA || "";
  const roots = [
    path.join(local, "Yandex", "YandexBrowser", "Application", "browser.exe"),
    path.join(process.env.ProgramFiles || "C:\\Program Files", "Yandex", "YandexBrowser", "Application", "browser.exe"),
    path.join(process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)", "Yandex", "YandexBrowser", "Application", "browser.exe"),
  ];
  for (const candidate of roots) {
    if (fs.existsSync(candidate)) return candidate;
    const folder = path.dirname(candidate);
    if (!fs.existsSync(folder)) continue;
    for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const nested = path.join(folder, entry.name, "browser.exe");
      if (fs.existsSync(nested)) return nested;
    }
  }
  return "";
}
