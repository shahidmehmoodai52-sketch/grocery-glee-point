export type LedgerEntry = {
  id?: string;
  date: string;
  type: "purchase" | "payment" | "return";
  ref: string;
  note: string;
  debit: number;
  credit: number;
  entity?: "purchase" | "payment" | "purchase_return";
  data?: any;
};

/**
 * Builds supplier ledger entries from raw database rows.
 * This ensures consistency between the list and detail views.
 */
export function buildSupplierLedgerEntries({
  purchases,
  payments,
  returns,
}: {
  purchases: any[];
  payments: any[];
  returns: any[];
}) {
  const entries: LedgerEntry[] = [];

  for (const p of purchases) {
    // Purchases are debits (we owe the supplier)
    entries.push({
      id: p.id,
      date: p.created_at,
      type: "purchase",
      entity: "purchase",
      ref: p.invoice_no,
      note: p.note ?? "",
      debit: Number(p.total || 0),
      credit: 0,
      data: p,
    });
    // On-invoice payments are credits (reduces what we owe)
    if (Number(p.paid || 0) > 0) {
      entries.push({
        date: p.created_at,
        type: "payment",
        ref: `${p.invoice_no} · on-invoice`,
        note: "Paid at purchase",
        debit: 0,
        credit: Number(p.paid || 0),
      });
    }
  }

  for (const r of returns) {
    // Returns are credits (reduces what we owe)
    entries.push({
      id: r.id,
      date: r.created_at,
      type: "return",
      entity: "purchase_return",
      ref: r.return_no || "Return",
      note: r.note ?? "",
      debit: 0,
      credit: Number(r.total || 0),
      data: r,
    });
  }

  for (const p of payments) {
    if (p.party_type === "supplier") {
      entries.push({
        id: p.id,
        date: p.created_at,
        type: "payment",
        entity: "payment",
        ref: p.method || "Payment",
        note: p.note ?? "",
        debit: 0,
        credit: Number(p.amount || 0),
        data: p,
      });
    }
  }

  return entries.sort((a, b) => a.date.localeCompare(b.date));
}
