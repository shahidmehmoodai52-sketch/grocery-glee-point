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

  it("verifies discount distribution test case", () => {
    const result = calculatePurchaseTotals({
      lines: [
        { qty: 1, cost: 1000, discount: 0 },
        { qty: 1, cost: 2000, discount: 0 },
      ],
      tax: 0,
      taxMode: "amt",
      billDiscount: 300,
      discountMode: "amt",
    });

    expect(result.subtotal).toBe(3000);
    expect(result.billDiscountAmt).toBe(300);
    expect(result.total).toBe(2700);
  });

  it("verifies tax calculation test case", () => {
    const result = calculatePurchaseTotals({
      lines: [
        { qty: 1, cost: 100, discount: 0 },
      ],
      tax: 25,
      taxMode: "amt",
      billDiscount: 0,
      discountMode: "amt",
    });

    expect(result.taxAmt).toBe(25);
    expect(result.total).toBe(125);
  });
});

