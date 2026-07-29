DELETE FROM public.products WHERE name LIKE 'ZZTEST%' OR name LIKE 'ZZPROBE%' OR name LIKE 'ZZFINAL%';
DELETE FROM public.cash_accounts WHERE name = 'ZZCASH Probe';