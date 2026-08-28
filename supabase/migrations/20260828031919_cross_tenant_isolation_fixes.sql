-- Security audit: cross-tenant data isolation.
--
-- current_tenant_id() is the trust root behind nearly every RLS policy in
-- this database (`tenant_id = current_tenant_id()`), so any weakness here
-- is systemic. It trusted an `app_metadata.tenant_id` JWT claim before ever
-- checking tenant_members — a claim nothing in this app ever sets (no
-- Supabase Auth Hook exists, and clients cannot write their own
-- app_metadata), so it was dead code with zero legitimate use and pure
-- downside: if anything ever set that claim in the future without first
-- verifying membership, it would grant instant impersonation of any tenant.
-- Removed entirely; current_tenant_id() now only ever resolves via a real
-- tenant_members row.
CREATE OR REPLACE FUNCTION public.current_tenant_id()
 RETURNS uuid
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_tid uuid;
BEGIN
  IF v_uid IS NULL THEN RETURN NULL; END IF;

  SELECT tenant_id INTO v_tid
    FROM public.tenant_members
    WHERE user_id = v_uid
    ORDER BY created_at DESC
    LIMIT 1;

  RETURN v_tid;
END $function$;

-- complete_sale() read `payload->>'_tenant_id'` and used it as-is with no
-- membership check — every sibling transaction function (complete_purchase,
-- complete_sale_return, complete_purchase_return, edit_sale, void_sale,
-- undo_last_sale, delete_purchase_v2) already verifies tenant membership,
-- this one alone did not. Any authenticated user (including a brand-new
-- trial signup) could inject a fabricated sale directly into another
-- tenant's sales table, decrementing that tenant's real stock and inflating
-- a real customer's debt, just by knowing/guessing that tenant's UUID.
-- The payload._tenant_id field itself is legitimate (it lets an
-- offline-queued sale replay against the tenant it was created under after
-- reconnecting) — it just needed the same membership check every other
-- function already has. Also added the customer_id/product_id
-- tenant-ownership checks complete_purchase/complete_sale_return already
-- had, which complete_sale was missing entirely.
CREATE OR REPLACE FUNCTION public.complete_sale(payload jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_sale_id UUID;
  v_item JSONB;
  v_subtotal NUMERIC := 0;
  v_cost_total NUMERIC := 0;
  v_tax NUMERIC := COALESCE((payload->>'tax')::NUMERIC, 0);
  v_discount NUMERIC := COALESCE((payload->>'discount')::NUMERIC, 0);
  v_paid NUMERIC := COALESCE((payload->>'paid')::NUMERIC, 0);
  v_total NUMERIC;
  v_change NUMERIC;
  v_status TEXT;
  v_customer UUID := NULLIF(payload->>'customer_id','')::UUID;
  v_person UUID := NULLIF(payload->>'expense_person_id','')::UUID;
  v_method TEXT := COALESCE(payload->>'payment_method','cash');
  v_uid UUID := auth.uid();
  v_tenant_id UUID;
  v_invoice_no TEXT;
  v_next_val BIGINT;
  v_shop_code TEXT;
  v_cash_account_id UUID;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  v_tenant_id := (payload->>'_tenant_id')::UUID;

  IF v_tenant_id IS NULL THEN
    SELECT tenant_id INTO v_tenant_id FROM public.tenant_members WHERE user_id = v_uid LIMIT 1;
  END IF;

  IF v_tenant_id IS NULL THEN RAISE EXCEPTION 'Tenant not found for user'; END IF;

  -- The caller must actually belong to whatever tenant they're writing into —
  -- payload._tenant_id exists only so a queued offline sale replays against
  -- the tenant it was created under; it must never be trusted blindly.
  IF NOT EXISTS (
    SELECT 1 FROM public.tenant_members tm
    WHERE tm.user_id = v_uid AND tm.tenant_id = v_tenant_id
  ) THEN
    RAISE EXCEPTION 'User is not a member of this tenant';
  END IF;

  IF v_person IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.expense_persons
       WHERE id = v_person AND tenant_id = v_tenant_id
    ) THEN
      RAISE EXCEPTION 'Staff/owner does not belong to current tenant';
    END IF;
    v_customer := NULL;
  END IF;

  IF v_customer IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.customers WHERE id = v_customer AND tenant_id = v_tenant_id
    ) THEN
      RAISE EXCEPTION 'Customer does not belong to current tenant';
    END IF;
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(payload->'items') LOOP
    IF NULLIF(v_item->>'product_id','') IS NOT NULL THEN
      IF NOT EXISTS (
        SELECT 1 FROM public.products WHERE id = (v_item->>'product_id')::UUID AND tenant_id = v_tenant_id
      ) THEN
        RAISE EXCEPTION 'Product % does not belong to current tenant', v_item->>'product_id';
      END IF;
    END IF;
    v_subtotal := v_subtotal + ((v_item->>'qty')::NUMERIC * (v_item->>'price')::NUMERIC);
    v_cost_total := v_cost_total + ((v_item->>'qty')::NUMERIC * COALESCE((v_item->>'cost')::NUMERIC, 0));
  END LOOP;

  v_total := v_subtotal + v_tax - v_discount;

  IF v_person IS NOT NULL THEN
    v_paid := v_total;
  END IF;

  v_change := GREATEST(v_paid - v_total, 0);
  IF v_paid >= v_total THEN v_status := 'completed';
  ELSE v_status := 'credit'; END IF;

  SELECT shop_code INTO v_shop_code FROM public.tenants WHERE id = v_tenant_id;

  INSERT INTO public.tenant_sequences (tenant_id, last_sale_value)
  VALUES (v_tenant_id, 1001)
  ON CONFLICT (tenant_id) DO UPDATE
  SET last_sale_value = tenant_sequences.last_sale_value + 1
  RETURNING last_sale_value INTO v_next_val;

  v_invoice_no := 'S-' || COALESCE(v_shop_code, '000') || '-' || v_next_val;

  INSERT INTO public.sales (tenant_id, invoice_no, customer_id, expense_person_id, cashier_id, subtotal, tax, discount, total, cost_total, paid, change_due, payment_method, status, note, created_at)
  VALUES (
    v_tenant_id, v_invoice_no, v_customer, v_person, v_uid,
    v_subtotal, v_tax, v_discount, v_total, v_cost_total, v_paid, v_change,
    v_method, v_status, payload->>'note',
    COALESCE((payload->>'_created_at')::TIMESTAMPTZ, now())
  )
  RETURNING id INTO v_sale_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(payload->'items') LOOP
    INSERT INTO public.sale_items (tenant_id, sale_id, product_id, name, qty, price, cost, line_total)
    VALUES (
      v_tenant_id, v_sale_id, NULLIF(v_item->>'product_id','')::UUID,
      v_item->>'name', (v_item->>'qty')::NUMERIC, (v_item->>'price')::NUMERIC,
      COALESCE((v_item->>'cost')::NUMERIC, 0),
      (v_item->>'qty')::NUMERIC * (v_item->>'price')::NUMERIC
    );
    IF NULLIF(v_item->>'product_id','') IS NOT NULL THEN
      UPDATE public.products SET stock = stock - (v_item->>'qty')::NUMERIC, updated_at = now()
      WHERE id = (v_item->>'product_id')::UUID AND tenant_id = v_tenant_id;
    END IF;
  END LOOP;

  IF v_status = 'credit' AND v_customer IS NOT NULL THEN
    UPDATE public.customers SET balance = balance + (v_total - v_paid) WHERE id = v_customer;
  END IF;

  IF v_person IS NOT NULL AND v_total > 0 THEN
    INSERT INTO public.expenses (tenant_id, person_id, sale_id, category, amount, description, method, expense_date, user_id)
    VALUES (
      v_tenant_id, v_person, v_sale_id, 'staff_purchase', v_total,
      'Mart purchase · invoice ' || v_invoice_no, v_method,
      (COALESCE((payload->>'_created_at')::TIMESTAMPTZ, now()))::DATE, v_uid
    );

    SELECT id INTO v_cash_account_id
      FROM public.cash_accounts
      WHERE tenant_id = v_tenant_id AND (LOWER(name) = LOWER(v_method) OR type = 'cash')
      ORDER BY (LOWER(name) = LOWER(v_method)) DESC, sort_order ASC
      LIMIT 1;

    INSERT INTO public.cash_transactions (tenant_id, account_id, direction, amount, occurred_on, category, reference, notes, user_id)
    VALUES (
      v_tenant_id, v_cash_account_id, 'out', v_total,
      (COALESCE((payload->>'_created_at')::TIMESTAMPTZ, now()))::DATE,
      'staff_purchase', 'sale:' || v_sale_id,
      'Staff purchase: ' || v_invoice_no, v_uid
    );
  END IF;

  RETURN v_sale_id;
