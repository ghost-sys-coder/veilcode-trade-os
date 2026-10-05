import { z } from "zod";
import { parseDecimal } from "@/domain/money/decimal";

// JSON boundaries never accept binary numbers for broker IDs or financial facts.
// Broker numeric conversion belongs to the collector; arithmetic stays here.
export const brokerIdentifier = z.string().regex(/^[1-9][0-9]{0,19}$/)
  .refine(value => /^[1-9][0-9]{0,19}$/.test(value) && BigInt(value) <= BigInt("18446744073709551615"),"Broker identifier exceeds uint64");
export const sourceDecimal = z.string().max(40).regex(/^-?(?:0|[1-9][0-9]{0,17})(?:\.[0-9]{1,18})?$/);
export const utcInstant = z.iso.datetime({ precision: 3 });
const positiveDecimal = sourceDecimal.refine(value => parseDecimal(value).gt(0),"Positive decimal required");

export const mt5DealSchema = z.object({
  ticket: brokerIdentifier,
  orderId: brokerIdentifier.nullable(),
  positionId: brokerIdentifier.nullable(),
  symbol: z.string().trim().min(1).max(128).nullable(),
  occurredAt: utcInstant,
  type: z.string().min(1).max(48),
  entry: z.enum(["IN","OUT","INOUT","OUT_BY"]).nullable(),
  volume: sourceDecimal,
  price: sourceDecimal,
  profit: sourceDecimal,
  commission: sourceDecimal,
  swap: sourceDecimal,
  fee: sourceDecimal,
  reversalAllocation: z.object({
    closingCommission: sourceDecimal,
    openingCommission: sourceDecimal,
    closingFee: sourceDecimal,
    openingFee: sourceDecimal,
  }).strict().optional(),
}).strict();
export type Mt5Deal = z.infer<typeof mt5DealSchema>;

export const mt5PositionSchema = z.object({
  positionId: brokerIdentifier,
  ticket: brokerIdentifier,
  symbol: z.string().min(1).max(128),
  direction: z.enum(["BUY","SELL"]),
  volume: positiveDecimal,
  entryPrice: sourceDecimal,
  currentStop: sourceDecimal.nullable(),
  currentTarget: sourceDecimal.nullable(),
  unrealizedPnl: sourceDecimal,
  observedAt: utcInstant,
}).strict();
export type Mt5Position = z.infer<typeof mt5PositionSchema>;

export const mt5OrderSchema = z.object({
  ticket: brokerIdentifier,
  positionId: brokerIdentifier.nullable(),
  positionById: brokerIdentifier.nullable(),
  symbol: z.string().min(1).max(128),
  type: z.string().min(1).max(48),
  state: z.string().min(1).max(48),
  initialVolume: sourceDecimal,
  remainingVolume: sourceDecimal,
  price: sourceDecimal,
  stopLoss: sourceDecimal.nullable(),
  takeProfit: sourceDecimal.nullable(),
  setupAt: utcInstant,
  doneAt: utcInstant.nullable(),
}).strict();
export const mt5AccountObservationSchema = z.object({ balance: sourceDecimal, equity: sourceDecimal,
  unrealizedPnl: sourceDecimal, observedAt: utcInstant }).strict();

const eventEnvelope = { sourceId: z.string().min(1).max(128), observedAt: utcInstant };
export const mt5SourceEventSchema = z.discriminatedUnion("kind",[
  z.object({ ...eventEnvelope, kind: z.literal("DEAL"), payload: mt5DealSchema }).strict(),
  z.object({ ...eventEnvelope, kind: z.literal("ORDER"), payload: mt5OrderSchema }).strict(),
  z.object({ ...eventEnvelope, kind: z.literal("POSITION"), payload: mt5PositionSchema }).strict(),
  z.object({ ...eventEnvelope, kind: z.literal("ACCOUNT"), payload: mt5AccountObservationSchema }).strict(),
]).superRefine((event,context) => {
  const identity = event.kind === "ACCOUNT" ? "ACCOUNT" : event.kind === "POSITION" ? event.payload.positionId : event.payload.ticket;
  if (event.sourceId !== identity) context.addIssue({ code: "custom",message: "Source event identity mismatch" });
  if ((event.kind === "ACCOUNT" || event.kind === "POSITION") && event.observedAt !== event.payload.observedAt)
    context.addIssue({ code: "custom",message: "Observation timestamp mismatch" });
});
export type Mt5SourceEvent = z.infer<typeof mt5SourceEventSchema>;

export const mt5IdentitySchema = z.object({
  server: z.string().trim().min(1).max(255),
  login: brokerIdentifier,
  terminalInstallationId: z.string().uuid(),
  currencyCode: z.string().regex(/^[A-Z]{3}$/),
  currencyPrecision: z.number().int().min(0).max(20),
  accountKind: z.enum(["DEMO","LIVE","CONTEST"]),
  positionMode: z.enum(["HEDGING","NETTING"]),
}).strict();
export type Mt5Identity = z.infer<typeof mt5IdentitySchema>;

export function assertMt5Identity(expected: Mt5Identity, observed: unknown): Mt5Identity {
  const actual = mt5IdentitySchema.parse(observed);
  const mapped = mt5IdentitySchema.parse(expected);
  if (mapped.accountKind !== "DEMO" || actual.accountKind !== "DEMO") throw new Error("DEMO_ACCOUNT_REQUIRED");
  if ((Object.keys(mapped) as (keyof Mt5Identity)[]).some(key => mapped[key] !== actual[key])) throw new Error("MT5_ACCOUNT_IDENTITY_MISMATCH");
  return actual;
}
