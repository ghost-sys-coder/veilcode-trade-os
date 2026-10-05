import { z } from "zod";
import { normalizeMoney, parseDecimal } from "@/domain/money/decimal";
import { calculateNetPnl, classifyClosedTradeOutcome, type ClosedTradeOutcome } from "@/domain/trades/financials";
import { mt5DealSchema, type Mt5Deal } from "@/domain/mt5/source";

type Direction = "BUY" | "SELL";
type Entry = NonNullable<Mt5Deal["entry"]>;
export type ReconstructionIssueCode = "MISSING_ENTRY_HISTORY" | "UNSUPPORTED_EVENT" | "INCONSISTENT_EXECUTION"
  | "CONFLICTING_SOURCE_REVISION" | "INVALID_REVERSAL_ALLOCATION";
export interface ReconstructionIssue { code: ReconstructionIssueCode; positionId: string | null; dealTickets: string[] }
export interface FinancialAllocation {
  dealTicket: string;
  part: "OPEN" | "CLOSE";
  volume: string;
  grossPnl: string;
  commission: string;
  swap: string;
  fee: string;
  convention: "BROKER_FACT" | "PROPORTIONAL_VOLUME" | "EXPLICIT_BROKER_ALLOCATION";
}
export interface Mt5Episode {
  canonicalIdentity: string;
  positionId: string;
  openingDealTicket: string;
  direction: Direction;
  symbol: string;
  status: "OPEN" | "CLOSED";
  openedAt: string;
  closedAt: string | null;
  openedVolume: string;
  remainingVolume: string;
  entryPrice: string;
  exitPrice: string | null;
  grossPnl: string;
  commission: string;
  swap: string;
  otherFees: string;
  tradingCredits: string;
  finalNetPnl: string | null;
  outcome: ClosedTradeOutcome | null;
  usedPartialExits: boolean;
  // Broker cash recognized on an OPEN episode belongs in reconciliation, not analytics.
  recognizedCash: string;
  allocations: FinancialAllocation[];
  // No plan, risk or behavioral review is inferred by this reconstruction.
}
export interface ReconstructionResult { episodes: Mt5Episode[]; issues: ReconstructionIssue[]; cashMovements: Mt5Deal[] }

class PositionIssue extends Error {
  constructor(readonly code: ReconstructionIssueCode) { super(code); }
}
const zero = () => parseDecimal("0");
type Decimal = ReturnType<typeof parseDecimal>;
interface MutableEpisode {
  first: Mt5Deal; direction: Direction; remaining: Decimal; opened: Decimal; exited: Decimal;
  entryNotional: Decimal; exitNotional: Decimal; closedAt: string | null;
  partial: boolean; allocations: FinancialAllocation[];
}

function addAllocation(episode: MutableEpisode, deal: Mt5Deal, part: "OPEN" | "CLOSE", volume: Decimal,
  commission = deal.commission, fee = deal.fee, convention: FinancialAllocation["convention"] = "BROKER_FACT") {
  episode.allocations.push({ dealTicket: deal.ticket, part, volume: volume.toString(), commission, fee, convention,
    grossPnl: part === "CLOSE" ? deal.profit : "0", swap: part === "CLOSE" ? deal.swap : "0" });
}
function openEpisode(deal: Mt5Deal, volume: Decimal): MutableEpisode {
  return { first: deal, direction: deal.type as Direction, remaining: volume, opened: volume, exited: zero(),
    entryNotional: parseDecimal(deal.price).times(volume), exitNotional: zero(), closedAt: null, partial: false, allocations: [] };
}
function closeVolume(episode: MutableEpisode, deal: Mt5Deal, volume: Decimal) {
  if (volume.lt(episode.remaining)) episode.partial = true;
  episode.remaining = episode.remaining.minus(volume);
  episode.exited = episode.exited.plus(volume);
  episode.exitNotional = episode.exitNotional.plus(parseDecimal(deal.price).times(volume));
  if (episode.remaining.isZero()) episode.closedAt = deal.occurredAt;
}

