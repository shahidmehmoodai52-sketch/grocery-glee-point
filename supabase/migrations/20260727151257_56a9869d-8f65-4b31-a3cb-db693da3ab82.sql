ALTER TABLE public.audit_logs
  DROP CONSTRAINT IF EXISTS audit_logs_action_check;

ALTER TABLE public.audit_logs
  ADD CONSTRAINT audit_logs_action_check
  CHECK (action = ANY (ARRAY[
    'INSERT'::text,
    'UPDATE'::text,
    'DELETE'::text,
    'ADMIN_SET_STATUS'::text,
    'ADMIN_SET_PLAN'::text,
    'ADMIN_RESET_PASSWORD'::text,
    'ADMIN_ACTION'::text,
    'EDIT_SALE'::text
  ]));