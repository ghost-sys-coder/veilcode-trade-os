import { z } from "zod";
import { mt5SnapshotDecision } from "@/domain/mt5/cash";
import { buildMt5OnboardingPreview } from "@/domain/mt5/onboarding";
import { prepareMt5Publication } from "@/domain/mt5/publication";
import { normalizeMoney, parseDecimal } from "@/domain/money/decimal";

export const mt5OnboardingRequestSchema = z.object({ ...mt5SnapshotDecision,
  openingBaseline: z.string().max(40).regex(/^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/),
  availableHistoryConfirmed: z.literal(true),
}).strict();
export type Mt5OnboardingRequest = z.infer<typeof mt5OnboardingRequestSchema>;

export function prepareMt5OnboardingApproval(input: Parameters<typeof buildMt5OnboardingPreview>[0] & {
  snapshotToken: string; ledgerToken: string;
}, request: Mt5OnboardingRequest) {
  const preview = buildMt5OnboardingPreview(input);
  if (input.connection.id !== request.connectionId || input.connection.version !== request.version
    || input.snapshotToken !== request.snapshotToken || input.ledgerToken !== request.ledgerToken
    || input.connection.identity.accountKind !== "DEMO" || !["ONBOARDING", "ACTIVE", "PAUSED"].includes(input.connection.status)
    || !parseDecimal(input.startingBalance).gt(0)
    || normalizeMoney(request.openingBaseline, input.connection.identity.currencyPrecision) !== preview.bridge.openingBaseline
    || preview.problems.length || preview.bridge.unexplainedDifference === null || !parseDecimal(preview.bridge.unexplainedDifference).isZero()
    || !parseDecimal(preview.bridge.proposedClosedPnlChange).isZero()
    || preview.episodes.some(item => !input.existingTrades.some(trade => trade.canonicalIdentity === item.episode.canonicalIdentity)))
    throw new Error("MT5_PUBLICATION_REVIEW_REQUIRED");
  const episodes = preview.episodes.length ? prepareMt5Publication(input, {
    ...request, episodeIdentities: preview.episodes.map(item => item.episode.canonicalIdentity),
  }).episodes : [];
  return { episodes, bridge: preview.bridge, availableHistoryConfirmed: true };
}
