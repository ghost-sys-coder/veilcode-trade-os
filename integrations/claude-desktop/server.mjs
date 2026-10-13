import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, readFile, readdir } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const ORIGINS = new Set(["https://tradeos.veilcode.studio", "https://mcp-preview.veilcode.studio"]);
const ISSUER = "https://nhwlxcrsivmawwmjiwck.supabase.co/auth/v1";
const keys = ["allowLoopback", "clientId", "issuer", "profile", "redirectUri", "resource", "version"];
const digest = value => createHash("sha256").update(value).digest("hex");

/** Reject remote/device/relative/alternate-stream paths and linked ancestors. */
export async function localPath(value) {
  if (typeof value !== "string" || !path.isAbsolute(value) || /[\x00-\x1f"<>|?*]/.test(value)
    || value.startsWith("\\\\") || value.startsWith("//")
    || (process.platform === "win32" && (!/^[A-Za-z]:\\/.test(value) || value.slice(2).includes(":")))
    || value.split(/[\\/]/).some(part => part === ".." || part === "." || /[ .]$/.test(part))) throw Error("UNSAFE_PATH");
  const target = path.resolve(value);
  for (let ancestor = target;; ancestor = path.dirname(ancestor)) {
    const info = await lstat(ancestor);
    if (info.isSymbolicLink()) throw Error("UNSAFE_PATH");
    if (ancestor === path.dirname(ancestor)) break;
  }
  return target;
}
async function boundedFile(file, maximum) {
  const location = await localPath(file);
  const info = await lstat(location);
  if (!info.isFile() || info.size > maximum) throw Error("INVALID_FILE");
  const bytes = await readFile(location);
  if (bytes.length !== info.size) throw Error("CHANGED_FILE");
  return bytes;
}
export function desktopConfig(config) {
  if (!config || typeof config !== "object" || Array.isArray(config)
    || Object.keys(config).sort().join() !== keys.join() || config.version !== 1 || config.allowLoopback !== false
    || config.issuer !== ISSUER || config.redirectUri !== "http://127.0.0.1:9884/callback"
    || typeof config.profile !== "string" || !config.profile.startsWith("tradeos-")
    || !UUID.test(config.profile.slice(8)) || typeof config.clientId !== "string" || !UUID.test(config.clientId)) throw Error("INVALID_SETUP");
  const resource = new URL(config.resource);
  if (!ORIGINS.has(resource.origin) || resource.pathname !== "/mcp" || resource.username || resource.password
    || resource.search || resource.hash || resource.href !== config.resource) throw Error("INVALID_SETUP");
  return config;
}
/** The release pin is generated at build time, not supplied by the selected installation. */
export async function verifyInstallation(rootValue, pin) {
  if (pin.version !== 1 || !/^[a-f0-9]{64}$/.test(pin.manifestSha256)) throw Error("INVALID_RELEASE");
  const root = await localPath(rootValue);
  const bytes = await boundedFile(path.join(root, "bundle-manifest.json"), 2_097_152);
  if (digest(bytes) !== pin.manifestSha256) throw Error("WRONG_COMPANION_RELEASE");
  const manifest = JSON.parse(bytes);
  if (manifest.version !== 1 || manifest.platform !== "win-x64" || !Array.isArray(manifest.files)
    || manifest.files.length < 5 || manifest.files.length > 5000) throw Error("INVALID_RELEASE");
  const seen = new Set(); let total = 0;
  for (const file of manifest.files) {
    if (typeof file.path !== "string" || !/^[A-Za-z0-9_@.\-/]+$/.test(file.path)
      || file.path.split("/").some(part => !part || part === "." || part === "..")
      || !/^[a-f0-9]{64}$/.test(file.sha256) || !Number.isSafeInteger(file.size) || file.size < 0) throw Error("INVALID_RELEASE");
    const key = file.path.toLowerCase(); if (seen.has(key)) throw Error("INVALID_RELEASE"); seen.add(key);
    total += file.size; if (total > 400_000_000) throw Error("INVALID_RELEASE");
    const location = await localPath(path.join(root, ...file.path.split("/")));
    const info = await lstat(location);
    if (!info.isFile() || info.size !== file.size) throw Error("MODIFIED_COMPANION");
    const hash = createHash("sha256"); let received = 0;
    for await (const part of createReadStream(location)) { received += part.length; hash.update(part); }
    if (received !== file.size || hash.digest("hex") !== file.sha256) throw Error("MODIFIED_COMPANION");
  }
  for (const required of ["tradeosmcp.exe", "tradeos.exe", "runtime/node/node.exe", "runtime/python/python.exe", "runtime/python/pythonw.exe"])
    if (!seen.has(required)) throw Error("INVALID_RELEASE");
  // Reject added scripts/DLLs too: matching existing files alone is not a sealed installation.
  const folders = [root]; let entries = 0;
  while (folders.length) {
    const folder = folders.pop();
    for (const entry of await readdir(folder, { withFileTypes: true })) {
      if (++entries > 10_000 || entry.isSymbolicLink()) throw Error("MODIFIED_COMPANION");
      const location = await localPath(path.join(folder, entry.name));
      if (entry.isDirectory()) folders.push(location);
      else if (!entry.isFile() || (!seen.has(path.relative(root, location).split(path.sep).join("/").toLowerCase())
        && location !== path.join(root, "bundle-manifest.json"))) throw Error("MODIFIED_COMPANION");
    }
  }
  return path.join(root, "TradeOSMcp.exe");
}
export async function launch(root, setupFile) {
  if (process.platform !== "win32") throw Error("WINDOWS_REQUIRED");
  const config = desktopConfig(JSON.parse(await boundedFile(setupFile, 65_536)));
  const pin = JSON.parse(await boundedFile(fileURLToPath(new URL("./trusted-release.json", import.meta.url)), 4096));
  const executable = await verifyInstallation(root, pin);
  // Only public setup files are read. Credential renewal/grants remain in the existing adapter.
  const dataRoot = process.env.LOCALAPPDATA;
  if (!dataRoot) throw Error("SETUP_NOT_IMPORTED");
  const stored = desktopConfig(JSON.parse(await boundedFile(path.join(dataRoot, "TradeOS", "companion", "profiles", config.profile.slice(8), "setup.json"), 65_536)));
  if (keys.some(key => stored[key] !== config[key])) throw Error("SETUP_MISMATCH");
  const env = {};
  for (const name of ["LOCALAPPDATA", "APPDATA", "USERPROFILE", "TEMP", "TMP", "SystemRoot", "WINDIR"])
    if (process.env[name]) env[name] = process.env[name];
  const child = spawn(executable, ["--profile", config.profile.slice(8)], {
    cwd: path.dirname(executable), env, shell: false, windowsHide: true, stdio: ["pipe", "pipe", "pipe"],
  });
  child.once("error", () => { process.stderr.write("Trade OS: companion launch failed. Re-download the matched preview from your setup page.\n"); process.exitCode = 1; });
  process.stdin.pipe(child.stdin); child.stdout.pipe(process.stdout); child.stderr.pipe(process.stderr);
  child.stdin.on("error", () => { /* Child close is handled below; never log user input. */ });
  let ended = false;
  const stop = () => { if (!ended) child.kill(); };
  process.once("exit", stop); process.once("SIGINT", stop); process.once("SIGTERM", stop);
  child.once("close", code => { ended = true; process.stdin.unpipe(child.stdin); process.stdin.pause(); process.exitCode = code ?? 1; });
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 4) { process.stderr.write("Trade OS: choose the companion folder and Desktop setup file in Extensions settings.\n"); process.exitCode = 1; }
  else launch(process.argv[2], process.argv[3]).catch(() => {
    process.stderr.write("Trade OS: Desktop setup could not be verified. Use the matching companion and tradeos-claude_desktop JSON downloaded from your app setup page; import and approve it in the companion first.\n");
    process.exitCode = 1;
  });
}
