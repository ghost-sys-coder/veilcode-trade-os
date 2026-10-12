import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, lstat, link, unlink, open } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
const root = fileURLToPath(new URL("../.artifacts/companion/downloads/", import.meta.url));
const inputs = JSON.parse(await readFile(new URL("../integrations/companion/runtime-inputs.json", import.meta.url), "utf8"));
if (inputs.version !== 1 || inputs.platform !== "win-x64") throw Error("Invalid runtime inventory");
await mkdir(root, { recursive: true });
if ((await lstat(root)).isSymbolicLink()) throw Error("Unsafe artifact directory");
for (const entry of [inputs.node, inputs.python, ...inputs.wheels]) {
  const url = new URL(entry.url);
  if (url.protocol !== "https:" || !["nodejs.org", "www.python.org", "files.pythonhosted.org"].includes(url.hostname)
    || url.username || url.password || url.search || url.hash || !/^[a-f0-9]{64}$/.test(entry.sha256)) throw Error("Invalid pinned runtime");
  const filename = url.pathname.split("/").at(-1);
  if (!/^[A-Za-z0-9._-]+\.(zip|whl)$/.test(filename)) throw Error("Invalid runtime filename");
  const destination = join(root, filename);
  try {
    const cached = await readFile(destination);
    if (createHash("sha256").update(cached).digest("hex") !== entry.sha256) throw Error("Cached runtime checksum mismatch");
    console.log(`Verified cached ${filename}`); continue;
  } catch (error) { if (error.code !== "ENOENT") throw error; }
  const temporary = join(root, `download-${randomUUID()}.part`);
  const output = await open(temporary, "wx");
  try {
    const response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(120000) });
    if (!response.ok || !response.body) throw Error("Runtime download unavailable");
    const hash = createHash("sha256"); let total = 0;
    for await (const chunk of response.body) {
      total += chunk.length;
      if (total > 100 * 1024 * 1024) throw Error("Runtime archive exceeds limit");
      hash.update(chunk); await output.write(chunk);
    }
    await output.sync();
    if (hash.digest("hex") !== entry.sha256) throw Error("Runtime checksum mismatch");
    await output.close(); await link(temporary, destination);
    console.log(`Downloaded and verified ${filename} (${total} bytes)`);
  } finally { await output.close().catch(() => {}); await unlink(temporary).catch(() => {}); }
}
