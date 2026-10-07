import { describe, expect, it } from "vitest";
import { formatPositionVolume } from "@/domain/trading/volume-display";

describe("presentation-only position volume", () => {
  it.each([
    ["2.7199999999999998", "≈2.72", true],
    ["1.3900000000000001", "≈1.39", true],
    ["0.12345678", "0.12345678", false],
    ["0.123456789", "≈0.12345679", true],
    ["0.000000000000000001", "0.000000000000000001", false],
    ["12345678901234567.12345678", "12345678901234567.12345678", false],
    ["0", "0", false],
    ["-0", "0", false],
    ["1.2300", "1.23", false],
  ])("formats %s without changing its raw evidence", (raw, text, approximate) => {
    expect(formatPositionVolume(raw)).toEqual({ raw, text, approximate });
  });

  it.each(["-0.01", "NaN", "Infinity", "", "not a decimal"])("rejects invalid volume %s", (value) => {
    expect(() => formatPositionVolume(value)).toThrow();
  });
});
