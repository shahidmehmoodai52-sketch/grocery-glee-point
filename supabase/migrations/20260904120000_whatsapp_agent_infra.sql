-- Backend for a WhatsApp support/sales agent on Tillix's own number
-- (+923096431377, shown on the landing page). An edge function (not part
-- of this migration - deployed separately) receives inbound WhatsApp
-- messages, calls Claude for a reply, and sends it back via the Meta
-- WhatsApp Cloud API. This migration only adds what that function needs:
-- a short conversation-history table for context, and a service-role-only
-- way to read its credentials out of Vault (mirrors the existing
-- notify_whatsapp_new_shop() convention - secrets never live in the repo).

CREATE TABLE IF NOT EXISTS public.whatsapp_agent_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  wa_id text NOT NULL,
  role text NOT NULL CHECK (role IN ('user', 'assistant')),
  content text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_agent_messages_wa_id_created_at
  ON public.whatsapp_agent_messages (wa_id, created_at);

ALTER TABLE public.whatsapp_agent_messages ENABLE ROW LEVEL SECURITY;
-- Deliberately no policies: only the edge function touches this table,
-- using the service-role key, which bypasses RLS entirely. Same pattern
-- as audit_logs - no direct client access, service-role/RPC only.

CREATE OR REPLACE FUNCTION public.get_whatsapp_agent_secrets()
RETURNS TABLE(
  whatsapp_access_token text,
  whatsapp_phone_number_id text,
  whatsapp_verify_token text,
  whatsapp_app_secret text,
  anthropic_api_key text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT
    (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'whatsapp_access_token' LIMIT 1),
    (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'whatsapp_phone_number_id' LIMIT 1),
    (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'whatsapp_verify_token' LIMIT 1),
    (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'whatsapp_app_secret' LIMIT 1),
    (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'anthropic_api_key' LIMIT 1);
$function$;

-- Service-role only: this returns raw secrets, must never be reachable by
-- the app's anon/authenticated Postgres roles.
REVOKE ALL ON FUNCTION public.get_whatsapp_agent_secrets() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_whatsapp_agent_secrets() TO service_role;
