import Link from "next/link";

const items = [["Daily", "/journal/daily"], ["Weekly", "/journal/weekly"], ["Monthly", "/journal/monthly"], ["Calendar", "/calendar"]] as const;

export function ReviewNavigation({ active }: { active: "daily" | "weekly" | "monthly" | "calendar" }) {
  return <nav aria-label="Journal periods" className="flex flex-wrap gap-2">{items.map(([label, href]) => <Link key={href} href={href} className={`rounded-md border px-3 py-2 text-sm font-semibold transition-colors ${label.toLowerCase() === active ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card hover:border-primary/50 hover:text-primary"}`}>{label}</Link>)}</nav>;
}
