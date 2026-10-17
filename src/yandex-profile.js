import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

export function decryptCookieValue(encrypted, key) {
  const buffer = Buffer.isBuffer(encrypted) ? encrypted : Buffer.from(encrypted || []);
  if (!buffer.length) return "";
  const prefix = buffer.subarray(0, 3).toString("utf8");
  if (prefix !== "v10" && prefix !== "v11") return buffer.toString("utf8");
  const iv = buffer.subarray(3, 15);
  const tag = buffer.subarray(buffer.length - 16);
  const data = buffer.subarray(15, buffer.length - 16);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}

export function extractVkAuth(buffer) {
  const texts = [buffer.toString("utf8"), buffer.toString("utf16le")];
  for (const text of texts) {
    const token = text.match(/"accessToken"\s*:\s*"([^"]+)"/);
    if (!token) continue;
    const refresh = text.match(/"refreshToken"\s*:\s*"([^"]+)"/);
    const clientId = text.match(/"clientId"\s*:\s*"([^"]+)"/);
    return {
      accessToken: token[1],
      refreshToken: refresh?.[1] || "",
      clientId: clientId?.[1] || "",
    };
  }
  return null;
}

export function yandexUserData() {
  const local = process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
  return path.join(local, "Yandex", "YandexBrowser", "User Data");
}

export function readYandexCookies(hostParts) {
  const userData = yandexUserData();
  if (!fs.existsSync(userData)) {
    throw new Error("Яндекс Браузер ещё ни разу не открывался на этом ПК.");
  }
  const key = encryptionKey(userData);
  const profiles = profileNames(userData);
  const wanted = hostParts.map((part) => part.toLowerCase());
  const cookies = [];
  for (const profile of profiles) {
    const dbPath = cookieDatabase(userData, profile);
    if (!dbPath) continue;
    for (const row of queryCookies(dbPath)) {
      const host = String(row.host_key || "").toLowerCase();
      if (!wanted.some((part) => host.includes(part))) continue;
      const encrypted = row.encrypted_value?.length ? row.encrypted_value : null;
      const value = encrypted ? decryptCookieValue(encrypted, key) : String(row.value || "");
      if (!value) continue;
      cookies.push({ name: row.name, value, domain: row.host_key, profile });
    }
    if (cookies.length) return cookies;
  }
  return cookies;
}

export function readVkAuthFromProfile() {
  const userData = yandexUserData();
  for (const profile of profileNames(userData)) {
    const dir = path.join(userData, profile, "Local Storage", "leveldb");
    if (!fs.existsSync(dir)) continue;
    for (const name of fs.readdirSync(dir)) {
      const file = path.join(dir, name);
      if (!fs.statSync(file).isFile()) continue;
      const found = extractVkAuth(fs.readFileSync(file));
      if (found?.accessToken) return found;
    }
  }
  return null;
}

function encryptionKey(userData) {
  const state = JSON.parse(fs.readFileSync(path.join(userData, "Local State"), "utf8"));
  const encoded = Buffer.from(state.os_crypt.encrypted_key, "base64").subarray(5);
  return unprotect(encoded);
}

function unprotect(buffer) {
  const script = `
Add-Type -AssemblyName System.Security
$in = [Convert]::FromBase64String('${buffer.toString("base64")}')
$out = [System.Security.Cryptography.ProtectedData]::Unprotect($in, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)
[Console]::Out.Write([Convert]::ToBase64String($out))
`;
  const output = execFileSync("powershell", ["-NoProfile", "-Command", script], { encoding: "utf8" });
  return Buffer.from(output.trim(), "base64");
}

function profileNames(userData) {
  try {
    const state = JSON.parse(fs.readFileSync(path.join(userData, "Local State"), "utf8"));
    const last = state.profile?.last_used || "Default";
    const names = Object.keys(state.profile?.info_cache || {});
    return [last, ...names.filter((name) => name !== last)];
  } catch {
    return ["Default"];
  }
}

function cookieDatabase(userData, profile) {
  const candidates = [
    path.join(userData, profile, "Network", "Cookies"),
    path.join(userData, profile, "Cookies"),
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) || "";
}

function queryCookies(dbPath) {
  try {
    return readCookieRows(dbPath);
  } catch {
    // Яндекс держит файл открытым. Читаем через общую копию.
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rundel-"));
  const copy = path.join(dir, "Cookies");
  copyShared(dbPath, copy);
  for (const suffix of ["-wal", "-shm"]) {
    const side = `${dbPath}${suffix}`;
    if (fs.existsSync(side)) {
      try {
        copyShared(side, `${copy}${suffix}`);
      } catch {
        // журнал не обязателен
      }
    }
  }
  try {
    return readCookieRows(copy);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function readCookieRows(dbPath) {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    return db.prepare("SELECT host_key, name, value, encrypted_value FROM cookies").all();
  } finally {
    db.close();
  }
}

function copyShared(source, dest) {
  const script = path.join(path.dirname(fileURLToPath(import.meta.url)), "locked-copy.ps1");
  try {
    execFileSync(
      "powershell",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", script, source, dest],
      { stdio: "pipe", windowsHide: true },
    );
  } catch {
    throw new Error("Яндекс не отдал вход, пока браузер открыт. Закрой Яндекс полностью, включая значок у часов, и нажми «Это я» ещё раз.");
  }
}
