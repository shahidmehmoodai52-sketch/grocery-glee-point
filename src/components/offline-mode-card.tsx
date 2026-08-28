// Settings card — shows offline/sync status. Offline mode is always on:
// the app auto-caches data and auto-syncs when internet returns.

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { HardDrive, WifiOff, RefreshCw, Trash2, CheckCircle2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useOfflineStatus } from "@/lib/offline/status";
import { runSync, wipeLocalMirror } from "@/lib/offline/sync";
import { db } from "@/lib/offline/db";

export function OfflineModeCard() {
  const { t } = useTranslation();
  const s = useOfflineStatus();
  const [busy, setBusy] = useState<null | "sync" | "wipe">(null);
  const supported = typeof indexedDB !== "undefined";

  const syncNow = async () => {
    setBusy("sync");
    try { await runSync(); toast.success(t('settings.sync_complete', 'Sync complete')); }
    catch (e: any) { toast.error(e?.message ?? t('settings.sync_failed', 'Sync failed')); }
    finally { setBusy(null); }
  };

  const clearLocal = async () => {
    if (!confirm(t('settings.wipe_confirm', 'Wipe local offline cache? Pending un-synced writes will be lost.'))) return;
    setBusy("wipe");
    try {
      await wipeLocalMirror();
      toast.success(t('settings.cache_cleared', 'Local cache cleared'));
    } catch (e: any) {
      toast.error(e?.message ?? t('settings.cache_clear_failed', 'Failed to clear cache'));
    } finally { setBusy(null); }
  };

  const openIndexedDbInfo = async () => {
    try {
      const counts: Record<string, number> = {};
      for (const tbl of ["products", "customers", "suppliers", "sales", "sale_items", "purchases", "purchase_items", "expenses"]) {
        try { counts[tbl] = await (db() as any)[tbl].count(); } catch { counts[tbl] = -1; }
      }
      toast.message(t('settings.cache_rows_title', 'Local cache rows'), {
        description: Object.entries(counts).map(([k, v]) => `${k}: ${v}`).join(" · "),
      });
    } catch (e: any) {
      toast.error(e?.message ?? t('settings.cache_not_init', 'Cache not initialised'));
    }
  };

  return (
    <Card className="p-5 space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="font-medium flex items-center gap-2">
            <HardDrive className="h-4 w-4" /> {t('settings.offline_mode_heading', 'Offline mode')}
            <span className="text-[10px] rounded-full bg-emerald-500/15 text-emerald-600 border border-emerald-500/30 px-2 py-0.5 font-normal">
              {t('settings.offline_auto_badge', 'Auto — always on')}
            </span>
          </div>
          <p className="text-xs text-muted-foreground mt-1 max-w-md">
            {t('settings.offline_desc', 'App works automatically without internet. Data is cached on this device and any sales / changes made offline sync by themselves as soon as the connection is back — no button to press.')}
          </p>
        </div>
      </div>

      {!supported && (
        <div className="text-xs text-destructive">
          {t('settings.offline_unsupported', 'Your browser does not support the offline storage this app needs (IndexedDB).')}
        </div>
      )}

      <div className="space-y-3 rounded-md border bg-muted/30 p-3">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
          <div>
            <div className="text-muted-foreground">{t('settings.network_label', 'Network')}</div>
            <div className="font-medium flex items-center gap-1">
              {s.online ? <><CheckCircle2 className="h-3 w-3 text-emerald-600" /> {t('settings.online_label', 'Online')}</> : <><WifiOff className="h-3 w-3" /> {t('settings.offline_label', 'Offline')}</>}
            </div>
          </div>
          <div>
            <div className="text-muted-foreground">{t('settings.sync_state_label', 'Sync state')}</div>
            <div className="font-medium capitalize">{t(`settings.phase_${s.phase}`, s.phase)}</div>
          </div>
          <div>
            <div className="text-muted-foreground">{t('settings.pending_writes_label', 'Pending writes')}</div>
            <div className="font-medium">{s.pending}</div>
          </div>
          <div>
            <div className="text-muted-foreground">{t('settings.last_synced_label', 'Last synced')}</div>
            <div className="font-medium">
              {s.lastSyncedAt ? new Date(s.lastSyncedAt).toLocaleString() : "—"}
            </div>
          </div>
        </div>
        {s.error && (
          <div className="text-xs text-destructive break-words">{t('settings.last_error_label', 'Last error:')} {s.error}</div>
        )}
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={syncNow} disabled={busy !== null || !s.online}>
            <RefreshCw className={`h-3.5 w-3.5 mr-1 ${busy === "sync" ? "animate-spin" : ""}`} />
            {t('settings.sync_now', 'Sync now')}
          </Button>
          <Button size="sm" variant="ghost" onClick={openIndexedDbInfo}>
            {t('settings.view_cached_rows', 'View cached rows')}
          </Button>
          <Button size="sm" variant="ghost" className="text-destructive" onClick={clearLocal} disabled={busy !== null}>
            <Trash2 className="h-3.5 w-3.5 mr-1" /> {t('settings.wipe_local_cache', 'Wipe local cache')}
          </Button>
        </div>
        <p className="text-[11px] text-muted-foreground leading-relaxed">
          {t('settings.offline_footer_note', 'POS billing, product lookup and past invoices work offline. Reports, admin panel and payments still need internet.')}
        </p>
      </div>
    </Card>
  );
}

