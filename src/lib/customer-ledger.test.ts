import { describe, expect, it } from 'vitest';
import { summarizeCustomerLedger } from './customer-ledger';

describe('summarizeCustomerLedger', () => {
  it('computes opening, in, out and closing from mixed entries', () => {
    const summary = summarizeCustomerLedger({
      openingBalance: 50,
      entries: [
        { type: 'sale', debit: 120, credit: 0 },
        { type: 'payment', debit: 0, credit: 20 },
        { type: 'return', debit: 0, credit: 15 },
      ],
    });

    expect(summary.opening).toBe(50);
    expect(summary.totalIn).toBe(120);
    expect(summary.totalOut).toBe(35);
    expect(summary.closing).toBe(135);
    expect(summary.closingLabel).toBe('Outstanding (they owe)');
  });

  it('marks negative balances as advance credits', () => {
    const summary = summarizeCustomerLedger({
      openingBalance: -10,
      entries: [
        { type: 'payment', debit: 0, credit: 5 },
      ],
    });

    expect(summary.closing).toBe(-15);
    expect(summary.closingLabel).toBe('Advance (credit)');
  });
});
