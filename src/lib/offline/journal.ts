// Desktop-only offline journal (see electron/main.cjs, "Offline journal").
//
// The sync queue lives in the browser's IndexedDB, which "Clear browsing
// data" or a profile reset can wipe — taking unsynced sales with it. In the
// desktop app every queued write is also appended to a plain file under
// Documents\Tillix\offline-journal, and marked uploaded/cancelled once it
// syncs, so anything still unsynced can be found and queued again.
// In a normal browser there is no file access: every call here is a no-op.

export type JournalEntry =
  | { kind: "queued"; client_uuid: string; at: string; op: string; table: string; payload: any; tenant_id: string | null; device_id: string | null }
  | { kind: "uploaded" | "cancelled"; client_uuid: string; at: string; error?: string };

type JournalApi = {
  append: (entries: JournalEntry[]) => Promise<boolean>;
  read: (monthsBack?: number) => Promise<{ dir: string; entries: JournalEntry[] }>;
  openFolder: () => Promise<string>;
};

function api(): JournalApi | null {
  if (typeof window === "undefined") return null;
  const j = (window as any).pos?.journal;
  return j && typeof j.append === "function" ? (j as JournalApi) : null;
}

export function journalAvailable(): boolean {
  return api() !== null;
}

/** Fire-and-forget: never throws, never blocks the write it records. */
export function journalAppend(entry: JournalEntry): void {
  const j = api();
  if (!j) return;
  try {
    void j.append([entry]).catch(() => { /* disk full / permission — the queue still has it */ });
  } catch { /* ignore */ }
}

export async function journalRead(monthsBack = 3): Promise<{ dir: string; entries: JournalEntry[] } | null> {
  const j = api();
  return j ? j.read(monthsBack) : null;
}

export async function journalOpenFolder(): Promise<void> {
  await api()?.openFolder();
}

/** Writes the journal recorded as queued but never as uploaded/cancelled. */
export function unsyncedFromJournal(entries: JournalEntry[]) {
  const done = new Set<string>();
  for (const e of entries) if (e.kind !== "queued") done.add(e.client_uuid);
  const out = new Map<string, Extract<JournalEntry, { kind: "queued" }>>();
  for (const e of entries) if (e.kind === "queued" && !done.has(e.client_uuid)) out.set(e.client_uuid, e);
  return [...out.values()].sort((a, b) => a.at.localeCompare(b.at));
}
