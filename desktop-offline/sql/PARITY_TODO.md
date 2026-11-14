# Offline schema parity with live (as of 2026-11-14)

Build order: `00_*` base → all `supabase/migrations` (pg_cron / pg_net
`CREATE EXTENSION` lines stripped) → `1*_live_drift_*` → retry the migrations
that failed the first pass → `1*_live_drift_*` again.

Compared function-by-function against live (md5 of prosrc + volatility +
security definer + config + result + identity args).

Still different from live — fetch from live before the full offline release:
- Sale/purchase returns: `_reverse_sale_return_effects/2`, `complete_sale_return/1`,
  `edit_sale_return/2`, `delete_sale_return/1`, `complete_purchase_return/1`,
  `consume_batch_for_purchase_return/3`
- Payments: `record_payment/7`, `update_party_payment/7`, `record_cash_out/7` (missing),
  `reassign_sale_party/5` (missing)
- Other: `recalc_supplier_balances/1`, `owner_recommendations/0`
- Kept on purpose: `complete_purchase/1` (repo version honours the chosen date;
  migration 20261111120000 is not yet applied on live)
- Not needed offline: admin_* / run_health_check / health_status /
  contribute_new_product_to_library / fanout_approved_global_product

Tables/columns: match live except cloud-only `system_health_log`,
`whatsapp_agent_*`. Triggers: match live after drift A (except the
global-library contribution trigger, not needed offline).

Not yet compared beyond counts: RLS policies (live 239), indexes (live 330),
constraints (live 267).
