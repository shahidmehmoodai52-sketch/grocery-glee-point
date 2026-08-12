export type PaymentAllocation = {
  method: string;
  amount: number;
  account_id?: string | null;
  note?: string | null;
};

export type DigitalCashBackSummary = {
  isValid: boolean;
  receivedAmount: number;
  cashBackAmount: number;
};

export type DigitalCashBackAccounting = {
  saleTotal: number;
  receivedAmount: number;
  cashBackAmount: number;
  digitalAccountIn: number;
  customerCashBackOut: number;
  netDigitalIncrease: number;
};

export function deriveDigitalCashBackSummary(saleTotal: string | number | null | undefined, receivedAmount: string | number | null | undefined): DigitalCashBackSummary {
  const sale = Number(saleTotal ?? 0);
  const received = Number(receivedAmount ?? 0);
  const safeSale = Number.isFinite(sale) ? sale : 0;
  const safeReceived = Number.isFinite(received) ? received : 0;
  const cashBack = Math.max(0, safeReceived - safeSale);
  return {
    isValid: safeReceived >= safeSale,
    receivedAmount: +safeReceived.toFixed(2),
    cashBackAmount: +cashBack.toFixed(2),
  };
}

export function deriveDigitalCashBackAccounting(saleTotal: string | number | null | undefined, receivedAmount: string | number | null | undefined): DigitalCashBackAccounting {
  const summary = deriveDigitalCashBackSummary(saleTotal, receivedAmount);
  return {
    saleTotal: Number(saleTotal ?? 0),
    receivedAmount: summary.receivedAmount,
    cashBackAmount: summary.cashBackAmount,
    digitalAccountIn: summary.receivedAmount,
    customerCashBackOut: summary.cashBackAmount,
    netDigitalIncrease: summary.receivedAmount - Number(saleTotal ?? 0),
  };
}

export function normalizePaymentMethodValue(method: string | null | undefined): string {
  const raw = String(method ?? "").trim();
  if (!raw) return "cash";

  const normalized = raw.toLowerCase().replace(/\s+/g, " ").trim();
  const aliases: Record<string, string> = {
    cash: "cash",
    "cash in hand": "cash",
    till: "cash",
    "till cash": "cash",
    card: "card",
    "credit card": "card",
    "debit card": "card",
    credit: "credit",
    "customer credit": "credit",
    bank: "bank",
    "bank account": "bank",
    "bank transfer": "bank",
    "online": "bank",
    digital: "digital_cash_back",
    "digital cash back": "digital_cash_back",
    "digital + cb": "digital_cash_back",
    "digital_cash_back": "digital_cash_back",
    easypaisa: "easypaisa",
    "easy paisa": "easypaisa",
    jazzcash: "jazzcash",
    "jazz cash": "jazzcash",
    "mobile wallet": "easypaisa",
  };

  if (aliases[normalized]) return aliases[normalized];
  return raw;
}

export function buildPaymentAllocation(method: string, amount: string | number | null | undefined): PaymentAllocation {
  const normalizedMethod = normalizePaymentMethodValue(method || "cash");
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
      method: normalizePaymentMethodValue(entry.method || fallbackMethod || "cash"),
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
