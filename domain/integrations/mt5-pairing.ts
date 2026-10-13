import { z } from "zod";
import { mt5IdentitySchema } from "@/domain/mt5/source";

export const windowsLocalPath = z.string().min(4).max(2048).refine(value =>
  /^[A-Za-z]:\\/.test(value) && !/[\x00-\x1f<>|?*"]/.test(value) && !value.slice(2).includes(":")
  && value.split("\\").slice(1).every(part => part !== "." && part !== ".." && part !== "" && !/[. ]$/.test(part)),
"A canonical local Windows path is required");
export const mt5PairingProposalSchema = z.object({
  format: z.literal("trade-os-mt5-pairing"), version: z.literal(1),
  profileId: z.string().uuid(), ownerId: z.string().uuid(), accountId: z.string().uuid(), clientId: z.string().uuid(),
  observedAt: z.iso.datetime(), existingConnectionId: z.string().uuid().nullable(),
  terminal: z.object({
    executable: windowsLocalPath.refine(value => /\\terminal64\.exe$/i.test(value)),
    dataPath: windowsLocalPath, portable: z.boolean(), dedicatedApproved: z.literal(true),
    identity: mt5IdentitySchema.refine(identity => identity.accountKind === "DEMO", "Demo identity required"),
  }).strict(),
}).strict();
export type Mt5PairingProposal = z.infer<typeof mt5PairingProposalSchema>;
export const mt5PairingApprovalSchema = z.object({
  profileId: z.string().uuid(), profileVersion: z.string().regex(/^[1-9][0-9]*$/),
  operationId: z.string().uuid(), proposal: mt5PairingProposalSchema,
  connectionVersion: z.string().regex(/^[1-9][0-9]*$/).nullable(),
  reason: z.string().trim().min(8).max(1000), confirmed: z.literal(true),
}).strict().superRefine((value, ctx) => {
  if (value.profileId !== value.proposal.profileId || (value.connectionVersion !== null) !== (value.proposal.existingConnectionId !== null))
    ctx.addIssue({code: "custom", message: "Pairing binding mismatch"});
});
export const mt5PairingViewSchema = z.object({
  proposal: mt5PairingProposalSchema, connectionId: z.string().uuid(),
  approvedAt: z.iso.datetime({offset: true}), reason: z.string(), operationId: z.string().uuid(),
}).strict();

export function pairingManifest(proposal: Mt5PairingProposal, connectionId: string, oauth: {
  issuer: string; applicationOrigin: string; clientId: string; allowLocalHttp: boolean;
}) {
  if (oauth.clientId !== proposal.clientId) throw Error("PAIRING_BINDING_MISMATCH");
  return {version: 1, binding: {ownerId: proposal.ownerId, accountId: proposal.accountId, connectionId: z.string().uuid().parse(connectionId)},
    oauth, terminal: proposal.terminal, callbackUri: "http://127.0.0.1:9876/callback"};
}
