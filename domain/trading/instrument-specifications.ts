export const SUPPORTED_ACCOUNT_CURRENCIES = ["USD", "EUR", "GBP", "AUD", "CAD", "CHF", "NZD", "JPY"] as const;

export type SupportedAccountCurrency = (typeof SUPPORTED_ACCOUNT_CURRENCIES)[number];

export interface InstrumentSpecification {
  symbol: string;
  displayName: string;
  baseCurrency: string;
  quoteCurrency: string;
  contractSize: string;
  pipSize: string;
  pricePrecision: number;
  volumeMin: string;
  volumeMax: string;
  volumeStep: string;
}

const fx = (symbol: string, baseCurrency: string, quoteCurrency: string, pipSize = "0.0001", pricePrecision = 5): InstrumentSpecification => ({
  symbol,
  displayName: `${baseCurrency} / ${quoteCurrency}`,
  baseCurrency,
  quoteCurrency,
  contractSize: "100000",
  pipSize,
  pricePrecision,
  volumeMin: "0.01",
  volumeMax: "100",
  volumeStep: "0.01",
});

export const INSTRUMENT_SPECIFICATIONS: readonly InstrumentSpecification[] = [
  fx("EURUSD", "EUR", "USD"),
  fx("GBPUSD", "GBP", "USD"),
  fx("USDJPY", "USD", "JPY", "0.01", 3),
  fx("USDCHF", "USD", "CHF"),
  fx("USDCAD", "USD", "CAD"),
  fx("EURJPY", "EUR", "JPY", "0.01", 3),
  fx("GBPJPY", "GBP", "JPY", "0.01", 3),
  fx("EURGBP", "EUR", "GBP"),
  fx("GBPCHF", "GBP", "CHF"),
  fx("CADJPY", "CAD", "JPY", "0.01", 3),
  {
    symbol: "XAUUSD",
    displayName: "Gold / US Dollar",
    baseCurrency: "XAU",
    quoteCurrency: "USD",
    contractSize: "100",
    pipSize: "0.01",
    pricePrecision: 2,
    volumeMin: "0.01",
    volumeMax: "100",
    volumeStep: "0.01",
  },
] as const;

export const CURRENCY_PRECISION: Record<SupportedAccountCurrency, number> = {
  USD: 2, EUR: 2, GBP: 2, AUD: 2, CAD: 2, CHF: 2, NZD: 2, JPY: 0,
};

export function getInstrumentSpecification(symbol: string): InstrumentSpecification | undefined {
  return INSTRUMENT_SPECIFICATIONS.find((instrument) => instrument.symbol === symbol.toUpperCase());
}
