import { z } from "zod";
import { brokerIdentifier, type Mt5Deal } from "@/domain/mt5/source";
import { normalizeMoney, parseDecimal, sumDecimals } from "@/domain/money/decimal";
import type { Mt5StoredSource } from "@/domain/mt5/onboarding";

const version = z.string().regex(/^[1-9][0-9]*$/);
export const mt5SnapshotDecision = {
  connectionId: z.string().uuid(), operationId: z.string().uuid(), version,
  snapshotToken: z.string().regex(/^[a-f0-9]{64}$/), ledgerToken: z.string().regex(/^[a-f0-9]{64}$/),
  reason: z.string().trim().min(8).max(1000),
};
export const mt5CashRequestSchema = z.object({
  ...mt5SnapshotDecision, sourceTicket: brokerIdentifier, sourceRevisionId: version,
  disposition: z.enum(["BASELINE_FUNDING", "ADJUSTMENT", "LINK_EXISTING", "ZERO_EFFECT"]),
  adjustmentType: z.enum(["DEPOSIT", "WITHDRAWAL", "BALANCE_CORRECTION", "OTHER"]).nullable(),
  isPerformanceNeutral: z.boolean().nullable(), existingAdjustmentId: z.string().uuid().nullable(),
}).strict().superRefine((value, context) => {
  const adjustment = ["ADJUSTMENT", "LINK_EXISTING"].includes(value.disposition);
  if (adjustment && (!value.adjustmentType || value.isPerformanceNeutral === null))
    context.addIssue({ code: "custom", message: "Explicit adjustment type and performance classification required" });
  if (value.adjustmentType && value.adjustmentType !== "OTHER" && value.isPerformanceNeutral !== true)
    context.addIssue({ code: "custom", message: "Fixed adjustment types are performance-neutral" });
  if ((value.disposition === "LINK_EXISTING") !== (value.existingAdjustmentId !== null)
    || (!adjustment && (value.adjustmentType !== null || value.isPerformanceNeutral !== null)))
    context.addIssue({ code: "custom", message: "Invalid cash disposition fields" });
});
export type Mt5CashRequest = z.infer<typeof mt5CashRequestSchema>;
export const mt5CashDecisionSchema = z.object({
  sourceTicket: brokerIdentifier, sourceRevisionId: version,
  disposition: z.enum(["BASELINE_FUNDING", "ADJUSTMENT", "LINK_EXISTING", "ZERO_EFFECT", "RECONCILED"]),
  amount: z.string(), adjustmentId: z.string().uuid().nullable(), reason: z.string(), createdAt: z.iso.datetime({ offset: true }),
});
export type Mt5CashDecision = z.infer<typeof mt5CashDecisionSchema>;

export const supportedCashTypes = ["BALANCE", "CHARGE", "CORRECTION", "BONUS", "COMMISSION", "COMMISSION_DAILY",
  "COMMISSION_MONTHLY", "COMMISSION_AGENT_DAILY", "COMMISSION_AGENT_MONTHLY", "INTEREST", "DIVIDEND", "DIVIDEND_FRANKED", "TAX"];
export function cashMovementAmount(deal: Mt5Deal, precision: number): string {
  return normalizeMoney(sumDecimals([deal.profit, deal.commission, deal.swap, deal.fee]), precision);
}
export function prepareMt5CashDecision(sources: Mt5StoredSource[], request: Mt5CashRequest, precision: number) {
  const source = sources.find(item => item.kind === "DEAL" && item.sourceId === request.sourceTicket);
  if (!source || source.requiresReview || source.revisionId !== request.sourceRevisionId || source.event.kind !== "DEAL")
    throw new Error("MT5_PUBLICATION_REVIEW_REQUIRED");
  const deal = source.event.payload;
  if (deal.positionId !== null || !supportedCashTypes.includes(deal.type)) throw new Error("MT5_PUBLICATION_REVIEW_REQUIRED");
  const amount = cashMovementAmount(deal, precision);
  const value = parseDecimal(amount);
  if ((request.disposition === "ZERO_EFFECT") !== value.isZero()
    || (request.disposition === "BASELINE_FUNDING" && (deal.type !== "BALANCE" || !value.gt(0)))
    || (request.adjustmentType === "DEPOSIT" && (deal.type !== "BALANCE" || !value.gt(0)))
    || (request.adjustmentType === "WITHDRAWAL" && (deal.type !== "BALANCE" || !value.lt(0)))
    || (request.adjustmentType === "BALANCE_CORRECTION" && deal.type !== "CORRECTION"))
    throw new Error("MT5_PUBLICATION_REVIEW_REQUIRED");
  return { amount, occurredAt: deal.occurredAt };
}
