ALTER TABLE public.store_settings ALTER COLUMN currency SET DEFAULT 'PKR';
ALTER TABLE public.store_settings ALTER COLUMN currency_symbol SET DEFAULT 'Rs';

UPDATE public.store_settings
SET currency = 'PKR',
    currency_symbol = 'Rs',
    updated_at = now()
WHERE currency = 'USD'
  AND currency_symbol = '$';