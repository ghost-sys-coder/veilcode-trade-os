import type { SupabaseClient } from "@supabase/supabase-js";

import { deriveAccountBalance } from "@/domain/accounts/balance";
import { normalizeSupabaseNumeric } from "@/lib/supabase/numeric";
import type { Database } from "@/types/database";
import type { TradingAccountRow } from "@/types/database-helpers";

export interface AccountWithDerivedBalance extends TradingAccountRow {
  derived_balance: string;
}

export async function getAccountsWithDerivedBalances(
  supabase: SupabaseClient<Database>,
  accounts: TradingAccountRow[],
): Promise<AccountWithDerivedBalance[]> {
  return Promise.all(
    accounts.map(async (account) => {
      const [tradesResult, adjustmentsResult] = await Promise.all([
        supabase
          .from("trades")
          .select("net_pnl")
          .eq("account_id", account.id)
          .eq("status", "CLOSED")
          .not("net_pnl", "is", null),
        supabase
          .from("account_adjustments")
          .select("amount")
          .eq("account_id", account.id),
      ]);

      if (tradesResult.error) {
        throw new Error(`Unable to derive trade balance: ${tradesResult.error.message}`);
      }

      if (adjustmentsResult.error) {
        throw new Error(`Unable to derive adjustment balance: ${adjustmentsResult.error.message}`);
      }

      return {
        ...account,
        starting_balance: normalizeSupabaseNumeric(account.starting_balance),
        leverage: account.leverage === null ? null : normalizeSupabaseNumeric(account.leverage),
        derived_balance: deriveAccountBalance({
          startingBalance: normalizeSupabaseNumeric(account.starting_balance),
          closedTradeNetPnl: tradesResult.data.map((trade) =>
            normalizeSupabaseNumeric(trade.net_pnl ?? "0"),
          ),
          accountAdjustments: adjustmentsResult.data.map((adjustment) =>
            normalizeSupabaseNumeric(adjustment.amount),
          ),
          currencyPrecision: account.currency_precision,
        }),
      };
    }),
  );
}
