// Scrolling "ayat of the day" strip for the app header — replaces the space
// the always-on low-stock banner used to occupy (low stock now lives behind
// a small button; see low-stock-alerts.tsx). Also carries today's date and a
// short business maxim in the same line.
import { useEffect, useState } from "react";
import { BookOpen, CalendarDays } from "lucide-react";
import { getDailyAyat, type DailyAyat } from "@/lib/ayat-of-the-day";
import { getQuoteOfTheDay } from "@/lib/quote-of-the-day";

const TODAY_LABEL = new Date().toLocaleDateString(undefined, {
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
});

function TickerContent({ ayat, quote, hidden }: { ayat: DailyAyat; quote: string; hidden?: boolean }) {
  return (
    <span
      className="ayat-ticker-item inline-flex items-center gap-2.5"
      aria-hidden={hidden || undefined}
    >
      <CalendarDays className="h-3 w-3 shrink-0 text-primary/70" />
      <span className="text-[11px] text-muted-foreground/80 shrink-0">{TODAY_LABEL}</span>
      <span className="text-primary/30">•</span>
      {/* Ayat first — Arabic, then Urdu translation, then English. Each
          segment gets its own dir/lang so the browser's bidi algorithm
          doesn't try to reorder Arabic/Urdu (RTL) against the surrounding
          LTR page and English text. */}
      <BookOpen className="h-3.5 w-3.5 shrink-0 text-primary" />
      <span dir="rtl" lang="ar" className="font-arabic text-sm font-semibold text-foreground">
        {ayat.arabic}
      </span>
      <span className="text-muted-foreground/60">—</span>
      <span dir="rtl" lang="ur" className="text-foreground/85">
        {ayat.urdu}
      </span>
      <span className="text-muted-foreground/60">—</span>
      <span dir="ltr" lang="en" className="italic text-muted-foreground">
        {ayat.english}
      </span>
      <span className="text-primary/30">•</span>
      <span className="italic text-muted-foreground/90">&ldquo;{quote}&rdquo;</span>
    </span>
  );
}

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
  const quote = getQuoteOfTheDay();

  return (
    <div
      className="ayat-ticker-viewport no-print flex-1 min-w-0 overflow-hidden rounded-full border border-primary/20 bg-primary/10 px-3 py-1.5"
      aria-label="Ayat of the day"
    >
      <div className="ayat-ticker-track">
        <TickerContent ayat={ayat} quote={quote} />
        <TickerContent ayat={ayat} quote={quote} hidden />
      </div>
    </div>
  );
}
