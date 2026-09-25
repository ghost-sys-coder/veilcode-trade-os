import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/types/database";

export type ImportBatchSummary = Database["public"]["Tables"]["import_batches"]["Row"] & {
  accountName: string;
};

export async function getImportOverview(supabase: SupabaseClient<Database>): Promise<{
  batches: ImportBatchSummary[];
  accountCount: number;
}> {
  const [accountsResult, batchesResult] = await Promise.all([
    supabase.from("trading_accounts").select("id,name").order("name"),
    supabase.from("import_batches").select("*").order("started_at", { ascending: false }).limit(25),
  ]);
  const error = accountsResult.error ?? batchesResult.error;
  if (error) throw new Error(error.message);

  const accountNames = new Map((accountsResult.data ?? []).map((account) => [account.id, account.name]));
  return {
    accountCount: accountsResult.data?.length ?? 0,
    batches: (batchesResult.data ?? []).map((batch) => ({
      ...batch,
      accountName: accountNames.get(batch.account_id) ?? "Unknown account",
    })),
  };
}
