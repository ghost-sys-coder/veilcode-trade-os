"use client";

import { useEffect } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

interface AppErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function AppError({ error, reset }: AppErrorProps) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <Card className="mx-auto max-w-2xl">
      <CardHeader>
        <CardTitle>Workspace data could not be loaded</CardTitle>
        <CardDescription>
          The data service may be temporarily unreachable. Your saved records have not been changed.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap items-center gap-3">
        <Button type="button" onClick={reset}>Try again</Button>
        <p className="text-xs text-muted-foreground">If this continues, check the local network connection and Supabase project status.</p>
      </CardContent>
    </Card>
  );
}
