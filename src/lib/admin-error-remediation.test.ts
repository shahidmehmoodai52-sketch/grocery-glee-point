import { describe, it, expect, vi, beforeEach } from "vitest";
import { autoRemediate, type AdminErrorRow } from "./admin-error-remediation";

function row(error_type: string): AdminErrorRow {
  return {
    id: "1",
    tenant_id: null,
    user_id: null,
    error_type,
    error_message: "boom",
    page_or_module: null,
    stack_trace: null,
    created_at: new Date().toISOString(),
  };
}

beforeEach(() => {
  vi.resetModules();
  vi.doUnmock("@/lib/offline/sync");
});

describe("autoRemediate", () => {
  it("auto-resolves a sync error only when a real sync runner exists and succeeds", async () => {
    const runSync = vi.fn().mockResolvedValue(undefined);
    vi.doMock("@/lib/offline/sync", () => ({ runSync, syncNow: undefined, default: undefined }));
    const result = await autoRemediate(row("sync_failure"));
    expect(result.autoResolved).toBe(true);
    expect(runSync).toHaveBeenCalledTimes(1);
  });

  it("does not auto-resolve a sync error when no sync runner is exported", async () => {
    vi.doMock("@/lib/offline/sync", () => ({ syncNow: undefined, runSync: undefined, default: undefined }));
    const result = await autoRemediate(row("sync_failure"));
    expect(result.autoResolved).toBe(false);
    expect(result.note).toMatch(/no sync runner/i);
  });

  it("does not auto-resolve when the recovery action itself throws", async () => {
    const runSync = vi.fn().mockRejectedValue(new Error("sync backend unreachable"));
    vi.doMock("@/lib/offline/sync", () => ({ runSync, syncNow: undefined, default: undefined }));
    const result = await autoRemediate(row("sync_queue_stuck"));
    expect(result.autoResolved).toBe(false);
    expect(result.note).toMatch(/sync backend unreachable/);
  });

  it("categorizes a cache error without auto-resolving", async () => {
    const result = await autoRemediate(row("stale_cache"));
    expect(result.autoResolved).toBe(false);
  });

  it("categorizes a render error without auto-resolving", async () => {
    const result = await autoRemediate(row("react_render_error"));
    expect(result.autoResolved).toBe(false);
  });

  it("categorizes a network error without auto-resolving", async () => {
    const result = await autoRemediate(row("fetch_timeout"));
    expect(result.autoResolved).toBe(false);
  });

  it("never auto-resolves an unrecognized error type", async () => {
    const result = await autoRemediate(row("something_unknown"));
    expect(result.autoResolved).toBe(false);
    expect(result.note).toMatch(/no known automatic recovery/i);
  });
});