END; $function$;

-- recalc_supplier_balances(p_tenant_id DEFAULT NULL): NULL meant "every
-- supplier on the entire platform" with no check at all — any authenticated
-- user could call it with no arguments and force a recalculation across
-- every tenant, or pass an explicit foreign tenant_id. Restrict the
-- "recalc everything" (NULL) path to super admins, and require tenant
-- membership (or super admin) for an explicit tenant_id.
CREATE OR REPLACE FUNCTION public.recalc_supplier_balances(p_tenant_id uuid DEFAULT NULL::uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_n integer;
  v_uid uuid := auth.uid();
  v_target uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  IF p_tenant_id IS NULL THEN
    IF NOT public.is_super_admin(v_uid) THEN
      RAISE EXCEPTION 'Forbidden';
    END IF;
  ELSE
    IF NOT EXISTS (
      SELECT 1 FROM public.tenant_members tm WHERE tm.user_id = v_uid AND tm.tenant_id = p_tenant_id
    ) AND NOT public.is_super_admin(v_uid) THEN
      RAISE EXCEPTION 'Forbidden';
    END IF;
  END IF;

  v_target := p_tenant_id;

  UPDATE suppliers s
  SET balance = public.supplier_balance_calc(s.id)
  WHERE (v_target IS NULL OR s.tenant_id = v_target)
    AND s.balance IS DISTINCT FROM public.supplier_balance_calc(s.id);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END $function$;

-- supplier_balance_calc(p_supplier_id) had no tenant check whatsoever —
-- any authenticated user could call it directly with any supplier UUID and
-- read another tenant's real financial balance. Now returns NULL unless
-- the caller is a member of that supplier's tenant (or a super admin).
CREATE OR REPLACE FUNCTION public.supplier_balance_calc(p_supplier_id uuid)
 RETURNS numeric
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_tenant uuid;
BEGIN
  IF v_uid IS NULL THEN RETURN NULL; END IF;

  SELECT s.tenant_id INTO v_tenant FROM public.suppliers s WHERE s.id = p_supplier_id;
  IF v_tenant IS NULL THEN RETURN NULL; END IF;

  IF NOT public.is_super_admin(v_uid) AND NOT EXISTS (
    SELECT 1 FROM public.tenant_members tm WHERE tm.user_id = v_uid AND tm.tenant_id = v_tenant
  ) THEN
    RETURN NULL;
  END IF;

  RETURN round(
      COALESCE((SELECT s.opening_balance FROM suppliers s WHERE s.id = p_supplier_id), 0)
    + COALESCE((SELECT sum(p.total) FROM purchases p WHERE p.supplier_id = p_supplier_id), 0)
    - COALESCE((SELECT sum(p.paid)  FROM purchases p WHERE p.supplier_id = p_supplier_id), 0)
    - COALESCE((SELECT sum(p.incentive_amount) FROM purchases p WHERE p.supplier_id = p_supplier_id), 0)
    - COALESCE((SELECT sum(pr.total) FROM purchase_returns pr WHERE pr.supplier_id = p_supplier_id), 0)
    - COALESCE((SELECT sum(pp.amount) FROM party_payments pp
                 WHERE pp.party_id = p_supplier_id
                   AND (pp.party_type IS NULL OR pp.party_type = 'supplier')), 0)
  , 2);
END;
$function$;

-- record_inventory_movement(_tenant_id, _product_id, ...) trusted both
-- caller-supplied parameters completely — any authenticated user could
-- inject fabricated stock-movement rows into another tenant's inventory
-- history. Every legitimate caller (record_damage, record_waste,
-- delete_purchase_v2, and the trg_*_movement triggers) already passes a
-- verified same-tenant product, so adding the check breaks nothing real.
CREATE OR REPLACE FUNCTION public.record_inventory_movement(_tenant_id uuid, _product_id uuid, _movement_type inventory_movement_type, _reference_type inventory_reference_type, _reference_id uuid, _reference_no text, _qty_change numeric, _unit_cost numeric, _user_id uuid, _customer_id uuid, _supplier_id uuid, _reason text, _note text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_id UUID;
  v_current NUMERIC;
  v_before NUMERIC;
  v_after NUMERIC;
  v_uid uuid := auth.uid();
BEGIN
  IF _product_id IS NULL OR _tenant_id IS NULL OR _qty_change IS NULL THEN
    RETURN NULL;
  END IF;

  IF v_uid IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.tenant_members tm WHERE tm.user_id = v_uid AND tm.tenant_id = _tenant_id
  ) THEN
    RAISE EXCEPTION 'User is not a member of this tenant';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.products p WHERE p.id = _product_id AND p.tenant_id = _tenant_id
  ) THEN
    RAISE EXCEPTION 'Product does not belong to this tenant';
  END IF;

  SELECT COALESCE(stock, 0) INTO v_current FROM public.products WHERE id = _product_id;
  v_before := COALESCE(v_current, 0);
  v_after  := v_before + COALESCE(_qty_change, 0);

  INSERT INTO public.inventory_movements (
    tenant_id, product_id, movement_type, reference_type, reference_id, reference_no,
    qty_change, stock_before, stock_after, unit_cost, total_cost,
    user_id, customer_id, supplier_id, reason, note
  ) VALUES (
    _tenant_id, _product_id, _movement_type, _reference_type, _reference_id, _reference_no,
    _qty_change, v_before, v_after,
    _unit_cost,
    CASE WHEN _unit_cost IS NULL THEN NULL ELSE ROUND((_unit_cost * ABS(_qty_change))::numeric, 4) END,
    _user_id, _customer_id, _supplier_id, _reason, _note
  ) RETURNING id INTO v_id;

  RETURN v_id;
