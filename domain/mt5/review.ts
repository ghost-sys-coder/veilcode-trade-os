import { z } from "zod";

const fingerprint = z.string().regex(/^[a-f0-9]{64}$/);
const base = z.object({ connectionId: z.string().uuid(), operationId: z.string().uuid(),
  version: z.string().regex(/^[1-9][0-9]*$/), snapshotToken: fingerprint, ledgerToken: fingerprint,
  reason: z.string().trim().min(8).max(1000) });
export const mt5ReviewRequestSchema = z.discriminatedUnion("reviewKind", [
  base.extend({ reviewKind: z.literal("SOURCE"), sourceKind: z.enum(["DEAL", "ORDER", "POSITION", "ACCOUNT"]),
    sourceId: z.string().min(1).max(64), sourceRevisionId: z.string().regex(/^[1-9][0-9]*$/) }).strict(),
  base.extend({ reviewKind: z.enum(["DISTINCT", "LINK", "REOPEN"]), canonicalIdentity: z.string().min(1).max(160),
    tradeId: z.string().uuid(), tradeToken: fingerprint }).strict(),
  base.extend({reviewKind:z.literal("CASH"),sourceId:z.string().min(1).max(64),sourceRevisionId:z.string().regex(/^[1-9][0-9]*$/),
    isPerformanceNeutral:z.boolean()}).strict(),
]);
export type Mt5ReviewRequest = z.infer<typeof mt5ReviewRequestSchema>;
export const mt5ManualDecisionSchema = z.object({ canonicalIdentity: z.string(), tradeId: z.string().uuid(),
  tradeToken: fingerprint, decision: z.enum(["DISTINCT", "LINK", "REOPEN"]), reason: z.string(), createdAt: z.string() });
export const mt5PolicyRequestSchema = base.extend({ enabled: z.boolean() }).strict();
export type Mt5PolicyRequest = z.infer<typeof mt5PolicyRequestSchema>;
