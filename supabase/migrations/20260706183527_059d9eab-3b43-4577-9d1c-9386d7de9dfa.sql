ALTER TABLE public.store_settings
  ADD COLUMN IF NOT EXISTS payment_qr_url TEXT,
  ADD COLUMN IF NOT EXISTS payment_qr_label TEXT,
  ADD COLUMN IF NOT EXISTS show_payment_qr BOOLEAN NOT NULL DEFAULT true;