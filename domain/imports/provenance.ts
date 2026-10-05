import type { TradeDirection, TradeSource } from "@/types/domain";

export interface ImportIdentity {
  accountId: string;
  sourceType: Exclude<TradeSource, "MANUAL">;
  externalTradeId?: string | null;
  externalOrderId?: string | null;
  externalPositionId?: string | null;
  sourceConnectionId?: string | null;
  sourceEpisodeId?: string | null;
  symbol: string;
  direction: TradeDirection;
  openedAt: string;
  closedAt: string;
}

export interface ExistingTradeIdentity {
  id: string;
  accountId: string;
  sourceType: TradeSource;
  externalTradeId?: string | null;
  externalOrderId?: string | null;
  externalPositionId?: string | null;
  sourceConnectionId?: string | null;
  sourceEpisodeId?: string | null;
  symbol: string;
  direction: TradeDirection;
  openedAt: string | null;
  closedAt: string | null;
}

export type ImportMatch =
  | { kind: "NONE"; matchedTradeId: null; deduplicationKey: string }
  | { kind: "DUPLICATE"; matchedTradeId: string; deduplicationKey: string }
  | { kind: "CONFLICT"; matchedTradeId: string; deduplicationKey: string };

function identifier(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized.toLocaleLowerCase("en-US") : null;
}

function strongKeys(identity: ImportIdentity | ExistingTradeIdentity): string[] {
  const prefix = `${identity.accountId}:${identity.sourceType}`;
  if (identity.sourceType === "MT5") {
    const connection = identifier(identity.sourceConnectionId);
    const episode = identifier(identity.sourceEpisodeId);
    // Raw MT5 position/order/deal IDs are provenance, not unique canonical
    // positions: netting reversals and reopened episodes may reuse them.
    return connection && episode ? [`${prefix}:connection:${connection}:episode:${episode}`] : [];
  }
  const trade = identifier(identity.externalTradeId);
  const position = identifier(identity.externalPositionId);
  const order = identifier(identity.externalOrderId);

  return [
    trade ? `${prefix}:trade:${trade}` : null,
    position ? `${prefix}:position:${position}` : null,
    order ? `${prefix}:order:${order}` : null,
  ].filter((value): value is string => value !== null);
}

export function importFallbackFingerprint(identity: Pick<ImportIdentity, "accountId" | "symbol" | "direction" | "openedAt" | "closedAt">): string {
  return [
    identity.accountId,
    identity.symbol.trim().toLocaleUpperCase("en-US"),
    identity.direction,
    identity.openedAt,
    identity.closedAt,
  ].join(":");
}

export function importDeduplicationKey(identity: ImportIdentity): string {
  return strongKeys(identity)[0] ?? `fallback:${importFallbackFingerprint(identity)}`;
}

export function classifyImportMatch(
  incoming: ImportIdentity,
  existingTrades: readonly ExistingTradeIdentity[],
): ImportMatch {
  const incomingStrongKeys = new Set(strongKeys(incoming));
  const deduplicationKey = importDeduplicationKey(incoming);

  for (const existing of existingTrades) {
    if (existing.accountId !== incoming.accountId || existing.sourceType !== incoming.sourceType) continue;
    const matchedKey = strongKeys(existing).find((key) => incomingStrongKeys.has(key));
    if (matchedKey) {
      return { kind: "DUPLICATE", matchedTradeId: existing.id, deduplicationKey: matchedKey };
    }
  }

  const fallback = importFallbackFingerprint(incoming);
  const conflict = existingTrades.find((existing) => existing.accountId === incoming.accountId
    && existing.openedAt !== null
    && existing.closedAt !== null
    && importFallbackFingerprint({
      accountId: existing.accountId,
      symbol: existing.symbol,
      direction: existing.direction,
      openedAt: existing.openedAt,
      closedAt: existing.closedAt,
    }) === fallback);

  return conflict
    ? { kind: "CONFLICT", matchedTradeId: conflict.id, deduplicationKey: `fallback:${fallback}` }
    : { kind: "NONE", matchedTradeId: null, deduplicationKey };
}
