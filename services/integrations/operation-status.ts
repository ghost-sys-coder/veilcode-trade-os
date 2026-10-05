import { z } from "zod";
import type { IntegrationContext } from "@/services/integrations/actor-context";
import { integrationDatabaseError } from "@/domain/mt5/protocol";

const operationStatusSchema = z.discriminatedUnion("status",[
  z.object({ operationId: z.string().uuid(),status: z.literal("UNKNOWN") }).strict(),
  z.object({ operationId: z.string().uuid(),status: z.literal("COMMITTED"),kind: z.string(),
    result: z.record(z.string(),z.unknown()),createdAt: z.iso.datetime({ offset: true }) }).strict(),
]);
/** A committed receipt is authoritative; UNKNOWN is a point-in-time observation. */
export async function getIntegrationOperation(context: IntegrationContext,operationId: unknown) {
  const id = z.string().uuid().parse(operationId);
  const response = await context.client.rpc("get_integration_operation", { p_resource: context.actor.resource,p_purpose: context.actor.purpose,p_operation_id: id });
  if (response.error) throw integrationDatabaseError(response.error.code);
  return operationStatusSchema.parse(response.data);
}
