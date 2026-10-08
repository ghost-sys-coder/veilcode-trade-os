import {escapeCsv} from "@/domain/journal/analytics";
import type {JournalDataset} from "@/domain/reporting/journal";

/** Shared browser/MCP export. Caller supplies the full filtered result, never a page. */
export function buildJournalCsv(dataset:JournalDataset):string {
  const headers = [
    "id", "journal_date", "created_at", "updated_at", "planned_at", "opened_at", "closed_at", "timezone_at_entry",
    "account_id", "account", "currency_code", "currency_precision", "instrument_id", "instrument", "strategy_id", "setup_id", "direction", "order_type", "session", "status", "outcome",
    "source_type", "external_trade_id", "external_order_id", "external_position_id", "mt5_connection_id", "mt5_opening_deal_ticket", "mt5_used_partial_exits", "strategy", "setup", "primary_analysis_timeframe", "entry_timeframe", "higher_timeframe_bias", "market_condition",
    "account_balance_before", "planned_entry", "planned_stop_loss", "planned_take_profit", "planned_lot_size", "planned_risk_amount", "planned_risk_percentage", "planned_reward_amount", "planned_risk_reward",
    "actual_entry", "actual_stop_loss", "actual_exit", "actual_lot_size", "holding_duration_seconds", "commission", "swap", "other_fees", "trading_credits", "gross_pnl", "net_pnl", "pips_result", "actual_r",
    "mfe_amount", "mfe_pips", "mfe_r", "mae_amount", "mae_pips", "mae_r", "trade_grade", "rule_compliance", "rule_violations", "tags", "thesis", "entry_reason", "confirmation_notes",
  ];
  const lines = [headers.join(","), ...dataset.trades.map((trade) => {
    const row = trade.raw;
    return [
      trade.id, trade.journalDate, row.created_at, row.updated_at, trade.plannedAt, trade.openedAt, trade.closedAt, row.timezone_at_entry,
      trade.accountId, trade.accountName, trade.currencyCode, trade.currencyPrecision, trade.instrumentId, trade.instrumentSymbol, trade.strategyId, trade.setupId, trade.direction, row.order_type, trade.session, trade.status, trade.outcome,
      row.source_type, row.external_trade_id, row.external_order_id, row.external_position_id, row.mt5_connection_id, row.mt5_opening_deal_ticket, row.mt5_used_partial_exits, trade.strategyName, trade.setupName, row.primary_analysis_timeframe, row.entry_timeframe, row.higher_timeframe_bias, row.market_condition,
      row.account_balance_before, row.planned_entry, row.planned_stop_loss, row.planned_take_profit, row.planned_lot_size, row.planned_risk_amount, row.planned_risk_percentage, row.planned_reward_amount, row.planned_risk_reward,
      row.actual_entry, row.actual_stop_loss, row.actual_exit, row.actual_lot_size, row.holding_duration_seconds, row.commission, row.swap, row.other_fees, row.trading_credits, row.gross_pnl, row.net_pnl, row.pips_result, row.actual_r,
      row.mfe_amount, row.mfe_pips, row.mfe_r, row.mae_amount, row.mae_pips, row.mae_r, trade.grade, trade.ruleCompliance, trade.ruleViolations, trade.tags.map((tag) => tag.name).join("|"), row.thesis, row.entry_reason, row.confirmation_notes,
    ].map(escapeCsv).join(",");
  })];
  return `\uFEFF${lines.join("\r\n")}`;
}
