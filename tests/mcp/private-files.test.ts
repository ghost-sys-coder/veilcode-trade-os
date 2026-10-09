import { afterEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import { FILE_CHUNK_BYTES, FILE_MAX_BYTES, uploadRequestSchema, uploadChunkSchema, uploadFinishSchema,
  screenshotDownloadSchema, screenshotsListSchema, assertFilePath } from "@/domain/files/commands";
import { decodeFileChunk, fileDigest, validateFileContent } from "@/services/files/content";
import { listScreenshots, requestScreenshotUpload, uploadScreenshotChunk, finishScreenshotUpload, downloadScreenshot } from "@/services/application/files";
import { ApplicationWorkflowError, type ApplicationContext } from "@/services/application/transaction";
const { transaction, get, put, storage } = vi.hoisted(() => ({ transaction: vi.fn(), get: vi.fn(), put: vi.fn(), storage: vi.fn() }));
vi.mock("@/services/application/transaction", async original => ({ ...await original<typeof import("@/services/application/transaction")>(), applicationTransaction: transaction }));
vi.mock("@/services/files/storage", () => ({ privateFileStorage: storage }));
const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", tradeId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const context = { userId: id } as ApplicationContext;
const base = { operationId: id, tradeId, expectedTradeVersion: "1", metadata: { category: "AT_ENTRY" },
  contentType: "image/png", byteLength: 100, sha256: "a".repeat(64) };
afterEach(() => vi.resetAllMocks());
async function fixture() {
  const bytes = await sharp({ create: { width: 16, height: 8, channels: 3, background: "white" } }).png().toBuffer();
  const upload = { uploadId: id, tradeId, version: "1", status: "PENDING", expiresAt: "2026-10-10T00:00:00Z",
    contentType: "image/png", byteLength: bytes.length, sha256: fileDigest(bytes), chunkBytes: FILE_CHUNK_BYTES,
    totalChunks: 1, receivedChunks: [], screenshotId: null, metadata: { category: "AT_ENTRY", timeframe: null, caption: null, capturedAt: null } };
  const record = { id, tradeId, category: "AT_ENTRY", timeframe: null, caption: null, capturedAt: null, createdAt: "2026-10-09T00:00:00Z",
    contentType: "image/png", byteLength: bytes.length, sha256: fileDigest(bytes), width: 16, height: 8 };
  return { bytes, upload, record, path: `${id}/${tradeId}/mcp/${id}/original.png`,
    result: { action: "FINISH", upload: { ...upload, status: "COMPLETE", version: "2", screenshotId: id, receivedChunks: [0] }, screenshot: record, tradeVersion: "2" } };
}
describe("controlled private-file schemas", () => {
  it.each([{ ownerId: id }, { storagePath: "../outside" }, { url: "https://example.test/file" }, { filePath: "C:\\private" },
    { byteLength: 0 }, { byteLength: FILE_MAX_BYTES + 1 }, { contentType: "image/svg+xml" }, { sha256: "A".repeat(64) },
    { expectedTradeVersion: 1 }, { expectedTradeVersion: "0" }, { metadata: { category: "UNKNOWN" } }])("rejects invalid/rescoped request %j", extra => {
    expect(uploadRequestSchema.safeParse({ ...base, ...extra }).success).toBe(false);
  });
  it("normalizes nullable metadata and requires real versions", () => {
    expect(uploadRequestSchema.parse(base).metadata).toEqual({ category: "AT_ENTRY", timeframe: null, caption: null, capturedAt: null });
    expect(uploadFinishSchema.safeParse({ operationId: id, uploadId: id, expectedVersion: "1", expectedTradeVersion: "1" }).success).toBe(true);
    expect(uploadFinishSchema.safeParse({ operationId: id, uploadId: id, expectedVersion: "1", expectedTradeVersion: "9223372036854775808" }).success).toBe(false);
  });
  it("bounds paging, chunks and continuation", () => {
    expect(screenshotsListSchema.parse({}).limit).toBe(50);
    expect(screenshotsListSchema.safeParse({ limit: 101 }).success).toBe(false);
    expect(uploadChunkSchema.safeParse({ operationId: id, uploadId: id, expectedVersion: "1", chunkIndex: 27, contentBase64: "YQ==" }).success).toBe(false);
    expect(screenshotDownloadSchema.safeParse({ screenshotId: id, offset: 1 }).success).toBe(false);
    expect(screenshotDownloadSchema.safeParse({ screenshotId: id, offset: 1, expectedSha256: "a".repeat(64) }).success).toBe(true);
  });
  it.each([`${id}/${tradeId}/../other`, `${id}/${tradeId}//file`, `${id}/${tradeId}/%2e%2e/file`, `${tradeId}/${id}/file`, "https://host/file", "C:\\file", `${id}/${tradeId}/a\\b`])("rejects unsafe object identity %s", path => {
    expect(() => assertFilePath(path, id, tradeId)).toThrow();
  });
  it("accepts only exact owned relative paths", () => expect(assertFilePath(`${id}/${tradeId}/legacy-file.png`, id, tradeId)).toBe(`${id}/${tradeId}/legacy-file.png`));
  it.each(["", "AA", "AB==", "YQ==\n", "####", "YQ=", "AAAA="])("rejects noncanonical base64 %j", value => expect(() => decodeFileChunk(value)).toThrow());
});
describe("actual image validation", () => {
  it.each(["png", "jpeg", "webp"] as const)("decodes complete %s pixels and retains exact original bytes", async format => {
    const bytes = await sharp({ create: { width: 16, height: 8, channels: 3, background: "white" } }).toFormat(format).toBuffer();
    expect(await validateFileContent(bytes)).toMatchObject({ byteLength: bytes.length, sha256: fileDigest(bytes), contentType: `image/${format}`, width: 16, height: 8 });
  });
  it("rejects header-only/truncated PNG, SVG, empty and oversized input", async () => {
    const { bytes } = await fixture();
    for (const input of [bytes.subarray(0, 33), Buffer.from('<svg width="1" height="1"/>'), Buffer.alloc(0), Buffer.alloc(FILE_MAX_BYTES + 1)]) {
      await expect(validateFileContent(input)).rejects.toMatchObject({ code: "INVALID_FILE_CONTENT" });
    }
  });
  it("rejects hash, size and declared MIME conflicts", async () => {
    const { bytes, upload } = await fixture();
    for (const wrong of [{ ...upload, sha256: "0".repeat(64) }, { ...upload, byteLength: bytes.length + 1 }, { ...upload, contentType: "image/jpeg" }]) {
      await expect(validateFileContent(bytes, wrong)).rejects.toMatchObject({ code: "FILE_CONTENT_CONFLICT" });
    }
  });
  it("rejects decompression beyond the explicit pixel budget", async () => {
    const bytes = await sharp({ create: { width: 5000, height: 4000, channels: 3, background: "white" } }).png().toBuffer();
    await expect(validateFileContent(bytes)).rejects.toMatchObject({ code: "INVALID_FILE_CONTENT" });
  });
});
describe("verified file application adapters", () => {
  it("never opens a workflow for injected owners/paths", async () => {
    await expect(requestScreenshotUpload(context, { ...base, ownerId: tradeId })).rejects.toThrow();
    await expect(listScreenshots(context, { storagePath: "outside" })).rejects.toThrow();
    expect(transaction).not.toHaveBeenCalled(); expect(storage).not.toHaveBeenCalled();
  });
  it("recovers a committed chunk before Storage and excludes bytes from receipt requests", async () => {
    const { bytes, result } = await fixture(); transaction.mockResolvedValue({ receipt: { ...result, action: "CHUNK" } });
    expect(await uploadScreenshotChunk(context, { operationId: id, uploadId: id, expectedVersion: "1", chunkIndex: 0, contentBase64: bytes.toString("base64") })).toMatchObject({ action: "CHUNK" });
    expect(storage).not.toHaveBeenCalled(); expect(JSON.stringify(transaction.mock.calls)).not.toContain("contentBase64");
  });
  it("preserves an uncertain staged transfer failure", async () => {
    const { bytes, upload } = await fixture(); transaction.mockResolvedValue({ upload, ownerId: id, storagePath: `${id}/${tradeId}/chunk.part` });
    storage.mockReturnValue({ get, put }); put.mockRejectedValue(new Error("fixture transfer failure"));
    await expect(uploadScreenshotChunk(context, { operationId: id, uploadId: id, expectedVersion: "1", chunkIndex: 0, contentBase64: bytes.toString("base64") })).rejects.toThrow();
    expect(transaction).toHaveBeenCalledOnce(); expect(put).toHaveBeenCalledOnce();
  });
  it("assembles, verifies and commits through the authoritative short transaction", async () => {
    const { bytes, upload, path, result } = await fixture();
    transaction.mockResolvedValueOnce({ upload, ownerId: id, storagePath: path, chunks: [{ chunkIndex: 0, byteLength: bytes.length, sha256: fileDigest(bytes), storagePath: `${id}/${tradeId}/chunk.part` }] }).mockResolvedValueOnce(result);
    storage.mockReturnValue({ get, put }); get.mockResolvedValue(bytes); put.mockResolvedValue(undefined);
    expect(await finishScreenshotUpload(context, { operationId: id, uploadId: id, expectedVersion: "1", expectedTradeVersion: "1" })).toEqual(result);
    expect(put).toHaveBeenCalledWith("trade-screenshots", path, bytes, "image/png");
    const prepare = transaction.mock.calls[1][3] as () => object;
    expect(prepare()).toEqual({ byteLength: bytes.length, sha256: fileDigest(bytes), contentType: "image/png", width: 16, height: 8 });
  });
  it("does not publish metadata after corrupted chunks", async () => {
    const { bytes, upload, path } = await fixture();
    transaction.mockResolvedValue({ upload, ownerId: id, storagePath: path, chunks: [{ chunkIndex: 0, byteLength: bytes.length, sha256: "0".repeat(64), storagePath: `${id}/${tradeId}/chunk.part` }] });
    storage.mockReturnValue({ get, put }); get.mockResolvedValue(bytes);
    await expect(finishScreenshotUpload(context, { operationId: id, uploadId: id, expectedVersion: "1", expectedTradeVersion: "1" })).rejects.toMatchObject({ code: "FILE_CONTENT_CONFLICT" });
    expect(put).not.toHaveBeenCalled(); expect(transaction).toHaveBeenCalledOnce();
  });
  it("rechecks authorization after download", async () => {
    const { bytes, record, path } = await fixture(); storage.mockReturnValue({ get, put }); get.mockResolvedValue(bytes);
    transaction.mockResolvedValueOnce({ record, ownerId: id, storagePath: path }).mockResolvedValueOnce(record);
    expect(await downloadScreenshot(context, { screenshotId: id, limit: 10 })).toMatchObject({ nextOffset: 10, chunkLength: 10, integrity: "VERIFIED_UPLOAD", sha256: fileDigest(bytes) });
    transaction.mockResolvedValueOnce({ record, ownerId: id, storagePath: path }).mockRejectedValueOnce(new ApplicationWorkflowError("ACCESS_DENIED"));
    await expect(downloadScreenshot(context, { screenshotId: id })).rejects.toMatchObject({ code: "ACCESS_DENIED" });
  });
});
