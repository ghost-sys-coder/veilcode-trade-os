import { describe, expect, it } from "vitest";

import { mapCsvRow, parseCsv, validateCsvMapping, type CsvColumnMapping } from "@/domain/imports/csv";
import { classifyImportMatch, importDeduplicationKey, type ImportIdentity } from "@/domain/imports/provenance";

const mapping: CsvColumnMapping = {
  externalTradeId: "Ticket",
  symbol: "Symbol",
  direction: "Side",
  openedAt: "Opened",
  closedAt: "Closed",
  actualEntry: "Entry",
  actualExit: "Exit",
  actualLotSize: "Lots",
  commission: "Commission",
  swap: "Swap",
  netPnl: "Net PnL",
};

describe("Phase 07 CSV staging", () => {
  it("parses quoted commas, escaped quotes, and CRLF rows", () => {
    const parsed = parseCsv('Ticket,Symbol,Note\r\n42,EURUSD,"Breakout, then ""retest"""\r\n');
    expect(parsed.headers).toEqual(["Ticket", "Symbol", "Note"]);
    expect(parsed.rows[0]).toMatchObject({
      rowNumber: 2,
      values: { Ticket: "42", Symbol: "EURUSD", Note: 'Breakout, then "retest"' },
      structuralErrors: [],
    });
  });

  it("rejects malformed CSV and ambiguous headers", () => {
    expect(() => parseCsv('Ticket,Symbol\n1,"EURUSD')).toThrow("unterminated");
    expect(() => parseCsv("Ticket,ticket\n1,2")).toThrow("unique");
  });

  it("requires an explicit canonical mapping with no reused columns", () => {
    expect(validateCsvMapping(["Symbol"], { symbol: "Symbol", direction: "Symbol" })).toContain("openedAt must be mapped.");
    expect(validateCsvMapping(["Symbol"], { symbol: "Symbol", direction: "Symbol" })).toContain("Symbol cannot be mapped to more than one canonical field.");
  });

  it("normalizes valid decimal strings without JavaScript number arithmetic", () => {
    const parsed = parseCsv([
      "Ticket,Symbol,Side,Opened,Closed,Entry,Exit,Lots,Commission,Swap,Net PnL",
      "T-1,EURUSD,BUY,2026-09-01T08:00:00Z,2026-09-01T09:00:00Z,1.10000,1.10100,0.10,2.50,0,97.50",
    ].join("\n"));
    expect(validateCsvMapping(parsed.headers, mapping)).toEqual([]);
    expect(mapCsvRow(parsed.rows[0], mapping)).toMatchObject({
      valid: true,
      trade: { externalTradeId: "T-1", actualEntry: "1.1", actualLotSize: "0.1", commission: "2.5", netPnl: "97.5" },
    });
  });

  it("keeps invalid fees and row-shape errors out of canonical data", () => {
    const parsed = parseCsv([
      "Ticket,Symbol,Side,Opened,Closed,Entry,Exit,Lots,Commission,Swap,Net PnL",
      "T-1,EURUSD,BUY,2026-09-01T08:00:00Z,2026-09-01T09:00:00Z,1.1,1.2,0.1,-2,0,100,EXTRA",
    ].join("\n"));
    const result = mapCsvRow(parsed.rows[0], mapping);
    expect(result.valid).toBe(false);
    if (result.valid) return;
    expect(result.errors).toContain("Expected 11 columns but found 12.");
    expect(result.errors).toContain("commission cannot be negative. Convert broker fee signs during mapping before import.");
  });
});

describe("Phase 07 import provenance", () => {
  const incoming: ImportIdentity = {
    accountId: "account-1",
    sourceType: "CSV",
    externalTradeId: "Ticket-42",
    symbol: "EURUSD",
    direction: "BUY",
    openedAt: "2026-09-01T08:00:00.000Z",
    closedAt: "2026-09-01T09:00:00.000Z",
  };

  it("uses a reliable external identifier as the deterministic primary key", () => {
    expect(importDeduplicationKey(incoming)).toBe("account-1:CSV:trade:ticket-42");
    expect(classifyImportMatch(incoming, [{ ...incoming, id: "trade-1" }])).toEqual({
      kind: "DUPLICATE",
      matchedTradeId: "trade-1",
      deduplicationKey: "account-1:CSV:trade:ticket-42",
    });
  });

  it("flags a timestamp-and-symbol match to manual data for review rather than overwriting it", () => {
    const match = classifyImportMatch(incoming, [{
      id: "manual-1",
      accountId: incoming.accountId,
      sourceType: "MANUAL",
      symbol: incoming.symbol,
      direction: incoming.direction,
      openedAt: incoming.openedAt,
      closedAt: incoming.closedAt,
    }]);
    expect(match).toMatchObject({ kind: "CONFLICT", matchedTradeId: "manual-1" });
  });

  it("does not treat a timestamp-and-symbol match from the same source as a duplicate when strong IDs differ", () => {
    const match = classifyImportMatch(incoming, [{
      ...incoming,
      id: "csv-2",
      externalTradeId: "Ticket-99",
    }]);
    expect(match.kind).toBe("CONFLICT");
  });
  it("MT5 repeated position/order IDs do not collapse different directional episodes", () => {
    const trade = { ...incoming,sourceType: "MT5" as const,sourceConnectionId: "connection-1",sourceEpisodeId: "100:1:BUY",
      externalPositionId: "100",externalOrderId: "42" };
    expect(classifyImportMatch({ ...trade,sourceEpisodeId: "100:2:SELL",direction: "SELL" },[{ ...trade,id: "episode-1" }]).kind).toBe("NONE");
    expect(classifyImportMatch(trade,[{ ...trade,id: "episode-1" }]).kind).toBe("DUPLICATE");
  });
  it("MT5 reused tickets across connections remain separate even in one account", () => {
    const trade = { ...incoming,sourceType: "MT5" as const,sourceConnectionId: "connection-1",sourceEpisodeId: "100:1:BUY" };
    expect(classifyImportMatch({ ...trade,sourceConnectionId: "connection-2",openedAt: "2026-09-02T08:00:00.000Z" },[{ ...trade,id: "episode-1" }]).kind).toBe("NONE");
  });
  it("legacy unqualified MT5 IDs yield review conflicts, not automatic duplicate decisions", () => {
    const trade = { ...incoming,sourceType: "MT5" as const,externalPositionId: "100" };
    expect(classifyImportMatch(trade,[{ ...trade,id: "legacy-1" }]).kind).toBe("CONFLICT");
    expect(importDeduplicationKey(trade)).toMatch(/^fallback:/);
  });
  it("non-MT5 import sources retain strong raw-position matching", () => {
    const trade = { ...incoming,sourceType: "MT4" as const,externalTradeId: null,externalPositionId: "100" };
    expect(classifyImportMatch(trade,[{ ...trade,id: "mt4-1" }])).toMatchObject({ kind: "DUPLICATE",deduplicationKey: "account-1:MT4:position:100" });
  });
});
