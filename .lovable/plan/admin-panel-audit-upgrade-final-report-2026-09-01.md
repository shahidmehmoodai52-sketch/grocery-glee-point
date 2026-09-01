# Tillix Admin Panel — Full Audit & Upgrade: Final Report

Branch: `admin-panel-audit-upgrade` · Starting commit: `15c7353fb0c64f38167f5239ec1ea68ee98553e7` (tip of `main` at task start) · 7 commits, ending at `4a7546c`.

## A. Scope & Branch

Work stayed strictly within the admin-panel surface named in the brief: `/admin`, `/admin/shops/$id`, admin auth, admin RBAC/staff permissions, admin security/error monitoring, admin audit trail, tenant/subscription administration, global library administration. No POS/purchase/ledger/inventory/cash-flow business logic, invoice numbering, offline sync architecture, or shop-side UI was touched. All work happened on `admin-panel-audit-upgrade`, never on `main`.

## B. Audit Method — Verified Against Live Reality, Not Stale Docs

Three parallel read-only explorations covered the frontend (`admin.tsx`, `admin_.shops.$id.tsx`, hooks), the backend (RLS/RPCs/migrations), and prior context (`.lovable/plan/*`, `.lovable/security-memory.md`, `AGENTS.md`, git history), explicitly treating prior planning docs as unverified claims. Every non-trivial claim was then re-checked directly against **both** reachable databases — the live Lovable Cloud production project and the Supabase migration-target project (`ubylxunrlzhijkelgxxx`) — via `pg_get_functiondef`, `information_schema`, and `pg_policies` queries, not by trusting migration files or prior docs.

This discipline paid off immediately: several things the tracked migration history and prior audit docs claimed turned out to be **wrong or stale relative to what's actually live**:

- The tracked migration for `admin_delete_tenant` (`20260817194805...sql`) showed a regression (no audit write, `audit_logs` included in its deletion sweep). **Live reality was different**: production had already been hand-patched (outside any tracked migration) to exclude `audit_logs` from the sweep and call `log_admin_action`. The tracked migration file was simply stale — a textbook case of the exact drift pattern this task warned about.
- A prior `.lovable/plan/` doc claimed an orphaned `admin_shop_invoices` RPC and a stray `credit_sales_total` column on `admin_shop_analytics` might still exist. Both were checked directly: `admin_shop_invoices` was already dropped in a later migration, and `credit_sales_total` doesn't exist anywhere in `admin_shop_analytics` — it's an unrelated shop-side reports/dashboard field. Both claims were false; no cleanup needed.
- `admin_shop_analytics` was reported by the initial code-only audit as still gated on legacy `is_super_admin`. Live introspection showed it had **already** been migrated to `admin_has_perm('shops.view')` in a later, untracked change.

## C. Research & Comparison

Rather than producing a separate abstract "how other multi-tenant SaaS/POS admin panels do this" comparison document, research was applied directly as the concrete standard each fix was held to: RLS + `SECURITY DEFINER`-gated RPCs as the authorization boundary (not client-side checks), append-only/durable audit trails that survive the entity they describe being deleted, typed/reason-required confirmation for destructive actions, retention floors before permanent deletion, and real server-side pagination instead of unbounded fetch-and-filter. Every fix below is a direct instance of one of these patterns, already the codebase's own established direction (e.g. `TypedConfirmDialog`, `CreditSalesDrilldown`'s pagination) — the work extends that direction consistently rather than importing new ideas.

## D. Double-Check Decisions

Two genuinely ambiguous scope-boundary calls were put to the user before implementation, per the brief's own "unless directly an Admin-security issue" carve-out:

