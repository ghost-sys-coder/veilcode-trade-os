import { z } from "zod";
import { ACCOUNT_TYPES,TRADE_DIRECTIONS,TRADE_OUTCOMES,TRADE_STATUSES,TRADE_GRADES,TRADING_SESSIONS } from "@/types/domain";
import { journalGetSchema } from "@/domain/journal/commands";
import { dateKey,summarizePerformance,buildBalanceTimeline } from "@/domain/journal/analytics";
import { addDays,monthBounds } from "@/domain/journal/periods";
import { parseDecimal,normalizeMoney } from "@/domain/money/decimal";
import { buildTradeJournalDataset } from "@/domain/reporting/journal";
import { decimalString,timezoneSchema,type ReportingRows } from "@/domain/reporting/rows";

const uuid=z.string().uuid(),date=z.iso.date();
const common={account:uuid.optional(),from:date.optional(),to:date.optional(),instrument:uuid.optional(),strategy:uuid.optional(),setup:uuid.optional(),
  session:z.enum(TRADING_SESSIONS).optional(),direction:z.enum(TRADE_DIRECTIONS).optional()};
function dateOrder(value:{from?:string;to?:string},ctx:z.RefinementCtx) {if(value.from && value.to && value.from>value.to)ctx.addIssue({code:"custom",path:["to"],message:"End date must not precede start date."});}
export const journalFiltersSchema=z.object({...common,status:z.enum(TRADE_STATUSES).optional(),outcome:z.enum(TRADE_OUTCOMES).optional(),grade:z.enum(TRADE_GRADES).optional(),
  ruleCompliance:z.enum(["FULLY_COMPLIANT","VIOLATIONS_PRESENT","NOT_REVIEWED"]).optional(),tag:uuid.optional(),search:z.string().trim().max(500).optional(),
  sort:z.enum(["date_desc","date_asc","pnl_desc","pnl_asc"]).optional()}).strict().superRefine(dateOrder);
export const analyticsFiltersSchema=z.object({...common,accountType:z.enum(ACCOUNT_TYPES).optional(),reviewSearch:z.string().trim().max(500).optional()}).strict().superRefine(dateOrder);
export const journalReportSchema=z.object({filters:journalFiltersSchema.default({}),timezone:timezoneSchema.optional()}).strict();
export const analyticsReportSchema=z.object({filters:analyticsFiltersSchema.default({}),timezone:timezoneSchema.optional()}).strict();
export const calendarReportSchema=z.object({accountId:uuid.optional(),month:z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).refine(v=>Number(v.slice(0,4))>=1000),timezone:timezoneSchema.optional()}).strict();
export const journalSummarySchema=journalGetSchema.safeExtend({timezone:timezoneSchema.optional()});
const count=z.number().int().nonnegative(),nullableDecimal=decimalString.nullable();
export const summaryMetricsSchema=z.object({trades:count,wins:count,losses:count,breakEvens:count,winRate:nullableDecimal,netPnl:decimalString,totalR:decimalString,
  averageR:nullableDecimal,totalPlannedRisk:decimalString,rSample:count,breakEvenRate:nullableDecimal});
const outcomeCountsSchema=z.object({WIN:count,PARTIAL_WIN:count,LOSS:count,PARTIAL_LOSS:count,BREAK_EVEN:count});
export const journalSummaryResultSchema=z.object({kind:z.enum(["DAILY","WEEKLY","MONTHLY"]),accountId:uuid,timezone:timezoneSchema,start:date,end:date,
  currencyCode:z.string(),currencyPrecision:count,journalTrades:count,incompleteClosedTrades:count,summary:summaryMetricsSchema,
  outcomes:outcomeCountsSchema,openingBalance:nullableDecimal,endingBalance:nullableDecimal,ruleViolations:count,ruleReviewSample:count,
  executionReviewSample:count,psychologyReviewSample:count,averageExecutionRating:nullableDecimal,revengeTrades:count,fomoTrades:count,
  warnings:z.array(z.string())}).strict();
export const calendarResultSchema=z.object({timezone:timezoneSchema,month:z.string(),
  currencies:z.array(z.object({currencyCode:z.string(),currencyPrecision:count,days:z.array(z.object({date,summary:summaryMetricsSchema,outcomes:outcomeCountsSchema}).strict())}).strict()),
  journalDays:z.array(z.object({date,trades:count}).strict()),incompleteClosedTrades:count}).strict();
export const exportResultSchema=z.object({format:z.literal("CSV"),timezone:timezoneSchema,recordCount:count,csv:z.string()}).strict();

