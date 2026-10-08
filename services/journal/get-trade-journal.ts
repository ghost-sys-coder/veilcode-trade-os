import type {SupabaseClient} from "@supabase/supabase-js";
import type {Database} from "@/types/database";
import {getVerifiedBrowserContext} from "@/services/integrations/browser-context";
import {queryJournal} from "@/services/application/reporting";
import type {JournalFilters} from "@/domain/reporting/journal";
export * from "@/domain/reporting/journal";
export async function getTradeJournalDataset(supabase:SupabaseClient<Database>,filters:JournalFilters={},timezone?:string) {
  return queryJournal(await getVerifiedBrowserContext(supabase),{filters,timezone});
}