END $function$;

-- consume_batches_fefo(_product_id, _qty) had no tenant check at all — any
-- authenticated user could deplete another tenant's real batch stock by
-- calling it directly with a foreign product_id.
CREATE OR REPLACE FUNCTION public.consume_batches_fefo(_product_id uuid, _qty numeric)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_remaining NUMERIC := _qty;
  v_take NUMERIC;
  v_batch RECORD;
  v_uid uuid := auth.uid();
  v_tenant uuid;
BEGIN
  IF _qty IS NULL OR _qty <= 0 THEN RETURN; END IF;

  SELECT p.tenant_id INTO v_tenant FROM public.products p WHERE p.id = _product_id;
  IF v_tenant IS NULL THEN RETURN; END IF;

  IF v_uid IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.tenant_members tm WHERE tm.user_id = v_uid AND tm.tenant_id = v_tenant
  ) THEN
    RAISE EXCEPTION 'User is not a member of this tenant';
  END IF;

  FOR v_batch IN
    SELECT id, qty_remaining
      FROM public.product_batches
     WHERE product_id = _product_id
       AND tenant_id = v_tenant
       AND qty_remaining > 0
       AND status = 'active'
     ORDER BY COALESCE(expiry_date, DATE '9999-12-31') ASC, created_at ASC
     FOR UPDATE
  LOOP
    EXIT WHEN v_remaining <= 0;
    v_take := LEAST(v_batch.qty_remaining, v_remaining);
    UPDATE public.product_batches
       SET qty_remaining = qty_remaining - v_take,
           status = CASE WHEN (qty_remaining - v_take) <= 0 THEN 'depleted' ELSE status END,
           updated_at = now()
     WHERE id = v_batch.id AND tenant_id = v_tenant;
    v_remaining := v_remaining - v_take;
  END LOOP;
