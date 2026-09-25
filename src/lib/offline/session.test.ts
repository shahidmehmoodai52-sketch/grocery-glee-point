// Regression test for the spurious-sign-out incident (2026-09-25): three
// independent triggers each called supabase.auth.refreshSession() directly,
// with no coordination. Two firing close together (same tab, or two tabs of
// the same device sharing one refresh token via localStorage) raced against
// the same not-yet-rotated token — one succeeded, the other was rejected as
// already-used, and that rejection could tear down the session the first
// call just established. refreshSessionDeduped() must collapse concurrent
// same-tab calls into one, and make a second tab that tried very recently
// skip its own network refresh in favor of just re-reading the session.
import { beforeEach, describe, expect, it, vi } from "vitest";

const refreshSession = vi.fn(() => Promise.resolve({ data: { session: null }, error: null }));
const getSession = vi.fn(() => Promise.resolve({ data: { session: null }, error: null }));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { auth: { refreshSession: () => refreshSession(), getSession: () => getSession() } },
}));

function makeMemoryStorage(): Storage {
  const store = new Map<string, string>();
  return {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: () => null,
    get length() { return store.size; },
  } as Storage;
}

beforeEach(() => {
  refreshSession.mockClear();
  getSession.mockClear();
  vi.stubGlobal("window", { localStorage: makeMemoryStorage() });
});

describe("refreshSessionDeduped", () => {
  it("collapses concurrent same-tab calls into a single refreshSession() call", async () => {
    const { refreshSessionDeduped } = await import("./session");
    const [a, b, c] = [refreshSessionDeduped(), refreshSessionDeduped(), refreshSessionDeduped()];
    await Promise.all([a, b, c]);
    expect(refreshSession).toHaveBeenCalledTimes(1);
  });

  it("uses getSession() instead when another tab refreshed moments ago", async () => {
    const { refreshSessionDeduped } = await import("./session");
    (window as any).localStorage.setItem("tillix:last_refresh_attempt_at", String(Date.now()));
    await refreshSessionDeduped();
    expect(refreshSession).not.toHaveBeenCalled();
    expect(getSession).toHaveBeenCalledTimes(1);
  });

  it("calls refreshSession() normally when no recent attempt is recorded", async () => {
    const { refreshSessionDeduped } = await import("./session");
    await refreshSessionDeduped();
    expect(refreshSession).toHaveBeenCalledTimes(1);
    expect(getSession).not.toHaveBeenCalled();
  });
});
