// Regression test for the request-storm incident (2026-09-25): pullTable()
// read its watermark cursor once before the page loop and never advanced it
// between pages. Any table with more than one page (1000 rows) of backlog
// to catch up on re-issued the exact same first-page query forever, until
// the 500-page safety cap threw — then repeated the same 500-page refetch
// on every subsequent sync pass, since the persisted watermark never moved
// either. Seen live as a sustained flood of identical `sales`/`products`/
// `product_barcodes` requests burning through the shared Cloudflare Worker
// proxy's daily quota and starving genuine reads/writes on other devices.
import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "./db";

const mockRows = (n: number, startIndex: number) =>
  Array.from({ length: n }, (_, i) => {
    const idx = startIndex + i;
    return {
      id: `id-${String(idx).padStart(6, "0")}`,
      created_at: new Date(2026, 0, 1, 0, 0, idx).toISOString(),
      tenant_id: "tenant-A",
    };
  });

// 1001 rows — one full page plus one row, so a correctly-advancing cursor
// needs exactly two requests to finish, and a stuck cursor would keep
// re-requesting the first page forever.
const page1 = mockRows(1000, 0);
const page2 = mockRows(1, 1000);

function makeQueryBuilder(calls: any[][]) {
  const state: any = { filters: [] };
  const builder: any = {
    select: vi.fn(() => builder),
    order: vi.fn(() => builder),
    or: vi.fn((f: string) => { state.or = f; return builder; }),
    gt: vi.fn((col: string, v: string) => { state.gt = [col, v]; return builder; }),
    limit: vi.fn(() => builder),
    then: (resolve: any) => {
      calls.push([{ ...state }]);
      const data = calls.length === 1 ? page1 : calls.length === 2 ? page2 : [];
      return Promise.resolve({ data, error: null }).then(resolve);
    },
  };
  return builder;
}

vi.mock("@/integrations/supabase/client", () => {
  const calls: any[][] = [];
  return {
    __calls: calls,
    supabase: {
      from: vi.fn(() => makeQueryBuilder(calls)),
    },
  };
});

beforeEach(async () => {
  await db().sales.clear();
  await db()._sync_state.clear();
});

describe("pullTable cursor advance", () => {
  it("advances the watermark cursor between pages instead of re-requesting page 1 forever", async () => {
    const { pullTable } = await import("./sync");
    const clientModule: any = await import("@/integrations/supabase/client");

    const total = await pullTable("sales" as any);

    // Exactly two requests — one per page — not a loop stuck re-fetching
    // page 1 up to the MAX_PAGES safety cap.
    expect(clientModule.__calls.length).toBe(2);
    // First request has no cursor filter (first-ever pull).
    expect(clientModule.__calls[0][0].or).toBeUndefined();
    expect(clientModule.__calls[0][0].gt).toBeUndefined();
    // Second request's cursor must reflect page 1's last row, not be empty
    // (i.e. not identical to the first request).
    expect(clientModule.__calls[1][0].or).toContain("id-000999");

    expect(total).toBe(1001);
    expect(await db().sales.count()).toBe(1001);

    // The persisted watermark must reflect the very last row pulled.
    const watermark = await db()._sync_state.get("sales");
    expect(watermark?.last_pulled_id).toBe("id-001000");
  });
});
