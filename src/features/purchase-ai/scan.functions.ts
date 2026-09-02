import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { parseInput, extractPurchaseBillInput } from "@/lib/server-validators";
import type { ExtractedBill } from "./types";

const EXTRACTION_SCHEMA = {
  type: "object",
  properties: {
    supplier_name: { type: ["string", "null"] },
    invoice_number: { type: ["string", "null"] },
    invoice_date: { type: ["string", "null"], description: "ISO yyyy-mm-dd if determinable, else null" },
    subtotal: { type: ["number", "null"] },
    total_discount: { type: ["number", "null"] },
    total_tax: { type: ["number", "null"] },
    grand_total: { type: ["number", "null"] },
    items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: ["string", "null"] },
          barcode: { type: ["string", "null"] },
          sku: { type: ["string", "null"] },
          qty: { type: ["number", "null"] },
          unit_cost: { type: ["number", "null"] },
          discount: { type: ["number", "null"] },
          tax: { type: ["number", "null"] },
          line_total: { type: ["number", "null"] },
        },
        required: ["name", "barcode", "sku", "qty", "unit_cost", "discount", "tax", "line_total"],
      },
    },
  },
  required: ["supplier_name", "invoice_number", "invoice_date", "subtotal", "total_discount", "total_tax", "grand_total", "items"],
} as const;

/**
 * Server-side AI extraction of a supplier purchase bill — one or more
 * photos/pages of the SAME bill — into strict structured JSON. Never
 * returns invented values — the model is instructed to use null for
 * anything it cannot confidently read. This function only extracts; it
 * never touches products/suppliers/purchases.
 */
export const extractPurchaseBill = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => parseInput(extractPurchaseBillInput, data))
  .handler(async ({ data }) => {
    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) {
      throw new Error("AI bill scanning isn't configured for this project yet (missing LOVABLE_API_KEY).");
    }

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          {
            role: "system",
            content:
              "You extract structured data from photos of supplier purchase bills/invoices for a retail shop. " +
              "You may be given more than one image — in that case they are multiple pages/photos of the SAME " +
              "single bill, in order; combine them into one extraction (e.g. sum line items across pages) " +
              "rather than treating them as separate bills. Read every line item. If a field is blurry, " +
              "missing, or you are not confident, return null for that field rather than guessing. Numbers " +
              "must be plain numbers (no currency symbols). Handle rotated or skewed photos and handwritten " +
              "values as best you can, but never invent a value.",
          },
          {
            role: "user",
            content: [
              {
                type: "text",
                text:
                  data.images.length > 1
                    ? `Extract this purchase bill (${data.images.length} pages, in order) into the extract_purchase_bill function.`
                    : "Extract this purchase bill into the extract_purchase_bill function.",
              },
              ...data.images.map((image) => ({ type: "image_url" as const, image_url: { url: image } })),
            ],
          },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "extract_purchase_bill",
              description: "Structured extraction of a purchase bill",
              parameters: EXTRACTION_SCHEMA,
            },
          },
        ],
        tool_choice: { type: "function", function: { name: "extract_purchase_bill" } },
      }),
    });

    if (response.status === 429) throw new Error("AI is busy right now — please try again in a moment.");
    if (response.status === 402) throw new Error("AI usage limit reached for this workspace.");
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`AI extraction failed (${response.status}). ${body.slice(0, 200)}`);
    }

    const result = await response.json();
    const call = result?.choices?.[0]?.message?.tool_calls?.[0];
    if (!call?.function?.arguments) {
      throw new Error("AI did not return structured bill data — try a clearer photo.");
    }

    let parsed: ExtractedBill;
    try {
      parsed = JSON.parse(call.function.arguments);
    } catch {
      throw new Error("AI returned malformed data — try again.");
    }

    return {
      supplier_name: parsed.supplier_name ?? null,
      invoice_number: parsed.invoice_number ?? null,
      invoice_date: parsed.invoice_date ?? null,
      subtotal: parsed.subtotal ?? null,
      total_discount: parsed.total_discount ?? null,
      total_tax: parsed.total_tax ?? null,
      grand_total: parsed.grand_total ?? null,
      items: Array.isArray(parsed.items) ? parsed.items : [],
    } satisfies ExtractedBill;
  });
