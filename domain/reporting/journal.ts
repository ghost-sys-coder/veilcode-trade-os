
import { dateKey, journalDate } from "@/domain/journal/analytics";
import { normalizeMoney, parseDecimal } from "@/domain/money/decimal";
import { normalizeSupabaseNumeric } from "@/lib/supabase/numeric";
import type { Database } from "@/types/database";
import type { TradeDirection, TradeOutcome, TradeStatus, TradingSession } from "@/types/domain";

export type RuleComplianceState = "FULLY_COMPLIANT" | "VIOLATIONS_PRESENT" | "NOT_REVIEWED";

export interface JournalFilters {
  account?: string;
  from?: string;
  to?: string;
  instrument?: string;
  direction?: TradeDirection;
  strategy?: string;
  setup?: string;
  session?: TradingSession;
  status?: TradeStatus;
  outcome?: TradeOutcome;
  grade?: string;
  ruleCompliance?: RuleComplianceState;
  tag?: string;
  search?: string;
  sort?: "date_desc" | "date_asc" | "pnl_desc" | "pnl_asc";
}

export interface JournalTrade {
  id: string;
  accountId: string;
  accountName: string;
  currencyCode: string;
  currencyPrecision: number;
  instrumentId: string;
  instrumentSymbol: string;
  instrumentName: string;
  strategyId: string | null;
  strategyName: string | null;
  setupId: string | null;
  setupName: string | null;
  journalDate: string;
  openedAt: string | null;
  plannedAt: string | null;
  closedAt: string | null;
  createdAt: string;
  direction: TradeDirection;
  session: TradingSession;
  status: TradeStatus;
  outcome: TradeOutcome | null;
  plannedRiskPercentage: string | null;
  plannedRiskAmount: string | null;
  plannedRiskReward: string | null;
  netPnl: string | null;
  actualR: string | null;
  grade: string | null;
  thesis: string | null;
  ruleCompliance: RuleComplianceState;
  ruleViolations: number;
  ruleViolationNames: string[];
  executionRating: number | null;
  revengeTrade: boolean | null;
  fomoInfluenced: boolean | null;
  mistakes: string[];
  tags: Array<{ id: string; name: string; color: string | null }>;
  raw: Database["public"]["Tables"]["trades"]["Row"];
}

export interface JournalDataset {
  trades: JournalTrade[];
  accounts: Array<{ id: string; name: string }>;
  instruments: Array<{ id: string; symbol: string }>;
  strategies: Array<{ id: string; name: string }>;
  setups: Array<{ id: string; name: string; strategyId: string }>;
  tags: Array<{ id: string; name: string; color: string | null }>;
}

function optionalNumeric(value: unknown): string | null {
  return value === null || value === undefined ? null : normalizeSupabaseNumeric(value);
}

function searchMatches(haystack: readonly (string | null | undefined)[], search: string): boolean {
  const tokens = search.toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const text = haystack.filter(Boolean).join(" ").toLocaleLowerCase();
  return tokens.every((token) => text.includes(token));
}

export function matchesJournalFilters(
  trade: Pick<JournalTrade, "accountId" | "journalDate" | "instrumentId" | "direction" | "strategyId" | "setupId" | "session" | "status" | "outcome" | "grade" | "ruleCompliance" | "tags">,
  filters: JournalFilters,
  timezone: string,
  searchValues: readonly (string | null | undefined)[] = [],
): boolean {
  const key = dateKey(trade.journalDate, timezone);
  if (filters.account && trade.accountId !== filters.account) return false;
  if (filters.from && key < filters.from) return false;
  if (filters.to && key > filters.to) return false;
  if (filters.instrument && trade.instrumentId !== filters.instrument) return false;
  if (filters.direction && trade.direction !== filters.direction) return false;
  if (filters.strategy && trade.strategyId !== filters.strategy) return false;
  if (filters.setup && trade.setupId !== filters.setup) return false;
  if (filters.session && trade.session !== filters.session) return false;
  if (filters.status && trade.status !== filters.status) return false;
  if (filters.outcome && trade.outcome !== filters.outcome) return false;
  if (filters.grade && trade.grade !== filters.grade) return false;
  if (filters.ruleCompliance && trade.ruleCompliance !== filters.ruleCompliance) return false;
  if (filters.tag && !trade.tags.some((tag) => tag.id === filters.tag)) return false;
  if (filters.search && !searchMatches(searchValues, filters.search)) return false;
  return true;
}

