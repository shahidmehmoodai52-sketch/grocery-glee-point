// Daily business/trade-honesty ayat for the header ticker.
//
// Only (surah, ayah) reference numbers live here — never the Arabic text or
// its translations. Those are fetched from a public Quran API at render time
// and cached for the day, so this feature can never introduce a
// transcription error into scripture; the API is the single source of truth
// for the actual wording.
const BUSINESS_AYAT_REFS: { surah: number; ayah: number }[] = [
  { surah: 17, ayah: 35 }, // Al-Isra — give full measure, weigh with an even balance
  { surah: 55, ayah: 9 }, // Ar-Rahman — establish weight in justice
  { surah: 26, ayah: 181 }, // Ash-Shu'ara — give full measure
  { surah: 26, ayah: 182 }, // Ash-Shu'ara — weigh with an even balance
  { surah: 9, ayah: 119 }, // At-Tawbah — be with the truthful
  { surah: 4, ayah: 29 }, // An-Nisa — trade by mutual consent, don't consume others' wealth unjustly
];

export interface DailyAyat {
  dateKey: string;
  surah: number;
  ayah: number;
  arabic: string;
  urdu: string;
  english: string;
}

const CACHE_KEY = "tillix:ayat-of-the-day";

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

function pickTodaysReference(): { surah: number; ayah: number } {
  const dayOfYear = Math.floor(
    (Date.now() - new Date(new Date().getFullYear(), 0, 0).getTime()) / 86_400_000,
  );
  return BUSINESS_AYAT_REFS[dayOfYear % BUSINESS_AYAT_REFS.length];
}

function readCache(): DailyAyat | null {
  try {
    const raw = window.localStorage.getItem(CACHE_KEY);
    return raw ? (JSON.parse(raw) as DailyAyat) : null;
  } catch {
    return null;
  }
}

function writeCache(v: DailyAyat) {
  try {
    window.localStorage.setItem(CACHE_KEY, JSON.stringify(v));
  } catch {
    // Best effort only.
  }
}

async function fetchFromApi(ref: { surah: number; ayah: number }): Promise<DailyAyat | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 6000);
  try {
    const res = await fetch(
      `https://api.alquran.cloud/v1/ayah/${ref.surah}:${ref.ayah}/editions/quran-uthmani,ur.jalandhry,en.sahih`,
      { signal: ctrl.signal, cache: "no-store" },
    );
    if (!res.ok) return null;
    const json: { data?: { text?: string; edition?: { identifier?: string } }[] } = await res.json();
    const editions = Array.isArray(json?.data) ? json.data : [];
    const arabic = editions.find((e) => e?.edition?.identifier === "quran-uthmani")?.text;
    const urdu = editions.find((e) => e?.edition?.identifier === "ur.jalandhry")?.text;
    const english = editions.find((e) => e?.edition?.identifier === "en.sahih")?.text;
    if (!arabic || !urdu || !english) return null;
    return { dateKey: todayKey(), surah: ref.surah, ayah: ref.ayah, arabic, urdu, english };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Returns today's ayat, refetching once per day and caching the result so
 *  the header never blocks on network and still shows something (yesterday's
 *  ayat) while offline. Returns null only when nothing has ever been cached
 *  and the live fetch also failed — the ticker then simply doesn't render. */
export async function getDailyAyat(): Promise<DailyAyat | null> {
  const cached = readCache();
  const wantRef = pickTodaysReference();
  const cacheIsFresh =
    cached && cached.dateKey === todayKey() && cached.surah === wantRef.surah && cached.ayah === wantRef.ayah;
  if (cacheIsFresh) return cached;

  const fresh = await fetchFromApi(wantRef);
  if (fresh) {
    writeCache(fresh);
    return fresh;
  }
  return cached;
}
