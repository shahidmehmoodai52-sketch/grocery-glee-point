// Regression test for the stuck-login incident (2026-09-25): isBlocked()
// had no timeout, so a degraded connection that never resolves (neither
// succeeds nor errors) left the login button spinning forever — the actual
// sign-in request underneath would have worked fine, but the code never got
// there because it was still awaiting this blocklist check. isBlocked()
// must fail open (treat as "not blocked") once its bounded wait elapses.
import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: (...args: any[]) => rpc(...args) },
}));

beforeEach(() => {
  rpc.mockReset();
  vi.useRealTimers();
});

function abortableBuilder(exec: (signal: AbortSignal) => Promise<any>) {
  let signal: AbortSignal;
  const builder: any = {
    abortSignal: (s: AbortSignal) => { signal = s; return builder; },
    then: (resolve: any, reject: any) => exec(signal).then(resolve, reject),
  };
  return builder;
}

describe("isBlocked", () => {
  it("returns the RPC result when it resolves normally", async () => {
    rpc.mockReturnValue(abortableBuilder(async () => ({ data: true, error: null })));
    const { isBlocked } = await import("./security-log");
    expect(await isBlocked("someone@example.com")).toBe(true);
  });

  it("returns false when the RPC errors", async () => {
    rpc.mockReturnValue(abortableBuilder(async () => ({ data: null, error: { message: "boom" } })));
    const { isBlocked } = await import("./security-log");
    expect(await isBlocked("someone@example.com")).toBe(false);
  });

  it("fails open (false) instead of hanging forever when the call never resolves", async () => {
    rpc.mockReturnValue(
      abortableBuilder(
        (signal) =>
          new Promise((_resolve, reject) => {
            signal.addEventListener("abort", () => reject(new Error("aborted")));
          }),
      ),
    );
    const { isBlocked } = await import("./security-log");
    const result = await isBlocked("someone@example.com");
    expect(result).toBe(false);
  }, 10000);
});