import type { ReportingRows } from "@/domain/reporting/rows";
import { completedRuleCompliance,validActualR } from "@/domain/reporting/evidence";

export function buildTradeJournalDataset(rows:ReportingRows, filters:JournalFilters={}, timezone=rows.timezone):JournalDataset {
  const tradesResult={data:rows.trades},accountsResult={data:rows.accounts},instrumentsResult={data:rows.instruments},
    strategiesResult={data:rows.strategies},setupsResult={data:rows.setups},reviewsResult={data:rows.reviews},
    executionResult={data:rows.execution},psychologyResult={data:rows.psychology},ruleReviewsResult={data:rows.ruleReviews},
    ruleReviewItemsResult={data:rows.ruleItems},tradeTagsResult={data:rows.tradeTags},tagsResult={data:rows.tags};
  const accounts = accountsResult.data ?? [];
  const instruments = instrumentsResult.data ?? [];
  const strategies = strategiesResult.data ?? [];
  const setups = setupsResult.data ?? [];
  const tags = tagsResult.data ?? [];
  const accountById = new Map(accounts.map((item) => [item.id, item]));
  const instrumentById = new Map(instruments.map((item) => [item.id, item]));
  const strategyById = new Map(strategies.map((item) => [item.id, item]));
  const setupById = new Map(setups.map((item) => [item.id, item]));
  const reviewByTrade = new Map((reviewsResult.data ?? []).map((item) => [item.trade_id, item]));
  const executionByTrade = new Map((executionResult.data ?? []).map((item) => [item.trade_id, item]));
  const psychologyByTrade = new Map((psychologyResult.data ?? []).map((item) => [item.trade_id, item]));
  const tagById = new Map(tags.map((item) => [item.id, item]));
  const tagIdsByTrade = new Map<string, string[]>();
  for (const relation of tradeTagsResult.data ?? []) tagIdsByTrade.set(relation.trade_id, [...(tagIdsByTrade.get(relation.trade_id) ?? []), relation.tag_id]);
  const ruleReviewByTrade = new Map((ruleReviewsResult.data ?? []).map((item) => [item.trade_id, item]));
  const ruleItemsByReview = new Map<string, typeof ruleReviewItemsResult.data>();
  for (const item of ruleReviewItemsResult.data ?? []) ruleItemsByReview.set(item.review_id, [...(ruleItemsByReview.get(item.review_id) ?? []), item]);

  const mapped = (tradesResult.data ?? []).map((trade): JournalTrade | null => {
    const account = accountById.get(trade.account_id);
    const instrument = instrumentById.get(trade.instrument_id);
    if (!account || !instrument) return null;
    const review = reviewByTrade.get(trade.id);
    const strategy = trade.strategy_id ? strategyById.get(trade.strategy_id) : null;
    const setup = trade.setup_id ? setupById.get(trade.setup_id) : null;
    const tradeTags = (tagIdsByTrade.get(trade.id) ?? []).map((id) => tagById.get(id)).filter((tag): tag is NonNullable<typeof tag> => Boolean(tag));
    const execution = executionByTrade.get(trade.id);
    const psychology = psychologyByTrade.get(trade.id);
    const ruleReview = ruleReviewByTrade.get(trade.id);
    const ruleItems = ruleReview ? ruleItemsByReview.get(ruleReview.id) ?? [] : [];
    const violationItems = ruleItems.filter((result) => !result.complied);
    const ruleCompliance: RuleComplianceState = completedRuleCompliance(ruleReview,ruleItems);
    const completeViolations = ruleCompliance === "NOT_REVIEWED" ? [] : violationItems;
    const mistakes = execution?.reviewed_at ? [
      execution.entered_early ? "Early entry" : null,
      execution.entered_late ? "Late entry" : null,
      execution.chased_price ? "Chased price" : null,
      execution.closed_early ? "Early exit" : null,
      execution.over_risked ? "Over-risked" : null,
      execution.revenge_trade ? "Revenge trade" : null,
      execution.stop_action === "WIDENED" ? "Stop widened" : null,
    ].filter((item): item is string => item !== null) : [];
    if (psychology?.reviewed_at && psychology.fomo_influenced) mistakes.push("FOMO");
    if (completeViolations.length) mistakes.push("Rule violation");
    const selectedDate = journalDate({ openedAt: trade.opened_at, plannedAt: trade.planned_at, createdAt: trade.created_at });

    return {
      id: trade.id,
      accountId: account.id,
      accountName: account.name,
      currencyCode: account.currency_code,
      currencyPrecision: account.currency_precision,
      instrumentId: instrument.id,
      instrumentSymbol: instrument.symbol,
      instrumentName: instrument.display_name,
      strategyId: trade.strategy_id,
      strategyName: strategy?.name ?? null,
      setupId: trade.setup_id,
      setupName: setup?.name ?? null,
      journalDate: selectedDate,
      openedAt: trade.opened_at,
      plannedAt: trade.planned_at,
      closedAt: trade.closed_at,
      createdAt: trade.created_at,
      direction: trade.direction,
      session: trade.session,
      status: trade.status,
      outcome: trade.outcome,
      plannedRiskPercentage: optionalNumeric(trade.planned_risk_percentage),
      plannedRiskAmount: trade.planned_risk_amount===null ? null : normalizeMoney(normalizeSupabaseNumeric(trade.planned_risk_amount),account.currency_precision),
      plannedRiskReward: optionalNumeric(trade.planned_risk_reward),
      netPnl: trade.net_pnl===null ? null : normalizeMoney(normalizeSupabaseNumeric(trade.net_pnl),account.currency_precision),
      actualR: validActualR(trade,account.currency_precision),
      grade: review?.reviewed_at ? review.trade_quality_grade : null,
      thesis: trade.thesis,
      ruleCompliance,
      ruleViolations: completeViolations.length,
      ruleViolationNames: completeViolations.map((item) => item.rule_name),
      executionRating: execution?.reviewed_at ? execution.execution_rating : null,
      revengeTrade: execution?.reviewed_at ? execution.revenge_trade : null,
      fomoInfluenced: psychology?.reviewed_at ? psychology.fomo_influenced : null,
      mistakes,
      tags: tradeTags,
      raw: {
        ...trade,
        commission: normalizeSupabaseNumeric(trade.commission),
        swap: normalizeSupabaseNumeric(trade.swap),
        other_fees: normalizeSupabaseNumeric(trade.other_fees),
        trading_credits: normalizeSupabaseNumeric(trade.trading_credits),
        planned_risk_percentage: optionalNumeric(trade.planned_risk_percentage),
        planned_risk_amount: optionalNumeric(trade.planned_risk_amount),
        planned_risk_reward: optionalNumeric(trade.planned_risk_reward),
        net_pnl: optionalNumeric(trade.net_pnl),
        actual_r: optionalNumeric(trade.actual_r),
      },
    };
  }).filter((trade): trade is JournalTrade => trade !== null);

  const filtered = mapped.filter((trade) => matchesJournalFilters(trade, filters, timezone, [
      trade.instrumentSymbol, trade.instrumentName, trade.strategyName, trade.setupName, trade.thesis,
      trade.raw.entry_reason, trade.raw.confirmation_notes, executionByTrade.get(trade.id)?.notes,
      psychologyByTrade.get(trade.id)?.notes, reviewByTrade.get(trade.id)?.what_went_well,
      reviewByTrade.get(trade.id)?.what_went_wrong, reviewByTrade.get(trade.id)?.improvement,
      reviewByTrade.get(trade.id)?.lesson_learned, ...trade.tags.map((tag) => tag.name),
      ...(() => {
        const snapshot = ruleReviewByTrade.get(trade.id);
        return snapshot ? (ruleItemsByReview.get(snapshot.id) ?? []).map((result) => result.notes) : [];
      })(),
    ]));

  filtered.sort((left, right) => {
    if (filters.sort === "date_asc") return left.journalDate.localeCompare(right.journalDate) || left.id.localeCompare(right.id);
    if (filters.sort === "pnl_desc") return parseDecimal(right.netPnl ?? "0").comparedTo(parseDecimal(left.netPnl ?? "0")) || right.id.localeCompare(left.id);
    if (filters.sort === "pnl_asc") return parseDecimal(left.netPnl ?? "0").comparedTo(parseDecimal(right.netPnl ?? "0")) || left.id.localeCompare(right.id);
    return right.journalDate.localeCompare(left.journalDate) || right.id.localeCompare(left.id);
  });

  return {
    trades: filtered,
    accounts: accounts.map(({ id, name }) => ({ id, name })),
    instruments: instruments.map(({ id, symbol }) => ({ id, symbol })),
    strategies: strategies.map(({ id, name }) => ({ id, name })),
    setups: setups.map(({ id, name, strategy_id }) => ({ id, name, strategyId: strategy_id })),
    tags,
  };
}
