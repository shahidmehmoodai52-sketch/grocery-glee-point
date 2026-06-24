
REVOKE EXECUTE ON FUNCTION public.complete_sale(jsonb) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.complete_purchase(jsonb) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.record_payment(text, uuid, numeric, text, text) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.complete_sale(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.complete_purchase(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_payment(text, uuid, numeric, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated;
