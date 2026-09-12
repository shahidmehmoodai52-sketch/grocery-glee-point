import type { ExtractedBillItem, MatchedProductOption, MatchStatus, PreviewLine, SupplierMatch } from "./types";

export function normalize(s: string | null | undefined): string {
  return String(s ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Token-overlap (Jaccard) similarity with a substring bonus. 0..1. */
export function nameSimilarity(a: string, b: string): number {
  const na = normalize(a);
  const nb = normalize(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  const ta = new Set(na.split(" "));
  const tb = new Set(nb.split(" "));
  const inter = [...ta].filter((x) => tb.has(x)).length;
  const union = new Set([...ta, ...tb]).size;
  const jaccard = union > 0 ? inter / union : 0;
  const substrBonus = na.includes(nb) || nb.includes(na) ? 0.15 : 0;
  return Math.min(1, jaccard + substrBonus);
}

interface ScoredProduct {
  product: MatchedProductOption;
  score: number; // 0..100
  method: "barcode" | "sku" | "name";
}

function scoreProducts(
  item: ExtractedBillItem,
  products: MatchedProductOption[],
  extraBarcodes: { product_id: string; barcode: string }[],
): ScoredProduct[] {
  const extractedBarcode = normalize(item.barcode).replace(/\s/g, "");
  const extractedSku = normalize(item.sku).replace(/\s/g, "");
  const extractedName = item.name ?? "";

  const scored: ScoredProduct[] = [];
  for (const p of products) {
    const pBarcode = (p.barcode ?? "").toLowerCase();
    const pSku = (p.sku ?? "").toLowerCase();
    const hasExtraBarcode = extraBarcodes.some(
      (b) => b.product_id === p.id && b.barcode.toLowerCase() === extractedBarcode,
    );
    if (extractedBarcode && (pBarcode === extractedBarcode || hasExtraBarcode)) {
      scored.push({ product: p, score: 100, method: "barcode" });
      continue;
    }
    if (extractedSku && pSku === extractedSku) {
      scored.push({ product: p, score: 100, method: "sku" });
      continue;
    }
    const sim = nameSimilarity(extractedName, p.name);
    if (sim > 0) scored.push({ product: p, score: Math.round(sim * 100), method: "name" });
  }
  return scored.sort((a, b) => b.score - a.score);
}

/**
 * Matches one extracted line against the tenant's product catalogue.
 * Confidence is always derived from an actual signal (barcode/sku/name
 * overlap) — never invented.
 */
export function matchLineItem(
  item: ExtractedBillItem,
  products: MatchedProductOption[],
  extraBarcodes: { product_id: string; barcode: string }[],
): { status: MatchStatus; confidence: number; candidates: MatchedProductOption[]; best: MatchedProductOption | null } {
  const scored = scoreProducts(item, products, extraBarcodes);
  if (scored.length === 0) return { status: "unmatched", confidence: 0, candidates: [], best: null };

  const top = scored[0];
  const runnerUp = scored[1];
  // Ambiguous: two name-based candidates close enough that picking one for
  // the user would be a guess, regardless of the top score.
  const ambiguous =
    top.method === "name" &&
    runnerUp &&
    runnerUp.method === "name" &&
    top.score - runnerUp.score <= 5 &&
    top.score < 100;

  const candidates = scored.slice(0, 5).map((s) => s.product);

  if (ambiguous) {
    return { status: "ambiguous", confidence: top.score, candidates, best: null };
  }
  if (top.score >= 95) return { status: "matched", confidence: top.score, candidates, best: top.product };
  if (top.score >= 85) return { status: "verify", confidence: top.score, candidates, best: top.product };
  if (top.score > 0) return { status: "review", confidence: top.score, candidates, best: null };
  return { status: "unmatched", confidence: 0, candidates: [], best: null };
}

export function buildPreviewLine(
  item: ExtractedBillItem,
  products: MatchedProductOption[],
  extraBarcodes: { product_id: string; barcode: string }[],
): PreviewLine {
  const m = matchLineItem(item, products, extraBarcodes);
  const selected = m.best;
  return {
    extracted_name: item.name ?? "",
    matchStatus: m.status,
    matchConfidence: m.confidence,
    candidates: m.candidates,
    product_id: selected?.id ?? null,
    product_name: selected?.name ?? item.name ?? "",
    barcode: selected?.barcode ?? item.barcode ?? null,
    sku: selected?.sku ?? item.sku ?? null,
    qty: Number(item.qty ?? 1) || 1,
    cost: Number(selected?.cost_price ?? item.unit_cost ?? 0) || Number(item.unit_cost ?? 0) || 0,
    discount: Number(item.discount ?? 0) || 0,
    batch_no: item.batch_no ?? null,
    expiry_date: item.expiry_date ?? null,
  };
}

export function matchSupplier(
  extractedName: string | null,
  suppliers: { id: string; name: string }[],
): SupplierMatch {
  const name = extractedName ?? "";
  if (!normalize(name)) {
    return { status: "unmatched", confidence: 0, supplier_id: null, supplier_name: "", candidates: [] };
  }
  const scored = suppliers
    .map((s) => ({ s, score: Math.round(nameSimilarity(name, s.name) * 100) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);

  if (scored.length === 0) {
    return { status: "unmatched", confidence: 0, supplier_id: null, supplier_name: name, candidates: [] };
  }
  const top = scored[0];
  const runnerUp = scored[1];
  const ambiguous = runnerUp && top.score - runnerUp.score <= 5 && top.score < 100;
  const candidates = scored.slice(0, 5).map((x) => x.s);

  if (!ambiguous && top.score >= 90) {
    return { status: "matched", confidence: top.score, supplier_id: top.s.id, supplier_name: top.s.name, candidates };
  }
  return { status: "review", confidence: top.score, supplier_id: null, supplier_name: name, candidates };
}
