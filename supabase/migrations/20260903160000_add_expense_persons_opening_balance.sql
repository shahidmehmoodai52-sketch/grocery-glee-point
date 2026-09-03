-- Staff/expense-person ledgers had no way to record a starting balance
-- carried over from before this system was used (e.g. an advance/due
-- already owed by that person) — the ledger's "Opening (before range)"
-- figure was purely a dynamic sum of expense rows before the selected
-- date, not a real editable opening balance. Mirrors cash_accounts'
-- opening_balance column/semantics.
ALTER TABLE public.expense_persons
  ADD COLUMN IF NOT EXISTS opening_balance numeric NOT NULL DEFAULT 0;
