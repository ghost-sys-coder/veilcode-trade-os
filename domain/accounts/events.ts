import { z } from "zod";
import { utcInstantSchema } from "@/domain/validation/utc";
import { normalizeMoney,parseDecimal } from "@/domain/money/decimal";
import { normalizeAdjustmentAmount } from "@/domain/journal/analytics";
import { ACCOUNT_STATUSES,ACCOUNT_FAILURE_REASONS,ACCOUNT_PLATFORMS,ADJUSTMENT_TYPES } from "@/types/domain";
import { recordVersionSchema } from "@/domain/configuration/commands";

export const eventDecimal=z.string().max(40).regex(/^-?(?:0|[1-9]\d{0,15})(?:\.\d{1,20})?$/);
const notes=z.string().trim().max(2000).nullable().optional();
const identity={operationId:z.string().uuid(),accountId:z.string().uuid()};
export const adjustmentCreateSchema=z.object({...identity,type:z.enum(ADJUSTMENT_TYPES),amount:eventDecimal,occurredAt:utcInstantSchema,notes,
  isPerformanceNeutral:z.boolean().optional(),classificationReason:z.string().trim().min(5).max(1000).optional()}).strict().superRefine((value,ctx)=>{
  if(value.type==="OTHER"&&(value.isPerformanceNeutral===undefined||!value.classificationReason))ctx.addIssue({code:"custom",message:"OTHER requires an explicit classification and reason."});
  if(value.type!=="OTHER"&&value.isPerformanceNeutral===false)ctx.addIssue({code:"custom",message:"Fixed adjustment types are always performance neutral."});
  if(value.type==="BALANCE_CORRECTION"&&(!value.notes||value.notes.length<5))ctx.addIssue({code:"custom",message:"Balance corrections require a meaningful note."});
  if(parseDecimal(value.amount).isZero())ctx.addIssue({code:"custom",message:"Adjustment amount cannot be zero."});
});
export const adjustmentClassifySchema=z.object({operationId:z.string().uuid(),id:z.string().uuid(),expectedVersion:recordVersionSchema,
  isPerformanceNeutral:z.boolean(),reason:z.string().trim().min(5).max(1000)}).strict();
export const snapshotRecordSchema=z.object({...identity,balance:eventDecimal,equity:eventDecimal.optional(),unrealizedPnl:eventDecimal.optional(),capturedAt:utcInstantSchema,notes})
  .strict().superRefine((value,ctx)=>{
    if(value.equity===undefined&&value.unrealizedPnl===undefined)ctx.addIssue({code:"custom",message:"Equity or unrealized PnL is required."});
    if(parseDecimal(value.balance).lt(0)||value.equity!==undefined&&parseDecimal(value.equity).lt(0))ctx.addIssue({code:"custom",message:"Snapshot balance/equity cannot be negative."});
  });
export const accountTransitionSchema=z.object({...identity,expectedVersion:recordVersionSchema,status:z.enum(ACCOUNT_STATUSES),effectiveAt:utcInstantSchema,
  failureReason:z.enum(ACCOUNT_FAILURE_REASONS).nullable().optional(),reason:z.string().trim().min(5).max(2000)}).strict().superRefine((v,ctx)=>{
    if((v.status==="FAILED")!==Boolean(v.failureReason))ctx.addIssue({code:"custom",message:"Failure reason is required only for FAILED."});
  });
export const fundedLinkSchema=z.object({...identity,expectedVersion:recordVersionSchema,name:z.string().trim().min(2).max(80),
  startingBalance:eventDecimal,platform:z.enum(ACCOUNT_PLATFORMS),startedAt:z.iso.date(),notes}).strict();
export const accountEventListSchema=z.object({accountId:z.string().uuid(),kind:z.enum(["ADJUSTMENTS","CLASSIFICATIONS","SNAPSHOTS","LIFECYCLE"]),
  afterId:z.string().uuid().optional(),limit:z.number().int().min(1).max(100).default(50)}).strict();
export const eventResultSchema=z.object({action:z.enum(["ADJUSTMENT","CLASSIFY","SNAPSHOT","TRANSITION","LINK_FUNDED"]),
  record:z.record(z.string(),z.unknown())}).strict();
export const eventPageSchema=z.object({records:z.array(z.record(z.string(),z.unknown())),nextCursor:z.string().uuid().nullable()}).strict();

export function accountEventCommand(action:z.infer<typeof eventResultSchema>["action"],input:unknown) {
  const value=action==="ADJUSTMENT"?adjustmentCreateSchema.parse(input):action==="CLASSIFY"?adjustmentClassifySchema.parse(input)
    :action==="SNAPSHOT"?snapshotRecordSchema.parse(input):action==="TRANSITION"?accountTransitionSchema.parse(input):fundedLinkSchema.parse(input);
  return {...value,action};
}
export function prepareAccountEvent(request:ReturnType<typeof accountEventCommand>,snapshot:unknown) {
  const {account}=z.object({account:z.object({currency_precision:z.number().int().min(0).max(20)})}).parse(snapshot);
  const precision=account.currency_precision;
  if(request.action==="ADJUSTMENT"&&"amount" in request)return {amount:normalizeMoney(normalizeAdjustmentAmount(request.type,request.amount),precision)};
  if(request.action==="LINK_FUNDED"&&"startingBalance" in request)return {startingBalance:normalizeMoney(request.startingBalance,precision)};
  if(request.action==="SNAPSHOT"&&"balance" in request) {
    const balance=normalizeMoney(request.balance,precision);
    const equity=normalizeMoney(request.equity??parseDecimal(balance).plus(request.unrealizedPnl!),precision);
    const unrealizedPnl=normalizeMoney(parseDecimal(equity).minus(balance),precision);
    if(request.unrealizedPnl!==undefined&&normalizeMoney(request.unrealizedPnl,precision)!==unrealizedPnl)throw new RangeError("Snapshot equation conflict.");
    return {balance,equity,unrealizedPnl};
  }
  return {};
}
