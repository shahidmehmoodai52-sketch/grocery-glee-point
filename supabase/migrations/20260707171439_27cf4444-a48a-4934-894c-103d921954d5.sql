
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'tenant_role' AND e.enumlabel = 'staff'
  ) THEN
    ALTER TYPE public.tenant_role ADD VALUE 'staff';
  END IF;
END $$;
