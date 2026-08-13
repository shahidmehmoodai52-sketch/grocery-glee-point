-- Create the tracking table
CREATE TABLE public.tenant_sequences (
  tenant_id UUID PRIMARY KEY REFERENCES public.tenants(id) ON DELETE CASCADE,
  last_sale_value BIGINT NOT NULL DEFAULT 1000,
  last_purchase_value BIGINT NOT NULL DEFAULT 1000
);

GRANT SELECT, INSERT, UPDATE ON public.tenant_sequences TO authenticated;
GRANT ALL ON public.tenant_sequences TO service_role;

-- Initialize for existing tenants
INSERT INTO public.tenant_sequences (tenant_id, last_sale_value)
SELECT 
  tenant_id, 
  GREATEST(1000, MAX(CAST(NULLIF(regexp_replace(invoice_no, '^S-', ''), '') AS BIGINT)))
FROM public.sales
WHERE invoice_no ~ '^S-[0-9]+$'
GROUP BY tenant_id;

-- Ensure default sequences for all current tenants
INSERT INTO public.tenant_sequences (tenant_id)
SELECT id FROM public.tenants
ON CONFLICT DO NOTHING;

-- Drop global unique constraint on invoice_no (keeping it unique per tenant)
ALTER TABLE public.sales DROP CONSTRAINT IF EXISTS sales_invoice_no_key;
ALTER TABLE public.sales ADD CONSTRAINT sales_tenant_invoice_unique UNIQUE (tenant_id, invoice_no);

-- Update complete_sale to use per-tenant sequence
CREATE OR REPLACE FUNCTION public.complete_sale(payload JSONB)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
  v_method TEXT := COALESCE(payload->>'payment_method','cash');
  v_uid UUID := auth.uid();
  v_tenant_id UUID;
  v_invoice_no TEXT;
  v_next_val BIGINT;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  
  -- Use the tenant_id from the user's staff record
  SELECT tenant_id INTO v_tenant_id FROM public.staff WHERE user_id = v_uid LIMIT 1;
  IF v_tenant_id IS NULL THEN
    -- Fallback to payload for edge cases
    v_tenant_id := (payload->>'_tenant_id')::UUID;
  END IF;
  
  IF v_tenant_id IS NULL THEN RAISE EXCEPTION 'Tenant not found for user'; END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(payload->'items') LOOP
    v_subtotal := v_subtotal + ((v_item->>'qty')::NUMERIC * (v_item->>'price')::NUMERIC);
    v_cost_total := v_cost_total + ((v_item->>'qty')::NUMERIC * COALESCE((v_item->>'cost')::NUMERIC, 0));
  END LOOP;

  v_total := v_subtotal + v_tax - v_discount;
  v_change := GREATEST(v_paid - v_total, 0);
  IF v_paid >= v_total THEN v_status := 'completed';
  ELSE v_status := 'credit'; END IF;

  -- Atomic increment of tenant sequence
  INSERT INTO public.tenant_sequences (tenant_id, last_sale_value)
  VALUES (v_tenant_id, 1001)
  ON CONFLICT (tenant_id) DO UPDATE 
  SET last_sale_value = tenant_sequences.last_sale_value + 1
  RETURNING last_sale_value INTO v_next_val;
  
  v_invoice_no := 'S-' || v_next_val;

  INSERT INTO public.sales (tenant_id, invoice_no, customer_id, cashier_id, subtotal, tax, discount, total, cost_total, paid, change_due, payment_method, status, note, created_at)
  VALUES (
    v_tenant_id, 
    v_invoice_no, 
    v_customer, 
    v_uid, 
    v_subtotal, 
    v_tax, 
    v_discount, 
    v_total, 
    v_cost_total, 
    v_paid, 
    v_change, 
    v_method, 
    v_status, 
    payload->>'note',
    COALESCE((payload->>'_created_at')::TIMESTAMPTZ, now())
  )
  RETURNING id INTO v_sale_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(payload->'items') LOOP
    INSERT INTO public.sale_items (tenant_id, sale_id, product_id, name, qty, price, cost, line_total)
    VALUES (
      v_tenant_id,
      v_sale_id,
      NULLIF(v_item->>'product_id','')::UUID,
      v_item->>'name',
      (v_item->>'qty')::NUMERIC,
      (v_item->>'price')::NUMERIC,
      COALESCE((v_item->>'cost')::NUMERIC, 0),
      (v_item->>'qty')::NUMERIC * (v_item->>'price')::NUMERIC
    );
    IF NULLIF(v_item->>'product_id','') IS NOT NULL THEN
      UPDATE public.products SET stock = stock - (v_item->>'qty')::NUMERIC, updated_at = now()
      WHERE id = (v_item->>'product_id')::UUID;
    END IF;
  END LOOP;

  IF v_status = 'credit' AND v_customer IS NOT NULL THEN
    UPDATE public.customers SET balance = balance + (v_total - v_paid) WHERE id = v_customer;
  END IF;

  RETURN v_sale_id;
END; $$;
