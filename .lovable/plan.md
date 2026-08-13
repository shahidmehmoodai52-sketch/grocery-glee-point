# Plan - Multi-Tenant Invoice Isolation and Sequence Fix

The system currently uses a single global database sequence for invoice numbers across all shops. This causes perceived "gaps" in one shop's numbering when another shop makes a sale simultaneously (e.g., Shop A takes S-5568, Shop B takes S-5569-5572, Shop A takes S-5573). While technically "correct" in a single-table sequence design, it is a poor UX for shop owners who expect continuous numbering.

## User Review Required

> [!IMPORTANT]
> To fix the "missing" numbers, we will move to **per-shop invoice sequences**. This means Shop A and Shop B could both have an invoice "S-1001", but they will be isolated by their Shop ID. Existing invoices will NOT be renamed to avoid breaking historical records, but all new invoices will follow a continuous sequence for your shop.

## Proposed Changes

### Database & Backend
- Create a new table `tenant_sequences` to track the next invoice number for each shop.
- Modify the `complete_sale` RPC to fetch and increment the sequence specifically for the calling shop.
- Add a unique constraint on `(tenant_id, invoice_no)` to ensure no duplicates within a shop, while allowing the same number in different shops.

### Offline & Sync
- Update the offline POS logic to generate temporary numbers that don't conflict with server sequences.
- Ensure the sync engine correctly maps these to the new per-tenant sequence upon upload.

## Technical Details

### Database Migration
```sql
CREATE TABLE public.tenant_sequences (
  tenant_id UUID PRIMARY KEY REFERENCES public.tenants(id) ON DELETE CASCADE,
  last_sale_value BIGINT NOT NULL DEFAULT 1000,
  last_purchase_value BIGINT NOT NULL DEFAULT 1000
);

-- Initialize for existing tenants based on their current max invoice
INSERT INTO public.tenant_sequences (tenant_id, last_sale_value)
SELECT 
  tenant_id, 
  COALESCE(MAX(CAST(SUBSTRING(invoice_no FROM 3) AS BIGINT)), 1000)
FROM public.sales
GROUP BY tenant_id
ON CONFLICT (tenant_id) DO NOTHING;
```

### RPC Update
Modify `complete_sale` to:
1. Lock the `tenant_sequences` row for the `v_tenant_id`.
2. Increment `last_sale_value`.
3. Use `S-` || `new_value` as the `invoice_no`.
