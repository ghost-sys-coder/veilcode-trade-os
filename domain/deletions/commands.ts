import { z } from "zod";

export const DELETION_ENTITIES = ["STRATEGY", "SETUP", "RULE", "GOAL", "TAG", "INSTRUMENT", "SCREENSHOT"] as const;
const id = z.string().uuid();
const version = z.string().regex(/^(?:[1-9]\d{0,18}|[a-f0-9]{64})$/)
  .refine(v => v.length === 64 || (/^[1-9]\d{0,18}$/.test(v) && BigInt(v) <= BigInt("9223372036854775807")));
const operation = { operationId: id };
export const deletionInspectSchema = z.object({ entity: z.enum(DELETION_ENTITIES), id }).strict();
export const deletionRequestSchema = z.object({ ...operation, ...deletionInspectSchema.shape,
  expectedVersion: version, executionOperationId: id, reason: z.string().trim().min(5).max(1000) }).strict()
  .refine(v => v.operationId !== v.executionOperationId, "Request and execution require different operation IDs.");
export const deletionStatusSchema = z.object({ requestId: id }).strict();
export const deletionExecuteSchema = z.object({ ...operation, requestId: id }).strict();
export const deletionDecisionSchema = z.object({ ...operation, requestId: id, expectedVersion: version,
  decision: z.enum(["APPROVE", "REJECT"]), acknowledged: z.boolean() }).strict()
  .refine(v => v.decision === "REJECT" || v.acknowledged, "Explicit acknowledgement is required for approval.");
export const deletionTargetSchema = z.object({ entity: z.enum(DELETION_ENTITIES), id, version,
  name: z.string(), tradeId: id.nullable(), accountName: z.string().nullable(),
  referenceCount: z.number().int().nonnegative(), effect: z.enum(["DELETE", "ARCHIVE"]) }).strict();
export const deletionRecordSchema = z.object({ requestId: id, target: deletionTargetSchema,
  clientName: z.string(), clientId: id, executionOperationId: id, reason: z.string(),
  status: z.enum(["PENDING", "APPROVED", "REJECTED", "EXPIRED", "ARCHIVED", "PURGE_PENDING", "DELETED"]),
  version, expiresAt: z.string(), approvedAt: z.string().nullable(), consumedAt: z.string().nullable(),
  completedAt: z.string().nullable() }).strict();
export const deletionReceiptSchema = z.object({ action: z.enum(["REQUEST", "DECIDE", "EXECUTE", "SETTLE"]),
  request: deletionRecordSchema }).strict();
export const deletionRequestResultSchema = deletionReceiptSchema.extend({ approvalUrl: z.string().url() }).strict();
export const deletionJobSchema = z.object({ requestId: id, ownerId: id, tradeId: id,
  settleOperationId: id, objects: z.array(z.object({ bucket: z.enum(["trade-screenshots", "trade-file-staging"]), path: z.string() }).strict()).min(1).max(28) }).strict();
export type DeletionRecord = z.infer<typeof deletionRecordSchema>;
