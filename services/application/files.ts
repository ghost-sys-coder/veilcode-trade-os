import "server-only";
import { z } from "zod";
import { screenshotsListSchema, screenshotGetSchema, uploadRequestSchema, uploadStatusSchema, uploadChunkSchema, uploadFinishSchema,
  screenshotDownloadSchema, screenshotRecordSchema, screenshotPageSchema, uploadRecordSchema, fileResultSchema, fileDownloadResultSchema,
  fileHashSchema, FILE_CHUNK_BYTES, FILE_MAX_BYTES, PrivateFileError, assertFilePath } from "@/domain/files/commands";
import { applicationTransaction, type ApplicationContext } from "@/services/application/transaction";
import { decodeFileChunk, fileDigest, validateFileContent } from "@/services/files/content";
import { privateFileStorage } from "@/services/files/storage";

const preparationSchema = z.object({
  upload: uploadRecordSchema, ownerId: z.string().uuid(), storagePath: z.string(),
  chunks: z.array(z.object({ chunkIndex: z.number().int().nonnegative(), byteLength: z.number().int().positive().max(FILE_CHUNK_BYTES),
    sha256: fileHashSchema, storagePath: z.string() }).strict()).max(27).optional(),
}).strict();
const downloadPreparationSchema = z.object({ record: screenshotRecordSchema, ownerId: z.string().uuid(), storagePath: z.string() }).strict();
function recovered(snapshot: unknown) {
  const parsed = z.object({ receipt: fileResultSchema }).strict().safeParse(snapshot);
  return parsed.success ? parsed.data.receipt : null;
}
export async function listScreenshots(context: ApplicationContext, input: unknown) {
  return screenshotPageSchema.parse(await applicationTransaction(context, "FILE_READ", { action: "LIST", ...screenshotsListSchema.parse(input) }));
}
export async function getScreenshot(context: ApplicationContext, input: unknown) {
  return screenshotRecordSchema.parse(await applicationTransaction(context, "FILE_READ", { action: "GET", ...screenshotGetSchema.parse(input) }));
}
export async function requestScreenshotUpload(context: ApplicationContext, input: unknown) {
  return fileResultSchema.parse(await applicationTransaction(context, "FILE_WRITE", { action: "REQUEST", ...uploadRequestSchema.parse(input) }, () => ({})));
}
export async function getScreenshotUpload(context: ApplicationContext, input: unknown) {
  return uploadRecordSchema.parse(await applicationTransaction(context, "FILE_READ", { action: "UPLOAD", ...uploadStatusSchema.parse(input) }));
}
export async function uploadScreenshotChunk(context: ApplicationContext, input: unknown) {
  const { contentBase64, ...command } = uploadChunkSchema.parse(input);
  const bytes = decodeFileChunk(contentBase64);
  // Receipts/audits contain hashes and dimensions, never binary/base64 content.
  const request = { action: "CHUNK", ...command, byteLength: bytes.length, sha256: fileDigest(bytes) };
  const snapshot = await applicationTransaction(context, "FILE_PREPARE", request);
  const receipt = recovered(snapshot); if (receipt) return receipt;
  const prepared = preparationSchema.parse(snapshot);
  const path = assertFilePath(prepared.storagePath, prepared.ownerId, prepared.upload.tradeId);
  await privateFileStorage().put("trade-file-staging", path, bytes, "application/octet-stream");
  // Fresh authorization, version/expiry checks and stored facts inside the commit.
  return fileResultSchema.parse(await applicationTransaction(context, "FILE_WRITE", request, () => ({})));
}
export async function finishScreenshotUpload(context: ApplicationContext, input: unknown) {
  const request = { action: "FINISH", ...uploadFinishSchema.parse(input) };
  const snapshot = await applicationTransaction(context, "FILE_PREPARE", request);
  const receipt = recovered(snapshot); if (receipt) return receipt;
  const prepared = preparationSchema.parse(snapshot), storage = privateFileStorage();
  if (!prepared.chunks?.length) throw new PrivateFileError("INVALID_FILE_CHUNK");
  const parts: Buffer[] = [];
  for (const chunk of prepared.chunks) {
    const bytes = await storage.get("trade-file-staging", assertFilePath(chunk.storagePath, prepared.ownerId, prepared.upload.tradeId), chunk.byteLength);
    if (bytes.length !== chunk.byteLength || fileDigest(bytes) !== chunk.sha256) throw new PrivateFileError("FILE_CONTENT_CONFLICT");
    parts.push(bytes);
  }
  const bytes = Buffer.concat(parts);
  const facts = await validateFileContent(bytes, prepared.upload);
  await storage.put("trade-screenshots", assertFilePath(prepared.storagePath, prepared.ownerId, prepared.upload.tradeId), bytes, facts.contentType);
  return fileResultSchema.parse(await applicationTransaction(context, "FILE_WRITE", request, () => facts));
}
export async function downloadScreenshot(context: ApplicationContext, input: unknown) {
  const request = screenshotDownloadSchema.parse(input);
  const prepared = downloadPreparationSchema.parse(await applicationTransaction(context, "FILE_READ", { action: "DOWNLOAD", screenshotId: request.screenshotId }));
  const bytes = await privateFileStorage().get("trade-screenshots", assertFilePath(prepared.storagePath, prepared.ownerId, prepared.record.tradeId), FILE_MAX_BYTES);
  const expected = prepared.record.sha256 && prepared.record.byteLength && prepared.record.contentType
    ? { sha256: prepared.record.sha256, byteLength: prepared.record.byteLength, contentType: prepared.record.contentType } : undefined;
  const facts = await validateFileContent(bytes, expected);
  if (request.expectedSha256 && request.expectedSha256 !== facts.sha256) throw new PrivateFileError("FILE_CONTENT_CONFLICT");
  if (request.offset >= bytes.length) throw new PrivateFileError("INVALID_FILE_CHUNK");
  // Revalidate after external I/O; no response from a grant revoked during transfer.
  const current = await getScreenshot(context, { screenshotId: request.screenshotId });
  if (JSON.stringify(current) !== JSON.stringify(prepared.record)) throw new PrivateFileError("FILE_CONTENT_CONFLICT");
  const chunk = bytes.subarray(request.offset, request.offset + request.limit), next = request.offset + chunk.length;
  return fileDownloadResultSchema.parse({ screenshotId: request.screenshotId, ...facts, offset: request.offset,
    chunkLength: chunk.length, contentBase64: chunk.toString("base64"), nextOffset: next < bytes.length ? next : null,
    integrity: expected ? "VERIFIED_UPLOAD" : "LEGACY_VALIDATED_ON_READ" });
}
