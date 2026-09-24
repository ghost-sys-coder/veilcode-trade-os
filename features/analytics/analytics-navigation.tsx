import Link from "next/link";

import { cn } from "@/lib/utils";

export const ANALYTICS_VIEWS = [
  { id: "overview", label: "Overview" },
  { id: "instruments", label: "Instruments" },
  { id: "strategies", label: "Strategies" },
  { id: "setups", label: "Setups" },
  { id: "sessions", label: "Sessions" },
  { id: "risk", label: "Risk" },
  { id: "time", label: "Time" },
  { id: "execution", label: "Execution" },
  { id: "rules", label: "Rules" },
  { id: "psychology", label: "Psychology" },
  { id: "mistakes", label: "Mistakes" },
] as const;

export type AnalyticsView = (typeof ANALYTICS_VIEWS)[number]["id"];

export function AnalyticsNavigation({ view, query }: { view: AnalyticsView; query: string }) {
  return (
    <nav aria-label="Analytics sections" className="overflow-x-auto rounded-xl border border-border/70 bg-card p-1.5 shadow-sm">
      <div className="flex min-w-max gap-1">
        {ANALYTICS_VIEWS.map((item) => (
          <Link
            key={item.id}
            href={`/analytics/${item.id}${query ? `?${query}` : ""}`}
            aria-current={view === item.id ? "page" : undefined}
            className={cn(
              "rounded-lg px-4 py-2 text-sm font-medium transition-colors",
              view === item.id ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            {item.label}
          </Link>
        ))}
      </div>
    </nav>
  );
}
