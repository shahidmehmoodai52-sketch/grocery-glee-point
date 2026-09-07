import { useEffect } from "react";
import { createRoot } from "react-dom/client";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
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
  paper_width?: string | null; // '58mm' | '80mm' | 'A4'
  show_logo?: boolean | null;
  show_tax_id?: boolean | null;
  show_address?: boolean | null;
  show_phone?: boolean | null;
  show_tax_lines?: boolean | null;
  show_cashier?: boolean | null;
  payment_qr_url?: string | null;
  payment_qr_label?: string | null;
  show_payment_qr?: boolean | null;
  // Local direct print settings
  printer_name?: string | null;
  direct_print_enabled?: boolean | null;
};

export type ReceiptInvoice = {
  invoice_no?: string | number;
  return_no?: string | number;
  created_at?: string | Date;
  customers?: { name?: string; phone?: string } | null;
  suppliers?: { name?: string; phone?: string } | null;
  expense_persons?: { name?: string } | null;
  expense_person_name?: string | null;
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
  discount?: number;
  charge?: number;
  total: number;
  paid?: number;
  refund_amount?: number;
  change_due?: number;
  note?: string | null;
  payment_method?: string;
  refund_method?: string;
  isPurchase?: boolean;
};

type Props = {
  invoice: ReceiptInvoice;
  settings?: ReceiptSettings | null;
  paper?: boolean;
  kind?: "sale" | "sale-return" | "purchase-return";
};

function setReceiptPrintPageSize(
  styleEl: HTMLStyleElement,
  preferredWidth: string,
  scope: ParentNode = document,
) {
  const receipt = scope.querySelector<HTMLElement>(".receipt-paper");
  const rect = receipt?.getBoundingClientRect();
  const measuredWidthMm = rect ? (rect.width * 25.4) / 96 : Number.parseFloat(preferredWidth);
  const width = measuredWidthMm <= 65 ? "58mm" : "80mm";
  const contentHeightPx = rect?.height ?? 0;
  const contentHeightMm = Math.max(40, Math.ceil((contentHeightPx * 25.4) / 96) + 4);

  styleEl.textContent = `
    @media print {
      @page { size: ${width} ${contentHeightMm}mm; margin: 0; }
      html, body {
        width: ${width} !important;
        height: ${contentHeightMm}mm !important;
        min-height: 0 !important;
        overflow: hidden !important;
      }
      html.receipt-printing body > :not(.receipt-print-root) { display: none !important; }
      html.receipt-printing .receipt-print-root {
        display: block !important;
        visibility: visible !important;
        position: absolute !important;
        top: 0 !important;
        left: 0 !important;
        width: ${width} !important;
        min-height: 0 !important;
        margin: 0 !important;
        padding: 0 !important;
        transform: none !important;
        overflow: visible !important;
      }
      html.receipt-printing .receipt-print-root .print-area {
        position: static !important;
        width: ${width} !important;
        height: auto !important;
        min-height: 0 !important;
        margin: 0 !important;
        padding: 0 !important;
        transform: none !important;
        overflow: visible !important;
      }
      html.receipt-printing .receipt-print-root .receipt-paper {
        min-height: 0 !important;
        height: auto !important;
        margin: 0 !important;
        transform: none !important;
      }
    }
  `;
}

