import { describe, expect, it } from "vitest";
import { normalizePaymentAllocations, sumPaymentAllocations } from "./pos-payments";

describe("normalizePaymentAllocations", () => {
  it("keeps positive split payments and ignores zero rows", () => {
    const allocations = normalizePaymentAllocations([
      { method: "cash", amount: 10 },
      { method: "bank", amount: 0 },
      { method: "card", amount: 15 },
    ], "cash", 25);

    expect(allocations).toEqual([
      { method: "cash", amount: 10, account_id: null, note: null },
      { method: "card", amount: 15, account_id: null, note: null },
    ]);
  });

  it("falls back to a single tender when nothing positive is provided", () => {
    const allocations = normalizePaymentAllocations([], "cash", 12.5);
    expect(allocations).toEqual([{ method: "cash", amount: 12.5 }]);
  });
});

describe("sumPaymentAllocations", () => {
  it("totals split payments", () => {
    expect(sumPaymentAllocations([
      { method: "cash", amount: 12.5 },
      { method: "bank", amount: 7.5 },
    ])).toBe(20);
  });
});
