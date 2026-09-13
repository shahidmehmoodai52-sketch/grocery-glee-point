# Pending Tasks — Grocery Glee / Tillix.co

Notes saved by Claude on 2026-08-27 (updated 2026-09-04) so this work can be picked up
in a future session. This file lives on branch `claude/grocery-glee-repo-check-u2j4hy`
(not merged to `main`), so it won't sync into the Lovable editor or affect the live app.

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

## 4. Multi-language: language switch only affects the landing page (DONE — 2026-09-04)

This note was stale by the time it was picked back up: when re-checked on
2026-09-04, all 29 files under `src/routes/_authenticated/` already called
`useTranslation()`/`t(...)` extensively (some other pass between
2026-08-28 and now had already done the bulk of this work, uncredited in
this file) and all 6 `public/locales/*/translation.json` files already had
full 1:1 key parity (2233 keys each) with real, distinct translations
(verified by spot-checking actual string values in ur/ar/es/de/no, not
just key presence).

What was actually still missing (found via a systematic grep sweep for
hardcoded JSX text, `toast.error/success(...)` literals, and `title=`/
`placeholder=` attributes across every `_authenticated` file) was a small,
finite residual — not a from-scratch ~30-file rewrite:
- `pos.tsx`: 26 toast messages, the entire "Held bills" dialog (title,
  table headers, empty state, "Untitled"/"Editing {invoice}"/"Resume"),
  and the customer-search combobox (placeholder, empty state, "owes
  {amount}", the quick-add-customer button tooltip) — the biggest gap,
  since it's the most-used screen.
- `dashboard.tsx`: one string ("No records").
- `purchases.tsx`: the date-filter dropdown (Today/Yesterday/This week/
  This month/Custom range).
- `route.tsx` (shared authenticated layout): the "Unsynced Data Detected"
  logout-confirmation dialog (added `useTranslation()` was already there;
  used `<Trans>` for the sentence with embedded `<b>permanently
  delete</b>`, and a one/other key pair for the transaction-count
  pluralization) and the error-boundary / 404 pages (`AuthedError`,
  `AuthedNotFound` — neither had `useTranslation()` before).

All ~36 new keys were added to all 6 locale files with real translations
(not copies of the English text), verified via a flatten-and-diff script
showing 0 missing/extra keys across languages after the change, plus
`npx tsc --noEmit` clean.

Deliberately left as-is (not a translation gap): `library.tsx`'s bulk
CSV-upload helper text listing literal recognized column header names
("Item Name", "Barcode", etc.) — these are the actual expected CSV
header strings the importer matches against, not UI copy; translating
them would misrepresent what the importer accepts. Also left alone:
keyboard-shortcut hints ("Esc"), the "SKU" abbreviation, and browser
names ("Chrome"/"Edge"/"Brave") — none of these are meant to translate.

## 5. WhatsApp support/sales agent on Tillix's own number — waiting on credentials (pending — backend built, not activated)

Built and pushed (2026-09-04, commit `c69107c` on this branch): a Supabase Edge
Function (`supabase/functions/whatsapp-agent/index.ts`) that answers inbound
WhatsApp messages to Tillix's own number (+923096431377, shown on the landing
page) using Claude, grounded only in the real product/pricing facts from the
landing page (plans, features, 7-day trial) — it's instructed to never invent
a price or feature not on that list.

Backend (`supabase/migrations/20260904120000_whatsapp_agent_infra.sql`):
applied and functionally verified on the Supabase migration-test project
(`ubylxunrlzhijkelgxxx`) — a `whatsapp_agent_messages` table for short
per-contact conversation history, and a `get_whatsapp_agent_secrets()`
SECURITY DEFINER RPC that reads credentials from Vault, confirmed callable
only by `service_role` (not anon/authenticated). Not yet applied to production.

The edge function itself was deployed and smoke-tested only on the
migration-test project — **not on production**, because that Supabase
project is Lovable-Cloud-managed and isn't reachable via this session's
direct Supabase access; deploying it there needs a Lovable-side deploy
(`mcp__Lovable__send_message`), which spends the user's Lovable workspace
credits — needs the user's go-ahead before doing that.

Four things are needed before this can go live, none of which exist yet:
1. **WhatsApp Phone Number ID** and **2. a permanent access token** — from
   Meta (developers.facebook.com → WhatsApp → API Setup for the ID and a
   temporary token; business.facebook.com/settings/system-users → System
   User → Generate New Token with `whatsapp_business_messaging` permission
   for a permanent one). Same Meta setup that item 3 below also needs — one
   Meta configuration pass covers both features.
2. **Meta App Secret** — same app's dashboard → Settings → Basic → App
   Secret. Needed so the webhook can verify a request genuinely came from
   Meta (HMAC over `X-Hub-Signature-256`) — the endpoint is otherwise
   publicly POST-able by anyone.
3. **An Anthropic API key** — the user's own paid key (explicitly requested:
   "use Claude's, I already pay for it"). Console: console.anthropic.com/settings/keys.

A webhook verify token does NOT need to come from the user — Claude
generates a random one and gives it to the user to paste into Meta's
webhook config once the function is deployed.

Once all of the above exist: store the 5 secrets in Vault (mirroring the
`notify_whatsapp_new_shop()` pattern — never in the repo), deploy the
function to production via Lovable, then have the user paste the
function's URL + verify token into Meta's App Dashboard → WhatsApp →
Configuration → Webhooks.

## 6. Auth emails still sent via Supabase's default service, not Tillix-branded (pending — not started)

User noticed the "Confirm your email address" signup email arrives from Supabase's
generic built-in sender ("...powered by Supabase ⚡" footer), not from Tillix.

This is entirely Supabase Dashboard configuration — nothing in this repo controls
it (`supabase/config.toml` has no `[auth.email]` section, and there's no MCP tool
available here to change Auth email templates or SMTP settings). Two separate
dashboard changes are needed, both by the user:

1. **Branding/wording**: Supabase Dashboard → Authentication → Emails → Templates
   → edit "Confirm signup" (and the other templates: Magic Link, Reset Password,
   Change Email, Invite) to Tillix-branded subject/body text.
2. **Sender address** (the more important half — not just cosmetic): Authentication
   → Emails → SMTP Settings → connect a custom SMTP provider (e.g. Resend,
   SendGrid, Brevo, Zoho Mail, or tillix.co's own mail) so the "From" becomes
   something like `no-reply@tillix.co` instead of Supabase's shared address.

   Confirmed via Supabase's own docs: the built-in (no custom SMTP) email service
   is rate-limited and explicitly "best-effort... for production use, you should
   consider configuring a custom SMTP server." With real shops signing up live,
   this isn't just a branding gap — if enough signups land in the same hour, some
   owners simply won't get their confirmation email. Worth prioritizing the SMTP
   setup over the template wording for that reason.

User said: address this later, left pending for now.

## Also noted (informational, no action needed)
- Root `.env` is committed to the repo with Supabase URL + anon/publishable key
  only (no service-role/secret key) — not a critical leak, but best practice
  would be to remove it from git and rely on `.gitignore` + deployment env vars.
