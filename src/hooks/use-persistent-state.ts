import { useEffect, useRef, useState } from "react";

/**
 * Persists state to localStorage so in-progress entries (purchase, product, etc.)
 * survive route changes (e.g. user jumps to POS to bill a walk-in customer).
 * The draft is cleared by calling the returned `clear()` after a successful save.
 */
export function usePersistentState<T>(key: string, initial: T) {
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
  useEffect(() => {
    if (firstRun.current) { firstRun.current = false; return; }
    try { window.localStorage.setItem(storageKey, JSON.stringify(value)); } catch {}
  }, [value, storageKey]);

  const clear = () => {
    try { window.localStorage.removeItem(storageKey); } catch {}
    setValue(initial);
  };

  return [value, setValue, clear] as const;
}
