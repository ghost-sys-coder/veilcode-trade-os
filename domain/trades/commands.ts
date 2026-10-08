import { z } from "zod";
import { utcInstantSchema } from "@/domain/validation/utc";
import { eventDecimal } from "@/domain/accounts/events";
import { recordVersionSchema } from "@/domain/configuration/commands";
import { normalizeMoney,parseDecimal } from "@/domain/money/decimal";
import { calculateNetPnl,calculateRiskMultiple,calculatePlannedRiskPercentage,calculateHoldingDurationSeconds,classifyClosedTradeOutcome } from "@/domain/trades/financials";
import { TRADE_STATUSES,TRADE_DIRECTIONS,ORDER_TYPES,TRADING_SESSIONS,TIMEFRAMES,MARKET_BIASES,MARKET_CONDITIONS,
  STOP_ACTIONS,TRADE_EMOTIONS,TRADE_GRADES,RETAKE_DECISIONS } from "@/types/domain";

const uuid=z.string().uuid();
const text=z.string().trim().max(4000).nullable();
const decimal=eventDecimal.nullable();
const requiredNonnegative=eventDecimal.refine(v=>parseDecimal(v).gte(0));
const nonnegative=requiredNonnegative.nullable();
const time=utcInstantSchema.nullable();
const bool=z.boolean().nullable();
const rating=z.number().int().min(1).max(5).nullable();
export const tradeValuesSchema=z.object({
  account_id:uuid,instrument_id:uuid,direction:z.enum(TRADE_DIRECTIONS),status:z.enum(TRADE_STATUSES),
  order_type:z.enum(ORDER_TYPES),session:z.enum(TRADING_SESSIONS),strategy_id:uuid.nullable(),setup_id:uuid.nullable(),
  primary_analysis_timeframe:z.enum(TIMEFRAMES).nullable(),entry_timeframe:z.enum(TIMEFRAMES).nullable(),
  higher_timeframe_bias:z.enum(MARKET_BIASES).nullable(),market_condition:z.enum(MARKET_CONDITIONS).nullable(),
  thesis:text,entry_reason:text,confirmation_notes:text,planned_at:time,opened_at:time,closed_at:time,
  timezone_at_entry:z.string().max(100).refine(v=>{try{new Intl.DateTimeFormat("en",{timeZone:v});return true;}catch{return false;}}),
  account_balance_before:nonnegative,planned_entry:decimal,planned_stop_loss:decimal,planned_take_profit:decimal,
  planned_lot_size:nonnegative,planned_risk_amount:nonnegative,planned_risk_percentage:nonnegative,planned_reward_amount:nonnegative,planned_risk_reward:nonnegative,
  actual_entry:decimal,actual_stop_loss:decimal,actual_exit:decimal,actual_lot_size:nonnegative,
  commission:requiredNonnegative,swap:requiredNonnegative,other_fees:requiredNonnegative,trading_credits:requiredNonnegative,gross_pnl:decimal,
  pips_result:decimal,mfe_amount:nonnegative,mfe_pips:decimal,mfe_r:decimal,mae_amount:nonnegative,mae_pips:decimal,mae_r:decimal,
}).partial().strict();
export const protectedPlanFields=["planned_entry","planned_stop_loss","planned_take_profit","planned_lot_size","planned_risk_amount","planned_risk_percentage",
  "planned_reward_amount","planned_risk_reward","strategy_id","setup_id","thesis","entry_reason","confirmation_notes","account_balance_before","planned_at"] as const;
export const brokerExecutionFields=["account_id","instrument_id","direction","status","opened_at","closed_at","actual_entry","actual_stop_loss","actual_exit","actual_lot_size",
  "commission","swap","other_fees","trading_credits","gross_pnl","pips_result","mfe_amount","mfe_pips","mfe_r","mae_amount","mae_pips","mae_r"] as const;
export const plannedTargetSchema=z.object({label:z.string().trim().min(1).max(40),planned_price:eventDecimal,
  planned_close_percentage:eventDecimal.refine(v=>parseDecimal(v).gte(0)&&parseDecimal(v).lte(100)).nullable().optional(),
  actual_fill_price:decimal.optional(),actual_close_percentage:eventDecimal.refine(v=>parseDecimal(v).gte(0)&&parseDecimal(v).lte(100)).nullable().optional(),pnl_contribution:decimal.optional(),hit_at:time.optional()}).strict();