async function tryDirectPrint(options: { printerName?: string | null; silent?: boolean } = {}): Promise<boolean> {
  if (typeof window === "undefined") return false;
  
  const getPrintApi = () => {
    const win = window as Window & typeof globalThis & {
      pos?: { print?: (options?: Record<string, unknown>) => Promise<boolean> | boolean };
      electron?: { print?: (options?: Record<string, unknown>) => Promise<boolean> | boolean };
    };
    return win.pos?.print ?? win.electron?.print;
  };

  const printApi = getPrintApi();
  const hasBridge = typeof printApi === "function";

  if (hasBridge) {
    const attempts = 3;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        const result = await (getPrintApi()!)({
          silent: options.silent !== false,
          printBackground: true,
          deviceName: options.printerName || undefined,
        });
        if (result !== false) return true;
      } catch (err) {
        console.warn("Direct print attempt failed:", err);
      }
      if (attempt < attempts - 1) {
        await new Promise((resolve) => window.setTimeout(resolve, 200));
      }
    }
  }

  // If we reach here and direct printing was explicitly requested but failed/missing bridge,
  // we return false to let the caller decide whether to fallback to browser print.
  if (options.silent === true && hasBridge) return false;

  // Browser fallback — either no bridge or explicit fallback requested
  try {
    window.print();
    return true;
  } catch {
    return false;
  }
}

export function printReceipt(sourceElement?: HTMLElement | null, settings?: ReceiptSettings | null) {
  if (typeof document === "undefined" || typeof window === "undefined") return;
  document.querySelector(".receipt-print-root")?.remove();
  const source = sourceElement ?? document.querySelector<HTMLElement>(".print-area");
  if (!source) {
    void tryDirectPrint({
      printerName: settings?.printer_name,
      silent: settings?.direct_print_enabled === true
    }).then((printed) => {
      if (!printed) toast.error("Print failed — check the printer connection and try again.");
    });
    return;
  }
  const printRoot = document.createElement("div");
  printRoot.className = "receipt-print-root";
  // Keep the clone invisible on screen — printing must never look like a preview.
  printRoot.style.position = "fixed";
  printRoot.style.left = "-10000px";
  printRoot.style.top = "0";
  printRoot.style.pointerEvents = "none";
  printRoot.style.visibility = "hidden"; // Ensure it's hidden from layout
  const clonedSource = source.cloneNode(true) as HTMLElement;
  printRoot.appendChild(clonedSource);
  document.body.appendChild(printRoot);
  document.documentElement.classList.add("receipt-printing");

  const styleId = "receipt-print-page-size";
  let styleEl = document.getElementById(styleId) as HTMLStyleElement | null;
  if (!styleEl) {
    styleEl = document.createElement("style");
    styleEl.id = styleId;
    document.head.appendChild(styleEl);
  }
  let done = false;
  const cleanup = () => {
    if (done) return;
    done = true;
    document.documentElement.classList.remove("receipt-printing");
    printRoot.remove();
    window.removeEventListener("afterprint", cleanup);
  };
  window.addEventListener("afterprint", cleanup);
  
  const width = settings?.paper_width || "80mm";
  setReceiptPrintPageSize(styleEl, width, printRoot);
  
  requestAnimationFrame(() => {
    void tryDirectPrint({
      printerName: settings?.printer_name,
      silent: settings?.direct_print_enabled === true
    }).then((printed) => {
      // Direct printing silently gives up rather than popping a native dialog
      // mid-shift (see tryDirectPrint) — so the cashier must be told when it
      // fails, or a real sale's receipt just never comes out with no sign why.
      if (!printed) toast.error("Print failed — check the printer connection and try again.");
      // Small delay to ensure browser print dialog has handed off or desktop bridge finished
      setTimeout(cleanup, 1000);
    });
    // Safety net
    window.setTimeout(cleanup, 10000);
  });
}


/** Print a wide, full-page document (a customer/supplier ledger, an
 *  item-wise breakdown, etc.) — distinct from printReceipt()'s narrow
 *  thermal-receipt sizing. Marks every `.doc-print-area` on the page visible
 *  (see styles.css) and prints in place, at normal page width, instead of
 *  squeezing a multi-column table into 80mm and clipping most of it. */
