-- Phase C: Subscription / Billing Command Center.
--
-- Reuses the existing tenant_subscriptions + subscription_plans tables (the
-- same ones admin_list_tenants and the tenant detail PlanTab already read/
-- write) -- no new billing tables, no invented billing system. billing_events
-- exists but currently has zero rows on production, so no billing-events
-- timeline is built here (would be fabricated UI over no data); this RPC can
-- be extended to surface it once real events exist.
--
-- MRR is intentionally computed only as an honest "projected" figure derived
-- from real subscription_plans.price_monthly x active-subscription counts
-- (real DB-backed pricing, real assignment), not fabricated, and the
-- frontend labels it "Projected MRR" rather than claiming it is collected
-- revenue -- there is no payment-collection data (billing_events is empty)
-- to back a stronger claim.

CREATE OR REPLACE FUNCTION public.admin_billing_summary()
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_out jsonb;
BEGIN
  IF NOT public.admin_has_perm(auth.uid(), 'shops.view') THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  SELECT jsonb_build_object(
    'total_active', (
      SELECT COUNT(*) FROM public.tenant_subscriptions WHERE status = 'active'
    ),
    'expiring_7d', (
      SELECT COUNT(*) FROM public.tenant_subscriptions
      WHERE status = 'active' AND expires_at IS NOT NULL
        AND expires_at BETWEEN now() AND now() + interval '7 days'
    ),
    'expiring_30d', (
      SELECT COUNT(*) FROM public.tenant_subscriptions
      WHERE status = 'active' AND expires_at IS NOT NULL
        AND expires_at BETWEEN now() AND now() + interval '30 days'
    ),
    'expired', (
      SELECT COUNT(*) FROM public.tenant_subscriptions
      WHERE status = 'active' AND expires_at IS NOT NULL AND expires_at < now()
    ),
    'status_distribution', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('status', status, 'count', cnt))
      FROM (
        SELECT status, COUNT(*) AS cnt FROM public.tenant_subscriptions
        GROUP BY status ORDER BY cnt DESC
      ) s
    ), '[]'::jsonb),
    'plan_distribution', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'plan_id', p.id, 'plan_name', p.name, 'active_count', COALESCE(c.cnt, 0),
        'price_monthly', p.price_monthly
      ) ORDER BY p.price_monthly)
      FROM public.subscription_plans p
      LEFT JOIN (
        SELECT plan_id, COUNT(*) AS cnt FROM public.tenant_subscriptions
        WHERE status = 'active' GROUP BY plan_id
      ) c ON c.plan_id = p.id
      WHERE p.active
    ), '[]'::jsonb),
    'projected_mrr', COALESCE((
      SELECT SUM(p.price_monthly)
      FROM public.tenant_subscriptions ts
      JOIN public.subscription_plans p ON p.id = ts.plan_id
      WHERE ts.status = 'active'
    ), 0),
    'expiring_queue', COALESCE((
      SELECT jsonb_agg(row) FROM (
        SELECT jsonb_build_object(
          'tenant_id', t.id,
          'tenant_name', t.name,
          'plan_name', p.name,
          'expires_at', ts.expires_at,
          'days_remaining', CEIL(EXTRACT(EPOCH FROM (ts.expires_at - now())) / 86400.0),
          'owner_email', u.email,
          'status', ts.status
        ) AS row
        FROM public.tenant_subscriptions ts
        JOIN public.tenants t ON t.id = ts.tenant_id
        LEFT JOIN public.subscription_plans p ON p.id = ts.plan_id
        LEFT JOIN auth.users u ON u.id = t.owner_id
        WHERE ts.status = 'active' AND ts.expires_at IS NOT NULL
          AND ts.expires_at < now() + interval '30 days'
        ORDER BY ts.expires_at ASC
        LIMIT 50
      ) sub
    ), '[]'::jsonb),
    'generated_at', now()
  ) INTO v_out;

  RETURN v_out;
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_billing_summary() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_billing_summary() TO authenticated;
