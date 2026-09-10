-- During the Lovable -> Supabase database migration, tenant_sequences
-- (the per-tenant invoice counter complete_sale() increments) was populated
-- with a stale snapshot that predates the final state of `sales`. Three
-- tenants (AL-TAJ MART, Hafiz Super Store & Bakers, Family Choice Mart) had
-- a counter trailing behind their actual max existing invoice number, so
-- every new sale generated an invoice number that already existed and hit
-- sales_tenant_invoice_unique, failing with a 409 on every single checkout.
--
-- Bring every tenant's counter up to at least its real current max so the
-- next increment always produces a genuinely unused number.
UPDATE public.tenant_sequences ts
SET last_sale_value = GREATEST(ts.last_sale_value, sub.max_num)
FROM (
  SELECT tenant_id, MAX((regexp_match(invoice_no, '(\d+)$'))[1]::bigint) AS max_num
  FROM public.sales
  GROUP BY tenant_id
) sub
WHERE sub.tenant_id = ts.tenant_id
  AND sub.max_num > ts.last_sale_value;
