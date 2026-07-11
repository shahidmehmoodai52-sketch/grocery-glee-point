let _defaultSymbol = "Rs";

export function setDefaultCurrencySymbol(s?: string | null) {
  const v = (s ?? "").toString().trim();
  if (v) _defaultSymbol = v;
}

export function getDefaultCurrencySymbol() {
  return _defaultSymbol;
}

export function fmtMoney(n: number | string | null | undefined, symbol?: string) {
  const v = Number(n ?? 0);
  const sym = (symbol ?? _defaultSymbol) || "";
  const withSpace = /^[A-Za-z]+$/.test(sym) ? `${sym}. ` : sym;
  return `${withSpace}${v.toFixed(2)}`;
}

export function fmtQty(n: number | string | null | undefined) {
  const v = Number(n ?? 0);
  return Number.isInteger(v) ? v.toString() : v.toFixed(3).replace(/\.?0+$/, "");
}

export function fmtDate(d: string | Date) {
  return new Date(d).toLocaleString();
}
