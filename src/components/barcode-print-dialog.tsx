import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import JsBarcode from "jsbarcode";
import { useTranslation } from "react-i18next";
import { Printer } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { fmtMoney } from "@/lib/format";

export type BarcodeLabelProduct = {
  name: string;
  barcode: string;
  sell_price?: number | null;
  businessName?: string | null;
  size?: string | null;
  packedDate?: string | null;
  expiryDate?: string | null;
};

export const LABEL_SIZES = {
  small: { widthMm: 40, heightMm: 25 },
  medium: { widthMm: 50, heightMm: 30 },
  large: { widthMm: 60, heightMm: 40 },
} as const;
export type LabelSize = keyof typeof LABEL_SIZES;
export type LabelDimensions = { widthMm: number; heightMm: number };

// "custom" lets a shop match whatever roll their own thermal label printer
// actually takes, instead of being stuck with the three built-in presets.
export type LabelSizeChoice = LabelSize | "custom";
const MIN_LABEL_MM = 15;
const MAX_LABEL_MM = 150;
const DEFAULT_CUSTOM: LabelDimensions = { widthMm: 40, heightMm: 25 };

export function clampLabelMm(n: number) {
  if (!Number.isFinite(n)) return MIN_LABEL_MM;
  return Math.max(MIN_LABEL_MM, Math.min(MAX_LABEL_MM, Math.round(n)));
}

export function useLabelSize(initial: LabelSizeChoice = "small") {
  const [choice, setChoice] = useState<LabelSizeChoice>(initial);
  const [custom, setCustom] = useState<LabelDimensions>(DEFAULT_CUSTOM);
  const dimensions: LabelDimensions = choice === "custom" ? custom : LABEL_SIZES[choice];
  return { choice, setChoice, custom, setCustom, dimensions };
}

/** Label-size dropdown + width/height fields, shared by the per-product
 *  print dialog and the standalone Barcode Generator page. */
