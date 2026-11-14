-- Objects that exist on the live database but were never written into
-- supabase/migrations (changed directly on live). Copied verbatim from the
-- live catalog (pg_get_functiondef) so the offline edition matches it.
-- Batch A: invoice numbering, timezone/payment helpers, staff-purchase rule.

CREATE SEQUENCE IF NOT EXISTS public.tenant_code_seq;
CREATE SEQUENCE IF NOT EXISTS public.purchase_invoice_seq START 1001;
CREATE SEQUENCE IF NOT EXISTS public.purchase_return_seq START 1001;
CREATE SEQUENCE IF NOT EXISTS public.sale_invoice_seq START 1001;
CREATE SEQUENCE IF NOT EXISTS public.sale_return_seq START 1001;

ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS shop_code text DEFAULT lpad((nextval('tenant_code_seq'::regclass))::text, 3, '0'::text);
ALTER TABLE public.tenants ALTER COLUMN library_approved SET DEFAULT false;
ALTER TABLE public.store_settings ADD COLUMN IF NOT EXISTS timezone text NOT NULL DEFAULT 'Asia/Karachi'::text;
ALTER TABLE public.tenant_sequences ADD COLUMN IF NOT EXISTS last_purchase_return_value bigint NOT NULL DEFAULT 1000;
ALTER TABLE public.tenant_sequences ADD COLUMN IF NOT EXISTS last_sale_return_value bigint NOT NULL DEFAULT 1000;

CREATE OR REPLACE FUNCTION public.enforce_staff_purchase_rules()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- A sale charged to an expense head is absorbed by the shop:
  -- it is always fully settled, never a receivable, never on a customer ledger.
  IF NEW.expense_person_id IS NOT NULL AND COALESCE(NEW.status,'') <> 'voided' THEN
    NEW.paid        := NEW.total;
    NEW.status      := 'completed';
    NEW.change_due  := 0;
    NEW.customer_id := NULL;
  END IF;
  RETURN NEW;
END $function$
;

CREATE OR REPLACE FUNCTION public.next_purchase_invoice_no()
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tid uuid := current_tenant_id();
  v_val bigint;
  v_code text;
BEGIN
  IF v_tid IS NULL THEN
    RETURN 'P-' || nextval('purchase_invoice_seq');
  END IF;

  SELECT shop_code INTO v_code FROM tenants WHERE id = v_tid;

  INSERT INTO tenant_sequences (tenant_id, last_sale_value, last_purchase_value)
  VALUES (v_tid, 1000, 1001)
  ON CONFLICT (tenant_id) DO UPDATE SET last_purchase_value = tenant_sequences.last_purchase_value + 1
  RETURNING last_purchase_value INTO v_val;

  RETURN 'P-' || COALESCE(v_code, '000') || '-' || v_val;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.next_purchase_return_no()
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tid uuid := public.current_tenant_id();
  v_val bigint;
  v_code text;
BEGIN
  IF v_tid IS NULL THEN
    RETURN 'PR-' || nextval('purchase_return_seq');
  END IF;

  SELECT shop_code INTO v_code FROM public.tenants WHERE id = v_tid;

  INSERT INTO public.tenant_sequences (tenant_id, last_purchase_return_value)
  VALUES (v_tid, 1001)
  ON CONFLICT (tenant_id) DO UPDATE
    SET last_purchase_return_value = tenant_sequences.last_purchase_return_value + 1
  RETURNING last_purchase_return_value INTO v_val;

  RETURN 'PR-' || COALESCE(v_code, '000') || '-' || v_val;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.next_sale_invoice_no()
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tid uuid := current_tenant_id();
  v_val bigint;
  v_code text;
BEGIN
  IF v_tid IS NULL THEN
    RETURN 'S-' || nextval('sale_invoice_seq');
  END IF;

  SELECT shop_code INTO v_code FROM tenants WHERE id = v_tid;

  INSERT INTO tenant_sequences (tenant_id, last_sale_value, last_purchase_value)
  VALUES (v_tid, 1001, 1000)
  ON CONFLICT (tenant_id) DO UPDATE SET last_sale_value = tenant_sequences.last_sale_value + 1
  RETURNING last_sale_value INTO v_val;

  RETURN 'S-' || COALESCE(v_code, '000') || '-' || v_val;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.next_sale_return_no()
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tid uuid := public.current_tenant_id();
  v_val bigint;
  v_code text;
