// Daily business/trade-honesty ayat for the header ticker.
//
// Only (surah, ayah) reference numbers live here — never the Arabic text or
// its translations. Those are fetched from a public Quran API at render time
// and cached for the day, so this feature can never introduce a
// transcription error into scripture; the API is the single source of truth
// for the actual wording.
// 30 references so a full month cycles without repeats. Kept to themes of
// honest trade, fulfilling contracts, trustworthiness, hard work, patience,
// and gratitude — each picked for being short and a single self-contained
// ayah (no surrounding context needed to make sense on its own).
const BUSINESS_AYAT_REFS: { surah: number; ayah: number }[] = [
  { surah: 17, ayah: 34 }, // Al-Isra — fulfill every commitment
  { surah: 17, ayah: 35 }, // Al-Isra — give full measure, weigh with an even balance
  { surah: 5, ayah: 1 }, // Al-Ma'idah — fulfill [all] contracts
  { surah: 55, ayah: 9 }, // Ar-Rahman — establish weight in justice
  { surah: 26, ayah: 181 }, // Ash-Shu'ara — give full measure
  { surah: 26, ayah: 182 }, // Ash-Shu'ara — weigh with an even balance
  { surah: 26, ayah: 183 }, // Ash-Shu'ara — do not deprive people of their due
  { surah: 4, ayah: 29 }, // An-Nisa — trade by mutual consent, don't consume others' wealth unjustly
  { surah: 9, ayah: 119 }, // At-Tawbah — be with the truthful
  { surah: 16, ayah: 91 }, // An-Nahl — fulfill the covenant of Allah
  { surah: 83, ayah: 1 }, // Al-Mutaffifin — woe to the defrauders
  { surah: 33, ayah: 70 }, // Al-Ahzab — speak words of appropriate justice
  { surah: 2, ayah: 42 }, // Al-Baqarah — do not mix truth with falsehood
  { surah: 62, ayah: 10 }, // Al-Jumu'ah — disperse and seek from Allah's bounty
  { surah: 53, ayah: 39 }, // An-Najm — man gets only what he strives for
  { surah: 2, ayah: 153 }, // Al-Baqarah — seek help through patience and prayer
  { surah: 94, ayah: 5 }, // Ash-Sharh — with hardship comes ease
  { surah: 94, ayah: 6 }, // Ash-Sharh — with hardship comes ease (repeated)
  { surah: 14, ayah: 7 }, // Ibrahim — if you are grateful, I will increase you
  { surah: 65, ayah: 3 }, // At-Talaq — provides from where he does not expect
  { surah: 4, ayah: 58 }, // An-Nisa — render trusts to whom due, judge with justice
  { surah: 16, ayah: 90 }, // An-Nahl — Allah orders justice and good conduct
  { surah: 2, ayah: 168 }, // Al-Baqarah — eat what is lawful and good
  { surah: 2, ayah: 188 }, // Al-Baqarah — do not consume wealth unjustly or by bribery
  { surah: 23, ayah: 8 }, // Al-Mu'minun — attentive to their trusts and promises
  { surah: 3, ayah: 92 }, // Aal-e-Imran — righteousness through spending what you love
  { surah: 104, ayah: 1 }, // Al-Humazah — woe to every scorner who [only] hoards wealth
  { surah: 41, ayah: 34 }, // Fussilat — repel evil with what is better
  { surah: 3, ayah: 159 }, // Aal-e-Imran — gentleness in dealing with people
  { surah: 17, ayah: 26 }, // Al-Isra — give the relative his right, and do not squander wastefully
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
