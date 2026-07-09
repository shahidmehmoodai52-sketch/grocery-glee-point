import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { FolderOpen, HardDriveDownload, ShieldCheck, AlertTriangle, RefreshCw, Clock } from "lucide-react";
import {
  getStatus, pickBackupFolder, clearBackupFolder, runBackup,
  setAutoEnabled, setBackupTime, isSupported, type BackupStatus,
} from "@/lib/backup";

export const Route = createFileRoute("/_authenticated/backup")({
  component: BackupPage,
});


function BackupPage() {
  const [status, setStatus] = useState<BackupStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const supported = isSupported();

  const refresh = async () => setStatus(await getStatus());
  useEffect(() => { refresh(); }, []);

  const pick = async () => {
    try {
      await pickBackupFolder();
      toast.success("Backup folder linked");
      await refresh();
    } catch (e: any) {
      if (e?.name !== "AbortError") toast.error(e?.message ?? "Could not select folder");
    }
  };

  const run = async () => {
    setBusy(true);
    try {
      const r = await runBackup();
      if (r.ok) toast.success(`Backup saved: ${r.file}`);
      else toast.error(r.error ?? "Backup failed");
      await refresh();
    } catch (e: any) {
      toast.error(e?.message ?? "Backup failed");
    } finally { setBusy(false); }
  };

  const toggle = async (v: boolean) => { await setAutoEnabled(v); await refresh(); };
  const unlink = async () => { await clearBackupFolder(); toast.message("Folder unlinked"); await refresh(); };
  const onTimeChange = async (v: string) => { await setBackupTime(v); await refresh(); };


  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Auto Backup</h1>
        <p className="text-sm text-muted-foreground">
          Pick a folder on this PC. The full database is exported to an Excel file there — automatically once a day, and any time you press Backup now. Files stay on your PC even if Windows is reinstalled (use a Drive / OneDrive / external disk folder for safest results).
        </p>
      </div>

      {!supported && (
        <Card className="border-destructive/50">
          <CardContent className="flex items-start gap-3 pt-6">
            <AlertTriangle className="h-5 w-5 text-destructive shrink-0" />
            <div className="text-sm">
              This browser doesn't support direct folder access. Open the POS in <b>Chrome</b>, <b>Edge</b>, or <b>Brave</b> on desktop to enable auto-backup to a PC folder.
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><FolderOpen className="h-5 w-5" /> Backup folder</CardTitle>
          <CardDescription>The Excel file will be saved here daily.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between gap-4">
            <div className="text-sm">
              {status?.hasHandle ? (
                <div className="flex items-center gap-2">
                  <Badge variant="secondary" className="gap-1"><ShieldCheck className="h-3 w-3" /> Linked</Badge>
                  <span className="font-mono">{status.dirName}</span>
                </div>
              ) : (
                <span className="text-muted-foreground">No folder selected yet.</span>
              )}
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={pick} disabled={!supported}>
                {status?.hasHandle ? "Change folder" : "Select folder"}
              </Button>
              {status?.hasHandle && (
                <Button variant="ghost" onClick={unlink}>Unlink</Button>
              )}
            </div>
          </div>

          <div className="flex items-center justify-between border-t pt-4">
            <div className="space-y-0.5">
              <Label className="text-sm">Daily auto-backup</Label>
              <p className="text-xs text-muted-foreground">Runs automatically at the scheduled time — as long as the app is open.</p>
            </div>
            <Switch checked={!!status?.autoEnabled} onCheckedChange={toggle} disabled={!status?.hasHandle} />
          </div>

          <div className="flex items-center justify-between border-t pt-4 gap-4">
            <div className="space-y-0.5">
              <Label className="text-sm flex items-center gap-1.5"><Clock className="h-4 w-4" />Backup time (daily)</Label>
              <p className="text-xs text-muted-foreground">Local time on this PC. Runs when the app is open at or after this time each day.</p>
            </div>
            <Input
              type="time"
              value={status?.backupTime ?? "22:00"}
              onChange={(e) => onTimeChange(e.target.value)}
              disabled={!status?.hasHandle}
              className="w-32"
            />
          </div>

          {status?.hasHandle && status.permission !== "granted" && (
            <div className="flex items-start gap-2 border-t pt-4 text-xs text-warning">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
              <div>
                Browser lost write permission for the folder (this happens after a restart). Click <b>Backup now</b> once so Windows grants access again — after that daily backup will run silently.
              </div>
            </div>
          )}


          <div className="flex items-center justify-between border-t pt-4">
            <div className="text-sm">
              <div className="text-muted-foreground">Last backup</div>
              <div className="font-medium">{status?.lastRun ? new Date(status.lastRun).toLocaleString() : "Never"}</div>
            </div>
            <div className="flex gap-2">
              <Button variant="ghost" size="icon" onClick={refresh}><RefreshCw className="h-4 w-4" /></Button>
              <Button onClick={run} disabled={!status?.hasHandle || busy} className="gap-2">
                <HardDriveDownload className="h-4 w-4" /> {busy ? "Backing up..." : "Backup now"}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">What's included</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Products & barcodes, customers, suppliers, sales & items, sale returns, purchases & items, purchase returns, expenses & persons, payments, store settings, user roles. Each goes to its own sheet in a single dated <code>.xlsx</code> file (e.g. <code>pos-backup-20260629-1430.xlsx</code>).
        </CardContent>
      </Card>
    </div>
  );
}
