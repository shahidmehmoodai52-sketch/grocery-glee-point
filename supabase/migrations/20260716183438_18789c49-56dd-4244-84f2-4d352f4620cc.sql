ALTER TABLE public.store_settings
  ADD COLUMN IF NOT EXISTS pos_print_prompt_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS pos_print_prompt_default text NOT NULL DEFAULT 'yes';