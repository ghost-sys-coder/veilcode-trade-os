"use client";

import * as React from "react";
import { cn } from "cn";

export function TableHead({ className, ...props }: React.ComponentProps<"th">) {
  return (
    <th
      data-slot="table-head"
      className={cn(
        "h-11 px-3 text-left align-middle text-[0.68rem] font-semibold uppercase tracking-[0.08em] whitespace-nowrap text-muted-foreground [&:has([role=checkbox])]:pr-0",
        className,
      )}
      {...props}
    />
  );
}
