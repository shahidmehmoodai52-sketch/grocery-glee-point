/** Client mirror of public.resolve_cash_account / resolve_payment_bucket:
 *  which cash account a sale/payment method lands in. Cash Flow books money
 *  by these rules, so reports grouped by the result line up with it — e.g.
 *  a payment saved with method "Cash" and one saved as "Cash in Hand" both
 *  belong to the Cash in Hand account. */
export type CashAccountLite = { id: string; name: string; type: string; is_active?: boolean | null; created_at?: string | null };

export function paymentBucket(method: string | null | undefined): string {
  const m = String(method ?? "cash").trim().toLowerCase();
  if (m === "" || m === "cash") return "cash";
  if (m.includes("card")) return "card";
  if (["bank", "online", "transfer", "cheque", "check"].some((k) => m.includes(k))) return "bank";
  if (["easy", "jazz", "wallet", "upi", "mobile"].some((k) => m.includes(k))) return "mobile_wallet";
  return "other";
}

/** Returns a resolver from method → account name (or the method itself when
 *  the shop has no matching active account). */
export function makeAccountResolver(accounts: CashAccountLite[]) {
  const active = accounts
    .filter((a) => a.is_active !== false)
    .sort((a, b) => String(a.created_at ?? "").localeCompare(String(b.created_at ?? "")));
  const byId = new Map(accounts.map((a) => [a.id, a.name]));
  const firstOfType = (type: string) => active.find((a) => a.type === type);
  return {
    byId: (id: string | null | undefined) => (id ? byId.get(id) ?? null : null),
    byMethod(method: string | null | undefined): string {
      const raw = String(method ?? "").trim();
      if (!active.length) return raw || "unknown";
      const exact = active.find((a) => a.name.trim().toLowerCase() === raw.toLowerCase());
      if (exact) return exact.name;
      const bucket = paymentBucket(raw);
      if (bucket !== "other") {
        const b = firstOfType(bucket);
        if (b) return b.name;
      }
      return firstOfType("cash")?.name ?? (raw || "unknown");
    },
  };
}
