import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const keyFile = new URL("../supabase/signing_keys.json", import.meta.url);

try {
  // This ignored artifact belongs only to the disposable local Auth server.
  // Never load production .env or replace an existing signing key.
  let keys;
  try {
    keys = JSON.parse(await readFile(keyFile, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    // CLI validates the configured path before it can generate its first key.
    await writeFile(keyFile, "[]\n", { flag: "wx", mode: 0o600 });
    keys = [];
  }
  if (!Array.isArray(keys)) throw new Error("Invalid local key artifact.");
  if (!keys.length) {
    execFileSync("supabase", ["gen", "signing-key", "--algorithm", "ES256", "--yes"], {
      cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 30_000,
    });
    keys = JSON.parse(await readFile(keyFile, "utf8"));
  }
  if (!keys.length || !keys.every((key) => key?.kty === "EC" && key.alg === "ES256"
    && key.crv === "P-256" && [key.kid, key.d, key.x, key.y].every((part) => typeof part === "string" && part.length > 0))) {
    throw new Error("Local Auth requires an ES256 signing key.");
  }
  console.log("Local ES256 signing material is ready; existing keys preserved. Private material is ignored by Git and is not logged.");
} catch {
  console.error("Local Auth preparation failed. Check Supabase CLI and the ignored signing-key artifact; details suppressed to protect key material.");
  process.exitCode = 1;
}