BEGIN
  IF v_tid IS NULL THEN
    RETURN 'SR-' || nextval('sale_return_seq');
  END IF;

  SELECT shop_code INTO v_code FROM public.tenants WHERE id = v_tid;

  INSERT INTO public.tenant_sequences (tenant_id, last_sale_return_value)
  VALUES (v_tid, 1001)
  ON CONFLICT (tenant_id) DO UPDATE
    SET last_sale_return_value = tenant_sequences.last_sale_return_value + 1
  RETURNING last_sale_return_value INTO v_val;

  RETURN 'SR-' || COALESCE(v_code, '000') || '-' || v_val;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.resolve_payment_bucket(p_method text)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
AS $function$
DECLARE
  v_m text := lower(trim(COALESCE(p_method, 'cash')));
BEGIN
  IF v_m = '' OR v_m = 'cash' THEN RETURN 'cash'; END IF;
  IF v_m LIKE '%card%' THEN RETURN 'card'; END IF;
  IF v_m LIKE '%bank%' OR v_m LIKE '%online%' OR v_m LIKE '%transfer%' OR v_m LIKE '%cheque%' OR v_m LIKE '%check%' THEN RETURN 'bank'; END IF;
  IF v_m LIKE '%easy%' OR v_m LIKE '%jazz%' OR v_m LIKE '%wallet%' OR v_m LIKE '%upi%' OR v_m LIKE '%mobile%' THEN RETURN 'mobile_wallet'; END IF;
  RETURN 'other';
END $function$
;

CREATE OR REPLACE FUNCTION public.resolve_cash_account(p_tenant_id uuid, p_method text)
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE(
    -- 1. Exact account NAME match (POS stores the account name in payment_method)
    (SELECT ca.id FROM cash_accounts ca
      WHERE ca.tenant_id = p_tenant_id
        AND lower(trim(ca.name)) = lower(trim(COALESCE(p_method, '')))
        AND ca.is_active
      ORDER BY ca.created_at LIMIT 1),

    -- 2. Keyword bucket, but ONLY for real payment instruments.
    --    'other' is deliberately excluded: accounts of type 'other' (Temp Loan,
    --    committee funds, etc.) are purpose-specific and must never be a
    --    dumping ground for unrecognised methods.
    (SELECT ca.id FROM cash_accounts ca
      WHERE ca.tenant_id = p_tenant_id
        AND ca.type = public.resolve_payment_bucket(p_method)
        AND public.resolve_payment_bucket(p_method) <> 'other'
        AND ca.is_active
      ORDER BY ca.created_at LIMIT 1),

    -- 3. Anything unrecognised (credit, staff, split:..., blank) settles in cash.
    (SELECT ca.id FROM cash_accounts ca
      WHERE ca.tenant_id = p_tenant_id AND ca.type = 'cash' AND ca.is_active
      ORDER BY ca.created_at LIMIT 1)
  );
$function$
;

