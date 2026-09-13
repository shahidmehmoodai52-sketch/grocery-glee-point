// Scrolling "ayat of the day" strip for the app header — replaces the space
// the always-on low-stock banner used to occupy (low stock now lives behind
// a small button; see low-stock-alerts.tsx).
import { useEffect, useState } from "react";
import { getDailyAyat, type DailyAyat } from "@/lib/ayat-of-the-day";

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

  const line = `${ayat.arabic}   —   ${ayat.urdu}   —   ${ayat.english}`;

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
