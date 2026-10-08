import type {SupabaseClient} from "@supabase/supabase-js";
import type {Database} from "@/types/database";
import {buildAccountLedger} from "@/domain/accounts/ledger";
import {getAccountLedgerRecords} from "@/services/application/accounts";
import {getVerifiedBrowserContext} from "@/services/integrations/browser-context";
import {ApplicationWorkflowError} from "@/services/application/transaction";

export async function getAccountLedger(supabase:SupabaseClient<Database>,accountId:string) {
  try {return buildAccountLedger(await getAccountLedgerRecords(await getVerifiedBrowserContext(supabase),{id:accountId}));}
  catch(error) {if(error instanceof ApplicationWorkflowError&&error.code==="NOT_FOUND")return null;throw error;}
}