CREATE OR REPLACE FUNCTION public.url_decode(p_text text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE STRICT
AS $function$
  SELECT convert_from(
    CAST(E'\\x' || string_agg(
      CASE WHEN length(r.m[1]) = 1
           THEN encode(convert_to(r.m[1], 'UTF8'), 'hex')
           ELSE substring(r.m[1] from 2)
      END, '') AS bytea), 'UTF8')
  FROM regexp_matches(p_text, '%[0-9a-fA-F]{2}|.', 'g') AS r(m);
$function$
;

CREATE OR REPLACE FUNCTION public.split_payment_parts(p_method text)
 RETURNS TABLE(part_name text, part_amount numeric)
 LANGUAGE sql
 IMMUTABLE
AS $function$
  SELECT public.url_decode(split_part(kv, '=', 1)),
         NULLIF(split_part(kv, '=', 2), '')::numeric
  FROM unnest(string_to_array(regexp_replace(COALESCE(p_method,''), '^split:', ''), '|')) AS kv
  WHERE kv <> '' AND split_part(kv, '=', 2) <> '';
$function$
;

CREATE OR REPLACE FUNCTION public.tenant_timezone(p_tenant_id uuid)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  -- Falls back to Asia/Karachi if unset or if someone saves an invalid zone,
  -- so a bad value can never break reporting.
  SELECT COALESCE(
    (SELECT ss.timezone FROM store_settings ss
      WHERE ss.tenant_id = p_tenant_id
        AND ss.timezone IS NOT NULL
        AND EXISTS (SELECT 1 FROM pg_timezone_names z WHERE z.name = ss.timezone)
      LIMIT 1),
    'Asia/Karachi');
$function$
;

-- Live column defaults (invoice / return numbers per shop code).
ALTER TABLE public.sales ALTER COLUMN invoice_no SET DEFAULT next_sale_invoice_no();
ALTER TABLE public.purchases ALTER COLUMN invoice_no SET DEFAULT next_purchase_invoice_no();
ALTER TABLE public.sale_returns ALTER COLUMN return_no SET DEFAULT next_sale_return_no();
ALTER TABLE public.purchase_returns ALTER COLUMN return_no SET DEFAULT next_purchase_return_no();

CREATE OR REPLACE TRIGGER trg_staff_purchase_rules BEFORE INSERT OR UPDATE ON public.sales FOR EACH ROW EXECUTE FUNCTION enforce_staff_purchase_rules();
-- Dropped on live.
DROP TRIGGER IF EXISTS trg_audit_products ON public.products;

-- Live replaced the 6-argument ledger with this 7-argument one.
DROP FUNCTION IF EXISTS public.get_cash_flow_ledger(timestamptz, timestamptz, uuid, text, integer, integer);
CREATE OR REPLACE FUNCTION public.get_cash_flow_ledger(p_from_date timestamp with time zone DEFAULT NULL::timestamp with time zone, p_to_date timestamp with time zone DEFAULT NULL::timestamp with time zone, p_account_id uuid DEFAULT NULL::uuid, p_search text DEFAULT NULL::text, p_offset integer DEFAULT 0, p_limit integer DEFAULT 1000, p_payment_method text DEFAULT NULL::text)
 RETURNS TABLE(id text, occurred_on date, created_at timestamp with time zone, direction text, amount numeric, category text, reference text, notes text, account_id uuid, account_name text, payment_method text, total_count bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant_id uuid := public.current_tenant_id();
BEGIN
  RETURN QUERY
  WITH
  method_map AS (
    SELECT d.m, public.resolve_cash_account(v_tenant_id, NULLIF(d.m,'')) AS acct
    FROM (
      SELECT DISTINCT COALESCE(sa.payment_method,'') AS m FROM sales sa
        WHERE sa.tenant_id = v_tenant_id AND sa.paid > 0 AND sa.status <> 'voided'
      UNION SELECT DISTINCT COALESCE(sr2.refund_method,'') FROM sale_returns sr2
        WHERE sr2.tenant_id = v_tenant_id AND sr2.refund_amount > 0
      UNION SELECT DISTINCT COALESCE(pu.payment_method,'') FROM purchases pu
        WHERE pu.tenant_id = v_tenant_id AND pu.paid > 0
      UNION SELECT DISTINCT COALESCE(ex.method,'') FROM expenses ex
        WHERE ex.tenant_id = v_tenant_id
      UNION SELECT DISTINCT sp2.part_name FROM sales s2
        CROSS JOIN LATERAL public.split_payment_parts(s2.payment_method) sp2
        WHERE s2.tenant_id = v_tenant_id AND s2.payment_method LIKE 'split:%'
    ) d
  ),
  raw_entries AS (
    -- Manual cash entries. Staff purchases are excluded: the goods leave the
    -- shop but no cash leaves the drawer, so they must not move cash.
    SELECT 
      ct.id::text, ct.occurred_on, ct.created_at, ct.direction, ct.amount, ct.category,
      ct.reference, ct.notes, ct.account_id, ca.name, ct.payment_method
    FROM cash_transactions ct
    LEFT JOIN cash_accounts ca ON ca.id = ct.account_id
    WHERE ct.tenant_id = v_tenant_id
      AND ct.category <> 'staff_purchase'
    UNION ALL
    SELECT 
      'sale:' || s.id, s.created_at::date, s.created_at, 'in', s.paid, 'sale',
      s.invoice_no, c.name, mm.acct, s.payment_method, s.payment_method
    FROM sales s
    LEFT JOIN customers c ON c.id = s.customer_id
    LEFT JOIN method_map mm ON mm.m = COALESCE(s.payment_method,'')
    WHERE s.tenant_id = v_tenant_id AND s.paid > 0 AND s.status <> 'voided' AND s.expense_person_id IS NULL
      AND COALESCE(s.payment_method,'') NOT LIKE 'split:%'
      AND NOT EXISTS (SELECT 1 FROM cash_transactions ct2 WHERE ct2.tenant_id = v_tenant_id AND ct2.reference = s.invoice_no)
    UNION ALL
    SELECT 
      'sale:' || s.id || ':' || sp.part_name, s.created_at::date, s.created_at, 'in', sp.part_amount, 'sale',
      s.invoice_no, c.name, mm.acct, sp.part_name, sp.part_name
    FROM sales s
    LEFT JOIN customers c ON c.id = s.customer_id
    CROSS JOIN LATERAL public.split_payment_parts(s.payment_method) sp
    LEFT JOIN method_map mm ON mm.m = sp.part_name
    WHERE s.tenant_id = v_tenant_id AND s.paid > 0 AND s.status <> 'voided' AND s.expense_person_id IS NULL
      AND s.payment_method LIKE 'split:%'
      AND NOT EXISTS (SELECT 1 FROM cash_transactions ct2 WHERE ct2.tenant_id = v_tenant_id AND ct2.reference = s.invoice_no)
    UNION ALL
    SELECT 
      'sret:' || sr.id, sr.created_at::date, sr.created_at, 'out', sr.refund_amount, 'sale_return',
      sr.return_no, c.name, mm.acct, sr.refund_method, sr.refund_method
    FROM sale_returns sr
    LEFT JOIN customers c ON c.id = sr.customer_id
    LEFT JOIN method_map mm ON mm.m = COALESCE(sr.refund_method,'')
    WHERE sr.tenant_id = v_tenant_id AND sr.refund_amount > 0
      AND NOT EXISTS (SELECT 1 FROM cash_transactions ct2 WHERE ct2.tenant_id = v_tenant_id AND ct2.reference = sr.return_no)
    UNION ALL
    SELECT 
      'pur:' || p.id, p.created_at::date, p.created_at, 'out', p.paid, 'purchase',
      p.invoice_no, sup.name, COALESCE(p.account_id, mm.acct), p.payment_method, p.payment_method
    FROM purchases p
    LEFT JOIN suppliers sup ON sup.id = p.supplier_id
    LEFT JOIN method_map mm ON mm.m = COALESCE(p.payment_method,'')
    WHERE p.tenant_id = v_tenant_id AND p.paid > 0
      AND NOT EXISTS (SELECT 1 FROM cash_transactions ct2 WHERE ct2.tenant_id = v_tenant_id AND ct2.reference = p.invoice_no)
    UNION ALL
    -- Expenses, minus staff purchases (no cash movement), minus accrued
    -- unpaid expenses (paid = false — no cash movement either), and minus
    -- any expense that already has its own cash transaction.
    SELECT 
      'exp:' || e.id, e.expense_date, e.created_at, 'out', e.amount, 'expense',
      e.category, e.description, mm.acct, e.method, e.method
    FROM expenses e
    LEFT JOIN method_map mm ON mm.m = COALESCE(e.method,'')
    WHERE e.tenant_id = v_tenant_id
      AND COALESCE(e.category,'') <> 'staff_purchase'
      AND e.paid
      AND e.sale_id IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM cash_transactions ct2
        WHERE ct2.tenant_id = v_tenant_id AND ct2.category = 'expense'
          AND ct2.amount = e.amount
          AND abs(extract(epoch from (ct2.created_at - e.created_at))) < 2
      )
  ),
  filtered AS (
    SELECT * FROM raw_entries r(e_id,e_occurred_on,e_created_at,e_direction,e_amount,e_category,e_reference,e_notes,e_account_id,e_account_name,e_payment_method)
    WHERE (p_from_date IS NULL OR e_created_at >= p_from_date)
      AND (p_to_date IS NULL OR e_created_at <= p_to_date)
      AND (p_account_id IS NULL OR e_account_id = p_account_id)
      AND (p_payment_method IS NULL OR lower(e_payment_method) = lower(p_payment_method))
      AND (p_search IS NULL OR e_reference ILIKE '%' || p_search || '%' OR e_notes ILIKE '%' || p_search || '%')
  )
  SELECT e_id, e_occurred_on, e_created_at, e_direction, e_amount, e_category, e_reference, e_notes, e_account_id, e_account_name, e_payment_method,
    count(*) OVER() as total_count
  FROM filtered
  ORDER BY e_created_at DESC
  OFFSET p_offset LIMIT p_limit;
END $function$
;
