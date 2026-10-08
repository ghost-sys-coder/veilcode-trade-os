import { getAccountLedgerRecords } from "@/services/application/accounts";
import { getVerifiedBrowserContext } from "@/services/integrations/browser-context";
import { ApplicationWorkflowError } from "@/services/application/transaction";
import type { SupabaseClient } from "@supabase/supabase-js";
import { accountWithBalance } from "@/domain/accounts/commands";

import { buildBalanceTimeline } from "@/domain/journal/analytics";
import { normalizeMoney } from "@/domain/money/decimal";
import { normalizeSupabaseNumeric } from "@/lib/supabase/numeric";
import type { Database } from "@/types/database";

export async function getAccountLedger(supabase: SupabaseClient<Database>, accountId: string) {
  let records;
  try {records=await getAccountLedgerRecords(await getVerifiedBrowserContext(supabase),{id:accountId});}
  catch(error) {if(error instanceof ApplicationWorkflowError&&error.code==="NOT_FOUND")return null;throw error;}
  const accountResult={data:records.account};
  const tradesResult={data:records.trades as Array<{id:string;instrument_id:string;closed_at:string;net_pnl:string|null}>};
  const adjustmentsResult={data:records.adjustments as unknown as Database["public"]["Tables"]["account_adjustments"]["Row"][]};
  const snapshotsResult={data:records.snapshots as unknown as Database["public"]["Tables"]["account_snapshots"]["Row"][]};
  const instrumentsResult={data:records.instruments};
  const classificationsResult={data:records.classifications as unknown as Database["public"]["Tables"]["account_adjustment_classifications"]["Row"][]};
  const account = accountResult.data;
  const instruments = new Map((instrumentsResult.data ?? []).map((item) => [item.id, item.symbol]));
  const trades = (tradesResult.data ?? [])
    .filter((trade): trade is typeof trade & { closed_at: string; net_pnl: string } => Boolean(trade.closed_at) && trade.net_pnl !== null)
    .map((trade) => ({
      id: trade.id,
      closedAt: trade.closed_at,
      netPnl: normalizeSupabaseNumeric(trade.net_pnl),
      label: `${instruments.get(trade.instrument_id) ?? "Trade"} closed`,
    }));
  const adjustments = (adjustmentsResult.data ?? []).map((adjustment) => ({
    ...adjustment,
    amount: normalizeMoney(normalizeSupabaseNumeric(adjustment.amount), account.currency_precision),
  }));
  const timeline = buildBalanceTimeline({
    startingBalance: normalizeMoney(normalizeSupabaseNumeric(account.starting_balance), account.currency_precision),
    startedAt: account.started_at,
    currencyPrecision: account.currency_precision,
    trades,
    adjustments: adjustments.map((adjustment) => ({
      id: adjustment.id,
      occurredAt: adjustment.occurred_at,
      amount: adjustment.amount,
      label: adjustment.type.replaceAll("_", " ").toLowerCase(),
    })),
  });
  const exactAccount=accountWithBalance(account);
  const netTradingPnl=exactAccount.closed_trade_net_pnl;

  return {
    account: {
      ...account,
      starting_balance: normalizeMoney(normalizeSupabaseNumeric(account.starting_balance), account.currency_precision),
      leverage: account.leverage === null ? null : normalizeSupabaseNumeric(account.leverage),
    },
    trades,
    adjustments,
    adjustmentClassifications: classificationsResult.data ?? [],
    snapshots: (snapshotsResult.data ?? []).map((snapshot) => ({
      ...snapshot,
      balance: normalizeMoney(normalizeSupabaseNumeric(snapshot.balance), account.currency_precision),
      equity: snapshot.equity === null ? null : normalizeMoney(normalizeSupabaseNumeric(snapshot.equity), account.currency_precision),
      unrealized_pnl: snapshot.unrealized_pnl === null
        ? null
        : normalizeMoney(normalizeSupabaseNumeric(snapshot.unrealized_pnl), account.currency_precision),
    })),
    timeline,
    derivedBalance: exactAccount.derived_balance,
    unplacedClosedTradeCount:(BigInt(account.closed_trade_count)-BigInt(trades.length)).toString(),
    netTradingPnl,
  };
}
