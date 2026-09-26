-- customers.balance drifted from the ledger on two Cash Out paths:
--
-- 1. delete_party_payment() always added the amount back to the customer
--    (reversing a received payment), even for a Cash Out, which had ADDED
--    the amount when recorded. Deleting a Cash Out therefore raised the
--    balance by the amount instead of lowering it: a 2 x amount drift.
--    Seen live: Hafiz Mart 920-G, Rs 1500 "Cash Out: Cash Paid to Asif"
--    deleted 2026-08-23, balance went 11938 -> 13438.
--
-- 2. update_party_payment(... _direction) only adjusted the balance by the
--    amount delta, so flipping a customer entry between received (in) and
--    Cash Out (out) with the same amount left the balance untouched: again
--    a 2 x amount drift.
--
-- Both now use the same rule as the ledger page and get_customer_balances():
-- the linked cash_transactions.direction decides, else a note starting with
-- "Cash Out". A customer entry's balance effect is +amount for a Cash Out and
-- -amount otherwise; on update the balance moves by (new effect - old effect).
-- Supplier / expense_person behaviour is unchanged.

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
  v_note text;
  v_tenant uuid := public.current_tenant_id();
  v_tx_id uuid;
  v_direction text;
  v_is_cash_out boolean;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'No active tenant'; END IF;
  IF NOT has_role(auth.uid(),'admin') THEN RAISE EXCEPTION 'Forbidden'; END IF;

  SELECT amount, party_type, party_id, cash_transaction_id, note
    INTO v_amount, v_type, v_party, v_tx_id, v_note
    FROM public.party_payments WHERE id = _id AND tenant_id = v_tenant FOR UPDATE;
  IF v_amount IS NULL THEN RAISE EXCEPTION 'Payment not found'; END IF;

  IF v_tx_id IS NOT NULL THEN
    SELECT direction INTO v_direction
      FROM public.cash_transactions WHERE id = v_tx_id AND tenant_id = v_tenant;
  END IF;
  v_is_cash_out := CASE
    WHEN v_direction IS NOT NULL THEN v_direction = 'out'
    ELSE COALESCE(v_note, '') ~* '^\s*cash\s*out\y'
  END;

  DELETE FROM public.party_payments WHERE id = _id;

  IF v_tx_id IS NOT NULL THEN
    DELETE FROM public.cash_transactions WHERE id = v_tx_id AND tenant_id = v_tenant;
  END IF;

  IF v_type = 'customer' THEN
    IF v_is_cash_out THEN
      UPDATE public.customers SET balance = balance - v_amount WHERE id = v_party;
    ELSE
      UPDATE public.customers SET balance = balance + v_amount WHERE id = v_party;
    END IF;
  ELSIF v_type = 'supplier' THEN
    UPDATE public.suppliers SET balance = balance + v_amount WHERE id = v_party;
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.update_party_payment(_id uuid, _amount numeric, _method text, _note text, _created_at timestamp with time zone, _account_id uuid DEFAULT NULL::uuid, _direction text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_old numeric;
  v_old_note text;
  v_type text;
  v_party uuid;
  v_delta numeric;
  v_tenant uuid := public.current_tenant_id();
  v_tx_id uuid;
  v_account_id uuid;
  v_account_name text;
  v_direction text;
  v_category text;
  v_old_direction text;
  v_old_cash_out boolean;
  v_new_cash_out boolean;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'No active tenant'; END IF;
  IF NOT has_role(auth.uid(),'admin') THEN RAISE EXCEPTION 'Forbidden'; END IF;
  IF _amount IS NULL OR _amount <= 0 THEN RAISE EXCEPTION 'Amount must be positive'; END IF;
  IF _direction IS NOT NULL AND _direction NOT IN ('in','out') THEN
    RAISE EXCEPTION 'Invalid direction';
  END IF;

  SELECT amount, party_type, party_id, cash_transaction_id, note
    INTO v_old, v_type, v_party, v_tx_id, v_old_note
    FROM public.party_payments WHERE id = _id AND tenant_id = v_tenant FOR UPDATE;
  IF v_old IS NULL THEN RAISE EXCEPTION 'Payment not found'; END IF;

  -- The entry's current Cash Out status, captured before anything changes.
  IF v_tx_id IS NOT NULL THEN
    SELECT direction INTO v_old_direction
      FROM public.cash_transactions WHERE id = v_tx_id AND tenant_id = v_tenant;
  END IF;
  v_old_cash_out := CASE
    WHEN v_old_direction IS NOT NULL THEN v_old_direction = 'out'
    ELSE COALESCE(v_old_note, '') ~* '^\s*cash\s*out\y'
  END;

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

  IF _direction IS NOT NULL THEN
    v_direction := _direction;
  ELSE
    v_direction := v_old_direction;
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

  IF v_type = 'customer' THEN
    -- Same rule as the ledger: a linked transaction's direction decides,
    -- otherwise the (new) note.
    v_new_cash_out := CASE
      WHEN v_tx_id IS NOT NULL THEN v_direction = 'out'
      ELSE COALESCE(_note, '') ~* '^\s*cash\s*out\y'
    END;
    UPDATE public.customers
      SET balance = balance
        + (CASE WHEN v_new_cash_out THEN _amount ELSE -_amount END)
        - (CASE WHEN v_old_cash_out THEN v_old ELSE -v_old END)
      WHERE id = v_party;
  ELSIF v_type = 'supplier' AND v_delta <> 0 THEN
    UPDATE public.suppliers SET balance = balance - v_delta WHERE id = v_party;
  END IF;
END;
$function$;