function finalize(episode: MutableEpisode, connectionId: string, currencyPrecision: number): Mt5Episode {
  let gross = zero(), commission = zero(), swap = zero(), fees = zero(), credits = zero();
  for (const allocation of episode.allocations) {
    gross = gross.plus(allocation.grossPnl);
    for (const [value, kind] of [[allocation.commission,"commission"],[allocation.swap,"swap"],[allocation.fee,"fee"]] as const) {
      const signed = parseDecimal(value);
      if (signed.gt(0)) credits = credits.plus(signed);
      else if (kind === "commission") commission = commission.minus(signed);
      else if (kind === "swap") swap = swap.minus(signed);
      else fees = fees.minus(signed);
    }
  }
  const cash = calculateNetPnl({ grossPnl: gross, commission, swap, otherFees: fees, tradingCredits: credits, currencyPrecision });
  const closed = episode.closedAt !== null;
  return {
    canonicalIdentity: `${connectionId}:${episode.first.positionId}:${episode.first.ticket}:${episode.direction}`,
    positionId: episode.first.positionId!, openingDealTicket: episode.first.ticket,
    direction: episode.direction, symbol: episode.first.symbol!, status: closed ? "CLOSED" : "OPEN",
    openedAt: episode.first.occurredAt, closedAt: episode.closedAt,
    openedVolume: episode.opened.toString(), remainingVolume: episode.remaining.toString(),
    entryPrice: episode.entryNotional.div(episode.opened).toString(),
    exitPrice: episode.exited.gt(0) ? episode.exitNotional.div(episode.exited).toString() : null,
    grossPnl: gross.toString(), commission: commission.toString(), swap: swap.toString(), otherFees: fees.toString(), tradingCredits: credits.toString(),
    finalNetPnl: closed ? cash : null, outcome: closed ? classifyClosedTradeOutcome(cash,currencyPrecision,episode.partial) : null,
    usedPartialExits: episode.partial, recognizedCash: cash, allocations: episode.allocations,
  };
}

function splitReversal(deal: Mt5Deal, closing: Decimal, total: Decimal) {
  const explicit = deal.reversalAllocation;
  if (explicit) {
    if (!parseDecimal(explicit.closingCommission).plus(explicit.openingCommission).eq(deal.commission)
      || !parseDecimal(explicit.closingFee).plus(explicit.openingFee).eq(deal.fee)) throw new PositionIssue("INVALID_REVERSAL_ALLOCATION");
    return { closingCommission: explicit.closingCommission, openingCommission: explicit.openingCommission,
      closingFee: explicit.closingFee, openingFee: explicit.openingFee, convention: "EXPLICIT_BROKER_ALLOCATION" as const };
  }
  const closingCommission = parseDecimal(deal.commission).times(closing).div(total);
  const closingFee = parseDecimal(deal.fee).times(closing).div(total);
  return { closingCommission: closingCommission.toString(), openingCommission: parseDecimal(deal.commission).minus(closingCommission).toString(),
    closingFee: closingFee.toString(), openingFee: parseDecimal(deal.fee).minus(closingFee).toString(), convention: "PROPORTIONAL_VOLUME" as const };
}