export function printDocument() {
  if (typeof document === "undefined" || typeof window === "undefined") return;
  document.documentElement.classList.add("doc-printing");

  const styleId = "doc-print-page-size";
  let styleEl = document.getElementById(styleId) as HTMLStyleElement | null;
  if (!styleEl) {
    styleEl = document.createElement("style");
    styleEl.id = styleId;
    document.head.appendChild(styleEl);
  }
  styleEl.textContent = `@media print { @page { size: auto; margin: 12mm; } }`;

  let done = false;
  const cleanup = () => {
    if (done) return;
    done = true;
    document.documentElement.classList.remove("doc-printing");
    window.removeEventListener("afterprint", cleanup);
  };
  window.addEventListener("afterprint", cleanup);

  requestAnimationFrame(() => {
    window.print();
    setTimeout(cleanup, 1000);
    window.setTimeout(cleanup, 10000);
  });
}

/** Print an invoice directly without opening a preview dialog.
 *  Renders the receipt off-screen, prints it, then cleans up. */
export function printInvoiceDirect(invoice: ReceiptInvoice, settings: ReceiptSettings | null | undefined, kind: Props["kind"] = "sale") {
  if (typeof document === "undefined") return;
  const host = document.createElement("div");
  host.style.position = "fixed";
  host.style.left = "-10000px";
  host.style.top = "0";
  host.style.pointerEvents = "none";
  const wrapper = document.createElement("div");
  wrapper.className = "print-area";
  host.appendChild(wrapper);
  document.body.appendChild(host);
  const root = createRoot(wrapper);
  root.render(<Receipt invoice={invoice as any} settings={settings as any} kind={kind} />);
  const done = () => {
    try { root.unmount(); } catch {}
    host.remove();
    window.removeEventListener("afterprint", done);
  };
  window.addEventListener("afterprint", done);
  // Give React a frame to commit before printing.
  requestAnimationFrame(() => requestAnimationFrame(() => {
    printReceipt(wrapper, settings);
    // Safety cleanup in case afterprint doesn't fire (some browsers).
    setTimeout(done, 5000);
  }));
}

