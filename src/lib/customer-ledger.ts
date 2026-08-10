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
