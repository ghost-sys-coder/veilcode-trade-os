import * as React from "react"
import { cn } from "cn"

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "flex field-sizing-content min-h-24 w-full rounded-lg border border-input bg-background/70 px-3 py-2.5 text-base shadow-[inset_0_1px_0_color-mix(in_oklch,var(--foreground)_3%,transparent)] transition-all outline-none placeholder:text-muted-foreground/75 focus-visible:border-ring focus-visible:bg-background focus-visible:ring-3 focus-visible:ring-ring/25 disabled:cursor-not-allowed disabled:bg-input/40 disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm dark:bg-input/20 dark:focus-visible:bg-input/30 dark:disabled:bg-input/50 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40",
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
