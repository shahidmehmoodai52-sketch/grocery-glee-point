import { describe, expect, it } from "vitest";
import { calculatePurchaseTotals } from "./purchase-totals";

describe("calculatePurchaseTotals - Bug Reproduction", () => {
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

    // Subtotal should be 3000
    expect(result.subtotal).toBe(3000);
    // Bill discount should be 300
    expect(result.billDiscountAmt).toBe(300);
    // Total should be 2700
    expect(result.total).toBe(2700);
  });

  it("verifies tax calculation test case", () => {
    // Check for double tax application in math logic
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