function outcomes(trades:readonly {outcome:typeof TRADE_OUTCOMES[number]|null}[]) {
  return Object.fromEntries(TRADE_OUTCOMES.map(value=>[value,trades.filter(trade=>trade.outcome===value).length])) as z.infer<typeof outcomeCountsSchema>;
}
export function reportSummary(trades:Parameters<typeof summarizePerformance>[0],precision:number) {
  const summary=summarizePerformance(trades,precision);
  const rSample=trades.filter(t=>t.closedAt && t.outcome && t.netPnl!==null && t.actualR!==null).length;
  return {...summary,rSample,breakEvenRate:summary.trades?parseDecimal(String(summary.breakEvens)).div(summary.trades).times(100).toFixed(2):null};
}
export function buildJournalSummary(rows:ReportingRows,request:z.infer<typeof journalSummarySchema>) {
  const account=rows.accounts.find(a=>a.id===request.accountId);
  if(!account)throw new RangeError("Account unavailable.");
  const start=request.period,end=request.kind==="DAILY"?start:request.kind==="WEEKLY"?addDays(start,6):monthBounds(start.slice(0,7)).end;
  const dataset=buildTradeJournalDataset(rows),trades=dataset.trades.filter(t=>t.accountId===account.id);
  const inRange=(value:string)=>{const key=dateKey(value,rows.timezone);return key>=start && key<=end;};
  const closed=trades.filter(t=>t.status==="CLOSED" && t.closedAt && inRange(t.closedAt) && t.netPnl!==null && t.outcome!==null);
  const incomplete=trades.filter(t=>t.status==="CLOSED" && (!t.closedAt || inRange(t.closedAt)) && (!t.closedAt || t.netPnl===null || t.outcome===null)).length;
  const timeline=buildBalanceTimeline({startingBalance:account.starting_balance,startedAt:account.started_at,currencyPrecision:account.currency_precision,
    trades:trades.filter(t=>t.status==="CLOSED" && t.closedAt && t.netPnl!==null).map(t=>({id:t.id,closedAt:t.closedAt!,netPnl:t.netPnl!,label:t.instrumentSymbol})),
    adjustments:rows.adjustments.filter(a=>a.account_id===account.id).map(a=>({id:a.id,occurredAt:a.occurred_at,amount:a.amount,label:a.type}))});
  const opening=timeline.filter(e=>dateKey(e.occurredAt,rows.timezone)<start).at(-1)?.balance??normalizeMoney(account.starting_balance,account.currency_precision);
  const ending=timeline.filter(e=>dateKey(e.occurredAt,rows.timezone)<=end).at(-1)?.balance??opening;
  const incompleteHistory=trades.some(t=>t.status==="CLOSED"&&(!t.closedAt||dateKey(t.closedAt,rows.timezone)<=end)&&(!t.closedAt||t.netPnl===null||t.outcome===null));
  const closedIds=new Set(closed.map(t=>t.id)),execution=rows.execution.filter(r=>closedIds.has(r.trade_id)&&r.reviewed_at),psychology=rows.psychology.filter(r=>closedIds.has(r.trade_id)&&r.reviewed_at);
  const ratings=execution.flatMap(r=>r.execution_rating===null?[]:[r.execution_rating]);
  return journalSummaryResultSchema.parse({kind:request.kind,accountId:account.id,timezone:rows.timezone,start,end,currencyCode:account.currency_code,currencyPrecision:account.currency_precision,
    journalTrades:trades.filter(t=>inRange(t.journalDate)).length,incompleteClosedTrades:incomplete,summary:reportSummary(closed,account.currency_precision),outcomes:outcomes(closed),
    openingBalance:incompleteHistory?null:opening,endingBalance:incompleteHistory?null:ending,ruleViolations:closed.reduce((n,t)=>n+t.ruleViolations,0),ruleReviewSample:closed.filter(t=>t.ruleCompliance!=="NOT_REVIEWED").length,
    executionReviewSample:execution.length,psychologyReviewSample:psychology.length,averageExecutionRating:ratings.length?ratings.reduce((sum,v)=>sum.plus(v),parseDecimal("0")).div(ratings.length).toFixed(2):null,
    revengeTrades:execution.filter(r=>r.revenge_trade===true).length,fomoTrades:psychology.filter(r=>r.fomo_influenced===true).length,
    warnings:incompleteHistory?["Incomplete closed records prevent authoritative period balances; realized totals include qualifying records only."]:[]});
}
export function buildCalendarReport(rows:ReportingRows,month:string) {
  const bounds=monthBounds(month),dataset=buildTradeJournalDataset(rows),journalDays=new Map<string,number>();
  for(const trade of dataset.trades){const key=dateKey(trade.journalDate,rows.timezone);if(key>=bounds.start && key<=bounds.end)journalDays.set(key,(journalDays.get(key)??0)+1);}
  const currencies=[...new Set(rows.accounts.map(a=>a.currency_code))].sort().map(currencyCode=>{
    const precision=Math.max(...rows.accounts.filter(a=>a.currency_code===currencyCode).map(a=>a.currency_precision)),days=new Map<string,typeof dataset.trades>();
    for(const t of dataset.trades){if(t.currencyCode!==currencyCode||t.status!=="CLOSED"||!t.closedAt||t.netPnl===null||!t.outcome)continue;const key=dateKey(t.closedAt,rows.timezone);if(key>=bounds.start&&key<=bounds.end)days.set(key,[...(days.get(key)??[]),t]);}
    return {currencyCode,currencyPrecision:precision,days:[...days.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([date,trades])=>({date,summary:reportSummary(trades,precision),outcomes:outcomes(trades)}))};
  });
  return calendarResultSchema.parse({timezone:rows.timezone,month,currencies,journalDays:[...journalDays.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([date,trades])=>({date,trades})),
    incompleteClosedTrades:dataset.trades.filter(t=>t.status==="CLOSED"&&(!t.closedAt||dateKey(t.closedAt,rows.timezone)>=bounds.start&&dateKey(t.closedAt,rows.timezone)<=bounds.end)&&(!t.closedAt||t.netPnl===null||!t.outcome)).length});
}
