import { ShieldAlert } from "lucide-react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

interface BufferValue {
  available: boolean;
  reason: string | null;
  limit: string | null;
  used: string | null;
  remaining: string | null;
}

export function PropBufferCard({ title, buffer, currency }: { title: string; buffer: BufferValue | null; currency: string }) {
  return <Card><CardHeader><ShieldAlert className="size-5 text-primary" /><CardTitle>{title}</CardTitle><CardDescription>{buffer ? "Calculated from the explicitly configured rule." : "This rule has not been configured."}</CardDescription></CardHeader><CardContent>{!buffer ? <p className="text-sm text-muted-foreground">Not configured</p> : buffer.available ? <div className="grid grid-cols-3 gap-3"><div><p className="text-xs text-muted-foreground">Limit</p><p className="mt-1 font-mono font-semibold">{currency} {buffer.limit}</p></div><div><p className="text-xs text-muted-foreground">Used</p><p className="mt-1 font-mono font-semibold">{currency} {buffer.used}</p></div><div><p className="text-xs text-muted-foreground">Remaining</p><p className="mt-1 font-mono font-semibold">{currency} {buffer.remaining}</p></div></div> : <p className="rounded-lg border border-warning/25 bg-warning/10 p-3 text-sm text-warning-foreground">{buffer.reason}</p>}</CardContent></Card>;
}
