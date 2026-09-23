import Link from "next/link";
import { BookOpenCheck, ChartNoAxesCombined, LogOut, ShieldCheck } from "lucide-react";

import { signOut } from "@/app/(app)/actions";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { requireUserId } from "@/lib/auth";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  await requireUserId();

  return (
    <div className="min-h-screen bg-muted/20">
      <header className="border-b bg-background">
        <div className="mx-auto flex h-16 max-w-7xl items-center gap-6 px-4 sm:px-6">
          <Link href="/dashboard" className="flex items-center gap-2 font-semibold">
            <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <ChartNoAxesCombined className="size-4" aria-hidden="true" />
            </span>
            Trade OS
          </Link>
          <Separator orientation="vertical" className="hidden h-6 sm:block" />
          <nav className="flex flex-1 items-center gap-1" aria-label="Primary navigation">
            <Button render={<Link href="/accounts" />} variant="ghost" size="sm">Accounts</Button>
            <Button render={<Link href="/strategies" />} variant="ghost" size="sm">Strategies</Button>
            <Button render={<Link href="/rules" />} variant="ghost" size="sm">Rules</Button>
          </nav>
          <div className="hidden items-center gap-2 text-xs text-muted-foreground md:flex">
            <ShieldCheck className="size-4" aria-hidden="true" />
            Private workspace
          </div>
          <form action={signOut}>
            <Button type="submit" variant="ghost" size="icon" aria-label="Sign out"><LogOut /></Button>
          </form>
        </div>
      </header>
      <main className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6">{children}</main>
      <footer className="mx-auto flex max-w-7xl items-center gap-2 px-4 pb-8 text-xs text-muted-foreground sm:px-6">
        <BookOpenCheck className="size-4" aria-hidden="true" />
        Manual-first performance tracking. No signals or automated trading.
      </footer>
    </div>
  );
}
