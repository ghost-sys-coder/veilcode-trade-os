import "server-only";
import { createHash } from "node:crypto";
import sharp from "sharp";
import { FILE_CHUNK_BYTES, FILE_MAX_BYTES, FILE_MAX_PIXELS, PrivateFileError, uploadChunkSchema } from "@/domain/files/commands";

export function fileDigest(bytes: Uint8Array) { return createHash("sha256").update(bytes).digest("hex"); }
export function decodeFileChunk(value: string) {
  // Buffer's decoder is permissive: validate spelling and canonical padding first.
  if (!uploadChunkSchema.shape.contentBase64.safeParse(value).success) throw new PrivateFileError("INVALID_FILE_CHUNK");
  const bytes = Buffer.from(value, "base64");
  if (!bytes.length || bytes.length > FILE_CHUNK_BYTES || bytes.toString("base64") !== value) throw new PrivateFileError("INVALID_FILE_CHUNK");
  return bytes;
}
export async function validateFileContent(bytes: Buffer, expected?: { byteLength: number; sha256: string; contentType: string }) {
  if (!bytes.length || bytes.length > FILE_MAX_BYTES) throw new PrivateFileError("INVALID_FILE_CONTENT");
  const png = bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
  const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  const webp = bytes.length >= 12 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP";
  if (!png && !jpeg && !webp) throw new PrivateFileError("INVALID_FILE_CONTENT");
  const sha256 = fileDigest(bytes);
  if (expected && (expected.byteLength !== bytes.length || expected.sha256 !== sha256)) throw new PrivateFileError("FILE_CONTENT_CONFLICT");
  try {
    const image = sharp(bytes, { limitInputPixels: FILE_MAX_PIXELS, failOn: "warning" });
    const meta = await image.metadata();
    const formats: Record<string, string> = { png: "image/png", jpeg: "image/jpeg", webp: "image/webp" };
    const contentType = formats[meta.format ?? ""];
    if (!contentType || !meta.width || !meta.height || (meta.pages ?? 1) !== 1 || meta.width * meta.height > FILE_MAX_PIXELS) throw new Error("Unsupported image");
    // metadata() reads headers only; stats() forces decoding of compressed pixels.
    await image.stats();
    if (expected && expected.contentType !== contentType) throw new PrivateFileError("FILE_CONTENT_CONFLICT");
    return { byteLength: bytes.length, sha256, contentType, width: meta.width, height: meta.height };
  } catch (error) {
    if (error instanceof PrivateFileError) throw error;
    throw new PrivateFileError("INVALID_FILE_CONTENT");
  }
}
