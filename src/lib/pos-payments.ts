export type PaymentAllocation = {
  method: string;
  amount: number;
  account_id?: string | null;
  note?: string | null;
};

export function buildPaymentAllocation(method: string, amount: string | number | null | undefined): PaymentAllocation {
  const normalizedMethod = (method || "cash").trim() || "cash";
  const normalizedAmount = Number(amount ?? 0);
  return {
    method: normalizedMethod,
    amount: Number.isFinite(normalizedAmount) ? +normalizedAmount.toFixed(2) : 0,
  };
}

export function normalizePaymentAllocations(
  allocations: PaymentAllocation[] | undefined,
  fallbackMethod: string,
  fallbackAmount: string | number | null | undefined,
): PaymentAllocation[] {
  const items = (allocations ?? [])
    .filter((entry): entry is PaymentAllocation => !!entry && typeof entry === "object")
    .map((entry) => ({
      method: (entry.method || fallbackMethod || "cash").trim() || "cash",
      amount: Number(entry.amount ?? 0),
      account_id: entry.account_id ?? null,
      note: entry.note ?? null,
    }))
    .map((entry) => ({
      ...entry,
      amount: Number.isFinite(entry.amount) ? +entry.amount.toFixed(2) : 0,
    }));

  const positive = items.filter((entry) => Number(entry.amount) > 0);
  if (positive.length > 0) {
    return positive;
  }

  return [buildPaymentAllocation(fallbackMethod, fallbackAmount)];
}

export function sumPaymentAllocations(allocations: PaymentAllocation[] | undefined): number {
  return +(allocations ?? []).reduce((sum, allocation) => sum + Number(allocation.amount ?? 0), 0).toFixed(2);
}
