import { readFile, mkdir, writeFile, copyFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { verifyInstallation, localPath } from "../integrations/claude-desktop/server.mjs";

const project = fileURLToPath(new URL("..", import.meta.url));
const build = JSON.parse(await readFile(join(project, ".artifacts/companion/latest-build.json"), "utf8"));
if (process.platform !== "win32" || build.state !== "UNRELEASED"
  || !resolve(build.stage).startsWith(join(project, ".artifacts/companion/build-"))) throw Error("Isolated Windows preview build required");
const manifest = await readFile(join(build.stage, "bundle-manifest.json"));
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
const pin = { version: 1, manifestSha256: sha256(manifest) };
const output = join(project, ".artifacts/claude-desktop", `build-${Date.now()}`);
await mkdir(output, { recursive: true });
// Build staging contains wheel intermediates deliberately excluded from the installer.
// Verify an exact copy of the final inventory, never relax installed-file checks.
const sealed = join(output, "companion-check"); await mkdir(sealed);
for (const file of JSON.parse(manifest).files) {
  if (typeof file.path !== "string" || file.path.split("/").some(part => !part || part === "." || part === "..")
    || !/^[A-Za-z0-9_@.\-/]+$/.test(file.path)) throw Error("Invalid build inventory");
  const source = await localPath(join(build.stage, ...file.path.split("/")));
  const destination = join(sealed, ...file.path.split("/"));
  await mkdir(join(destination, ".."), { recursive: true }); await copyFile(source, destination);
}
await writeFile(join(sealed, "bundle-manifest.json"), manifest, { flag: "wx" });
await verifyInstallation(sealed, pin);
// The exact packaged bootstrap must recognize Desktop, not just the development source.
execFileSync(join(sealed, "runtime/python/python.exe"), ["-B", "-I", "-c",
  'from trade_os_companion.setup import PORT_CLIENTS;assert PORT_CLIENTS.get("http://127.0.0.1:9884/callback")=="CLAUDE_DESKTOP"'],
  { windowsHide: true, stdio: ["ignore", "pipe", "pipe"], timeout: 30_000 });
// Imports must not mutate the installation accepted by the Desktop extension.
// Re-check the entire exact inventory after running the actual packaged bootstrap.
await verifyInstallation(sealed, pin);
for (const name of ["manifest.json", "server.mjs"])
  await copyFile(join(project, "integrations/claude-desktop", name), join(output, name));
await writeFile(join(output, "trusted-release.json"), JSON.stringify(pin) + "\n", { flag: "wx" });
// MCPB is a ZIP with a root manifest. STORE keeps this tiny three-file bundle deterministic.
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) { crc ^= byte; for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
  return (crc ^ 0xffffffff) >>> 0;
}
const local = [], central = []; let offset = 0;
for (const name of ["manifest.json", "server.mjs", "trusted-release.json"]) {
  const contents = await readFile(join(output, name)), filename = Buffer.from(name), crc = crc32(contents);
  const header = Buffer.alloc(30); header.writeUInt32LE(0x04034b50); header.writeUInt16LE(20, 4);
  header.writeUInt16LE(0x21, 12); header.writeUInt32LE(crc, 14); header.writeUInt32LE(contents.length, 18);
  header.writeUInt32LE(contents.length, 22); header.writeUInt16LE(filename.length, 26);
  local.push(header, filename, contents);
  const index = Buffer.alloc(46); index.writeUInt32LE(0x02014b50); index.writeUInt16LE(20, 4); index.writeUInt16LE(20, 6);
  index.writeUInt16LE(0x21, 14); index.writeUInt32LE(crc, 16); index.writeUInt32LE(contents.length, 20);
  index.writeUInt32LE(contents.length, 24); index.writeUInt16LE(filename.length, 28); index.writeUInt32LE(offset, 42);
  central.push(index, filename); offset += header.length + filename.length + contents.length;
}
const directory = Buffer.concat(central), end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50); end.writeUInt16LE(3, 8); end.writeUInt16LE(3, 10);
end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
const bytes = Buffer.concat([...local, directory, end]);
const artifact = join(output, "TradeOS-Claude-Desktop-Windows.mcpb");
await writeFile(artifact, bytes, { flag: "wx" });
const result = { state: "UNRELEASED", artifact, stage: output, companionStage: build.stage,
  companionManifestSha256: pin.manifestSha256, bytes: bytes.length, sha256: sha256(bytes) };
await writeFile(join(project, ".artifacts/claude-desktop/latest-build.json"), JSON.stringify(result, null, 2) + "\n");
console.log(JSON.stringify(result));
