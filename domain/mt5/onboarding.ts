import { z } from "zod";
import { mt5IdentitySchema, mt5SourceEventSchema, type Mt5SourceEvent } from "@/domain/mt5/source";
import { reconstructMt5Deals, type Mt5Episode } from "@/domain/mt5/reconstruct";
import { normalizeMoney, parseDecimal, sumDecimals } from "@/domain/money/decimal";
import type { Mt5SymbolMapping } from "@/domain/mt5/symbol-mapping";

const timestamp = z.iso.datetime({ offset: true });
const version = z.string().regex(/^[1-9][0-9]*$/);
export const mt5ConnectionViewSchema = z.object({
  id: z.string().uuid(), accountId: z.string().uuid(), grantId: z.string().uuid(), identity: mt5IdentitySchema,
  status: z.enum(["ONBOARDING","ACTIVE","PAUSED","ATTENTION"]), version,
  attentionCode: z.string().nullable(), onboardingApprovedAt: timestamp.nullable(),
  lastHeartbeatAt: timestamp.nullable(), lastSyncAt: timestamp.nullable(), captureCheckpoint: timestamp.nullable(),
  healthObservedAt: timestamp, heartbeatStale: z.boolean(),
  sourceFactCount: z.number().int().nonnegative(), reviewCount: z.number().int().nonnegative(),
  incompleteCollections: z.number().int().nonnegative(), missingServerBatches: z.number().int().nonnegative(),
  publishedTradeCount: z.number().int().nonnegative(),
});
export type Mt5ConnectionView = z.infer<typeof mt5ConnectionViewSchema>;
export const mt5StoredSourceSchema = z.object({
  kind: z.enum(["DEAL","ORDER","POSITION","ACCOUNT"]), sourceId: z.string(),
  revisionId: version, observedAt: timestamp, requiresReview: z.boolean(), payload: z.unknown(),
}).transform((row,context) => {
  const event = mt5SourceEventSchema.safeParse({ kind: row.kind, sourceId: row.sourceId,
    observedAt: new Date(row.observedAt).toISOString(), payload: row.payload });
  if (!event.success) { context.addIssue({ code: "custom",message: "Invalid durable source evidence" }); return z.NEVER; }
  return { ...row,event: event.data };
});
export type Mt5StoredSource = z.infer<typeof mt5StoredSourceSchema>;

export interface PreviewExistingTrade {
  id: string; symbol: string; direction: "BUY" | "SELL"; openedAt: string | null; closedAt: string | null;
  canonicalIdentity: string | null; closedNetPnl: string | null;
}
export interface PreviewProblem { code: string; positionId: string | null; detail: string }
export interface PreviewEpisode { episode: Mt5Episode; instrumentId: string | null; matchingTradeIds: string[]; publishable: boolean }

