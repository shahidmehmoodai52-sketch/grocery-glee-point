import { describe, expect, it } from "vitest";
import { computeSoldQtyByProduct, applyStockDeltas } from "./pos-stock-patch";

describe("computeSoldQtyByProduct", () => {
  it("aggregates multiple lines of the same product", () => {
    const m = computeSoldQtyByProduct([
      { product_id: "p1", qty: 2 },
      { product_id: "p1", qty: 3 },
      { product_id: "p2", qty: 1 },
    ]);
    expect(m.get("p1")).toBe(5);
    expect(m.get("p2")).toBe(1);
  });

  it("ignores lines with no catalog product", () => {
    const m = computeSoldQtyByProduct([
      { product_id: null, qty: 4 },
      { product_id: "p1", qty: 1 },
    ]);
    expect(m.size).toBe(1);
    expect(m.get("p1")).toBe(1);
  });

  it("returns an empty map for an empty cart", () => {
    expect(computeSoldQtyByProduct([]).size).toBe(0);
  });
});

describe("applyStockDeltas", () => {
  const products = [
    { id: "p1", name: "A", stock: 10 },
    { id: "p2", name: "B", stock: 5 },
    { id: "p3", name: "C", stock: 0 },
  ];

  it("decrements stock only for sold products, leaving others untouched by reference", () => {
    const sold = new Map([["p1", 4]]);
    const result = applyStockDeltas(products, sold);
    expect(result.find((p) => p.id === "p1")?.stock).toBe(6);
    expect(result.find((p) => p.id === "p2")).toBe(products[1]);
    expect(result.find((p) => p.id === "p3")).toBe(products[2]);
  });

  it("allows stock to go negative (matches existing allow-negative-stock sales)", () => {
    const sold = new Map([["p3", 2]]);
    const result = applyStockDeltas(products, sold);
    expect(result.find((p) => p.id === "p3")?.stock).toBe(-2);
  });

  it("treats a missing/null stock as zero before subtracting", () => {
    const withMissingStock = [{ id: "p4", name: "D", stock: null }];
    const result = applyStockDeltas(withMissingStock, new Map([["p4", 3]]));
    expect(result[0].stock).toBe(-3);
  });

  it("returns the same array reference when nothing was sold", () => {
    const result = applyStockDeltas(products, new Map());
    expect(result).toBe(products);
  });

  it("handles multiple sold products in one sale", () => {
    const sold = new Map([
      ["p1", 1],
      ["p2", 5],
    ]);
    const result = applyStockDeltas(products, sold);
    expect(result.find((p) => p.id === "p1")?.stock).toBe(9);
    expect(result.find((p) => p.id === "p2")?.stock).toBe(0);
  });
});
