import Link from "next/link";
import { ArrowUpRight, Bot, Monitor, ShieldCheck } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { integrationSetupAvailability } from "@/services/integrations/setup-profiles";

export function IntegrationSetupStart() {
  return <section aria-label="Start an integration" className="grid gap-5 lg:grid-cols-2">
    {([{ purpose: "MT5", route: "mt5", title: "Connect MetaTrader 5", icon: Monitor,
      description: "Link one dedicated demo terminal to its Trade OS account. Review history and balances before publishing." },
    { purpose: "MCP", route: "mcp", title: "Connect an AI client", icon: Bot,
      description: "Give an authorized client access to your trading workspace. No AI-provider API key is needed." }] as const).map(item => {
      const availability = integrationSetupAvailability(item.purpose);
      return <Card key={item.route}>
        <CardHeader><div className="flex items-center justify-between gap-3"><div className="rounded-lg bg-primary/12 p-3 text-primary"><item.icon className="size-5" aria-hidden="true" /></div>
          <Badge variant="secondary">{availability.enabled && availability.provisioning ? "Check setup readiness" : "Setup not enabled"}</Badge></div>
          <CardTitle>{item.title}</CardTitle><CardDescription>{item.description}</CardDescription></CardHeader>
        <CardContent className="space-y-4"><div className="flex items-start gap-2 text-xs leading-5 text-muted-foreground"><ShieldCheck className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <p>Prepare configuration, approve access, then verify the connection. Existing grants and imported data are preserved.</p></div>
          <Button variant="outline" nativeButton={false} render={<Link href={`/settings/integrations/connect/${item.route}`} />}>View connection setup<ArrowUpRight className="size-4" aria-hidden="true" /></Button>
        </CardContent>
      </Card>;
    })}
  </section>;
}
