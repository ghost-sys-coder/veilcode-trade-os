import { Card } from "@/components/ui/card";

interface PeriodSummaryProps {
  items: Array<{ label: string; value: string | number; tone?: "profit" | "loss" }>;
}

export function PeriodSummary({ items }: PeriodSummaryProps) {
  return <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-label="Realized period summary">{items.map((item) => <Card key={item.label} className="gap-2 p-4"><p className="text-[0.65rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{item.label}</p><p className={item.tone === "profit" ? "break-words font-mono text-lg font-semibold text-profit" : item.tone === "loss" ? "break-words font-mono text-lg font-semibold text-destructive" : "break-words font-mono text-lg font-semibold"}>{item.value}</p></Card>)}</section>;
}
