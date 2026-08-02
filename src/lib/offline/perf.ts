// Lightweight perf instrumentation + main-thread-friendly scheduling helpers.
//
// Used by the reconnect / background-sync path so heavy work never blocks
// cashier interactions (barcode scan, cart edits, checkout).

const SLOW_MS = 400;

export function nowMs(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

/** Yield to the browser so pending input/paint work can run. */
export function yieldToUI(): Promise<void> {
  return new Promise<void>((resolve) => {
    if (typeof window === "undefined") return resolve();
    const ric = (window as any).requestIdleCallback as
      | ((cb: () => void, opts?: { timeout?: number }) => number)
      | undefined;
    if (ric) ric(() => resolve(), { timeout: 200 });
    else window.setTimeout(resolve, 0);
  });
}

/** Wait for the browser to be idle-ish before starting a batch of work. */
export function whenIdle(timeoutMs = 500): Promise<void> {
  return new Promise<void>((resolve) => {
    if (typeof window === "undefined") return resolve();
    const ric = (window as any).requestIdleCallback as
      | ((cb: () => void, opts?: { timeout?: number }) => number)
      | undefined;
    if (ric) ric(() => resolve(), { timeout: timeoutMs });
    else window.setTimeout(resolve, 0);
  });
}

/** Time an async span, logging slow ones. Never throws on logging failure. */
export async function timed<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const t0 = nowMs();
  try {
    return await fn();
  } finally {
    const ms = Math.round(nowMs() - t0);
    if (ms >= SLOW_MS) {
      // eslint-disable-next-line no-console
      console.info(`[tillix-perf] ${label} took ${ms}ms`);
    }
  }
}

export function logPerf(label: string, detail?: Record<string, unknown>) {
  // eslint-disable-next-line no-console
  console.info(`[tillix-perf] ${label}`, detail ?? "");
}

/** Trailing-edge debounce that also enforces a minimum gap between runs. */
export function debounceAsync(fn: () => void, waitMs: number, minGapMs = 0) {
  let timer: number | null = null;
  let lastRun = 0;
  return () => {
    if (typeof window === "undefined") return;
    if (timer !== null) window.clearTimeout(timer);
    const since = nowMs() - lastRun;
    const delay = Math.max(waitMs, minGapMs - since);
    timer = window.setTimeout(() => {
      timer = null;
      lastRun = nowMs();
      fn();
    }, delay);
  };
}
