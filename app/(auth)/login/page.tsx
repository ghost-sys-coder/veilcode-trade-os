import { ArrowRight, BarChart3, ChartNoAxesCombined, Check, ShieldCheck, WalletCards } from "lucide-react";

import { signIn, signUp } from "@/app/(auth)/login/actions";
import { ThemeToggle } from "@/components/app/theme-toggle";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface LoginPageProps {
  searchParams: Promise<{ error?: string; message?: string }>;
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const { error, message } = await searchParams;

  return (
    <main className="grid min-h-dvh bg-background lg:grid-cols-[minmax(0,1.05fr)_minmax(30rem,0.95fr)]">
      <section className="relative hidden overflow-hidden border-r border-border bg-sidebar px-12 py-10 lg:flex lg:flex-col xl:px-20 xl:py-14">
        <div className="pointer-events-none absolute -left-40 top-20 size-[34rem] rounded-full bg-primary/10 blur-3xl" />
        <div className="pointer-events-none absolute bottom-[-14rem] right-[-8rem] size-[30rem] rounded-full border border-primary/10" />
        <div className="pointer-events-none absolute bottom-[-10rem] right-[-4rem] size-[22rem] rounded-full border border-primary/10" />

        <div className="relative flex items-center gap-3">
          <span className="flex size-10 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-sm"><BarChart3 className="size-5" aria-hidden="true" /></span>
          <span className="text-lg font-semibold tracking-[-0.025em] text-sidebar-foreground">Trade OS</span>
        </div>

        <div className="relative my-auto max-w-xl py-16">
          <p className="mb-5 text-xs font-semibold uppercase tracking-[0.2em] text-primary">Manual-first performance tracking</p>
          <h1 className="max-w-lg text-4xl font-semibold tracking-[-0.045em] text-sidebar-foreground xl:text-5xl xl:leading-[1.08]">Build the record. Protect the process.</h1>
          <p className="mt-6 max-w-lg text-base leading-7 text-muted-foreground">A disciplined workspace for accounts, strategies, setups, and rules—built around reproducible performance instead of vanity metrics.</p>

          <div className="mt-10 grid gap-3">
            <div className="flex items-center gap-4 border-b border-sidebar-border pb-4"><span className="flex size-9 items-center justify-center rounded-lg bg-primary/12 text-primary"><WalletCards className="size-4" aria-hidden="true" /></span><div><p className="text-sm font-semibold text-sidebar-foreground">Authoritative account balances</p><p className="mt-0.5 text-xs text-muted-foreground">Derived from auditable monetary events.</p></div></div>
            <div className="flex items-center gap-4 border-b border-sidebar-border pb-4"><span className="flex size-9 items-center justify-center rounded-lg bg-primary/12 text-primary"><ChartNoAxesCombined className="size-4" aria-hidden="true" /></span><div><p className="text-sm font-semibold text-sidebar-foreground">Structured trading context</p><p className="mt-0.5 text-xs text-muted-foreground">Keep methodologies and entry patterns distinct.</p></div></div>
            <div className="flex items-center gap-4"><span className="flex size-9 items-center justify-center rounded-lg bg-primary/12 text-primary"><ShieldCheck className="size-4" aria-hidden="true" /></span><div><p className="text-sm font-semibold text-sidebar-foreground">Rules before results</p><p className="mt-0.5 text-xs text-muted-foreground">Make process discipline visible and reviewable.</p></div></div>
          </div>
        </div>

        <p className="relative flex items-center gap-2 text-xs text-muted-foreground"><Check className="size-4 text-profit" aria-hidden="true" />Private workspace · no signals or automated trading</p>
      </section>

      <section className="relative flex min-h-dvh items-center justify-center px-4 py-20 sm:px-8 lg:px-12">
        <div className="absolute right-4 top-4 sm:right-8 sm:top-6"><ThemeToggle /></div>
        <div className="w-full max-w-md">
          <div className="mb-8 flex items-center gap-3 lg:hidden"><span className="flex size-10 items-center justify-center rounded-lg bg-primary text-primary-foreground"><BarChart3 className="size-5" aria-hidden="true" /></span><div><p className="font-semibold">Trade OS</p><p className="text-xs text-muted-foreground">Performance workspace</p></div></div>
          <Card className="surface-shadow">
            <CardHeader className="border-b border-border/70 pb-5">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Secure access</p>
              <CardTitle className="text-2xl">Welcome to your workspace</CardTitle>
              <CardDescription>Sign in to continue, or create a private workspace with the same details.</CardDescription>
            </CardHeader>
            <CardContent className="pt-6">
              <form className="space-y-5">
                <div className="space-y-2"><Label htmlFor="email">Email address</Label><Input id="email" name="email" type="email" autoComplete="email" placeholder="trader@example.com" required /></div>
                <div className="space-y-2"><div className="flex items-center justify-between gap-3"><Label htmlFor="password">Password</Label><span className="text-[0.68rem] text-muted-foreground">8 characters minimum</span></div><Input id="password" name="password" type="password" minLength={8} autoComplete="current-password" required /></div>
                {error ? <p role="alert" className="rounded-lg border border-destructive/25 bg-destructive/10 p-3 text-sm text-destructive">{error}</p> : null}
                {message ? <p className="rounded-lg border border-profit/25 bg-profit/10 p-3 text-sm text-profit">{message}</p> : null}
                <div className="grid gap-3 pt-1 sm:grid-cols-2">
                  <Button formAction={signIn} type="submit">Sign in<ArrowRight data-icon="inline-end" /></Button>
                  <Button formAction={signUp} type="submit" variant="outline">Create account</Button>
                </div>
              </form>
            </CardContent>
          </Card>
          <p className="mt-5 text-center text-xs leading-5 text-muted-foreground">Your account data is isolated with row-level security. Monetary values use exact decimal arithmetic.</p>
        </div>
      </section>
    </main>
  );
}
