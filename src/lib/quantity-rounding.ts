/**
 * Tillix Quantity Rounding Rule:
 * - Whole number -> same
 * - Decimal 0 to <= 0.50 -> next .5
 * - Decimal > 0.50 -> next whole number
 * 
 * Examples:
 * 9 -> 9
 * 9.01 -> 9.5
 * 9.49 -> 9.5
 * 9.50 -> 9.5
 * 9.51 -> 10
 * 9.65 -> 10
 * 9.99 -> 10
 */
export function roundToTillixQty(qty: number): number {
  if (!Number.isFinite(qty)) return 0;
  if (Number.isInteger(qty)) return qty;
  
  const floor = Math.floor(qty);
  const decimal = qty - floor;
  
  // boundary 0.00000000001 to handle floating point precision
  if (decimal <= 0.00000000001) return floor;
  if (decimal <= 0.50000000001) return floor + 0.5;
  return floor + 1;
}
