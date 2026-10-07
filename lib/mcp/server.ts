import "server-only";
import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { calculatePositionSize } from "@/domain/trading/position-sizing";
import { getInstrumentSpecification, SUPPORTED_ACCOUNT_CURRENCIES } from "@/domain/trading/instrument-specifications";
import { parseDecimal } from "@/domain/money/decimal";
import { TRADE_OUTCOMES, TRADE_STATUSES, TRADE_GRADES } from "@/types/domain";

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
const toolNames = ["tradeos_capabilities", "tradeos_position_size", "tradeos_operation_status"] as const;
const readOnly = { readOnlyHint:true, destructiveHint:false, idempotentHint:true, openWorldHint:false };
const catalog = {
  version:"1", tools:toolNames, resources:["catalog","domain","money","workflows","reporting"],
  pendingFamilies:["accounts","strategies","setups","rules","instruments","tags","goals","prop","trades","reviews","journals","analytics","exports","screenshots","mt5"],
  status:"Foundation only; application CRUD families and local stdio access are not implemented yet.",
};
const resources = {
  catalog,
  domain:{ canonicalTrade:"One logical position from planning through complete closure, independent of source.",
    relationships:["Account owns trades, snapshots and adjustments","Trade references an instrument, strategy and setup","Setup belongs to a strategy","Rules are snapshotted at completed review"],
    tradeStatuses:TRADE_STATUSES, tradeOutcomes:TRADE_OUTCOMES, tradeGrades:TRADE_GRADES },
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
export function createTradeOsMcpServer(services:{operationStatus:(id:string)=>Promise<Record<string,unknown>>}) {
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
  return server;
}
