import { parseDecimal } from "@/domain/money/decimal";
import type { TradeDirection } from "@/types/domain";

export const CSV_IMPORT_FIELDS = [
  "externalTradeId",
  "externalOrderId",
  "externalPositionId",
  "symbol",
  "direction",
  "openedAt",
  "closedAt",
  "actualEntry",
  "actualExit",
  "actualStopLoss",
  "plannedTakeProfit",
  "actualLotSize",
  "grossPnl",
  "commission",
  "swap",
  "otherFees",
  "netPnl",
] as const;

export type CsvImportField = (typeof CSV_IMPORT_FIELDS)[number];
export type CsvColumnMapping = Partial<Record<CsvImportField, string>>;

export interface CsvRow {
  rowNumber: number;
  values: Record<string, string>;
  structuralErrors: string[];
}

export interface CsvParseResult {
  headers: string[];
  rows: CsvRow[];
}

export interface CanonicalCsvTrade {
  externalTradeId: string | null;
  externalOrderId: string | null;
  externalPositionId: string | null;
  symbol: string;
  direction: TradeDirection;
  openedAt: string;
  closedAt: string;
  actualEntry: string;
  actualExit: string;
  actualStopLoss: string | null;
  plannedTakeProfit: string | null;
  actualLotSize: string;
  grossPnl: string | null;
  commission: string;
  swap: string;
  otherFees: string;
  netPnl: string;
}

export type CsvMappedRow =
  | { valid: true; rowNumber: number; trade: CanonicalCsvTrade }
  | { valid: false; rowNumber: number; errors: string[] };

export class CsvParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CsvParseError";
  }
}

function pushRow(rows: string[][], row: string[], cell: string): void {
  const completed = [...row, cell];
  if (completed.some((value) => value.length > 0)) rows.push(completed);
}

export function parseCsv(text: string): CsvParseResult {
  if (!text.trim()) throw new CsvParseError("The CSV file is empty.");

  const matrix: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"') {
        if (text[index + 1] === '"') {
          cell += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        cell += character;
      }
      continue;
    }

    if (character === '"') {
      if (cell.length > 0) throw new CsvParseError("A quoted value must begin at the start of a field.");
      quoted = true;
    } else if (character === ",") {
      row.push(cell);
      cell = "";
    } else if (character === "\n" || character === "\r") {
      if (character === "\r" && text[index + 1] === "\n") index += 1;
      pushRow(matrix, row, cell);
      row = [];
      cell = "";
    } else {
      cell += character;
    }
  }

  if (quoted) throw new CsvParseError("The CSV contains an unterminated quoted value.");
  pushRow(matrix, row, cell);
  if (matrix.length < 2) throw new CsvParseError("The CSV must contain a header and at least one data row.");

  const headers = matrix[0].map((value, index) => (index === 0 ? value.replace(/^\uFEFF/, "") : value).trim());
  if (headers.some((header) => !header)) throw new CsvParseError("CSV headers cannot be blank.");
  const normalizedHeaders = headers.map((header) => header.toLocaleLowerCase("en-US"));
  if (new Set(normalizedHeaders).size !== normalizedHeaders.length) {
    throw new CsvParseError("CSV headers must be unique, ignoring letter case.");
  }

  const rows = matrix.slice(1).map((values, index): CsvRow => {
    const structuralErrors = values.length === headers.length
      ? []
      : [`Expected ${headers.length} columns but found ${values.length}.`];
    return {
      rowNumber: index + 2,
      values: Object.fromEntries(headers.map((header, headerIndex) => [header, values[headerIndex] ?? ""])),
      structuralErrors,
    };
  });

  return { headers, rows };
}

const requiredFields: readonly CsvImportField[] = [
  "symbol",
  "direction",
  "openedAt",
  "closedAt",
  "actualEntry",
  "actualExit",
  "actualLotSize",
  "netPnl",
];

export function validateCsvMapping(headers: readonly string[], mapping: CsvColumnMapping): string[] {
  const errors: string[] = [];
  const headerSet = new Set(headers);
  const usedHeaders = new Set<string>();
  for (const field of requiredFields) {
    if (!mapping[field]) errors.push(`${field} must be mapped.`);
  }
  for (const [field, header] of Object.entries(mapping)) {
    if (!headerSet.has(header)) errors.push(`${field} maps to a column that does not exist.`);
    if (usedHeaders.has(header)) errors.push(`${header} cannot be mapped to more than one canonical field.`);
    usedHeaders.add(header);
  }
  return errors;
}

