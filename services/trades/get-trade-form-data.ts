import { randomUUID } from "node:crypto";
import { z } from "zod";
import { getVerifiedBrowserContext } from "@/services/integrations/browser-context";
import { getTrade } from "@/services/application/trades";
import { listBrowserAccounts } from "@/services/application/accounts";
import { ApplicationWorkflowError } from "@/services/application/transaction";
import type { SupabaseClient } from "@supabase/supabase-js";

import { normalizeSupabaseNumeric } from "@/lib/supabase/numeric";
import type { Database } from "@/types/database";
import type { ManualTradeRecord } from "@/features/trades/types";


export async function getTradeFormReferences(supabase: SupabaseClient<Database>) {
  const [accountsResult, instrumentsResult, strategiesResult, setupsResult, rulesResult, profileResult] = await Promise.all([
    supabase.from("trading_accounts").select("*").order("name"),
    supabase.from("instruments").select("*").eq("active", true).order("symbol"),
    supabase.from("strategies").select("*").order("name"),
    supabase.from("setups").select("*").order("name"),
    supabase.from("trading_rules").select("*").order("name"),
    supabase.from("profiles").select("timezone").maybeSingle(),
  ]);
  const error = accountsResult.error ?? instrumentsResult.error ?? strategiesResult.error ?? setupsResult.error ?? rulesResult.error ?? profileResult.error;
  if (error) throw new Error(error.message);

  return {
    operationId:randomUUID(),correctionOperationId:randomUUID(),managementOperationId:randomUUID(),
    accounts: await listBrowserAccounts(await getVerifiedBrowserContext(supabase)),
    instruments: (instrumentsResult.data ?? []).map((instrument) => ({
      ...instrument,
      pip_size: instrument.pip_size === null ? null : normalizeSupabaseNumeric(instrument.pip_size),
    })),
    strategies: strategiesResult.data ?? [],
    setups: setupsResult.data ?? [],
    rules: rulesResult.data ?? [],
    timezone: profileResult.data?.timezone ?? "Africa/Kampala",
  };
}

export async function getManualTradeRecord(supabase:SupabaseClient<Database>,tradeId:string,userId:string):Promise<ManualTradeRecord|null> {
  const context=await getVerifiedBrowserContext(supabase);
  if(context.userId!==userId)throw new Error("Browser ownership mismatch.");
  try {
    const record=await getTrade(context,{id:tradeId});
    const trade=z.object({id:z.string().uuid(),record_version:z.string().regex(/^[1-9]\d*$/)}).passthrough().parse(record.trade);
    return {...record,recordVersion:trade.record_version} as unknown as ManualTradeRecord;
  } catch(error) {if(error instanceof ApplicationWorkflowError&&error.code==="NOT_FOUND")return null;throw error;}
}
