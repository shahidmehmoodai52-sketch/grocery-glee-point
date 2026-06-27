
CREATE TABLE public.expense_persons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  role TEXT,
  phone TEXT,
  notes TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  user_id UUID NOT NULL DEFAULT auth.uid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.expense_persons TO authenticated;
GRANT ALL ON public.expense_persons TO service_role;
ALTER TABLE public.expense_persons ENABLE ROW LEVEL SECURITY;
CREATE POLICY ep_select ON public.expense_persons FOR SELECT TO authenticated USING (true);
CREATE POLICY ep_insert ON public.expense_persons FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY ep_update_admin ON public.expense_persons FOR UPDATE TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE POLICY ep_delete_admin ON public.expense_persons FOR DELETE TO authenticated USING (public.has_role(auth.uid(),'admin'));

CREATE TABLE public.expenses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id UUID REFERENCES public.expense_persons(id) ON DELETE SET NULL,
  category TEXT NOT NULL DEFAULT 'general',
  amount NUMERIC(14,2) NOT NULL CHECK (amount >= 0),
  description TEXT,
  method TEXT NOT NULL DEFAULT 'cash',
  expense_date DATE NOT NULL DEFAULT (now()::date),
  user_id UUID NOT NULL DEFAULT auth.uid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.expenses TO authenticated;
GRANT ALL ON public.expenses TO service_role;
ALTER TABLE public.expenses ENABLE ROW LEVEL SECURITY;
CREATE POLICY ex_select ON public.expenses FOR SELECT TO authenticated USING (true);
CREATE POLICY ex_insert ON public.expenses FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY ex_update_admin ON public.expenses FOR UPDATE TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE POLICY ex_delete_admin ON public.expenses FOR DELETE TO authenticated USING (public.has_role(auth.uid(),'admin'));

CREATE INDEX expenses_date_idx ON public.expenses(expense_date DESC);
CREATE INDEX expenses_person_idx ON public.expenses(person_id);

CREATE OR REPLACE FUNCTION public.touch_updated_at() RETURNS TRIGGER LANGUAGE plpgsql SET search_path=public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;
CREATE TRIGGER expense_persons_touch BEFORE UPDATE ON public.expense_persons FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER expenses_touch BEFORE UPDATE ON public.expenses FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
