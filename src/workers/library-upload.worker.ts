import Papa from "papaparse";
import * as XLSX from "xlsx";

type CleanedProduct = {
  name: string;
  barcode: string;
  item_code: string | null;
  category: string | null;
  unit: string;
  default_sell_price: number;
  default_cost_price: number;
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
  barcode: ["barcode", "bar code", "ean", "upc", "scan", "scancode", "scan code"],
  item_code: ["item code", "itemcode", "code", "item no", "item#", "item number", "itemno", "prod code", "product code", "sku"],
  category: ["category", "cat", "group", "department"],
  unit: ["unit", "uom", "unit type", "measure"],
  sell_price: ["sale rate", "sale price", "sell rate", "sell price", "selling price", "selling rate", "mrp", "retail", "retail price", "rate"],
  cost_price: ["purchase rate", "purchase price", "cost", "cost price", "buy rate", "buying price", "wholesale", "wholesale rate", "supplier price"],
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

const parseNum = (v: string | null): number => {
  if (!v) return 0;
  const n = Number(v.replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : 0;
};

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
    const ic = pick(r, "item_code");
    // Fallbacks so nothing is lost when a column is missing
    if (!bc) bc = ic ?? nm;
    if (!nm) nm = ic ?? bc;
    if (!nm || !bc) {
      skipped++;
      continue;
    }
    if (seen.has(bc)) {
      dupInFile++;
      continue;
    }
    seen.add(bc);
    cleaned.push({
      name: nm,
      barcode: bc,
      item_code: ic,
      category: pick(r, "category"),
      unit: pick(r, "unit") ?? "pcs",
      default_sell_price: parseNum(pick(r, "sell_price")),
      default_cost_price: parseNum(pick(r, "cost_price")),
    });
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
