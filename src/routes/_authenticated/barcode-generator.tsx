import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { Barcode as BarcodeIcon, Printer, Search, Wand2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useSettings } from "@/hooks/use-settings";
import {
  LabelSheet,
  LabelSizeFields,
  useLabelSize,
  type BarcodeLabelProduct,
  printBarcodeLabels,
} from "@/components/barcode-print-dialog";

export const Route = createFileRoute("/_authenticated/barcode-generator")({
  component: BarcodeGeneratorPage,
});

function useDebounced<T>(value: T, ms: number) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

// Label date format matches the common "DD/MM/YY" convention shop owners
// already use on hand-written price/expiry stickers.
function fmtLabelDate(iso: string) {
  const [y, m, d] = iso.split("-");
  if (!y || !m || !d) return iso;
  return `${d}/${m}/${y.slice(2)}`;
}

function BarcodeGeneratorPage() {
  const { t } = useTranslation();
  const { data: settings } = useSettings();

  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounced(search.trim(), 250);
  const [selectedProductId, setSelectedProductId] = useState<string | null>(null);

  const [businessName, setBusinessName] = useState("");
  const [name, setName] = useState("");
  const [size, setSize] = useState("");
  const [barcode, setBarcode] = useState("");
  const [price, setPrice] = useState("");
  const [packedDate, setPackedDate] = useState(todayISO());
  const [expiryDate, setExpiryDate] = useState("");
  const [generating, setGenerating] = useState(false);

  const { choice: labelChoice, setChoice: setLabelChoice, custom: labelCustom, setCustom: setLabelCustom, dimensions: labelDimensions } = useLabelSize("small");
  const [qty, setQty] = useState(1);

  // Prefill from store settings once loaded, without clobbering anything the
  // user already typed (e.g. a different brand name for a private-label item).
  useEffect(() => {
    if (settings?.store_name && !businessName) setBusinessName(settings.store_name);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings?.store_name]);

  const { data: matches = [] } = useQuery({
    queryKey: ["products", "barcode-gen-search", debouncedSearch],
    enabled: debouncedSearch.length > 0,
    staleTime: 15_000,
    queryFn: async () => {
      const term = debouncedSearch.replace(/[(),]/g, " ");
      const { data, error } = await supabase
        .from("products")
        .select("id, name, barcode, sell_price, expiry_date")
        .or(`name.ilike.%${term}%,sku.ilike.${term}%,barcode.ilike.${term}%`)
        .order("name")
        .limit(20);
      if (error) throw error;
      return data ?? [];
    },
  });

  const pickProduct = (p: any) => {
    setSelectedProductId(p.id);
    setName(p.name ?? "");
    setBarcode(p.barcode ?? "");
    setPrice(p.sell_price != null ? String(p.sell_price) : "");
    setExpiryDate(p.expiry_date ?? "");
    setSearch("");
  };

  const clearProduct = () => {
    setSelectedProductId(null);
    setName("");
    setSize("");
    setBarcode("");
    setPrice("");
    setExpiryDate("");
  };

  const generateBarcode = async () => {
    setGenerating(true);
    try {
      const { data, error } = await supabase.rpc("next_internal_barcode");
      if (error) return toast.error(error.message);
      setBarcode(data as string);
    } finally {
      setGenerating(false);
    }
  };

  const label: BarcodeLabelProduct = {
    businessName: businessName || null,
    name: name || t("barcode_generator.untitled_product", "Product"),
    size: size || null,
    barcode,
    sell_price: price !== "" ? Number(price) : null,
    packedDate: packedDate ? fmtLabelDate(packedDate) : null,
    expiryDate: expiryDate ? fmtLabelDate(expiryDate) : null,
  };

  const canPrint = name.trim().length > 0 && barcode.trim().length > 0;

  return (
    <div className="p-6 space-y-4 max-w-4xl">
      <PageHeader
        title={t("barcode_generator.title", "Barcode generator")}
        description={t(
          "barcode_generator.description",
          "Create a scannable barcode and print a label for any product — from your catalog or fully custom.",
        )}
        icon={<BarcodeIcon className="h-5 w-5" />}
      />

      <div className="grid md:grid-cols-2 gap-4">
        <Card className="p-4 space-y-4">
          <div>
            <Label>{t("barcode_generator.find_product", "Find a product (optional)")}</Label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                className="pl-9"
                placeholder={t("products.search_placeholder", "Search by name, SKU, barcode…")}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            {matches.length > 0 && (
              <div className="mt-1 border rounded-md divide-y max-h-56 overflow-y-auto bg-background">
                {matches.map((p: any) => (
                  <button
                    key={p.id}
                    type="button"
                    className="w-full text-left px-3 py-2 text-sm hover:bg-muted/50"
                    onClick={() => pickProduct(p)}
                  >
                    <div className="font-medium">{p.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {p.barcode || t("barcode_generator.no_barcode_yet", "No barcode yet")}
                    </div>
                  </button>
                ))}
              </div>
            )}
            {selectedProductId && (
              <button type="button" className="text-xs text-muted-foreground underline mt-1" onClick={clearProduct}>
                {t("barcode_generator.clear_selection", "Clear — start a custom label instead")}
              </button>
            )}
          </div>

          <div>
            <Label>{t("barcode_generator.business_name", "Business / shop name")}</Label>
            <Input value={businessName} onChange={(e) => setBusinessName(e.target.value)} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>{t("common.name", "Product name")}</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div>
              <Label>{t("barcode_generator.size_weight", "Size / weight (optional)")}</Label>
              <Input placeholder="e.g. 100GM" value={size} onChange={(e) => setSize(e.target.value)} />
            </div>
          </div>

          <div>
            <Label>{t("pos.qa_primary_barcode", "Barcode")}</Label>
            <div className="flex gap-1">
              <Input value={barcode} onChange={(e) => setBarcode(e.target.value)} />
              <Button
                type="button"
                variant="outline"
                size="icon"
                disabled={generating}
                onClick={generateBarcode}
                title={t("products.generate_barcode", "Generate a new barcode")}
              >
                <Wand2 className="h-4 w-4" />
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label>{t("barcode_generator.packed_date", "Packed date")}</Label>
              <Input type="date" value={packedDate} onChange={(e) => setPackedDate(e.target.value)} />
            </div>
            <div>
              <Label>{t("pos.qa_expiry_date", "Expiry date")}</Label>
              <Input type="date" value={expiryDate} onChange={(e) => setExpiryDate(e.target.value)} />
            </div>
            <div>
              <Label>{t("barcode_generator.price_optional", "Price (optional)")}</Label>
              <Input type="number" step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} />
            </div>
          </div>
        </Card>

        <Card className="p-4 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <LabelSizeFields
              choice={labelChoice}
              onChoiceChange={setLabelChoice}
              custom={labelCustom}
              onCustomChange={setLabelCustom}
            />
            <div>
              <Label>{t("products.label_quantity", "Quantity")}</Label>
              <Input
                type="number"
                min={1}
                max={100}
                value={qty}
                onChange={(e) => setQty(Math.max(1, Math.min(100, Number(e.target.value) || 1)))}
              />
            </div>
          </div>

          <div className="border rounded-md p-6 flex justify-center items-center bg-muted/20 min-h-[180px]">
            {canPrint ? (
              <div style={{ transform: "scale(2)" }}>
                <LabelSheet product={label} qty={1} size={labelDimensions} />
              </div>
            ) : (
              <p className="text-sm text-muted-foreground text-center">
                {t("barcode_generator.preview_placeholder", "Fill in a product name and barcode to see the label preview.")}
              </p>
            )}
          </div>

          <Button className="w-full" disabled={!canPrint} onClick={() => printBarcodeLabels(label, qty, labelDimensions)}>
            <Printer className="h-4 w-4 mr-2" />
            {t("common.print", "Print")}
          </Button>
        </Card>
      </div>
    </div>
  );
}
