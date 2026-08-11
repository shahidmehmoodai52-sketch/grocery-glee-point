import { describe, expect, it } from "vitest";
import { calculatePurchaseTotals } from "./purchase-totals";

describe("calculatePurchaseTotals", () => {
  it("applies bill discount before tax and uses line discounts in the taxable base", () => {
    const result = calculatePurchaseTotals({
      lines: [
        { qty: 2, cost: 50, discount: 10 },
      ],
      tax: 10,
      taxMode: "pct",
      billDiscount: 10,
      discountMode: "pct",
    });

    expect(result.lineDiscountTotal).toBe(10);
    expect(result.subtotal).toBe(90);
    expect(result.billDiscountAmt).toBe(9);
    expect(result.discountedSubtotal).toBe(81);
    expect(result.taxAmt).toBe(8.1);
    expect(result.total).toBe(89.1);
  });
});
