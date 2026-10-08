import "server-only";
import { z } from "zod";
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
