-- The daily-health-check cron job (SELECT public.run_health_check(), which
-- populates system_health_log -- the negative-stock/unbalanced-transfer/
-- supplier-drift checks reviewed in the daily project check-in) was never
-- recreated on the standalone Supabase project during the Lovable ->
-- Supabase migration. Only prune-audit-logs came across; run_health_check()
-- itself was present (schema migrated fine), just never scheduled, so
-- system_health_log had been silently frozen since the last Lovable Cloud
-- run (2026-09-08) with no error anywhere to surface it.
--
-- Recreated with the same schedule Lovable Cloud used (03:45 daily).
-- Manually invoked once after creating this so today's check-in has fresh
-- data instead of waiting for the first scheduled run.

SELECT cron.schedule('daily-health-check', '45 3 * * *', 'SELECT public.run_health_check();');
