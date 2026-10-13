import { companionDistribution } from "./companion-distribution";

/** A Desktop extension is usable only with its exact, published companion release. */
export function claudeDesktopDistribution(environment: Record<string, string | undefined>) {
  if (environment.TRADE_OS_CLAUDE_DESKTOP_SETUP_ENABLED !== "true") return null;
  const companion = companionDistribution(environment);
  const tag = environment.TRADE_OS_CLAUDE_DESKTOP_PREVIEW_TAG;
  const sha256 = environment.TRADE_OS_CLAUDE_DESKTOP_PREVIEW_SHA256;
  const size = environment.TRADE_OS_CLAUDE_DESKTOP_PREVIEW_BYTES;
  if (!companion || tag !== companion.tag || !sha256 || !/^[a-f0-9]{64}$/.test(sha256)
    || !size || !/^[1-9][0-9]{0,6}$/.test(size)) return null;
  const bytes = Number(size);
  if (bytes < 1000 || bytes > 5_000_000) return null;
  return { tag, sha256, bytes, companion,
    url: `https://github.com/ghost-sys-coder/veilcode-trade-os/releases/download/${tag}/TradeOS-Claude-Desktop-Windows.mcpb` };
}
