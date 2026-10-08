import { buildJournalCsv } from "@/domain/reporting/export";
import { requireUserId } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getTradeJournalDataset, type JournalFilters } from "@/services/journal/get-trade-journal";

function value(params: URLSearchParams, key: string): string | undefined {
  const result = params.get(key)?.trim();
  return result && result !== "ANY" ? result : undefined;
}

export async function GET(request: Request) {
  await requireUserId();
  const supabase = await createClient();
  const params = new URL(request.url).searchParams;
  const filters: JournalFilters = {
    account: value(params, "account"), from: value(params, "from"), to: value(params, "to"), instrument: value(params, "instrument"),
    direction: value(params, "direction") as JournalFilters["direction"], strategy: value(params, "strategy"), setup: value(params, "setup"),
    session: value(params, "session") as JournalFilters["session"], status: value(params, "status") as JournalFilters["status"],
    outcome: value(params, "outcome") as JournalFilters["outcome"], grade: value(params, "grade"),
    ruleCompliance: value(params, "ruleCompliance") as JournalFilters["ruleCompliance"], tag: value(params, "tag"), search: value(params, "search"), sort: value(params, "sort") as JournalFilters["sort"],
  };
  const { data: profile } = await supabase.from("profiles").select("timezone").maybeSingle();
  const dataset = await getTradeJournalDataset(supabase, filters, profile?.timezone ?? "Africa/Kampala");
  return new Response(buildJournalCsv(dataset), { headers: { "Cache-Control":"no-store", "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="trade-journal-${new Date().toISOString().slice(0, 10)}.csv"` } });
}
