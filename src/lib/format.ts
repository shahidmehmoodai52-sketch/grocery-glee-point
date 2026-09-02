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

/**
 * Formats a quantity for display. This does NOT round to the Tillix
 * quantity rule (nearest 0.5/whole) — that rule is applied explicitly by the
 * input flows that want it (purchases, stock count, product stock edits),
 * at the point of entry. A display formatter re-applying it here used to
 * silently show a different, wrong number for any exact decimal quantity
 * (e.g. 0.75kg of a loose/bulk item shown as "1") on both screen and
 * printed receipts, even though the real qty and total were correct.
 */
export function fmtQty(n: number | string | null | undefined) {
  const v = Number(n ?? 0);
  if (!Number.isFinite(v)) return "0";
  if (Number.isInteger(v)) return v.toLocaleString("en-US");
  return v.toLocaleString("en-US", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 3,
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
