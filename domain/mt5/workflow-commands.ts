import {z} from "zod";
import {mt5IdentitySchema,brokerIdentifier} from "./source";
import {mt5SymbolMappingRequestSchema} from "./symbol-mapping";
import {mt5CashRequestSchema,prepareMt5CashDecision} from "./cash";
import {mt5OnboardingRequestSchema,prepareMt5OnboardingApproval} from "./onboarding-approval";
import {mt5PublicationRequestSchema,prepareMt5Publication} from "./publication";
import {mt5PolicyRequestSchema} from "./review";
import {decodeMt5Snapshot} from "./snapshot";

export const mt5RegisterRequestSchema=z.object({grantId:z.string().uuid(),operationId:z.string().uuid(),
  identity:mt5IdentitySchema.refine(i=>i.accountKind==="DEMO","Demo identity required")}).strict();
export const mt5ControlRequestSchema=z.object({connectionId:z.string().uuid(),operationId:z.string().uuid(),
  version:z.string().regex(/^[1-9][0-9]*$/),action:z.enum(["PAUSE","RESUME"]),reason:z.string().trim().min(8).max(1000)}).strict();
export const mt5GrantListSchema=z.object({accountId:z.string().uuid().optional(),afterId:z.string().uuid().optional(),
  limit:z.number().int().min(1).max(100).default(50)}).strict();
export const mt5WorkflowRequestSchema=z.discriminatedUnion("kind",[
  z.object({kind:z.literal("REGISTER"),command:mt5RegisterRequestSchema}).strict(),
  z.object({kind:z.literal("CONTROL"),command:mt5ControlRequestSchema}).strict(),
  z.object({kind:z.literal("SYMBOL_MAPPING"),command:mt5SymbolMappingRequestSchema}).strict(),
  z.object({kind:z.literal("CASH"),command:mt5CashRequestSchema}).strict(),
  z.object({kind:z.literal("ONBOARDING"),command:mt5OnboardingRequestSchema}).strict(),
  z.object({kind:z.literal("PUBLICATION"),command:mt5PublicationRequestSchema}).strict(),
  z.object({kind:z.literal("POLICY"),command:mt5PolicyRequestSchema}).strict(),
]);
export type Mt5WorkflowRequest=z.infer<typeof mt5WorkflowRequestSchema>;
const resultBase={connectionId:z.string().uuid(),version:z.string().regex(/^[1-9][0-9]*$/)};
export const mt5WorkflowResultSchemas={
  REGISTER:z.object({...resultBase,status:z.literal("ONBOARDING")}).strict(),
  CONTROL:z.object({...resultBase,status:z.enum(["PAUSED","ONBOARDING","ACTIVE"])}).strict(),
  SYMBOL_MAPPING:z.object({...resultBase,brokerSymbol:z.string(),instrumentId:z.string().uuid(),mappingVersion:z.string().regex(/^[1-9][0-9]*$/)}).strict(),
  CASH:z.object({...resultBase,sourceTicket:brokerIdentifier,adjustmentId:z.string().uuid().nullable()}).strict(),
  ONBOARDING:z.object({...resultBase,approvalId:z.string().uuid(),reconciliationState:z.literal("APPROVED_SNAPSHOT")}).strict(),
  PUBLICATION:z.object({...resultBase,tradeIds:z.array(z.string().uuid()),importBatchId:z.string().uuid(),reconciliationState:z.literal("NOT_APPROVED")}).strict(),
  POLICY:z.object({...resultBase,reviewKind:z.literal("POLICY")}).strict(),
};
export const mt5GrantPageSchema=z.object({records:z.array(z.object({id:z.string().uuid(),accountId:z.string().uuid(),accountName:z.string(),
  clientId:z.string().uuid(),resource:z.string().url(),version:z.string().regex(/^[1-9][0-9]*$/),status:z.literal("ACTIVE")}).strict()),nextCursor:z.string().uuid().nullable()}).strict();
/** Only decisions enter from clients; calculated cash/execution/proof stays central. */
export function prepareMt5Workflow(request:Mt5WorkflowRequest,raw:unknown):object {
  if(!["CASH","ONBOARDING","PUBLICATION"].includes(request.kind))return {};
  const snapshot=decodeMt5Snapshot(raw);
  const input={...snapshot,startingBalance:snapshot.account.startingBalance,ledgerBalance:snapshot.account.ledgerBalance};
  try {
    switch(request.kind) {
      case "CASH":return prepareMt5CashDecision(snapshot.sources,request.command,snapshot.account.currencyPrecision);
      case "ONBOARDING":return prepareMt5OnboardingApproval(input,request.command);
      case "PUBLICATION":return prepareMt5Publication(input,request.command);
      default:return {};
    }
  } catch {throw new RangeError("MT5 workflow evidence requires review.");}
}
