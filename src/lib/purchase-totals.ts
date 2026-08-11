export type PurchaseTotalsInput = {
  lines: Array<{ qty?: number; cost?: number; discount?: number }>;
  tax: number;
  taxMode: "amt" | "pct";
  billDiscount: number;
  discountMode: "amt" | "pct";
};

export type PurchaseTotalsResult = {
  lineDiscountTotal: number;
  subtotal: number;
  discountedSubtotal: number;
  billDiscountAmt: number;
  taxAmt: number;
  total: number;
};

export function calculatePurchaseTotals(input: PurchaseTotalsInput): PurchaseTotalsResult {
  const lineDiscountTotal = input.lines.reduce((sum, line) => sum + Number(line.discount || 0), 0);
  const subtotal = input.lines.reduce((sum, line) => sum + Math.max(0, Number(line.qty || 0) * Number(line.cost || 0) - Number(line.discount || 0)), 0);

  const discountBase = Math.max(0, subtotal);
  const billDiscountAmt = Math.min(
    discountBase,
    Math.max(0, input.discountMode === "pct" ? +(discountBase * (Number(input.billDiscount || 0) / 100)).toFixed(2) : Number(input.billDiscount || 0)),
  );

  const discountedSubtotal = Math.max(0, subtotal - billDiscountAmt);
  const taxAmt = input.taxMode === "pct"
    ? +(discountedSubtotal * (Number(input.tax || 0) / 100)).toFixed(2)
    : Number(input.tax || 0);
  const total = Math.max(0, discountedSubtotal + taxAmt);

  return {
    lineDiscountTotal,
    subtotal,
    discountedSubtotal,
    billDiscountAmt,
    taxAmt,
    total,
  };
}
