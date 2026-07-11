import Papa from "papaparse";
import * as XLSX from "xlsx";

type CleanedProduct = {
  name: string;
  barcode: string;
  category: string | null;
  unit: string;
};

type WorkerResult = {
  cleaned: CleanedProduct[];
  skipped: number;
  dupInFile: number;
  totalRows: number;
};

function pickField(row: Record<string, unknown>, keys: string[]): string | null {
  const lowered: Record<string, unknown> = {};
  for (const k of Object.keys(row)) lowered[k.trim().toLowerCase()] = row[k];
  for (const k of keys) {
    const v = lowered[k.toLowerCase()];
    if (v !== undefined && v !== null && String(v).trim() !== "") return String(v).trim();
  }
  return null;
}

function cleanRows(rows: Record<string, unknown>[]): WorkerResult {
  const cleaned: CleanedProduct[] = [];
  const seen = new Set<string>();
  let skipped = 0;
  let dupInFile = 0;

  for (const r of rows) {
    const nm = pickField(r, ["name", "product name", "item", "item name", "title"]);
    const bc = pickField(r, ["barcode", "ean", "upc", "code", "sku"]);
    if (!nm || !bc) {
      skipped++;
    } else if (seen.has(bc)) {
      dupInFile++;
    } else {
      seen.add(bc);
      cleaned.push({
        name: nm,
        barcode: bc,
        category: pickField(r, ["category", "cat", "group"]),
        unit: pickField(r, ["unit", "uom", "unit type"]) ?? "pcs",
      });
    }
  }

  return { cleaned, skipped, dupInFile, totalRows: rows.length };
}

function parseCsv(file: File): Promise<Record<string, unknown>[]> {
  return new Promise((resolve, reject) => {
    Papa.parse<Record<string, unknown>>(file, {
      header: true,
      skipEmptyLines: true,
      complete: (res) => resolve(res.data),
      error: reject,
    });
  });
}

async function parseSpreadsheet(file: File): Promise<Record<string, unknown>[]> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });
}

self.onmessage = async (event: MessageEvent<File>) => {
  try {
    const file = event.data;
    const name = file.name.toLowerCase();
    const rows = name.endsWith(".csv") || name.endsWith(".txt") ? await parseCsv(file) : await parseSpreadsheet(file);
    self.postMessage({ ok: true, ...cleanRows(rows) });
  } catch (err) {
    self.postMessage({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
};

export {};