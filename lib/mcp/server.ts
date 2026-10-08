import "server-only";
import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import {analyticsReportSchema,journalReportSchema,calendarReportSchema,journalSummarySchema,journalSummaryResultSchema,calendarResultSchema,exportResultSchema} from "@/domain/reporting/commands";
import {performanceResultSchema,behaviorResultSchema} from "@/domain/reporting/results";
import {ReportingConsistencyError} from "@/domain/reporting/rows";
import {balanceCurveSchema,balanceCurveResultSchema,BalanceCurveCursorError} from "@/domain/reporting/balance-curve";
import { referenceArchiveSchema,referenceCreateSchema,referencePatchSchema,referenceGetSchema,referenceListSchema,
  referencePageSchema,referenceRecordSchema,referenceResultSchema,tradeTagsListSchema,tradeTagCommandSchema,tradeTagResultSchema,type ReferenceAction } from "@/domain/references/commands";
import { calculatePositionSize } from "@/domain/trading/position-sizing";
import { getInstrumentSpecification, SUPPORTED_ACCOUNT_CURRENCIES } from "@/domain/trading/instrument-specifications";
import { parseDecimal } from "@/domain/money/decimal";
import {progressDatasetResultSchema} from "@/domain/progress/dataset";
import { journalGetSchema,journalListSchema,journalSaveSchema,journalResultSchema,journalPageSchema } from "@/domain/journal/commands";
import {goalGetSchema,goalListSchema,goalCreateSchema,goalPatchSchema,goalArchiveSchema,goalProgressSchema,goalProgressListSchema,goalRecordSchema,goalPageSchema,goalEventPageSchema,propGetSchema,propSaveSchema,propResultSchema,progressResultSchema,type ProgressAction} from "@/domain/progress/commands";
import { TRADE_OUTCOMES, TRADE_STATUSES, TRADE_GRADES, RULE_TYPES } from "@/types/domain";
import { configurationArchiveSchema, configurationCreateSchema, configurationGetSchema, configurationListSchema,
  configurationPageSchema, configurationPatchSchema, configurationRecordSchema, configurationResultSchema } from "@/domain/configuration/commands";
import { ApplicationWorkflowError } from "@/services/application/configuration";
import { accountCreateSchema, accountGetSchema, accountListSchema, accountPageSchema, accountPatchSchema,
  accountResultSchema, accountWithBalanceSchema } from "@/domain/accounts/commands";
import { accountEventListSchema,adjustmentCreateSchema,adjustmentClassifySchema,snapshotRecordSchema,accountTransitionSchema,
  fundedLinkSchema,eventPageSchema,eventResultSchema } from "@/domain/accounts/events";
import { tradeCreateSchema,tradePatchSchema,tradeGetSchema,tradeListSchema,tradeTargetsSchema,tradeCorrectionSchema,tradeManagementSchema,
  tradeReviewCommandSchema,tradeResultSchema,tradePageSchema,type TradeAction } from "@/domain/trades/commands";

const positiveDecimal = z.string().max(80).regex(/^(?:0|[1-9]\d*)(?:\.\d+)?$/)
  .refine(value => parseDecimal(value).gt(0), "A positive decimal string is required.");
const nullableDecimal = z.string().nullable();
const positionSizeInput = z.object({
  balance: positiveDecimal, currency: z.enum(SUPPORTED_ACCOUNT_CURRENCIES), currencyPrecision: z.number().int().min(0).max(20),
  riskMethod: z.enum(["PERCENTAGE", "FIXED_AMOUNT"]), riskValue: positiveDecimal,
  instrumentSymbol: z.string().min(1).max(20), direction: z.enum(["BUY", "SELL"]),
  entryPrice: positiveDecimal, stopLossPrice: positiveDecimal, takeProfitPrice: positiveDecimal.optional(),
  leverage: positiveDecimal.optional(), manualQuoteToAccountRate: positiveDecimal.optional(),
}).strict();
const positionSizeOutput = z.object({
  riskAmount:z.string(), riskPercentage:z.string(), quoteToAccountRate:z.string(), conversionSource:z.enum(["IDENTITY","ENTRY_RECIPROCAL","MANUAL"]),
  stopDistance:z.string(), stopDistancePips:z.string(), lossPerLot:z.string(), rawVolume:z.string(),
  recommendedVolume:nullableDecimal, volumeStatus:z.enum(["VALID","BELOW_MINIMUM","ABOVE_MAXIMUM"]),
  actualRiskAmount:nullableDecimal, actualRiskPercentage:nullableDecimal, rewardAmount:nullableDecimal,
  riskReward:nullableDecimal, estimatedMargin:nullableDecimal, warnings:z.array(z.string()),
});
const toolNames = ["tradeos_capabilities", "tradeos_position_size", "tradeos_operation_status", "tradeos_configuration_list",
  "tradeos_configuration_get", "tradeos_configuration_create", "tradeos_configuration_patch", "tradeos_configuration_archive",
  "tradeos_accounts_list","tradeos_accounts_get","tradeos_accounts_create","tradeos_accounts_patch",
  "tradeos_account_events_list","tradeos_adjustment_create","tradeos_adjustment_classify","tradeos_snapshot_record",
  "tradeos_account_transition","tradeos_account_link_funded","tradeos_trades_list","tradeos_trades_get","tradeos_trades_create",
  "tradeos_trades_patch","tradeos_trade_targets","tradeos_trade_correct_plan","tradeos_trade_management","tradeos_trade_review","tradeos_trade_instruments","tradeos_journals_get","tradeos_journals_list","tradeos_journals_save","tradeos_goals_get","tradeos_goals_list","tradeos_goals_create","tradeos_goals_patch","tradeos_goals_archive","tradeos_goal_progress_list","tradeos_goal_progress_record","tradeos_prop_get","tradeos_prop_save","tradeos_progress_get"] as const;
