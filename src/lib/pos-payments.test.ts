import { describe, expect, it } from "vitest";
import { deriveDigitalCashBackAccounting, deriveDigitalCashBackSummary, normalizePaymentAllocations, sumPaymentAllocations } from "./pos-payments";

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

describe("deriveDigitalCashBackSummary", () => {
  it("returns zero cash back when received matches the sale total", () => {
    expect(deriveDigitalCashBackSummary(500, 500)).toEqual({
      isValid: true,
      receivedAmount: 500,
      cashBackAmount: 0,
    });
  });

  it("calculates the cash back for a larger digital payment", () => {
    expect(deriveDigitalCashBackSummary(500, 1000)).toEqual({
      isValid: true,
      receivedAmount: 1000,
      cashBackAmount: 500,
    });
  });

  it("rejects payments below the sale total", () => {
    expect(deriveDigitalCashBackSummary(500, 400)).toEqual({
      isValid: false,
      receivedAmount: 400,
      cashBackAmount: 0,
    });
  });
});

describe("deriveDigitalCashBackAccounting", () => {
  it("builds the expected digital-account and cash-back legs for a larger payment", () => {
    expect(deriveDigitalCashBackAccounting(500, 1000)).toEqual({
      saleTotal: 500,
      receivedAmount: 1000,
      cashBackAmount: 500,
      digitalAccountIn: 1000,
      customerCashBackOut: 500,
      netDigitalIncrease: 500,
    });
  });
});
