/** Public artifact metadata only. Never accept caller-selected download origins. */
export function companionDistribution(environment: Record<string, string | undefined>) {
  const tag = environment.TRADE_OS_COMPANION_PREVIEW_TAG;
  const sha256 = environment.TRADE_OS_COMPANION_PREVIEW_SHA256;
  const size = environment.TRADE_OS_COMPANION_PREVIEW_BYTES;
  if (!tag || !/^companion-preview-[0-9]{8}-[a-f0-9]{7}$/.test(tag)
    || !sha256 || !/^[a-f0-9]{64}$/.test(sha256)
    || !size || !/^[1-9][0-9]{0,8}$/.test(size)) return null;
  const bytes = Number(size);
  if (bytes < 100_000 || bytes > 250_000_000) return null;
  const base = `https://github.com/ghost-sys-coder/veilcode-trade-os/releases`;
  return { tag, sha256, bytes, preview: true as const, signed: false as const,
    url: `${base}/download/${tag}/TradeOS-Companion-Windows-x64.exe`,
    releaseUrl: `${base}/tag/${tag}` };
}
