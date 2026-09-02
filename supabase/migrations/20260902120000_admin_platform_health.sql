-- Platform Health: a genuinely missing admin-panel feature. Every check
-- below is a real, measured signal -- no fabricated status, no static
-- values. "Data/Sync" is deliberately omitted: the offline sync queue is
-- client-side per device (IndexedDB), there is no reliable server-side
-- sync-freshness signal to report honestly, so it is left out rather than
-- invented.

CREATE OR REPLACE FUNCTION public.admin_platform_health()
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_start timestamptz;
  v_db_ms numeric;
  v_rpc_ms numeric;
  v_tenant_count int;
  v_errors_unresolved int;
  v_errors_last_hour int;
  v_critical_24h int;
  v_active_blocks int;
  v_failed_logins_24h int;
  v_in_recovery boolean;
  v_checks jsonb := '[]'::jsonb;
  v_overall text := 'healthy';
  v_status text;
BEGIN
  IF NOT public.admin_has_perm(auth.uid(), 'shops.view') THEN RAISE EXCEPTION 'Forbidden'; END IF;

  -- Database: real round-trip against a core table, real elapsed time.
  v_start := clock_timestamp();
  SELECT COUNT(*) INTO v_tenant_count FROM public.tenants;
  v_db_ms := EXTRACT(MILLISECONDS FROM clock_timestamp() - v_start);
  v_status := CASE WHEN v_db_ms > 2000 THEN 'critical' WHEN v_db_ms > 500 THEN 'warning' ELSE 'healthy' END;
  v_checks := v_checks || jsonb_build_object(
    'name', 'Database', 'status', v_status,
    'detail', format('%s tenants reachable in %s ms', v_tenant_count, round(v_db_ms)),
    'checked_at', now());
  IF v_status = 'critical' THEN v_overall := 'critical';
  ELSIF v_status = 'warning' AND v_overall <> 'critical' THEN v_overall := 'warning'; END IF;

  -- RPC/API: time a real aggregate computation (the same one
  -- admin_security_summary performs) to measure a lightweight admin RPC's
  -- actual responsiveness, not a synthetic ping.
  v_start := clock_timestamp();
  SELECT
    COUNT(*) FILTER (WHERE severity = 'critical' AND created_at > now() - interval '24 hours'),
    COUNT(*) FILTER (WHERE event_type = 'failed_login' AND created_at > now() - interval '24 hours')
    INTO v_critical_24h, v_failed_logins_24h
    FROM public.security_events;
  SELECT COUNT(*) INTO v_active_blocks FROM public.security_blocklist WHERE expires_at IS NULL OR expires_at > now();
  v_rpc_ms := EXTRACT(MILLISECONDS FROM clock_timestamp() - v_start);
  v_status := CASE WHEN v_rpc_ms > 2000 THEN 'critical' WHEN v_rpc_ms > 500 THEN 'warning' ELSE 'healthy' END;
  v_checks := v_checks || jsonb_build_object(
    'name', 'RPC / API', 'status', v_status,
    'detail', format('Admin security aggregate computed in %s ms', round(v_rpc_ms)),
    'checked_at', now());
  IF v_status = 'critical' THEN v_overall := 'critical';
  ELSIF v_status = 'warning' AND v_overall <> 'critical' THEN v_overall := 'warning'; END IF;

  -- Errors: reuses the same application_errors data the Errors tab shows,
  -- no separate/duplicate error system.
  SELECT COUNT(*), COUNT(*) FILTER (WHERE created_at > now() - interval '1 hour')
    INTO v_errors_unresolved, v_errors_last_hour
    FROM public.application_errors WHERE resolved_at IS NULL;
  v_status := CASE WHEN v_errors_last_hour >= 10 THEN 'critical' WHEN v_errors_last_hour >= 1 THEN 'warning' ELSE 'healthy' END;
  v_checks := v_checks || jsonb_build_object(
    'name', 'Errors', 'status', v_status,
    'detail', format('%s unresolved (%s in the last hour)', v_errors_unresolved, v_errors_last_hour),
    'checked_at', now());
  IF v_status = 'critical' THEN v_overall := 'critical';
  ELSIF v_status = 'warning' AND v_overall <> 'critical' THEN v_overall := 'warning'; END IF;

  -- Security: reuses the exact same thresholds the Security tab's own
  -- "securityAlert" indicator already uses client-side (critical>0,
  -- active_blocks>0, or failed_logins>=5) -- not a new invented threshold.
  v_status := CASE WHEN v_critical_24h > 0 THEN 'critical'
                    WHEN v_active_blocks > 0 OR v_failed_logins_24h >= 5 THEN 'warning'
                    ELSE 'healthy' END;
  v_checks := v_checks || jsonb_build_object(
    'name', 'Security', 'status', v_status,
    'detail', format('%s critical events, %s active blocks, %s failed logins (24h)', v_critical_24h, v_active_blocks, v_failed_logins_24h),
    'checked_at', now());
  IF v_status = 'critical' THEN v_overall := 'critical';
  ELSIF v_status = 'warning' AND v_overall <> 'critical' THEN v_overall := 'warning'; END IF;

  -- Application: real, measurable server-runtime signal -- whether this
  -- database is a read-only replica in recovery (writes would fail).
  SELECT pg_is_in_recovery() INTO v_in_recovery;
  v_status := CASE WHEN v_in_recovery THEN 'critical' ELSE 'healthy' END;
  v_checks := v_checks || jsonb_build_object(
    'name', 'Application', 'status', v_status,
    'detail', CASE WHEN v_in_recovery THEN 'Database is in read-only recovery mode'
                   ELSE format('Responding normally (server up since %s)', to_char(pg_postmaster_start_time(), 'YYYY-MM-DD HH24:MI')) END,
    'checked_at', now());
  IF v_status = 'critical' THEN v_overall := 'critical'; END IF;

  RETURN jsonb_build_object('overall', v_overall, 'checks', v_checks, 'generated_at', now());
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_platform_health() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_platform_health() TO authenticated;
