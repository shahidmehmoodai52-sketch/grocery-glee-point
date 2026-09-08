// WhatsApp agent for Tillix's own number (+923096431377). Receives Meta
// WhatsApp Cloud API webhooks and branches on whether the sender's number
// is a registered shop (matched against store_settings.phone):
//
// - Not registered -> the original generic sales/FAQ assistant (pricing,
//   features, "email info@tillix.co for anything account-specific"). If
//   more than one shop shares that number, or exactly one shop needs a
//   confirmation ("which shop is this?"), that's handled here too.
// - Registered -> a support flow. Claude gets read-only tools scoped to
//   that shop's own tenant_id (never taken from message text) to look into
//   what they're describing, explains what it found, and asks the shop to
//   confirm that's really the issue. Only once the shop confirms does it
//   notify Tillix's own number with a report and stop -- it never writes to
//   the shop's data itself. Every fix in this project goes through
//   investigate -> report -> the owner's explicit approval; a "yes" typed
//   by whoever is holding the shop's phone isn't that approval for
//   financial records, so the report is where that approval step happens
//   now, same as it does for every other change made to this codebase.
//
// All credentials come from Vault via get_whatsapp_agent_secrets()
// (service-role only) - nothing here is a secret itself.
//
// Meta webhook contract: GET verifies the webhook subscription (echoes
// hub.challenge once hub.verify_token matches); POST delivers events and
// must be authenticated via the X-Hub-Signature-256 HMAC header, since this
// endpoint is otherwise publicly reachable (verify_jwt is off - Meta can't
// send a Supabase JWT).

import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const META_GRAPH_VERSION = "v21.0";
const ANTHROPIC_MODEL = "claude-haiku-4-5-20251001";
const HISTORY_LIMIT = 10;
const MAX_TOOL_ITERATIONS = 4;
// Tillix's own WhatsApp number, shown on the landing page - where a
// confirmed shop-support report gets sent.
const OWNER_WA_ID = "923096431377";

const SALES_SYSTEM_PROMPT = `You are the WhatsApp assistant for Tillix (tillix.co), a cloud-based POS
(point of sale) and retail management platform for grocery stores,
supermarkets, pharmacies, restaurants, retail shops, wholesalers and
multi-store chains.

Answer only using the facts below. If something isn't covered here (a
specific account, an invoice, a refund, a technical bug on someone's shop),
don't guess - tell them to email info@tillix.co or say a team member will
follow up on this chat, and keep it brief.

PRODUCT
Tillix replaces a stack of separate tools with one platform: fast
barcode-driven POS billing with thermal receipt printing, real-time
inventory with low-stock/expiry/batch tracking, customers & supplier
ledgers (khata), purchases & purchase returns, multi-cashier roles &
permissions with audit logs, real-time sales/profit/cash-flow dashboards,
multi-store support, multi-currency billing, and a resilient offline mode
that keeps selling when the internet drops and auto-syncs after.

PLANS (launch offer, 50% off, prices in USD - shown in the customer's own
currency on the site)
- Basic: $9.99/mo or $100/yr (normally $19.99/mo, $199/yr). For a single
  shop getting started: unlimited products & barcodes, POS billing &
  receipts, inventory & low-stock alerts, customers/suppliers & ledger,
  purchases & returns, offline mode & auto-sync, daily automatic backups,
  email support.
- Pro: $14.99/mo or $150/yr (normally $29.99/mo, $299/yr). Recommended for
  growing shops & multi-cashier teams: everything in Basic, plus
  multi-cashier roles & permissions, shifts/cash-drawer/audit logs, expiry
  & batch & wastage tracking, bulk import & global product library,
  advanced reports & P&L analytics, priority support.
- Every plan: 7-day free trial, no credit card required. Cancel anytime.
  Taxes may apply locally.

SIGN UP / SUPPORT
Sign up at the Tillix website (the same one they found this WhatsApp
number on). Support: info@tillix.co or this WhatsApp number,
+92 309 6431377.

If the sender says they're already a Tillix shop but this number isn't
recognized as a registered shop number, tell them plainly: this WhatsApp
number isn't registered to a shop on file, and ask them to message from
their shop's registered phone number (the one in their Tillix Settings),
or email info@tillix.co.

STYLE
Reply the way a helpful shop-owner-facing support person would text on
WhatsApp: short, warm, plain sentences, no markdown formatting, no long
lists unless they ask for a plan comparison. Match the customer's language
- if they write in Roman Urdu or Urdu, reply the same way; if English,
reply in English. Never invent a price, feature, or policy not listed
above.`;

