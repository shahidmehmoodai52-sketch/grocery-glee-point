import { Table } from "dexie";
import { db } from "./db";
import { LocalRepository, printerSettingsRepo } from "./repo";

export type LocalPrinterSettings = {
  id: "printer";
  printer_name: string | null;
  paper_width: "58mm" | "80mm" | "A4";
  direct_print_enabled: boolean;
  print_logo: boolean;
  receipt_header: string | null;
  receipt_footer: string | null;
  pos_print_prompt_enabled: boolean;
  pos_print_prompt_default: "yes" | "no";
  /** Copies to print per receipt. Only takes effect on the Electron direct-print
   *  bridge — a browser's own print dialog lets the user pick copies itself. */
  print_copies: number;
  /** Best-effort: sends the standard ESC/POS drawer-kick pulse before the print
   *  job. Whether it actually opens the drawer depends on the printer/driver
   *  passing that byte sequence through — not guaranteed on every setup. */
  cash_drawer_kick: boolean;
  /** Percentage scale applied to the whole receipt (100 = normal size). */
  font_scale: number;
  /** Left/right receipt margin in millimetres. */
  receipt_margin_mm: number;
  updated_at: string;
};

const DEFAULT_PRINTER_SETTINGS: LocalPrinterSettings = {
  id: "printer",
  printer_name: null,
  paper_width: "80mm",
  direct_print_enabled: false,
  print_logo: true,
  receipt_header: null,
  receipt_footer: null,
  pos_print_prompt_enabled: true,
  pos_print_prompt_default: "no",
  print_copies: 1,
  cash_drawer_kick: false,
  font_scale: 100,
  receipt_margin_mm: 2.5,
  updated_at: new Date().toISOString(),
};

export async function getLocalPrinterSettings(): Promise<LocalPrinterSettings> {
  const existing = await printerSettingsRepo.get("printer");
  // Merge onto the defaults so a row saved before these fields existed still
  // gets sane values instead of `undefined` for the new ones.
  if (existing) {
    return { ...DEFAULT_PRINTER_SETTINGS, ...(existing as Partial<LocalPrinterSettings>) };
  }
  return { ...DEFAULT_PRINTER_SETTINGS };
}

export async function saveLocalPrinterSettings(settings: Partial<LocalPrinterSettings>) {
  const current = await getLocalPrinterSettings();
  const next = {
    ...current,
    ...settings,
    id: "printer" as const,
    updated_at: new Date().toISOString(),
  };
  await printerSettingsRepo.upsert(next);
  return next;
}
