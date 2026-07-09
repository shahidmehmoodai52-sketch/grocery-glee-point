export function fmtMoney(n: number | string | null | undefined, symbol = "$") {
  const v = Number(n ?? 0);
  const sym = /^[A-Za-z]+$/.test(symbol) ? `${symbol}. ` : symbol;
  return `${sym}${v.toFixed(2)}`;
}

export function fmtQty(n: number | string | null | undefined) {
  const v = Number(n ?? 0);
  return Number.isInteger(v) ? v.toString() : v.toFixed(3).replace(/\.?0+$/, "");
}

export function fmtDate(d: string | Date) {
  return new Date(d).toLocaleString();
}
