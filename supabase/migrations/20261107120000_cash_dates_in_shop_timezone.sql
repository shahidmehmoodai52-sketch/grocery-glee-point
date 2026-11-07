-- Cash entries dated in the shop's timezone, not the server's UTC.
--
-- The database runs in UTC. Functions that write cash_transactions dated
-- the entry with CURRENT_DATE, i.e. the UTC date — which in Pakistan
-- (UTC+5) is still YESTERDAY from 12 am until 5 am. A customer payment,
-- supplier payment, Cash Out or return taken after midnight therefore
-- landed on the previous day in Cash Flow.
--
-- public.shop_today() returns "today" in the current shop's timezone
-- (store_settings.timezone, default Asia/Karachi), and every function below
-- that used CURRENT_DATE is recompiled to use it instead. Only that token
-- changes (plus update_party_payment's _created_at::date, which becomes
-- public.shop_date(_created_at)); each body is otherwise re-created as is.

CREATE OR REPLACE FUNCTION public.shop_today()
RETURNS date
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT (now() AT TIME ZONE COALESCE(
    (SELECT NULLIF(s.timezone, '') FROM public.store_settings s
      WHERE s.tenant_id = public.current_tenant_id() LIMIT 1),
    'Asia/Karachi'))::date;
$function$;

-- The shop-local calendar date of a timestamp (for an edited payment's date).
CREATE OR REPLACE FUNCTION public.shop_date(_ts timestamptz)
RETURNS date
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT (_ts AT TIME ZONE COALESCE(
    (SELECT NULLIF(s.timezone, '') FROM public.store_settings s
      WHERE s.tenant_id = public.current_tenant_id() LIMIT 1),
    'Asia/Karachi'))::date;
$function$;

GRANT EXECUTE ON FUNCTION public.shop_today() TO authenticated;
GRANT EXECUTE ON FUNCTION public.shop_date(timestamptz) TO authenticated;

DO $$
DECLARE
  f record;
  def text;
BEGIN
  FOR f IN
    SELECT p.oid
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname IN ('record_payment', 'update_party_payment', 'complete_sale_return',
                         'complete_purchase_return', 'record_cash_out')
  LOOP
    def := pg_get_functiondef(f.oid);
    IF def ~* '\mCURRENT_DATE\M' OR def ~ '_created_at::date' THEN
      def := regexp_replace(def, '\mCURRENT_DATE\M', 'public.shop_today()', 'gi');
      def := replace(def, '_created_at::date', 'public.shop_date(_created_at)');
      EXECUTE def;
    END IF;
  END LOOP;
END $$;
