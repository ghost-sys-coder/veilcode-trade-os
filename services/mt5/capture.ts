import type { IntegrationContext } from "@/services/integrations/actor-context";
import { captureInputSchema, captureResultSchema, integrationDatabaseError, leaseInputSchema, leaseResultSchema } from "@/domain/mt5/protocol";
import { IntegrationAuthorizationError } from "@/domain/integrations/actor";

function requireMt5(context: IntegrationContext) {
  if (context.actor.purpose !== "MT5" || !context.actor.account_id) throw new IntegrationAuthorizationError();
}
export async function acquireCollectorLease(context: IntegrationContext, input: unknown) {
  requireMt5(context);
  const data = leaseInputSchema.parse(input);
  const result = await context.client.rpc("mt5_acquire_lease", { p_resource: context.actor.resource,
    p_connection_id: data.connectionId,p_worker_id: data.workerId,p_operation_id: data.operationId });
  if (result.error) throw integrationDatabaseError(result.error.code);
  return leaseResultSchema.parse(result.data);
}
export async function captureMt5Batch(context: IntegrationContext, input: unknown) {
  requireMt5(context);
  const data = captureInputSchema.parse(input);
  const result = await context.client.rpc("mt5_capture", { p_resource: context.actor.resource,p_connection_id: data.connectionId,
    p_worker_id: data.workerId,p_fencing_token: data.fencingToken,p_operation_id: data.operationId,
    p_identity: data.identity,p_checkpoint: data.checkpoint,p_events: data.events,p_collection: data.collection });
  if (result.error) throw integrationDatabaseError(result.error.code);
  return captureResultSchema.parse(result.data);
}
