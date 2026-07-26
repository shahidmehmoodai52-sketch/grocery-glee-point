ALTER TABLE public.party_payments
  ADD COLUMN IF NOT EXISTS cash_transaction_id uuid REFERENCES public.cash_transactions(id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION public.record_payment(
  p_party_type text,
  p_party_id uuid,
  p_amount numeric,
  p_method text,
  p_note text,
  p_account_id uuid DEFAULT NULL
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
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'No active tenant'; END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Payment amount must be positive';
  END IF;
  IF p_party_type NOT IN ('customer','supplier') THEN
    RAISE EXCEPTION 'Invalid party type';
  END IF;

  IF p_party_type = 'customer' THEN
    SELECT true INTO v_ok FROM public.customers WHERE id = p_party_id AND tenant_id = v_tenant;
  ELSE
    SELECT true INTO v_ok FROM public.suppliers WHERE id = p_party_id AND tenant_id = v_tenant;
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
      tenant_id,
      account_id,
      direction,
      amount,
      occurred_on,
      category,
      reference,
      notes,
      user_id
    ) VALUES (
      v_tenant,
      p_account_id,
      CASE WHEN p_party_type = 'customer' THEN 'in' ELSE 'out' END,
      p_amount,
      CURRENT_DATE,
      CASE WHEN p_party_type = 'customer' THEN 'customer_payment' ELSE 'supplier_payment' END,
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
  ELSE
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
  _account_id uuid DEFAULT NULL
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
        tenant_id,
        account_id,
        direction,
        amount,
        occurred_on,
        category,
        reference,
        notes,
        user_id,
        created_at
      ) VALUES (
        v_tenant,
        v_account_id,
        CASE WHEN v_type = 'customer' THEN 'in' ELSE 'out' END,
        _amount,
        COALESCE(_created_at::date, CURRENT_DATE),
        CASE WHEN v_type = 'customer' THEN 'customer_payment' ELSE 'supplier_payment' END,
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
            category = CASE WHEN v_type = 'customer' THEN 'customer_payment' ELSE 'supplier_payment' END,
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
    ELSE
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
  ELSE
    UPDATE public.suppliers SET balance = balance + v_amount WHERE id = v_party;
  END IF;
END;
$function$;