1. **`tenants_delete_owner` RLS policy** (any shop owner can directly `DELETE` their own tenant, bypassing `admin_delete_tenant`'s confirmation/reason/audit/batching entirely) — user chose **document only, do not fix**, since it's a shop-owner-facing capability change, not purely an admin-panel one. See §K.
2. **Impersonation / "support view"** — no such mechanism exists today; user chose **document only, do not build**, consistent with the brief's anti-over-engineering stance and the absence of any concrete evidenced need for it.

A third de facto double-check happened live during implementation: before hotfixing production for either of the two critical vulnerabilities found in §E, the finding, its severity, and the exact one-line fix were explained to the user and explicit approval obtained before touching production, separately from the branch's own commits.

## E. Critical Security Findings — Found and Fixed

Two genuinely exploitable, previously-unknown production vulnerabilities were surfaced by running `get_advisors` against the migration-target project after landing the audit-trail migrations, then confirmed live on production and fixed there immediately (with user approval) ahead of the branch merge, in addition to being captured in tracked migrations:

1. **`admin_action_log_view` had no `security_invoker` option.** Since the view is owned by `postgres` (a `BYPASSRLS` role), it evaluated the underlying table's RLS policy as `postgres` instead of as the querying user — silently bypassing `admin_staff_view_action_log` for every reader. **Any authenticated user, not just admin staff, could read the entire cross-tenant admin action log** (password-reset events, tenant-deletion reasons, security-purge metadata). Fixed with `WITH (security_invoker = true)`. Verified with a real authorization test: a genuine non-admin tenant-member account saw 0 rows; a super admin saw the test row.
2. **`prune_audit_logs` had zero internal authorization check and was granted to `anon`.** Any unauthenticated caller could `POST /rest/v1/rpc/prune_audit_logs?_days=0` and permanently wipe the entire cross-tenant `audit_logs` table in one request. Its only legitimate caller is a `pg_cron` job (`prune-audit-logs`, daily 03:15) which runs as `postgres`/`service_role` and needs no client-facing grant at all. Fixed by revoking `EXECUTE` from `anon`/`authenticated` entirely — not by adding an internal check, since that risks breaking the cron job's own no-JWT-context invocation.

Both fixes are minimal grant/option changes, verified functionally (not just "should work"), and now tracked in migrations (`20260901120000_reconcile_admin_action_log.sql`, `20260901125000_lockdown_prune_audit_logs.sql`) so they survive future schema replays instead of being another untracked live-only patch.

## F. Audit-Trail Data-Integrity Bug — Found and Fixed

Live introspection of `admin_delete_tenant` revealed production had already fixed the sweep-exclusion/logging regression from the tracked migration, but left a real, still-active bug: `audit_logs.tenant_id` was `NOT NULL` while its FK action was `ON DELETE SET NULL` — a direct constraint conflict. For **any tenant with existing audit history** (i.e. any tenant that ever had a product/customer/supplier/sale/purchase/payment/expense inserted, updated, or deleted — effectively every real tenant), the final `DELETE FROM tenants` step could not complete: Postgres tries to null out those `audit_logs` rows to satisfy the FK, hits the `NOT NULL` constraint, and the whole call raises an exception and rolls back. This was confirmed, not assumed: `admin_action_log` had zero `TENANT_DELETE` rows and `audit_logs` had zero `tenant_id IS NULL` rows on both reachable databases, consistent with tenant deletion never having actually succeeded since this version of the function was deployed.

**Fix**: dropped the `NOT NULL` constraint (migration `20260901121000_fix_admin_delete_tenant_audit_trail.sql`), also re-asserting the FK action explicitly so the migration is correct even on a fresh environment that only replays tracked migrations. Additionally threaded the admin's typed deletion reason (previously collected by the UI and silently discarded) into the RPC's `log_admin_action` call.

**Verified end-to-end**, not just by inspection: created a real test tenant with a real `audit_logs` row, ran the actual `admin_delete_tenant` RPC in a loop as an authenticated super admin exactly as the client does, and confirmed: the tenant was deleted, the `audit_logs` row survived with `tenant_id` set to `NULL`, and `admin_action_log` recorded exactly one `TENANT_DELETE` row with the correct custom reason.

## G. Database/RPC Changes (Commit `043bce0`)

- `admin_delete_tenant`: audit-trail fix above, plus additive `_reason` param.
- `admin_action_log` / `admin_action_log_view` / `log_admin_action`: reconciled into a tracked migration (existed live in production for an unknown period, never captured by any migration file) — this is the drift class the brief specifically anticipated.
- `admin_clear_security_events`: added a `log_admin_action` call (the purge itself was previously unaudited) and a 7-day retention floor — recent security events can never be purged now, regardless of what age filter the caller passes (or omits). The "Clear all"/"Clear info" buttons previously had no age filter at all.
- `admin_tenant_detail` / `admin_tenant_audit`: moved from legacy `is_super_admin` to the granular `admin_has_perm('shops.view')` already used by `admin_list_tenants` and friends — fail-safe before, just inconsistent; also revoked `anon` `EXECUTE` (never explicitly revoked, unlike sibling admin RPCs).
- `admin_list_tenants`: extended additively with `_search`/`_status`/`_limit`/`_offset` + a `total_count` column via window function. Omitting `_limit` preserves today's unbounded behavior exactly, so `DashboardTab` and `ErrorsTab` — which need the full list for their aggregate cards — needed zero code changes.
- Every migration was applied to and verified against the Supabase migration-target project (`ubylxunrlzhijkelgxxx`) before being considered done, per `AGENTS.md`'s "schema/DB-breaking changes must be tested on a Supabase branch/target first" rule. (A dedicated ephemeral Supabase *branch* — an extra, billed resource — was offered and declined by the user in favor of testing directly against the already-available, already-trusted migration-target project.)

## H. Admin UI Changes (Commits `ed8bf4c`, `32de8c1`, `cbd473e`, `a585a67`, `7a7faee`, `4a7546c`)

- All 6 remaining raw `confirm()`/`window.prompt()` call sites converted to the existing `TypedConfirmDialog` component (no new component built): bulk-resolve and bulk-retry errors, delete global library item, remove admin staff access, suspend tenant, delete tenant (both entry points — Tenants list and shop-detail page). Every destructive one now requires a typed reason; tenant deletion also requires typing the tenant's name. Every reason collected is now actually threaded through to the RPC and durably logged — previously it was collected by the UI and silently discarded on 3 of these paths.
- **"Auto-fix" was dishonestly framed** — it mostly returned canned diagnostic-sounding text and always marked the error resolved regardless of outcome (even on exception), with only one branch (re-running the offline sync queue) doing anything real. Reframed as "Retry & resolve": only the branch that performs a real, verified recovery auto-resolves; every other category is left for the admin to explicitly confirm. Extracted into `src/lib/admin-error-remediation.ts` and covered by 7 unit tests.
- Dashboard's "System errors" stat card was a hardcoded literal `"Check"` string; wired to the real, already-fetched error count.
- **Tenants tab**: replaced client-side search/filter over an unbounded fetch with real server-side search/status/pagination via the extended RPC. Totals cards keep a separate unbounded query (same cache key already shared with Dashboard/Errors tab) so they still reflect true global counts, not just the current page.
- **Library tab**: replaced `fetchAll()` (which paged past PostgREST's 1000-row cap up to a 500,000-row safety net, then filtered client-side) with a real `.range()` + `count: "exact"` server-side search/pagination query — this removes the unbounded-growth risk entirely rather than just raising its ceiling. This was the single worst offender found in the pagination audit.
- Added a `.limit(500)` to the previously fully-unbounded `security_blocklist` query.
- `admin_.shops.$id.tsx` uses the `admin_` route-naming escape hatch, so it never inherited `/admin`'s own pre-navigation `beforeLoad` guard — added the same `am_i_admin_staff()` check for consistency. (Not a real vulnerability before this — the page's data RPCs were already independently gated server-side — just a defense-in-depth/consistency gap.)
- Deleted the dead, unreferenced `/admin/shops` index stub route and regenerated `routeTree.gen.ts`.
- **Investigated but explicitly did not change**: the panel-shell's 30-second error-count/security-summary polls run regardless of which tab is active. On inspection this is correct, not a bug — they drive the always-visible tab-trigger badges, not tab content, and scoping them to the active tab would break the badges. This contradicts an earlier pass's characterization of it as redundant polling; verifying against the actual render logic, not the earlier claim, is what caught that.
- **Two bugs found and fixed incidentally during final review** (not part of the original plan, but squarely in-scope and low-risk to fix): (1) suspend/delete on the shop-detail page weren't invalidating the new paginated tenants-list cache key, so a stale page could briefly show; (2) a genuine, pre-existing React "rules of hooks" violation in `LibraryCategoryAccessCard` (a `useQuery` declared after an early `return`) — a real bug that would throw if an admin granted library access while the card was mounted, not just a lint nit. Both fixed with minimal, mechanical changes.

## I. Testing Performed

- `npx tsc --noEmit` — clean after every commit (excluding one pre-existing, unrelated failure: the `xlsx` package is pinned to a URL blocked by this sandbox's egress policy, affecting only `backup.ts`/`import.tsx`/a worker file, none of which this task touched).
- `npx eslint` on every touched file after every commit — zero new issues beyond the codebase's pre-existing, widespread `@typescript-eslint/no-explicit-any` debt (not introduced by this work); one genuine `react-hooks/rules-of-hooks` violation found and fixed (§H).
- `npx vitest run` — the full suite (24 tests across 6 files, including 7 new ones for the reframed error-recovery logic) passes after every commit.
- Every DB/RPC change was verified functionally against the migration-target Supabase project with real inserted test data and a real authenticated RPC call loop (not just "the migration applied without error") — see §E and §F for the two most consequential examples.

## J. Browser Verification — Not Possible in This Sandbox

This sandbox's egress proxy blocks all `*.supabase.co` hosts by organization policy (confirmed via a direct `curl` test — the same class of restriction already established earlier in this project's history for raw Postgres access), so a locally-run dev server cannot reach either the production or migration-target database at all, regardless of which credentials `.env` points at. Standing up a complete local Supabase stack from scratch via raw Docker (no Supabase CLI available, would mean manually wiring Postgres + GoTrue + PostgREST + Kong and replaying 180 migrations) was judged a disproportionate detour for a verification step, not a core deliverable.

**This means no live click-through browser verification of the UI changes was performed, and that should not be read as implicitly claimed.** It was compensated with: real SQL-level functional verification of every backend change (§E, §F), and a careful manual line-by-line review of every changed UI flow for the classes of bug a click-through would typically catch (stale closures, pagination off-by-ones, cache-invalidation gaps, hook-ordering) — which did catch and fix two real issues (§H). **Recommend a manual click-through pass (or a Claude Code session with real network access to a test Supabase project) before merging**, covering at minimum: all six converted confirmation dialogs, the resumable tenant-delete flow against a tenant with meaningfully many rows in at least one table (to exercise real multi-call resumability), and Tenants/Library search + pagination.

## K. Findings-Only — Documented, Not Fixed This Pass

- **`tenants_delete_owner` RLS policy**: any shop owner can call `tenants.delete()` directly today, bypassing `admin_delete_tenant`'s confirmation/reason/audit/batching entirely, with an uncontrolled FK-cascade wipe (the exact statement-timeout risk on large tenants that the batched RPC exists to avoid) and no audit trail. User decision: document only — this is a shop-owner-facing self-service capability change, not purely an admin-panel one, and needs separate sign-off before altering `tenants` RLS.
- **Impersonation / support view**: confirmed no existing mechanism. User decision: document only, don't build. If ever needed, it must be read-only, time-limited, and fully audited via `log_admin_action`.
- **Admin panel i18n gap**: 100% hardcoded English/mixed-language strings, zero `useTranslation`/`t()` usage anywhere in the three admin route files. Explicitly out of scope per the brief.
- **Broader three-generation RBAC overlap** (legacy `has_role`/`app_role`, `is_super_admin`, `admin_has_perm`+`admin_staff`): this pass closed the inconsistency for the two functions actually touched (`admin_tenant_detail`, `admin_tenant_audit`); the remaining legacy-system functions (`admin_block_identifier`, `admin_unblock_identifier`, `admin_clear_security_events`, `admin_list_security_events`, `admin_set_tenant_plan`) were deliberately left on `is_super_admin` since nothing in current `admin_staff_permissions` usage shows a concrete delegation need — inventing a new permission key speculatively would violate the brief's "only implement genuinely-needed permissions" rule.
- **`security_events`/`admin_action_log`/`audit_logs` raw table grants** on production include broad default privileges to `anon`/`authenticated` (INSERT/UPDATE/DELETE at the table-grant level) that are blocked in practice only by RLS having no matching policy. This is standard Supabase default-privilege behavior applied uniformly across the schema, not a decision specific to these tables — flagged as a standing characteristic of this database worth a broader look someday, not something addressed here.

## L. Commit Log

| Commit | Summary |
|---|---|
| `043bce0` | DB/RPC: audit-trail bug fix, two critical live vulnerabilities closed, retention floor, RBAC consistency, tenant-list pagination backend |
| `ed8bf4c` | UI: confirm()/prompt() → TypedConfirmDialog (admin.tsx), Auto-fix reframe, dashboard stat fix |
| `32de8c1` | UI: same conversion for admin_.shops.$id.tsx (suspend/delete) |
| `cbd473e` | UI: Tenants/Library server-side pagination, beforeLoad guard, dead route cleanup |
| `a585a67` | Testing: extracted and unit-tested the error-retry recovery logic |
| `7a7faee` | Fix: paginated-tenants cache invalidation from the shop-detail page |
| `4a7546c` | Fix: real React rules-of-hooks violation found during final review |

Two additional changes were applied **directly to the live production database** (not just this branch), with explicit user approval given their severity, ahead of any merge: the `admin_action_log_view` `security_invoker` fix and the `prune_audit_logs` grant lockdown (§E). Both are also captured in this branch's tracked migrations so they're reproducible and won't drift again.

**Next step for the user**: review this branch, do the manual click-through pass described in §J, and merge into `main` when satisfied.
