ALTER TABLE public.suppliers ADD COLUMN IF NOT EXISTS opening_balance numeric NOT NULL DEFAULT 0;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS opening_balance numeric NOT NULL DEFAULT 0;