export type DatePreset = "today" | "yesterday" | "this_week" | "last_week" | "this_month" | "last_month" | "this_year" | "all";

const fmt = (d: Date) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const da = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${da}`;
};

export function rangeFor(preset: DatePreset): { from: string; to: string } {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (preset === "all") return { from: "", to: "" };
  if (preset === "today") return { from: fmt(today), to: fmt(today) };
  if (preset === "yesterday") {
    const y = new Date(today); y.setDate(y.getDate() - 1);
    return { from: fmt(y), to: fmt(y) };
  }
  if (preset === "this_week") {
    const day = today.getDay(); // 0=Sun
    const diff = (day + 6) % 7; // Mon start
    const s = new Date(today); s.setDate(s.getDate() - diff);
    return { from: fmt(s), to: fmt(today) };
  }
  if (preset === "last_week") {
    const day = today.getDay();
    const diff = (day + 6) % 7;
    const s = new Date(today); s.setDate(s.getDate() - diff - 7);
    const e = new Date(s); e.setDate(e.getDate() + 6);
    return { from: fmt(s), to: fmt(e) };
  }
  if (preset === "this_month") {
    const s = new Date(today.getFullYear(), today.getMonth(), 1);
    return { from: fmt(s), to: fmt(today) };
  }
  if (preset === "last_month") {
    const s = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    const e = new Date(today.getFullYear(), today.getMonth(), 0);
    return { from: fmt(s), to: fmt(e) };
  }
  if (preset === "this_year") {
    const s = new Date(today.getFullYear(), 0, 1);
    return { from: fmt(s), to: fmt(today) };
  }
  return { from: "", to: "" };
}

export const PRESETS: { key: DatePreset; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "yesterday", label: "Yesterday" },
  { key: "this_week", label: "This week" },
  { key: "last_week", label: "Last week" },
  { key: "this_month", label: "This month" },
  { key: "last_month", label: "Last month" },
  { key: "this_year", label: "This year" },
  { key: "all", label: "All" },
];
