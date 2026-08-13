let _defaultSymbol = "Rs";

export function setDefaultCurrencySymbol(s?: string | null) {
  const v = (s ?? "").toString().trim();
  if (v) _defaultSymbol = v;
}

export function getDefaultCurrencySymbol() {
  return _defaultSymbol;
}

/** Standard grouped number: 1,234.50 (2 decimals by default). */
export function fmtNumber(n: number | string | null | undefined, decimals = 2) {
  const v = Number(n ?? 0);
  if (!Number.isFinite(v)) return (0).toFixed(decimals);
  return v.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

export function fmtMoney(n: number | string | null | undefined, symbol?: string) {
  const sym = (symbol ?? _defaultSymbol) || "";
  const withSpace = /^[A-Za-z]+$/.test(sym) ? `${sym}. ` : sym;
  return `${withSpace}${fmtNumber(n, 2)}`;
}

export function fmtQty(n: number | string | null | undefined) {
  const v = Number(n ?? 0);
  if (Number.isInteger(v)) return v.toLocaleString("en-US");
  const decimals = Math.min(3, (v.toFixed(3).replace(/0+$/, "").split(".")[1] ?? "").length || 1);
  return v.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}


export function fmtDate(d: string | Date) {
  if (!d) return "—";
  // Force Pakistan Time (UTC+5) for consistent display regardless of local browser settings.
  return new Date(d).toLocaleString("en-GB", {
    timeZone: "Asia/Karachi",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  }).replace(",", "");
}