function supportSystemPrompt(shopName: string, shopCode: string): string {
  return `You are Tillix's support assistant on WhatsApp, talking to someone at
"${shopName}" (shop code ${shopCode}) - their number is verified as this
shop's own registered number, so you may look at THIS shop's own data using
the tools you're given to investigate what they're describing. Never guess
at what's in their data - use a tool.

Your job for this conversation has three steps, in order:
1. Understand what they're reporting (a missing invoice, a balance that
   looks wrong, a specific bill, "app is slow", etc.) and use the tools to
   look into it if it's something they're describing about their own data.
2. Explain in plain, short WhatsApp language what you found - the actual
   numbers/dates/invoice you looked up, not vague reassurance - and
   explicitly ask them to confirm that's the issue they meant (e.g. "Is
   this the invoice/issue you meant? Reply yes to confirm.").
3. Do not say you have fixed anything and do not claim to have changed
   their data - you can only look things up, never change them. If they
   confirm, say their report is being sent to the Tillix team and someone
   will follow up. If a general software problem isn't something a data
   lookup can explain (e.g. "the app crashed", "print isn't working"),
   skip straight to asking them to describe exactly when/how it happens,
   then treat their confirmation of that description as ready to report.

If what they're asking is a general question (pricing, features, how to
use something) with nothing shop-specific to check, just answer it briefly
and don't force the confirm-and-report flow.

STYLE: short, warm, plain WhatsApp sentences, no markdown. Match their
language (Roman Urdu/Urdu in, Roman Urdu/Urdu out; English in, English
out).`;
}

const SUPPORT_TOOLS = [
  {
    name: "business_day_summary",
    description:
      "Sales and purchases count/total for one calendar date at this shop, plus the longest gap (in minutes) between two consecutive sales that day. Use this for 'my sale/invoice is missing', 'I was offline', 'what happened on [date]'.",
    input_schema: {
      type: "object",
      properties: { date: { type: "string", description: "YYYY-MM-DD" } },
      required: ["date"],
    },
  },
  {
    name: "find_invoice",
    description:
      "Looks up one sale or purchase invoice by its printed number (e.g. 'S-023-1435' or 'P-023-1435'), with its line items, total, and amount paid. Use this for 'this bill looks wrong' or 'this invoice's payment doesn't match'.",
    input_schema: {
      type: "object",
      properties: { invoice_no: { type: "string" } },
      required: ["invoice_no"],
    },
  },
  {
    name: "customer_balance",
    description: "Looks up a customer's ledger balance by name or phone (partial match). Use this for 'a customer's balance looks wrong'.",
    input_schema: {
      type: "object",
      properties: { query: { type: "string", description: "Customer name or phone, or part of it" } },
      required: ["query"],
    },
  },
  {
    name: "supplier_balance",
    description: "Looks up a supplier's ledger balance by name or phone (partial match). Use this for 'a supplier's balance looks wrong'.",
    input_schema: {
      type: "object",
      properties: { query: { type: "string", description: "Supplier name or phone, or part of it" } },
      required: ["query"],
    },
  },
];

async function verifySignature(rawBody: string, signatureHeader: string | null, appSecret: string): Promise<boolean> {
  if (!signatureHeader || !signatureHeader.startsWith("sha256=")) return false;
  const expectedHex = signatureHeader.slice("sha256=".length);
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(appSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sigBuf = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody));
  const actualHex = Array.from(new Uint8Array(sigBuf)).map((b) => b.toString(16).padStart(2, "0")).join("");
  if (actualHex.length !== expectedHex.length) return false;
  let diff = 0;
  for (let i = 0; i < actualHex.length; i++) diff |= actualHex.charCodeAt(i) ^ expectedHex.charCodeAt(i);
  return diff === 0;
}

