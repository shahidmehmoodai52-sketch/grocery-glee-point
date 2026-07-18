
-- Grant super_admin (and admin) to the developer's personal email now and on future signup.
DO $$
DECLARE
  v_uid uuid;
BEGIN
  SELECT id INTO v_uid FROM auth.users WHERE lower(email) = lower('shahidmehmoodai52@gmail.com') LIMIT 1;
  IF v_uid IS NOT NULL THEN
    PERFORM set_config('app.bypass_role_guard', 'on', true);
    INSERT INTO public.user_roles (user_id, role) VALUES (v_uid, 'super_admin') ON CONFLICT DO NOTHING;
    INSERT INTO public.user_roles (user_id, role) VALUES (v_uid, 'admin') ON CONFLICT DO NOTHING;
  END IF;
END $$;

-- Trigger: if this email ever signs up (or re-signs up), auto-elevate.
CREATE OR REPLACE FUNCTION public.auto_grant_developer_super_admin()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF lower(NEW.email) = lower('shahidmehmoodai52@gmail.com') THEN
    PERFORM set_config('app.bypass_role_guard', 'on', true);
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'super_admin') ON CONFLICT DO NOTHING;
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'admin') ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS auto_grant_developer_super_admin_trg ON auth.users;
CREATE TRIGGER auto_grant_developer_super_admin_trg
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.auto_grant_developer_super_admin();
