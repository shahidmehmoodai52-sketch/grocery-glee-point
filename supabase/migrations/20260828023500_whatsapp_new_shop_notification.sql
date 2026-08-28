-- Sends a WhatsApp message to Tillix's own number (+923096431377) via the
-- Meta WhatsApp Cloud API whenever a new shop registers, using the phone
-- number the owner entered at signup. Credentials live in Supabase Vault
-- (secrets named 'whatsapp_access_token' / 'whatsapp_phone_number_id') —
-- never in this repo. If they aren't set yet, or the HTTP call fails for any
-- reason, the trigger silently no-ops: a notification failure must never
-- block shop registration.
create extension if not exists pg_net with schema extensions;

CREATE OR REPLACE FUNCTION public.notify_whatsapp_new_shop()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_token text;
  v_phone_id text;
  v_msg text;
BEGIN
  SELECT decrypted_secret INTO v_token FROM vault.decrypted_secrets WHERE name = 'whatsapp_access_token' LIMIT 1;
  SELECT decrypted_secret INTO v_phone_id FROM vault.decrypted_secrets WHERE name = 'whatsapp_phone_number_id' LIMIT 1;

  IF v_token IS NULL OR v_token = '' OR v_phone_id IS NULL OR v_phone_id = '' THEN
    RETURN NEW;
  END IF;

  v_msg := 'New Tillix shop registered: ' || NEW.name || E'\nPhone: ' || COALESCE(NEW.metadata->>'phone', 'n/a') || E'\nCity: ' || COALESCE(NEW.metadata->>'city', 'n/a') || E'\nPlan: ' || COALESCE(NEW.plan, 'Trial');

  PERFORM net.http_post(
    url := 'https://graph.facebook.com/v21.0/' || v_phone_id || '/messages',
    headers := jsonb_build_object('Authorization', 'Bearer ' || v_token, 'Content-Type', 'application/json'),
    body := jsonb_build_object('messaging_product', 'whatsapp', 'to', '923096431377', 'type', 'text', 'text', jsonb_build_object('body', v_msg))
  );

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END
$function$;

DROP TRIGGER IF EXISTS trg_notify_whatsapp_new_shop ON public.tenants;
CREATE TRIGGER trg_notify_whatsapp_new_shop
AFTER INSERT ON public.tenants
FOR EACH ROW EXECUTE FUNCTION public.notify_whatsapp_new_shop();
