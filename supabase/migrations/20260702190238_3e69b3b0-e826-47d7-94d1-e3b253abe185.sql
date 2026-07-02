
ALTER TABLE public.products
  ALTER COLUMN cost_price TYPE numeric(16,4),
  ALTER COLUMN sell_price TYPE numeric(16,4),
  ALTER COLUMN stock      TYPE numeric(16,3);

ALTER TABLE public.sale_items
  ALTER COLUMN price      TYPE numeric(16,4),
  ALTER COLUMN cost       TYPE numeric(16,4),
  ALTER COLUMN qty        TYPE numeric(16,3),
  ALTER COLUMN line_total TYPE numeric(18,2);

ALTER TABLE public.sale_return_items
  ALTER COLUMN price      TYPE numeric(16,4),
  ALTER COLUMN cost       TYPE numeric(16,4),
  ALTER COLUMN qty        TYPE numeric(16,3),
  ALTER COLUMN line_total TYPE numeric(18,2);

ALTER TABLE public.purchase_items
  ALTER COLUMN cost       TYPE numeric(16,4),
  ALTER COLUMN qty        TYPE numeric(16,3),
  ALTER COLUMN line_total TYPE numeric(18,2);

ALTER TABLE public.purchase_return_items
  ALTER COLUMN cost       TYPE numeric(16,4),
  ALTER COLUMN qty        TYPE numeric(16,3),
  ALTER COLUMN line_total TYPE numeric(18,2);

ALTER TABLE public.sales
  ALTER COLUMN subtotal   TYPE numeric(18,2),
  ALTER COLUMN tax        TYPE numeric(18,2),
  ALTER COLUMN discount   TYPE numeric(18,2),
  ALTER COLUMN total      TYPE numeric(18,2),
  ALTER COLUMN cost_total TYPE numeric(18,2),
  ALTER COLUMN paid       TYPE numeric(18,2),
  ALTER COLUMN change_due TYPE numeric(18,2);

ALTER TABLE public.purchases
  ALTER COLUMN subtotal TYPE numeric(18,2),
  ALTER COLUMN tax      TYPE numeric(18,2),
  ALTER COLUMN total    TYPE numeric(18,2),
  ALTER COLUMN paid     TYPE numeric(18,2);

ALTER TABLE public.sale_returns
  ALTER COLUMN subtotal      TYPE numeric(18,2),
  ALTER COLUMN tax           TYPE numeric(18,2),
  ALTER COLUMN total         TYPE numeric(18,2),
  ALTER COLUMN refund_amount TYPE numeric(18,2);

ALTER TABLE public.purchase_returns
  ALTER COLUMN subtotal      TYPE numeric(18,2),
  ALTER COLUMN tax           TYPE numeric(18,2),
  ALTER COLUMN total         TYPE numeric(18,2),
  ALTER COLUMN refund_amount TYPE numeric(18,2);

ALTER TABLE public.customers ALTER COLUMN balance TYPE numeric(18,2);
ALTER TABLE public.suppliers ALTER COLUMN balance TYPE numeric(18,2);
ALTER TABLE public.expenses  ALTER COLUMN amount  TYPE numeric(18,2);
ALTER TABLE public.party_payments ALTER COLUMN amount TYPE numeric(18,2);
