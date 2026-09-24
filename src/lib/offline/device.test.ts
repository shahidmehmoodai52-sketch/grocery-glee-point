// Regression test for the Hafiz Mart incident (2026-09-24): guardTenantScope
// ran automatically in the background from a fresh network read (current
// tenant/user), detected a mismatch against the stored meta, and wiped the
// ENTIRE local mirror including the write queue — silently deleting 7
// already-completed but not-yet-synced sales. This locks in the fix: a
// tenant/user scope change may reset the cached read mirror (safe — it just
// re-downloads) but must never touch the pending write queue.
import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "./db";
import { setMeta } from "./device";
import { enqueueWrite } from "./sync";

async function wipeAll() {
  await db().products.clear();
  await db().customers.clear();
  await db()._queue.clear();
  await db()._meta.clear();
}

beforeEach(async () => {
  await wipeAll();
  vi.stubGlobal("navigator", { onLine: true });
});

describe("guardTenantScope", () => {
  it("never clears the write queue on a tenant/user mismatch, even though it wipes the read mirror", async () => {
    const { guardTenantScope } = await import("./device");

    await setMeta("tenant_id", "tenant-A");
    await setMeta("user_id", "user-A");
    await db().products.put({ id: "p1", name: "Cached Product" } as any);
    await enqueueWrite({
      op: "rpc",
      table: "complete_sale",
      tenant_id: "tenant-A",
      payload: { _tenant_id: "tenant-A", items: [] },
    });

    const pendingBefore = await db()._queue.count();
    expect(pendingBefore).toBe(1);

    // A different tenant/user is now read from the network — the exact
    // scenario a stale/transient session read during a reconnect can cause.
    const wiped = await guardTenantScope("tenant-B", "user-B");

    expect(wiped).toBe(true);
    // Read mirror is safe to lose — it just re-downloads.
    expect(await db().products.count()).toBe(0);
    // The queued, already-completed sale must survive.
    const pendingAfter = await db()._queue.count();
    expect(pendingAfter).toBe(1);
    const queued = await db()._queue.toArray();
    expect(queued[0].tenant_id).toBe("tenant-A");
    expect(queued[0].status).toBe("pending");
  });

  it("does not treat a first-time (no prior meta) scope as a mismatch", async () => {
    const { guardTenantScope } = await import("./device");
    await enqueueWrite({ op: "rpc", table: "complete_sale", tenant_id: "tenant-A", payload: {} });

    const wiped = await guardTenantScope("tenant-A", "user-A");

    expect(wiped).toBe(false);
    expect(await db()._queue.count()).toBe(1);
  });
});
