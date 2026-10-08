import type {SupabaseClient} from "@supabase/supabase-js";
import type {Database} from "@/types/database";
import {normalizeSupabaseNumeric} from "@/lib/supabase/numeric";
import {listBrowserAccounts} from "@/services/application/accounts";
import {getAccountProgress} from "@/services/application/progress";
import {getVerifiedBrowserContext} from "@/services/integrations/browser-context";
import {emptyProgressDataset,type PropProgressDataset} from "@/domain/progress/dataset";
export type {PropProgressDataset,ProgressGoal} from "@/domain/progress/dataset";
type AccountRow=Database["public"]["Tables"]["trading_accounts"]["Row"];
function normalizeNullableNumeric(value: unknown): string | null {
  return value === null || value === undefined ? null : normalizeSupabaseNumeric(value);
}

export function normalizeProgressAccountRow(row: AccountRow): AccountRow {
  return {
    ...row,
    starting_balance: normalizeSupabaseNumeric(row.starting_balance),
    leverage: normalizeNullableNumeric(row.leverage),
  };
}


export async function getProgressDataset(supabase:SupabaseClient<Database>,requestedAccountId?:string,includeAllAccounts=false):Promise<PropProgressDataset> {
  const context=await getVerifiedBrowserContext(supabase);
  const accounts=(await listBrowserAccounts(context)).filter(item=>includeAllAccounts||item.account_type==="PROP_CHALLENGE"||item.account_type==="FUNDED").sort((a,b)=>a.name.localeCompare(b.name)||a.id.localeCompare(b.id));
  const account=accounts.find(item=>item.id===requestedAccountId)??accounts[0];
  if(!account)return emptyProgressDataset(accounts);
  return {...await getAccountProgress(context,{accountId:account.id}),accounts};
}
