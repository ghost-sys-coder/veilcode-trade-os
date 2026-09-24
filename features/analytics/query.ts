import type { AnalyticsFilters } from "@/services/analytics/get-performance-analytics";
import { ACCOUNT_TYPES, TRADE_DIRECTIONS, TRADING_SESSIONS } from "@/types/domain";

export type RawSearchParams = Record<string, string | string[] | undefined>;

function single(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function date(value: string | undefined): string | undefined {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : undefined;
}

export function parseAnalyticsFilters(params: RawSearchParams): AnalyticsFilters {
  const session = single(params.session);
  const direction = single(params.direction);
  const accountType = single(params.accountType);
  return {
    account: single(params.account) || undefined,
    from: date(single(params.from)),
    to: date(single(params.to)),
    instrument: single(params.instrument) || undefined,
    strategy: single(params.strategy) || undefined,
    setup: single(params.setup) || undefined,
    session: TRADING_SESSIONS.includes(session as (typeof TRADING_SESSIONS)[number]) ? session as AnalyticsFilters["session"] : undefined,
    direction: TRADE_DIRECTIONS.includes(direction as (typeof TRADE_DIRECTIONS)[number]) ? direction as AnalyticsFilters["direction"] : undefined,
    accountType: ACCOUNT_TYPES.includes(accountType as (typeof ACCOUNT_TYPES)[number]) ? accountType as AnalyticsFilters["accountType"] : undefined,
    reviewSearch: single(params.reviewSearch)?.trim() || undefined,
  };
}

export function serializeAnalyticsFilters(filters: AnalyticsFilters): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value) query.set(key, value);
  }
  return query.toString();
}
