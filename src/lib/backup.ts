import { get, set, del } from "idb-keyval";
import { supabase } from "@/integrations/supabase/client";

const DIR_KEY = "backup_dir_handle";
const LAST_KEY = "backup_last_run";
const ENABLED_KEY = "backup_auto_enabled";
const TIME_KEY = "backup_time"; // "HH:MM" 24h, local time

const TABLES = [
  "store_settings", "products", "product_barcodes", "customers", "suppliers",
  "sales", "sale_items", "sale_returns", "sale_return_items",
  "purchases", "purchase_items", "purchase_returns", "purchase_return_items",
  "expenses", "expense_persons", "party_payments", "user_roles", "profiles",
] as const;

export type BackupStatus = {
  hasHandle: boolean;
  dirName: string | null;
  lastRun: string | null;
  autoEnabled: boolean;
  backupTime: string; // "HH:MM"
  permission: "granted" | "prompt" | "denied" | "unknown";
};

export async function getStatus(): Promise<BackupStatus> {
  const handle = await get<FileSystemDirectoryHandle>(DIR_KEY);
  const lastRun = (await get<string>(LAST_KEY)) ?? null;
  const autoEnabled = (await get<boolean>(ENABLED_KEY)) ?? false;
  const backupTime = (await get<string>(TIME_KEY)) ?? "22:00";
  let permission: BackupStatus["permission"] = "unknown";
  if (handle) {
    try {
      // @ts-ignore
      permission = (await handle.queryPermission({ mode: "readwrite" })) ?? "unknown";
    } catch { permission = "unknown"; }
  }
  return {
    hasHandle: !!handle,
    dirName: handle?.name ?? null,
    lastRun,
    autoEnabled,
    backupTime,
    permission,
  };
}

export async function setBackupTime(hhmm: string) {
  await set(TIME_KEY, hhmm);
}


export function isSupported() {
  return typeof window !== "undefined" && "showDirectoryPicker" in window;
}

export async function pickBackupFolder(): Promise<FileSystemDirectoryHandle> {
  // @ts-ignore - File System Access API
  const handle: FileSystemDirectoryHandle = await window.showDirectoryPicker({
    id: "pos-backup",
    mode: "readwrite",
    startIn: "documents",
  });
  await set(DIR_KEY, handle);
  await set(ENABLED_KEY, true);
  return handle;
}

export async function clearBackupFolder() {
  await del(DIR_KEY);
  await set(ENABLED_KEY, false);
}

export async function setAutoEnabled(v: boolean) {
  await set(ENABLED_KEY, v);
}

async function verifyPermission(handle: FileSystemDirectoryHandle): Promise<boolean> {
  // @ts-ignore
  const opts = { mode: "readwrite" };
  // @ts-ignore
  if ((await handle.queryPermission(opts)) === "granted") return true;
  // @ts-ignore
  if ((await handle.requestPermission(opts)) === "granted") return true;
  return false;
}

async function fetchAll(table: string): Promise<any[]> {
  const out: any[] = [];
  const PAGE = 1000;
  let from = 0;
  for (;;) {
    const { data, error } = await supabase
      .from(table as any)
      .select("*")
      .range(from, from + PAGE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    out.push(...data);
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return out;
}

// A shop's own backup must stay useful for their own bookkeeping (barcode,
// stock, prices, SKU) but must not hand out a clean, ready-to-import
// name+category catalog — that association (whether the shop typed it in
// themselves or pulled it from the shared Global Library) is what makes the
// product data reusable in a competing system. Stripped for every product
// row regardless of origin, since there's no reliable per-row marker of
// which products came from the library. The admin panel's own tenant-export
// (admin_export_tenant_data RPC) is a separate code path and keeps full
// name/category — this restriction is shop-side only.
const REDACT_COLUMNS: Partial<Record<(typeof TABLES)[number], string[]>> = {
  products: ["name", "category"],
};

function redactRows(table: string, rows: any[]): any[] {
  const cols = REDACT_COLUMNS[table as (typeof TABLES)[number]];
  if (!cols) return rows;
  return rows.map((r) => {
    const copy = { ...r };
    for (const c of cols) delete copy[c];
    return copy;
  });
}

export async function buildWorkbookBlob(): Promise<{ blob: Blob; counts: Record<string, number> }> {
  const XLSX = await import("xlsx");
  const wb = XLSX.utils.book_new();
  const counts: Record<string, number> = {};
  for (const t of TABLES) {
    try {
      const rows = redactRows(t, await fetchAll(t));
      counts[t] = rows.length;
      const ws = XLSX.utils.json_to_sheet(rows.length ? rows : [{}]);
      XLSX.utils.book_append_sheet(wb, ws, t.slice(0, 31));
    } catch (e) {
      counts[t] = -1;
    }
  }
  const arr = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  return { blob: new Blob([arr], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), counts };
}

function fileName() {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `pos-backup-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}.xlsx`;
}

export async function runBackup(opts: { silent?: boolean } = {}): Promise<{ ok: boolean; file?: string; error?: string; counts?: Record<string, number> }> {
  const handle = await get<FileSystemDirectoryHandle>(DIR_KEY);
  if (!handle) return { ok: false, error: "No backup folder selected" };
  const granted = await verifyPermission(handle);
  if (!granted) return { ok: false, error: "Permission to write backup folder denied" };

  const { blob, counts } = await buildWorkbookBlob();
  const name = fileName();
  // @ts-ignore
  const fileHandle = await handle.getFileHandle(name, { create: true });
  // @ts-ignore
  const writable = await fileHandle.createWritable();
  await writable.write(blob);
  await writable.close();

  await set(LAST_KEY, new Date().toISOString());
  return { ok: true, file: name, counts };
}

export async function maybeRunDaily(): Promise<void> {
  try {
    if (!isSupported()) return;
    const enabled = (await get<boolean>(ENABLED_KEY)) ?? false;
    if (!enabled) return;
    const handle = await get<FileSystemDirectoryHandle>(DIR_KEY);
    if (!handle) return;
    const hhmm = (await get<string>(TIME_KEY)) ?? "22:00";
    const [hh, mm] = hhmm.split(":").map((n) => parseInt(n, 10));
    if (Number.isNaN(hh) || Number.isNaN(mm)) return;

    const now = new Date();
    const scheduled = new Date(now);
    scheduled.setHours(hh, mm, 0, 0);
    // Not yet reached today's scheduled time.
    if (now.getTime() < scheduled.getTime()) return;

    const last = await get<string>(LAST_KEY);
    if (last) {
      // Already ran after today's scheduled time — skip.
      if (new Date(last).getTime() >= scheduled.getTime()) return;
    }

    // @ts-ignore
    const perm = await handle.queryPermission({ mode: "readwrite" });
    if (perm !== "granted") return; // don't prompt silently; user must visit page
    await runBackup({ silent: true });
  } catch {
    // swallow
  }
}

