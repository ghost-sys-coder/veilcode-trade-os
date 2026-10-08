import "server-only";
import { z } from "zod";
import { createHash } from "node:crypto";
import { ApplicationWorkflowError } from "@/services/application/transaction";
import { balanceCurveSchema, balanceCurveSeries, pageBalanceCurve } from "@/domain/reporting/balance-curve";
import { applicationTransaction,type ApplicationContext } from "@/services/application/transaction";
import { parseReportingRows } from "@/domain/reporting/rows";
import { buildTradeJournalDataset } from "@/domain/reporting/journal";
import { buildPerformanceAnalytics } from "@/domain/reporting/performance";
import { buildBehaviorAnalytics } from "@/domain/reporting/behavior";
import { journalReportSchema,analyticsReportSchema,calendarReportSchema,journalSummarySchema,
  buildJournalSummary,buildCalendarReport } from "@/domain/reporting/commands";
import { buildJournalCsv } from "@/domain/reporting/export";

const scopeSchema=z.object({accountId:z.string().uuid().optional()}).strict();
export async function getReportingRows(context:ApplicationContext,input:unknown={}) {
  return parseReportingRows(await applicationTransaction(context,"REPORTING_DATA",scopeSchema.parse(input)));
}
export async function queryJournal(context:ApplicationContext,input:unknown) {
  const request=journalReportSchema.parse(input),rows=await getReportingRows(context,{accountId:request.filters.account});
  return buildTradeJournalDataset({...rows,timezone:request.timezone??rows.timezone},request.filters);
}
export async function queryPerformance(context:ApplicationContext,input:unknown) {
  const request=analyticsReportSchema.parse(input),rows=await getReportingRows(context,{accountId:request.filters.account});
  return buildPerformanceAnalytics({...rows,timezone:request.timezone??rows.timezone},request.filters);
}
export async function queryBalanceCurve(context:ApplicationContext,input:unknown) {
  const request=balanceCurveSchema.parse(input);
  // Always validate actor/session/grant in the database, including continuations.
  // No token, cursor or previous result bypasses this fresh authorization.
  const rows=await getReportingRows(context,{accountId:request.filters.account});
  const dataset=buildPerformanceAnalytics({...rows,timezone:request.timezone??rows.timezone},request.filters);
  const series=balanceCurveSeries(dataset,request.currencyCode);
  if(!series)throw new ApplicationWorkflowError("NOT_FOUND");
  const accounts=rows.accounts.filter(account=>account.currency_code===request.currencyCode
    &&(!request.filters.account||account.id===request.filters.account)
    &&(!request.filters.accountType||account.account_type===request.filters.accountType)
    &&(!request.filters.to||account.started_at<=request.filters.to))
    .map(account=>({id:account.id,owner:account.user_id})).toSorted((left,right)=>left.id.localeCompare(right.id));
  // Content fingerprint, not an auth credential. Bind to the verified owner,
  // effective scope/timezone and entire curve, never just the visible page.
  // Page size may change; irrelevant row revisions need not invalidate a curve.
  const snapshotId=createHash("sha256").update(JSON.stringify({version:1,accounts,
    scope:{account:request.filters.account??null,accountType:request.filters.accountType??null,
      from:request.filters.from??null,to:request.filters.to??null},series})).digest("hex");
  return pageBalanceCurve(series,request,snapshotId);
}
export async function queryBehavior(context:ApplicationContext,input:unknown) {
  const request=analyticsReportSchema.parse(input),rows=await getReportingRows(context,{accountId:request.filters.account});
  return buildBehaviorAnalytics({...rows,timezone:request.timezone??rows.timezone},request.filters);
}
export async function queryCalendar(context:ApplicationContext,input:unknown) {
  const request=calendarReportSchema.parse(input),rows=await getReportingRows(context,{accountId:request.accountId});
  const accounts=request.accountId?rows.accounts.filter(account=>account.id===request.accountId):rows.accounts;
  return buildCalendarReport({...rows,accounts,timezone:request.timezone??rows.timezone},request.month);
}
export async function summarizeJournal(context:ApplicationContext,input:unknown) {
  const request=journalSummarySchema.parse(input),rows=await getReportingRows(context,{accountId:request.accountId});
  return buildJournalSummary({...rows,timezone:request.timezone??rows.timezone},request);
}
export async function exportJournal(context:ApplicationContext,input:unknown) {
  const request=journalReportSchema.parse(input),rows=await getReportingRows(context,{accountId:request.filters.account});
  const timezone=request.timezone??rows.timezone;
  const dataset=buildTradeJournalDataset(rows,request.filters,timezone);
  return {format:"CSV" as const,timezone,recordCount:dataset.trades.length,csv:buildJournalCsv(dataset)};
}
