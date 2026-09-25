"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowRight } from "lucide-react";

import { Button } from "@/components/ui/button";

export function PublicAuthAction() {
  const [authenticated, setAuthenticated] = useState(false);

  useEffect(() => {
    let active = true;

    void fetch("/auth/status", { cache: "no-store", credentials: "same-origin" })
      .then((response) => response.ok ? response.json() as Promise<{ authenticated?: boolean }> : null)
      .then((status) => {
        if (active) setAuthenticated(status?.authenticated === true);
      })
      .catch(() => {
        if (active) setAuthenticated(false);
      });

    return () => {
      active = false;
    };
  }, []);

  return (
    <Button
      render={<Link href={authenticated ? "/dashboard" : "/login"} />}
      nativeButton={false}
      variant="outline"
      size="sm"
    >
      {authenticated ? "Open dashboard" : "Sign in"}
      {authenticated ? <ArrowRight data-icon="inline-end" /> : null}
    </Button>
  );
}
