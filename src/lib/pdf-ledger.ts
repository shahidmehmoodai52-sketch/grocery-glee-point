export type LedgerRow = {
  date: string;
  type: string;
  ref: string;
  note?: string;
  debit: number;   // In  (+)
  credit: number;  // Out (−)
  balance: number;
};

export type LedgerItem = {
  date: string;
  invoice: string;
  name: string;
  qty: number;
  price: number;
  total: number;
};

export async function buildLedgerPdf(opts: {
  storeName: string;
  storeAddress?: string;
  storePhone?: string;
  partyName: string;
  partyPhone?: string;
  heading: string;            // e.g. "Customer Ledger" or "Supplier Ledger"
  from?: string;
  to?: string;
  currency: string;
  rows: LedgerRow[];
  items?: LedgerItem[];
  opening: number;
  totalDebit: number;   // total In
  totalCredit: number;  // total Out
  /** Direction label used for non-zero balances. e.g. customer: "they owe" / "advance" ; supplier: "we owe" / "advance" */
  owedLabel?: string;
  advanceLabel?: string;
}): Promise<Blob> {
  const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([
    import("jspdf"),
    import("jspdf-autotable"),
  ]);
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const sym = opts.currency;
  const money = (n: number) => `${sym}${Number(n || 0).toFixed(2)}`;
  const closing = opts.opening + opts.totalDebit - opts.totalCredit;
  const owed = opts.owedLabel ?? "Outstanding";
  const advance = opts.advanceLabel ?? "Advance";
  const closingLabel =
    closing > 0 ? `${owed}: ${money(closing)}`
    : closing < 0 ? `${advance}: ${money(Math.abs(closing))}`
    : `Settled: ${money(0)}`;

  doc.setFontSize(16);
  doc.text(opts.storeName, 40, 40);
  doc.setFontSize(10);
  if (opts.storeAddress) doc.text(opts.storeAddress, 40, 55);
  if (opts.storePhone) doc.text(`Tel: ${opts.storePhone}`, 40, 70);

  doc.setFontSize(13);
  doc.text(opts.heading, 40, 95);
  doc.setFontSize(10);
  doc.text(`Party: ${opts.partyName}`, 40, 110);
  if (opts.partyPhone) doc.text(`Phone: ${opts.partyPhone}`, 40, 124);
  const periodStr = opts.from || opts.to ? `Period: ${opts.from || "—"} → ${opts.to || "—"}` : `Generated: ${new Date().toLocaleString()}`;
  doc.text(periodStr, 40, 138);

  const body: any[] = [
    [
      { content: `Opening balance${opts.from ? ` (before ${opts.from})` : ""}`, colSpan: 4, styles: { fontStyle: "bold", fillColor: [241, 245, 249] } },
      "", "",
      { content: money(opts.opening), styles: { halign: "right", fontStyle: "bold", fillColor: [241, 245, 249] } },
    ],
    ...opts.rows.map((r) => [
      new Date(r.date).toLocaleDateString(),
      r.type,
      r.ref,
      r.note || "",
      r.debit ? money(r.debit) : "",
      r.credit ? money(r.credit) : "",
      money(r.balance),
    ]),
  ];

  autoTable(doc, {
    startY: 155,
    head: [["Date", "Type", "Ref", "Note", "In (+)", "Out (−)", "Balance"]],
    body,
    foot: [
      [
        { content: "Period totals", colSpan: 4, styles: { fontStyle: "bold" } },
        { content: money(opts.totalDebit), styles: { halign: "right", fontStyle: "bold" } },
        { content: money(opts.totalCredit), styles: { halign: "right", fontStyle: "bold" } },
        "",
      ],
      [
        { content: `Closing = Opening + In − Out`, colSpan: 6, styles: { fontStyle: "bold" } },
        { content: money(closing), styles: { halign: "right", fontStyle: "bold" } },
      ],
    ],
    styles: { fontSize: 9 },
    headStyles: { fillColor: [30, 41, 59] },
    footStyles: { fillColor: [241, 245, 249], textColor: 20, fontStyle: "bold" },
    columnStyles: { 4: { halign: "right" }, 5: { halign: "right" }, 6: { halign: "right" } },
  });

  let y = (doc as any).lastAutoTable.finalY + 18;
  doc.setFontSize(12);
  doc.text(closingLabel, 40, y);
  y += 18;

  if (opts.items && opts.items.length) {
    if (y > 720) { doc.addPage(); y = 40; }
    doc.setFontSize(12);
    doc.text("Item-wise details", 40, y);
    autoTable(doc, {
      startY: y + 6,
      head: [["Date", "Invoice", "Item", "Qty", "Rate", "Amount"]],
      body: opts.items.map((i) => [
        new Date(i.date).toLocaleDateString(),
        i.invoice,
        i.name,
        String(i.qty),
        money(i.price),
        money(i.total),
      ]),
      styles: { fontSize: 8 },
      headStyles: { fillColor: [30, 41, 59] },
    });
  }

  return doc.output("blob");
}