function reconstructPosition(deals: Mt5Deal[], connectionId: string, precision: number, mode: "NETTING" | "HEDGING"): Mt5Episode[] {
  const finished: MutableEpisode[] = [];
  let current: MutableEpisode | undefined;
  let symbol: string | undefined;
  for (const deal of deals) {
    const entry = deal.entry as Entry | null;
    if (!["BUY","SELL"].includes(deal.type) || !deal.symbol || !entry) throw new PositionIssue("UNSUPPORTED_EVENT");
    if (symbol && symbol !== deal.symbol) throw new PositionIssue("INCONSISTENT_EXECUTION");
    symbol = deal.symbol;
    const volume = parseDecimal(deal.volume);
    if (volume.lte(0)) throw new PositionIssue("INCONSISTENT_EXECUTION");
    if (deal.reversalAllocation && entry !== "INOUT") throw new PositionIssue("INVALID_REVERSAL_ALLOCATION");
    if (entry === "IN") {
      if (!parseDecimal(deal.profit).isZero() || !parseDecimal(deal.swap).isZero()) throw new PositionIssue("UNSUPPORTED_EVENT");
      if (!current) current = openEpisode(deal,volume);
      else {
        if (current.direction !== deal.type) throw new PositionIssue("INCONSISTENT_EXECUTION");
        current.remaining = current.remaining.plus(volume);
        current.opened = current.opened.plus(volume);
        current.entryNotional = current.entryNotional.plus(parseDecimal(deal.price).times(volume));
      }
      addAllocation(current,deal,"OPEN",volume);
      continue;
    }
    if (!current) throw new PositionIssue("MISSING_ENTRY_HISTORY");
    if (current.direction === deal.type) throw new PositionIssue("INCONSISTENT_EXECUTION");
    if (entry === "INOUT") {
      if (mode !== "NETTING" || volume.lte(current.remaining)) throw new PositionIssue("INCONSISTENT_EXECUTION");
      const closing = current.remaining, opening = volume.minus(closing);
      const split = splitReversal(deal,closing,volume);
      closeVolume(current,deal,closing);
      addAllocation(current,deal,"CLOSE",closing,split.closingCommission,split.closingFee,split.convention);
      finished.push(current);
      current = openEpisode(deal,opening);
      addAllocation(current,deal,"OPEN",opening,split.openingCommission,split.openingFee,split.convention);
    } else {
      if ((entry === "OUT_BY" && mode !== "HEDGING") || volume.gt(current.remaining)) throw new PositionIssue("INCONSISTENT_EXECUTION");
      closeVolume(current,deal,volume);
      addAllocation(current,deal,"CLOSE",volume);
      if (current.remaining.isZero()) { finished.push(current); current = undefined; }
    }
  }
  if (current) finished.push(current);
  return finished.map(episode => finalize(episode,connectionId,precision));
}

/** Takes the latest durable revision of each deal. Never resolve competing revisions by arrival order. */
export function reconstructMt5Deals(input: { connectionId: string; currencyPrecision: number; positionMode: "NETTING" | "HEDGING"; deals: unknown }): ReconstructionResult {
  z.string().uuid().parse(input.connectionId);
  z.enum(["NETTING","HEDGING"]).parse(input.positionMode);
  normalizeMoney("0",input.currencyPrecision);
  const deals = z.array(mt5DealSchema).max(100_000).parse(input.deals);
  const groups = new Map<string,Mt5Deal[]>(), unique = new Map<string,Mt5Deal>();
  const conflicting = new Set<string>();
  const issues: ReconstructionIssue[] = [], cashMovements: Mt5Deal[] = [];
  for (const deal of deals) {
    const previous = unique.get(deal.ticket);
    if (previous && JSON.stringify(previous) !== JSON.stringify(deal)) {
      if (previous.positionId) conflicting.add(previous.positionId);
      if (deal.positionId) conflicting.add(deal.positionId);
      issues.push({ code: "CONFLICTING_SOURCE_REVISION", positionId: deal.positionId, dealTickets: [deal.ticket] });
    } else if (!previous) unique.set(deal.ticket,deal);
  }
  for (const deal of unique.values()) {
    if (!deal.positionId) {
      if (["BUY","SELL","BUY_CANCELED","SELL_CANCELED"].includes(deal.type)) issues.push({ code: "MISSING_ENTRY_HISTORY", positionId: null, dealTickets: [deal.ticket] });
      else cashMovements.push(deal); // Includes CREDIT; requires classification, never automatic profit/funding.
    } else {
      const group = groups.get(deal.positionId);
      if (group) group.push(deal);
      else groups.set(deal.positionId,[deal]);
    }
  }
  const episodes: Mt5Episode[] = [];
  for (const [positionId,positionDeals] of groups) {
    if (conflicting.has(positionId)) continue;
    positionDeals.sort((a,b) => a.occurredAt.localeCompare(b.occurredAt) || (BigInt(a.ticket) < BigInt(b.ticket) ? -1 : 1));
    try { episodes.push(...reconstructPosition(positionDeals,input.connectionId,input.currencyPrecision,input.positionMode)); }
    catch (error) {
      if (!(error instanceof PositionIssue)) throw error;
      issues.push({ code: error.code, positionId, dealTickets: positionDeals.map(deal => deal.ticket) });
    }
  }
  return { episodes: episodes.sort((a,b) => a.openedAt.localeCompare(b.openedAt) || a.canonicalIdentity.localeCompare(b.canonicalIdentity)), issues, cashMovements };
}
