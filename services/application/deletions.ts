import "server-only";
import { deletionInspectSchema, deletionRequestSchema, deletionStatusSchema, deletionExecuteSchema, deletionDecisionSchema,
  deletionTargetSchema, deletionRecordSchema, deletionReceiptSchema, deletionRequestResultSchema, deletionJobSchema } from "@/domain/deletions/commands";
import { applicationTransaction, type ApplicationContext } from "@/services/application/transaction";
import { verifiedBrowserClaims, type VerifiedBrowserContext } from "@/services/integrations/browser-context";
import { getIntegrationConfig } from "@/config/integrations";
import { removeDeletionObjects } from "@/services/files/removal";

export async function inspectDeletion(context: ApplicationContext, input: unknown) {
  return deletionTargetSchema.parse(await applicationTransaction(context, "DELETION_READ", { action: "INSPECT", ...deletionInspectSchema.parse(input) }));
}
export async function requestDeletion(context: ApplicationContext, input: unknown) {
  const receipt = deletionReceiptSchema.parse(await applicationTransaction(context, "DELETION_WRITE", { action: "REQUEST", ...deletionRequestSchema.parse(input) }));
  const origin = new URL(getIntegrationConfig("MCP").resource).origin;
  return deletionRequestResultSchema.parse({ ...receipt, approvalUrl: `${origin}/settings/integrations/deletions/${receipt.request.requestId}` });
}
export async function getDeletion(context: ApplicationContext, input: unknown) {
  return deletionRecordSchema.parse(await applicationTransaction(context, "DELETION_READ", { action: "STATUS", ...deletionStatusSchema.parse(input) }));
}
export async function decideDeletion(context: VerifiedBrowserContext, input: unknown) {
  verifiedBrowserClaims(context);
  return deletionReceiptSchema.parse(await applicationTransaction(context, "DELETION_WRITE", { action: "DECIDE", ...deletionDecisionSchema.parse(input) }));
}
/** Fresh authorization before bytes, then verify absence inside a new commit. */
async function settleDeletion(context: ApplicationContext, requestId: string) {
  const source = await applicationTransaction(context, "DELETION_READ", { action: "JOB", requestId });
  if (source === null) return;
  const job = deletionJobSchema.parse(source);
  await removeDeletionObjects(job);
  await applicationTransaction(context, "DELETION_WRITE", { action: "SETTLE", operationId: job.settleOperationId, requestId });
}
export async function executeDeletion(context: ApplicationContext, input: unknown) {
  const command = deletionExecuteSchema.parse(input);
  const receipt = deletionReceiptSchema.parse(await applicationTransaction(context, "DELETION_WRITE", { action: "EXECUTE", ...command }));
  if (receipt.request.status === "PURGE_PENDING") {
    try { await settleDeletion(context, command.requestId); } catch { /* Immutable accepted receipt. STATUS exposes pending/completed, never false success. */ }
  }
  return receipt;
}
/** Owner can settle already-consumed work after its original client is revoked. */
export async function resumeDeletion(context: VerifiedBrowserContext, input: unknown) {
  verifiedBrowserClaims(context); const command = deletionStatusSchema.parse(input);
  await settleDeletion(context, command.requestId);
  return getDeletion(context, command);
}
