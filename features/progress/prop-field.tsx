import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function PropField({ label, name, value, type = "text", placeholder, help }: { label: string; name: string; value?: string | number | null; type?: string; placeholder?: string; help?: string }) {
  const helpId = help ? `${name}-help` : undefined;
  return <div className="space-y-2"><Label htmlFor={name}>{label}</Label><Input id={name} name={name} type={type} defaultValue={value ?? ""} placeholder={placeholder} aria-describedby={helpId} />{help ? <p id={helpId} className="text-xs leading-5 text-muted-foreground">{help}</p> : null}</div>;
}
