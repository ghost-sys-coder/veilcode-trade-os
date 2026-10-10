import { z } from "zod";
import { SCREENSHOT_CATEGORIES, TIMEFRAMES } from "@/types/domain";

export const FILE_MAX_BYTES = 10_485_760;
export const FILE_CHUNK_BYTES = 393_216;
export const FILE_MAX_PIXELS = 16_000_000;
export const FILE_CONTENT_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;
const id = z.string().uuid();
const version = z.string().regex(/^[1-9]\d{0,18}$/).refine(v => /^[1-9]\d{0,18}$/.test(v) && BigInt(v) <= BigInt("9223372036854775807"));
export const fileHashSchema = z.string().regex(/^[a-f0-9]{64}$/);
export const screenshotMetadataCommandSchema = z.object({
  category: z.enum(SCREENSHOT_CATEGORIES), timeframe: z.enum(TIMEFRAMES).nullable().default(null),
  caption: z.string().trim().max(1000).nullable().default(null), capturedAt: z.iso.datetime().nullable().default(null),
}).strict();
export const screenshotsListSchema = z.object({
  tradeId: id.optional(), afterId: id.optional(), limit: z.number().int().min(1).max(100).default(50),
}).strict();
export const screenshotGetSchema = z.object({ screenshotId: id }).strict();
export const uploadRequestSchema = z.object({
  operationId: id, tradeId: id, expectedTradeVersion: version, metadata: screenshotMetadataCommandSchema,
  contentType: z.enum(FILE_CONTENT_TYPES), byteLength: z.number().int().min(1).max(FILE_MAX_BYTES), sha256: fileHashSchema,
}).strict();
export const uploadStatusSchema = z.object({ uploadId: id }).strict();
export const uploadChunkSchema = z.object({
  operationId: id, uploadId: id, expectedVersion: version,
  chunkIndex: z.number().int().min(0).max(Math.ceil(FILE_MAX_BYTES / FILE_CHUNK_BYTES) - 1),
  contentBase64: z.string().min(4).max(FILE_CHUNK_BYTES * 4 / 3).regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/),
}).strict();
export const uploadFinishSchema = z.object({
  operationId: id, uploadId: id, expectedVersion: version, expectedTradeVersion: version,
}).strict();
export const screenshotDownloadSchema = z.object({
  screenshotId: id, offset: z.number().int().min(0).max(FILE_MAX_BYTES - 1).default(0),
  limit: z.number().int().min(1).max(FILE_CHUNK_BYTES).default(FILE_CHUNK_BYTES), expectedSha256: fileHashSchema.optional(),
}).strict().refine(v => v.offset === 0 || v.expectedSha256 !== undefined, "Continuation requires the previous content hash.");

export const screenshotRecordSchema = z.object({
  id, tradeId: id, category: z.enum(SCREENSHOT_CATEGORIES), timeframe: z.enum(TIMEFRAMES).nullable(),
  caption: z.string().nullable(), capturedAt: z.string().nullable(), createdAt: z.string(),
  contentType: z.enum(FILE_CONTENT_TYPES).nullable(), byteLength: z.number().int().positive().nullable(),
  sha256: fileHashSchema.nullable(), width: z.number().int().positive().nullable(), height: z.number().int().positive().nullable(),
}).strict();
export const screenshotPageSchema = z.object({ records: z.array(screenshotRecordSchema).max(100), nextCursor: id.nullable() }).strict();
export const uploadRecordSchema = z.object({
  uploadId: id, tradeId: id, version, status: z.enum(["PENDING", "COMPLETE", "EXPIRED"]), expiresAt: z.string(),
  contentType: z.enum(FILE_CONTENT_TYPES), byteLength: z.number().int().min(1).max(FILE_MAX_BYTES), sha256: fileHashSchema,
  metadata: screenshotMetadataCommandSchema, chunkBytes: z.literal(FILE_CHUNK_BYTES),
  totalChunks: z.number().int().min(1).max(27), receivedChunks: z.array(z.number().int().min(0).max(26)).max(27),
  screenshotId: id.nullable(),
}).strict();
export const fileResultSchema = z.object({
  action: z.enum(["REQUEST", "CHUNK", "FINISH"]), upload: uploadRecordSchema,
  screenshot: screenshotRecordSchema.nullable(), tradeVersion: version.nullable(),
}).strict();
export const fileDownloadResultSchema = z.object({
  screenshotId: id, contentType: z.enum(FILE_CONTENT_TYPES), byteLength: z.number().int().positive().max(FILE_MAX_BYTES),
  sha256: fileHashSchema, width: z.number().int().positive(), height: z.number().int().positive(),
  offset: z.number().int().nonnegative(), chunkLength: z.number().int().positive().max(FILE_CHUNK_BYTES),
  contentBase64: z.string().max(FILE_CHUNK_BYTES * 4 / 3), nextOffset: z.number().int().positive().nullable(),
  integrity: z.enum(["VERIFIED_UPLOAD", "LEGACY_VALIDATED_ON_READ"]),
}).strict();

const messages = {
  STORAGE_NOT_CONFIGURED: "Private Storage is not configured on this server. No secret belongs in the client.",
  STORAGE_UNAVAILABLE: "Private file transfer is temporarily unavailable. Inspect upload/operation status before retrying.",
  INVALID_FILE_CONTENT: "Expected a complete single-frame PNG, JPEG or WebP within the byte and pixel limits.",
  FILE_CONTENT_CONFLICT: "File bytes do not match the recorded size, type or content hash. No evidence was published.",
  INVALID_FILE_PATH: "The recorded file identity is not a safe owned Storage path.",
  INVALID_FILE_CHUNK: "Invalid file chunk or download continuation.",
} as const;
export class PrivateFileError extends Error {
  constructor(readonly code: keyof typeof messages) { super(messages[code]); this.name = "PrivateFileError"; }
}

/** Only exact database-derived object identities, never user URLs or local paths. */
export function assertFilePath(path: string, ownerId: string, tradeId: string) {
  if (!id.safeParse(ownerId).success || !id.safeParse(tradeId).success || !path.startsWith(`${ownerId}/${tradeId}/`)
    || path.length > 1024 || !/^[A-Za-z0-9._/-]+$/.test(path) || path.split("/").some(part => !part || part === "." || part === "..")) {
    throw new PrivateFileError("INVALID_FILE_PATH");
  }
  return path;
}
