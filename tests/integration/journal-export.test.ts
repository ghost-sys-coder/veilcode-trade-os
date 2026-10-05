import { describe,expect,it,vi } from "vitest";
const fixture = vi.hoisted(() => ({ dataset: vi.fn<(...args: unknown[]) => Promise<unknown>>(async () => ({ trades: [
  { id: "trade-fixture",accountName: "Demo",currencyCode: "USD",currencyPrecision: 2,instrumentSymbol: "EURUSD",direction: "BUY",status: "CLOSED",outcome: "PARTIAL_WIN",tags: [],
    raw: { source_type: "MT5",external_trade_id: "connection:100:10:BUY",external_order_id: "900",external_position_id: "100",
      mt5_connection_id: "connection",mt5_opening_deal_ticket: "10",mt5_used_partial_exits: true,
      gross_pnl: "100",commission: "3",swap: "0",other_fees: "0",trading_credits: "1",net_pnl: "98" } },
] })) }));
vi.mock("@/lib/auth",() => ({ requireUserId: vi.fn(async () => "owner-fixture") }));
vi.mock("@/lib/supabase/server",() => ({ createClient: vi.fn(async () => ({ from: () => ({ select: () => ({ maybeSingle: async () => ({ data: { timezone: "UTC" } }) }) }) })) }));
vi.mock("@/services/journal/get-trade-journal",() => ({ getTradeJournalDataset: fixture.dataset }));
import { GET } from "@/app/(app)/trades/export/route";

describe("canonical MT5 journal export", () => {
  it("includes credits and directional identity for independent financial analysis", async () => {
    const response = await GET(new Request("https://trade.example/trades/export?account=selected&search=EUR&page=2"));
    const [header,line] = (await response.text()).replace(/^\uFEFF/,"").split("\r\n");
    const fields = header.split(","),values = line.split(",");
    expect(values).toHaveLength(fields.length);
    for (const [field,value] of Object.entries({ trading_credits: "1",net_pnl: "98",external_position_id: "100",mt5_opening_deal_ticket: "10",mt5_used_partial_exits: "true" })) {
      expect(values[fields.indexOf(field)]).toBe(value);
    }
    expect(fixture.dataset.mock.calls[0]).toEqual(expect.arrayContaining([expect.objectContaining({ account: "selected",search: "EUR" })]));
    // Pagination is not an export filter; service returns all matching trades.
    expect(fixture.dataset.mock.calls[0][1]).not.toHaveProperty("page");
  });
});
