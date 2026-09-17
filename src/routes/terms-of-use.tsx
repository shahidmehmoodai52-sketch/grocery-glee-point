import { createFileRoute } from "@tanstack/react-router";
import { LegalPageLayout, LegalH2, LegalP, LegalUl } from "@/components/legal-page-layout";

const SITE_URL = "https://tillix.co";
const LAST_UPDATED = "17 September 2026";

export const Route = createFileRoute("/terms-of-use")({
  head: () => ({
    meta: [
      { title: "Terms of Use | Tillix" },
      { name: "description", content: "The terms that govern your use of Tillix." },
      { name: "robots", content: "noindex" },
      { property: "og:title", content: "Terms of Use | Tillix" },
      { property: "og:url", content: `${SITE_URL}/terms-of-use` },
    ],
    links: [{ rel: "canonical", href: `${SITE_URL}/terms-of-use` }],
  }),
  component: TermsOfUsePage,
});

function TermsOfUsePage() {
  return (
    <LegalPageLayout title="Terms of Use" updated={LAST_UPDATED}>
      <LegalP>
        These Terms of Use ("Terms") govern your access to and use of Tillix, a cloud point-of-sale and retail
        management platform at tillix.co and its related apps (the "Service"), operated by Tillix ("we", "us",
        "our"). By creating an account or using the Service, you agree to these Terms.
      </LegalP>

      <LegalH2>1. Who can use Tillix</LegalH2>
      <LegalP>
        You must be at least 18 years old and able to form a binding contract to create an account. You're
        responsible for keeping your login credentials confidential and for all activity under your account,
        including actions taken by staff accounts your shop creates.
      </LegalP>

      <LegalH2>2. The Service</LegalH2>
      <LegalP>
        Tillix provides billing/POS, inventory, customer and supplier ledgers, purchases, reports, and related
        retail-management tools, available online with limited offline functionality. We may add, change, or
        remove features over time.
      </LegalP>

      <LegalH2>3. Your data &amp; your responsibility</LegalH2>
      <LegalUl>
        <li>You're responsible for the accuracy of the data you enter into Tillix — product prices, stock counts, ledgers, and everything else.</li>
        <li>If you enter personal information about your own customers, suppliers, or staff, you confirm you have the right to do so (e.g. their consent, or a legitimate business relationship) and that you'll handle it in compliance with applicable law in your country.</li>
        <li>You're responsible for reviewing anything an AI feature (the bill scanner or the WhatsApp assistant) produces before relying on it — see Section 6.</li>
      </LegalUl>

      <LegalH2>4. Subscription &amp; billing</LegalH2>
      <LegalP>
        Tillix may be offered with a free trial period, after which continued use requires an active paid
        subscription. Fees, billing cycles, and payment methods are shown in the app or communicated to you
        directly. Unless stated otherwise, fees are non-refundable once a billing period has started. You can
        cancel your subscription at any time; cancellation takes effect at the end of the current billing
        period.
      </LegalP>

      <LegalH2>5. Acceptable use</LegalH2>
      <LegalP>You agree not to:</LegalP>
      <LegalUl>
        <li>Use the Service for anything illegal, or to store/process data you don't have the right to hold.</li>
        <li>Try to access another shop's data, or attempt to bypass the Service's security or tenant isolation.</li>
        <li>Resell, sublicense, or provide access to the Service to anyone outside your own business without our written permission.</li>
        <li>Reverse-engineer, scrape, or overload the Service in a way that could disrupt it for other users.</li>
      </LegalUl>

      <LegalH2>6. AI features are assistive, not final</LegalH2>
      <LegalUl>
        <li>The AI purchase-bill scanner reads a supplier bill and pre-fills a purchase entry for you to review — always check the extracted items, quantities, and rates before saving; misreads are possible, especially on unclear photos.</li>
        <li>The WhatsApp support/sales assistant provides informational answers and, for registered shops, may look up your own records to help investigate a support question. It does not make financial changes to your account on its own — any actual correction to your data goes through Tillix's team after you confirm the issue.</li>
      </LegalUl>

      <LegalH2>7. Offline mode</LegalH2>
      <LegalP>
        Tillix can keep working without an internet connection so you can keep billing during an outage.
        Data entered while offline is stored on that device until it syncs once you're back online. If that
        device is lost, damaged, or its local storage is cleared before syncing, unsynced data can be lost —
        sync as soon as possible after coming back online.
      </LegalP>

      <LegalH2>8. Availability &amp; disclaimer</LegalH2>
      <LegalP>
        We work to keep Tillix available and reliable, but the Service is provided "as is" and "as available",
        without warranties of any kind, express or implied. We don't guarantee the Service will be
        uninterrupted, error-free, or available at all times.
      </LegalP>

      <LegalH2>9. Limitation of liability</LegalH2>
      <LegalP>
        To the maximum extent permitted by law, Tillix will not be liable for any indirect, incidental, or
        consequential damages (including lost profits or lost data) arising from your use of the Service. Our
        total liability for any claim relating to the Service is limited to the amount you paid us for the
        Service in the 3 months before the claim arose.
      </LegalP>

      <LegalH2>10. Termination</LegalH2>
      <LegalP>
        You may stop using the Service and close your account at any time. We may suspend or terminate your
        access if you violate these Terms, don't pay applicable fees, or if we discontinue the Service, with
        notice where reasonably possible.
      </LegalP>

      <LegalH2>11. Changes to these Terms</LegalH2>
      <LegalP>
        We may update these Terms from time to time. If we make a material change, we'll update the "Last
        updated" date above and, where appropriate, notify you in the app. Continued use after a change means
        you accept the updated Terms.
      </LegalP>

      <LegalH2>12. Governing law</LegalH2>
      <LegalP>
        These Terms are governed by the laws of Pakistan, without regard to conflict-of-law principles,
        regardless of where you access the Service from.
      </LegalP>

      <LegalH2>13. Contact us</LegalH2>
      <LegalP>
        Questions about these Terms? Email <a href="mailto:info@tillix.co">info@tillix.co</a> or message us on
        WhatsApp at{" "}
        <a href="https://wa.me/923096431377" target="_blank" rel="noopener noreferrer">+92 309 6431377</a>.
      </LegalP>
    </LegalPageLayout>
  );
}
