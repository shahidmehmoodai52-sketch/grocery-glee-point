import { localDayEndIso, localDayStartIso } from "@/lib/date-presets";

type Row = { date: string; debit: number; credit: number };

const ts = (d: string) => new Date(d).getTime();

/** Entry falls inside the shop-local day range [from, to] (YYYY-MM-DD, either may be ""). */
export function inLocalRange(date: string, from: string, to: string): boolean {
  const t = ts(date);
  if (from && t < ts(localDayStartIso(from))) return false;
  if (to && t > ts(localDayEndIso(to))) return false;
  return true;
}

/** Entry is before the shop-local start of `from`. */
export function beforeLocalDay(date: string, from: string): boolean {
  return !!from && ts(date) < ts(localDayStartIso(from));
}

export type PrevMonthSummary = {
  /** e.g. "October 2026" */
  label: string;
  /** e.g. "31 Oct" — the day its closing is struck */
  closingDay: string;
  opening: number;
  totalIn: number;
  totalOut: number;
  closing: number;
};

/** When the range starts on the 1st of a month, summarise the calendar month
 *  before it: its opening, in/out and closing (= this range's opening). */
export function previousMonthSummary(entries: Row[], initialOB: number, from: string): PrevMonthSummary | null {
  const m = /^(\d{4})-(\d{2})-01$/.exec(from);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1;
  const start = new Date(y, mo - 1, 1);
  const end = new Date(y, mo, 0);
  const pad = (n: number) => String(n).padStart(2, "0");
  const startYmd = `${start.getFullYear()}-${pad(start.getMonth() + 1)}-01`;

  let opening = initialOB;
  let totalIn = 0;
  let totalOut = 0;
  for (const x of entries) {
    if (beforeLocalDay(x.date, startYmd)) opening += x.debit - x.credit;
    else if (beforeLocalDay(x.date, from)) { totalIn += x.debit; totalOut += x.credit; }
  }
  return {
    label: start.toLocaleDateString("en-GB", { month: "long", year: "numeric" }),
    closingDay: end.toLocaleDateString("en-GB", { day: "numeric", month: "short" }),
    opening,
    totalIn,
    totalOut,
    closing: opening + totalIn - totalOut,
  };
}
