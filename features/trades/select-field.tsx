"use client";

import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface SelectFieldProps {
  name: string;
  label: string;
  items: readonly { label: string; value: string }[];
  defaultValue?: string;
  value?: string;
  placeholder?: string;
  help?: string;
  required?: boolean;
  disabled?: boolean;
  onValueChange?: (value: string | null) => void;
}

export function SelectField({
  name,
  label,
  items,
  defaultValue,
  value,
  placeholder,
  help,
  required,
  disabled,
  onValueChange,
}: SelectFieldProps) {
  const id = `field-${name.replace(/[^a-zA-Z0-9_-]/g, "-")}`;

  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}{required ? <span className="text-destructive">*</span> : null}</Label>
      <Select
        name={name}
        items={items}
        defaultValue={value === undefined ? defaultValue : undefined}
        value={value}
        onValueChange={onValueChange}
        required={required}
        disabled={disabled}
      >
        <SelectTrigger id={id} className="w-full"><SelectValue placeholder={placeholder ?? `Choose ${label.toLowerCase()}`} /></SelectTrigger>
        <SelectContent>
          {items.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}
        </SelectContent>
      </Select>
      {help ? <p className="text-xs leading-5 text-muted-foreground">{help}</p> : null}
    </div>
  );
}
