import { describe, expect, it } from "vitest";
import { companionDistribution } from "@/domain/integrations/companion-distribution";

const valid = { TRADE_OS_COMPANION_PREVIEW_TAG: "companion-preview-20261013-fe451ba",
  TRADE_OS_COMPANION_PREVIEW_SHA256: "87a633e0fd9e3a688a7865cd507c6e0f473537a7faeac61b03baa417b0f002c0",
  TRADE_OS_COMPANION_PREVIEW_BYTES: "59171328" };

describe("companion preview distribution", () => {
  it("pins the repository, filename and preview/unsigned status", () => {
    const result = companionDistribution(valid)!;
    expect(result.url).toBe("https://github.com/ghost-sys-coder/veilcode-trade-os/releases/download/companion-preview-20261013-fe451ba/TradeOS-Companion-Windows-x64.exe");
    expect(result.releaseUrl).toBe("https://github.com/ghost-sys-coder/veilcode-trade-os/releases/tag/companion-preview-20261013-fe451ba");
    expect(result.bytes).toBe(59171328);
    expect(result.preview).toBe(true);
    expect(result.signed).toBe(false);
  });
  it.each(Object.keys(valid))("missing %s suppresses the download", key => {
    expect(companionDistribution({ ...valid, [key]: undefined })).toBeNull();
  });
  it.each(["https://evil.example/file", "../../other", "companion-preview-20261013-fe451ba?token=x", "companion-preview-20261013-fe451ba#other", "latest", "companion-preview-20261013-FE451BA"])("rejects unsafe tag %s", tag => {
    expect(companionDistribution({ ...valid, TRADE_OS_COMPANION_PREVIEW_TAG: tag })).toBeNull();
  });
  it.each(["", "secret", "a".repeat(63), "g".repeat(64)])("rejects digest %s", sha256 => {
    expect(companionDistribution({ ...valid, TRADE_OS_COMPANION_PREVIEW_SHA256: sha256 })).toBeNull();
  });
  it.each(["-1", "NaN", "5e7", "59171328.0", "0", "99999", "250000001", " 59171328", "59171328\n"])("rejects invalid or oversized bytes %s", bytes => {
    expect(companionDistribution({ ...valid, TRADE_OS_COMPANION_PREVIEW_BYTES: bytes })).toBeNull();
  });
  it("returns no credentials or arbitrary environment values", () => {
    const result = companionDistribution({ ...valid, SUPABASE_SECRET_KEY: "fixture", TRADE_OS_COMPANION_DOWNLOAD_URL: "https://evil.example/file" })!;
    expect(Object.keys(result).sort()).toEqual(["tag", "sha256", "bytes", "preview", "signed", "url", "releaseUrl"].sort());
    expect(JSON.stringify(result)).not.toContain("fixture");
    expect(JSON.stringify(result)).not.toContain("evil.example");
  });
});
