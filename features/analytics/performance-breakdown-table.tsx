import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { PerformanceGroup } from "@/domain/analytics/performance";
import { formatMoney, formatPercent, formatProfitFactor, formatR } from "@/features/analytics/format";

interface PerformanceBreakdownTableProps {
  title: string;
  description: string;
  rows: PerformanceGroup[];
  currencyCode: string;
  currencyPrecision: number;
}

export function PerformanceBreakdownTable({
  title,
  description,
  rows,
  currencyCode,
  currencyPrecision,
}: PerformanceBreakdownTableProps) {
  return (
    <Card>
      <CardHeader className="border-b border-border/70">
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="px-0 pb-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Group</TableHead>
              <TableHead className="text-right">Closed</TableHead>
              <TableHead className="text-right">W / L / BE</TableHead>
              <TableHead className="text-right">Win rate</TableHead>
              <TableHead className="text-right">Net PnL</TableHead>
              <TableHead className="text-right">Avg R</TableHead>
              <TableHead className="text-right">Profit factor</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.key}>
                <TableCell className="font-medium">{row.label}</TableCell>
                <TableCell className="text-right font-mono tabular-nums">{row.metrics.closedTrades}</TableCell>
                <TableCell className="text-right font-mono tabular-nums">{row.metrics.wins} / {row.metrics.losses} / {row.metrics.breakEvens}</TableCell>
                <TableCell className="text-right"><span className="font-mono tabular-nums">{formatPercent(row.metrics.winRate)}</span><span className="block text-[0.68rem] text-muted-foreground">{row.metrics.winRateSample} decisive</span></TableCell>
                <TableCell className="text-right font-mono tabular-nums">{formatMoney(currencyCode, row.metrics.netProfit, currencyPrecision)}</TableCell>
                <TableCell className="text-right"><span className="font-mono tabular-nums">{formatR(row.metrics.averageR)}</span><span className="block text-[0.68rem] text-muted-foreground">{row.metrics.rSample} of {row.metrics.closedTrades}</span></TableCell>
                <TableCell className="text-right font-mono tabular-nums">{formatProfitFactor(row.metrics.profitFactor)}</TableCell>
              </TableRow>
            ))}
            {rows.length === 0 ? <TableRow><TableCell colSpan={7} className="h-32 text-center text-muted-foreground">No closed trades match this selection.</TableCell></TableRow> : null}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