export function Receipt({ invoice, settings, paper = true, kind = "sale" }: Props) {
  const { t } = useTranslation();
  const sym = "";
  const width = settings?.paper_width === "58mm" ? "58mm" : "80mm";
  const date = invoice.created_at ? new Date(invoice.created_at) : new Date();
  const isReturn = kind !== "sale";
  const docNo = invoice.return_no ?? invoice.invoice_no ?? "—";
  const docTitle =
    kind === "sale-return"
      ? t('receipt.doc_sales_return', 'SALES RETURN')
      : kind === "purchase-return"
      ? t('receipt.doc_purchase_return', 'PURCHASE RETURN')
      : invoice.isPurchase
      ? t('receipt.doc_purchase_invoice', 'PURCHASE INVOICE')
      : t('receipt.doc_sales_invoice', 'SALES INVOICE');

  const staffName = invoice.expense_persons?.name ?? invoice.expense_person_name ?? null;
  const party = invoice.customers?.name ?? invoice.suppliers?.name ?? staffName ?? undefined;
  const partyLabel =
    kind === "purchase-return"
      ? t('receipt.party_supplier', 'Supplier')
      : !invoice.customers?.name && !invoice.suppliers?.name && staffName
        ? t('receipt.party_staff', 'Staff')
        : t('receipt.party_customer', 'Customer');
  const savings = Number(invoice.discount ?? 0);

  useEffect(() => {
    if (typeof document === "undefined") return;
    const html = document.documentElement;
    const styleId = "receipt-print-page-size";
    let styleEl = document.getElementById(styleId) as HTMLStyleElement | null;
    if (!styleEl) {
      styleEl = document.createElement("style");
      styleEl.id = styleId;
      document.head.appendChild(styleEl);
    }
    const updatePrintSize = () => setReceiptPrintPageSize(styleEl, width);
    updatePrintSize();
    const raf = requestAnimationFrame(updatePrintSize);
    window.addEventListener("beforeprint", updatePrintSize);
    window.addEventListener("resize", updatePrintSize);
    if (width === "58mm") html.classList.add("print-58mm");
    else html.classList.remove("print-58mm");
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("beforeprint", updatePrintSize);
      window.removeEventListener("resize", updatePrintSize);
      html.classList.remove("print-58mm");
    };
  }, [width, invoice, settings]);


  return (
    <div
      className="receipt-paper bg-white text-black mx-auto relative"
      style={
        paper
          ? {
              width,
              maxWidth: width,
              boxSizing: "border-box",
              padding: "2mm 2.5mm 1.5mm",
              fontFamily: "'Helvetica Neue', Helvetica, Arial, 'Segoe UI', sans-serif",
              fontSize: "12px",
              lineHeight: 1.25,
              fontWeight: 600,
              overflow: "hidden",
              WebkitFontSmoothing: "antialiased",
            }
          : undefined
      }
    >

      <div className="flex flex-col items-center">
        <div className="w-full flex items-center gap-1 mb-1">
          <span className="flex-1 border-t-2 border-double border-black" />
          <span className="text-[8px] tracking-[0.3em] uppercase">{t('receipt.star_receipt', '★ Receipt ★')}</span>
          <span className="flex-1 border-t-2 border-double border-black" />
        </div>

        {settings?.show_logo !== false && settings?.logo_url && (
          <img src={settings.logo_url} alt="logo" className="max-h-12 object-contain my-1" />
        )}

        <div className="font-extrabold text-[15px] uppercase tracking-[0.08em] text-center">
          {settings?.store_name ?? t('receipt.store_fallback', 'Store')}
        </div>
        {settings?.show_address !== false && settings?.address && (
          <div className="text-[9.5px] text-center leading-tight">{settings.address}</div>
        )}
        <div className="text-[9.5px] text-center flex flex-wrap justify-center gap-x-2">
          {settings?.show_phone !== false && settings?.phone && <span>☎ {settings.phone}</span>}
          {settings?.show_tax_id !== false && settings?.tax_id && (
            <span>{t('receipt.ntn_tax_label', 'NTN/Tax:')} {settings.tax_id}</span>
          )}
        </div>
        {settings?.receipt_header && (
          <div className="text-[10px] mt-1 whitespace-pre-line text-center italic">
            {settings.receipt_header}
          </div>
        )}
      </div>

      <div className="my-1 border-t border-dashed border-black" />

      <div className="text-center text-[11px] font-bold tracking-widest">{docTitle}</div>

      <div className="mt-1 grid grid-cols-2 gap-x-2 text-[10px]">
        <div>
          <span className="font-bold">{t('receipt.no_label', 'No:')}</span>{" "}
          <span className="font-mono">{docNo}</span>
        </div>
        <div className="text-right">{date.toLocaleDateString()}</div>
        <div>
          {party ? (
            <>
              <span className="font-bold">{partyLabel}:</span> {party}
            </>
          ) : (
            <span className="text-black/60">{t('receipt.walk_in', 'Walk-in')}</span>
          )}
        </div>
        <div className="text-right">
          {date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
        </div>
        {settings?.show_cashier !== false && invoice.cashier_name && (
          <div className="col-span-2">
            <span className="font-bold">{t('receipt.cashier_label', 'Cashier:')}</span> {invoice.cashier_name}
          </div>
        )}
      </div>

      <div className="my-1 border-t border-dashed border-black" />

      <div className="text-[9.5px] grid grid-cols-12 font-bold uppercase tracking-wider pb-1 border-b border-black">
        <div className="col-span-5">{t('receipt.col_item', 'Item')}</div>
        <div className="col-span-2 text-right">{t('receipt.col_rate', 'Rate')}</div>
        <div className="col-span-2 text-right">{t('receipt.col_qty', 'Qty')}</div>
        <div className="col-span-3 text-right">{t('receipt.col_amt', 'Amt')}</div>
      </div>
      <div className="divide-y divide-dotted divide-black/30">
        {invoice.sale_items?.map((it, i) => (
          <div key={it.id ?? i} className="py-0.5 grid grid-cols-12 text-[10.5px] items-center">
            <div className="col-span-5 font-semibold leading-tight pr-1 break-words">
              {it.name}
            </div>
            <div className="col-span-2 text-right font-semibold">
              {it.price != null ? fmtMoney(it.price, sym) : ""}
            </div>
            <div className="col-span-2 text-right font-semibold">{fmtQty(it.qty)}</div>
            <div className="col-span-3 text-right font-bold">
              {fmtMoney(it.line_total, sym)}
            </div>
          </div>
        ))}
      </div>

      <div className="my-1 border-t border-dashed border-black" />

      <div className="space-y-0.5">
        {invoice.sale_items && invoice.sale_items.length > 0 && (
          <Row
            label={t('receipt.items_label', 'Items')}
            value={t(
              invoice.sale_items.length === 1 ? 'receipt.item_count_one' : 'receipt.item_count_other',
              invoice.sale_items.length === 1 ? '{{count}} item' : '{{count}} items',
              { count: invoice.sale_items.length },
            )}
          />
        )}
        <Row label={t('receipt.subtotal', 'Subtotal')} value={fmtMoney(invoice.subtotal, sym)} />
        {settings?.show_tax_lines !== false && (
          <Row
            label={`${t('receipt.tax_label', 'Tax')}${settings?.tax_rate ? ` (${settings.tax_rate}%)` : ""}`}
            value={fmtMoney(invoice.tax, sym)}
          />
        )}
        {savings > 0 && <Row label={t('receipt.discount', 'Discount')} value={`-${fmtMoney(savings, sym)}`} />}
        {Number(invoice.charge ?? 0) > 0 && (
          <Row label={t('receipt.charges', 'Charges')} value={fmtMoney(invoice.charge ?? 0, sym)} />
        )}
      </div>

      <div className="mt-1 flex justify-between items-center px-1 py-1 text-[15px] font-extrabold uppercase tracking-wide" style={{ borderTop: "2px solid #000", borderBottom: "2px solid #000" }}>
        <span>{isReturn ? t('receipt.refund_due', 'Refund Due') : t('receipt.total', 'Total')}</span>
        <span>{fmtMoney(invoice.total, sym)}</span>
      </div>

      <div className="mt-1 space-y-0.5">
        {isReturn ? (
          <>
            <Row
              label={t('receipt.refund_label', 'Refund ({{method}})', { method: invoice.refund_method ?? "cash" })}
              value={fmtMoney(invoice.refund_amount ?? 0, sym)}
            />
            {Number(invoice.total) - Number(invoice.refund_amount ?? 0) > 0 && (
              <Row
                label={kind === "purchase-return" ? t('receipt.credit_from_supplier', 'Credit from supplier') : t('receipt.store_credit', 'Store credit')}
                value={fmtMoney(
                  Number(invoice.total) - Number(invoice.refund_amount ?? 0),
                  sym,
                )}
              />
            )}
          </>
        ) : (
          <>
            <Row label={t('receipt.paid', 'Paid')} value={fmtMoney(invoice.paid ?? 0, sym)} />
            {Number(invoice.change_due ?? 0) > 0 && (
              <Row label={t('receipt.change', 'Change')} value={fmtMoney(invoice.change_due ?? 0, sym)} />
            )}
          </>
        )}
      </div>

      {invoice.note && (
        <div className="mt-2 border border-dashed border-black p-1.5 text-[10.5px] whitespace-pre-line">
          <span className="font-bold uppercase tracking-wider text-[9px]">{t('receipt.note_label', 'Note:')} </span>
          {invoice.note}
        </div>
      )}



      {savings > 0 && !isReturn && (
        <div className="mt-2 text-center text-[10px] border border-dashed border-black py-1 font-semibold">
          {t('receipt.you_saved', '★ You saved {{amount}} today! ★', { amount: fmtMoney(savings, sym) })}
        </div>
      )}

      {(invoice.payment_method || invoice.refund_method) && (
        <div className="text-[10px] mt-2 text-center uppercase tracking-widest">
          {isReturn
            ? t('receipt.refunded_via', 'Refunded via {{method}}', { method: invoice.refund_method ?? "cash" })
            : t('receipt.paid_by', 'Paid by {{method}}', { method: invoice.payment_method })}
        </div>
      )}

      {isReturn && (
        <div className="my-2 mx-auto w-fit border-2 border-black px-3 py-0.5 text-[11px] font-extrabold tracking-widest" style={{ transform: "rotate(-4deg)" }}>
          {t('receipt.return_stamp', '✦ RETURN ✦')}
        </div>
      )}

      {settings?.show_payment_qr !== false && settings?.payment_qr_url && !isReturn && (
        <div className="mt-2 border border-dashed border-black p-2 flex flex-col items-center">
          <div className="text-[9px] uppercase tracking-[0.25em] font-bold mb-1">{t('receipt.scan_and_pay', 'Scan & Pay')}</div>
          <img
            src={settings.payment_qr_url}
            alt="Payment QR"
            className="w-28 h-28 object-contain bg-white"
          />
          {settings.payment_qr_label && (
            <div className="text-[10px] text-center whitespace-pre-line mt-1 font-medium">
              {settings.payment_qr_label}
            </div>
          )}
        </div>
      )}



      {settings?.receipt_footer && (
        <>
          <div className="my-1 border-t border-dashed border-black" />
          <div className="text-center text-[10px] whitespace-pre-line italic">
            {settings.receipt_footer}
          </div>
        </>
      )}

      <div className="mt-2 flex flex-col items-center">
        <div className="flex h-6 items-end gap-[1px]">
          {String(docNo)
            .split("")
            .flatMap((ch, i) => {
              const code = ch.charCodeAt(0);
              return [0, 1, 2].map((k) => (
                <span
                  key={`${i}-${k}`}
                  className="bg-black"
                  style={{ width: ((code + k) % 3) + 1 + "px", height: "100%" }}
                />
              ));
            })}
        </div>
        <div className="text-[9px] mt-0.5 tracking-[0.2em]">*{docNo}*</div>
      </div>

      <div className="mt-1 flex items-center gap-1">
        <span className="flex-1 border-t-2 border-double border-black" />
        <span className="text-[8px] tracking-[0.3em] uppercase">{t('receipt.end_marker', 'end')}</span>
        <span className="flex-1 border-t-2 border-double border-black" />
      </div>

      <div className="mt-1 text-center" style={{ marginBottom: 0 }}>
        <div className="text-[9px] uppercase tracking-[0.28em] font-bold">
          {t('receipt.powered_by', 'Powered by Tillix.co')}
        </div>
        <div className="text-[9px] tracking-wider mt-0.5">☎ +92 301 7160701</div>
      </div>

    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-[10.5px] font-semibold">
      <span>{label}</span>
      <span className="font-mono font-semibold">{value}</span>
    </div>
  );
}

export const sampleInvoice: ReceiptInvoice = {
  invoice_no: "S-1042",
  created_at: new Date().toISOString(),
  customers: { name: "Walk-in customer" },
  cashier_name: "Demo Cashier",
  payment_method: "cash",
  sale_items: [
    { name: "Whole Wheat Bread 500g", qty: 2, price: 2.5, line_total: 5.0 },
    { name: "Organic Milk 1L", qty: 1, price: 3.2, line_total: 3.2 },
    { name: "Bananas (per kg)", qty: 1.25, price: 1.6, line_total: 2.0 },
  ],
  subtotal: 10.2,
  tax: 0.82,
  discount: 0.5,
  total: 10.52,
  paid: 20.0,
  change_due: 9.48,
};
