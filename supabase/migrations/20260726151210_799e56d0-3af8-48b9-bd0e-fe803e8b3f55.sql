CREATE OR REPLACE FUNCTION public.admin_recent_errors(_limit integer DEFAULT 100)
 RETURNS TABLE(id uuid, tenant_id uuid, user_id uuid, error_type text, error_message text, page_or_module text, stack_trace text, created_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.admin_has_perm(auth.uid(), 'shops.view') THEN RAISE EXCEPTION 'Forbidden'; END IF;
  RETURN QUERY SELECT e.id, e.tenant_id, e.user_id, e.error_type, e.error_message, e.page_or_module, e.stack_trace, e.created_at
    FROM public.application_errors e
    WHERE e.resolved_at IS NULL
    ORDER BY e.created_at DESC
    LIMIT COALESCE(_limit, 100);
END $function$;