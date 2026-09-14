import { describe, expect, it } from "vitest";
import { buildPreviewLine } from "./matching";
import type { ExtractedBillItem, MatchedProductOption } from "./types";

const baseItem: ExtractedBillItem = {
  name: "Widget",
  barcode: null,
  sku: null,
  qty: 5,
  unit_cost: null,
  discount: 0,
  tax: 0,
  line_total: null,
  batch_no: null,
  expiry_date: null,
};

const productWithZeroCost: MatchedProductOption = {
  id: "p1",
  name: "Widget",
  barcode: null,
  sku: null,
  cost_price: 0,
  sell_price: 100,
  stock: 20,
};

describe("buildPreviewLine - cost fallback (bug repro: silent 0 amount)", () => {
  it("falls back to the OCR-read price when the matched product's stored cost is 0", () => {
    const line = buildPreviewLine({ ...baseItem, unit_cost: 40 }, [productWithZeroCost], []);
    expect(line.product_id).toBe("p1");
    expect(line.cost).toBe(40);
  });

  it("ends up 0 only when neither the matched product's cost nor the OCR price is usable", () => {
    const line = buildPreviewLine({ ...baseItem, unit_cost: null }, [productWithZeroCost], []);
    expect(line.cost).toBe(0);
  });

  it("prefers the matched product's real stored cost when it's positive", () => {
    const productWithCost: MatchedProductOption = { ...productWithZeroCost, cost_price: 55 };
    const line = buildPreviewLine({ ...baseItem, unit_cost: 40 }, [productWithCost], []);
    expect(line.cost).toBe(55);
  });

  it("uses the OCR price when nothing matched at all", () => {
    const line = buildPreviewLine({ ...baseItem, unit_cost: 40 }, [], []);
    expect(line.product_id).toBeNull();
    expect(line.cost).toBe(40);
  });
});
