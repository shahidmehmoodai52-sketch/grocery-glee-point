import { fmtMoney, fmtQty } from "@/lib/format";

export type ReceiptSettings = {
  store_name?: string | null;
  address?: string | null;
  phone?: string | null;
  currency_symbol?: string | null;
  tax_rate?: number | null;
  logo_url?: string | null;
  tax_id?: string | null;
  receipt_header?: string | null;
  receipt_footer?: string | null;
  paper_width?: string | null; // '58mm' | '80mm'
  show_logo?: boolean | null;
  show_tax_id?: boolean | null;
  show_address?: boolean | null;
  show_phone?: boolean | null;
  show_tax_lines?: boolean | null;
  show_cashier?: boolean | null;
};

export type ReceiptInvoice = {
  invoice_no?: string | number;
  created_at?: string | Date;
  customers?: { name?: string } | null;
  cashier_name?: string | null;
  sale_items?: Array<{
    id?: string;
    name: string;
    qty: number;
    price?: number;
    line_total: number;
  }>;
  subtotal: number;
  tax: number;
  discount: number;
  total: number;
  paid: number;
  change_due?: number;
  note?: string | null;
  payment_method?: string;
};

type Props = {
  invoice: ReceiptInvoice;
  settings?: ReceiptSettings | null;
  /** Render at the configured paper width (for print/preview). */
  paper?: boolean;
};

export function Receipt({ invoice, settings, paper = true }: Props) {
  const sym = settings?.currency_symbol ?? "$";
  const width = settings?.paper_width === "58mm" ? "58mm" : "80mm";
  const date = invoice.created_at ? new Date(invoice.created_at) : new Date();

  return (
    <div
      className="receipt-paper bg-white text-black font-mono text-[11px] leading-snug mx-auto"
      style={paper ? { width, padding: "6mm 4mm" } : undefined}
    >
      {settings?.show_logo !== false && settings?.logo_url && (
        <div className="flex justify-center mb-1">
          <img src={settings.logo_url} alt="logo" className="max-h-14 object-contain" />
        </div>
      )}
      <div className="text-center">
        <div className="font-bold text-[13px] uppercase tracking-wide">
          {settings?.store_name ?? "Store"}
        </div>
        {settings?.show_address !== false && settings?.address && (
          <div className="text-[10px]">{settings.address}</div>
        )}
        {settings?.show_phone !== false && settings?.phone && (
          <div className="text-[10px]">Tel: {settings.phone}</div>
        )}
        {settings?.show_tax_id !== false && settings?.tax_id && (
          <div className="text-[10px]">Tax ID: {settings.tax_id}</div>
        )}
        {settings?.receipt_header && (
          <div className="text-[10px] mt-1 whitespace-pre-line">{settings.receipt_header}</div>
        )}
      </div>

      <div className="border-t border-dashed border-black my-2" />

      <div className="flex justify-between text-[10px]">
        <span>#{invoice.invoice_no ?? "—"}</span>
        <span>{date.toLocaleString()}</span>
      </div>
      {invoice.customers?.name && (
        <div className="text-[10px]">Customer: {invoice.customers.name}</div>
      )}
      {settings?.show_cashier !== false && invoice.cashier_name && (
        <div className="text-[10px]">Cashier: {invoice.cashier_name}</div>
      )}

      <div className="border-t border-dashed border-black my-2" />

      <div className="space-y-1">
        {invoice.sale_items?.map((it, i) => (
          <div key={it.id ?? i}>
            <div className="truncate">{it.name}</div>
            <div className="flex justify-between text-[10px]">
              <span>
                {fmtQty(it.qty)}
                {it.price != null ? ` × ${fmtMoney(it.price, sym)}` : ""}
              </span>
              <span>{fmtMoney(it.line_total, sym)}</span>
            </div>
          </div>
        ))}
      </div>

      <div className="border-t border-dashed border-black my-2" />

      <div className="space-y-0.5">
        <Row label="Subtotal" value={fmtMoney(invoice.subtotal, sym)} />
        {settings?.show_tax_lines !== false && (
          <Row
            label={`Tax${settings?.tax_rate ? ` (${settings.tax_rate}%)` : ""}`}
            value={fmtMoney(invoice.tax, sym)}
          />
        )}
        {Number(invoice.discount) > 0 && (
          <Row label="Discount" value={`-${fmtMoney(invoice.discount, sym)}`} />
        )}
        <div className="border-t border-black my-1" />
        <Row label="TOTAL" value={fmtMoney(invoice.total, sym)} bold />
        <Row label="Paid" value={fmtMoney(invoice.paid, sym)} />
        {Number(invoice.change_due ?? 0) > 0 && (
          <Row label="Change" value={fmtMoney(invoice.change_due, sym)} />
        )}
      </div>

      {invoice.payment_method && (
        <div className="text-[10px] mt-2 text-center uppercase">
          Paid by {invoice.payment_method}
        </div>
      )}

      {settings?.receipt_footer && (
        <>
          <div className="border-t border-dashed border-black my-2" />
          <div className="text-center text-[10px] whitespace-pre-line">
            {settings.receipt_footer}
          </div>
        </>
      )}
    </div>
  );
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className={`flex justify-between ${bold ? "font-bold text-[12px]" : ""}`}>
      <span>{label}</span>
      <span>{value}</span>
    </div>
  );
}

/** Sample invoice used in the settings preview. */
export const sampleInvoice: ReceiptInvoice = {
  invoice_no: "PREVIEW-001",
  created_at: new Date().toISOString(),
  customers: { name: "Walk-in customer" },
  cashier_name: "Demo Cashier",
  payment_method: "cash",
  sale_items: [
    { name: "Whole Wheat Bread 500g", qty: 2, price: 2.5, line_total: 5.0 },
    { name: "Organic Milk 1L", qty: 1, price: 3.2, line_total: 3.2 },
    { name: "Bananas", qty: 1.25, price: 1.6, line_total: 2.0 },
  ],
  subtotal: 10.2,
  tax: 0.82,
  discount: 0.5,
  total: 10.52,
  paid: 20.0,
  change_due: 9.48,
};
