import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
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
import { NeedsInternetBanner } from "@/components/needs-internet-banner";

export const Route = createFileRoute("/_authenticated/backup")({
  component: BackupPage,
});


function BackupPage() {
  const { t } = useTranslation();
  const [status, setStatus] = useState<BackupStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const supported = isSupported();
  const inIframe = typeof window !== "undefined" && window.self !== window.top;

  const refresh = async () => setStatus(await getStatus());
  useEffect(() => { refresh(); }, []);


  const pick = async () => {
    try {
      await pickBackupFolder();
      toast.success(t('backup.toast_folder_linked', 'Backup folder linked'));
      await refresh();
    } catch (e: any) {
      if (e?.name !== "AbortError") toast.error(e?.message ?? t('backup.toast_could_not_select_folder', 'Could not select folder'));
    }
  };

  const run = async () => {
    setBusy(true);
    try {
      const r = await runBackup();
      if (r.ok) toast.success(t('backup.toast_backup_saved', 'Backup saved: {{file}}', { file: r.file }));
      else toast.error(r.error ?? t('backup.toast_backup_failed', 'Backup failed'));
      await refresh();
    } catch (e: any) {
      toast.error(e?.message ?? t('backup.toast_backup_failed', 'Backup failed'));
    } finally { setBusy(false); }
  };

  const toggle = async (v: boolean) => { await setAutoEnabled(v); await refresh(); };
  const unlink = async () => { await clearBackupFolder(); toast.message(t('backup.toast_folder_unlinked', 'Folder unlinked')); await refresh(); };
  const onTimeChange = async (v: string) => { await setBackupTime(v); await refresh(); };


  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      <NeedsInternetBanner section={t('backup.page_title', 'Auto Backup')} />
      <div>
        <h1 className="text-2xl font-semibold">{t('backup.page_title', 'Auto Backup')}</h1>
        <p className="text-sm text-muted-foreground">
          {t('backup.page_desc', 'Pick a folder on this PC. The full database is exported to an Excel file there — automatically once a day, and any time you press Backup now. Files stay on your PC even if Windows is reinstalled (use a Drive / OneDrive / external disk folder for safest results).')}
        </p>
      </div>

      {!supported && (
        <Card className="border-destructive/50">
          <CardContent className="flex items-start gap-3 pt-6">
            <AlertTriangle className="h-5 w-5 text-destructive shrink-0" />
            <div className="text-sm">
              {t('backup.unsupported_prefix', 'This browser doesn\'t support direct folder access. Open the POS in ')}<b>Chrome</b>{t('backup.list_sep_comma', ', ')}<b>Edge</b>{t('backup.list_sep_or', ', or ')}<b>Brave</b>{t('backup.unsupported_suffix', ' on desktop to enable auto-backup to a PC folder.')}
            </div>
          </CardContent>
        </Card>
      )}

      {supported && inIframe && (
        <Card className="border-warning/50 bg-warning/5">
          <CardContent className="flex items-start gap-3 pt-6">
            <AlertTriangle className="h-5 w-5 text-warning shrink-0" />
            <div className="text-sm flex-1 space-y-2">
              <div>
                <b>{t('backup.iframe_warning_bold', 'Folder picker preview me kaam nahi karega.')}</b>{t('backup.iframe_warning_rest', ' Browser security wajah se iframe ke andar folder select nahi ho sakta. App ko naye tab me kholiye — wahan folder select karke daily auto-backup enable ho jayega.')}
              </div>
              <Button size="sm" variant="outline" onClick={() => window.open(window.location.href, "_blank", "noopener")}>
                {t('backup.open_in_new_tab', 'Open backup in new tab')}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}


      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><FolderOpen className="h-5 w-5" /> {t('backup.section_title', 'Backup folder')}</CardTitle>
          <CardDescription>{t('backup.section_desc', 'The Excel file will be saved here daily.')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between gap-4">
            <div className="text-sm">
              {status?.hasHandle ? (
                <div className="flex items-center gap-2">
                  <Badge variant="secondary" className="gap-1"><ShieldCheck className="h-3 w-3" /> {t('backup.linked_badge', 'Linked')}</Badge>
                  <span className="font-mono">{status.dirName}</span>
                </div>
              ) : (
                <span className="text-muted-foreground">{t('backup.no_folder_selected', 'No folder selected yet.')}</span>
              )}
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={pick} disabled={!supported}>
                {status?.hasHandle ? t('backup.change_folder', 'Change folder') : t('backup.select_folder', 'Select folder')}
              </Button>
              {status?.hasHandle && (
                <Button variant="ghost" onClick={unlink}>{t('backup.unlink', 'Unlink')}</Button>
              )}
            </div>
          </div>

          <div className="flex items-center justify-between border-t pt-4">
            <div className="space-y-0.5">
              <Label className="text-sm">{t('backup.daily_auto_backup', 'Daily auto-backup')}</Label>
              <p className="text-xs text-muted-foreground">{t('backup.daily_auto_backup_desc', 'Runs automatically at the scheduled time — as long as the app is open.')}</p>
            </div>
            <Switch checked={!!status?.autoEnabled} onCheckedChange={toggle} disabled={!status?.hasHandle} />
          </div>

          <div className="flex items-center justify-between border-t pt-4 gap-4">
            <div className="space-y-0.5">
              <Label className="text-sm flex items-center gap-1.5"><Clock className="h-4 w-4" />{t('backup.backup_time_label', 'Backup time (daily)')}</Label>
              <p className="text-xs text-muted-foreground">{t('backup.backup_time_desc', 'Local time on this PC. Runs when the app is open at or after this time each day.')}</p>
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
                {t('backup.permission_warning_prefix', 'Browser lost write permission for the folder (this happens after a restart). Click ')}<b>{t('backup.backup_now', 'Backup now')}</b>{t('backup.permission_warning_suffix', ' once so Windows grants access again — after that daily backup will run silently.')}
              </div>
            </div>
          )}


          <div className="flex items-center justify-between border-t pt-4">
            <div className="text-sm">
              <div className="text-muted-foreground">{t('backup.last_backup_label', 'Last backup')}</div>
              <div className="font-medium">{status?.lastRun ? new Date(status.lastRun).toLocaleString() : t('backup.never', 'Never')}</div>
            </div>
            <div className="flex gap-2">
              <Button variant="ghost" size="icon" onClick={refresh}><RefreshCw className="h-4 w-4" /></Button>
              <Button onClick={run} disabled={!status?.hasHandle || busy} className="gap-2">
                <HardDriveDownload className="h-4 w-4" /> {busy ? t('backup.backing_up', 'Backing up...') : t('backup.backup_now', 'Backup now')}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('backup.included_title', "What's included")}</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          {t('backup.included_desc_prefix', 'Products & barcodes, customers, suppliers, sales & items, sale returns, purchases & items, purchase returns, expenses & persons, payments, store settings, user roles. Each goes to its own sheet in a single dated ')}<code>.xlsx</code>{t('backup.included_desc_mid', ' file (e.g. ')}<code>pos-backup-20260629-1430.xlsx</code>{t('backup.included_desc_suffix', ').')}
        </CardContent>
      </Card>
    </div>
  );
}
