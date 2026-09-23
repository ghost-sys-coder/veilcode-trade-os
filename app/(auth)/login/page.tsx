import { ArrowRight, ShieldCheck } from "lucide-react";

import { signIn, signUp } from "@/app/(auth)/login/actions";
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
    <main className="flex min-h-screen items-center justify-center bg-muted/30 px-4 py-12">
      <Card className="w-full max-w-md">
        <CardHeader>
          <div className="mb-3 flex size-10 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <ShieldCheck className="size-5" aria-hidden="true" />
          </div>
          <CardTitle className="text-2xl">Trade OS</CardTitle>
          <CardDescription>
            Sign in to manage your trading accounts, strategies, setups, and rules.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email address</Label>
              <Input id="email" name="email" type="email" autoComplete="email" required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input id="password" name="password" type="password" minLength={8} autoComplete="current-password" required />
              <p className="text-xs text-muted-foreground">New accounts require at least eight characters.</p>
            </div>
            {error ? <p role="alert" className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">{error}</p> : null}
            {message ? <p className="rounded-lg bg-muted p-3 text-sm text-foreground">{message}</p> : null}
            <div className="grid grid-cols-2 gap-3 pt-2">
              <Button formAction={signIn} type="submit" variant="outline">Sign in</Button>
              <Button formAction={signUp} type="submit">
                Create account
                <ArrowRight data-icon="inline-end" />
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
