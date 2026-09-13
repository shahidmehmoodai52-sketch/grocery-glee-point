// Scrolling "ayat of the day" strip for the app header — replaces the space
// the always-on low-stock banner used to occupy (low stock now lives behind
// a small button; see low-stock-alerts.tsx). Also carries today's date and a
// short business maxim in the same line.
import { useEffect, useState } from "react";
import { getDailyAyat, type DailyAyat } from "@/lib/ayat-of-the-day";
import { getQuoteOfTheDay } from "@/lib/quote-of-the-day";

const TODAY_LABEL = new Date().toLocaleDateString(undefined, {
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
});

export function AyatTicker() {
  const [ayat, setAyat] = useState<DailyAyat | null>(null);

  useEffect(() => {
    let cancelled = false;
    void getDailyAyat().then((a) => {
      if (!cancelled) setAyat(a);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!ayat) return null;

  const line = `${TODAY_LABEL}   •   ${ayat.arabic}   —   ${ayat.urdu}   —   ${ayat.english}   •   "${getQuoteOfTheDay()}"`;

  return (
    <div
      className="no-print flex-1 min-w-0 overflow-hidden text-muted-foreground"
      aria-label="Ayat of the day"
    >
      <div className="ayat-ticker-track">
        <span className="ayat-ticker-item">{line}</span>
        <span className="ayat-ticker-item" aria-hidden="true">
          {line}
        </span>
      </div>
    </div>
  );
}
