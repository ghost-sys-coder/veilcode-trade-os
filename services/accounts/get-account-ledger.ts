import type { SupabaseClient } from "@supabase/supabase-js";
import Decimal from "decimal.js";

import { buildBalanceTimeline } from "@/domain/journal/analytics";
import { normalizeMoney, parseDecimal } from "@/domain/money/decimal";
import { normalizeSupabaseNumeric } from "@/lib/supabase/numeric";
import type { Database } from "@/types/database";

export async function getAccountLedger(supabase: SupabaseClient<Database>, accountId: string) {
  const [accountResult, tradesResult, adjustmentsResult, snapshotsResult, instrumentsResult] = await Promise.all([
    supabase.from("trading_accounts").select("*").eq("id", accountId).maybeSingle(),
    supabase.from("trades").select("id,instrument_id,status,closed_at,net_pnl").eq("account_id", accountId).eq("status", "CLOSED").not("closed_at", "is", null),
    supabase.from("account_adjustments").select("*").eq("account_id", accountId).order("occurred_at"),
    supabase.from("account_snapshots").select("*").eq("account_id", accountId).order("captured_at", { ascending: false }),
    supabase.from("instruments").select("id,symbol"),
  ]);
  const error = accountResult.error ?? tradesResult.error ?? adjustmentsResult.error ?? snapshotsResult.error ?? instrumentsResult.error;
  if (error) throw new Error(error.message);
  if (!accountResult.data) return null;

  const adjustmentIds = (adjustmentsResult.data ?? []).map((adjustment) => adjustment.id);
  const classificationsResult = adjustmentIds.length > 0
    ? await supabase
        .from("account_adjustment_classifications")
        .select("*")
        .in("adjustment_id", adjustmentIds)
        .order("created_at", { ascending: false })
    : { data: [], error: null };
  if (classificationsResult.error) throw new Error(classificationsResult.error.message);

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
  const netTradingPnl = normalizeMoney(
    trades.reduce((sum, trade) => sum.plus(parseDecimal(trade.netPnl)), new Decimal(0)),
    account.currency_precision,
  );

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
    derivedBalance: timeline.at(-1)?.balance ?? normalizeMoney(normalizeSupabaseNumeric(account.starting_balance), account.currency_precision),
    netTradingPnl,
  };
}
