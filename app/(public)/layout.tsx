import Link from "next/link";
import { BarChart3 } from "lucide-react";

import { ThemeToggle } from "@/components/app/theme-toggle";
import { PublicAuthAction } from "@/components/app/public-auth-action";

export default function PublicLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="min-h-dvh bg-background">
      <header className="sticky top-0 z-40 border-b border-border/80 bg-background/92 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
          <Link href="/" className="flex items-center gap-3 font-semibold tracking-[-0.025em]">
            <span className="flex size-9 items-center justify-center rounded-lg bg-primary text-primary-foreground"><BarChart3 className="size-4" /></span>
            Trade OS
          </Link>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <PublicAuthAction />
          </div>
        </div>
      </header>
      {children}
    </div>
  );
}
