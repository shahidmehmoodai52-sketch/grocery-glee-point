// Exercises the "sync mode" setting (realtime / manual / scheduled): a
// device that is genuinely online must still be treated as offline for
// every read/write when the user has deliberately chosen "manual" or
// "scheduled" mode, exactly the same way a real network outage is treated —
// nothing should reach the cloud on its own until the user syncs, or the
// scheduled timer fires.
import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db, MIRRORED_TABLES } from "./db";
import { setMeta } from "./device";
import {
  getSyncMode,
  setSyncMode,
  getSyncIntervalMinutes,
  setSyncIntervalMinutes,
  isEffectivelyOffline,
} from "./status";
import { insertOfflineAware } from "./pos";

async function wipeAll() {
  for (const t of MIRRORED_TABLES) {
    try {
      await (db() as any)[t].clear();
    } catch {
      /* fine */
    }
  }
  await db()._queue.clear();
}

beforeEach(async () => {
  await wipeAll();
  setSyncMode("realtime");
  setSyncIntervalMinutes(15);
  await setMeta("user_id", "u1");
  await setMeta("tenant_id", "tenant-1");
});

describe("isEffectivelyOffline", () => {
  it("is false when online and in realtime mode (today's default behavior)", () => {
    vi.stubGlobal("navigator", { onLine: true });
    expect(isEffectivelyOffline()).toBe(false);
  });

  it("is true when online but the user chose manual mode", () => {
    vi.stubGlobal("navigator", { onLine: true });
    setSyncMode("manual");
    expect(isEffectivelyOffline()).toBe(true);
  });

  it("is true when online but the user chose scheduled mode", () => {
    vi.stubGlobal("navigator", { onLine: true });
    setSyncMode("scheduled");
    expect(isEffectivelyOffline()).toBe(true);
  });

  it("is true regardless of sync mode when there is genuinely no connection", () => {
    vi.stubGlobal("navigator", { onLine: false });
    setSyncMode("realtime");
    expect(isEffectivelyOffline()).toBe(true);
  });
});

describe("getSyncMode / setSyncMode / getSyncIntervalMinutes / setSyncIntervalMinutes", () => {
  it("defaults to realtime and a 15-minute interval", () => {
    expect(getSyncMode()).toBe("realtime");
    expect(getSyncIntervalMinutes()).toBe(15);
  });

  it("round-trips a mode change", () => {
    setSyncMode("scheduled");
    expect(getSyncMode()).toBe("scheduled");
  });

  it("clamps the interval to [1, 1440] minutes", () => {
    setSyncIntervalMinutes(0);
    expect(getSyncIntervalMinutes()).toBe(1);
    setSyncIntervalMinutes(999999);
    expect(getSyncIntervalMinutes()).toBe(1440);
    setSyncIntervalMinutes(45.6);
    expect(getSyncIntervalMinutes()).toBe(46);
  });
});

describe("insertOfflineAware under manual sync mode", () => {
  it("writes locally with _offline_pending and queues the insert, even though the device is online", async () => {
    vi.stubGlobal("navigator", { onLine: true });
    setSyncMode("manual");

    const row = await insertOfflineAware("customers", { name: "Manual Mode Customer", phone: "0300" });

    expect(row._offline_pending).toBe(true);
    const stored = await db().customers.get(row.id);
    expect(stored?.name).toBe("Manual Mode Customer");

    const queued = await db()._queue.where("table").equals("customers").toArray();
    expect(queued).toHaveLength(1);
    expect(queued[0].status).toBe("pending");
  });
});
