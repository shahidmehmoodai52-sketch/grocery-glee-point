// Pakistan Time (UTC+5) business-day boundaries.
// Reports/Dashboard must anchor day ranges to PKT calendar days regardless of
// the browser's local timezone, otherwise timestamptz filters leak the
// previous/next day into the selected business date.

const PKT_OFFSET_MS = 5 * 60 * 60 * 1000;

function parts(d: Date | string): [number, number, number] {
  if (typeof d === "string") {
    const [y, m, da] = d.slice(0, 10).split("-").map(Number);
    return [y, m, da];
  }
  return [d.getFullYear(), d.getMonth() + 1, d.getDate()];
}

/** 00:00:00.000 PKT of the given calendar date, as a UTC ISO string. */
export function pktStartISO(d: Date | string): string {
  const [y, m, da] = parts(d);
  return new Date(Date.UTC(y, m - 1, da, 0, 0, 0, 0) - PKT_OFFSET_MS).toISOString();
}

/** 23:59:59.999 PKT of the given calendar date, as a UTC ISO string. */
export function pktEndISO(d: Date | string): string {
  const [y, m, da] = parts(d);
  return new Date(Date.UTC(y, m - 1, da, 23, 59, 59, 999) - PKT_OFFSET_MS).toISOString();
}

/** Today's calendar date in PKT as YYYY-MM-DD. */
export function pktToday(): string {
  return new Date(Date.now() + PKT_OFFSET_MS).toISOString().slice(0, 10);
}
