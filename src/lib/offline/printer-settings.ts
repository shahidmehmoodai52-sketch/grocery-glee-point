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
  updated_at: string;
};

export async function getLocalPrinterSettings(): Promise<LocalPrinterSettings> {
  const existing = await printerSettingsRepo.get("printer");
  if (existing) return existing as LocalPrinterSettings;

  // Defaults
  return {
    id: "printer",
    printer_name: null,
    paper_width: "80mm",
    direct_print_enabled: false,
    print_logo: true,
    receipt_header: null,
    receipt_footer: null,
    pos_print_prompt_enabled: true,
    pos_print_prompt_default: "no",
    updated_at: new Date().toISOString(),
  };
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
