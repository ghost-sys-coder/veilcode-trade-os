"use client";

import * as React from "react";
import { cn } from "cn";

export function TableRow({ className, ...props }: React.ComponentProps<"tr">) {
  return (
    <tr
      data-slot="table-row"
      className={cn(
        "border-b border-border/70 transition-colors hover:bg-muted/55 has-aria-expanded:bg-muted/55 data-[state=selected]:bg-muted",
        className,
      )}
      {...props}
    />
  );
}
