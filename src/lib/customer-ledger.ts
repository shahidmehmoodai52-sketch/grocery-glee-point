export type CustomerLedgerEntry = {
  debit: number;
  credit: number;
  type?: string;
};

export type CustomerLedgerSummary = {
  opening: number;
  totalIn: number;
  totalOut: number;
  closing: number;
  closingLabel: string;
  closingTone: 'destructive' | 'success' | 'primary';
};

/**
 * Builds ledger entries from raw database rows.
 * This ensures consistency between the list and detail views.
 */
export function buildLedgerEntries({
  sales,
  payments,
  returns,
}: {
  sales: any[];
  payments: any[];
  returns: any[];
}) {
  const entries: Array<{ date: string; debit: number; credit: number; type: string; ref: string; note: string; id?: string; data?: any }> = [];

  for (const s of sales) {
    // Sales are debits (customer owes)
    entries.push({
      id: s.id,
      date: s.created_at,
      type: "sale",
      ref: s.invoice_no,
      note: s.note ?? "",
      debit: Number(s.total || 0),
      credit: 0,
      data: s,
    });
    // On-invoice payments are credits (reduces what they owe)
    if (Number(s.paid || 0) > 0) {
      entries.push({
        date: s.created_at,
        type: "payment",
        ref: `${s.invoice_no} · on-invoice`,
        note: "Paid at sale",
        debit: 0,
        credit: Number(s.paid || 0),
      });
    }
  }

  for (const r of returns) {
    // Returns are credits (reduces what they owe)
    entries.push({
      id: r.id,
      date: r.created_at,
      type: "return",
      ref: r.return_no || "Return",
      note: r.note ?? "",
      debit: 0,
      credit: Number(r.total || 0),
    });
  }

  for (const p of payments) {
    // Cash Out = money handed to the customer (DEBIT). Everything else is a
    // received payment (CREDIT). Identify Cash Out ONLY by its note marker —
    // every payment has a linked cash_transaction_id, so that flag cannot be used.
    if (!p.party_type || p.party_type === "customer") {
      const note = String(p.note ?? "");
      const isCashOut = /^\s*cash\s*out\b/i.test(note);
      entries.push({
        id: p.id,
        date: p.created_at,
        type: isCashOut ? "cash_out" : "payment",
        ref: p.method || (isCashOut ? "Cash Out" : "Payment"),
        note,
        debit: isCashOut ? Number(p.amount || 0) : 0,
        credit: isCashOut ? 0 : Number(p.amount || 0),
      });
    }
  }


  return entries.sort((a, b) => a.date.localeCompare(b.date));
}

export function summarizeCustomerLedger({
  openingBalance,
  entries,
}: {
  openingBalance: number;
  entries: CustomerLedgerEntry[];
}): CustomerLedgerSummary {
  const opening = Number(openingBalance) || 0;
  const totalIn = entries.reduce((sum, entry) => sum + Number(entry.debit || 0), 0);
  const totalOut = entries.reduce((sum, entry) => sum + Number(entry.credit || 0), 0);
  const closing = opening + totalIn - totalOut;

  let closingLabel = 'Settled';
  let closingTone: CustomerLedgerSummary['closingTone'] = 'primary';

  if (closing > 0) {
    closingLabel = 'Outstanding (they owe)';
    closingTone = 'destructive';
  } else if (closing < 0) {
    closingLabel = 'Advance (credit)';
    closingTone = 'success';
  }

  return { opening, totalIn, totalOut, closing, closingLabel, closingTone };
}
