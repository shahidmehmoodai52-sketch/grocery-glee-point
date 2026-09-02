import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { parseInput, extractPurchaseBillInput } from "@/lib/server-validators";
import type { ExtractedBill } from "./types";

// Gemini's responseSchema is an OpenAPI-3.0 subset: a single uppercase `type`
// per field (no `["string","null"]` unions) with `nullable: true` for optional
// values, instead of the OpenAI-style JSON Schema used by chat-completions APIs.
const EXTRACTION_SCHEMA = {
  type: "OBJECT",
  properties: {
    supplier_name: { type: "STRING", nullable: true },
    invoice_number: { type: "STRING", nullable: true },
    invoice_date: {
      type: "STRING",
      nullable: true,
      description: "ISO yyyy-mm-dd if determinable, else null",
    },
    subtotal: { type: "NUMBER", nullable: true },
    total_discount: { type: "NUMBER", nullable: true },
    total_tax: { type: "NUMBER", nullable: true },
    grand_total: { type: "NUMBER", nullable: true },
    items: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          name: { type: "STRING", nullable: true },
          barcode: { type: "STRING", nullable: true },
          sku: { type: "STRING", nullable: true },
          qty: { type: "NUMBER", nullable: true },
          unit_cost: { type: "NUMBER", nullable: true },
          discount: { type: "NUMBER", nullable: true },
          tax: { type: "NUMBER", nullable: true },
          line_total: { type: "NUMBER", nullable: true },
        },
        required: ["name", "barcode", "sku", "qty", "unit_cost", "discount", "tax", "line_total"],
      },
    },
  },
  required: [
    "supplier_name",
    "invoice_number",
    "invoice_date",
    "subtotal",
    "total_discount",
    "total_tax",
    "grand_total",
    "items",
  ],
} as const;

const SYSTEM_PROMPT =
  "You extract structured data from photos of supplier purchase bills/invoices for a retail shop. " +
  "You may be given more than one image — in that case they are multiple pages/photos of the SAME " +
  "single bill, in order; combine them into one extraction (e.g. sum line items across pages) " +
  "rather than treating them as separate bills. Read every line item. If a field is blurry, " +
  "missing, or you are not confident, return null for that field rather than guessing. Numbers " +
  "must be plain numbers (no currency symbols). Handle rotated or skewed photos and handwritten " +
  "values as best you can, but never invent a value.";

/** Splits a `data:image/xxx;base64,....` URL into a Gemini inlineData part. */
function dataUrlToInlinePart(dataUrl: string): { inlineData: { mimeType: string; data: string } } {
  const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/.exec(dataUrl);
  if (!match) throw new Error("Expected an image data URL");
  return { inlineData: { mimeType: match[1], data: match[2] } };
}

/**
 * Server-side AI extraction of a supplier purchase bill — one or more
 * photos/pages of the SAME bill — into strict structured JSON. Never
 * returns invented values — the model is instructed to use null for
 * anything it cannot confidently read. This function only extracts; it
 * never touches products/suppliers/purchases.
 *
 * Calls the Google Gemini API directly (rather than Lovable's AI gateway)
 * so this works on any hosting target, not just Lovable's own — the gateway
 * key is scoped to Lovable's infrastructure and isn't portable to other
 * hosts such as Vercel.
 */
export const extractPurchaseBill = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => parseInput(extractPurchaseBillInput, data))
  .handler(async ({ data }) => {
    const apiKey = process.env.GOOGLE_API_KEY;
    if (!apiKey) {
      throw new Error(
        "AI bill scanning isn't configured for this project yet (missing GOOGLE_API_KEY).",
      );
    }

    const promptText =
      data.images.length > 1
        ? `Extract this purchase bill (${data.images.length} pages, in order) as JSON matching the given schema.`
        : "Extract this purchase bill as JSON matching the given schema.";

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
          contents: [
            {
              role: "user",
              parts: [{ text: promptText }, ...data.images.map(dataUrlToInlinePart)],
            },
          ],
          generationConfig: {
            responseMimeType: "application/json",
            responseSchema: EXTRACTION_SCHEMA,
          },
        }),
      },
    );

    if (response.status === 429)
      throw new Error("AI is busy right now — please try again in a moment.");
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`AI extraction failed (${response.status}). ${body.slice(0, 200)}`);
    }

    const result = await response.json();
    const text = result?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) {
      throw new Error("AI did not return structured bill data — try a clearer photo.");
    }

    let parsed: ExtractedBill;
    try {
      parsed = JSON.parse(text);
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
