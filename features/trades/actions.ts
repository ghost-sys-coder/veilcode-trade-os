"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { tradeValuesSchema,protectedPlanFields,brokerExecutionFields } from "@/domain/trades/commands";
import { writeTrade,getTrade } from "@/services/application/trades";
import { getVerifiedBrowserContext } from "@/services/integrations/browser-context";
import { ApplicationWorkflowError } from "@/services/application/transaction";
import { createClient } from "@/lib/supabase/server";
import { z } from "zod";
function text(data:FormData,key:string) {const value=data.get(key);return typeof value==="string"?value.trim():"";}
function nullable(data:FormData,key:string) {const value=text(data,key);return value&&value!=="UNSET"?value:null;}
const camel=(key:string)=>key.replace(/_([a-z])/g,(_,letter:string)=>letter.toUpperCase());
function finish(path:string,kind:"message"|"error",message:string):never {redirect(`${path}${path.includes("?")?"&":"?"}${kind}=${encodeURIComponent(message)}`);}
function reviews(data:FormData,closed:boolean) {
  const yesNo=(key:string)=>text(data,key)==="YES"?true:text(data,key)==="NO"?false:null;
  const execution=Object.fromEntries(["entry_according_to_plan","stop_according_to_plan","target_according_to_plan","closed_early","entered_early","entered_late","chased_price","added_to_position","revenge_trade","over_risked"].map(key=>[key,yesNo(camel(key))]));
  const psychology=Object.fromEntries(["fear_influenced","greed_influenced","fomo_influenced"].map(key=>[key,yesNo(camel(key))]));
  const integer=(key:string)=>nullable(data,key)===null?null:Number(text(data,key));
  const rules=Array.from(data.entries()).filter(([key])=>key.startsWith("ruleResult:")).map(([key,v])=>({trading_rule_id:key.slice(11),complied:v==="YES"?true:v==="NO"?false:null,notes:nullable(data,"ruleNote:"+key.slice(11))}));
  return {
    execution:{values:{...execution,stop_action:nullable(data,"stopAction"),execution_rating:integer("executionRating"),notes:nullable(data,"executionNotes")},complete:data.get("completeExecutionReview")==="on"},
    psychology:{values:{...psychology,confidence_before_entry:integer("confidenceBeforeEntry"),emotion_before:nullable(data,"emotionBefore"),emotion_during:nullable(data,"emotionDuring"),emotion_after:nullable(data,"emotionAfter"),notes:nullable(data,"psychologyNotes")},complete:data.get("completePsychologyReview")==="on"},
    ...(text(data,"ruleReviewAlreadyComplete")!=="true"?{rules:{results:rules,complete:data.get("completeRuleReview")==="on"}}:{}),
    ...(closed?{post:{values:Object.fromEntries(["what_went_well","what_went_wrong","would_take_again","improvement","lesson_learned","trade_quality_grade"].map(key=>[key,nullable(data,camel(key))])),complete:true}}:{})
  };
}
export async function saveManualTrade(data:FormData):Promise<void> {
  const id=nullable(data,"id");const calculator=text(data,"calculatorTransfer")==="true";
  const path=id?`/trades/${id}/edit`:calculator?"/trades/new?from=position-calculator":"/trades/new";
  let savedId:string;
  try {
    const context=await getVerifiedBrowserContext(await createClient());
    const current=id?await getTrade(context,{id}):null;
    const trade=current?z.record(z.string(),z.unknown()).parse(current.trade):null;
    const locked=trade?.status==="OPEN"||trade?.status==="CLOSED";
    const broker=Boolean(trade?.mt5_connection_id)||["MT4","MT5","BROKER_API"].includes(String(trade?.source_type));
    const values:Record<string,unknown>={};
    for(const key of Object.keys(tradeValuesSchema.shape)) {
      if(locked&&protectedPlanFields.includes(key as typeof protectedPlanFields[number]))continue;
      if(broker&&brokerExecutionFields.includes(key as typeof brokerExecutionFields[number]))continue;
      const field=key==="timezone_at_entry"?"timezone":camel(key);
      if(key==="trading_credits"&&!data.has(field))continue;
      const value=nullable(data,field);
      if(["commission","swap","other_fees"].includes(key)&&value===null) {if(data.has(field))values[key]="0";continue;}
      if(value===null&&["status","order_type","session","direction","account_id","instrument_id","timezone_at_entry"].includes(key))continue;
      values[key]=value;
    }
    if(!broker)values.status=text(data,"intent")==="draft"?"DRAFT":text(data,"status");
    const getAll=(key:string)=>data.getAll(key).map(v=>typeof v==="string"?v.trim():"");
    const labels=getAll("targetLabel"),prices=getAll("targetPlannedPrice"),ids=getAll("targetId");
    const fills=getAll("targetActualFillPrice"),actual=getAll("targetActualPercentage"),pnl=getAll("targetPnlContribution"),hits=getAll("targetHitAt"),planned=getAll("targetPlannedPercentage");
    const targets=labels.map((label,i)=>({id:ids[i],label,planned_price:prices[i],planned_close_percentage:planned[i]||null,actual_fill_price:fills[i]||null,actual_close_percentage:actual[i]||null,pnl_contribution:pnl[i]||null,hit_at:hits[i]||null})).filter(v=>v.planned_price);
    const extras=broker?{}:locked?{executedTargets:targets.map(t=>({id:t.id,actual_fill_price:t.actual_fill_price,actual_close_percentage:t.actual_close_percentage,pnl_contribution:t.pnl_contribution,hit_at:t.hit_at}))}:{plannedTargets:targets.map(({id:unused,...t})=>{void unused;return t;})};
    const result=await writeTrade(context,id?"PATCH":"CREATE",{operationId:text(data,"operationId"),...(id?{id,expectedVersion:text(data,"expectedVersion")}:{}),values,...extras,reviews:reviews(data,values.status==="CLOSED"||trade?.status==="CLOSED")});
    savedId=z.string().uuid().parse(result.record.id);
  } catch(error) {finish(path,"error",error instanceof ApplicationWorkflowError?error.message:error instanceof z.ZodError?"Check the trade fields and explicit review answers.":"Trade could not be saved. No partial changes were committed.");}
  for(const route of ["/dashboard","/accounts","/trades","/analytics","/calendar","/goals","/prop",`/trades/${savedId}/edit`])revalidatePath(route);
  finish(`/trades/${savedId}/edit${calculator?"?calculatorSaved=1":""}`,"message",text(data,"intent")==="draft"?"Draft saved.":"Trade saved.");
}
export async function correctTradePlanValue(id:string,data:FormData):Promise<void> {
  const path=`/trades/${id}/edit`;
  try {await writeTrade(await getVerifiedBrowserContext(await createClient()),"CORRECT",{id,operationId:text(data,"operationId"),expectedVersion:text(data,"expectedVersion"),
    fieldName:text(data,"fieldName"),newValue:nullable(data,"newValue"),reason:text(data,"reason"),...(nullable(data,"tradeTargetId")?{tradeTargetId:nullable(data,"tradeTargetId")}:{})});}
  catch(error) {finish(path,"error",error instanceof ApplicationWorkflowError?error.message:"Invalid plan correction. No changes were committed.");}
  for(const route of [path,"/analytics","/dashboard","/trades"])revalidatePath(route);
  finish(path,"message","Recorded plan value corrected with an audit entry.");
}

export async function recordTradeManagement(id:string,data:FormData):Promise<void> {
  const path=`/trades/${id}/edit`;
  try {await writeTrade(await getVerifiedBrowserContext(await createClient()),"MANAGEMENT",{id,operationId:text(data,"operationId"),expectedVersion:text(data,"expectedVersion"),
    event:{event_type:text(data,"eventType"),occurred_at:new Date(`${text(data,"occurredAt")}Z`).toISOString(),price:nullable(data,"price"),volume:nullable(data,"volume"),notes:text(data,"notes")}});}
  catch(error) {finish(path,"error",error instanceof ApplicationWorkflowError?error.message:"Invalid management event. Check its UTC time, values and notes.");}
  for(const route of [path,`/trades/${id}`,"/analytics","/dashboard","/trades"])revalidatePath(route);
  finish(path,"message","Trade management event recorded. The planned values are unchanged.");
}