function optional(record: Record<string, string>, mapping: CsvColumnMapping, field: CsvImportField): string | null {
  const header = mapping[field];
  const value = header ? record[header]?.trim() : "";
  return value || null;
}

function decimal(value: string | null, label: string, errors: string[], fallback?: string): string | null {
  const candidate = value ?? fallback;
  if (candidate === undefined) return null;
  try {
    return parseDecimal(candidate).toString();
  } catch {
    errors.push(`${label} must be a valid decimal value.`);
    return null;
  }
}

function nonNegativeDecimal(value: string | null, label: string, errors: string[], fallback?: string): string | null {
  const parsed = decimal(value, label, errors, fallback);
  if (parsed !== null && parseDecimal(parsed).lt(0)) {
    errors.push(`${label} cannot be negative. Convert broker fee signs during mapping before import.`);
    return null;
  }
  return parsed;
}

function isoTimestamp(value: string | null, label: string, errors: string[]): string {
  if (!value || !/^\d{4}-\d{2}-\d{2}T/.test(value) || Number.isNaN(Date.parse(value))) {
    errors.push(`${label} must be an ISO 8601 timestamp with an explicit date and time.`);
    return "";
  }
  return new Date(value).toISOString();
}

export function mapCsvRow(row: CsvRow, mapping: CsvColumnMapping): CsvMappedRow {
  const errors = [...row.structuralErrors];
  const symbol = optional(row.values, mapping, "symbol")?.toLocaleUpperCase("en-US") ?? "";
  if (!/^[A-Z0-9._/-]{2,20}$/.test(symbol)) errors.push("symbol is missing or invalid.");
  const directionValue = optional(row.values, mapping, "direction")?.toLocaleUpperCase("en-US") ?? "";
  if (directionValue !== "BUY" && directionValue !== "SELL") errors.push("direction must be BUY or SELL.");
  const openedAt = isoTimestamp(optional(row.values, mapping, "openedAt"), "openedAt", errors);
  const closedAt = isoTimestamp(optional(row.values, mapping, "closedAt"), "closedAt", errors);
  if (openedAt && closedAt && closedAt < openedAt) errors.push("closedAt cannot be before openedAt.");

  const actualEntry = decimal(optional(row.values, mapping, "actualEntry"), "actualEntry", errors);
  const actualExit = decimal(optional(row.values, mapping, "actualExit"), "actualExit", errors);
  const actualLotSize = nonNegativeDecimal(optional(row.values, mapping, "actualLotSize"), "actualLotSize", errors);
  const netPnl = decimal(optional(row.values, mapping, "netPnl"), "netPnl", errors);
  const actualStopLoss = decimal(optional(row.values, mapping, "actualStopLoss"), "actualStopLoss", errors);
  const plannedTakeProfit = decimal(optional(row.values, mapping, "plannedTakeProfit"), "plannedTakeProfit", errors);
  const grossPnl = decimal(optional(row.values, mapping, "grossPnl"), "grossPnl", errors);
  const commission = nonNegativeDecimal(optional(row.values, mapping, "commission"), "commission", errors, "0");
  const swap = nonNegativeDecimal(optional(row.values, mapping, "swap"), "swap", errors, "0");
  const otherFees = nonNegativeDecimal(optional(row.values, mapping, "otherFees"), "otherFees", errors, "0");

  if (errors.length || actualEntry === null || actualExit === null || actualLotSize === null || netPnl === null
    || commission === null || swap === null || otherFees === null) {
    return { valid: false, rowNumber: row.rowNumber, errors };
  }

  return {
    valid: true,
    rowNumber: row.rowNumber,
    trade: {
      externalTradeId: optional(row.values, mapping, "externalTradeId"),
      externalOrderId: optional(row.values, mapping, "externalOrderId"),
      externalPositionId: optional(row.values, mapping, "externalPositionId"),
      symbol,
      direction: directionValue as TradeDirection,
      openedAt,
      closedAt,
      actualEntry,
      actualExit,
      actualStopLoss,
      plannedTakeProfit,
      actualLotSize,
      grossPnl,
      commission,
      swap,
      otherFees,
      netPnl,
    },
  };
}
