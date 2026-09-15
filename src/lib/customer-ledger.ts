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
    // Cash Out = money handed to the customer (DEBIT). Discount = balance
    // waived, no cash moved either way. Everything else is a received
    // payment (CREDIT). Discount is identified by its `method` (set by
    // record_payment when called with p_method: "discount"). Cash Out is
    // identified from the linked cash_transactions row's own `direction`
    // ('out') when the query embeds it — the authoritative source, since
    // that's the same field the Cash Flow page itself is driven by. Falls
    // back to a note-text guess only for rows with no linked transaction
    // (or an older query that didn't embed it) — matching only a note that
    // literally starts with "cash out" used to silently misclassify any
    // Cash Out entry whose note didn't happen to start that way.
    if (!p.party_type || p.party_type === "customer") {
      const note = String(p.note ?? "");
      const linkedDirection = p.cash_transactions?.direction as string | undefined;
      const isCashOut = linkedDirection ? linkedDirection === "out" : /^\s*cash\s*out\b/i.test(note);
      const isDiscount = p.method === "discount";
      entries.push({
        id: p.id,
        date: p.created_at,
        type: isCashOut ? "cash_out" : isDiscount ? "discount" : "payment",
        ref: isCashOut ? "Cash Out" : isDiscount ? "Discount" : (p.method || "Payment"),
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
