// Settings card — enable/disable offline mode and view sync status.
// Turn 1: toggle + status + manual sync + wipe local mirror. Full offline read/write
// wiring for POS/purchases/etc. lands in later turns.

import { useState } from "react";
import { toast } from "sonner";
import { HardDrive, WifiOff, RefreshCw, Trash2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { useOfflineStatus, setOfflineEnabled } from "@/lib/offline/status";
import { runSync, wipeLocalMirror } from "@/lib/offline/sync";
import { db } from "@/lib/offline/db";

export function OfflineModeCard() {
  const s = useOfflineStatus();
  const [busy, setBusy] = useState<null | "sync" | "wipe" | "enable">(null);

  const supported = typeof indexedDB !== "undefined";

  const toggle = async (v: boolean) => {
    if (!supported) return toast.error("Offline storage not supported in this browser");
    setBusy("enable");
    try {
      setOfflineEnabled(v);
      if (v) {
        toast.info("Offline mode enabled — syncing your data…");
        await runSync();
        toast.success("Offline data ready. App will now work without internet.");
      } else {
        toast.success("Offline mode disabled");
      }
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to toggle offline mode");
    } finally {
      setBusy(null);
    }
  };

  const syncNow = async () => {
    setBusy("sync");
    try { await runSync(); toast.success("Sync complete"); }
    catch (e: any) { toast.error(e?.message ?? "Sync failed"); }
    finally { setBusy(null); }
  };

  const clearLocal = async () => {
    if (!confirm("Wipe local offline cache? Pending un-synced writes will be lost.")) return;
    setBusy("wipe");
    try {
      await wipeLocalMirror();
      toast.success("Local cache cleared");
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to clear cache");
    } finally { setBusy(null); }
  };

  const openIndexedDbInfo = async () => {
    try {
      const counts: Record<string, number> = {};
      for (const t of ["products", "customers", "suppliers", "sales", "sale_items", "purchases", "purchase_items", "expenses"]) {
        try { counts[t] = await (db() as any)[t].count(); } catch { counts[t] = -1; }
      }
      toast.message("Local cache rows", {
        description: Object.entries(counts).map(([k, v]) => `${k}: ${v}`).join(" · "),
      });
    } catch (e: any) {
      toast.error(e?.message ?? "Cache not initialised");
    }
  };

  return (
    <Card className="p-5 space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="font-medium flex items-center gap-2">
            <HardDrive className="h-4 w-4" /> Offline mode
          </div>
          <p className="text-xs text-muted-foreground mt-1 max-w-md">
            Keep a local copy of your data on this device. POS and core screens keep working
            even without internet — changes sync automatically when you come back online.
          </p>
        </div>
        <Switch checked={s.enabled} onCheckedChange={toggle} disabled={!supported || busy === "enable"} />
      </div>

      {!supported && (
        <div className="text-xs text-destructive">
          Your browser does not support the offline storage this app needs (IndexedDB).
        </div>
      )}

      {s.enabled && (
        <div className="space-y-3 rounded-md border bg-muted/30 p-3">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
            <div>
              <div className="text-muted-foreground">Network</div>
              <div className="font-medium flex items-center gap-1">
                {s.online ? "Online" : <><WifiOff className="h-3 w-3" /> Offline</>}
              </div>
            </div>
            <div>
              <div className="text-muted-foreground">Sync state</div>
              <div className="font-medium capitalize">{s.phase}</div>
            </div>
            <div>
              <div className="text-muted-foreground">Pending writes</div>
              <div className="font-medium">{s.pending}</div>
            </div>
            <div>
              <div className="text-muted-foreground">Last synced</div>
              <div className="font-medium">
                {s.lastSyncedAt ? new Date(s.lastSyncedAt).toLocaleString() : "—"}
              </div>
            </div>
          </div>
          {s.error && (
            <div className="text-xs text-destructive break-words">Last error: {s.error}</div>
          )}
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={syncNow} disabled={busy !== null || !s.online}>
              <RefreshCw className={`h-3.5 w-3.5 mr-1 ${busy === "sync" ? "animate-spin" : ""}`} />
              Sync now
            </Button>
            <Button size="sm" variant="ghost" onClick={openIndexedDbInfo}>
              View cached rows
            </Button>
            <Button size="sm" variant="ghost" className="text-destructive" onClick={clearLocal} disabled={busy !== null}>
              <Trash2 className="h-3.5 w-3.5 mr-1" /> Wipe local cache
            </Button>
          </div>
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            Note: offline currently caches master data (products, customers, suppliers, settings).
            Full offline billing &amp; purchases are being rolled out in stages — you can already
            keep the app open without internet and it will show cached data.
          </p>
        </div>
      )}
    </Card>
  );
}