export function LabelSizeFields({
  choice,
  onChoiceChange,
  custom,
  onCustomChange,
}: {
  choice: LabelSizeChoice;
  onChoiceChange: (v: LabelSizeChoice) => void;
  custom: LabelDimensions;
  onCustomChange: (v: LabelDimensions) => void;
}) {
  const { t } = useTranslation();
  return (
    <div>
      <Label>{t('products.label_size', 'Label size')}</Label>
      <Select value={choice} onValueChange={(v) => onChoiceChange(v as LabelSizeChoice)}>
        <SelectTrigger><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="small">{t('products.label_small', 'Small (40×25mm)')}</SelectItem>
          <SelectItem value="medium">{t('products.label_medium', 'Medium (50×30mm)')}</SelectItem>
          <SelectItem value="large">{t('products.label_large', 'Large (60×40mm)')}</SelectItem>
          <SelectItem value="custom">{t('products.label_custom', 'Custom size…')}</SelectItem>
        </SelectContent>
      </Select>
      {choice === "custom" && (
        <div className="grid grid-cols-2 gap-2 mt-2">
          <div>
            <Label className="text-xs text-muted-foreground">{t('products.label_width_mm', 'Width (mm)')}</Label>
            <Input
              type="number"
              min={MIN_LABEL_MM}
              max={MAX_LABEL_MM}
              value={custom.widthMm}
              onChange={(e) => onCustomChange({ ...custom, widthMm: clampLabelMm(Number(e.target.value)) })}
            />
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">{t('products.label_height_mm', 'Height (mm)')}</Label>
            <Input
              type="number"
              min={MIN_LABEL_MM}
              max={MAX_LABEL_MM}
              value={custom.heightMm}
              onChange={(e) => onCustomChange({ ...custom, heightMm: clampLabelMm(Number(e.target.value)) })}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function BarcodeSvg({ value }: { value: string }) {
  const ref = useRef<SVGSVGElement>(null);
  useEffect(() => {
    if (!ref.current || !value) return;
    try {
      JsBarcode(ref.current, value, {
        format: "CODE128",
        displayValue: true,
        fontSize: 11,
        height: 34,
        margin: 2,
      });
    } catch {
      // Value the symbology can't encode (shouldn't happen for CODE128) — leave the SVG blank.
    }
  }, [value]);
  return <svg ref={ref} />;
}

export function LabelSheet({ product, qty, size }: { product: BarcodeLabelProduct; qty: number; size: LabelDimensions }) {
  const { widthMm, heightMm } = size;
  const dateLine = [
    product.packedDate ? `PKD: ${product.packedDate}` : "",
    product.expiryDate ? `Exp: ${product.expiryDate}` : "",
  ].filter(Boolean).join("  ");
  return (
    <div className="barcode-label-sheet" style={{ display: "flex", flexDirection: "column", gap: "1.5mm" }}>
      {Array.from({ length: qty }).map((_, i) => (
        <div
          key={i}
          className="barcode-label"
          style={{
            width: `${widthMm}mm`,
            height: `${heightMm}mm`,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            overflow: "hidden",
            boxSizing: "border-box",
            padding: "1mm",
          }}
        >
          {product.businessName && (
            <div style={{ fontSize: "9px", fontWeight: 700, textAlign: "center", lineHeight: 1.1, width: "100%" }}>
              {product.businessName}
            </div>
          )}
          <div style={{ fontSize: "8px", fontWeight: 600, textAlign: "center", lineHeight: 1.1, maxHeight: "2.2em", overflow: "hidden", width: "100%" }}>
            {product.name}{product.size ? ` ${product.size}` : ""}
          </div>
          {dateLine && (
            <div style={{ fontSize: "6px", textAlign: "center", width: "100%" }}>{dateLine}</div>
          )}
          <BarcodeSvg value={product.barcode} />
          {typeof product.sell_price === "number" && (
            <div style={{ fontSize: "9px", fontWeight: 700 }}>{fmtMoney(product.sell_price)}</div>
          )}
        </div>
      ))}
    </div>
  );
}

function setBarcodePrintPageSize(styleEl: HTMLStyleElement, widthMm: number) {
  styleEl.textContent = `
    @media print {
      @page { size: ${widthMm}mm auto; margin: 0; }
      html.barcode-printing, html.barcode-printing body {
        width: ${widthMm}mm !important;
        min-width: 0 !important;
        height: fit-content !important;
        min-height: 0 !important;
        overflow: hidden !important;
        background: white !important;
        margin: 0 !important;
        padding: 0 !important;
      }
      html.barcode-printing .barcode-print-root {
        width: ${widthMm}mm !important;
      }
    }
  `;
}

export function printBarcodeLabels(product: BarcodeLabelProduct, qty: number, size: LabelDimensions) {
  if (typeof document === "undefined" || typeof window === "undefined") return;
  document.querySelector(".barcode-print-root")?.remove();

  const printRoot = document.createElement("div");
  printRoot.className = "barcode-print-root";
  printRoot.style.position = "fixed";
  printRoot.style.left = "-10000px";
  printRoot.style.top = "0";
  printRoot.style.pointerEvents = "none";
  document.body.appendChild(printRoot);
  document.documentElement.classList.add("barcode-printing");

  const root = createRoot(printRoot);
  root.render(<LabelSheet product={product} qty={qty} size={size} />);

  const styleId = "barcode-print-page-size";
  let styleEl = document.getElementById(styleId) as HTMLStyleElement | null;
  if (!styleEl) {
    styleEl = document.createElement("style");
    styleEl.id = styleId;
    document.head.appendChild(styleEl);
  }
  setBarcodePrintPageSize(styleEl, size.widthMm);

  let done = false;
  const cleanup = () => {
    if (done) return;
    done = true;
    document.documentElement.classList.remove("barcode-printing");
    try { root.unmount(); } catch { /* already unmounted */ }
    printRoot.remove();
    window.removeEventListener("afterprint", cleanup);
  };
  window.addEventListener("afterprint", cleanup);

  requestAnimationFrame(() => requestAnimationFrame(() => {
    window.print();
    window.setTimeout(cleanup, 10000);
  }));
}

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  product: BarcodeLabelProduct | null;
};

export function BarcodePrintDialog({ open, onOpenChange, product }: Props) {
  const { t } = useTranslation();
  const [qty, setQty] = useState(1);
  const { choice, setChoice, custom, setCustom, dimensions } = useLabelSize("small");

  useEffect(() => {
    if (open) setQty(1);
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t('products.print_barcode_label', 'Print barcode label')}{product ? ` — ${product.name}` : ""}</DialogTitle>
        </DialogHeader>
        {!product?.barcode ? (
          <p className="text-sm text-muted-foreground">
            {t('products.no_barcode_set', 'This product has no barcode yet. Add or generate one first, then come back here to print a label.')}
          </p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3">
              <LabelSizeFields choice={choice} onChoiceChange={setChoice} custom={custom} onCustomChange={setCustom} />
              <div>
                <Label>{t('products.label_quantity', 'Quantity')}</Label>
                <Input
                  type="number"
                  min={1}
                  max={100}
                  value={qty}
                  onChange={(e) => setQty(Math.max(1, Math.min(100, Number(e.target.value) || 1)))}
                />
              </div>
            </div>
            <div className="border rounded-md p-4 flex justify-center bg-muted/20">
              <div style={{ transform: "scale(1.6)" }}>
                <LabelSheet product={product} qty={1} size={dimensions} />
              </div>
            </div>
          </>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>{t('common.cancel', 'Cancel')}</Button>
          {product?.barcode && (
            <Button onClick={() => printBarcodeLabels(product, qty, dimensions)}>
              <Printer className="h-4 w-4 mr-2" />{t('common.print', 'Print')}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
