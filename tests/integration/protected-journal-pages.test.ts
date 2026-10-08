import { beforeEach, describe, expect, it, vi } from "vitest";

const boundary = vi.hoisted(() => ({
  authenticate: vi.fn<() => Promise<string>>(),
  client: vi.fn(), from: vi.fn(), dataset: vi.fn(), analytics: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({ requireUserId: boundary.authenticate }));
vi.mock("@/lib/supabase/server", () => ({ createClient: boundary.client }));
vi.mock("@/services/journal/get-trade-journal", () => ({ getTradeJournalDataset: boundary.dataset }));
vi.mock("@/services/analytics/get-performance-analytics", () => ({ getPerformanceAnalytics: boundary.analytics }));

import DailyPage from "@/app/(app)/journal/daily/page";
import WeeklyPage from "@/app/(app)/journal/weekly/page";
import MonthlyPage from "@/app/(app)/journal/monthly/page";
import CalendarPage from "@/app/(app)/calendar/page";
import TradesPage from "@/app/(app)/trades/page";
import AnalyticsPage from "@/app/(app)/analytics/[view]/page";

const checkpoint = new Error("AUTHORIZED_READ_CHECKPOINT");
const pages = [
  { name: "daily journal", invoke: () => DailyPage({ searchParams: Promise.resolve({}) }) },
  { name: "weekly journal", invoke: () => WeeklyPage({ searchParams: Promise.resolve({}) }) },
  { name: "monthly journal", invoke: () => MonthlyPage({ searchParams: Promise.resolve({}) }) },
  { name: "calendar", invoke: () => CalendarPage({ searchParams: Promise.resolve({}) }) },
  { name: "trade list", invoke: () => TradesPage({ searchParams: Promise.resolve({}) }) },
  { name: "analytics", invoke: () => AnalyticsPage({ params: Promise.resolve({ view: "overview" }), searchParams: Promise.resolve({}) }) },
];

beforeEach(() => {
  vi.resetAllMocks();
  boundary.authenticate.mockResolvedValue("verified-owner");
  boundary.client.mockResolvedValue({ from: boundary.from });
  boundary.from.mockReturnValue({ select: () => ({ maybeSingle: async () => ({ data: { timezone: "UTC" }, error: null }) }) });
  boundary.dataset.mockRejectedValue(checkpoint);
  boundary.analytics.mockRejectedValue(checkpoint);
});

function expectNoProtectedReads() {
  expect(boundary.client).not.toHaveBeenCalled();
  expect(boundary.from).not.toHaveBeenCalled();
  expect(boundary.dataset).not.toHaveBeenCalled();
  expect(boundary.analytics).not.toHaveBeenCalled();
}

describe.each(pages)("$name authentication ordering", ({ invoke }) => {
  it("stops before creating the data client when sign-in is denied", async () => {
    const redirect = new Error("NEXT_REDIRECT_TO_LOGIN");
    boundary.authenticate.mockRejectedValueOnce(redirect);
    await expect(invoke()).rejects.toBe(redirect);
    expect(boundary.authenticate).toHaveBeenCalledOnce();
    expectNoProtectedReads();
  });

  it("does not race protected reads against pending authentication", async () => {
    let complete: ((owner: string) => void) | undefined;
    boundary.authenticate.mockReturnValueOnce(new Promise<string>(resolve => { complete = resolve; }));
    const result = invoke().then(() => null, error => error);
    await Promise.resolve();
    await Promise.resolve();
    expectNoProtectedReads();
    complete?.("verified-owner");
    expect(await result).toBe(checkpoint);
    expect(boundary.client).toHaveBeenCalledOnce();
  });

  it("continues the existing read workflow after successful authentication", async () => {
    await expect(invoke()).rejects.toBe(checkpoint);
    expect(boundary.authenticate).toHaveBeenCalledOnce();
    expect(boundary.client).toHaveBeenCalledOnce();
    expect(boundary.authenticate.mock.invocationCallOrder[0]).toBeLessThan(boundary.client.mock.invocationCallOrder[0]);
    expect(boundary.dataset.mock.calls.length + boundary.analytics.mock.calls.length).toBe(1);
  });
});
