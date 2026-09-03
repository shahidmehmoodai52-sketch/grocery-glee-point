-- Staff salary is often accrued but not taken as cash immediately (a staff
-- member "earns" the month's salary but doesn't withdraw it yet). Today
-- every expenses row is treated as an immediate cash outflow, so there was
-- no way to record "owed but not yet paid" without corrupting Cash Flow.
-- This adds a proper debit/credit staff ledger, mirroring the existing
-- supplier ledger pattern exactly (record_payment/party_payments/
-- get_supplier_ledger), reusing all the same generic infrastructure.

-- 1. expenses.paid: true (default) preserves every existing row's behavior
--    exactly — an immediate cash outflow via `method`. false means accrued
--    only: it counts as a debit in the staff's ledger balance but never
--    touches any cash_account / Cash Flow.
ALTER TABLE public.expenses
  ADD COLUMN IF NOT EXISTS paid boolean NOT NULL DEFAULT true;

-- 2. Exclude accrued-but-unpaid expenses from Cash Flow — same principle
--    already applied to 'staff_purchase' category rows just above.
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
END $function$;

-- 3. record_payment: accept 'expense_person' as a third party type. Money
--    always flows 'out' (same as supplier); no stored balance column on
--    expense_persons (unlike customers/suppliers) — the ledger RPC below
--    always computes balance fresh from expenses + party_payments, so
--    there's nothing to keep in sync here, avoiding an entire class of
--    stored/computed-balance drift bugs.
CREATE OR REPLACE FUNCTION public.record_payment(p_party_type text, p_party_id uuid, p_amount numeric, p_method text, p_note text, p_account_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_id uuid;
  v_tx_id uuid;
  v_uid uuid := auth.uid();
  v_tenant uuid := public.current_tenant_id();
  v_ok boolean;
  v_account_name text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'No active tenant'; END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Payment amount must be positive';
  END IF;
  IF p_party_type NOT IN ('customer','supplier','expense_person') THEN
    RAISE EXCEPTION 'Invalid party type';
  END IF;

  IF p_party_type = 'customer' THEN
    SELECT true INTO v_ok FROM public.customers WHERE id = p_party_id AND tenant_id = v_tenant;
  ELSIF p_party_type = 'supplier' THEN
    SELECT true INTO v_ok FROM public.suppliers WHERE id = p_party_id AND tenant_id = v_tenant;
  ELSE
    SELECT true INTO v_ok FROM public.expense_persons WHERE id = p_party_id AND tenant_id = v_tenant;
  END IF;
  IF NOT COALESCE(v_ok,false) THEN RAISE EXCEPTION 'Party does not belong to current tenant'; END IF;

  IF p_account_id IS NOT NULL THEN
    SELECT name INTO v_account_name
      FROM public.cash_accounts
      WHERE id = p_account_id AND tenant_id = v_tenant AND is_active = true;
    IF v_account_name IS NULL THEN RAISE EXCEPTION 'Payment source account not found'; END IF;
  END IF;

  IF p_account_id IS NOT NULL THEN
    INSERT INTO public.cash_transactions (
      tenant_id, account_id, direction, amount, occurred_on, category, reference, notes, user_id
    ) VALUES (
      v_tenant,
      p_account_id,
      CASE WHEN p_party_type = 'customer' THEN 'in' ELSE 'out' END,
      p_amount,
      CURRENT_DATE,
      CASE WHEN p_party_type = 'customer' THEN 'customer_payment' WHEN p_party_type = 'supplier' THEN 'supplier_payment' ELSE 'staff_payment' END,
      p_party_type || ':' || p_party_id::text,
      NULLIF(p_note, ''),
      v_uid
    ) RETURNING id INTO v_tx_id;
  END IF;

  INSERT INTO public.party_payments (tenant_id, party_type, party_id, amount, method, note, user_id, cash_transaction_id)
  VALUES (v_tenant, p_party_type, p_party_id, p_amount, COALESCE(v_account_name, NULLIF(p_method,''), 'cash'), p_note, v_uid, v_tx_id)
  RETURNING id INTO v_id;

  IF v_tx_id IS NOT NULL THEN
    UPDATE public.cash_transactions
      SET reference = 'party_payment:' || v_id::text
      WHERE id = v_tx_id AND tenant_id = v_tenant;
  END IF;

  IF p_party_type = 'customer' THEN
    UPDATE public.customers SET balance = balance - p_amount WHERE id = p_party_id;
  ELSIF p_party_type = 'supplier' THEN
    UPDATE public.suppliers SET balance = balance - p_amount WHERE id = p_party_id;
  END IF;
  RETURN v_id;
END;
$function$;

-- 4. update_party_payment / delete_party_payment: same 3-way widening.
CREATE OR REPLACE FUNCTION public.update_party_payment(_id uuid, _amount numeric, _method text, _note text, _created_at timestamp with time zone, _account_id uuid DEFAULT NULL::uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_old numeric;
  v_type text;
  v_party uuid;
  v_delta numeric;
  v_tenant uuid := public.current_tenant_id();
  v_tx_id uuid;
  v_account_id uuid;
  v_account_name text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'No active tenant'; END IF;
  IF NOT has_role(auth.uid(),'admin') THEN RAISE EXCEPTION 'Forbidden'; END IF;
  IF _amount IS NULL OR _amount <= 0 THEN RAISE EXCEPTION 'Amount must be positive'; END IF;

  SELECT amount, party_type, party_id, cash_transaction_id INTO v_old, v_type, v_party, v_tx_id
    FROM public.party_payments WHERE id = _id AND tenant_id = v_tenant FOR UPDATE;
  IF v_old IS NULL THEN RAISE EXCEPTION 'Payment not found'; END IF;

  v_delta := _amount - v_old;
  v_account_id := _account_id;

  IF v_account_id IS NULL AND v_tx_id IS NOT NULL THEN
    SELECT account_id INTO v_account_id
      FROM public.cash_transactions
      WHERE id = v_tx_id AND tenant_id = v_tenant;
  END IF;

  IF v_account_id IS NOT NULL THEN
    SELECT name INTO v_account_name
      FROM public.cash_accounts
      WHERE id = v_account_id AND tenant_id = v_tenant AND is_active = true;
    IF v_account_name IS NULL THEN RAISE EXCEPTION 'Payment source account not found'; END IF;
  END IF;

  IF v_account_id IS NOT NULL THEN
    IF v_tx_id IS NULL THEN
      INSERT INTO public.cash_transactions (
        tenant_id, account_id, direction, amount, occurred_on, category, reference, notes, user_id, created_at
      ) VALUES (
        v_tenant,
        v_account_id,
        CASE WHEN v_type = 'customer' THEN 'in' ELSE 'out' END,
        _amount,
        COALESCE(_created_at::date, CURRENT_DATE),
        CASE WHEN v_type = 'customer' THEN 'customer_payment' WHEN v_type = 'supplier' THEN 'supplier_payment' ELSE 'staff_payment' END,
        'party_payment:' || _id::text,
        NULLIF(_note, ''),
        auth.uid(),
        COALESCE(_created_at, now())
      ) RETURNING id INTO v_tx_id;
    ELSE
      UPDATE public.cash_transactions
        SET account_id = v_account_id,
            direction = CASE WHEN v_type = 'customer' THEN 'in' ELSE 'out' END,
            amount = _amount,
            occurred_on = COALESCE(_created_at::date, occurred_on),
            category = CASE WHEN v_type = 'customer' THEN 'customer_payment' WHEN v_type = 'supplier' THEN 'supplier_payment' ELSE 'staff_payment' END,
            reference = 'party_payment:' || _id::text,
            notes = NULLIF(_note, ''),
            created_at = COALESCE(_created_at, created_at)
        WHERE id = v_tx_id AND tenant_id = v_tenant;
    END IF;
  END IF;

  UPDATE public.party_payments
    SET amount = _amount,
        method = COALESCE(v_account_name, NULLIF(_method,''), method),
        note = _note,
        created_at = COALESCE(_created_at, created_at),
        cash_transaction_id = v_tx_id
    WHERE id = _id;

  IF v_delta <> 0 THEN
    IF v_type = 'customer' THEN
      UPDATE public.customers SET balance = balance - v_delta WHERE id = v_party;
    ELSIF v_type = 'supplier' THEN
      UPDATE public.suppliers SET balance = balance - v_delta WHERE id = v_party;
    END IF;
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.delete_party_payment(_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_amount numeric;
  v_type text;
  v_party uuid;
  v_tenant uuid := public.current_tenant_id();
  v_tx_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'No active tenant'; END IF;
  IF NOT has_role(auth.uid(),'admin') THEN RAISE EXCEPTION 'Forbidden'; END IF;

  SELECT amount, party_type, party_id, cash_transaction_id INTO v_amount, v_type, v_party, v_tx_id
    FROM public.party_payments WHERE id = _id AND tenant_id = v_tenant FOR UPDATE;
  IF v_amount IS NULL THEN RAISE EXCEPTION 'Payment not found'; END IF;

  DELETE FROM public.party_payments WHERE id = _id;

  IF v_tx_id IS NOT NULL THEN
    DELETE FROM public.cash_transactions WHERE id = v_tx_id AND tenant_id = v_tenant;
  END IF;

  IF v_type = 'customer' THEN
    UPDATE public.customers SET balance = balance + v_amount WHERE id = v_party;
  ELSIF v_type = 'supplier' THEN
    UPDATE public.suppliers SET balance = balance + v_amount WHERE id = v_party;
  END IF;
END;
$function$;

-- 5. get_expense_person_ledger: mirrors get_supplier_ledger. Every expense
--    row is a debit (full liability); paid=true expenses get a matching
--    credit ("paid immediately") so they net to zero, exactly like a
--    purchase's total+paid pair; paid=false ones stay as an open debit
--    until a later party_payments row settles them.
CREATE OR REPLACE FUNCTION public.get_expense_person_ledger(p_person_id uuid)
 RETURNS TABLE(id uuid, occurred_at timestamp with time zone, entry_type text, reference text, note text, debit numeric, credit numeric, source_data jsonb)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant_id uuid := public.current_tenant_id();
BEGIN
  IF v_tenant_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.expense_persons ep
    WHERE ep.id = p_person_id AND ep.tenant_id = v_tenant_id
  ) THEN
    SELECT ep.tenant_id INTO v_tenant_id
    FROM public.expense_persons ep
    WHERE ep.id = p_person_id
      AND EXISTS (
        SELECT 1 FROM public.tenant_members tm
        WHERE tm.tenant_id = ep.tenant_id AND tm.user_id = auth.uid()
      )
    LIMIT 1;
  END IF;

  IF v_tenant_id IS NULL THEN
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.expense_persons ep
    WHERE ep.id = p_person_id AND ep.tenant_id = v_tenant_id
  ) THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT * FROM (
    SELECT e.id, e.created_at as occurred_at, 'expense'::text as entry_type, e.category as reference, COALESCE(e.description, '') as note, e.amount as debit, 0::numeric as credit, to_jsonb(e) as source_data
    FROM public.expenses e
    WHERE e.person_id = p_person_id AND e.tenant_id = v_tenant_id
    UNION ALL
    SELECT NULL::uuid, e.created_at as occurred_at, 'expense_payment'::text as entry_type, e.category || ' · paid immediately' as reference, 'Paid immediately'::text as note, 0::numeric as debit, e.amount as credit, jsonb_build_object('expense_id', e.id, 'amount', e.amount) as source_data
    FROM public.expenses e
    WHERE e.person_id = p_person_id AND e.tenant_id = v_tenant_id AND e.paid
    UNION ALL
    SELECT pp.id, pp.created_at as occurred_at, 'payment'::text as entry_type, COALESCE(pp.method, 'Payment') as reference, COALESCE(pp.note, '') as note, 0::numeric as debit, pp.amount as credit, to_jsonb(pp) as source_data
    FROM public.party_payments pp
    WHERE pp.party_id = p_person_id AND pp.party_type = 'expense_person' AND pp.tenant_id = v_tenant_id
  ) sub
  ORDER BY occurred_at;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_expense_person_ledger(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_expense_person_ledger(uuid) TO authenticated;

-- 6. party_payments.party_type CHECK constraint was hardcoded to
--    customer/supplier — widen it to allow expense_person too.
ALTER TABLE public.party_payments DROP CONSTRAINT IF EXISTS party_payments_party_type_check;
ALTER TABLE public.party_payments ADD CONSTRAINT party_payments_party_type_check
  CHECK (party_type = ANY (ARRAY['customer'::text, 'supplier'::text, 'expense_person'::text]));
