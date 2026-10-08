import { Download, Plus, Tags } from "lucide-react";
import { randomUUID } from "node:crypto";
import Link from "next/link";

import { PageHeader } from "@/components/app/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { saveTag } from "@/features/journal/actions";
import { TradeFilters } from "@/features/journal/trade-filters";
import { requireUserId } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getTradeJournalDataset, type JournalFilters } from "@/services/journal/get-trade-journal";
import { listBrowserTags } from "@/services/application/references";
import { getVerifiedBrowserContext } from "@/services/integrations/browser-context";

type SearchParams = Record<string, string | string[] | undefined>;

function single(params: SearchParams, key: string): string | undefined {
  const value = params[key];
  const result = Array.isArray(value) ? value[0] : value;
  return result && result !== "ANY" ? result : undefined;
}

function filtersFrom(params: SearchParams): JournalFilters {
  return {
    account: single(params, "account"), from: single(params, "from"), to: single(params, "to"), instrument: single(params, "instrument"),
    direction: single(params, "direction") as JournalFilters["direction"], strategy: single(params, "strategy"), setup: single(params, "setup"),
    session: single(params, "session") as JournalFilters["session"], status: single(params, "status") as JournalFilters["status"],
    outcome: single(params, "outcome") as JournalFilters["outcome"], grade: single(params, "grade"),
    ruleCompliance: single(params, "ruleCompliance") as JournalFilters["ruleCompliance"], tag: single(params, "tag"),
    search: single(params, "search"), sort: single(params, "sort") as JournalFilters["sort"],
  };
}

