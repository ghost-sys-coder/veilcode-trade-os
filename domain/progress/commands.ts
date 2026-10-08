import {z} from "zod";
import {recordVersionSchema} from "@/domain/configuration/commands";
import {utcInstantSchema} from "@/domain/validation/utc";
import {normalizeMoney,parseDecimal} from "@/domain/money/decimal";
import {GOAL_TYPES,PROP_VALUE_MODES,PROP_DAILY_BASELINES,PROP_TOTAL_BASELINES,PROP_LOSS_MEASURES,PROP_DRAWDOWN_TYPES,PROP_CONSISTENCY_FORMULAS} from "@/types/domain";

const decimal=z.string().max(80).regex(/^-?(?:0|[1-9]\d{0,15})(?:\.\d{1,20})?$/);
const positive=decimal.refine(value=>parseDecimal(value).gt(0),"A positive decimal string is required.");
const text=z.string().trim().max(4000).nullable();
const goalFields={title:z.string().trim().min(2).max(120),goal_type:z.enum(GOAL_TYPES),target_value:positive,
  target_date:z.iso.date().nullable(),custom_unit:z.string().trim().min(1).max(40).nullable(),notes:text,active:z.boolean()};
export const goalValuesSchema=z.object(goalFields).strict().superRefine((value,context)=>{
  if((value.goal_type==="CUSTOM")!==(value.custom_unit!==null))context.addIssue({code:"custom",path:["custom_unit"],message:"Only CUSTOM goals require a unit."});
  if(["TOTAL_TRADES","PROFITABLE_DAYS"].includes(value.goal_type) && !parseDecimal(value.target_value).isInteger())context.addIssue({code:"custom",path:["target_value"],message:"Count goals require whole-number targets."});
  if(["RULE_COMPLIANCE_PERCENT","MAX_DRAWDOWN_PERCENT"].includes(value.goal_type) && parseDecimal(value.target_value).gt(100))context.addIssue({code:"custom",path:["target_value"],message:"This percentage target cannot exceed 100."});
});
const operation={operationId:z.string().uuid()};
export const goalGetSchema=z.object({id:z.string().uuid()}).strict();
export const goalListSchema=z.object({accountId:z.string().uuid(),afterId:z.string().uuid().optional(),limit:z.number().int().min(1).max(100).default(50),includeArchived:z.boolean().default(false)}).strict();
export const goalCreateSchema=z.object({...operation,accountId:z.string().uuid(),values:goalValuesSchema}).strict();
export const goalPatchSchema=z.object({...operation,id:z.string().uuid(),expectedVersion:recordVersionSchema,
  values:z.object(goalFields).partial().strict().refine(value=>Object.keys(value).length>0,"Submit at least one field.")}).strict();
export const goalArchiveSchema=z.object({...operation,id:z.string().uuid(),expectedVersion:recordVersionSchema,reason:z.string().trim().min(5).max(1000)}).strict();
export const goalProgressSchema=z.object({...operation,goalId:z.string().uuid(),expectedVersion:recordVersionSchema,progressValue:decimal,recordedAt:utcInstantSchema,notes:text.optional()}).strict();
export const goalProgressListSchema=z.object({goalId:z.string().uuid(),afterId:z.string().uuid().optional(),limit:z.number().int().min(1).max(100).default(50)}).strict();
const storedNumeric=z.string().regex(/^-?\d+(?:\.\d+)?$/);
const stamp=z.iso.datetime({offset:true});
export const goalRecordSchema=z.object({id:z.string().uuid(),user_id:z.string().uuid(),account_id:z.string().uuid(),...goalFields,
  target_value:storedNumeric,notes:z.string().nullable(),record_version:recordVersionSchema,archived_at:stamp.nullable(),achieved_at:stamp.nullable(),created_at:stamp,updated_at:stamp}).strict();
