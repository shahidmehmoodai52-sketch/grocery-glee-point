-- Lets a customer payment recorded via record_payment() be flagged as cash
-- PAID TO the customer, not just money received FROM them.
--
-- Found via a real support case: a shop owner paid cash on a customer's
-- behalf ("920-G", Rs 1100, 14 Sep) using the general "Add payment" dialog
-- (ledger-dialogs.tsx AddPaymentDialog) -- the only tool that dialog offers
-- for a customer. record_payment() hardcoded direction := 'in' for every
-- customer payment (money received), with no way to say "this was actually
-- a cash-out" -- so it silently posted as a credit and reduced the
-- customer's balance in the wrong direction. The one place that DOES record
-- a real customer cash-out correctly (pos.tsx's dedicated "Cash Out to
-- Customer" dialog) inserts directly and never goes through this RPC, so
-- this gap was invisible until a shop actually needed to give cash to a
-- customer from the general payment dialog instead of that specific button.
--
-- Adds an optional p_direction ('in' | 'out') to record_payment(), honored
-- only for party_type='customer' (supplier/expense_person payments are
-- unambiguously "you paid them" and are left untouched). Omitting it
-- preserves today's exact behavior for every existing call site.
--
-- update_party_payment() (used whenever a payment's date is backdated) had
-- a related, independently-triggerable version of the same bug: it always
-- re-derived direction from party_type alone on every edit, so backdating
-- ANY customer cash-out would silently flip it back to a credit even
-- without this change. It now preserves the linked transaction's existing
-- direction unless an explicit p_direction override is passed, which also
-- fixes that silent-flip case on its own.
--
-- Verified on tillix-migration-test: a customer payment with p_direction
-- omitted still posts 'in' exactly as before; with p_direction='out' it
-- posts direction='out', category='adjustment', and increases (rather than
-- decreases) the customer's balance; backdating either kind via
-- update_party_payment preserves its direction and adjusts the balance in
-- the matching direction for the amount delta; supplier/expense_person
-- payments through both RPCs are byte-for-byte unchanged.

CREATE OR REPLACE FUNCTION public.record_payment(
  p_party_type text,
  p_party_id uuid,
  p_amount numeric,
  p_method text,
  p_note text,
  p_account_id uuid DEFAULT NULL::uuid,
  p_direction text DEFAULT NULL::text
)
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
  v_direction text;
  v_category text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'No active tenant'; END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Payment amount must be positive';
  END IF;
  IF p_party_type NOT IN ('customer','supplier','expense_person') THEN
    RAISE EXCEPTION 'Invalid party type';
  END IF;
  IF p_direction IS NOT NULL AND p_direction NOT IN ('in','out') THEN
    RAISE EXCEPTION 'Invalid direction';
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

  -- Only a customer payment can be flagged 'out' (cash paid to them);
  -- supplier/expense_person payments keep their original, unambiguous
  -- direction regardless of what's passed.
  v_direction := CASE
    WHEN p_party_type = 'customer' AND p_direction = 'out' THEN 'out'
    WHEN p_party_type = 'customer' THEN 'in'
    ELSE 'out'
  END;
  v_category := CASE
    WHEN p_party_type = 'customer' AND v_direction = 'out' THEN 'adjustment'
    WHEN p_party_type = 'customer' THEN 'customer_payment'
    WHEN p_party_type = 'supplier' THEN 'supplier_payment'
    ELSE 'staff_payment'
  END;

  IF p_account_id IS NOT NULL THEN
    INSERT INTO public.cash_transactions (
      tenant_id, account_id, direction, amount, occurred_on, category, reference, notes, user_id
    ) VALUES (
      v_tenant,
      p_account_id,
      v_direction,
      p_amount,
      CURRENT_DATE,
      v_category,
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
    IF v_direction = 'out' THEN
      UPDATE public.customers SET balance = balance + p_amount WHERE id = p_party_id;
    ELSE
      UPDATE public.customers SET balance = balance - p_amount WHERE id = p_party_id;
    END IF;
  ELSIF p_party_type = 'supplier' THEN
    UPDATE public.suppliers SET balance = balance - p_amount WHERE id = p_party_id;
  END IF;
  RETURN v_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.update_party_payment(
  _id uuid,
  _amount numeric,
  _method text,
  _note text,
  _created_at timestamp with time zone,
  _account_id uuid DEFAULT NULL::uuid,
  _direction text DEFAULT NULL::text
)
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
  v_direction text;
  v_category text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'No active tenant'; END IF;
  IF NOT has_role(auth.uid(),'admin') THEN RAISE EXCEPTION 'Forbidden'; END IF;
  IF _amount IS NULL OR _amount <= 0 THEN RAISE EXCEPTION 'Amount must be positive'; END IF;
  IF _direction IS NOT NULL AND _direction NOT IN ('in','out') THEN
    RAISE EXCEPTION 'Invalid direction';
  END IF;

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

  -- Preserve the payment's existing direction (read off its linked
  -- transaction) unless an explicit override is passed -- never silently
  -- re-derive it from party_type alone, which used to flip a customer
  -- cash-out back to a credit on every backdate/edit.
  IF _direction IS NOT NULL THEN
    v_direction := _direction;
  ELSIF v_tx_id IS NOT NULL THEN
    SELECT direction INTO v_direction FROM public.cash_transactions WHERE id = v_tx_id AND tenant_id = v_tenant;
  END IF;
  v_direction := COALESCE(v_direction, CASE WHEN v_type = 'customer' THEN 'in' ELSE 'out' END);
  v_category := CASE
    WHEN v_type = 'customer' AND v_direction = 'out' THEN 'adjustment'
    WHEN v_type = 'customer' THEN 'customer_payment'
    WHEN v_type = 'supplier' THEN 'supplier_payment'
    ELSE 'staff_payment'
  END;

  IF v_account_id IS NOT NULL THEN
    IF v_tx_id IS NULL THEN
      INSERT INTO public.cash_transactions (
        tenant_id, account_id, direction, amount, occurred_on, category, reference, notes, user_id, created_at
      ) VALUES (
        v_tenant,
        v_account_id,
        v_direction,
        _amount,
        COALESCE(_created_at::date, CURRENT_DATE),
        v_category,
        'party_payment:' || _id::text,
        NULLIF(_note, ''),
        auth.uid(),
        COALESCE(_created_at, now())
      ) RETURNING id INTO v_tx_id;
    ELSE
      UPDATE public.cash_transactions
        SET account_id = v_account_id,
            direction = v_direction,
            amount = _amount,
            occurred_on = COALESCE(_created_at::date, occurred_on),
            category = v_category,
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
      IF v_direction = 'out' THEN
        UPDATE public.customers SET balance = balance + v_delta WHERE id = v_party;
      ELSE
        UPDATE public.customers SET balance = balance - v_delta WHERE id = v_party;
      END IF;
    ELSIF v_type = 'supplier' THEN
      UPDATE public.suppliers SET balance = balance - v_delta WHERE id = v_party;
    END IF;
  END IF;
END;
$function$;