async function callClaude(
  anthropicApiKey: string,
  system: string,
  messages: Record<string, unknown>[],
  tools?: Record<string, unknown>[],
): Promise<{ content: unknown[]; stop_reason: string }> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": anthropicApiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: 600,
      system,
      messages,
      ...(tools ? { tools } : {}),
    }),
  });
  if (!res.ok) throw new Error(`Anthropic API error ${res.status}: ${await res.text()}`);
  return await res.json();
}

function extractText(content: unknown[]): string {
  const block = (content as Array<{ type: string; text?: string }>).find((b) => b.type === "text");
  return block?.text ?? "";
}

/** Executes one of SUPPORT_TOOLS against Supabase, scoped to _tenantId
 *  (resolved server-side from the phone match - never from tool input). */
async function runSupportTool(
  admin: ReturnType<typeof createClient>,
  tenantId: string,
  name: string,
  input: Record<string, unknown>,
): Promise<unknown> {
  switch (name) {
    case "business_day_summary": {
      const { data, error } = await admin.rpc("agent_business_day_summary", {
        _tenant_id: tenantId,
        _date: input.date,
      }).single();
      if (error) throw error;
      return data;
    }
    case "find_invoice": {
      const { data, error } = await admin.rpc("agent_find_invoice", {
        _tenant_id: tenantId,
        _invoice_no: input.invoice_no,
      });
      if (error) throw error;
      return data?.length ? data : { found: false };
    }
    case "customer_balance": {
      const { data, error } = await admin.rpc("agent_customer_balance", {
        _tenant_id: tenantId,
        _query: input.query,
      });
      if (error) throw error;
      return data?.length ? data : { found: false };
    }
    case "supplier_balance": {
      const { data, error } = await admin.rpc("agent_supplier_balance", {
        _tenant_id: tenantId,
        _query: input.query,
      });
      if (error) throw error;
      return data?.length ? data : { found: false };
    }
    default:
      return { error: `Unknown tool ${name}` };
  }
}

/** Runs the support system prompt with tool access, looping on tool_use
 *  turns until Claude produces a final text reply (or the safety cap). */
async function runSupportAgent(
  admin: ReturnType<typeof createClient>,
  anthropicApiKey: string,
  tenantId: string,
  shopName: string,
  shopCode: string,
  history: { role: string; content: string }[],
  userMessage: string,
): Promise<string> {
  const messages: Record<string, unknown>[] = [
    ...history.map((m) => ({ role: m.role, content: m.content })),
    { role: "user", content: userMessage },
  ];
  const system = supportSystemPrompt(shopName, shopCode);

  for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
    const response = await callClaude(anthropicApiKey, system, messages, SUPPORT_TOOLS);
    if (response.stop_reason !== "tool_use") {
      return extractText(response.content) || "Sorry, can you say that again?";
    }
    messages.push({ role: "assistant", content: response.content });
    const toolResults: Record<string, unknown>[] = [];
    for (const block of response.content as Array<{ type: string; id: string; name: string; input: Record<string, unknown> }>) {
      if (block.type !== "tool_use") continue;
      let result: unknown;
      try {
        result = await runSupportTool(admin, tenantId, block.name, block.input);
      } catch (err) {
        result = { error: String((err as Error)?.message ?? err) };
      }
      toolResults.push({ type: "tool_result", tool_use_id: block.id, content: JSON.stringify(result) });
    }
    messages.push({ role: "user", content: toolResults });
  }
  return "I looked into a few things but need a moment to finish - our team will follow up on this chat.";
}

async function notifyOwner(phoneNumberId: string, accessToken: string, shopName: string, shopCode: string, waId: string, diagnosisSummary: string): Promise<void> {
  const body = `Shop support report\nShop: ${shopName} (${shopCode})\nFrom: +${waId}\n\n${diagnosisSummary}\n\nShop confirmed this is the issue - review and action if needed.`;
  await sendWhatsAppReply(phoneNumberId, accessToken, OWNER_WA_ID, body);
}

