import * as React from "react";

export type ChartConfig = Record<string, {
  label: React.ReactNode;
  color: string;
}>;

export const ChartContext = React.createContext<ChartConfig>({});
