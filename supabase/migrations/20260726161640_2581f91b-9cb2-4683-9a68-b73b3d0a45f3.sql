DROP FUNCTION IF EXISTS public.record_payment(text, uuid, numeric, text, text);
DROP FUNCTION IF EXISTS public.update_party_payment(uuid, numeric, text, text, timestamp with time zone);

REVOKE EXECUTE ON FUNCTION public.record_payment(text, uuid, numeric, text, text, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.update_party_payment(uuid, numeric, text, text, timestamp with time zone, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.delete_party_payment(uuid) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.record_payment(text, uuid, numeric, text, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_party_payment(uuid, numeric, text, text, timestamp with time zone, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_party_payment(uuid) TO authenticated;