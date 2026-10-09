import "server-only";
import {listMt5,getMt5,previewMt5,listMt5Sources,listMt5Matches,reviewMt5,listImports,getImport,listImportRows,listMt5Grants,writeMt5Workflow} from "@/services/application/integrations";
import {getProfile,patchProfile} from "@/services/application/profile";
import {summarizeJournal,queryPerformance,queryBalanceCurve,queryBehavior,queryCalendar,exportJournal} from "@/services/application/reporting";
import {performanceReport,behaviorResultSchema} from "@/domain/reporting/results";
import {getReference,listReferences,writeReference,listTradeTags,writeTradeTag} from "@/services/application/references";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { getIntegrationContext, verifiedIntegrationClaims } from "@/services/integrations/actor-context";
import { getIntegrationOperation } from "@/services/integrations/operation-status";
import { getIntegrationConfig } from "@/config/integrations";
import { integrationErrorResponse } from "@/lib/integrations/http";
import { createTradeOsMcpServer } from "@/lib/mcp/server";
import { getConfiguration, listConfiguration, writeConfiguration } from "@/services/application/configuration";
import { getAccount, listAccounts, writeAccount } from "@/services/application/accounts";
import { listAccountEvents,writeAccountEvent } from "@/services/application/account-events";
import { listTrades,getTrade,writeTrade,listTradeReferences } from "@/services/application/trades";
import { getJournal,listJournals,saveJournal } from "@/services/application/journals";
import {getGoal,listGoals,listGoalProgress,getPropConfig,writeProgress,getAccountProgress} from "@/services/application/progress";

/** No cookie login, in-memory session map, or caller-submitted owner identity. */
export async function handleMcpRequest(request:Request):Promise<Response> {
  try {
    const configured = new URL(getIntegrationConfig("MCP").resource);
    // Next's dev adapter may normalize request.url to localhost even when the
    // socket Host is 127.0.0.1. Validate the actual Host for DNS rebinding; never
    // trust caller-supplied X-Forwarded-Host. Plain Request fixtures use URL host.
    const targetHost=request.headers.get("host") ?? new URL(request.url).host;
    const origin=request.headers.get("Origin");
    if(targetHost!==configured.host || (origin!==null && origin!==configured.origin)) {
      return Response.json({error:"INVALID_MCP_ORIGIN"},{status:403,headers:{"Cache-Control":"no-store"}});
    }
    const context=await getIntegrationContext(request,"MCP");
    verifiedIntegrationClaims(context);
    if(request.method!=="POST")return new Response(null,{status:405,headers:{Allow:"POST","Cache-Control":"no-store"}});
    const handler=createMcpHandler(()=>createTradeOsMcpServer({operationStatus:id=>getIntegrationOperation(context,id),
      mt5Grants:input=>listMt5Grants(context,input),mt5MapAccount:input=>writeMt5Workflow(context,"REGISTER",input),
      mt5SymbolMap:input=>writeMt5Workflow(context,"SYMBOL_MAPPING",input),mt5CashClassify:input=>writeMt5Workflow(context,"CASH",input),
      mt5Publish:input=>writeMt5Workflow(context,"PUBLICATION",input),mt5OnboardingApprove:input=>writeMt5Workflow(context,"ONBOARDING",input),
      mt5PublicationPolicy:input=>writeMt5Workflow(context,"POLICY",input),mt5Control:input=>writeMt5Workflow(context,"CONTROL",input),
      mt5Matches:input=>listMt5Matches(context,input),mt5List:input=>listMt5(context,input),mt5Get:input=>getMt5(context,input),mt5Preview:input=>previewMt5(context,input),
      mt5Sources:input=>listMt5Sources(context,input),mt5Review:input=>reviewMt5(context,input),importsList:input=>listImports(context,input),
      importsGet:input=>getImport(context,input),importRows:input=>listImportRows(context,input),
      profileGet:input=>getProfile(context,input),profilePatch:input=>patchProfile(context,input),
      balanceCurve:input=>queryBalanceCurve(context,input),journalSummary:input=>summarizeJournal(context,input),analyticsPerformance:async input=>performanceReport(await queryPerformance(context,input)),
      analyticsBehavior:async input=>behaviorResultSchema.parse(await queryBehavior(context,input)),calendar:input=>queryCalendar(context,input),journalExport:input=>exportJournal(context,input),
      referencesList:input=>listReferences(context,input),referencesGet:input=>getReference(context,input),referencesWrite:(action,input)=>writeReference(context,action,input),
      tradeTagsList:input=>listTradeTags(context,input),tradeTagsWrite:(action,input)=>writeTradeTag(context,action,input),
      configurationList:input=>listConfiguration(context,input), configurationGet:input=>getConfiguration(context,input),
      configurationWrite:(action,input)=>writeConfiguration(context,action,input), accountsList:input=>listAccounts(context,input),
      accountsGet:input=>getAccount(context,input), accountsWrite:(action,input)=>writeAccount(context,action,input),
      accountEventsList:input=>listAccountEvents(context,input),accountEventsWrite:(action,input)=>writeAccountEvent(context,action,input),
      tradesList:input=>listTrades(context,input),tradesGet:input=>getTrade(context,input),tradesWrite:(action,input)=>writeTrade(context,action,input),tradeInstruments:input=>listTradeReferences(context,input),
      journalsGet:input=>getJournal(context,input),journalsList:input=>listJournals(context,input),journalsSave:input=>saveJournal(context,input),goalsGet:input=>getGoal(context,input),goalsList:input=>listGoals(context,input),goalProgressList:input=>listGoalProgress(context,input),propGet:input=>getPropConfig(context,input),progressWrite:(action,input)=>writeProgress(context,action,input),progressGet:async input=>({...await getAccountProgress(context,input)})}),
      {responseMode:"json",legacy:"stateless",maxRequestBodySize:1_048_576,maxSubscriptions:0});
    try {
      const response=await handler.fetch(request);
      response.headers.set("Cache-Control","no-store");
      return response;
    } finally { await handler.close(); }
  } catch(error) { return integrationErrorResponse(error,"MCP"); }
}
