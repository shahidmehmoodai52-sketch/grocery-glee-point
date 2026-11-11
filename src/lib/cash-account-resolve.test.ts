import { describe, it, expect } from "vitest";
import { makeAccountResolver } from "./cash-account-resolve";

const accts = [
  { id: "1", name: "Cash in Hand", type: "cash", is_active: true, created_at: "2025-01-01" },
  { id: "2", name: "BAF", type: "bank", is_active: true, created_at: "2025-01-02" },
  { id: "3", name: "Card", type: "card", is_active: true, created_at: "2025-01-03" },
  { id: "4", name: "Adeel E/P", type: "mobile_wallet", is_active: true, created_at: "2025-01-04" },
  { id: "5", name: "Temp Loan", type: "other", is_active: true, created_at: "2025-01-05" },
];

describe("makeAccountResolver", () => {
  const r = makeAccountResolver(accts);
  it("maps methods the way resolve_cash_account does", () => {
    expect(r.byMethod("cash")).toBe("Cash in Hand");
    expect(r.byMethod("Cash")).toBe("Cash in Hand");
    expect(r.byMethod("Cash in Hand")).toBe("Cash in Hand");
    expect(r.byMethod("card")).toBe("Card");
    expect(r.byMethod("BAF")).toBe("BAF");
    expect(r.byMethod("easypaisa")).toBe("Adeel E/P");
    expect(r.byMethod("credit")).toBe("Cash in Hand");
    expect(r.byMethod("")).toBe("Cash in Hand");
  });
  it("prefers the linked account id", () => {
    expect(r.byId("2")).toBe("BAF");
    expect(r.byId(null)).toBeNull();
  });
  it("falls back to the method with no accounts", () => {
    expect(makeAccountResolver([]).byMethod("cash")).toBe("cash");
  });
});
