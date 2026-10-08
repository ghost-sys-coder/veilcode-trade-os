import "server-only";
import {journalGetSchema,journalListSchema,journalSaveSchema,journalResultSchema,journalPageSchema} from "@/domain/journal/commands";
import {applicationTransaction,type ApplicationContext} from "@/services/application/transaction";
export async function getJournal(context:ApplicationContext,input:unknown) {
  return journalResultSchema.parse(await applicationTransaction(context,"JOURNAL_READ",journalGetSchema.parse(input)));
}
export async function listJournals(context:ApplicationContext,input:unknown) {
  return journalPageSchema.parse(await applicationTransaction(context,"JOURNAL_READ",journalListSchema.parse(input)));
}
export async function saveJournal(context:ApplicationContext,input:unknown) {
  return journalResultSchema.parse(await applicationTransaction(context,"JOURNAL_WRITE",journalSaveSchema.parse(input)));
}