export const goalEventRecordSchema=z.object({id:z.string().uuid(),user_id:z.string().uuid(),goal_id:z.string().uuid(),progress_value:storedNumeric,recorded_at:stamp,notes:z.string().nullable(),created_at:stamp}).strict();
export const goalPageSchema=z.object({records:z.array(goalRecordSchema),nextCursor:z.string().uuid().nullable()}).strict();
export const goalEventPageSchema=z.object({records:z.array(goalEventRecordSchema),nextCursor:z.string().uuid().nullable()}).strict();
const timezone=z.string().trim().min(1).max(100).refine(value=>{try{new Intl.DateTimeFormat("en",{timeZone:value}).format();return true;}catch{return false;}},"A valid IANA timezone is required.");
const propFields={firm_name:z.string().trim().min(2).max(120),model_name:text,phase_name:text,
  profit_target_mode:z.enum(PROP_VALUE_MODES).nullable(),profit_target_value:positive.nullable(),
  daily_loss_mode:z.enum(PROP_VALUE_MODES).nullable(),daily_loss_value:positive.nullable(),daily_loss_baseline:z.enum(PROP_DAILY_BASELINES).nullable(),daily_loss_measure:z.enum(PROP_LOSS_MEASURES).nullable(),
  total_loss_mode:z.enum(PROP_VALUE_MODES).nullable(),total_loss_value:positive.nullable(),total_loss_baseline:z.enum(PROP_TOTAL_BASELINES).nullable(),total_loss_measure:z.enum(PROP_LOSS_MEASURES).nullable(),
  drawdown_type:z.enum(PROP_DRAWDOWN_TYPES),consistency_formula:z.enum(PROP_CONSISTENCY_FORMULAS).nullable(),
  consistency_limit_percent:decimal.refine(value=>parseDecimal(value).gte(0)&&parseDecimal(value).lte(100)).nullable(),
  minimum_trading_days:z.number().int().min(0).max(2147483647).nullable(),maximum_trading_days:z.number().int().min(0).max(2147483647).nullable(),
  trading_day_timezone:timezone,profitable_day_min_pnl:decimal.refine(value=>parseDecimal(value).gte(0)),notes:text};
export const propValuesSchema=z.object(propFields).strict().superRefine((value,context)=>{
  for(const fields of [["profit_target_mode","profit_target_value"],["daily_loss_mode","daily_loss_value","daily_loss_baseline","daily_loss_measure"],
    ["total_loss_mode","total_loss_value","total_loss_baseline","total_loss_measure"],["consistency_formula","consistency_limit_percent"]] as const) {
    const presence=fields.map(field=>value[field]!==null);
    if(presence.some(Boolean)&&!presence.every(Boolean))context.addIssue({code:"custom",path:[fields[0]],message:"Define or clear every field of this optional rule."});
  }
  for(const stem of ["profit_target","daily_loss","total_loss"] as const)if(value[`${stem}_mode`]==="PERCENT" && parseDecimal(value[`${stem}_value`]!).gt(100))context.addIssue({code:"custom",path:[`${stem}_value`],message:"A percentage rule cannot exceed 100."});
  if(value.minimum_trading_days!==null&&value.maximum_trading_days!==null&&value.minimum_trading_days>value.maximum_trading_days)context.addIssue({code:"custom",path:["maximum_trading_days"],message:"Maximum days cannot be below minimum days."});
});
export const propGetSchema=z.object({accountId:z.string().uuid()}).strict();
export const propSaveSchema=z.object({...operation,accountId:z.string().uuid(),expectedVersion:z.union([z.literal("0"),recordVersionSchema]),
  values:z.object(propFields).partial().strict().refine(value=>Object.keys(value).length>0,"Submit at least one field.")}).strict();
export const propRecordSchema=z.object({...propFields,model_name:z.string().nullable(),phase_name:z.string().nullable(),notes:z.string().nullable(),
  profit_target_value:storedNumeric.nullable(),daily_loss_value:storedNumeric.nullable(),total_loss_value:storedNumeric.nullable(),consistency_limit_percent:storedNumeric.nullable(),profitable_day_min_pnl:storedNumeric,
  id:z.string().uuid(),user_id:z.string().uuid(),account_id:z.string().uuid(),record_version:recordVersionSchema,trading_day_basis:z.literal("OPENED_AT"),created_at:stamp,updated_at:stamp}).strict();
