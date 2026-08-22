# Plan - Admin Panel Credit Sales Visibility & Drill-down

Improve the Tillix Admin Panel to allow viewing Credit Sales (unpaid invoices) with pagination and correct totals for each shop.

## User Review Required

> [!IMPORTANT]
> - The Drill-down will be accessible from the **Sales & Revenue** tab in the shop detail view.
> - I will add a new "Credit Sales (Unpaid)" row to the Payment method breakdown or as a dedicated stat card.
> - Clicking it will open a dialog showing all unpaid/partially paid invoices for that shop.

## Proposed Changes

### Database (Admin RPC)
- Create `public.admin_shop_invoices` RPC to fetch paginated invoices for a tenant.
- Filters: `tenant_id`, `payment_status` (e.g., 'unpaid', 'partial'), `from`, `to`, `limit`, `offset`.
- Returns: `invoice_no`, `created_at`, `customer_name`, `total`, `paid_amount`, `balance`.

### Admin Panel UI (`src/routes/admin_.shops.$id.tsx`)
- Update `SalesTab` to include "Credit Sales (Unpaid)" in the stats or payment breakdown.
- Add `CreditSalesDrilldown` component:
  - Fetches data using the new RPC.
  - Implements pagination (50 per page).
  - Displays "Showing 1–50 of X".
  - Shows "Overall Total" for the selected period.
- Ensure tenant isolation is maintained (already handled by passing `tenantId` to RPC).

## Technical Details

### New RPC Implementation
```sql
CREATE OR REPLACE FUNCTION public.admin_shop_invoices(
  _tenant_id uuid,
  _payment_status text DEFAULT NULL,
  _from timestamptz DEFAULT NULL,
  _to timestamptz DEFAULT NULL,
  _limit int DEFAULT 50,
  _offset int DEFAULT 0
) RETURNS TABLE (
  id uuid,
  invoice_no text,
  created_at timestamptz,
  customer_name text,
  total numeric,
  paid_amount numeric,
  balance numeric,
  total_count bigint
) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.admin_has_perm(auth.uid(), 'shops.view') THEN RAISE EXCEPTION 'Forbidden'; END IF;
  RETURN QUERY
  WITH filtered AS (
    SELECT 
      s.id, s.invoice_no, s.created_at, s.customer_name, 
      s.total, s.paid_amount, (s.total - s.paid_amount) as balance
    FROM public.sales s
    WHERE s.tenant_id = _tenant_id
      AND (_payment_status IS NULL OR s.payment_status = _payment_status)
      AND (_from IS NULL OR s.created_at >= _from)
      AND (_to IS NULL OR s.created_at <= _to)
  )
  SELECT *, (SELECT count(*) FROM filtered) FROM filtered
  ORDER BY created_at DESC
  LIMIT _limit OFFSET _offset;
END $$;
```

### UI Integration
- Use `useQuery` with `keepPreviousData: true` for smooth pagination.
- Add a Dialog to show the invoice list when the Credit Sales row is clicked.
