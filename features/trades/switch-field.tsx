"use client";

import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

interface SwitchFieldProps {
  name: string;
  label: string;
  description?: string;
  defaultChecked?: boolean;
}

export function SwitchField({ name, label, description, defaultChecked }: SwitchFieldProps) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-lg border border-border/70 bg-muted/20 p-3.5">
      <div className="space-y-1">
        <Label htmlFor={name}>{label}</Label>
        {description ? <p className="text-xs leading-5 text-muted-foreground">{description}</p> : null}
      </div>
      <Switch id={name} name={name} defaultChecked={defaultChecked} aria-label={label} />
    </div>
  );
}
