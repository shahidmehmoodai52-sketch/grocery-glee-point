import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { FolderOpen, RefreshCw, History } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { db } from "@/lib/offline/db";
import { describeQueueItem, enqueueWrite } from "@/lib/offline/sync";
import { journalAvailable, journalOpenFolder, journalRead, unsyncedFromJournal } from "@/lib/offline/journal";

type Unsynced = ReturnType<typeof unsyncedFromJournal>[number];

/** Desktop app only: the on-disk copy of offline writes, and a way to queue
 *  again any write the journal never saw upload (e.g. after the browser
 *  storage holding the sync queue was cleared). */
export function OfflineJournalCard() {
  const { t } = useTranslation();
  const [dir, setDir] = useState<string | null>(null);
  const [rows, setRows] = useState<(Unsynced & { inQueue: boolean })[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const res = await journalRead(3);
      if (!res) return;
      setDir(res.dir);
      const pending = unsyncedFromJournal(res.entries);
      const withQueue = await Promise.all(pending.map(async (e) => {
        let inQueue = false;
        try { inQueue = !!(await db()._queue.where("client_uuid").equals(e.client_uuid).first()); } catch { /* ignore */ }
        return { ...e, inQueue };
      }));
      setRows(withQueue);
      setSelected(new Set());
    } catch (e: any) {
      toast.error(e?.message ?? String(e));
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { if (journalAvailable()) void load(); }, []);

  if (!journalAvailable()) return null;

  const missing = rows.filter((r) => !r.inQueue);
  const requeue = async () => {
    const pick = missing.filter((r) => selected.has(r.client_uuid));
    if (!pick.length) return;
    setBusy(true);
    let n = 0;
    try {
      for (const r of pick) {
        await enqueueWrite({ op: r.op as any, table: r.table, payload: r.payload, client_uuid: r.client_uuid, tenant_id: r.tenant_id });
        n++;
      }
      toast.success(t('backup.journal_requeued', '{{n}} entr(ies) queued again — they will upload on the next sync.', { n }));
    } catch (e: any) {
      toast.error(e?.message ?? String(e));
    } finally {
      setBusy(false);
      await load();
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2"><History className="h-4 w-4" />{t('backup.journal_title', 'Offline journal (this PC)')}</CardTitle>
        <CardDescription>
          {t('backup.journal_desc', 'Every sale, payment or purchase saved while offline is also written to a file on this PC, and marked once it reaches the cloud. If the app\'s browser storage is ever cleared, unsynced entries can be queued again from here.')}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <code className="text-xs bg-muted rounded px-2 py-1 break-all">{dir ?? "…"}</code>
          <Button size="sm" variant="outline" onClick={() => void journalOpenFolder()}><FolderOpen className="h-4 w-4 mr-1" />{t('backup.journal_open', 'Open folder')}</Button>
          <Button size="sm" variant="ghost" onClick={() => void load()} disabled={loading}><RefreshCw className={`h-4 w-4 mr-1 ${loading ? "animate-spin" : ""}`} />{t('backup.journal_refresh', 'Refresh')}</Button>
        </div>
        <div className="text-muted-foreground">
          {t('backup.journal_counts', 'Not yet synced (last 3 months): {{total}} — still waiting in the sync queue: {{queued}}, missing from the queue: {{missing}}', { total: rows.length, queued: rows.length - missing.length, missing: missing.length })}
        </div>
        {missing.length > 0 && (
          <>
            <div className="rounded border border-amber-500/40 bg-amber-500/10 p-2 text-xs">
              {t('backup.journal_warning', 'These entries are in the journal but no longer in the sync queue. Before queuing them again, check they are not already in Sales / Purchases on another PC or the web — an entry that uploaded just as the app crashed would be added twice.')}
            </div>
            <div className="max-h-64 overflow-auto border rounded">
              {missing.map((r) => (
                <label key={r.client_uuid} className="flex items-center gap-2 px-2 py-1 border-b last:border-b-0 text-xs cursor-pointer">
                  <Checkbox
                    checked={selected.has(r.client_uuid)}
                    onCheckedChange={(v) => setSelected((s) => { const n = new Set(s); v ? n.add(r.client_uuid) : n.delete(r.client_uuid); return n; })}
                  />
                  <span className="tabular-nums text-muted-foreground w-40 shrink-0">{new Date(r.at).toLocaleString()}</span>
                  <span className="font-medium">{describeQueueItem(r)}</span>
                </label>
              ))}
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => setSelected(new Set(missing.map((r) => r.client_uuid)))}>{t('backup.journal_select_all', 'Select all')}</Button>
              <Button size="sm" onClick={() => void requeue()} disabled={busy || selected.size === 0}>
                {busy ? t('common.saving', 'Saving…') : t('backup.journal_requeue', 'Queue selected again ({{n}})', { n: selected.size })}
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
