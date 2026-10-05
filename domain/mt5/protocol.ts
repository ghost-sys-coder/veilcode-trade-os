import { z } from "zod";
import { mt5IdentitySchema, mt5SourceEventSchema, utcInstant } from "@/domain/mt5/source";

export const leaseInputSchema = z.object({ connectionId: z.string().uuid(),workerId: z.string().uuid(),operationId: z.string().uuid() }).strict();
export const captureInputSchema = leaseInputSchema.extend({ fencingToken: z.string().regex(/^[1-9][0-9]*$/),
  identity: mt5IdentitySchema,checkpoint: utcInstant,events: z.array(mt5SourceEventSchema).max(200) }).strict()
  .superRefine((batch,context) => {
    const keys = batch.events.map(event => `${event.kind}:${event.sourceId}`);
    if (new Set(keys).size !== keys.length) context.addIssue({ code: "custom",message: "Duplicate source keys in capture batch" });
  });
export const registerConnectionSchema = z.object({ grantId: z.string().uuid(),operationId: z.string().uuid(),identity: mt5IdentitySchema }).strict();
const responseInstant = z.iso.datetime({ offset: true }).transform(value => new Date(value).toISOString());
export const leaseResultSchema = z.object({ connectionId: z.string().uuid(),fencingToken: z.string().regex(/^[1-9][0-9]*$/),leaseExpiresAt: responseInstant });
export const captureResultSchema = z.discriminatedUnion("status",[
  z.object({ connectionId: z.string().uuid(),status: z.literal("STAGED"),revisionCount: z.number().int().nonnegative(),checkpoint: responseInstant,reviewCount: z.number().int().nonnegative() }),
  z.object({ connectionId: z.string().uuid(),status: z.literal("ATTENTION"),code: z.literal("MT5_ACCOUNT_IDENTITY_MISMATCH") }),
]);
export const registrationResultSchema = z.object({ connectionId: z.string().uuid(),version: z.string().regex(/^[1-9][0-9]*$/),status: z.literal("ONBOARDING") });
export class IntegrationWorkflowError extends Error {
  constructor(readonly code: "OPERATION_CONFLICT" | "COLLECTOR_LEASE_HELD" | "COLLECTOR_REQUIRES_ATTENTION" | "INVALID_INTEGRATION_INPUT" | "INTEGRATION_ACCESS_DENIED" | "INTEGRATION_UNAVAILABLE") {
    super(code); this.name = "IntegrationWorkflowError";
  }
}
export function integrationDatabaseError(code?: string): IntegrationWorkflowError {
  const errors: Record<string,IntegrationWorkflowError["code"]> = {
    "23505": "OPERATION_CONFLICT", "40001": "OPERATION_CONFLICT", "55P03": "COLLECTOR_LEASE_HELD",
    "55000": "COLLECTOR_REQUIRES_ATTENTION", "22023": "INVALID_INTEGRATION_INPUT", "42501": "INTEGRATION_ACCESS_DENIED",
  };
  return new IntegrationWorkflowError(errors[code ?? ""] ?? (code?.startsWith("22") ? "INVALID_INTEGRATION_INPUT" : "INTEGRATION_UNAVAILABLE"));
}
