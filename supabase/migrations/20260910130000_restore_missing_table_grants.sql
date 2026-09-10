-- The wipe_public_schema_for_lovable_restore migration (run during the Lovable
-- Cloud -> standalone Supabase migration) stripped standard Supabase default
-- table-level GRANTs, not just RLS policies. RLS only restricts rows within
-- what a role can otherwise touch; without the base GRANTs, PostgREST returns
-- 403 on every direct table query regardless of correct RLS policies.
--
-- Restoring the standard Supabase baseline (verified against the old, still-
-- live Lovable database's actual grants): ALL privileges to anon+authenticated
-- on public tables, USAGE on sequences, plus default privileges so future
-- CREATE TABLEs in this schema get the same baseline automatically.

GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated;

ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated;
