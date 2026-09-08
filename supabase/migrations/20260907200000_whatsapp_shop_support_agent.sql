-- Extends the WhatsApp agent (see 20260904120000_whatsapp_agent_infra.sql,
-- currently a generic sales/FAQ bot on Tillix's own number) so a message
-- from a REGISTERED SHOP's own number is recognized and routed into a
-- support flow instead of the generic sales script.
--
-- Flow (per the owner's explicit spec): resolve the sender's number against
-- store_settings.phone -> if unmatched, keep the existing sales/FAQ
-- behavior (a prospective customer, not an existing shop) and tell them
-- their number isn't registered as a shop if they claim to be one; if
-- matched, the agent may read (never write) that shop's own data via the
-- tenant-scoped RPCs below to investigate what they're describing, explain
-- what it found, and ask the shop to confirm that's really the issue.
-- Only once the shop confirms does it notify Tillix's own WhatsApp number
-- with a report. Actually applying a data/code fix is deliberately NOT
-- automated from that WhatsApp reply alone in this pass — every fix in this
-- project so far has gone through investigate -> report -> the owner's
-- explicit approval, and a "yes" typed by whoever is holding the shop's
-- phone is not the same authorization for touching financial records. The
-- report this sends the owner is where that approval step now happens.

ALTER TABLE public.whatsapp_agent_messages
  ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.tenants(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_whatsapp_agent_messages_tenant_id
  ON public.whatsapp_agent_messages (tenant_id);

-- Per-conversation state: which shop (if any) this wa_id resolved to, and
-- whether it's mid-way through confirming a diagnosis before it gets
-- reported to the owner. One row per WhatsApp sender.
CREATE TABLE IF NOT EXISTS public.whatsapp_agent_state (
  wa_id text PRIMARY KEY,
  tenant_id uuid REFERENCES public.tenants(id) ON DELETE SET NULL,
  stage text NOT NULL DEFAULT 'idle' CHECK (stage IN ('idle', 'awaiting_shop_disambiguation', 'awaiting_shop_confirmation', 'reported_to_owner')),
  diagnosis_summary text,
  -- Candidate {tenant_id, shop_name, shop_code} list when the sender's
  -- number matched more than one shop and stage = 'awaiting_shop_disambiguation'
  -- -- the next reply is matched against these instead of re-running the
  -- phone lookup (which would just find the same ambiguous set again).
  pending_candidates jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.whatsapp_agent_state ENABLE ROW LEVEL SECURITY;
-- Deliberately no policies, same convention as whatsapp_agent_messages:
-- only the edge function (service-role key) touches this table.

-- Resolves an inbound WhatsApp number to the shop(s) it's registered to.
-- Matches on the last 10 digits so it's tolerant of how the number is
-- punctuated/prefixed in store_settings ("0333-4950141", "+92 333 4950141",
-- etc.) versus the plain-digits form WhatsApp delivers ("923334950141").
-- Returns more than one row when the same number is registered to more
-- than one shop (happens in practice) -- the caller must ask which shop.
CREATE OR REPLACE FUNCTION public.agent_find_tenant_by_phone(_wa_id text)
RETURNS TABLE(tenant_id uuid, shop_name text, shop_code text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT DISTINCT t.id, t.name, t.shop_code
  FROM public.store_settings s
  JOIN public.tenants t ON t.id = s.tenant_id
  WHERE s.phone IS NOT NULL
    AND length(regexp_replace(s.phone, '\D', '', 'g')) >= 10
    AND right(regexp_replace(s.phone, '\D', '', 'g'), 10) = right(regexp_replace(_wa_id, '\D', '', 'g'), 10)
  LIMIT 5;
$function$;
REVOKE ALL ON FUNCTION public.agent_find_tenant_by_phone(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agent_find_tenant_by_phone(text) TO service_role;

-- Sales/purchases summary for one date, plus the longest silent gap during
-- that date -- the same shape of check used to trace "some invoices are
-- missing, the shop was offline" reports back to a real time window.
CREATE OR REPLACE FUNCTION public.agent_business_day_summary(_tenant_id uuid, _date date)
RETURNS TABLE(
  sales_count bigint, sales_total numeric,
  purchases_count bigint, purchases_total numeric,
  longest_gap_minutes numeric, longest_gap_before timestamptz, longest_gap_after timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  WITH s AS (
    SELECT created_at, lag(created_at) OVER (ORDER BY created_at) AS prev_at
    FROM public.sales
    WHERE tenant_id = _tenant_id AND created_at::date = _date
  ),
  gaps AS (
    SELECT prev_at, created_at, extract(epoch FROM (created_at - prev_at)) / 60 AS gap_minutes
    FROM s WHERE prev_at IS NOT NULL
    ORDER BY gap_minutes DESC NULLS LAST
    LIMIT 1
  )
  SELECT
    (SELECT COUNT(*) FROM public.sales WHERE tenant_id = _tenant_id AND created_at::date = _date),
    (SELECT COALESCE(SUM(total), 0) FROM public.sales WHERE tenant_id = _tenant_id AND created_at::date = _date),
    (SELECT COUNT(*) FROM public.purchases WHERE tenant_id = _tenant_id AND created_at::date = _date),
    (SELECT COALESCE(SUM(total), 0) FROM public.purchases WHERE tenant_id = _tenant_id AND created_at::date = _date),
    (SELECT gap_minutes FROM gaps),
    (SELECT prev_at FROM gaps),
    (SELECT created_at FROM gaps);
END;
$function$;
REVOKE ALL ON FUNCTION public.agent_business_day_summary(uuid, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agent_business_day_summary(uuid, date) TO service_role;

-- Looks up one sale or purchase invoice by its printed number, with its
-- line items -- the same lookup used to explain a paid-vs-total mismatch
-- like "P-023-1435: bill was 16,493 but 21,493 was paid, note says an
-- extra 5,000 was paid to Ali".
CREATE OR REPLACE FUNCTION public.agent_find_invoice(_tenant_id uuid, _invoice_no text)
RETURNS TABLE(
  kind text, invoice_no text, created_at timestamptz,
  subtotal numeric, total numeric, paid numeric, note text,
  party_name text, items jsonb
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  SELECT 'sale'::text, s.invoice_no, s.created_at, s.subtotal, s.total, s.paid, s.note,
    COALESCE(c.name, ep.name, 'Walk-in'),
    COALESCE((SELECT jsonb_agg(jsonb_build_object('name', si.name, 'qty', si.qty, 'price', si.price, 'line_total', si.line_total))
      FROM public.sale_items si WHERE si.sale_id = s.id), '[]'::jsonb)
  FROM public.sales s
  LEFT JOIN public.customers c ON c.id = s.customer_id
  LEFT JOIN public.expense_persons ep ON ep.id = s.expense_person_id
  WHERE s.tenant_id = _tenant_id AND s.invoice_no ILIKE _invoice_no
  UNION ALL
  SELECT 'purchase'::text, p.invoice_no, p.created_at, p.subtotal, p.total, p.paid, p.note,
    COALESCE(sup.name, 'Unknown supplier'),
    COALESCE((SELECT jsonb_agg(jsonb_build_object('name', pi.name, 'qty', pi.qty, 'cost', pi.cost, 'line_total', pi.line_total))
      FROM public.purchase_items pi WHERE pi.purchase_id = p.id), '[]'::jsonb)
  FROM public.purchases p
  LEFT JOIN public.suppliers sup ON sup.id = p.supplier_id
  WHERE p.tenant_id = _tenant_id AND p.invoice_no ILIKE _invoice_no
  LIMIT 5;
END;
$function$;
REVOKE ALL ON FUNCTION public.agent_find_invoice(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agent_find_invoice(uuid, text) TO service_role;

-- Customer ledger balance by name/phone search -- mirrors
-- get_customer_balances()'s formula (20260907040000_get_customer_balances.sql)
-- exactly, parameterized instead of reading current_tenant_id(), since this
-- runs from a webhook with no authenticated session.
CREATE OR REPLACE FUNCTION public.agent_customer_balance(_tenant_id uuid, _query text)
RETURNS TABLE(name text, phone text, opening_balance numeric, current_balance numeric)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  SELECT
    c.name, c.phone, c.opening_balance,
    (
      COALESCE(c.opening_balance, 0)
      + COALESCE((SELECT SUM(s.total - s.paid) FROM public.sales s WHERE s.customer_id = c.id AND s.tenant_id = _tenant_id), 0)
      - COALESCE((SELECT SUM(sr.total) FROM public.sale_returns sr WHERE sr.customer_id = c.id AND sr.tenant_id = _tenant_id), 0)
      - COALESCE((SELECT SUM(pp.amount) FROM public.party_payments pp WHERE pp.party_id = c.id AND pp.party_type = 'customer' AND pp.tenant_id = _tenant_id AND COALESCE(pp.note, '') !~* '^\s*cash\s*out\y'), 0)
      + COALESCE((SELECT SUM(pp.amount) FROM public.party_payments pp WHERE pp.party_id = c.id AND pp.party_type = 'customer' AND pp.tenant_id = _tenant_id AND COALESCE(pp.note, '') ~* '^\s*cash\s*out\y'), 0)
    ) AS current_balance
  FROM public.customers c
  WHERE c.tenant_id = _tenant_id
    AND (c.name ILIKE '%' || _query || '%' OR c.phone ILIKE '%' || _query || '%')
  ORDER BY c.name
  LIMIT 5;
END;
$function$;
REVOKE ALL ON FUNCTION public.agent_customer_balance(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agent_customer_balance(uuid, text) TO service_role;

-- Supplier ledger balance by name/phone search -- mirrors
-- get_supplier_balances()'s formula, parameterized the same way.
CREATE OR REPLACE FUNCTION public.agent_supplier_balance(_tenant_id uuid, _query text)
RETURNS TABLE(name text, phone text, opening_balance numeric, current_balance numeric, incentive_total numeric)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  SELECT
    sup.name, sup.phone, sup.opening_balance,
    (
      COALESCE(sup.opening_balance, 0)
      + COALESCE((SELECT SUM(p.total - p.paid - p.incentive_amount) FROM public.purchases p WHERE p.supplier_id = sup.id AND p.tenant_id = _tenant_id), 0)
      - COALESCE((SELECT SUM(pp.amount) FROM public.party_payments pp WHERE pp.party_id = sup.id AND pp.party_type = 'supplier' AND pp.tenant_id = _tenant_id), 0)
      - COALESCE((SELECT SUM(pr.total) FROM public.purchase_returns pr WHERE pr.supplier_id = sup.id AND pr.tenant_id = _tenant_id), 0)
    ) AS current_balance,
    COALESCE((SELECT SUM(p.incentive_amount) FROM public.purchases p WHERE p.supplier_id = sup.id AND p.tenant_id = _tenant_id), 0)
  FROM public.suppliers sup
  WHERE sup.tenant_id = _tenant_id
    AND (sup.name ILIKE '%' || _query || '%' OR sup.phone ILIKE '%' || _query || '%')
  ORDER BY sup.name
  LIMIT 5;
END;
$function$;
REVOKE ALL ON FUNCTION public.agent_supplier_balance(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agent_supplier_balance(uuid, text) TO service_role;
