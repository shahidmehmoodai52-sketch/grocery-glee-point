import { useState } from "react";
import { startOfDay } from "date-fns";

import { Calendar } from "@/components/ui/calendar";
import { cn } from "@/lib/utils";

/** Date-range calendar where every pick starts fresh: the first click selects
 *  that single day, the second click sets the other end (either order).
 *
 *  react-day-picker's own range mode instead EDITS the range already shown —
 *  with a preset like "This month" (1–7 Nov) selected, clicking 3 Nov gave
 *  1–3 Nov and then clicking 5 Nov gave 1–5 Nov, so the start date "changed
 *  by itself"; clicking the start day again could clear the range. */
export function RangeCalendar({
  from,
  to,
  onChange,
  numberOfMonths = 2,
  className,
}: {
  from?: Date;
  to?: Date;
  onChange: (from: Date, to: Date) => void;
  numberOfMonths?: number;
  className?: string;
}) {
  // Start of a range the user is in the middle of picking. Reset whenever
  // the popover closes, because the calendar unmounts with it.
  const [anchor, setAnchor] = useState<Date | null>(null);

  return (
    <Calendar
      mode="range"
      selected={anchor ? { from: anchor, to: anchor } : { from, to }}
      onSelect={(_range, day) => {
        if (!day) return;
        const picked = startOfDay(day);
        if (!anchor) {
          setAnchor(picked);
          onChange(picked, picked);
          return;
        }
        const [a, b] = picked < anchor ? [picked, anchor] : [anchor, picked];
        setAnchor(null);
        onChange(a, b);
      }}
      defaultMonth={from}
      numberOfMonths={numberOfMonths}
      className={cn("p-3 pointer-events-auto", className)}
    />
  );
}