const referenceToolNames=["tradeos_references_list","tradeos_references_get","tradeos_references_create","tradeos_references_patch","tradeos_references_archive",
  "tradeos_trade_tags_list","tradeos_trade_tags_assign","tradeos_trade_tags_remove"] as const;
const readOnly = { readOnlyHint:true, destructiveHint:false, idempotentHint:true, openWorldHint:false };
const reportingToolNames=["tradeos_journal_summary","tradeos_analytics_performance","tradeos_analytics_behavior","tradeos_calendar","tradeos_journal_export","tradeos_analytics_balance_curve"] as const;
const catalog = {
  version:"1", tools:[...toolNames,...referenceToolNames,...reportingToolNames], resources:["catalog","domain","money","workflows","reporting"],
  pendingFamilies:["configuration/reference permanent deletion","screenshots upload/download","mt5","profile"],
  status:"HTTP shared workflows include journals and computed summaries, performance/behavior analytics, snapshot-aware paginated balance curves, realized calendar and full filtered CSV exports. Screenshots, integration reads, profile, permanent deletion and local stdio remain pending.",
};
const resources = {
  catalog,
  domain:{ canonicalTrade:"One logical position from planning through complete closure, independent of source.",
    relationships:["Account owns trades, snapshots and adjustments","Trade references an instrument, strategy and setup","Setup belongs to a strategy","Rules are snapshotted at completed review"],
    tradeStatuses:TRADE_STATUSES, tradeOutcomes:TRADE_OUTCOMES, tradeGrades:TRADE_GRADES, ruleTypes:RULE_TYPES,
    references:{entities:["TAG","INSTRUMENT"],ownership:"Tags are user-owned and names are unique case-insensitively per owner. Global instruments are readable but cannot be patched or archived. Owned instruments retain exact symbol identity.",
      specifications:"pip_size is a positive decimal string with at most 14 integer and 10 fractional digits, independent of account-currency precision. Referenced symbol/class/currencies/pip/price precision are immutable; display name may change. No broker symbol mapping is created implicitly.",
      archive:"Keeps historical tags, trades and MT5 mapping evidence. Archived tags cannot be newly assigned; existing associations can be explicitly removed with an audit. Archived names remain reserved.",
      versions:"Patch/archive use record_version as expectedVersion. Tag assignment/removal require trade.record_version as expectedVersion and tag.record_version as expectedTagVersion. A successful association change returns tradeVersion; reload before another edit."},
    configuration:{entities:["STRATEGY","SETUP","RULE"],identifiers:"UUID; SETUP.strategy_id must reference an owned, non-archived strategy. RULE.account_id is an owned account or null for all accounts.",
      versions:"record_version is a decimal integer string; provide it as expectedVersion on patch/archive.",
      patch:"Omitted fields are unchanged; explicit null clears description (strategy/setup), account_id and numeric_limit where allowed.",
      archive:"Keeps IDs, dependent records and immutable historical rule snapshots. Deactivates the record and requires a reason; ordinary patches cannot reactivate it."} },
  money:{ databaseType:"numeric", wireType:"decimal string", precision:"Explicit currency_code and currency_precision per account; separate price/volume/percentage/R/FX precision.",
    normalization:"Use central decimal utilities; round half up only at final monetary boundaries.",
    outcome:"Classify the normalized final net PnL only after complete closure. Positive wins, negative loses, exact zero BREAK_EVEN. Partial exits select partial labels only at final closure.",
    balance:"Starting balance + closed-trade net PnL + account adjustments. Equity snapshots are optional and do not replace this historical curve." },
  workflows:{ plannedValues:"Locked after OPEN. Recorded-value corrections require an append-only event and meaningful reason. Actual stop movement belongs to management history.",
    reviews:"Placeholder rows and unanswered/null fields are not reviewed evidence. Completion must be explicit; historical rule applicability is immutable.",
    mutations:"Durable operation IDs, atomic request hashes/results/audits and optimistic concurrency are required.",
    deletion:"Referenced configuration archives. Permanent deletion requires exact-target/version one-use browser approval. Financial/audit/correction history cannot be deleted." },
  reporting:{ journalDate:"opened_at -> planned_at -> created_at", realizedDate:"closed_at", winRate:"(WIN + PARTIAL_WIN) / all winning and losing trades; BREAK_EVEN reported separately.",
    filters:"Journal/CSV from/to use journal date. Analytics/behavior/calendar realized results use closed_at. Trading dimensions never filter account ledger history. CSV ignores pagination and includes all filtered records; spreadsheet formula prefixes in free text are escaped.",
    rExpectancy:"Average valid actual_r; expose qualifying sample count. Missing R is not zero R.",
    currencyAggregation:"Keep monetary results separated by account currency. Aggregate unitless results using underlying trades.",
    behavior:"Reviewed cohorts only; mistake differences are descriptive associations, not causal losses.",
    balanceCurve:"tradeos_analytics_balance_curve requires one currencyCode; accepts only account/accountType/from/to ledger filters, optional timezone and pageSize 1..100. Use nextCursor unchanged with the same scope. Every page recomputes full history and freshly checks the grant; CURVE_CHANGED requires restarting. Cumulative PnL/R and cumulativeRSample are lifetime-to-point, not page/period totals. START may be a period-opening basis. Unknown OTHER withholds drawdown; incomplete closed history withholds balances/PnL. Equity is never substituted." },
};

