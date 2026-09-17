import { createFileRoute } from "@tanstack/react-router";
import { LegalPageLayout, LegalH2, LegalP, LegalUl } from "@/components/legal-page-layout";

const SITE_URL = "https://tillix.co";
const LAST_UPDATED = "17 September 2026";

export const Route = createFileRoute("/privacy-policy")({
  head: () => ({
    meta: [
      { title: "Privacy Policy | Tillix" },
      { name: "description", content: "How Tillix collects, uses, and protects your data." },
      { name: "robots", content: "noindex" },
      { property: "og:title", content: "Privacy Policy | Tillix" },
      { property: "og:url", content: `${SITE_URL}/privacy-policy` },
    ],
    links: [{ rel: "canonical", href: `${SITE_URL}/privacy-policy` }],
  }),
  component: PrivacyPolicyPage,
});

function PrivacyPolicyPage() {
  return (
    <LegalPageLayout title="Privacy Policy" updated={LAST_UPDATED}>
      <LegalP>
        This Privacy Policy explains how Tillix ("Tillix", "we", "us", or "our") collects, uses, and protects
        information when you use the Tillix point-of-sale and retail management platform at tillix.co and its
        related mobile/desktop apps (together, the "Service"). By using the Service, you agree to the practices
        described here.
      </LegalP>

      <LegalH2>1. Two kinds of data, two roles</LegalH2>
      <LegalP>
        Tillix is built for shops, and shops enter data about their own business, staff, customers, and
        suppliers. It's important to understand the two different roles this creates:
      </LegalP>
      <LegalUl>
        <li>
          <strong>Your account &amp; subscription data</strong> — your own name, email, shop name, and billing
          status. For this data, Tillix is the <strong>data controller</strong>: we decide how it's used, as
          described in this policy.
        </li>
        <li>
          <strong>Business data you enter</strong> — your products, customers, suppliers, staff, sales,
          purchases, and ledgers. This is entered by you and belongs to your business. For this data, your shop
          is the <strong>data controller</strong> and Tillix acts only as a <strong>data processor</strong>,
          storing and processing it on your instructions so the Service works. If your customers or suppliers
          are individuals, you are responsible for having a lawful basis to hold their information (e.g. their
          consent, or a legitimate business relationship) — the same as if you kept this in a paper ledger.
        </li>
      </LegalUl>

      <LegalH2>2. What we collect</LegalH2>
      <LegalUl>
        <li><strong>Account information:</strong> name, email address, and password. Your password is hashed by our authentication provider (Supabase Auth) — Tillix never stores or sees it in plain text.</li>
        <li><strong>Shop/business information:</strong> shop name, business type, address, phone number, and currency/locale preferences.</li>
        <li><strong>Business records you enter:</strong> product catalog, customer and supplier records (name, phone, address, balances), staff accounts, sales, purchases, returns, expenses, and payment records.</li>
        <li><strong>Offline data:</strong> to keep billing working without internet, the Service keeps a local copy of your recent business data on your device (in your browser's local storage) and syncs it once you're back online.</li>
        <li><strong>Usage &amp; device data:</strong> pages visited, general browser/device information, and approximate location (via IP), collected through Google Analytics.</li>
        <li><strong>Support communications:</strong> if you message Tillix's WhatsApp number for help, we receive that message and your WhatsApp number so we can identify your shop and respond. See Section 4 for how an AI assistant is involved in this.</li>
        <li><strong>Purchase bill images:</strong> if you use the AI bill-scanning feature, the photo/PDF of a supplier invoice you upload is sent to Google's Gemini API to extract the data — the image itself is not permanently stored by Tillix beyond what's needed to process that one scan.</li>
      </LegalUl>

      <LegalH2>3. How we use this data</LegalH2>
      <LegalUl>
        <li>To operate the Service — billing, inventory, ledgers, reports, and everything else the app does.</li>
        <li>To keep your shop's data isolated from every other shop on Tillix (enforced at the database level, not just in the app).</li>
        <li>To provide customer support, including via WhatsApp.</li>
        <li>To send you service-related emails (e.g. signup confirmation, password reset).</li>
        <li>To understand how the Service is used, so we can improve it (via aggregated analytics).</li>
        <li>To detect and prevent abuse, fraud, or violations of our Terms of Use.</li>
      </LegalUl>
      <LegalP>We do not sell your data or your customers' data to anyone.</LegalP>

      <LegalH2>4. AI features</LegalH2>
      <LegalP>
        Tillix uses third-party AI models for two features, and only sends them what each feature needs:
      </LegalP>
      <LegalUl>
        <li><strong>Purchase bill scanner</strong> — sends a photo/PDF of a supplier bill to Google's Gemini API to extract line items, so you don't have to type them in manually.</li>
        <li><strong>WhatsApp support/sales assistant</strong> — uses Anthropic's Claude to answer questions sent to Tillix's own WhatsApp number. If the message comes from a phone number registered to a shop on Tillix, the assistant may look up that shop's own sales/purchase/ledger records (read-only) to help diagnose a support question — it never changes your data on its own; any real fix still goes through Tillix's team.</li>
      </LegalUl>

      <LegalH2>5. Who we share data with</LegalH2>
      <LegalP>We use the following service providers ("subprocessors") to run Tillix. Each only receives what it needs to perform its function:</LegalP>
      <LegalUl>
        <li><strong>Supabase</strong> — database, authentication, and file storage.</li>
        <li><strong>Vercel</strong> — hosting for the Tillix web app.</li>
        <li><strong>Google</strong> — Analytics (usage data) and the Gemini API (purchase-bill scanning).</li>
        <li><strong>Anthropic</strong> — Claude, for the WhatsApp support assistant.</li>
        <li><strong>Meta / WhatsApp Business Platform</strong> — for sending and receiving WhatsApp messages with Tillix's support number.</li>
      </LegalUl>
      <LegalP>
        We do not share your business data with other Tillix shops, or with any third party for their own
        marketing purposes.
      </LegalP>

      <LegalH2>6. Data security</LegalH2>
      <LegalUl>
        <li>Every shop's data is isolated using database-level row-level security — one shop's account can never query another shop's data, even if the app had a bug.</li>
        <li>All traffic between your browser/device and our servers is encrypted (HTTPS/TLS).</li>
        <li>Passwords are hashed, never stored or logged in plain text.</li>
      </LegalUl>
      <LegalP>No system is 100% secure, but we design and review Tillix with this as a priority.</LegalP>

      <LegalH2>7. Data retention</LegalH2>
      <LegalP>
        We keep your account and business data for as long as your account is active. If you close your
        account, we'll delete your data within a reasonable period, except where we're required to keep
        certain records for legal or accounting reasons.
      </LegalP>

      <LegalH2>8. Your rights</LegalH2>
      <LegalP>
        You can ask us to access, correct, export, or delete your account data at any time by emailing{" "}
        <a href="mailto:info@tillix.co">info@tillix.co</a>. If a request is about data your shop entered about
        one of its own customers, please handle that directly in the app (Customers/Suppliers screens) — your
        shop controls that data.
      </LegalP>

      <LegalH2>9. Cookies &amp; analytics</LegalH2>
      <LegalP>
        We use Google Analytics to understand how the Service is used. You can opt out of Google Analytics
        tracking using a browser extension like Google's own "Analytics Opt-out Browser Add-on", or by using
        your browser's "Do Not Track"/tracking-protection settings.
      </LegalP>

      <LegalH2>10. Children's privacy</LegalH2>
      <LegalP>
        Tillix is a business tool and is not directed at, or intended for use by, children. We don't knowingly
        collect personal information from children.
      </LegalP>

      <LegalH2>11. International data transfers</LegalH2>
      <LegalP>
        Tillix serves shops in Pakistan, the UAE, Saudi Arabia, the USA, the UK, the EU, Australia, New
        Zealand, and elsewhere. Your data may be processed on servers located outside your own country by the
        subprocessors listed in Section 5.
      </LegalP>

      <LegalH2>12. Changes to this policy</LegalH2>
      <LegalP>
        We may update this Privacy Policy from time to time. If we make a material change, we'll update the
        "Last updated" date above and, where appropriate, notify you in the app.
      </LegalP>

      <LegalH2>13. Contact us</LegalH2>
      <LegalP>
        Questions about this policy or your data? Email <a href="mailto:info@tillix.co">info@tillix.co</a> or
        message us on WhatsApp at{" "}
        <a href="https://wa.me/923096431377" target="_blank" rel="noopener noreferrer">+92 309 6431377</a>.
      </LegalP>
    </LegalPageLayout>
  );
}
