import type { ReactNode } from "react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

interface TradeSectionProps {
  eyebrow: string;
  title: string;
  description: string;
  children: ReactNode;
}

export function TradeSection({ eyebrow, title, description, children }: TradeSectionProps) {
  return (
    <Card>
      <CardHeader className="border-b border-border/70">
        <p className="text-[0.65rem] font-semibold uppercase tracking-[0.16em] text-primary">{eyebrow}</p>
        <CardTitle>{title}</CardTitle>
        <CardDescription className="max-w-3xl leading-6">{description}</CardDescription>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}
