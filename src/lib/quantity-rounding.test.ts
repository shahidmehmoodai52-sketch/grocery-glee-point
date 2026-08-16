import { expect, test } from "vitest";
import { roundToTillixQty } from "./quantity-rounding";

test("Tillix quantity rounding rule", () => {
  expect(roundToTillixQty(9)).toBe(9);
  expect(roundToTillixQty(9.01)).toBe(9.5);
  expect(roundToTillixQty(9.49)).toBe(9.5);
  expect(roundToTillixQty(9.50)).toBe(9.5);
  expect(roundToTillixQty(9.51)).toBe(10);
  expect(roundToTillixQty(9.65)).toBe(10);
  expect(roundToTillixQty(9.99)).toBe(10);
  expect(roundToTillixQty(0)).toBe(0);
  expect(roundToTillixQty(0.1)).toBe(0.5);
  expect(roundToTillixQty(0.51)).toBe(1);
});
