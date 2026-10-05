import { z } from "zod";
import { buildMt5OnboardingPreview, type Mt5StoredSource } from "@/domain/mt5/onboarding";
import { normalizeMoney, parseDecimal } from "@/domain/money/decimal";

const fingerprint = z.string().regex(/^[a-f0-9]{64}$/);
// A browser submits decisions and concurrency tokens, NEVER calculated execution facts.
export const mt5PublicationRequestSchema = z.object({
  connectionId: z.string().uuid(), operationId: z.string().uuid(), version: z.string().regex(/^[1-9][0-9]*$/),
  snapshotToken: fingerprint, ledgerToken: fingerprint,
  openingBaseline: z.string().max(40).regex(/^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/),
  reason: z.string().trim().min(8).max(1000),
  episodeIdentities: z.array(z.string().min(1).max(160)).min(1).max(1000),
}).strict().transform(value => ({ ...value,episodeIdentities: [...new Set(value.episodeIdentities)].sort() }));
export type Mt5PublicationRequest = z.infer<typeof mt5PublicationRequestSchema>;

export class Mt5PublicationConflict extends Error {
  constructor() { super("MT5_PUBLICATION_REVIEW_REQUIRED"); }
}

/** Only durable, validated source revisions feed the central reconstruction. */
export function prepareMt5Publication(input: Parameters<typeof buildMt5OnboardingPreview>[0] & {
  snapshotToken: string; ledgerToken: string;
}, request: Mt5PublicationRequest) {
  if (input.connection.id !== request.connectionId || input.connection.version !== request.version
    || input.snapshotToken !== request.snapshotToken || input.ledgerToken !== request.ledgerToken
    || input.connection.identity.accountKind !== "DEMO"
    || !["ONBOARDING","ACTIVE","PAUSED"].includes(input.connection.status)
    || !parseDecimal(input.startingBalance).gt(0)
    || normalizeMoney(request.openingBaseline,input.connection.identity.currencyPrecision)
      !== normalizeMoney(input.startingBalance,input.connection.identity.currencyPrecision)) throw new Mt5PublicationConflict();
  const preview = buildMt5OnboardingPreview(input);
  const revisions = new Map<string,Mt5StoredSource>();
  for (const source of input.sources) if (source.kind === "DEAL") revisions.set(source.sourceId,source);
  const episodes = request.episodeIdentities.map(identity => {
    const item = preview.episodes.find(candidate => candidate.episode.canonicalIdentity === identity);
    if (!item?.publishable || !item.instrumentId) throw new Mt5PublicationConflict();
    const sourceRevisions = [...new Set(item.episode.allocations.map(allocation => allocation.dealTicket))].map(ticket => {
      const source = revisions.get(ticket);
      if (!source || source.requiresReview) throw new Mt5PublicationConflict();
      return { sourceId: ticket,revisionId: source.revisionId };
    });
    return { ...item.episode,instrumentId: item.instrumentId,sourceRevisions };
  });
  return { episodes,unresolvedProblemCount: preview.problems.length,
    // Publishing a safe subset does not approve financial reconciliation or cash classifications.
    reconciliationState: "NOT_APPROVED" as const };
}
