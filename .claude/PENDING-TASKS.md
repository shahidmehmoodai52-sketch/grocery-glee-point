# Pending Tasks — Grocery Glee / Tillix.co

Notes saved by Claude on 2026-08-27 so this work can be picked up in a future session.
This file lives on branch `claude/grocery-glee-repo-check-u2j4hy` (not merged to `main`),
so it won't sync into the Lovable editor or affect the live app.

## 1. Rename everything to "Tillix.co" (pending — not started)

Checked: renaming is safe, nothing functionally breaks, because GitHub/Lovable/Supabase
all key off IDs (repo ID, project ref, project_id), not display names.

Steps agreed with the user:
1. User renames the **GitHub repo** manually (Settings → General → Repository name).
   GitHub keeps a redirect from the old name automatically.
2. User renames the **Lovable project** from its own editor settings.
3. User renames the **Supabase project** display name from the Supabase dashboard
   (Project Settings → General). This is purely cosmetic — does not touch
   `project_id`/keys/URL, so the app's `.env` connection is unaffected.
4. Once the user confirms the new exact names, Claude updates these hardcoded
   references in code and pushes:
   - `electron-builder.yml:37` — `repo: grocery-glee-point`
     (⚠️ used by electron-updater to find GitHub Releases — **must** match the
     final GitHub repo name or desktop auto-updates will silently stop working)
   - `src/routes/index.tsx:162` — `SITE_URL = "https://grocery-glee-point.lovable.app"`
     (Lovable's published preview URL — update once Lovable project is renamed)
   - `package.json:2` — `"name": "grocery-glee-point"` (cosmetic, npm package name)

None of GitHub/Lovable/Supabase renaming can be done via API/MCP tools available to
Claude — no "rename repository" / "rename project" tool exists in the current
toolset for any of the three. These are manual dashboard actions by the user.

## 2. Migrate database from Lovable Cloud to personal Supabase (pending — not started)

Current state:
- Live production DB: Supabase project `rcdewpvkhjlewagyixvk`, managed under
  **Lovable Cloud** (confirmed via `src/integrations/supabase/client.ts` error
  message: "Connect Supabase in Lovable Cloud"). Claude's Supabase MCP access
  gets "permission denied" on this project — not in the user's own Supabase org.
- User's own Supabase account has a project also named "grocery-glee-point"
  (id `svlcmnxcvgqfbdqxxdog`, org `nwdluzsnzrdagfqpzrqo`) but it's **INACTIVE**
  and has a *different* project ref than the live one — it is not the same data.
- Repo has 163 SQL migration files under `supabase/migrations/` — schema only
  (tables, functions, RLS), no data.

Recommended path (in order of preference):
1. **Check for a "transfer project" / "connect your own Supabase" option inside
   Lovable's project settings first.** If available, this changes ownership of
   the *same* Supabase project (same ref, same data) with zero data-copy risk —
   by far the safest option. Needs the user to check the Lovable dashboard;
   not visible/actionable via any API Claude has.
2. **If transfer isn't available**, manual migration is needed:
   - Get DB connection string/password for the source project from Lovable
     (Claude does not currently have this — only the public anon/publishable
     key, which is RLS-restricted and insufficient for a full data export).
   - Apply the 163 migrations to the target Supabase project to recreate schema.
     Risk: any manual/ad-hoc change ever made directly on the live DB dashboard
     that was never captured as a checked-in migration file will be missing
     ("migration drift") — should be verified against live schema before cutover.
   - `pg_dump`/`pg_restore` (or Supabase backup/restore) for actual table data.
   - Auth users (`auth.users`/identities) need separate handling; if the JWT
     secret differs between projects, existing user sessions/tokens go invalid
     (users must log in again — not data loss, but a real disruption to flag
     to shop staff in advance).
   - Storage buckets (product images etc., if used) are not covered by
     `pg_dump` — need a separate file transfer.
   - Reset sequences/identity columns after data import to avoid ID collisions.
   - Do the final data dump during a short maintenance/read-only window so no
     in-flight sales are missed by the snapshot.
   - Keep the old Lovable Cloud project running (don't delete) for a few days
     after cutover, and compare row counts per table, before fully decommissioning.

Waiting on user to check Lovable dashboard for the transfer option before
Claude proposes the detailed manual-migration script.

## 3. WhatsApp new-shop notification — waiting on Meta credentials (pending — not started)

Built and deployed (2026-08-28): a DB trigger (`notify_whatsapp_new_shop` on
`public.tenants`, migration `20260828023500_whatsapp_new_shop_notification.sql`)
fires on every new shop signup and calls the Meta WhatsApp Cloud API to message
Tillix's own number (+923096431377) with the new shop's name, phone, city and
plan. It currently no-ops safely (never blocks registration) because the two
required secrets aren't set yet.

User needs to get, from developers.facebook.com (WhatsApp product → API Setup):
1. **Phone Number ID** — numeric ID shown on the API Setup page.
2. **A permanent access token** — the default token shown there is only valid
   24h; for a permanent one: Meta Business Suite → Business Settings →
   System Users → create a system user → generate a token with the
   `whatsapp_business_messaging` permission.

Once the user has both values, Claude stores them in Supabase Vault as secrets
named `whatsapp_access_token` / `whatsapp_phone_number_id` (via
`mcp__Lovable__query_database`, e.g. `select vault.create_secret('<value>',
'whatsapp_access_token')`) — never in the repo — and the trigger starts
sending immediately, no code changes needed.

Also flagged to the user: Meta only allows freeform text messages (what this
trigger currently sends) to a number that messaged the business number within
the last 24h. For a fully automated, always-on notification, the user should
create and get a simple message template approved in WhatsApp Manager; Claude
can then switch the trigger's payload from `type: text` to `type: template`
once one exists.

## Also noted (informational, no action needed)
- Root `.env` is committed to the repo with Supabase URL + anon/publishable key
  only (no service-role/secret key) — not a critical leak, but best practice
  would be to remove it from git and rely on `.gitignore` + deployment env vars.
