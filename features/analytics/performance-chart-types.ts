import type { AccountCurvePoint } from "@/domain/analytics/performance";

export interface PerformanceChartsProps {
  points: AccountCurvePoint[];
  currencyCode: string;
  currencyPrecision: number;
}
