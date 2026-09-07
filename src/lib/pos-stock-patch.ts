export type SoldLine = { product_id: string | null; qty: number };

/** Aggregates cart lines into total quantity sold per product, ignoring
 *  lines with no catalog product (e.g. a quick-add line never saved). */
export function computeSoldQtyByProduct(items: SoldLine[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const i of items) {
    if (!i.product_id) continue;
    m.set(i.product_id, (m.get(i.product_id) ?? 0) + Number(i.qty || 0));
  }
  return m;
}

/** Returns a new array with `stock` decremented for whichever products were
 *  sold, leaving every other row (and its object identity) untouched. */
export function applyStockDeltas<T extends { id: string; stock?: number | null }>(
  products: T[],
  soldQtyByProduct: Map<string, number>,
): T[] {
  if (soldQtyByProduct.size === 0) return products;
  return products.map((p) => {
    const sold = soldQtyByProduct.get(p.id);
    if (!sold) return p;
    return { ...p, stock: Number(p.stock ?? 0) - sold };
  });
}