export const propResultSchema=z.object({record:propRecordSchema.nullable()}).strict();
export const progressResultSchema=z.object({action:z.enum(["GOAL_CREATE","GOAL_PATCH","GOAL_ARCHIVE","GOAL_PROGRESS","PROP_SAVE"]),record:z.union([goalRecordSchema,goalEventRecordSchema,propRecordSchema]),goalVersion:recordVersionSchema.optional()}).strict();
export type ProgressAction=z.infer<typeof progressResultSchema>["action"];
const commands={GOAL_CREATE:goalCreateSchema,GOAL_PATCH:goalPatchSchema,GOAL_ARCHIVE:goalArchiveSchema,GOAL_PROGRESS:goalProgressSchema,PROP_SAVE:propSaveSchema};
export function progressCommand(action:ProgressAction,input:unknown) {return {...commands[action].parse(input),action};}
export function prepareProgress(request:ReturnType<typeof progressCommand>,source:unknown) {
  const snapshot=z.object({account:z.object({currency_precision:z.number().int().min(0).max(20)}).passthrough(),goal:goalRecordSchema.nullable(),config:propRecordSchema.nullable()}).parse(source);
  if(request.action==="GOAL_ARCHIVE")return {};
  if(request.action==="GOAL_PROGRESS")return {progressValue:(request as z.infer<typeof goalProgressSchema>).progressValue};
  if(request.action==="PROP_SAVE") {
    const input=request as z.infer<typeof propSaveSchema>;
    const defaults={model_name:null,phase_name:null,profit_target_mode:null,profit_target_value:null,daily_loss_mode:null,daily_loss_value:null,daily_loss_baseline:null,daily_loss_measure:null,total_loss_mode:null,total_loss_value:null,total_loss_baseline:null,total_loss_measure:null,consistency_formula:null,consistency_limit_percent:null,minimum_trading_days:null,maximum_trading_days:null,notes:null};
    const current=snapshot.config?Object.fromEntries(Object.keys(propFields).map(key=>[key,snapshot.config![key as keyof typeof snapshot.config]])):defaults;
    const preserved=snapshot.config?Object.fromEntries(["notes","model_name","phase_name"].filter(key=>!Object.hasOwn(input.values,key)).map(key=>[key,snapshot.config![key as keyof typeof snapshot.config]])):{};
    const merged=propValuesSchema.parse({...current,...input.values,...Object.fromEntries(Object.keys(preserved).map(key=>[key,null]))});
    for(const stem of ["profit_target","daily_loss","total_loss"] as const)if(merged[`${stem}_mode`]==="AMOUNT")merged[`${stem}_value`]=normalizeMoney(merged[`${stem}_value`]!,snapshot.account.currency_precision);
    merged.profitable_day_min_pnl=normalizeMoney(merged.profitable_day_min_pnl,snapshot.account.currency_precision);
    return {values:{...propValuesSchema.parse(merged),...preserved}};
  }
  const input=request as z.infer<typeof goalCreateSchema>|z.infer<typeof goalPatchSchema>;
  const current=snapshot.goal?Object.fromEntries(Object.keys(goalFields).map(key=>[key,snapshot.goal![key as keyof typeof snapshot.goal]])):{};
  const keepNotes=snapshot.goal!==null && !Object.hasOwn(input.values,"notes");
  const merged=goalValuesSchema.parse({...current,...input.values,...(keepNotes?{notes:null}:{})});
  if(["ACCOUNT_BALANCE","MAX_DRAWDOWN_AMOUNT"].includes(merged.goal_type))merged.target_value=normalizeMoney(merged.target_value,snapshot.account.currency_precision);
  return {values:{...goalValuesSchema.parse(merged),...(keepNotes?{notes:snapshot.goal!.notes}:{})}};
}
