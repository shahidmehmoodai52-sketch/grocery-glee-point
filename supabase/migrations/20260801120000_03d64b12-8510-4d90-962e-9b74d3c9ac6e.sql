-- Audit log retention (non-breaking)

CREATE OR REPLACE FUNCTION public.cleanup_old_audit_logs(
  p_retention_days integer DEFAULT 180,
  p_batch_size integer DEFAULT 1000
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cutoff timestamptz;
  v_deleted integer := 0;
  v_deleted_this_batch integer := 0;
BEGIN
  IF p_retention_days < 0 THEN
    RAISE EXCEPTION 'Retention days must be non-negative';
  END IF;

  IF p_batch_size <= 0 THEN
    RAISE EXCEPTION 'Batch size must be positive';
  END IF;

  v_cutoff := now() - make_interval(days => p_retention_days);

  LOOP
    WITH batch AS (
      SELECT id
      FROM public.audit_logs
      WHERE created_at < v_cutoff
      ORDER BY created_at, id
      LIMIT p_batch_size
    )
    DELETE FROM public.audit_logs AS a
    USING batch
    WHERE a.id = batch.id;

    GET DIAGNOSTICS v_deleted_this_batch = ROW_COUNT;
    EXIT WHEN v_deleted_this_batch = 0;
    v_deleted := v_deleted + v_deleted_this_batch;
  END LOOP;

  RETURN v_deleted;
END;
$$;

REVOKE ALL ON FUNCTION public.cleanup_old_audit_logs(integer, integer) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.cleanup_old_audit_logs(integer, integer) TO service_role;

SELECT public.cleanup_old_audit_logs(180, 1000);
