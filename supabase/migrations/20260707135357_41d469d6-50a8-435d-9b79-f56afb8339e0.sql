-- UPDATE/DELETE policies for admin on ledger tables
CREATE POLICY "sales_update_admin" ON public.sales FOR UPDATE TO authenticated
  USING (has_role(auth.uid(),'admin')) WITH CHECK (has_role(auth.uid(),'admin'));
CREATE POLICY "purchases_update_admin" ON public.purchases FOR UPDATE TO authenticated
  USING (has_role(auth.uid(),'admin')) WITH CHECK (has_role(auth.uid(),'admin'));
CREATE POLICY "sale_returns_update_admin" ON public.sale_returns FOR UPDATE TO authenticated
  USING (has_role(auth.uid(),'admin')) WITH CHECK (has_role(auth.uid(),'admin'));
CREATE POLICY "purchase_returns_update_admin" ON public.purchase_returns FOR UPDATE TO authenticated
  USING (has_role(auth.uid(),'admin')) WITH CHECK (has_role(auth.uid(),'admin'));

CREATE POLICY "party_payments_update_admin" ON public.party_payments FOR UPDATE TO authenticated
  USING (has_role(auth.uid(),'admin')) WITH CHECK (has_role(auth.uid(),'admin'));
CREATE POLICY "party_payments_delete_admin" ON public.party_payments FOR DELETE TO authenticated
  USING (has_role(auth.uid(),'admin'));

-- Safe update: re-adjusts party balance by delta
CREATE OR REPLACE FUNCTION public.update_party_payment(
  _id uuid, _amount numeric, _method text, _note text, _created_at timestamptz
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_old numeric; v_type text; v_party uuid; v_delta numeric;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT has_role(auth.uid(),'admin') THEN RAISE EXCEPTION 'Forbidden'; END IF;
  IF _amount IS NULL OR _amount <= 0 THEN RAISE EXCEPTION 'Amount must be positive'; END IF;

  SELECT amount, party_type, party_id INTO v_old, v_type, v_party
    FROM public.party_payments WHERE id = _id FOR UPDATE;
  IF v_old IS NULL THEN RAISE EXCEPTION 'Payment not found'; END IF;

  v_delta := _amount - v_old;  -- positive = paid more now
  UPDATE public.party_payments
    SET amount = _amount,
        method = COALESCE(_method, method),
        note = _note,
        created_at = COALESCE(_created_at, created_at)
    WHERE id = _id;

  IF v_delta <> 0 THEN
    IF v_type = 'customer' THEN
      UPDATE public.customers SET balance = balance - v_delta WHERE id = v_party;
    ELSE
      UPDATE public.suppliers SET balance = balance - v_delta WHERE id = v_party;
    END IF;
  END IF;
END $$;

-- Safe delete: reverses balance
CREATE OR REPLACE FUNCTION public.delete_party_payment(_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_amount numeric; v_type text; v_party uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT has_role(auth.uid(),'admin') THEN RAISE EXCEPTION 'Forbidden'; END IF;

  SELECT amount, party_type, party_id INTO v_amount, v_type, v_party
    FROM public.party_payments WHERE id = _id FOR UPDATE;
  IF v_amount IS NULL THEN RAISE EXCEPTION 'Payment not found'; END IF;

  DELETE FROM public.party_payments WHERE id = _id;

  IF v_type = 'customer' THEN
    UPDATE public.customers SET balance = balance + v_amount WHERE id = v_party;
  ELSE
    UPDATE public.suppliers SET balance = balance + v_amount WHERE id = v_party;
  END IF;
END $$;