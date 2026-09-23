import * as React from "react";
import { cn } from "cn";

export function CardTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-title"
      className={cn(
        "font-heading text-base leading-snug font-semibold tracking-[-0.015em] group-data-[size=sm]/card:text-sm",
        className,
      )}
      {...props}
    />
  );
}
