import type { Metadata } from "next";

import { PositionSizeCalculator } from "@/features/calculator/position-size-calculator";

export const metadata: Metadata = {
  title: "Position Size & Risk Calculator",
  description: "Calculate a risk-normalized trading position size with exact decimal arithmetic.",
};

export default function PositionSizeCalculatorPage() {
  return <PositionSizeCalculator />;
}