export const executedTargetSchema=z.object({id:uuid,actual_fill_price:decimal.optional(),actual_close_percentage:eventDecimal.refine(v=>parseDecimal(v).gte(0)&&parseDecimal(v).lte(100)).nullable().optional(),
  pnl_contribution:decimal.optional(),hit_at:time.optional()}).strict();
const execution=z.object({entry_according_to_plan:bool,stop_according_to_plan:bool,target_according_to_plan:bool,stop_action:z.enum(STOP_ACTIONS).nullable(),
  closed_early:bool,entered_early:bool,entered_late:bool,chased_price:bool,added_to_position:bool,revenge_trade:bool,over_risked:bool,execution_rating:rating,notes:text}).partial().strict();
const psychology=z.object({confidence_before_entry:rating,emotion_before:z.enum(TRADE_EMOTIONS).nullable(),emotion_during:z.enum(TRADE_EMOTIONS).nullable(),
  emotion_after:z.enum(TRADE_EMOTIONS).nullable(),fear_influenced:bool,greed_influenced:bool,fomo_influenced:bool,notes:text}).partial().strict();
const post=z.object({what_went_well:text,what_went_wrong:text,would_take_again:z.enum(RETAKE_DECISIONS).nullable(),improvement:text,lesson_learned:text,trade_quality_grade:z.enum(TRADE_GRADES).nullable()}).partial().strict();
export const reviewsSchema=z.object({execution:z.object({values:execution,complete:z.boolean().default(false)}).strict().optional(),
  psychology:z.object({values:psychology,complete:z.boolean().default(false)}).strict().optional(),
  post:z.object({values:post,complete:z.boolean().default(false)}).strict().optional(),
  rules:z.object({results:z.array(z.object({trading_rule_id:uuid,complied:z.boolean().nullable(),notes:text.optional()}).strict()).max(500),complete:z.boolean().default(false)}).strict().optional()}).strict();
const extras={plannedTargets:z.array(plannedTargetSchema).max(100).optional(),executedTargets:z.array(executedTargetSchema).max(100).optional(),reviews:reviewsSchema.optional()};
const identity={operationId:uuid,id:uuid,expectedVersion:recordVersionSchema};
export const tradeCreateSchema=z.object({operationId:uuid,values:tradeValuesSchema,...extras}).strict().refine(v=>v.values.account_id&&v.values.instrument_id&&v.values.direction,"Account, instrument and direction are required.");
export const tradePatchSchema=z.object({...identity,values:tradeValuesSchema,...extras}).strict();
export const tradeTargetsSchema=z.object({...identity,plannedTargets:extras.plannedTargets,executedTargets:extras.executedTargets}).strict().refine(v=>v.plannedTargets!==undefined||v.executedTargets!==undefined);
export const tradeReviewCommandSchema=z.object({...identity,reviews:reviewsSchema}).strict();
export const tradeCorrectionSchema=z.object({...identity,fieldName:z.enum([...protectedPlanFields.filter(v=>v!=="account_balance_before"&&v!=="planned_at"),"target.label","target.planned_price","target.planned_close_percentage"]),
  newValue:z.string().max(4000).nullable(),reason:z.string().trim().min(5).max(1000),tradeTargetId:uuid.optional()}).strict();
export const tradeManagementSchema=z.object({...identity,event:z.object({event_type:z.enum(["STOP_MOVED","TARGET_CHANGED","SCALE_IN","SCALE_OUT","NOTE"]),
  occurred_at:utcInstantSchema,price:decimal.optional(),volume:nonnegative.optional(),notes:z.string().trim().min(5).max(2000)}).strict()}).strict();