/** Read-only preview. No baseline, review answer, rule result or adjustment is invented. */
export function buildMt5OnboardingPreview(input: {
  connection: Mt5ConnectionView; sources: Mt5StoredSource[];
  instruments: { id: string; symbol: string }[]; existingTrades: PreviewExistingTrade[];
  startingBalance: string; ledgerBalance: string;
  symbolMappings?: Mt5SymbolMapping[];
}) {
  const precision = input.connection.identity.currencyPrecision;
  const events = input.sources.map(source => source.event);
  const result = reconstructMt5Deals({ connectionId: input.connection.id, currencyPrecision: precision,
    positionMode: input.connection.identity.positionMode,
    deals: events.filter((event): event is Extract<Mt5SourceEvent,{ kind: "DEAL" }> => event.kind === "DEAL").map(event => event.payload) });
  const problems: PreviewProblem[] = result.issues.map(issue => ({ code: issue.code,positionId: issue.positionId,
    detail: `Broker execution history requires review (${issue.dealTickets.length} affected deal tickets).` }));
  if (!input.connection.captureCheckpoint || input.connection.incompleteCollections > 0) problems.push({
    code: "INCOMPLETE_CAPTURE",positionId: null,detail: "All declared collection batches must be durable before publication." });
  if (!parseDecimal(input.startingBalance).gt(0)) problems.push({ code: "BASELINE_REQUIRED",positionId: null,detail: "An explicitly approved positive opening baseline is required." });
  const revisedPositions = new Set<string>();
  for (const source of input.sources.filter(source => source.requiresReview)) {
    const positionId = source.event.kind === "DEAL" ? source.event.payload.positionId : null;
    if (positionId) revisedPositions.add(positionId);
    problems.push({ code: "SOURCE_REVISION_REVIEW",positionId,detail: `Changed ${source.kind.toLowerCase()} ${source.sourceId} requires an auditable review.` });
  }
  // A POSITION is a current observation only if it belongs to the latest completed
  // capture, not simply because an old position fact remains in provenance.
  const checkpoint = input.connection.captureCheckpoint ? Date.parse(input.connection.captureCheckpoint) : null;
  const currentPositions = events.filter((event): event is Extract<Mt5SourceEvent,{ kind: "POSITION" }> =>
    event.kind === "POSITION" && checkpoint !== null && Date.parse(event.observedAt) >= checkpoint);
  for (const observation of currentPositions) {
    const episode = result.episodes.find(item => item.positionId === observation.payload.positionId && item.status === "OPEN");
    if (!episode || episode.direction !== observation.payload.direction || episode.symbol !== observation.payload.symbol
      || !parseDecimal(episode.remainingVolume).eq(observation.payload.volume)) {
      problems.push({ code: "OPEN_POSITION_MISMATCH",positionId: observation.payload.positionId,
        detail: "Current position and reconstructed execution disagree; missing history must be resolved." });
    }
  }
  for (const episode of result.episodes.filter(item => item.status === "OPEN")) {
    if (!currentPositions.some(event => event.payload.positionId === episode.positionId)) problems.push({
      code: "OPEN_POSITION_UNCONFIRMED",positionId: episode.positionId,
      detail: "No current position observation confirms this open episode. Absence is not proof of closure." });
  }
  const episodes: PreviewEpisode[] = result.episodes.map(episode => {
    const approvedMapping=input.symbolMappings?.find(mapping=>mapping.brokerSymbol===episode.symbol);
    const candidates = input.instruments.filter(instrument => approvedMapping
      ? instrument.id===approvedMapping.instrumentId : instrument.symbol === episode.symbol);
    const instrumentId = candidates.length === 1 ? candidates[0].id : null;
    if (!instrumentId) problems.push({ code: "SYMBOL_MAPPING_REQUIRED",positionId: episode.positionId,
      detail: `Explicit instrument mapping is required for ${episode.symbol}; no suffix or approximate matching is used.` });
    // Only the source's own canonical identity may update automatically. Every
    // plausible manual/other-source overlap is held for explicit reconciliation.
    const matches = input.existingTrades.filter(trade => trade.canonicalIdentity === null
      && trade.symbol === (candidates[0]?.symbol ?? episode.symbol) && trade.direction === episode.direction && trade.openedAt !== null
      && (Date.parse(trade.openedAt) === Date.parse(episode.openedAt)
        || (Date.parse(trade.openedAt) <= Date.parse(episode.closedAt ?? "9999-12-31T00:00:00Z")
          && Date.parse(trade.closedAt ?? "9999-12-31T00:00:00Z") >= Date.parse(episode.openedAt))));
    if (matches.length) problems.push({ code: "EXISTING_TRADE_MATCH",positionId: episode.positionId,
      detail: `${matches.length} existing trade(s) may represent this position. Do not duplicate or overwrite them automatically.` });
    return { episode,instrumentId,matchingTradeIds: matches.map(trade => trade.id),
      publishable: Boolean(instrumentId) && !matches.length && !revisedPositions.has(episode.positionId) };
  });
  for (const item of episodes) item.publishable &&= !problems.some(problem => problem.positionId === item.episode.positionId
    || problem.code === "INCOMPLETE_CAPTURE" || problem.code === "BASELINE_REQUIRED");
  const observations = events.filter((event): event is Extract<Mt5SourceEvent,{ kind: "ACCOUNT" }> => event.kind === "ACCOUNT")
    .sort((left,right) => left.observedAt.localeCompare(right.observedAt));
  const observed = observations.at(-1)?.payload ?? null;
  const incrementalClosedPnl = sumDecimals(episodes.filter(item => item.publishable && item.episode.status === "CLOSED").map(item => {
    const previous = input.existingTrades.find(trade => trade.canonicalIdentity === item.episode.canonicalIdentity);
    return parseDecimal(item.episode.finalNetPnl!).minus(previous?.closedNetPnl ?? "0");
  }));
  const openCash = sumDecimals(result.episodes.filter(episode => episode.status === "OPEN").map(episode => episode.recognizedCash));
  const proposedBrokerBasis = parseDecimal(input.ledgerBalance).plus(incrementalClosedPnl).plus(openCash);
  if (result.cashMovements.length) problems.push({ code: "CASH_CLASSIFICATION_REQUIRED",positionId: null,
    detail: `${result.cashMovements.length} broker cash movement(s) need baseline attribution or explicit adjustment classification. Credit facilities are not assumed to be deposits.` });
  if (!observed) problems.push({ code: "BALANCE_OBSERVATION_REQUIRED",positionId: null,detail: "No broker account observation is available." });
  else if (checkpoint !== null && Date.parse(observed.observedAt) < checkpoint) problems.push({ code: "STALE_BALANCE_OBSERVATION",positionId: null,detail: "Broker balance observation predates the completed capture." });
  return { episodes,problems,cashMovements: result.cashMovements,
    // This preview is never a reconciliation approval, even when the numbers match.
    reconciliationState: "NOT_APPROVED" as const,
    bridge: { currencyCode: input.connection.identity.currencyCode,
      openingBaseline: normalizeMoney(input.startingBalance,precision), ledgerBalance: normalizeMoney(input.ledgerBalance,precision),
      proposedClosedPnlChange: normalizeMoney(incrementalClosedPnl,precision), openTradeRecognizedCash: normalizeMoney(openCash,precision),
      proposedBrokerBalanceBasis: normalizeMoney(proposedBrokerBasis,precision),
      brokerBalance: observed ? normalizeMoney(observed.balance,precision) : null,
      brokerEquity: observed ? normalizeMoney(observed.equity,precision) : null,
      unexplainedDifference: observed ? normalizeMoney(parseDecimal(observed.balance).minus(proposedBrokerBasis),precision) : null,
    } };
}
