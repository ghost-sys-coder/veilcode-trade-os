"use client";

import {
  BookOpenText,
  CalendarDays,
  ChartNoAxesCombined,
  ClipboardPenLine,
  Flag,
  Landmark,
  LayoutDashboard,
  ListChecks,
  ShieldCheck,
  Settings,
  Trophy,
  TrendingUp,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

const navigationItems = [
  { href: "/dashboard", label: "Overview", icon: LayoutDashboard },
  { href: "/accounts", label: "Accounts", icon: Landmark },
  { href: "/trades", label: "Trade journal", icon: ListChecks },
  { href: "/trades/new", label: "Log trade", icon: BookOpenText },
  { href: "/journal/daily", label: "Daily journal", icon: ClipboardPenLine },
  { href: "/calendar", label: "Calendar", icon: CalendarDays },
  { href: "/analytics", label: "Analytics", icon: TrendingUp },
  { href: "/prop", label: "Prop progress", icon: Trophy },
  { href: "/goals", label: "Goals", icon: Flag },
  { href: "/strategies", label: "Strategies", icon: ChartNoAxesCombined },
  { href: "/rules", label: "Rules", icon: ShieldCheck },
  { href: "/settings", label: "Settings", icon: Settings },
] as const;

interface AppNavigationProps {
  variant?: "desktop" | "mobile";
}

export function AppNavigation({ variant = "desktop" }: AppNavigationProps) {
  const pathname = usePathname();
  const mobile = variant === "mobile";

  return (
    <nav
      aria-label="Primary navigation"
      className={cn(
        mobile ? "flex min-w-max items-center gap-1 px-4 py-2" : "space-y-1.5 px-3",
      )}
    >
      {navigationItems.map((item) => {
        const Icon = item.icon;
        const active = item.href === "/trades"
          ? pathname === "/trades" || (/^\/trades\/[^/]+$/.test(pathname) && pathname !== "/trades/new")
          : pathname === item.href || pathname.startsWith(`${item.href}/`);
        const classes = cn(
          "group relative flex items-center gap-3 text-sm font-medium transition-all duration-200",
          mobile
            ? "h-9 rounded-lg px-3"
            : "h-11 rounded-lg px-3.5 before:absolute before:inset-y-2 before:left-0 before:w-0.5 before:rounded-full before:bg-transparent",
          active
            ? "bg-primary/12 text-foreground before:bg-primary"
            : "text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
          !item.href && "cursor-not-allowed opacity-55",
        );

        return (
          <Link key={item.label} href={item.href} className={classes} aria-current={active ? "page" : undefined}>
            <Icon
              className={cn("size-[1.125rem] shrink-0", active && "text-primary")}
              strokeWidth={1.8}
              aria-hidden="true"
            />
            <span>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