export const tradeGetSchema=z.object({id:uuid}).strict();
export const tradeListSchema=z.object({accountId:uuid.optional(),status:z.enum(TRADE_STATUSES).optional(),afterId:uuid.optional(),limit:z.number().int().min(1).max(100).default(50)}).strict();
export const tradeResultSchema=z.object({action:z.enum(["CREATE","PATCH","TARGETS","CORRECT","MANAGEMENT","REVIEW"]),record:z.record(z.string(),z.unknown())}).strict();
export const tradePageSchema=z.object({records:z.array(z.record(z.string(),z.unknown())),nextCursor:uuid.nullable()}).strict();
export type TradeAction=z.infer<typeof tradeResultSchema>["action"];
export function tradeCommand(action:TradeAction,input:unknown) {
  switch(action) {
    case "CREATE":return {...tradeCreateSchema.parse(input),action};
    case "PATCH":return {...tradePatchSchema.parse(input),action};
    case "TARGETS":return {...tradeTargetsSchema.parse(input),action};
    case "CORRECT":return {...tradeCorrectionSchema.parse(input),action};
    case "MANAGEMENT":return {...tradeManagementSchema.parse(input),action};
    case "REVIEW":return {...tradeReviewCommandSchema.parse(input),action};
  }
}
type RecordValues=Record<string,string|number|boolean|null|undefined>;
function changed(a:unknown,b:unknown) {
  if(a===b)return false;
  if(typeof a==="string"&&typeof b==="string"&&/^-?\d+(\.\d+)?$/.test(a)&&/^-?\d+(\.\d+)?$/.test(b))return !parseDecimal(a).eq(b);
  return true;
}
export function prepareTrade(request:ReturnType<typeof tradeCommand>,snapshot:unknown) {
  const source=z.object({account:z.object({currency_precision:z.number(),starting_balance:z.string(),closed_trade_net_pnl:z.string(),account_adjustments_total:z.string()}),
    trade:z.record(z.string(),z.unknown()).nullable(),targets:z.array(z.record(z.string(),z.unknown())),usedPartialExits:z.boolean().default(false)}).parse(snapshot);
  const current=source.trade as RecordValues|null;
  const precision=source.account.currency_precision;
  let patch:RecordValues="values" in request?{...request.values}:{};
  const locked=current?.status==="OPEN"||current?.status==="CLOSED";
  const broker=Boolean(current?.mt5_connection_id)||["MT4","MT5","BROKER_API"].includes(String(current?.source_type));
  if(locked&&protectedPlanFields.some(key=>key in patch&&changed(current?.[key],patch[key])))throw new RangeError("Recorded plans require explicit correction.");
  if(locked&&["account_id","instrument_id","direction"].some(key=>key in patch&&changed(current?.[key],patch[key])))throw new RangeError("An opened canonical position cannot be reassigned.");
  if(locked&&"actual_stop_loss" in patch&&changed(current?.actual_stop_loss,patch.actual_stop_loss))throw new RangeError("Record actual stop movements through management history.");
  if(broker&&(brokerExecutionFields.some(key=>key in patch&&changed(current?.[key],patch[key]))||"executedTargets" in request||request.action==="MANAGEMENT"))throw new RangeError("Broker execution evidence is read-only.");
  const values:RecordValues={status:"DRAFT",order_type:"MARKET",session:"OTHER",commission:"0",swap:"0",other_fees:"0",trading_credits:"0",...current,...patch};
  if(request.action==="CORRECT") {
    const field=request.fieldName;
    if(!field.startsWith("target."))values[field]=request.newValue;
    patch={};
  }
  // Fee/gross components retain stored calculation precision. Rounding each
  // component first would change the complete-trade result; normalize net once.
  for(const key of ["account_balance_before","planned_risk_amount","planned_reward_amount","mfe_amount","mae_amount"])
    if(values[key]!=null)values[key]=normalizeMoney(String(values[key]),precision);
  if(!current&&values.account_balance_before==null)values.account_balance_before=normalizeMoney(parseDecimal(source.account.starting_balance).plus(source.account.closed_trade_net_pnl).plus(source.account.account_adjustments_total),precision);
  if(!locked) {
    values.planned_risk_percentage=values.planned_risk_amount!=null&&values.account_balance_before!=null?calculatePlannedRiskPercentage(String(values.planned_risk_amount),String(values.account_balance_before)):null;
    values.planned_risk_reward=values.planned_risk_amount!=null&&values.planned_reward_amount!=null?calculateRiskMultiple(String(values.planned_reward_amount),String(values.planned_risk_amount)):null;
  }
  const targets=("plannedTargets" in request&&request.plannedTargets?request.plannedTargets:source.targets).map(t=>({...t}) as Record<string,unknown>);
  if("executedTargets" in request&&request.executedTargets)for(const target of request.executedTargets){const item=targets.find(t=>t.id===target.id);if(!item)throw new RangeError("Unknown target.");Object.assign(item,target);}
  if(request.action==="CORRECT"&&request.fieldName.startsWith("target.")){const target=targets.find(t=>t.id===request.tradeTargetId);if(!target)throw new RangeError("Unknown target.");target[request.fieldName.slice(7)]=request.newValue;}
  const usedPartials=targets.some(t=>typeof t.actual_close_percentage==="string"&&parseDecimal(t.actual_close_percentage).gt(0)&&parseDecimal(t.actual_close_percentage).lt(100))||source.usedPartialExits||current?.mt5_used_partial_exits===true||request.action==="MANAGEMENT"&&request.event.event_type==="SCALE_OUT";
  if(values.status==="CLOSED") {
    if(!values.opened_at||!values.closed_at||values.gross_pnl==null)throw new RangeError("Closure requires complete timestamps and gross PnL.");
    if(new Date(String(values.closed_at))<new Date(String(values.opened_at)))throw new RangeError("Close precedes open.");
    values.net_pnl=calculateNetPnl({grossPnl:String(values.gross_pnl),commission:String(values.commission),swap:String(values.swap),otherFees:String(values.other_fees),tradingCredits:String(values.trading_credits),currencyPrecision:precision});
    values.outcome=classifyClosedTradeOutcome(values.net_pnl,precision,usedPartials);
    values.actual_r=values.planned_risk_amount!=null?calculateRiskMultiple(values.net_pnl,String(values.planned_risk_amount)):null;
  } else {values.net_pnl=null;values.outcome=null;values.actual_r=null;}
  if((values.status==="OPEN"||values.status==="CLOSED")&&!values.opened_at)throw new RangeError("Opened timestamp required.");
  if(values.status!=="CLOSED"&&values.closed_at!=null)throw new RangeError("Nonclosed trade cannot have closed timestamp.");
  values.holding_duration_seconds=calculateHoldingDurationSeconds(values.opened_at as string|null,values.closed_at as string|null)?.toString()??null;
  const derivedKeys=["net_pnl","outcome","actual_r","holding_duration_seconds"];
  if(!locked||request.action==="CORRECT")derivedKeys.push("planned_risk_percentage","planned_risk_reward");
  const keys=request.action==="CREATE"?[...Object.keys(tradeValuesSchema.shape),...derivedKeys]:[...Object.keys(patch),...derivedKeys];
  const proposedValues=Object.fromEntries([...new Set(keys)].filter(k=>values[k]!==undefined).map(k=>[k,values[k]]));
  if(broker)for(const key of [...brokerExecutionFields,"net_pnl","outcome","actual_r","holding_duration_seconds"])delete proposedValues[key];
  let correctedValue:string|null|undefined;
  if(request.action==="CORRECT") {
    correctedValue=request.newValue;
    if(["planned_risk_amount","planned_reward_amount"].includes(request.fieldName)&&correctedValue!==null)correctedValue=normalizeMoney(correctedValue,precision);
    if(request.fieldName==="planned_risk_amount") {
      proposedValues.planned_risk_percentage=values.account_balance_before!=null&&values.planned_risk_amount!=null?calculatePlannedRiskPercentage(String(values.planned_risk_amount),String(values.account_balance_before)):null;
      proposedValues.planned_risk_reward=values.planned_reward_amount!=null&&values.planned_risk_amount!=null?calculateRiskMultiple(String(values.planned_reward_amount),String(values.planned_risk_amount)):null;
    }
    if(request.fieldName==="planned_reward_amount")proposedValues.planned_risk_reward=values.planned_reward_amount!=null&&values.planned_risk_amount!=null?calculateRiskMultiple(String(values.planned_reward_amount),String(values.planned_risk_amount)):null;
  }
  for(const field of ["planned_close_percentage","actual_close_percentage"])if(targets.reduce((sum,t)=>sum.plus(typeof t[field]==="string"?t[field] as string:"0"),parseDecimal("0")).gt(100))throw new RangeError("Target percentages exceed 100.");
  const normalizedTarget=(target:Record<string,unknown>)=>({...target,...(typeof target.pnl_contribution==="string"?{pnl_contribution:normalizeMoney(target.pnl_contribution,precision)}:{})});
  const plannedTargets="plannedTargets" in request&&request.plannedTargets?request.plannedTargets.map(normalizedTarget):undefined;
  const executedTargets="executedTargets" in request&&request.executedTargets?request.executedTargets.map(t=>{
    const existing=targets.find(row=>row.id===t.id)!;
    return normalizedTarget({id:t.id,actual_fill_price:existing.actual_fill_price??null,actual_close_percentage:existing.actual_close_percentage??null,pnl_contribution:existing.pnl_contribution??null,hit_at:existing.hit_at??null});
  }):undefined;
  return {values:proposedValues,...(plannedTargets?{plannedTargets}:{}),...(executedTargets?{executedTargets}:{}),...(request.action==="CORRECT"?{correctedValue}:{})};
}
