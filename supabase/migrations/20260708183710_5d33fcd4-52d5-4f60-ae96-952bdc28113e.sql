CREATE TABLE IF NOT EXISTS public.security_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type text NOT NULL,
  severity text NOT NULL DEFAULT 'info',
  ip_address text,
  user_agent text,
  email text,
  user_id uuid,
  tenant_id uuid,
  path text,
  metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_security_events_created ON public.security_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_security_events_ip ON public.security_events(ip_address);
CREATE INDEX IF NOT EXISTS idx_security_events_type ON public.security_events(event_type);

GRANT SELECT, INSERT ON public.security_events TO authenticated;
GRANT SELECT, INSERT ON public.security_events TO anon;
GRANT ALL ON public.security_events TO service_role;

ALTER TABLE public.security_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "super admin reads security events"
ON public.security_events FOR SELECT TO authenticated
USING (public.has_role(auth.uid(), 'super_admin'));

CREATE POLICY "anyone can insert security events"
ON public.security_events FOR INSERT TO anon, authenticated
WITH CHECK (true);

CREATE TABLE IF NOT EXISTS public.security_blocklist (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL,
  value text NOT NULL,
  reason text,
  blocked_by uuid,
  auto_blocked boolean NOT NULL DEFAULT false,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (kind, value)
);

CREATE INDEX IF NOT EXISTS idx_security_blocklist_kind_value ON public.security_blocklist(kind, value);

GRANT SELECT ON public.security_blocklist TO authenticated, anon;
GRANT ALL ON public.security_blocklist TO service_role;

ALTER TABLE public.security_blocklist ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anyone can read active blocklist"
ON public.security_blocklist FOR SELECT TO anon, authenticated
USING (expires_at IS NULL OR expires_at > now());

CREATE OR REPLACE FUNCTION public.log_security_event(
  _event_type text,
  _severity text DEFAULT 'info',
  _email text DEFAULT NULL,
  _path text DEFAULT NULL,
  _metadata jsonb DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _id uuid;
  _ip text;
  _ua text;
  _fail_count int;
BEGIN
  BEGIN
    _ip := current_setting('request.headers', true)::jsonb ->> 'x-forwarded-for';
    _ua := current_setting('request.headers', true)::jsonb ->> 'user-agent';
  EXCEPTION WHEN OTHERS THEN
    _ip := NULL; _ua := NULL;
  END;

  INSERT INTO public.security_events(event_type, severity, ip_address, user_agent, email, user_id, path, metadata)
  VALUES (_event_type, COALESCE(_severity, 'info'), _ip, _ua, _email, auth.uid(), _path, _metadata)
  RETURNING id INTO _id;

  IF _event_type = 'failed_login' AND _ip IS NOT NULL THEN
    SELECT count(*) INTO _fail_count
    FROM public.security_events
    WHERE event_type = 'failed_login'
      AND ip_address = _ip
      AND created_at > now() - interval '15 minutes';

    IF _fail_count >= 8 THEN
      INSERT INTO public.security_blocklist(kind, value, reason, auto_blocked, expires_at)
      VALUES ('ip', _ip, 'Auto-blocked: ' || _fail_count || ' failed logins in 15 min', true, now() + interval '1 hour')
      ON CONFLICT (kind, value) DO NOTHING;

      INSERT INTO public.security_events(event_type, severity, ip_address, user_agent, email, path, metadata)
      VALUES ('auto_block', 'critical', _ip, _ua, _email, _path,
              jsonb_build_object('trigger', 'brute_force', 'count', _fail_count));
    END IF;
  END IF;

  RETURN _id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.log_security_event(text, text, text, text, jsonb) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.admin_list_security_events(_limit int DEFAULT 200, _severity text DEFAULT NULL)
RETURNS SETOF public.security_events
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'super_admin') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  RETURN QUERY
  SELECT * FROM public.security_events
  WHERE (_severity IS NULL OR severity = _severity)
  ORDER BY created_at DESC
  LIMIT COALESCE(_limit, 200);
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_list_security_events(int, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_security_summary()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _out jsonb;
BEGIN
  IF NOT public.has_role(auth.uid(), 'super_admin') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  SELECT jsonb_build_object(
    'failed_logins_24h', (SELECT count(*) FROM public.security_events
      WHERE event_type = 'failed_login' AND created_at > now() - interval '24 hours'),
    'critical_24h', (SELECT count(*) FROM public.security_events
      WHERE severity = 'critical' AND created_at > now() - interval '24 hours'),
    'total_24h', (SELECT count(*) FROM public.security_events
      WHERE created_at > now() - interval '24 hours'),
    'active_blocks', (SELECT count(*) FROM public.security_blocklist
      WHERE expires_at IS NULL OR expires_at > now()),
    'unique_ips_24h', (SELECT count(DISTINCT ip_address) FROM public.security_events
      WHERE ip_address IS NOT NULL AND created_at > now() - interval '24 hours')
  ) INTO _out;
  RETURN _out;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_security_summary() TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_block_identifier(_kind text, _value text, _reason text, _hours int DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _id uuid;
BEGIN
  IF NOT public.has_role(auth.uid(), 'super_admin') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  IF _kind NOT IN ('ip', 'email') THEN
    RAISE EXCEPTION 'invalid kind';
  END IF;
  INSERT INTO public.security_blocklist(kind, value, reason, blocked_by, auto_blocked, expires_at)
  VALUES (_kind, _value, _reason, auth.uid(), false,
          CASE WHEN _hours IS NULL THEN NULL ELSE now() + make_interval(hours => _hours) END)
  ON CONFLICT (kind, value) DO UPDATE
    SET reason = EXCLUDED.reason,
        blocked_by = EXCLUDED.blocked_by,
        auto_blocked = false,
        expires_at = EXCLUDED.expires_at
  RETURNING id INTO _id;

  INSERT INTO public.security_events(event_type, severity, path, metadata)
  VALUES ('manual_block', 'warning', 'admin', jsonb_build_object('kind', _kind, 'value', _value, 'reason', _reason));
  RETURN _id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_block_identifier(text, text, text, int) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_unblock_identifier(_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'super_admin') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  DELETE FROM public.security_blocklist WHERE id = _id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_unblock_identifier(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.is_blocked(_email text DEFAULT NULL)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _ip text;
BEGIN
  BEGIN
    _ip := current_setting('request.headers', true)::jsonb ->> 'x-forwarded-for';
  EXCEPTION WHEN OTHERS THEN
    _ip := NULL;
  END;
  RETURN EXISTS (
    SELECT 1 FROM public.security_blocklist
    WHERE (expires_at IS NULL OR expires_at > now())
      AND (
        (kind = 'ip' AND value = _ip)
        OR (kind = 'email' AND _email IS NOT NULL AND lower(value) = lower(_email))
      )
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.is_blocked(text) TO anon, authenticated;