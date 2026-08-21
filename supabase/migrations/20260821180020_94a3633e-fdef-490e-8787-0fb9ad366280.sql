-- Update admin_resolve_error to use errors.manage
CREATE OR REPLACE FUNCTION public.admin_resolve_error(_id uuid, _note text DEFAULT NULL::text)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
 AS $function$
 DECLARE
   _tenant_id uuid;
 BEGIN
   IF NOT public.admin_has_perm(auth.uid(), 'errors.manage') THEN
     RAISE EXCEPTION 'Forbidden';
   END IF;
   
   SELECT tenant_id INTO _tenant_id FROM public.application_errors WHERE id = _id;
   
   UPDATE public.application_errors
      SET resolved_at = now(),
          resolved_by = auth.uid(),
          resolution_note = COALESCE(_note, resolution_note)
    WHERE id = _id;

   PERFORM public.log_admin_action(
     'ERROR_RESOLVE',
     _tenant_id,
     'application_errors',
     _id::text,
     _note
   );
 END;
 $function$;

-- Update admin_resolve_errors_bulk to use errors.manage
CREATE OR REPLACE FUNCTION public.admin_resolve_errors_bulk(_tenant_id uuid DEFAULT NULL::uuid, _error_type text DEFAULT NULL::text, _note text DEFAULT NULL::text)
  RETURNS integer
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
 AS $function$
 DECLARE
   n integer;
 BEGIN
   IF NOT public.admin_has_perm(auth.uid(), 'errors.manage') THEN
     RAISE EXCEPTION 'Forbidden';
   END IF;
   
   UPDATE public.application_errors
      SET resolved_at = now(),
          resolved_by = auth.uid(),
          resolution_note = COALESCE(_note, resolution_note)
    WHERE resolved_at IS NULL
      AND (_tenant_id IS NULL OR tenant_id = _tenant_id)
      AND (_error_type IS NULL OR error_type = _error_type);
   
   GET DIAGNOSTICS n = ROW_COUNT;

   PERFORM public.log_admin_action(
     'ERROR_RESOLVE_BULK',
     _tenant_id,
     'application_errors',
     NULL,
     _note,
     NULL,
     jsonb_build_object('count', n, 'error_type', _error_type)
   );
   
   RETURN n;
 END;
 $function$;

-- Update admin_block_identifier to use security.manage
CREATE OR REPLACE FUNCTION public.admin_block_identifier(_kind text, _value text, _reason text, _hours integer DEFAULT NULL::integer)
  RETURNS uuid
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
 AS $function$
 DECLARE _id uuid;
 BEGIN
   IF NOT public.admin_has_perm(auth.uid(), 'security.manage') THEN
     RAISE EXCEPTION 'forbidden';
   END IF;
   
   INSERT INTO public.security_blocks (kind, value, reason, expires_at)
   VALUES (_kind, _value, _reason, CASE WHEN _hours IS NOT NULL THEN now() + (_hours || ' hours')::interval ELSE NULL END)
   RETURNING id INTO _id;

   PERFORM public.log_admin_action(
     'SECURITY_BLOCK',
     NULL,
     'security_blocks',
     _id::text,
     _reason,
     NULL,
     jsonb_build_object('kind', _kind, 'value', _value, 'expires_at', CASE WHEN _hours IS NOT NULL THEN now() + (_hours || ' hours')::interval ELSE NULL END)
   );

   RETURN _id;
 END;
 $function$;

-- Update admin_unblock_identifier to use security.manage
CREATE OR REPLACE FUNCTION public.admin_unblock_identifier(_id uuid)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
 AS $function$
 BEGIN
   IF NOT public.admin_has_perm(auth.uid(), 'security.manage') THEN
     RAISE EXCEPTION 'forbidden';
   END IF;
   
   PERFORM public.log_admin_action(
     'SECURITY_UNBLOCK',
     NULL,
     'security_blocks',
     _id::text,
     'Manual unblock'
   );

   DELETE FROM public.security_blocks WHERE id = _id;
 END;
 $function$;
