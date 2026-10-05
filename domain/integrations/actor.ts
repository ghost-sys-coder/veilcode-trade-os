import { z } from "zod";

export const integrationPurposeSchema = z.enum(["MT5", "MCP"]);
export const integrationActorSchema = z.object({
  user_id: z.string().uuid(), client_id: z.string().uuid(), grant_id: z.string().uuid(),
  grant_version: z.string().regex(/^[1-9][0-9]*$/), purpose: integrationPurposeSchema,
  account_id: z.string().uuid().nullable(), resource: z.string().url(),
}).superRefine((actor, context) => {
  if ((actor.purpose === "MT5") !== (actor.account_id !== null)) {
    context.addIssue({ code: "custom", message: "Invalid integration account scope" });
  }
});
export type IntegrationActor = z.infer<typeof integrationActorSchema>;

export class IntegrationAuthorizationError extends Error {
  constructor() { super("Integration access denied."); this.name = "IntegrationAuthorizationError"; }
}
export class IntegrationUnavailableError extends Error {
  constructor() { super("Integration verification temporarily unavailable."); this.name = "IntegrationUnavailableError"; }
}