async function sendWhatsAppReply(phoneNumberId: string, accessToken: string, to: string, body: string): Promise<void> {
  const res = await fetch(`https://graph.facebook.com/${META_GRAPH_VERSION}/${phoneNumberId}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", to, type: "text", text: { body } }),
  });
  if (!res.ok) throw new Error(`WhatsApp send error ${res.status}: ${await res.text()}`);
}

/** A short, deliberately narrow yes/no read on the shop's reply while a
 *  diagnosis is pending confirmation - anything that isn't a clear
 *  affirmative goes back into another round of the support agent instead
 *  of being treated as a confirmation. */
function looksLikeConfirmation(text: string): boolean {
  const t = text.trim().toLowerCase();
  return /^(yes|yeah|yep|haan|han|ji|jee|jee\s*han|correct|right|thats it|that's it|sahi|theek|ok|okay)\b/.test(t);
}

Deno.serve(async (req) => {
  const url = new URL(req.url);

  if (req.method === "GET") {
    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { data } = await admin.rpc("get_whatsapp_agent_secrets").single();
    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");
    if (mode === "subscribe" && token && data?.whatsapp_verify_token && token === data.whatsapp_verify_token) {
      return new Response(challenge ?? "", { status: 200 });
    }
    return new Response("Forbidden", { status: 403 });
  }

  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const rawBody = await req.text();

  try {
    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { data: secrets } = await admin.rpc("get_whatsapp_agent_secrets").single();
    if (!secrets?.whatsapp_access_token || !secrets?.whatsapp_phone_number_id || !secrets?.whatsapp_app_secret || !secrets?.anthropic_api_key) {
      console.log("whatsapp-agent: secrets not fully configured yet, ignoring webhook");
      return new Response("OK", { status: 200 });
    }

    const signatureOk = await verifySignature(rawBody, req.headers.get("x-hub-signature-256"), secrets.whatsapp_app_secret);
    if (!signatureOk) {
      console.warn("whatsapp-agent: rejected webhook with invalid signature");
      return new Response("Forbidden", { status: 403 });
    }

    const payload = JSON.parse(rawBody);
    const message = payload?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    // Meta also posts delivery/read "statuses" updates on this same webhook
    // (no `messages` array) - nothing to reply to, just acknowledge.
    if (!message || message.type !== "text") {
      return new Response("OK", { status: 200 });
    }

    const waId: string = message.from;
    const userText: string = message.text.body;

    const { data: historyRows } = await admin
      .from("whatsapp_agent_messages")
      .select("role, content")
      .eq("wa_id", waId)
      .order("created_at", { ascending: false })
      .limit(HISTORY_LIMIT);
    const history = (historyRows ?? []).reverse();

    const { data: state } = await admin
      .from("whatsapp_agent_state")
      .select("*")
      .eq("wa_id", waId)
      .maybeSingle();

    let reply: string;
    let resolvedTenantId: string | null = state?.tenant_id ?? null;
    let nextStage = state?.stage ?? "idle";
    let nextDiagnosis = state?.diagnosis_summary ?? null;
    let nextCandidates: unknown = null;

    if (state?.stage === "awaiting_shop_disambiguation" && Array.isArray(state?.pending_candidates)) {
      const candidates = state.pending_candidates as Array<{ tenant_id: string; shop_name: string; shop_code: string }>;
      const t = userText.trim().toLowerCase();
      const picked = candidates.find(
        (c) => c.shop_code.toLowerCase() === t || c.shop_name.toLowerCase().includes(t) || t.includes(c.shop_name.toLowerCase()),
      );
      if (picked) {
        reply = `Got it — ${picked.shop_name} (${picked.shop_code}). What's the issue?`;
        resolvedTenantId = picked.tenant_id;
        nextStage = "idle";
      } else {
        const names = candidates.map((c) => `${c.shop_name} (${c.shop_code})`).join(", ");
        reply = `Sorry, didn't catch which one — please reply with the shop name or code: ${names}.`;
        nextStage = "awaiting_shop_disambiguation";
        nextCandidates = candidates;
      }
    } else if (state?.stage === "awaiting_shop_confirmation" && resolvedTenantId) {
      if (looksLikeConfirmation(userText)) {
        const { data: tenantRow } = await admin
          .from("tenants")
          .select("name, shop_code")
          .eq("id", resolvedTenantId)
          .maybeSingle();
        await notifyOwner(
          secrets.whatsapp_phone_number_id,
          secrets.whatsapp_access_token,
          tenantRow?.name ?? "Unknown shop",
          tenantRow?.shop_code ?? "?",
          waId,
          state?.diagnosis_summary ?? userText,
        );
        reply = "Thanks, that's been sent to the Tillix team - someone will follow up on this chat.";
        nextStage = "reported_to_owner";
        nextDiagnosis = null;
      } else {
        // Not a confirmation — take it as more detail and keep investigating.
        const { data: tenantRow } = await admin
          .from("tenants")
          .select("name, shop_code")
          .eq("id", resolvedTenantId)
          .maybeSingle();
        reply = await runSupportAgent(
          admin,
          secrets.anthropic_api_key,
          resolvedTenantId,
          tenantRow?.name ?? "your shop",
          tenantRow?.shop_code ?? "?",
          history,
          userText,
        );
        nextStage = "awaiting_shop_confirmation";
        nextDiagnosis = reply;
      }
    } else if (resolvedTenantId) {
      const { data: tenantRow } = await admin
        .from("tenants")
        .select("name, shop_code")
        .eq("id", resolvedTenantId)
        .maybeSingle();
      reply = await runSupportAgent(
        admin,
        secrets.anthropic_api_key,
        resolvedTenantId,
        tenantRow?.name ?? "your shop",
        tenantRow?.shop_code ?? "?",
        history,
        userText,
      );
      nextStage = "awaiting_shop_confirmation";
      nextDiagnosis = reply;
    } else {
      // No tenant resolved yet on this conversation — try the phone match now.
      const { data: matches } = await admin.rpc("agent_find_tenant_by_phone", { _wa_id: waId });
      if (matches && matches.length === 1) {
        resolvedTenantId = matches[0].tenant_id;
        reply = await runSupportAgent(
          admin,
          secrets.anthropic_api_key,
          resolvedTenantId!,
          matches[0].shop_name,
          matches[0].shop_code,
          history,
          userText,
        );
        nextStage = "awaiting_shop_confirmation";
        nextDiagnosis = reply;
      } else if (matches && matches.length > 1) {
        const names = matches.map((m: { shop_name: string; shop_code: string }) => `${m.shop_name} (${m.shop_code})`).join(", ");
        reply = `Your number is registered to more than one shop: ${names}. Which one is this about?`;
        nextStage = "awaiting_shop_disambiguation";
        nextCandidates = matches;
      } else {
        reply = await (async () => {
          const response = await callClaude(secrets.anthropic_api_key, SALES_SYSTEM_PROMPT, [
            ...history.map((m) => ({ role: m.role, content: m.content })),
            { role: "user", content: userText },
          ]);
          return extractText(response.content) || "Sorry, can you say that again?";
        })();
        nextStage = "idle";
      }
    }

    await admin.from("whatsapp_agent_messages").insert([
      { wa_id: waId, role: "user", content: userText, tenant_id: resolvedTenantId },
      { wa_id: waId, role: "assistant", content: reply, tenant_id: resolvedTenantId },
    ]);

    await admin.from("whatsapp_agent_state").upsert({
      wa_id: waId,
      tenant_id: resolvedTenantId,
      stage: nextStage,
      diagnosis_summary: nextDiagnosis,
      pending_candidates: nextCandidates,
      updated_at: new Date().toISOString(),
    });

    await sendWhatsAppReply(secrets.whatsapp_phone_number_id, secrets.whatsapp_access_token, waId, reply);

    return new Response("OK", { status: 200 });
  } catch (err) {
    // Always 200 back to Meta - a failed reply must never trigger Meta's
    // webhook-retry storm on top of an already-failed attempt.
    console.error("whatsapp-agent error:", err);
    return new Response("OK", { status: 200 });
  }
});
