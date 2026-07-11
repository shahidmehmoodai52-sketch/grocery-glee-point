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

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

const HINTS: Record<string, string[]> = {
  name: ["name", "item name", "itemname", "description", "product", "product name", "particulars", "title", "desc"],
  barcode: ["barcode", "bar code", "ean", "upc", "scan", "scancode", "scan code", "sku", "item code", "itemcode", "code", "item no", "item#", "item number", "itemno", "prod code", "product code"],
  category: ["category", "cat", "group", "department"],
  unit: ["unit", "uom", "unit type", "measure"],
};

function buildPicker(headers: string[]) {
  const normed = headers.map((h) => ({ raw: h, n: norm(h) }));
  const map: Record<string, string | null> = {};
  for (const [key, hints] of Object.entries(HINTS)) {
    const nh = hints.map(norm);
    let hit = normed.find((h) => nh.includes(h.n));
    if (!hit) hit = normed.find((h) => nh.some((x) => h.n.includes(x)));
    map[key] = hit ? hit.raw : null;
  }
  return (row: Record<string, unknown>, key: string): string | null => {
    const h = map[key];
    if (!h) return null;
    const v = row[h];
    if (v === undefined || v === null) return null;
    const s = String(v).trim();
    return s === "" ? null : s;
  };
}

function cleanRows(rows: Record<string, unknown>[]): WorkerResult {
  const cleaned: CleanedProduct[] = [];
  const seen = new Set<string>();
  let skipped = 0;
  let dupInFile = 0;

  const headers = rows.length ? Object.keys(rows[0]) : [];
  const pick = buildPicker(headers);

  for (const r of rows) {
    let nm = pick(r, "name");
    let bc = pick(r, "barcode");
    // If only one of name/barcode present, use it for the other so rows aren't lost
    if (!bc && nm) bc = nm;
    if (!nm && bc) nm = bc;
    if (!nm || !bc) {
      skipped++;
    } else if (seen.has(bc)) {
      dupInFile++;
    } else {
      seen.add(bc);
      cleaned.push({
        name: nm,
        barcode: bc,
        category: pick(r, "category"),
        unit: pick(r, "unit") ?? "pcs",
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