"use client";

import { useEffect } from "react";

import { CALCULATOR_TRANSFER_KEY } from "@/domain/trading/calculator-transfer";

export function CalculatorTransferCleanup() {
  useEffect(() => {
    sessionStorage.removeItem(CALCULATOR_TRANSFER_KEY);
  }, []);
  return null;
}
