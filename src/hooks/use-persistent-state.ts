import { useEffect, useRef, useState } from "react";

/**
 * Persists state to localStorage so in-progress entries (purchase, product, etc.)
 * survive route changes (e.g. user jumps to POS to bill a walk-in customer).
 * The draft is cleared by calling the returned `clear()` after a successful save.
 *
 * The write is debounced (default 200ms) rather than synchronous, so a rapid
 * run of updates — e.g. scanning several POS items back-to-back, each of
 * which replaces the whole cart/tabs value — collapses into one
 * JSON.stringify + localStorage write instead of one per scan. A pending
 * write is always flushed immediately on unmount, so a change made right
 * before navigating away is never lost.
 */
export function usePersistentState<T>(key: string, initial: T, debounceMs = 200) {
  const storageKey = `lovable-draft:${key}`;
  const [value, setValue] = useState<T>(() => {
    if (typeof window === "undefined") return initial;
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (raw) return JSON.parse(raw) as T;
    } catch {}
    return initial;
  });
  const firstRun = useRef(true);
  const valueRef = useRef(value);
  valueRef.current = value;

  useEffect(() => {
    if (firstRun.current) { firstRun.current = false; return; }
    const timer = window.setTimeout(() => {
      try { window.localStorage.setItem(storageKey, JSON.stringify(valueRef.current)); } catch {}
    }, debounceMs);
    return () => window.clearTimeout(timer);
  }, [value, storageKey, debounceMs]);

  // Flush any pending debounced write on unmount only (empty deps + a ref
  // read in the cleanup), so a route change right after the last edit still
  // persists it instead of losing it to the cancelled timer above.
  useEffect(() => {
    return () => {
      if (firstRun.current) return;
      try { window.localStorage.setItem(storageKey, JSON.stringify(valueRef.current)); } catch {}
    };
  }, [storageKey]);

  const clear = () => {
    try { window.localStorage.removeItem(storageKey); } catch {}
    setValue(initial);
  };

  return [value, setValue, clear] as const;
}
