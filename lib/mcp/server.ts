import "server-only";
import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { calculatePositionSize } from "@/domain/trading/position-sizing";
import { getInstrumentSpecification, SUPPORTED_ACCOUNT_CURRENCIES } from "@/domain/trading/instrument-specifications";
import { parseDecimal } from "@/domain/money/decimal";
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
  "tradeos_trades_patch","tradeos_trade_targets","tradeos_trade_correct_plan","tradeos_trade_management","tradeos_trade_review","tradeos_trade_instruments"] as const;
const readOnly = { readOnlyHint:true, destructiveHint:false, idempotentHint:true, openWorldHint:false };
const catalog = {
  version:"1", tools:toolNames, resources:["catalog","domain","money","workflows","reporting"],
  pendingFamilies:["configuration permanent deletion","instruments","tags","goals","prop","journals","analytics","exports","screenshots upload/download","mt5"],
  status:"HTTP plus accounts/events/lifecycle, canonical trades/targets/management/plan corrections/reviews and strategies/setups/rules. Other workflows, permanent deletion and local stdio are pending.",
};
const resources = {
  catalog,
  domain:{ canonicalTrade:"One logical position from planning through complete closure, independent of source.",
    relationships:["Account owns trades, snapshots and adjustments","Trade references an instrument, strategy and setup","Setup belongs to a strategy","Rules are snapshotted at completed review"],
    tradeStatuses:TRADE_STATUSES, tradeOutcomes:TRADE_OUTCOMES, tradeGrades:TRADE_GRADES, ruleTypes:RULE_TYPES,
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
    rExpectancy:"Average valid actual_r; expose qualifying sample count. Missing R is not zero R.",
    currencyAggregation:"Keep monetary results separated by account currency. Aggregate unitless results using underlying trades.",
    behavior:"Reviewed cohorts only; mistake differences are descriptive associations, not causal losses." },
};

function result(value: Record<string, unknown>) {
  return { content:[{ type:"text" as const, text:JSON.stringify(value) }], structuredContent:value };
}
function failure(code:string) { return { isError:true, content:[{ type:"text" as const,text:code }] }; }

/** A fresh transport instance; data access exists only through verified services. */
export type McpApplicationServices = {
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
    catch(error) {return failure(error instanceof ApplicationWorkflowError?`${error.code}: ${error.message}`:"APPLICATION_WORKFLOW_UNAVAILABLE");}
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
  return server;
}