function result(value: Record<string, unknown>) {
  return { content:[{ type:"text" as const, text:JSON.stringify(value) }], structuredContent:value };
}
function failure(code:string) { return { isError:true, content:[{ type:"text" as const,text:code }] }; }

/** A fresh transport instance; data access exists only through verified services. */
export type McpApplicationServices = {
  balanceCurve:(input:unknown)=>Promise<ReturnType<typeof balanceCurveResultSchema.parse>>;
  journalSummary:(input:unknown)=>Promise<ReturnType<typeof journalSummaryResultSchema.parse>>;
  analyticsPerformance:(input:unknown)=>Promise<ReturnType<typeof performanceResultSchema.parse>>;
  analyticsBehavior:(input:unknown)=>Promise<ReturnType<typeof behaviorResultSchema.parse>>;
  calendar:(input:unknown)=>Promise<ReturnType<typeof calendarResultSchema.parse>>;
  journalExport:(input:unknown)=>Promise<ReturnType<typeof exportResultSchema.parse>>;
  referencesList:(input:unknown)=>Promise<ReturnType<typeof referencePageSchema.parse>>;
  referencesGet:(input:unknown)=>Promise<ReturnType<typeof referenceRecordSchema.parse>>;
  referencesWrite:(action:ReferenceAction,input:unknown)=>Promise<ReturnType<typeof referenceResultSchema.parse>>;
  tradeTagsList:(input:unknown)=>Promise<ReturnType<typeof referencePageSchema.parse>>;
  tradeTagsWrite:(action:"ASSIGN"|"REMOVE",input:unknown)=>Promise<ReturnType<typeof tradeTagResultSchema.parse>>;
  operationStatus:(id:string)=>Promise<Record<string,unknown>>;
  configurationList:(input:unknown)=>Promise<ReturnType<typeof configurationPageSchema.parse>>;
  configurationGet:(input:unknown)=>Promise<ReturnType<typeof configurationRecordSchema.parse>>;
  configurationWrite:(action:"CREATE"|"PATCH"|"ARCHIVE",input:unknown)=>Promise<ReturnType<typeof configurationResultSchema.parse>>;
  accountsList:(input:unknown)=>Promise<ReturnType<typeof accountPageSchema.parse>>;
  accountsGet:(input:unknown)=>Promise<ReturnType<typeof accountWithBalanceSchema.parse>>;
  accountsWrite:(action:"CREATE"|"PATCH",input:unknown)=>Promise<ReturnType<typeof accountResultSchema.parse>>;
  accountEventsList:(input:unknown)=>Promise<ReturnType<typeof eventPageSchema.parse>>;
  accountEventsWrite:(action:ReturnType<typeof eventResultSchema.parse>["action"],input:unknown)=>Promise<ReturnType<typeof eventResultSchema.parse>>;
  tradesList:(input:unknown)=>Promise<ReturnType<typeof tradePageSchema.parse>>;
  tradesGet:(input:unknown)=>Promise<Record<string,unknown>>;
  tradesWrite:(action:TradeAction,input:unknown)=>Promise<ReturnType<typeof tradeResultSchema.parse>>;
  tradeInstruments:(input:unknown)=>Promise<ReturnType<typeof tradePageSchema.parse>>;
  journalsGet:(input:unknown)=>Promise<ReturnType<typeof journalResultSchema.parse>>;
  journalsList:(input:unknown)=>Promise<ReturnType<typeof journalPageSchema.parse>>;
  journalsSave:(input:unknown)=>Promise<ReturnType<typeof journalResultSchema.parse>>;
  goalsGet:(input:unknown)=>Promise<ReturnType<typeof goalRecordSchema.parse>>;
  goalsList:(input:unknown)=>Promise<ReturnType<typeof goalPageSchema.parse>>;
  goalProgressList:(input:unknown)=>Promise<ReturnType<typeof goalEventPageSchema.parse>>;
  propGet:(input:unknown)=>Promise<ReturnType<typeof propResultSchema.parse>>;
  progressWrite:(action:ProgressAction,input:unknown)=>Promise<ReturnType<typeof progressResultSchema.parse>>;
  progressGet:(input:unknown)=>Promise<Record<string,unknown>>;
};
export function createTradeOsMcpServer(services:McpApplicationServices) {
  const server = new McpServer({name:"trade-os",version:"1.0.0"});
  for(const [name,value] of Object.entries(resources)) {
    server.registerResource(name,`tradeos://v1/${name}`,{mimeType:"application/json",description:`Trade OS ${name} contract and workflow guidance`},
      async uri=>({contents:[{uri:uri.href,mimeType:"application/json",text:JSON.stringify(value)}]}));
  }
  server.registerTool("tradeos_capabilities",{description:"Inspect implemented capabilities and pending application workflows.",inputSchema:z.object({}).strict(),
    outputSchema:z.object({version:z.string(),tools:z.array(z.string()),resources:z.array(z.string()),pendingFamilies:z.array(z.string()),status:z.string()}),annotations:readOnly},
    async()=>result(catalog));
  server.registerTool("tradeos_position_size",{description:"Calculate position size using the application's decimal domain and explicit currency precision. Uses the standard instrument specifications, which may differ from broker specifications.",
    inputSchema:positionSizeInput,outputSchema:positionSizeOutput,annotations:readOnly},async input=>{
      const instrument=getInstrumentSpecification(input.instrumentSymbol);
      if(!instrument)return failure("UNSUPPORTED_INSTRUMENT");
      try{return result(positionSizeOutput.parse(calculatePositionSize({...input,instrument})));}
      catch{return failure("INVALID_POSITION_SIZE_INPUT");}
    });
  server.registerTool("tradeos_operation_status",{description:"Retrieve an authorized durable integration receipt. UNKNOWN alone does not prove an uncertain operation failed.",
    inputSchema:z.object({operationId:z.string().uuid()}).strict(),outputSchema:z.record(z.string(),z.unknown()),annotations:readOnly},async({operationId})=>{
      try{return result(await services.operationStatus(operationId));}catch{return failure("OPERATION_STATUS_UNAVAILABLE");}
    });
  const guarded = async (work:()=>Promise<Record<string,unknown>>) => {
    try {return result(await work());}
    catch(error) {return failure(error instanceof ApplicationWorkflowError || error instanceof BalanceCurveCursorError?`${error.code}: ${error.message}`:error instanceof ReportingConsistencyError?`REPORTING_CONSISTENCY_CONFLICT: ${error.message}`:"APPLICATION_WORKFLOW_UNAVAILABLE");}
  };
  server.registerTool("tradeos_configuration_list",{description:"List owner-owned STRATEGY, SETUP or RULE records in stable ID order. Continue using nextCursor as afterId; archived records are excluded by default.",
    inputSchema:configurationListSchema,outputSchema:configurationPageSchema,annotations:readOnly},
    async input=>guarded(()=>services.configurationList(input)));
  server.registerTool("tradeos_configuration_get",{description:"Read an owner-owned strategy, setup or rule, including its current string record_version and archive state.",
    inputSchema:configurationGetSchema,outputSchema:configurationRecordSchema,annotations:readOnly},
    async input=>guarded(()=>services.configurationGet(input)));
  const mutation = {readOnlyHint:false,destructiveHint:false,idempotentHint:true,openWorldHint:false};
  server.registerTool("tradeos_configuration_create",{description:"Create a strategy, setup or rule. Required operationId is durable: retry the identical payload with the same ID after an uncertain response. Never submit an owner ID. Numeric limits are decimal strings.",
    inputSchema:configurationCreateSchema,outputSchema:configurationResultSchema,annotations:mutation},
    async input=>guarded(()=>services.configurationWrite("CREATE",input)));
  server.registerTool("tradeos_configuration_patch",{description:"Patch a strategy, setup or rule using expectedVersion from record_version. Omitted fields are unchanged; null clears nullable fields only. No audit or historical rule snapshot is rewritten.",
    inputSchema:configurationPatchSchema,outputSchema:configurationResultSchema,annotations:mutation},
    async input=>guarded(()=>services.configurationWrite("PATCH",input)));
  server.registerTool("tradeos_configuration_archive",{description:"Archive and deactivate a strategy, setup or rule, preserving references and review snapshots. Requires a meaningful reason, operationId and expectedVersion. Does not permanently delete data.",
    inputSchema:configurationArchiveSchema,outputSchema:configurationResultSchema,annotations:mutation},
    async input=>guarded(()=>services.configurationWrite("ARCHIVE",input)));
  server.registerTool("tradeos_accounts_list",{description:"List owned trading accounts in stable ID order, with separate exact ledger balance, closed-trade profit and cash adjustments per currency. Continue using nextCursor as afterId. Snapshots/equity and open-trade cash are not realized trading performance.",
    inputSchema:accountListSchema,outputSchema:accountPageSchema,annotations:readOnly},async input=>guarded(()=>services.accountsList(input)));
  server.registerTool("tradeos_accounts_get",{description:"Read an owned account and authoritative balance: starting balance + closed-trade net PnL + all adjustments. Account monetary values remain separate from trading profit. Unclassified OTHER count warns about drawdown completeness; this tool does not calculate drawdown.",
    inputSchema:accountGetSchema,outputSchema:accountWithBalanceSchema,annotations:readOnly},async input=>guarded(()=>services.accountsGet(input)));
  server.registerTool("tradeos_accounts_create",{description:"Create an account with a registered ISO currency and explicit precision, positive normalized baseline and calendar start date. Reuse operationId for identical retries. No MT5 mapping or automatic live-account activation is performed.",
    inputSchema:accountCreateSchema,outputSchema:accountResultSchema,annotations:mutation},async input=>guarded(()=>services.accountsWrite("CREATE",input)));
  server.registerTool("tradeos_accounts_patch",{description:"Patch owned account metadata using expectedVersion. Omission leaves unchanged; null clears nullable metadata. Baseline/date correction requires a reason. Currency changes are rejected after financial history exists. Mapped-account financial changes require integration reconciliation. Status and previous-account links use separate lifecycle workflows, not this tool.",
    inputSchema:accountPatchSchema,outputSchema:accountResultSchema,annotations:mutation},async input=>guarded(()=>services.accountsWrite("PATCH",input)));
  server.registerTool("tradeos_account_events_list",{description:"List owned account adjustments, immutable classification history, optional equity snapshots or lifecycle events. All matching records are cursor-paginated; numeric values are strings.",
    inputSchema:accountEventListSchema,outputSchema:eventPageSchema,annotations:readOnly},async input=>guarded(()=>services.accountEventsList(input)));
  server.registerTool("tradeos_adjustment_create",{description:"Record a cash adjustment, separate from trading profit. Deposits are positive and withdrawals negative after account-precision normalization. OTHER requires explicit performance classification and reason; balance corrections require a meaningful note. No history is deleted.",
    inputSchema:adjustmentCreateSchema,outputSchema:eventResultSchema,annotations:mutation},async input=>guarded(()=>services.accountEventsWrite("ADJUSTMENT",input)));
  server.registerTool("tradeos_adjustment_classify",{description:"Classify an owned OTHER adjustment with expectedVersion and a reason. Appends classification history; fixed adjustment types cannot be made performance-affecting. Does not change the cash amount.",
    inputSchema:adjustmentClassifySchema,outputSchema:eventResultSchema,annotations:mutation},async input=>guarded(()=>services.accountEventsWrite("CLASSIFY",input)));
  server.registerTool("tradeos_snapshot_record",{description:"Record an optional balance/equity observation. Supply equity or unrealizedPnl; if both are supplied they must satisfy equity = balance + unrealized PnL after normalization. Snapshots do not change authoritative ledger balance or trading profit.",
    inputSchema:snapshotRecordSchema,outputSchema:eventResultSchema,annotations:mutation},async input=>guarded(()=>services.accountEventsWrite("SNAPSHOT",input)));
  server.registerTool("tradeos_account_transition",{description:"Change account lifecycle status atomically with append-only status history and reason. Requires expectedVersion; FAILED requires a failureReason. PASSED is reserved for prop challenges.",
    inputSchema:accountTransitionSchema,outputSchema:eventResultSchema,annotations:mutation},async input=>guarded(()=>services.accountEventsWrite("TRANSITION",input)));
  server.registerTool("tradeos_account_link_funded",{description:"Create a separate funded account linked to an owned PASSED prop challenge using expectedVersion. Inherits currency, precision, broker and leverage; requires its own positive opening baseline. Challenge trades and balance remain separate.",
    inputSchema:fundedLinkSchema,outputSchema:eventResultSchema,annotations:mutation},async input=>guarded(()=>services.accountEventsWrite("LINK_FUNDED",input)));
  server.registerTool("tradeos_trades_list",{description:"List owned canonical trades by account/status with stable cursor pagination. Numeric and version values are strings. Open trades have no authoritative realized result.",inputSchema:tradeListSchema,outputSchema:tradePageSchema,annotations:readOnly},async input=>guarded(()=>services.tradesList(input)));
  server.registerTool("tradeos_trades_get",{description:"Read an owned canonical trade plus targets, management/correction history, review answers, immutable rule snapshots and screenshot metadata. Use trade.record_version for expectedVersion.",inputSchema:tradeGetSchema,outputSchema:z.record(z.string(),z.unknown()),annotations:readOnly},async input=>guarded(()=>services.tradesGet(input)));
  server.registerTool("tradeos_trades_create",{description:"Create one MANUAL canonical trade. Supply account/instrument UUIDs and direction. May save DRAFT/PLANNED or record OPEN/CLOSED with timestamps. Closure requires gross PnL; net/outcome/R are centrally derived. Targets and explicit review completion commit atomically. Never supply an owner, broker source or computed outcome.",inputSchema:tradeCreateSchema,outputSchema:tradeResultSchema,annotations:mutation},async input=>guarded(()=>services.tradesWrite("CREATE",input)));
  server.registerTool("tradeos_trades_patch",{description:"Edit or transition an owned trade using expectedVersion and operationId. Omitted fields stay unchanged; null clears only nullable values. OPEN/CLOSED planned values require explicit corrections. OPEN cannot regress; CLOSED cannot reopen. Broker execution/provenance cannot be overwritten. Reviews/targets are atomic with the trade.",inputSchema:tradePatchSchema,outputSchema:tradeResultSchema,annotations:mutation},async input=>guarded(()=>services.tradesWrite("PATCH",input)));
  server.registerTool("tradeos_trade_targets",{description:"Replace planned targets before OPEN, or patch actual target executions on OPEN/CLOSED using owned target IDs. Partial exits remain part of the same canonical trade; final outcome is derived only at complete closure. Unspecified execution fields stay unchanged. Broker execution targets are read-only.",inputSchema:tradeTargetsSchema,outputSchema:tradeResultSchema,annotations:mutation},async input=>guarded(()=>services.tradesWrite("TARGETS",input)));
  server.registerTool("tradeos_trade_correct_plan",{description:"Correct incorrectly recorded post-OPEN plan evidence with a meaningful reason. Appends typed original/previous/current history atomically; target corrections require tradeTargetId. Actual management changes must use the management tool, not this correction workflow.",inputSchema:tradeCorrectionSchema,outputSchema:tradeResultSchema,annotations:mutation},async input=>guarded(()=>services.tradesWrite("CORRECT",input)));
  server.registerTool("tradeos_trade_management",{description:"Append an actual stop/target/scale/note event to an opened manual trade. STOP_MOVED records current execution stop without changing planned stop. SCALE_OUT records partial management, not early canonical realized PnL. Requires UTC event time and meaningful notes; broker facts are read-only.",inputSchema:tradeManagementSchema,outputSchema:tradeResultSchema,annotations:mutation},async input=>guarded(()=>services.tradesWrite("MANAGEMENT",input)));
  server.registerTool("tradeos_trade_review",{description:"Patch nullable behavioral answers or explicitly complete execution, psychology, rule or post-trade review. Rules complied:null clears an uncompleted draft answer only; prior answers remain audited. Omitted notes stay unchanged. Placeholder answers do not count as reviewed. Completion requires CLOSED and explicit results for every applicable rule, which are immutably snapshotted. Completed rule snapshots cannot be rewritten.",inputSchema:tradeReviewCommandSchema,outputSchema:tradeResultSchema,annotations:mutation},async input=>guarded(()=>services.tradesWrite("REVIEW",input)));
  server.registerTool("tradeos_trade_instruments",{description:"Discover active reference and owned instruments, including exact pip sizes and IDs required for trade entry. Cursor-paginated read-only catalog; this does not alter broker symbol mappings.",inputSchema:z.object({afterId:z.string().uuid().optional(),limit:z.number().int().min(1).max(100).default(50)}).strict(),outputSchema:tradePageSchema,annotations:readOnly},async input=>guarded(()=>services.tradeInstruments(input)));
  server.registerTool("tradeos_journals_get",{description:"Read the persisted DAILY, WEEKLY or MONTHLY reflection for an owned account and calendar period. Weekly starts Monday; monthly starts on day one. Missing record is null, not reviewed evidence. Does not compute performance summaries or change journal-date/closed-at conventions.",inputSchema:journalGetSchema,outputSchema:journalResultSchema,annotations:readOnly},async input=>guarded(()=>services.journalsGet(input)));
  server.registerTool("tradeos_journals_list",{description:"List persisted account reflections by kind in stable cursor order. Exhaust nextCursor for all records. Monetary observations remain strings, not authoritative ledger balances; no computed analytics are returned.",inputSchema:journalListSchema,outputSchema:journalPageSchema,annotations:readOnly},async input=>guarded(()=>services.journalsList(input)));
  server.registerTool("tradeos_journals_save",{description:"Create or patch a persisted reflection using durable operationId. expectedVersion is 0 only for a missing period, otherwise use record_version. Omitted fields stay unchanged; null clears a nullable field. False is deliberate, not missing data. Monetary/derived summaries cannot be edited here. Saving does not complete trade reviews.",inputSchema:journalSaveSchema,outputSchema:journalResultSchema,annotations:mutation},async input=>guarded(()=>services.journalsSave(input)));
  server.registerTool("tradeos_goals_get",{description:"Read an owned goal with exact target, active/archive state and string record_version.",inputSchema:goalGetSchema,outputSchema:goalRecordSchema,annotations:readOnly},async input=>guarded(()=>services.goalsGet(input)));
  server.registerTool("tradeos_goals_list",{description:"List owned account goals with bounded ID cursors. Archived entries are excluded unless includeArchived is true.",inputSchema:goalListSchema,outputSchema:goalPageSchema,annotations:readOnly},async input=>guarded(()=>services.goalsList(input)));
  server.registerTool("tradeos_goals_create",{description:"Create an owned research/process goal with durable operationId. Currency targets normalize at account precision; counts require whole numbers; R/custom/percentage goals have separate precision. CUSTOM needs custom_unit. Trade-count goals never prescribe extra trades.",inputSchema:goalCreateSchema,outputSchema:progressResultSchema,annotations:mutation},async input=>guarded(()=>services.progressWrite("GOAL_CREATE",input)));
  server.registerTool("tradeos_goals_patch",{description:"Patch a goal using expectedVersion. Omitted fields stay unchanged; null clears optional fields. Account/owner cannot change; existing custom progress prevents changing type or unit. Derived achievement is not a writable field.",inputSchema:goalPatchSchema,outputSchema:progressResultSchema,annotations:mutation},async input=>guarded(()=>services.progressWrite("GOAL_PATCH",input)));
  server.registerTool("tradeos_goals_archive",{description:"Archive/deactivate an owned goal with reason, operationId and expectedVersion. Keeps evidence and history; never permanently deletes. Archived goals cannot receive new progress or silently reactivate.",inputSchema:goalArchiveSchema,outputSchema:progressResultSchema,annotations:mutation},async input=>guarded(()=>services.progressWrite("GOAL_ARCHIVE",input)));
  server.registerTool("tradeos_goal_progress_list",{description:"List append-only custom-goal observations using bounded cursors. Values are exact decimals; an event is a recorded current value, not an increment to sum. Latest uses recorded_at, created_at and ID ordering.",inputSchema:goalProgressListSchema,outputSchema:goalEventPageSchema,annotations:readOnly},async input=>guarded(()=>services.goalProgressList(input)));
  server.registerTool("tradeos_goal_progress_record",{description:"Append explicit current-value evidence only to an active CUSTOM goal. Uses operationId and expectedVersion, increments its version and preserves every observation. Does not alter automatic goal progress or mark trade reviews complete.",inputSchema:goalProgressSchema,outputSchema:progressResultSchema,annotations:mutation},async input=>guarded(()=>services.progressWrite("GOAL_PROGRESS",input)));
  server.registerTool("tradeos_prop_get",{description:"Read the owned account's persisted manually configured prop rules. Missing configuration is null; no universal firm rule is invented.",inputSchema:propGetSchema,outputSchema:propResultSchema,annotations:readOnly},async input=>guarded(()=>services.propGet(input)));
  server.registerTool("tradeos_prop_save",{description:"Create/patch a PROP_CHALLENGE or FUNDED configuration with operationId and expectedVersion (0 only when absent). Optional rule groups must be wholly defined/cleared. Money and percentages retain separate precision. Requires explicit firm, drawdown type, IANA timezone and profitable-day threshold when first configured.",inputSchema:propSaveSchema,outputSchema:progressResultSchema,annotations:mutation},async input=>guarded(()=>services.progressWrite("PROP_SAVE",input)));
  server.registerTool("tradeos_progress_get",{description:"Calculate one owned account's progress from complete exact data in a consistent read snapshot, using the same domain as the UI. Trading targets/return exclude cash adjustments; balance includes them. Closed_at owns realized results; opened_at owns trading-day eligibility. R sample is explicit; rules use immutable reviewed snapshots. Ambiguous OTHER/incomplete closure withholds drawdown. Trailing/custom loss mechanics and unspecified firm cash-flow policies remain unavailable. Maximum-drawdown goals are limits, not encouragement to increase losses.",inputSchema:propGetSchema,outputSchema:progressDatasetResultSchema,annotations:readOnly},async input=>guarded(()=>services.progressGet(input)));
  server.registerTool("tradeos_references_list",{description:"List owned TAG or global/owned INSTRUMENT records in bounded ID order. Use nextCursor as afterId. Archived references excluded by default; inactive instruments retain their active flag. Tags are unique case-insensitively within their owner.",inputSchema:referenceListSchema,outputSchema:referencePageSchema,annotations:readOnly},async input=>guarded(()=>services.referencesList(input)));
  server.registerTool("tradeos_references_get",{description:"Read an owned tag or accessible instrument, including exact pip_size, string record_version and archive state. A global instrument has user_id:null and is read-only.",inputSchema:referenceGetSchema,outputSchema:referenceRecordSchema,annotations:readOnly},async input=>guarded(()=>services.referencesGet(input)));
  server.registerTool("tradeos_references_create",{description:"Create an owned TAG or INSTRUMENT using durable operationId. Decimal pip size retains separate precision; never supply owner/global status. No MT5 symbol mapping is inferred.",inputSchema:referenceCreateSchema,outputSchema:referenceResultSchema,annotations:mutation},async input=>guarded(()=>services.referencesWrite("CREATE",input)));
  server.registerTool("tradeos_references_patch",{description:"Patch an owned tag or instrument using expectedVersion and operationId. Omitted fields stay unchanged; null clears only nullable fields. Referenced instrument specifications cannot change; global records and archived records are not editable.",inputSchema:referencePatchSchema,outputSchema:referenceResultSchema,annotations:mutation},async input=>guarded(()=>services.referencesWrite("PATCH",input)));
  server.registerTool("tradeos_references_archive",{description:"Archive an owned tag/instrument with a meaningful reason, operationId and expectedVersion. Preserves historical references and deactivates instruments. Does not permanently delete or remove existing tag associations.",inputSchema:referenceArchiveSchema,outputSchema:referenceResultSchema,annotations:mutation},async input=>guarded(()=>services.referencesWrite("ARCHIVE",input)));
  server.registerTool("tradeos_trade_tags_list",{description:"List tags assigned to one owned trade with bounded ID cursors, including archived tags retained as historical labels.",inputSchema:tradeTagsListSchema,outputSchema:referencePageSchema,annotations:readOnly},async input=>guarded(()=>services.tradeTagsList(input)));
  server.registerTool("tradeos_trade_tags_assign",{description:"Assign an active owned tag to an owned canonical trade. Requires durable operationId, expectedVersion from trade.record_version and expectedTagVersion from tag.record_version. Returns the new tradeVersion. Does not alter broker execution facts or complete any review.",inputSchema:tradeTagCommandSchema,outputSchema:tradeTagResultSchema,annotations:mutation},async input=>guarded(()=>services.tradeTagsWrite("ASSIGN",input)));
  server.registerTool("tradeos_trade_tags_remove",{description:"Remove a tag association, not the tag itself or financial history. Archived tags may be removed. Requires operationId and both current trade/tag versions. Retains the before/after association audit and returns tradeVersion.",inputSchema:tradeTagCommandSchema,outputSchema:tradeTagResultSchema,annotations:mutation},async input=>guarded(()=>services.tradeTagsWrite("REMOVE",input)));
  server.registerTool("tradeos_journal_summary",{description:"Compute DAILY/WEEKLY/MONTHLY results for an owned account and calendar period. Weekly starts Monday; monthly starts day one. Realized PnL uses final closed_at; journalTrades uses opened_at→planned_at→created_at. Exact money, R samples, all five outcomes and incomplete-data warnings are explicit. Does not mark reflections/reviews complete.",inputSchema:journalSummarySchema,outputSchema:journalSummaryResultSchema,annotations:readOnly},async input=>guarded(()=>services.journalSummary(input)));
  server.registerTool("tradeos_analytics_performance",{description:"Realized performance from complete, consistent owner history. Dates use closed_at. Money is separated by currency; unitless rates use underlying trades. Trading profit excludes adjustments. Cash-neutral drawdown uses full account history independent of trade dimensions; unclassified OTHER withholds drawdown. Aggregate metrics/breakdowns only, not an event curve. Missing R is excluded with sample counts.",inputSchema:analyticsReportSchema,outputSchema:performanceResultSchema,annotations:readOnly},async input=>guarded(()=>services.analyticsPerformance(input)));
  server.registerTool("tradeos_analytics_behavior",{description:"Descriptive behavioral associations among qualifying closed trades. Only explicitly reviewed execution/psychology and complete immutable rule snapshots count. Null is unanswered, not no. Currency results and R qualifying samples are explicit. All five grades remain in detail; A/B and D/F are summary groups. No causal/counterfactual loss claim.",inputSchema:analyticsReportSchema,outputSchema:behaviorResultSchema,annotations:readOnly},async input=>guarded(()=>services.analyticsBehavior(input)));
  server.registerTool("tradeos_calendar",{description:"Realized daily calendar for YYYY-MM, optionally scoped to one owned account. PnL uses final closed_at in the requested/profile timezone; no open-trade cash enters results. Monetary days are separated by currency. journalDays independently counts journal-date membership. Incomplete closed results are reported.",inputSchema:calendarReportSchema,outputSchema:calendarResultSchema,annotations:readOnly},async input=>guarded(()=>services.calendar(input)));
  server.registerTool("tradeos_journal_export",{description:"Export every canonical journal record matching the supplied active filters/search, not merely a pagination page. Date filters use journal date, not closed_at. CSV includes persisted identifiers/provenance, plan/execution money, fees/credits, outcome, R, tags and review state. Decimal evidence remains strings; free-text formula prefixes are escaped. No write occurs.",inputSchema:journalReportSchema,outputSchema:exportResultSchema,annotations:readOnly},async input=>guarded(()=>services.journalExport(input)));
  server.registerTool("tradeos_analytics_balance_curve",{description:"Page a realized account/portfolio balance curve for one required currencyCode. Only account/accountType/from/to ledger filters are accepted; never filter the balance by strategy/instrument. Maximum 100 points per page. All balances/drawdown use full history before paging; cash-neutral movements shift the high-water basis. closed_at places complete trades, not partial/open cash. Cumulative R has an explicit cumulativeRSample. Incomplete history withholds authoritative money; unclassified OTHER withholds drawdown. Reuse nextCursor with identical scope/timezone; CURVE_CHANGED requires restarting. Every continuation freshly authorizes access; no equity substitution or persistent server session.",inputSchema:balanceCurveSchema,outputSchema:balanceCurveResultSchema,annotations:readOnly},async input=>guarded(()=>services.balanceCurve(input)));
  return server;
}
