// Master-data sync (Phase 2).
//
// Runs after a successful online login and on each sync pass. Downloads the
// small, slow-changing master tables into the local repositories so future
// offline modules have everything they need to render the app without network.
//
// Deliberately additive: it reads with the existing authenticated Supabase
// client (RLS applies unchanged), writes only into the new v3 local tables,
// and never touches POS, sales, returns or inventory logic.

import { supabase } from "@/integrations/supabase/client";
import {
  categoriesRepo, unitsRepo, taxesRepo, shopsRepo, usersRepo,
  paymentMethodsRepo, barcodeSettingsRepo, printerSettingsRepo, settingsRepo,
} from "./repo";
import { db } from "./db";
import { getMeta, setMeta } from "./device";
import { logPerf, yieldToUI } from "./perf";

const LAST_MASTER_SYNC = "master_synced_at";
/** Master data is slow-changing; don't re-pull more than once per 10 minutes. */
const MIN_GAP_MS = 10 * 60_000;

async function safe<T>(label: string, fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch (e: any) {
    logPerf(`master-sync:${label} skipped`, { error: String(e?.message ?? e) });
    return null;
  }
}

/** Categories: derived from the tenant library categories plus whatever
 *  categories the mirrored products already use (no cloud schema change). */
async function syncCategories(tenantId: string | null) {
  const named = new Map<string, string>();

  await safe("tenant_library_categories", async () => {
    const { data, error } = await supabase.from("tenant_library_categories").select("*");
    if (error) throw error;
    for (const row of data ?? []) {
      const name = String((row as any).name ?? "").trim();
      if (name) named.set(name.toLowerCase(), name);
    }
  });

  await safe("categories:from-products", async () => {
    await db().products.each((p: any) => {
      const name = String(p?.category ?? "").trim();
      if (name) named.set(name.toLowerCase(), name);
    });
  });

  const rows = [...named.entries()].map(([key, name]) => ({ id: `cat:${key}`, name }));
  await categoriesRepo.replaceAll(rows, { tenantId });
  return rows.length;
}

/** Units + taxes: derived from the distinct values already present on products
 *  (the cloud has no dedicated tables). Local rows are the canonical list the
 *  offline UI will bind to later. */
async function syncUnitsAndTaxes(tenantId: string | null) {
  const units = new Map<string, string>();
  const taxes = new Map<string, number>();

  await safe("units-taxes:from-products", async () => {
    await db().products.each((p: any) => {
      const unit = String(p?.unit ?? "").trim();
      if (unit) units.set(unit.toLowerCase(), unit);
      const rate = Number(p?.tax_rate ?? p?.tax ?? 0);
      if (Number.isFinite(rate) && rate > 0) taxes.set(`tax:${rate}`, rate);
    });
  });

  if (!units.size) {
    for (const u of ["pcs", "kg", "g", "ltr", "ml", "box", "pack", "dozen"]) {
      units.set(u, u);
    }
  }

  await unitsRepo.replaceAll(
    [...units.entries()].map(([key, name]) => ({ id: `unit:${key}`, name, code: name })),
    { tenantId },
  );
  await taxesRepo.replaceAll(
    [...taxes.entries()].map(([id, rate]) => ({ id, name: `${rate}%`, rate })),
    { tenantId },
  );
}

/** Shops: the tenants the signed-in user can see (RLS decides). */
async function syncShops(tenantId: string | null) {
  await safe("shops", async () => {
    const { data, error } = await supabase.from("tenants").select("*");
    if (error) throw error;
    await shopsRepo.replaceAll((data ?? []) as any[], { tenantId });
  });
}

/** Users: tenant members visible to the signed-in user, merged with local roles. */
async function syncUsers(tenantId: string | null) {
  await safe("users", async () => {
    const { data, error } = await supabase.from("tenant_members").select("*");
    if (error) throw error;
    await usersRepo.replaceAll((data ?? []) as any[], { tenantId });
  });
}

/** Payment methods: mirrors the cash_accounts table already synced by the
 *  main engine, projected into a stable local shape. */
async function syncPaymentMethods(tenantId: string | null) {
  await safe("payment_methods", async () => {
    const accounts = await db().cash_accounts.toArray();
    const rows = (accounts ?? [])
      .filter((a: any) => a?.id)
      .map((a: any) => ({
        id: String(a.id),
        name: a.name ?? a.slug ?? "Account",
        slug: a.slug ?? null,
        kind: a.kind ?? a.type ?? null,
        is_active: a.is_active ?? true,
      }));
    await paymentMethodsRepo.replaceAll(rows, { tenantId });
  });
}

/** Barcode + printer settings: projections of the single store_settings row so
 *  offline screens can read them without knowing the 49-column layout. */
async function syncDeviceSettings(tenantId: string | null) {
  await safe("device_settings", async () => {
    const [settings] = await settingsRepo.list({ limit: 1 });
    if (!settings) return;
    const pick = (keys: string[]) =>
      Object.fromEntries(keys.filter((k) => k in settings).map((k) => [k, (settings as any)[k]]));

    await barcodeSettingsRepo.replaceAll(
      [{
        id: "barcode",
        ...pick([
          "barcode_symbology", "barcode_label_width", "barcode_label_height",
          "barcode_show_price", "barcode_show_name", "barcode_prefix",
        ]),
      }],
      { tenantId },
    );
    await printerSettingsRepo.replaceAll(
      [{
        id: "printer",
        ...pick([
          "receipt_width", "printer_name", "print_logo", "receipt_footer",
          "receipt_header", "pos_print_prompt_enabled", "pos_print_prompt_default",
        ]),
      }],
      { tenantId },
    );
  });
}

/**
 * Pull all master data into the local layer.
 * Incremental by design: small tables are replaced wholesale (cheap), and the
 * whole pass is skipped when it ran recently unless `force` is set.
 */
export async function runMasterSync(opts: { force?: boolean } = {}): Promise<boolean> {
  if (typeof indexedDB === "undefined") return false;
  const last = Number((await getMeta<number>(LAST_MASTER_SYNC)) ?? 0);
  if (!opts.force && Date.now() - last < MIN_GAP_MS) return false;

  const tenantId = await getMeta<string>("tenant_id");
  const t0 = Date.now();

  await syncShops(tenantId);
  await yieldToUI();
  await syncUsers(tenantId);
  await yieldToUI();
  await syncCategories(tenantId);
  await yieldToUI();
  await syncUnitsAndTaxes(tenantId);
  await yieldToUI();
  await syncPaymentMethods(tenantId);
  await yieldToUI();
  await syncDeviceSettings(tenantId);

  await setMeta(LAST_MASTER_SYNC, Date.now());
  logPerf("master-sync complete", { ms: Date.now() - t0 });
  return true;
}