export default async function TradesPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  await requireUserId();
  const params = await searchParams;
  const supabase = await createClient();
  const { data: profile } = await supabase.from("profiles").select("timezone").maybeSingle();
  const timezone = profile?.timezone ?? "Africa/Kampala";
  const refreshed = await getTradeJournalDataset(supabase, filtersFrom(params), timezone);
  const tagLibrary = await listBrowserTags(await getVerifiedBrowserContext(supabase));
  const page = Math.max(1, Number.parseInt(single(params, "page") ?? "1", 10) || 1);
  const pageSize = 25;
  const pageCount = Math.max(1, Math.ceil(refreshed.trades.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const rows = refreshed.trades.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const query = new URLSearchParams();
  for (const [key, raw] of Object.entries(params)) {
    if (key === "page") continue;
    const value = Array.isArray(raw) ? raw[0] : raw;
    if (value) query.set(key, value);
  }
  const values = Object.fromEntries([...query.entries()]);
  const pageHref = (nextPage: number) => `/trades?${new URLSearchParams([...query.entries(), ["page", String(nextPage)]]).toString()}`;

  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Trade journal" title="Canonical trades" description="Search the complete decision and execution record. Journal dates use opened, then planned, then created timestamps; realized results remain attributed to closure." actions={<div className="flex gap-2"><Button render={<a download href={`/trades/export?${query.toString()}`} />} nativeButton={false} variant="outline"><Download /> Export filtered CSV</Button><Button render={<Link href="/trades/new" />} nativeButton={false}><Plus /> Log trade</Button></div>} />
      {single(params, "error") ? <p role="alert" className="rounded-lg border border-destructive/25 bg-destructive/10 p-4 text-sm text-destructive">{single(params, "error")}</p> : null}
      {single(params, "message") ? <p className="rounded-lg border border-profit/25 bg-profit/10 p-4 text-sm text-profit">{single(params, "message")}</p> : null}
      <Card><CardHeader><CardTitle>Filters</CardTitle><CardDescription>Every filter also applies to the complete CSV export, independent of pagination.</CardDescription></CardHeader><CardContent><TradeFilters values={values} accounts={refreshed.accounts} instruments={refreshed.instruments} strategies={refreshed.strategies} setups={refreshed.setups} tags={refreshed.tags} /></CardContent></Card>
      <Card>
        <CardHeader className="border-b border-border/70"><CardTitle>{refreshed.trades.length} matching trade{refreshed.trades.length === 1 ? "" : "s"}</CardTitle><CardDescription>Page {currentPage} of {pageCount}</CardDescription></CardHeader>
        <CardContent className="px-0 pb-0">
          <div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Trade</TableHead><TableHead>Account</TableHead><TableHead>Setup</TableHead><TableHead>Status</TableHead><TableHead>Outcome</TableHead><TableHead className="text-right">Risk</TableHead><TableHead className="text-right">RR</TableHead><TableHead className="text-right">Net PnL</TableHead><TableHead className="text-right">Actual R</TableHead><TableHead>Grade</TableHead></TableRow></TableHeader>
            <TableBody>{rows.map((trade) => <TableRow key={trade.id}><TableCell className="whitespace-nowrap">{new Intl.DateTimeFormat("en", { timeZone: timezone, dateStyle: "medium" }).format(new Date(trade.journalDate))}</TableCell><TableCell><Link href={`/trades/${trade.id}`} className="font-semibold hover:text-primary">{trade.instrumentSymbol} · {trade.direction}</Link><p className="mt-1 text-xs text-muted-foreground">{trade.session.replaceAll("_", " ")}{trade.tags.length ? ` · ${trade.tags.map((tag) => tag.name).join(", ")}` : ""}</p></TableCell><TableCell>{trade.accountName}</TableCell><TableCell>{trade.strategyName ?? "—"}<p className="text-xs text-muted-foreground">{trade.setupName ?? ""}</p></TableCell><TableCell><Badge variant="secondary">{trade.status}</Badge></TableCell><TableCell>{trade.outcome?.replaceAll("_", " ") ?? "—"}</TableCell><TableCell className="text-right font-mono">{trade.plannedRiskPercentage ? `${trade.plannedRiskPercentage}%` : "—"}</TableCell><TableCell className="text-right font-mono">{trade.plannedRiskReward ? `${trade.plannedRiskReward}R` : "—"}</TableCell><TableCell className="text-right font-mono">{trade.netPnl ? `${trade.currencyCode} ${trade.netPnl}` : "—"}</TableCell><TableCell className="text-right font-mono">{trade.actualR ? `${trade.actualR}R` : "—"}</TableCell><TableCell>{trade.grade ?? "—"}</TableCell></TableRow>)}</TableBody>
          </Table></div>
          {!rows.length ? <div className="p-12 text-center text-sm text-muted-foreground">No trades match these filters. Clear filters or log a new trade.</div> : null}
          <div className="flex items-center justify-between border-t border-border/70 p-4"><Button render={<Link href={pageHref(Math.max(1, currentPage - 1))} />} nativeButton={false} variant="outline" disabled={currentPage === 1}>Previous</Button><span className="text-xs text-muted-foreground">Showing {rows.length} of {refreshed.trades.length}</span><Button render={<Link href={pageHref(Math.min(pageCount, currentPage + 1))} />} nativeButton={false} variant="outline" disabled={currentPage === pageCount}>Next</Button></div>
        </CardContent>
      </Card>
      <Card><CardHeader><div className="flex items-center gap-2"><Tags className="size-4 text-primary" /><CardTitle>Tag library</CardTitle></div><CardDescription>Names remain user-friendly while uniqueness is enforced case-insensitively.</CardDescription></CardHeader><CardContent className="space-y-4"><form action={saveTag} className="flex flex-col gap-3 sm:flex-row sm:items-end"><input type="hidden" name="operationId" value={randomUUID()} /><input type="hidden" name="returnPath" value={`/trades?${query.toString()}`} /><div className="flex-1 space-y-2"><Label htmlFor="tagName">New tag</Label><Input id="tagName" name="name" maxLength={40} required placeholder="FOMO" /></div><div className="space-y-2"><Label htmlFor="tagColor">Color</Label><Input id="tagColor" name="color" type="color" defaultValue="#d4a017" /></div><Button type="submit">Create tag</Button></form><div className="flex flex-wrap gap-2">{tagLibrary.map((tag) => <Badge key={tag.id} variant="secondary"><span className="mr-1.5 size-2 rounded-full" style={{ backgroundColor: tag.color ?? "currentColor" }} />{tag.name}</Badge>)}{!tagLibrary.length ? <p className="text-sm text-muted-foreground">No tags yet.</p> : null}</div>{tagLibrary.length ? <div className="grid gap-2 border-t border-border/70 pt-4 sm:grid-cols-2">{tagLibrary.map((tag) => <details key={tag.id} className="rounded-lg border border-border/70 bg-muted/20"><summary className="cursor-pointer px-3 py-2 text-sm font-semibold">Edit {tag.name}</summary><form action={saveTag} className="space-y-3 border-t border-border/70 p-3"><input type="hidden" name="operationId" value={randomUUID()} /><input type="hidden" name="expectedVersion" value={tag.record_version} /><input type="hidden" name="id" value={tag.id} /><input type="hidden" name="returnPath" value={`/trades?${query.toString()}`} /><div className="space-y-2"><Label htmlFor={`tag-name-${tag.id}`}>Display name</Label><Input id={`tag-name-${tag.id}`} name="name" defaultValue={tag.name} maxLength={40} required /></div><div className="space-y-2"><Label htmlFor={`tag-color-${tag.id}`}>Color</Label><Input id={`tag-color-${tag.id}`} name="color" type="color" defaultValue={tag.color ?? "#d4a017"} /></div><Button type="submit" size="sm">Save tag</Button></form></details>)}</div> : null}</CardContent></Card>
    </div>
  );
}
