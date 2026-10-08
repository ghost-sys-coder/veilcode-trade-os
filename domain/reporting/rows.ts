import { z } from "zod";
import type { Database } from "@/types/database";
import { ACCOUNT_TYPES, TRADE_STATUSES, TRADE_OUTCOMES, TRADE_DIRECTIONS, TRADING_SESSIONS, TRADE_GRADES, STOP_ACTIONS, TRADE_EMOTIONS } from "@/types/domain";
import {normalizeMoney,parseDecimal} from "@/domain/money/decimal";

type Row<T extends keyof Database["public"]["Tables"]> = Database["public"]["Tables"][T]["Row"];
export interface ReportingRows {
  timezone:string; accounts:Row<"trading_accounts">[]; instruments:Row<"instruments">[];
  strategies:Row<"strategies">[]; setups:Row<"setups">[]; trades:Row<"trades">[];
  adjustments:Row<"account_adjustments">[]; reviews:Row<"trade_reviews">[];
  execution:Row<"trade_execution_reviews">[]; psychology:Row<"trade_psychology">[];
  ruleReviews:Row<"trade_rule_reviews">[]; ruleItems:Row<"trade_rule_review_items">[];
  tags:Row<"tags">[]; tradeTags:Row<"trade_tags">[];
}
export const decimalString=z.string().regex(/^-?\d+(?:\.\d+)?$/);
export const timezoneSchema=z.string().max(100).refine(value=>{try{new Intl.DateTimeFormat("en",{timeZone:value});return true;}catch{return false;}},"Invalid IANA timezone.");
const uuid=z.string().uuid(),stamp=z.iso.datetime({offset:true}),text=z.string().nullable(),bool=z.boolean().nullable();
// Duration is a count, not money or a broker identifier. Reject unsafe bigint
// counts instead of silently losing precision when charting averages.
const duration=z.union([z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),z.string().regex(/^\d+$/).refine(v=>BigInt(v)<=BigInt(Number.MAX_SAFE_INTEGER)).transform(Number)]).nullable();
const tradeNumbers=["account_balance_before","planned_entry","planned_stop_loss","planned_take_profit","planned_lot_size","planned_risk_amount","planned_risk_percentage","planned_reward_amount","planned_risk_reward","actual_entry","actual_stop_loss","actual_exit","actual_lot_size","gross_pnl","net_pnl","actual_r","pips_result","mfe_amount","mfe_pips","mfe_r","mae_amount","mae_pips","mae_r"];
const numericFields=Object.fromEntries(tradeNumbers.map(key=>[key,decimalString.nullable()]));
const trade=z.object({...numericFields,id:uuid,user_id:uuid,account_id:uuid,instrument_id:uuid,strategy_id:uuid.nullable(),setup_id:uuid.nullable(),
  status:z.enum(TRADE_STATUSES),outcome:z.enum(TRADE_OUTCOMES).nullable(),direction:z.enum(TRADE_DIRECTIONS),session:z.enum(TRADING_SESSIONS),
  created_at:stamp,updated_at:stamp,planned_at:stamp.nullable(),opened_at:stamp.nullable(),closed_at:stamp.nullable(),
  commission:decimalString,swap:decimalString,other_fees:decimalString,trading_credits:decimalString,
  holding_duration_seconds:duration,thesis:text,entry_reason:text,confirmation_notes:text}).passthrough();
const owned={id:uuid,user_id:uuid},review={...owned,trade_id:uuid,reviewed_at:stamp.nullable()};
const execution=z.object({...review,entry_according_to_plan:bool,stop_according_to_plan:bool,target_according_to_plan:bool,
  closed_early:bool,entered_early:bool,entered_late:bool,chased_price:bool,added_to_position:bool,revenge_trade:bool,over_risked:bool,
  stop_action:z.enum(STOP_ACTIONS).nullable(),execution_rating:z.number().int().min(1).max(5).nullable(),notes:text}).passthrough();
const psychology=z.object({...review,confidence_before_entry:z.number().int().min(1).max(5).nullable(),emotion_before:z.enum(TRADE_EMOTIONS).nullable(),
  emotion_during:z.enum(TRADE_EMOTIONS).nullable(),emotion_after:z.enum(TRADE_EMOTIONS).nullable(),fear_influenced:bool,greed_influenced:bool,fomo_influenced:bool,notes:text}).passthrough();
const rowsSchema=z.object({timezone:timezoneSchema,
  accounts:z.array(z.object({...owned,name:z.string(),account_type:z.enum(ACCOUNT_TYPES),currency_code:z.string().regex(/^[A-Z]{3}$/),currency_precision:z.number().int().min(0).max(20),starting_balance:decimalString,started_at:z.iso.date()}).passthrough()),
  instruments:z.array(z.object({id:uuid,user_id:uuid.nullable(),symbol:z.string(),display_name:z.string()}).passthrough()),
  strategies:z.array(z.object({...owned,name:z.string()}).passthrough()),setups:z.array(z.object({...owned,name:z.string(),strategy_id:uuid}).passthrough()),
  trades:z.array(trade),adjustments:z.array(z.object({...owned,account_id:uuid,type:z.enum(["DEPOSIT","WITHDRAWAL","BALANCE_CORRECTION","OTHER"]),amount:decimalString,occurred_at:stamp,is_performance_neutral:z.boolean().nullable()}).passthrough()),
  reviews:z.array(z.object({...review,trade_quality_grade:z.enum(TRADE_GRADES).nullable(),what_went_well:text,what_went_wrong:text,improvement:text,lesson_learned:text}).passthrough()),execution:z.array(execution),psychology:z.array(psychology),
  ruleReviews:z.array(z.object({...review,applicable_rule_count:z.number().int().nonnegative()}).passthrough()),
  ruleItems:z.array(z.object({...owned,review_id:uuid,rule_id_snapshot:uuid,rule_name:z.string(),rule_description:z.string(),complied:z.boolean(),notes:text}).passthrough()),
  tags:z.array(z.object({...owned,name:z.string(),color:text}).passthrough()),tradeTags:z.array(z.object({trade_id:uuid,tag_id:uuid}).passthrough()),
}).strict();
/** SQL returns complete generated rows. Validate every consumed value and all
 * monetary/price/volume/R fields before retaining legacy, untruncated evidence. */
export function parseReportingRows(input:unknown):ReportingRows {
  const rows=rowsSchema.parse(input) as unknown as ReportingRows;
  const accounts=new Map(rows.accounts.map(a=>[a.id,a]));
  for(const t of rows.trades){const account=accounts.get(t.account_id);if(!account || t.status!=="CLOSED" || t.net_pnl===null || !t.outcome)continue;
    const net=parseDecimal(normalizeMoney(t.net_pnl,account.currency_precision));
    if(t.outcome==="BREAK_EVEN"?!net.isZero():t.outcome==="WIN"||t.outcome==="PARTIAL_WIN"?!net.gt(0):!net.lt(0))throw new ReportingConsistencyError(t.id);
  }
  return rows;
}
export class ReportingConsistencyError extends Error {
  constructor(tradeId:string){super(`Recorded outcome and normalized net PnL conflict on trade ${tradeId}. Correct the financial record before using this report.`);this.name="ReportingConsistencyError";}
}
