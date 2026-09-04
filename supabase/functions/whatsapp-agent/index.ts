// WhatsApp support/sales agent for Tillix's own number (+923096431377).
// Receives Meta WhatsApp Cloud API webhooks, asks Claude for a reply using
// a system prompt grounded in Tillix's real landing-page pricing/features,
// and sends the reply back. All credentials come from Vault via
// get_whatsapp_agent_secrets() (service-role only) - nothing here is a
// secret itself.
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

const SYSTEM_PROMPT = `You are the WhatsApp assistant for Tillix (tillix.co), a cloud-based POS
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

STYLE
Reply the way a helpful shop-owner-facing support person would text on
WhatsApp: short, warm, plain sentences, no markdown formatting, no long
lists unless they ask for a plan comparison. Match the customer's language
- if they write in Roman Urdu or Urdu, reply the same way; if English,
reply in English. Never invent a price, feature, or policy not listed
above.`;

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

async function askClaude(anthropicApiKey: string, history: { role: string; content: string }[], userMessage: string): Promise<string> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": anthropicApiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: 400,
      system: SYSTEM_PROMPT,
      messages: [...history.map((m) => ({ role: m.role, content: m.content })), { role: "user", content: userMessage }],
    }),
  });
  if (!res.ok) throw new Error(`Anthropic API error ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const text = data?.content?.find((b: { type: string }) => b.type === "text")?.text;
  if (!text) throw new Error("Anthropic response had no text block");
  return text;
}

async function sendWhatsAppReply(phoneNumberId: string, accessToken: string, to: string, body: string): Promise<void> {
  const res = await fetch(`https://graph.facebook.com/${META_GRAPH_VERSION}/${phoneNumberId}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", to, type: "text", text: { body } }),
  });
  if (!res.ok) throw new Error(`WhatsApp send error ${res.status}: ${await res.text()}`);
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

    const reply = await askClaude(secrets.anthropic_api_key, history, userText);

    await admin.from("whatsapp_agent_messages").insert([
      { wa_id: waId, role: "user", content: userText },
      { wa_id: waId, role: "assistant", content: reply },
    ]);

    await sendWhatsAppReply(secrets.whatsapp_phone_number_id, secrets.whatsapp_access_token, waId, reply);

    return new Response("OK", { status: 200 });
  } catch (err) {
    // Always 200 back to Meta - a failed reply must never trigger Meta's
    // webhook-retry storm on top of an already-failed attempt.
    console.error("whatsapp-agent error:", err);
    return new Response("OK", { status: 200 });
  }
});
