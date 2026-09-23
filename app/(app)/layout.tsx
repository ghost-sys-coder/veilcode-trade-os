import { BarChart3, BookOpenCheck, LockKeyhole, LogOut } from "lucide-react";
import Link from "next/link";

import { signOut } from "@/app/(app)/actions";
import { AppNavigation } from "@/components/app/app-navigation";
import { ThemeToggle } from "@/components/app/theme-toggle";
import { Button } from "@/components/ui/button";
import { requireUserId } from "@/lib/auth";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  await requireUserId();

  return (
    <div className="min-h-dvh bg-background">
      <a
        href="#main-content"
        className="fixed left-4 top-3 z-50 -translate-y-20 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-transform focus:translate-y-0"
      >
        Skip to content
      </a>

      <aside className="fixed inset-y-0 left-0 z-40 hidden w-64 flex-col border-r border-sidebar-border bg-sidebar lg:flex">
        <Link href="/dashboard" className="flex h-16 items-center gap-3 border-b border-sidebar-border px-6">
          <span className="flex size-9 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-sm">
            <BarChart3 className="size-5" strokeWidth={2.2} aria-hidden="true" />
          </span>
          <span className="text-lg font-semibold tracking-[-0.025em] text-sidebar-foreground">Trade OS</span>
        </Link>

        <p className="px-6 pb-3 pt-7 text-[0.65rem] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
          Workspace
        </p>
        <AppNavigation />

        <div className="mt-auto border-t border-sidebar-border p-4">
          <div className="mb-3 flex items-center gap-3 rounded-lg bg-sidebar-accent/60 px-3 py-3">
            <span className="flex size-8 items-center justify-center rounded-md bg-primary/15 text-primary">
              <LockKeyhole className="size-4" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <p className="text-xs font-semibold text-sidebar-foreground">Private workspace</p>
              <p className="mt-0.5 text-[0.68rem] text-muted-foreground">Your trading record stays yours</p>
            </div>
          </div>
          <div className="flex items-center justify-between gap-2">
            <ThemeToggle />
            <form action={signOut} className="flex-1">
              <Button type="submit" variant="ghost" className="w-full justify-start" aria-label="Sign out">
                <LogOut data-icon="inline-start" />
                Sign out
              </Button>
            </form>
          </div>
        </div>
      </aside>

      <div className="lg:pl-64">
        <header className="sticky top-0 z-30 flex h-16 items-center border-b border-border/80 bg-background/95 px-4 backdrop-blur-md sm:px-6 lg:px-8">
          <Link href="/dashboard" className="flex items-center gap-2.5 lg:hidden">
            <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <BarChart3 className="size-4" aria-hidden="true" />
            </span>
            <span className="font-semibold">Trade OS</span>
          </Link>

          <div className="ml-auto flex items-center gap-2 lg:ml-0 lg:w-full lg:justify-between">
            <div className="hidden lg:block">
              <p className="text-xs font-medium text-foreground">Build the record. Protect the process.</p>
              <p className="mt-0.5 text-[0.68rem] text-muted-foreground">Manual-first performance tracking</p>
            </div>
            <div className="flex items-center gap-2 lg:hidden">
              <ThemeToggle />
              <form action={signOut}>
                <Button type="submit" variant="outline" size="icon" aria-label="Sign out">
                  <LogOut />
                </Button>
              </form>
            </div>
            <div className="hidden items-center gap-2 text-xs text-muted-foreground lg:flex">
              <span className="size-1.5 rounded-full bg-profit" />
              Secure session
            </div>
          </div>
        </header>

        <div className="overflow-x-auto border-b border-border/70 bg-card/60 lg:hidden">
          <AppNavigation variant="mobile" />
        </div>

        <main id="main-content" className="mx-auto w-full max-w-[100rem] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          {children}
        </main>

        <footer className="mx-auto flex w-full max-w-[100rem] items-center gap-2 px-4 pb-8 text-xs text-muted-foreground sm:px-6 lg:px-8">
          <BookOpenCheck className="size-4" aria-hidden="true" />
          Manual-first performance tracking. No signals or automated trading.
        </footer>
      </div>
    </div>
  );
}