END $function$;

-- Below: four lower-severity integrity fixes. Each of these already forced
-- tenant_id = current_tenant_id() on the row it inserted (so RLS still kept
-- it invisible to other tenants), but didn't verify the *referenced* id
-- (a sale/shift/product/customer) actually belonged to that tenant — a
-- caller could plant a row in their own tenant's table that dangles a
-- reference to someone else's record.
CREATE OR REPLACE FUNCTION public.log_receipt_reprint(_sale_id uuid, _reason text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid UUID := auth.uid();
  v_tenant UUID := public.current_tenant_id();
  v_shift UUID;
  v_id UUID;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'No active tenant'; END IF;

  IF NOT EXISTS (SELECT 1 FROM public.sales s WHERE s.id = _sale_id AND s.tenant_id = v_tenant) THEN
    RAISE EXCEPTION 'Sale does not belong to current tenant';
  END IF;

  SELECT id INTO v_shift FROM public.shift_sessions
    WHERE tenant_id = v_tenant AND cashier_id = v_uid AND status = 'open'
    ORDER BY opened_at DESC LIMIT 1;
  INSERT INTO public.receipt_reprints (tenant_id, sale_id, user_id, shift_id, reason)
  VALUES (v_tenant, _sale_id, v_uid, v_shift, _reason)
  RETURNING id INTO v_id;
  RETURN v_id;
END $function$;

CREATE OR REPLACE FUNCTION public.set_checklist_item(_shift_id uuid, _key text, _label text, _completed boolean, _note text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid UUID := auth.uid();
  v_tenant UUID := public.current_tenant_id();
  v_id UUID;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  IF NOT EXISTS (SELECT 1 FROM public.shift_sessions s WHERE s.id = _shift_id AND s.tenant_id = v_tenant) THEN
    RAISE EXCEPTION 'Shift does not belong to current tenant';
  END IF;

  INSERT INTO public.shift_checklist (tenant_id, shift_id, item_key, label, completed, completed_by, completed_at, note)
  VALUES (v_tenant, _shift_id, _key, _label, COALESCE(_completed,FALSE),
          CASE WHEN _completed THEN v_uid ELSE NULL END,
          CASE WHEN _completed THEN now() ELSE NULL END,
          _note)
  ON CONFLICT (shift_id, item_key) DO UPDATE
    SET completed = EXCLUDED.completed,
        completed_by = CASE WHEN EXCLUDED.completed THEN v_uid ELSE NULL END,
        completed_at = CASE WHEN EXCLUDED.completed THEN now() ELSE NULL END,
        note = EXCLUDED.note,
        label = EXCLUDED.label
  RETURNING id INTO v_id;
  RETURN v_id;
END $function$;

CREATE OR REPLACE FUNCTION public.create_product_batch(_product_id uuid, _batch_no text, _qty numeric, _expiry_date date, _mfg_date date, _unit_cost numeric, _supplier_id uuid, _note text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant UUID := public.current_tenant_id();
  v_id UUID;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'No active tenant'; END IF;
  IF _qty IS NULL OR _qty <= 0 THEN RAISE EXCEPTION 'Quantity must be positive'; END IF;

  IF NOT EXISTS (SELECT 1 FROM public.products p WHERE p.id = _product_id AND p.tenant_id = v_tenant) THEN
    RAISE EXCEPTION 'Product does not belong to current tenant';
  END IF;
  IF _supplier_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.suppliers s WHERE s.id = _supplier_id AND s.tenant_id = v_tenant
  ) THEN
    RAISE EXCEPTION 'Supplier does not belong to current tenant';
  END IF;

  INSERT INTO public.product_batches
    (tenant_id, product_id, batch_no, purchase_date, expiry_date, mfg_date,
     qty_initial, qty_remaining, unit_cost, supplier_id, note)
  VALUES
    (v_tenant, _product_id, _batch_no, CURRENT_DATE, _expiry_date, _mfg_date,
     _qty, _qty, _unit_cost, _supplier_id, _note)
  RETURNING id INTO v_id;
  RETURN v_id;
END $function$;

CREATE OR REPLACE FUNCTION public.hold_bill(_label text, _customer uuid, _payload jsonb, _item_count integer, _total numeric)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid UUID := auth.uid();
  v_tenant UUID := public.current_tenant_id();
  v_shift UUID;
  v_id UUID;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'No active tenant'; END IF;

  IF _customer IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.customers c WHERE c.id = _customer AND c.tenant_id = v_tenant
  ) THEN
    RAISE EXCEPTION 'Customer does not belong to current tenant';
  END IF;

  SELECT id INTO v_shift FROM public.shift_sessions
    WHERE tenant_id = v_tenant AND cashier_id = v_uid AND status = 'open'
    ORDER BY opened_at DESC LIMIT 1;
  INSERT INTO public.held_bills (tenant_id, cashier_id, shift_id, customer_id, label, payload, item_count, total)
  VALUES (v_tenant, v_uid, v_shift, _customer, _label, _payload, COALESCE(_item_count,0), COALESCE(_total,0))
  RETURNING id INTO v_id;
  RETURN v_id;
END $function$;
