import "server-only";
import { request as httpsRequest } from "node:https";
import { request as httpRequest } from "node:http";
import { getSupabaseConfig } from "@/config/env";
import { FILE_MAX_BYTES, PrivateFileError } from "@/domain/files/commands";
import { fileDigest } from "@/services/files/content";

export type FileBucket = "trade-screenshots" | "trade-file-staging";
export interface PrivateFileStorage {
  get(bucket: FileBucket, path: string, maximum: number): Promise<Buffer>;
  put(bucket: FileBucket, path: string, bytes: Buffer, contentType: string): Promise<void>;
}
class StorageObjectMissing extends Error {}
/** Lazy server-only credentials; no redirects, shared sockets or unbounded bodies. */
export function privateFileStorage(): PrivateFileStorage {
  const { url } = getSupabaseConfig(), key = process.env.SUPABASE_SECRET_KEY;
  const target = new URL(url);
  const local = process.env.TRADE_OS_LOCAL_TEST_APP === "true" && ["127.0.0.1", "localhost", "[::1]"].includes(target.hostname);
  if (!key || key.length < 20 || (!key.startsWith("sb_secret_") && !local) || (target.protocol !== "https:" && !local)) throw new PrivateFileError("STORAGE_NOT_CONFIGURED");

  function transfer(bucket: FileBucket, path: string, maximum: number, bytes?: Buffer, contentType?: string): Promise<{status: number; bytes: Buffer}> {
    if (!["trade-screenshots", "trade-file-staging"].includes(bucket) || !Number.isSafeInteger(maximum) || maximum < 1 || maximum > FILE_MAX_BYTES) throw new PrivateFileError("INVALID_FILE_PATH");
    const endpoint = new URL(`${url.replace(/\/$/, "")}/storage/v1/object/${bytes ? "" : "authenticated/"}${bucket}/${path.split("/").map(encodeURIComponent).join("/")}`);
    return new Promise((resolve, reject) => {
      const request = (endpoint.protocol === "https:" ? httpsRequest : httpRequest)(endpoint, {
        method: bytes ? "POST" : "GET", agent: false, signal: AbortSignal.timeout(10_000),
        headers: { apikey: key!, Authorization: `Bearer ${key}`, "Accept-Encoding": "identity", "User-Agent": "trade-os-private-files/1", Connection: "close",
          ...(bytes ? { "Content-Type": contentType!, "Content-Length": String(bytes.length), "Cache-Control": "max-age=0", "x-upsert": "false",
            "x-metadata": Buffer.from(JSON.stringify({tradeOsSha256: fileDigest(bytes)})).toString("base64") } : { Range: "bytes=0-", "Content-Length": "0" }) },
      }, response => {
        const status = response.statusCode ?? 0;
        const errorRead = !bytes && [400, 404].includes(status);
        const responseLimit = errorRead ? 4096 : maximum;
        const range = response.headers["content-range"]?.match(/^bytes (\d+)-(\d+)\/(\d+)$/);
        const length = response.headers["content-length"], declared = length === undefined ? null : Number(length);
        if ((!bytes && ![200, 206, 400, 404].includes(status)) || (bytes && status >= 300 && status < 400)
          || (!bytes && status === 206 && (!range || range[1] !== "0" || !Number.isSafeInteger(Number(range[3])) || Number(range[3]) > maximum || Number(range[2]) + 1 !== Number(range[3])))
          || (declared !== null && (!Number.isSafeInteger(declared) || declared < 0 || declared > responseLimit))) {
          response.destroy(); reject(new Error("Invalid transfer response")); return;
        }
        const chunks: Buffer[] = []; let total = 0;
        response.on("data", (chunk: Buffer) => { total += chunk.length; if (total > responseLimit) { response.destroy(); reject(new Error("Transfer limit exceeded")); return; } chunks.push(chunk); });
        response.on("error", reject);
        response.on("end", () => {
          if ((!bytes && !total) || (declared !== null && total !== declared) || (!bytes && range && total !== Number(range[3]))) { reject(new Error("Incomplete transfer")); return; }
          const result = Buffer.concat(chunks, total);
          if (errorRead) {
            try { if (status === 404 || String(JSON.parse(result.toString()).statusCode) === "404") { reject(new StorageObjectMissing()); return; } } catch { /* Unrecognized provider error, never content. */ }
            reject(new Error("Storage read rejected")); return;
          }
          resolve({status, bytes: result});
        });
      });
      request.on("error", reject); request.end(bytes);
    });
  }
  const get: PrivateFileStorage["get"] = async (bucket, path, maximum) => {
    try { return (await transfer(bucket, path, maximum)).bytes; }
    catch { throw new PrivateFileError("STORAGE_UNAVAILABLE"); }
  };
  return { get, put: async (bucket, path, bytes, contentType) => {
    if (!bytes.length || bytes.length > FILE_MAX_BYTES) throw new PrivateFileError("INVALID_FILE_CONTENT");
    // A failed database commit may leave the exact original already stored.
    // Verify it before trying another no-overwrite POST, including after restart.
    if (bucket === "trade-screenshots") {
      try {
        const existing = (await transfer(bucket, path, bytes.length)).bytes;
        if (existing.length !== bytes.length || fileDigest(existing) !== fileDigest(bytes)) throw new PrivateFileError("FILE_CONTENT_CONFLICT");
        return;
      } catch (error) {
        if (!(error instanceof StorageObjectMissing)) throw error instanceof PrivateFileError ? error : new PrivateFileError("STORAGE_UNAVAILABLE");
      }
    }
    try {
      // Explicit Content-Length avoids the framework's streamed upload boundary.
      const response = await transfer(bucket, path, 4096, bytes, contentType);
      if (response.status >= 200 && response.status < 300) return;
      // Staging is not evidence. A duplicate immutable hash-addressed chunk is
      // accepted only by the subsequent private transaction's stored size/type/
      // hash checks; FINISH must still read, hash and decode all actual bytes.
      // Do not perform this optimization for finalized screenshot objects.
      if (bucket === "trade-file-staging" && [400, 409].includes(response.status)) return;
    } catch { /* An acknowledgement may be lost after the durable Storage write. */ }
    const existing = await get(bucket, path, bytes.length);
    if (existing.length !== bytes.length || fileDigest(existing) !== fileDigest(bytes)) throw new PrivateFileError("FILE_CONTENT_CONFLICT");
  } };
}
