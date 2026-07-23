import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  ShoppingCart, Barcode, Boxes, Users, TrendingUp, Store, Cloud, Shield,
  Smartphone, Zap, Globe2, ReceiptText, PackageSearch, Landmark, Truck,
  Pill, UtensilsCrossed, ShoppingBasket, Building2, Check, ChevronDown, Menu, X,
  PlayCircle, Sparkles,
} from "lucide-react";

/* ---------- IP-based currency localization ---------- */
type CurrencyInfo = { code: string; symbol: string; rate: number; decimals?: number };
const CURRENCIES: Record<string, CurrencyInfo> = {
  USD: { code: "USD", symbol: "$", rate: 1 },
  EUR: { code: "EUR", symbol: "€", rate: 0.92 },
  GBP: { code: "GBP", symbol: "£", rate: 0.79 },
  PKR: { code: "PKR", symbol: "₨", rate: 278, decimals: 0 },
  INR: { code: "INR", symbol: "₹", rate: 83, decimals: 0 },
  AED: { code: "AED", symbol: "د.إ ", rate: 3.67, decimals: 0 },
  SAR: { code: "SAR", symbol: "﷼", rate: 3.75, decimals: 0 },
  QAR: { code: "QAR", symbol: "﷼", rate: 3.64, decimals: 0 },
  KWD: { code: "KWD", symbol: "د.ك ", rate: 0.31 },
  OMR: { code: "OMR", symbol: "﷼", rate: 0.38 },
  BHD: { code: "BHD", symbol: ".د.ب ", rate: 0.38 },
  AUD: { code: "AUD", symbol: "A$", rate: 1.52 },
  CAD: { code: "CAD", symbol: "C$", rate: 1.36 },
  TRY: { code: "TRY", symbol: "₺", rate: 34, decimals: 0 },
  ZAR: { code: "ZAR", symbol: "R", rate: 18, decimals: 0 },
};
const EU_COUNTRIES = new Set(["AT","BE","BG","HR","CY","CZ","DK","EE","FI","FR","DE","GR","HU","IE","IT","LV","LT","LU","MT","NL","PL","PT","RO","SK","SI","ES","SE"]);
const COUNTRY_TO_CURRENCY: Record<string, string> = {
  PK: "PKR", IN: "INR", AE: "AED", SA: "SAR", QA: "QAR", KW: "KWD", OM: "OMR", BH: "BHD",
  GB: "GBP", US: "USD", AU: "AUD", NZ: "AUD", CA: "CAD", TR: "TRY", ZA: "ZAR",
};

function pickCurrency(country: string | null | undefined, currency?: string | null): CurrencyInfo {
  if (currency && CURRENCIES[currency]) return CURRENCIES[currency];
  const c = (country || "").toUpperCase();
  if (COUNTRY_TO_CURRENCY[c]) return CURRENCIES[COUNTRY_TO_CURRENCY[c]];
  if (EU_COUNTRIES.has(c)) return CURRENCIES.EUR;
  return CURRENCIES.USD;
}

async function detectCountry(): Promise<{ country?: string; currency?: string } | null> {
  const providers: Array<() => Promise<{ country?: string; currency?: string } | null>> = [
    async () => {
      const r = await fetch("https://ipapi.co/json/");
      if (!r.ok) return null;
      const d = await r.json();
      return { country: d.country_code || d.country, currency: d.currency };
    },
    async () => {
      const r = await fetch("https://ipwho.is/");
      if (!r.ok) return null;
      const d = await r.json();
      return { country: d.country_code, currency: d.currency?.code };
    },
    async () => {
      const r = await fetch("https://get.geojs.io/v1/ip/country.json");
      if (!r.ok) return null;
      const d = await r.json();
      return { country: d.country };
    },
    async () => {
      const r = await fetch("https://api.country.is/");
      if (!r.ok) return null;
      const d = await r.json();
      return { country: d.country };
    },
  ];
  for (const p of providers) {
    try {
      const res = await p();
      if (res && (res.country || res.currency)) return res;
    } catch { /* try next */ }
  }
  return null;
}

function useLocalCurrency(): CurrencyInfo {
  const [cur, setCur] = useState<CurrencyInfo>(CURRENCIES.USD);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Cache to avoid repeat fetches
      try {
        const cached = localStorage.getItem("tx_geo_cur_v2");
        if (cached) {
          const parsed = JSON.parse(cached) as { code: string; t: number };
          if (Date.now() - parsed.t < 24 * 60 * 60 * 1000 && CURRENCIES[parsed.code]) {
            setCur(CURRENCIES[parsed.code]);
            return;
          }
        }
      } catch { /* ignore */ }
      const geo = await detectCountry();
      if (cancelled) return;
      const picked = pickCurrency(geo?.country, geo?.currency);
      setCur(picked);
      try { localStorage.setItem("tx_geo_cur_v2", JSON.stringify({ code: picked.code, t: Date.now() })); } catch { /* ignore */ }
    })();
    return () => { cancelled = true; };
  }, []);
  return cur;
}

function formatPrice(usd: number, cur: CurrencyInfo) {
  const val = usd * cur.rate;
  if (cur.decimals === 0) {
    const rounded = Math.round(val / 10) * 10; // psychological rounding for large-value currencies
    return `${cur.symbol}${rounded.toLocaleString()}`;
  }
  return `${cur.symbol}${val.toFixed(2)}`;
}

// Authentic brand-colored social icons (official SVG marks)
const BrandFacebook = ({ className = "" }: { className?: string }) => (
  <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
    <path fill="#1877F2" d="M24 12a12 12 0 1 0-13.875 11.854v-8.385H7.078V12h3.047V9.356c0-3.007 1.792-4.668 4.533-4.668 1.313 0 2.686.234 2.686.234v2.953H15.83c-1.491 0-1.956.925-1.956 1.874V12h3.328l-.532 3.469h-2.796v8.385A12.003 12.003 0 0 0 24 12Z"/>
  </svg>
);
const BrandInstagram = ({ className = "" }: { className?: string }) => (
  <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
    <defs>
      <radialGradient id="ig-g" cx="30%" cy="107%" r="150%">
        <stop offset="0%" stopColor="#fdf497"/>
        <stop offset="5%" stopColor="#fdf497"/>
        <stop offset="45%" stopColor="#fd5949"/>
        <stop offset="60%" stopColor="#d6249f"/>
        <stop offset="90%" stopColor="#285AEB"/>
      </radialGradient>
    </defs>
    <rect x="2" y="2" width="20" height="20" rx="5" fill="url(#ig-g)"/>
    <path fill="none" stroke="#fff" strokeWidth="1.8" d="M12 7.6a4.4 4.4 0 1 0 0 8.8 4.4 4.4 0 0 0 0-8.8Z"/>
    <circle cx="17.4" cy="6.6" r="1.1" fill="#fff"/>
  </svg>
);
const BrandLinkedin = ({ className = "" }: { className?: string }) => (
  <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
    <rect width="24" height="24" rx="4" fill="#0A66C2"/>
    <path fill="#fff" d="M7.1 9.5H4.5V19h2.6V9.5ZM5.8 8.4a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3ZM19.5 19h-2.6v-4.6c0-1.1 0-2.5-1.6-2.5-1.6 0-1.8 1.2-1.8 2.4V19h-2.6V9.5h2.5v1.3h.03a2.7 2.7 0 0 1 2.5-1.4c2.6 0 3.1 1.7 3.1 4V19Z"/>
  </svg>
);
const BrandYoutube = ({ className = "" }: { className?: string }) => (
  <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
    <path fill="#FF0000" d="M23.5 6.5a3 3 0 0 0-2.1-2.1C19.5 3.9 12 3.9 12 3.9s-7.5 0-9.4.5A3 3 0 0 0 .5 6.5C0 8.4 0 12 0 12s0 3.6.5 5.5a3 3 0 0 0 2.1 2.1c1.9.5 9.4.5 9.4.5s7.5 0 9.4-.5a3 3 0 0 0 2.1-2.1C24 15.6 24 12 24 12s0-3.6-.5-5.5Z"/>
    <path fill="#fff" d="M9.6 15.6 15.8 12 9.6 8.4v7.2Z"/>
  </svg>
);
const SITE_URL = "https://grocery-glee-point.lovable.app";
const LOGO_URL = "/tillix-logo.jpeg?v=2";
const OG_LOGO_URL = `${SITE_URL}${LOGO_URL}`;

const FAQS: { q: string; a: string }[] = [
  { q: "What is Tillix POS software?",
    a: "Tillix is a cloud-based Point of Sale and retail management system that handles billing, inventory, barcodes, customers, suppliers, purchases, staff and analytics — everything a modern shop needs, in one platform." },
  { q: "Which businesses is Tillix best for?",
    a: "Grocery stores, supermarkets, retail shops, pharmacies, restaurants, wholesalers and multi-store chains. Tillix scales from a single till to hundreds of outlets." },
  { q: "Does Tillix work offline?",
    a: "Yes. Tillix keeps selling even when the internet drops — sales, receipts and stock updates queue locally and sync automatically once you're back online." },
  { q: "Can Tillix scan barcodes and print receipts?",
    a: "Absolutely. Tillix supports USB and Bluetooth barcode scanners, thermal 58mm/80mm receipt printers, cash drawers and customer displays out of the box." },
  { q: "Is Tillix available in my country?",
    a: "Tillix is a cloud platform available worldwide — including the UAE, Saudi Arabia, Pakistan, the United States, the UK, the EU, Australia and New Zealand — with multi-currency, multi-tax and multi-language support." },
  { q: "Is my data secure with Tillix?",
    a: "Your data is encrypted in transit and at rest, backed up automatically, and protected by role-based permissions and audit logs. You own your data at all times." },
  { q: "Can I manage multiple stores with one account?",
    a: "Yes. Tillix is built for multi-store retail — centralize products, prices and stock across locations while each branch runs its own tills." },
  { q: "How much does Tillix cost?",
    a: "Tillix offers a free tier to get started and affordable monthly plans that grow with your business. No hidden fees, cancel anytime." },
];

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Tillix – Smart Retail Starts Here | Cloud POS & Retail Management Software" },
      { name: "description", content: "Tillix is a modern cloud POS for grocery, supermarkets, retail shops, pharmacies, restaurants, wholesalers and multi-store businesses. Billing, inventory, barcodes, loyalty, suppliers, purchases and real-time analytics in one platform." },
      { name: "keywords", content: "POS software, cloud POS, retail management software, grocery POS, supermarket POS, pharmacy POS, restaurant POS, wholesale POS, multi-store POS, inventory management, barcode billing, retail analytics, POS UAE, POS Saudi Arabia, POS Pakistan, POS USA, POS Australia" },
      { property: "og:title", content: "Tillix – Smart Retail Starts Here" },
      { property: "og:description", content: "Cloud POS and retail management for grocery, supermarkets, pharmacies, restaurants and multi-store businesses. Billing, inventory, loyalty and analytics — one platform." },
      { property: "og:url", content: `${SITE_URL}/` },
      { property: "og:type", content: "website" },
      { property: "og:image", content: `${OG_LOGO_URL}` },
      { name: "twitter:title", content: "Tillix – Smart Retail Starts Here" },
      { name: "twitter:description", content: "Cloud POS and retail management software for modern retailers." },
      { name: "twitter:image", content: `${OG_LOGO_URL}` },
    ],
    links: [{ rel: "canonical", href: `${SITE_URL}/` }],
    scripts: [
      {
        type: "application/ld+json",
        children: JSON.stringify({
          "@context": "https://schema.org",
          "@type": "SoftwareApplication",
          name: "Tillix",
          applicationCategory: "BusinessApplication",
          operatingSystem: "Web, Windows, Android, iOS",
          description:
            "Tillix is a cloud-based Point of Sale (POS) and retail management platform for grocery stores, supermarkets, retail shops, pharmacies, restaurants, wholesalers and multi-store businesses.",
          offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
          aggregateRating: { "@type": "AggregateRating", ratingValue: "4.9", ratingCount: "128" },
          url: SITE_URL,
          image: `${OG_LOGO_URL}`,
        }),
      },
      {
        type: "application/ld+json",
        children: JSON.stringify({
          "@context": "https://schema.org",
          "@type": "Organization",
          name: "Tillix",
          url: SITE_URL,
          logo: `${OG_LOGO_URL}`,
          slogan: "Smart Retail Starts Here",
          areaServed: ["AE","SA","PK","US","GB","EU","AU","NZ","Worldwide"],
        }),
      },
      {
        type: "application/ld+json",
        children: JSON.stringify({
          "@context": "https://schema.org",
          "@type": "FAQPage",
          mainEntity: FAQS.map(f => ({
            "@type": "Question",
            name: f.q,
            acceptedAnswer: { "@type": "Answer", text: f.a },
          })),
        }),
      },
    ],
  }),
  component: LandingPage,
});

/* ---------- Small UI atoms ---------- */

function BrandMark({ className = "h-9 w-auto" }: { className?: string }) {
  return (
    <img
      src={LOGO_URL}
      alt="Tillix logo — Smart Retail Starts Here"
      className={className}
      width={220}
      height={72}
      decoding="async"
      loading="eager"
    />
  );
}

function SectionTitle({ eyebrow, title, sub }: { eyebrow?: string; title: string; sub?: string }) {
  return (
    <div className="mx-auto max-w-2xl text-center">
      {eyebrow && (
        <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-tx-green/30 bg-tx-green/10 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-tx-green-dark">
          {eyebrow}
        </div>
      )}
      <h2 className="text-3xl font-extrabold tracking-tight text-tx-navy sm:text-4xl">
        {title}
      </h2>
      {sub && <p className="mt-4 text-base text-slate-600 sm:text-lg">{sub}</p>}
    </div>
  );
}

/* ---------- Page ---------- */

function LandingPage() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [openFaq, setOpenFaq] = useState<number | null>(0);
  const [billing, setBilling] = useState<"monthly" | "yearly">("monthly");
  const cur = useLocalCurrency();

  const plans = {
    basic: { monthly: 9.99, monthlyOrig: 19.99, yearly: 100, yearlyOrig: 199 },
    pro: { monthly: 14.99, monthlyOrig: 29.99, yearly: 150, yearlyOrig: 299 },
  };
  const basicPrice = billing === "monthly" ? plans.basic.monthly : plans.basic.yearly;
  const basicOrig = billing === "monthly" ? plans.basic.monthlyOrig : plans.basic.yearlyOrig;
  const proPrice = billing === "monthly" ? plans.pro.monthly : plans.pro.yearly;
  const proOrig = billing === "monthly" ? plans.pro.monthlyOrig : plans.pro.yearlyOrig;
  const perLabel = billing === "monthly" ? "/ month" : "/ year";

  const features = [
    { icon: ReceiptText, title: "Fast Billing & Receipts", text: "Ring up sales in seconds with a keyboard-first POS, thermal receipt printing and instant hold/resume." },
    { icon: Barcode, title: "Barcode Scanning", text: "Scan any barcode, generate your own labels, and print price tags for bulk items." },
    { icon: Boxes, title: "Smart Inventory", text: "Real-time stock, low-stock alerts, batch and expiry tracking, damages and wastage — always accurate." },
    { icon: Users, title: "Customers & Loyalty", text: "Customer accounts, khata/ledger, discounts and repeat-buyer rewards that grow your basket size." },
    { icon: Truck, title: "Suppliers & Purchases", text: "Track suppliers, purchase orders, returns and outstanding payables in one clean workflow." },
    { icon: TrendingUp, title: "Real-Time Analytics", text: "Live dashboards for sales, profit, best-sellers, cash flow and shift performance — from any device." },
    { icon: Shield, title: "Roles & Permissions", text: "Owner, manager and cashier roles with granular permissions and full audit logs." },
    { icon: Cloud, title: "Cloud + Offline", text: "Cloud-first with resilient offline mode — keep selling when the internet is down." },
    { icon: Building2, title: "Multi-Store Ready", text: "Manage one shop or a hundred. Central catalog, pricing, stock transfers and per-branch reports." },
  ];

  const industries = [
    { icon: ShoppingBasket, name: "Grocery Stores" },
    { icon: Store, name: "Supermarkets" },
    { icon: Pill, name: "Pharmacies" },
    { icon: UtensilsCrossed, name: "Restaurants & Cafes" },
    { icon: PackageSearch, name: "Retail Shops" },
    { icon: Landmark, name: "Wholesalers" },
    { icon: Building2, name: "Multi-Store Chains" },
    { icon: ShoppingCart, name: "Mini Marts" },
  ];

  const benefits = [
    "Automate day-to-day operations end to end",
    "Cut errors with barcode-driven billing",
    "Reduce stock loss with live inventory & alerts",
    "Understand profit, not just sales",
    "Onboard new cashiers in minutes",
    "Grow from 1 till to 100 without switching tools",
  ];

  const steps = [
    { n: "01", title: "Create your account", text: "Sign up in under a minute — no credit card required." },
    { n: "02", title: "Add products & staff", text: "Import your catalog by CSV or scan barcodes, then invite cashiers with the right permissions." },
    { n: "03", title: "Start selling smarter", text: "Ring up sales, track stock, reward customers and watch profits grow — from any device, anywhere." },
  ];

  const testimonials = [
    { quote: "Tillix cut our billing time in half and finally gave us real numbers on which products actually make money.", name: "Ahmed R.", role: "Supermarket owner, Dubai" },
    { quote: "We run three branches on Tillix. Central stock and one dashboard — it's a night-and-day upgrade from spreadsheets.", name: "Sara K.", role: "Retail chain manager, Karachi" },
    { quote: "Offline mode saved a whole weekend of sales during an outage. Everything synced perfectly when we came back online.", name: "Miguel A.", role: "Grocery owner, Madrid" },
  ];

  return (
    <div className="min-h-screen bg-white text-slate-800 antialiased" style={{ fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif" }}>
      {/* Local design tokens for the landing page (scoped to this page, no global overrides) */}
      <style>{`
        :root { --tx-navy: #0E1A2E; --tx-green: #22C55E; --tx-green-dark: #15803D; --tx-green-light: #DCFCE7; }
        .text-tx-navy { color: var(--tx-navy); }
        .bg-tx-navy { background-color: var(--tx-navy); }
        .text-tx-green { color: var(--tx-green); }
        .text-tx-green-dark { color: var(--tx-green-dark); }
        .bg-tx-green { background-color: var(--tx-green); }
        .bg-tx-green-light { background-color: var(--tx-green-light); }
        .border-tx-green\\/30 { border-color: rgb(34 197 94 / 0.3); }
        .bg-tx-green\\/10 { background-color: rgb(34 197 94 / 0.10); }
        .hero-grad { background: radial-gradient(1200px 500px at 85% -10%, rgba(34,197,94,0.18), transparent 60%), radial-gradient(900px 400px at -10% 10%, rgba(14,26,46,0.05), transparent 60%), linear-gradient(180deg,#ffffff, #f8fafc); }
      `}</style>

      {/* NAV */}
      <header className="sticky top-0 z-40 border-b border-slate-200/80 bg-white/85 backdrop-blur">
        <div className="mx-auto grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-4 py-3 sm:flex sm:max-w-7xl sm:justify-between sm:px-6 lg:px-8">
          <a href="#top" className="flex min-w-0 items-center gap-2">
            <BrandMark className="h-8 w-auto sm:h-9" />
            <span className="sr-only">Tillix</span>
          </a>
          <nav className="hidden items-center gap-8 md:flex">
            <a href="#features" className="text-sm font-medium text-slate-700 hover:text-tx-green-dark">Features</a>
            <a href="#industries" className="text-sm font-medium text-slate-700 hover:text-tx-green-dark">Industries</a>
            <a href="#how" className="text-sm font-medium text-slate-700 hover:text-tx-green-dark">How it works</a>
            <a href="#pricing" className="text-sm font-medium text-slate-700 hover:text-tx-green-dark">Pricing</a>
            <a href="#faq" className="text-sm font-medium text-slate-700 hover:text-tx-green-dark">FAQ</a>
          </nav>
          <div className="flex items-center gap-2">
            <Link
              to="/auth"
              className="hidden rounded-lg px-3 py-2 text-sm font-semibold text-tx-navy hover:bg-slate-100 sm:inline-flex"
            >
              Sign in
            </Link>
            <Link
              to="/auth"
              className="hidden items-center gap-1 rounded-lg border border-tx-green/30 bg-tx-green/10 px-3.5 py-2 text-sm font-semibold text-tx-green-dark transition hover:bg-tx-green/20 sm:inline-flex"
            >
              <Sparkles className="h-3.5 w-3.5" /> Start free trial
            </Link>
            <Link
              to="/auth"
              className="inline-flex items-center gap-1 rounded-lg bg-tx-green px-3.5 py-2 text-sm font-semibold text-white shadow-sm shadow-emerald-600/20 transition hover:bg-tx-green-dark sm:px-4"
            >
              Register free
            </Link>

            <button
              type="button"
              aria-label="Open menu"
              className="ml-1 inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 text-slate-700 md:hidden"
              onClick={() => setMenuOpen(v => !v)}
            >
              {menuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </button>
          </div>
        </div>
        {menuOpen && (
          <div className="border-t border-slate-200 bg-white md:hidden">
            <div className="mx-auto flex max-w-7xl flex-col px-4 py-2 sm:px-6">
              {[["Features","#features"],["Industries","#industries"],["How it works","#how"],["Pricing","#pricing"],["FAQ","#faq"]].map(([label, href]) => (
                <a key={href} href={href} onClick={() => setMenuOpen(false)} className="py-2 text-sm font-medium text-slate-700">
                  {label}
                </a>
              ))}
              <Link to="/auth" onClick={() => setMenuOpen(false)} className="py-2 text-sm font-semibold text-tx-navy">Sign in</Link>
              <Link to="/auth" onClick={() => setMenuOpen(false)} className="py-2 text-sm font-semibold text-tx-green-dark">Start 7-day free trial</Link>

            </div>
          </div>
        )}
      </header>

      <main id="main">
      {/* HERO */}

      <section id="top" className="hero-grad">
        <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 sm:py-24 lg:px-8">
          <div className="grid items-center gap-12 lg:grid-cols-2">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border border-tx-green/30 bg-tx-green/10 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-tx-green-dark">
                <Globe2 className="h-3.5 w-3.5" /> Trusted worldwide — UAE · SA · PK · US · EU · AU
              </div>
              <h1 className="mt-5 text-4xl font-extrabold leading-[1.05] tracking-tight text-tx-navy sm:text-5xl lg:text-6xl">
                Tillix — Smart Retail <span className="text-tx-green">Starts Here.</span>
              </h1>
              <p className="mt-3 text-lg font-semibold text-tx-navy/80 sm:text-xl">
                Cloud POS &amp; Retail Management Software
              </p>
              <p className="mt-4 max-w-xl text-base leading-relaxed text-slate-600 sm:text-lg">
                Tillix is a modern cloud POS and retail management platform for grocery stores,
                supermarkets, pharmacies, restaurants, wholesalers and multi-store chains.
                Billing, inventory, barcodes, customers, suppliers and real-time analytics —
                one secure, lightning-fast platform.
              </p>

              <div className="mt-8 flex flex-wrap items-center gap-3">
                <Link to="/auth" className="inline-flex items-center gap-2 rounded-xl bg-tx-green px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-emerald-600/20 transition hover:bg-tx-green-dark">
                  Register your shop free <Zap className="h-4 w-4" />
                </Link>
                <Link to="/auth" className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-5 py-3 text-sm font-semibold text-tx-navy transition hover:bg-slate-50">
                  Sign in
                </Link>
              </div>
              <ul className="mt-6 grid grid-cols-2 gap-2 text-sm text-slate-600 sm:max-w-md">
                {["Free to start","Works offline","Multi-store ready","Bank-grade security"].map(x => (
                  <li key={x} className="flex items-center gap-2"><Check className="h-4 w-4 text-tx-green" /> {x}</li>
                ))}
              </ul>
            </div>

            {/* Hero visual — fake POS card, keeps page light (no heavy image) */}
            <div className="relative">
              <div className="absolute -inset-6 -z-10 rounded-[2rem] bg-gradient-to-br from-emerald-100 via-white to-slate-100 blur-2xl" />
              <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-2xl shadow-slate-900/10 sm:p-6">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <BrandMark className="h-7 w-auto" />
                  </div>
                  <span className="rounded-full bg-tx-green-light px-2.5 py-1 text-[11px] font-semibold text-tx-green-dark">LIVE</span>
                </div>
                <div className="mt-4 grid grid-cols-3 gap-3">
                  {[
                    { l: "Today's Sales", v: formatPrice(4286, cur) },
                    { l: "Bills", v: "142" },
                    { l: "Profit", v: formatPrice(981, cur) },
                  ].map((k) => (
                    <div key={k.l} className="rounded-xl border border-slate-100 bg-slate-50 p-3">
                      <div className="text-[11px] font-medium uppercase tracking-wider text-slate-500">{k.l}</div>
                      <div className="mt-1 text-lg font-extrabold text-tx-navy">{k.v}</div>
                    </div>
                  ))}
                </div>
                <div className="mt-4 rounded-xl border border-slate-100">
                  {[
                    { n: "Basmati Rice 5kg", q: "×2", p: formatPrice(21.9, cur) },
                    { n: "Fresh Milk 1L", q: "×6", p: formatPrice(8.4, cur) },
                    { n: "Chocolate Bar", q: "×3", p: formatPrice(4.5, cur) },
                  ].map((r) => (
                    <div key={r.n} className="flex items-center justify-between border-b border-slate-100 px-3 py-2 text-sm last:border-b-0">
                      <span className="min-w-0 truncate text-slate-700">{r.n}</span>
                      <span className="mx-3 shrink-0 text-slate-400">{r.q}</span>
                      <span className="shrink-0 font-semibold text-tx-navy">{r.p}</span>
                    </div>
                  ))}
                </div>
                <div className="mt-4 flex items-center justify-between rounded-xl bg-tx-navy px-4 py-3 text-white">
                  <span className="text-sm font-medium opacity-80">Total due</span>
                  <span className="text-xl font-extrabold">{formatPrice(34.8, cur)}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* TRUST / INDUSTRIES STRIP */}
      <section id="industries" className="border-y border-slate-100 bg-slate-50/60">
        <div className="mx-auto max-w-7xl px-4 py-14 sm:px-6 lg:px-8">
          <SectionTitle
            eyebrow="Built for every retailer"
            title="One POS. Every kind of shop."
            sub="From a corner store to a nationwide chain — Tillix adapts to your business, not the other way around."
          />
          <div className="mt-10 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {industries.map(({ icon: Icon, name }) => (
              <div key={name} className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-4">
                <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-tx-green-light text-tx-green-dark">
                  <Icon className="h-5 w-5" />
                </div>
                <span className="text-sm font-semibold text-tx-navy">{name}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* FEATURES */}
      <section id="features" className="bg-white">
        <div className="mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:px-8">
          <SectionTitle
            eyebrow="Features"
            title="Everything you need to run a modern shop"
            sub="Tillix replaces a stack of tools with one clean platform — POS, inventory, purchasing, customers, staff and analytics."
          />
          <div className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {features.map(({ icon: Icon, title, text }) => (
              <div key={title} className="group rounded-2xl border border-slate-200 bg-white p-6 transition hover:-translate-y-0.5 hover:border-tx-green/40 hover:shadow-lg hover:shadow-emerald-900/5">
                <div className="grid h-11 w-11 place-items-center rounded-xl bg-tx-green-light text-tx-green-dark">
                  <Icon className="h-5 w-5" />
                </div>
                <h3 className="mt-4 text-lg font-bold text-tx-navy">{title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-slate-600">{text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>


      {/* MULTI-CURRENCY */}
      <section id="multi-currency" className="bg-white">
        <div className="mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:px-8">
          <SectionTitle
            eyebrow="🌍 Global Ready"
            title="Sell Anywhere with Multi-Currency Support"
            sub="One POS Platform. Multiple Countries. Multiple Currencies."
          />
          <div className="mx-auto mt-6 max-w-3xl text-center">
            <p className="text-sm leading-relaxed text-slate-600 sm:text-base">
              Tillix is a cloud POS and retail management software built for businesses operating across different countries and regions. Whether you run a grocery store, supermarket, pharmacy, restaurant, wholesale business, or a multi-store retail chain, Tillix lets you manage your business in your local currency with a consistent, powerful international POS experience.
            </p>
            <p className="mt-4 text-sm font-medium text-tx-navy">Perfect for businesses operating in:</p>
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              {[
                ["🇵🇰", "Pakistan"],
                ["🇦🇪", "United Arab Emirates"],
                ["🇸🇦", "Saudi Arabia"],
                ["🇺🇸", "United States"],
                ["🇬🇧", "United Kingdom"],
                ["🇪🇺", "Europe"],
                ["🇦🇺", "Australia"],
                ["🇳🇿", "New Zealand"],
                ["🇨🇦", "Canada"],
              ].map(([flag, name]) => (
                <span key={name} className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:-translate-y-0.5 hover:border-tx-green/40 hover:bg-white hover:shadow-sm">
                  <span aria-hidden>{flag}</span>{name}
                </span>
              ))}
              <span className="inline-flex items-center rounded-full border border-dashed border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-500">…and many more</span>
            </div>
          </div>

          <div className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {[
              { icon: Globe2, title: "Global Ready", text: "Operate your business anywhere in the world with a truly international POS system." },
              { icon: Landmark, title: "Multi-Currency Support", text: "Supports different currencies based on your business location — PKR, AED, SAR, USD, EUR and more." },
              { icon: TrendingUp, title: "Accurate Financial Reports", text: "Reports are generated in your selected business currency for clean, reliable accounting." },
              { icon: Store, title: "Multi-Store Ready", text: "Ideal multi store POS for businesses managing one or many retail locations." },
              { icon: Cloud, title: "Cloud Based", text: "Cloud POS access — run your grocery, supermarket, pharmacy, restaurant or wholesale business securely from anywhere." },
              { icon: Shield, title: "Secure & Reliable", text: "Enterprise-grade security with fast, resilient cloud infrastructure." },
            ].map(({ icon: Icon, title, text }) => (
              <div key={title} className="group rounded-2xl border border-slate-200 bg-white p-6 transition hover:-translate-y-0.5 hover:border-tx-green/40 hover:shadow-lg hover:shadow-emerald-900/5">
                <div className="grid h-11 w-11 place-items-center rounded-xl bg-tx-green-light text-tx-green-dark">
                  <Icon className="h-5 w-5" />
                </div>
                <h3 className="mt-4 text-lg font-bold text-tx-navy">{title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-slate-600">{text}</p>
              </div>
            ))}
          </div>

          <div className="mt-14 rounded-3xl border border-slate-200 bg-gradient-to-br from-tx-green-light/40 via-white to-white p-8 sm:p-10">
            <div className="text-center">
              <div className="inline-flex items-center gap-2 rounded-full bg-white/80 px-3 py-1 text-xs font-semibold text-tx-green-dark ring-1 ring-tx-green/20">
                💱 Supported Currencies
              </div>
              <h3 className="mt-3 text-xl font-bold text-tx-navy sm:text-2xl">Bill in the currency your customers use</h3>
              <p className="mt-2 text-sm text-slate-600">From Pakistan POS to UAE POS software, Saudi Arabia POS and USA POS software — Tillix adapts to your market.</p>
            </div>
            <div className="mt-6 flex flex-wrap justify-center gap-2.5">
              {[
                { code: "PKR", name: "Pakistani Rupee" },
                { code: "AED", name: "UAE Dirham" },
                { code: "SAR", name: "Saudi Riyal" },
                { code: "USD", name: "US Dollar" },
                { code: "EUR", name: "Euro" },
                { code: "GBP", name: "British Pound" },
                { code: "AUD", name: "Australian Dollar" },
                { code: "NZD", name: "NZ Dollar" },
                { code: "CAD", name: "Canadian Dollar" },
              ].map(({ code, name }) => (
                <span
                  key={code}
                  title={name}
                  className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-tx-navy shadow-sm transition hover:-translate-y-0.5 hover:border-tx-green/50 hover:text-tx-green-dark hover:shadow-md"
                >
                  <span className="text-tx-green-dark">{code}</span>
                  <span className="hidden text-xs font-normal text-slate-500 sm:inline">{name}</span>
                </span>
              ))}
              <span className="inline-flex items-center rounded-full border border-dashed border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-500">
                + More…
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* BENEFITS + PHONE */}

      <section className="bg-slate-50/60">
        <div className="mx-auto grid max-w-7xl gap-12 px-4 py-20 sm:px-6 lg:grid-cols-2 lg:items-center lg:px-8">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-tx-green/30 bg-tx-green/10 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-tx-green-dark">
              Why Tillix
            </div>
            <h2 className="mt-4 text-3xl font-extrabold tracking-tight text-tx-navy sm:text-4xl">
              Automate operations. Increase sales. Sleep better.
            </h2>
            <p className="mt-4 text-slate-600">
              Retail runs on tiny decisions made a thousand times a day. Tillix removes the friction from
              every one of them — so you spend time growing, not fixing.
            </p>
            <ul className="mt-6 grid gap-3 sm:grid-cols-2">
              {benefits.map(b => (
                <li key={b} className="flex items-start gap-2 rounded-lg bg-white p-3 ring-1 ring-slate-200">
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-tx-green" />
                  <span className="text-sm text-slate-700">{b}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="relative mx-auto w-full max-w-sm">
            <div className="absolute -inset-6 -z-10 rounded-[2.5rem] bg-gradient-to-br from-emerald-100 to-white blur-2xl" />
            <div className="rounded-[2rem] border border-slate-200 bg-tx-navy p-3 shadow-2xl">
              <div className="rounded-[1.5rem] bg-white p-4">
                <div className="flex items-center gap-2">
                  <Smartphone className="h-4 w-4 text-tx-green" />
                  <span className="text-xs font-semibold text-tx-navy">Manager on the go</span>
                </div>
                <div className="mt-4 space-y-3">
                  {[
                    { l: "Sales this week", v: formatPrice(18420, cur), d: "+12.4%" },
                    { l: "Low stock items", v: "7", d: "review now" },
                    { l: "New customers", v: "31", d: "+9 vs last week" },
                  ].map(k => (
                    <div key={k.l} className="rounded-xl border border-slate-100 p-3">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-medium text-slate-500">{k.l}</span>
                        <span className="text-[11px] font-semibold text-tx-green-dark">{k.d}</span>
                      </div>
                      <div className="mt-1 text-lg font-extrabold text-tx-navy">{k.v}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section id="how" className="bg-white">
        <div className="mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:px-8">
          <SectionTitle eyebrow="How it works" title="Live in three simple steps" />
          <div className="mt-12 grid gap-6 md:grid-cols-3">
            {steps.map(s => (
              <div key={s.n} className="relative rounded-2xl border border-slate-200 bg-white p-6">
                <div className="text-sm font-extrabold text-tx-green">{s.n}</div>
                <h3 className="mt-2 text-lg font-bold text-tx-navy">{s.title}</h3>
                <p className="mt-2 text-sm text-slate-600">{s.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* TESTIMONIALS */}
      <section className="bg-slate-50/60">
        <div className="mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:px-8">
          <SectionTitle eyebrow="Loved by retailers" title="What shop owners say about Tillix" />
          <div className="mt-12 grid gap-5 md:grid-cols-3">
            {testimonials.map(t => (
              <figure key={t.name} className="rounded-2xl border border-slate-200 bg-white p-6">
                <blockquote className="text-sm leading-relaxed text-slate-700">"{t.quote}"</blockquote>
                <figcaption className="mt-4 text-sm">
                  <div className="font-bold text-tx-navy">{t.name}</div>
                  <div className="text-slate-500">{t.role}</div>
                </figcaption>
              </figure>
            ))}
          </div>
        </div>
      </section>

      {/* PRICING */}
      <section id="pricing" className="bg-slate-50/60">
        <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 lg:px-8">
          <SectionTitle
            eyebrow="Pricing"
            title="Simple plans that grow with your shop"
            sub={`Launch offer — save 50% for a limited time. Prices shown in your local currency (${cur.code}).`}
          />

          <div className="mt-4 flex justify-center">
            <div className="inline-flex items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
              <Sparkles className="h-3.5 w-3.5" /> 7-day free trial · No credit card required
            </div>
          </div>

          <div className="mt-6 flex justify-center">
            <div className="inline-flex rounded-full border border-slate-200 bg-white p-1 text-sm font-semibold shadow-sm">
              <button
                type="button"
                onClick={() => setBilling("monthly")}
                className={`rounded-full px-4 py-1.5 transition ${billing === "monthly" ? "bg-tx-navy text-white" : "text-slate-600 hover:text-tx-navy"}`}
              >
                Monthly
              </button>
              <button
                type="button"
                onClick={() => setBilling("yearly")}
                className={`rounded-full px-4 py-1.5 transition ${billing === "yearly" ? "bg-tx-navy text-white" : "text-slate-600 hover:text-tx-navy"}`}
              >
                Yearly <span className="ml-1 rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-bold text-emerald-700">SAVE</span>
              </button>
            </div>
          </div>

          <div className="mt-10 grid gap-6 md:grid-cols-2">
            {/* BASIC */}
            <div className="relative flex flex-col rounded-3xl border border-slate-200 bg-white p-8 shadow-sm">
              <h3 className="text-lg font-bold text-tx-navy">Basic</h3>
              <p className="mt-1 text-sm text-slate-500">Perfect for a single shop getting started.</p>
              <div className="mt-6 flex items-end gap-3">
                <span className="text-4xl font-extrabold text-tx-navy">{formatPrice(basicPrice, cur)}</span>
                <span className="pb-2 text-sm text-slate-500">{perLabel}</span>
              </div>
              <div className="mt-1 flex items-center gap-2">
                <span className="text-sm text-slate-400 line-through">{formatPrice(basicOrig, cur)}</span>
                <span className="rounded-md bg-emerald-100 px-2 py-0.5 text-[11px] font-bold text-emerald-700">SAVE 50%</span>
              </div>
              <ul className="mt-6 space-y-2.5 text-sm text-slate-700">
                {[
                  "Unlimited products & barcodes",
                  "Fast POS billing & receipts",
                  "Inventory & low-stock alerts",
                  "Customers, suppliers & ledger",
                  "Purchases & purchase returns",
                  "Offline mode & auto-sync",
                  "Daily automatic backups",
                  "Email support",
                ].map((f) => (
                  <li key={f} className="flex items-start gap-2">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-tx-green" /> {f}
                  </li>
                ))}
              </ul>
              <Link
                to="/auth"
                className="mt-8 inline-flex items-center justify-center rounded-xl border border-slate-200 bg-white px-5 py-3 text-sm font-semibold text-tx-navy transition hover:bg-slate-50"
              >
                Start 7-day free trial
              </Link>
            </div>

            {/* RECOMMENDED */}
            <div className="relative flex flex-col rounded-3xl border-2 border-tx-green bg-tx-navy p-8 text-white shadow-xl shadow-emerald-900/10">
              <div className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-tx-green px-3 py-1 text-[11px] font-bold uppercase tracking-wide text-white shadow">
                Recommended
              </div>
              <h3 className="text-lg font-bold">Pro</h3>
              <p className="mt-1 text-sm text-slate-300">For growing shops & multi-cashier teams.</p>
              <div className="mt-6 flex items-end gap-3">
                <span className="text-4xl font-extrabold">{formatPrice(proPrice, cur)}</span>
                <span className="pb-2 text-sm text-slate-300">{perLabel}</span>
              </div>
              <div className="mt-1 flex items-center gap-2">
                <span className="text-sm text-slate-400 line-through">{formatPrice(proOrig, cur)}</span>
                <span className="rounded-md bg-tx-green px-2 py-0.5 text-[11px] font-bold text-white">SAVE 50%</span>
              </div>
              <ul className="mt-6 space-y-2.5 text-sm text-slate-100">
                {[
                  "Everything in Basic",
                  "Multi-cashier with roles & permissions",
                  "Shifts, cash drawer & audit logs",
                  "Expiry, batch & wastage tracking",
                  "Bulk import & global product library",
                  "Advanced reports & P&L analytics",
                  "Business operations & shift tasks",
                  "Priority support",
                ].map((f) => (
                  <li key={f} className="flex items-start gap-2">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-tx-green" /> {f}
                  </li>
                ))}
              </ul>
              <Link
                to="/auth"
                className="mt-8 inline-flex items-center justify-center rounded-xl bg-tx-green px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-emerald-600/30 transition hover:bg-tx-green-dark"
              >
                Start 7-day free trial
              </Link>
            </div>
          </div>

          <p className="mt-6 text-center text-xs text-slate-500">
            Prices auto-converted from USD based on your location. Taxes may apply. Cancel anytime.
          </p>
        </div>
      </section>


      {/* CONNECT */}
      <section id="connect" className="bg-white">
        <div className="mx-auto max-w-5xl px-4 py-20 sm:px-6 lg:px-8">
          <SectionTitle
            eyebrow="Connect"
            title="Connect with Tillix"
            sub="Follow us on social media and watch product videos on YouTube."
          />
          <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { Icon: BrandFacebook, label: "Facebook", handle: "@tillix.co", href: "https://facebook.com/tillix.co" },
              { Icon: BrandInstagram, label: "Instagram", handle: "@tillix.co", href: "https://instagram.com/tillix.co" },
              { Icon: BrandLinkedin, label: "LinkedIn", handle: "tillix-co", href: "https://linkedin.com/company/tillix-co" },
              { Icon: BrandYoutube, label: "YouTube", handle: "@tillixpos", href: "https://www.youtube.com/@tillixpos" },
            ].map(({ Icon, label, handle, href }) => (
              <a
                key={label}
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`Follow Tillix on ${label}`}
                className="group flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-4 transition hover:-translate-y-0.5 hover:border-tx-green/40 hover:shadow-lg hover:shadow-emerald-900/5"
              >
                <span className="grid h-11 w-11 place-items-center rounded-xl bg-white ring-1 ring-slate-200 transition group-hover:scale-105 group-hover:ring-slate-300">
                  <Icon className="h-6 w-6" />
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-bold text-tx-navy">{label}</span>
                  <span className="block truncate text-xs text-slate-500">{handle}</span>
                </span>
              </a>
            ))}
          </div>
          <div className="mt-8 flex justify-center">
            <a
              href="https://www.youtube.com/@tillixpos"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Watch Tillix product videos on YouTube"
              className="inline-flex items-center gap-2 rounded-full bg-tx-navy px-5 py-3 text-sm font-semibold text-white shadow-sm transition hover:-translate-y-0.5 hover:bg-tx-green-dark hover:shadow-md"
            >
              <PlayCircle className="h-5 w-5" />
              Watch Tillix Product Videos
            </a>
          </div>
        </div>
      </section>

      {/* FAQ */}


      <section id="faq" className="bg-slate-50/60">
        <div className="mx-auto max-w-3xl px-4 py-20 sm:px-6 lg:px-8">
          <SectionTitle eyebrow="FAQ" title="Frequently asked questions" sub="Everything you need to know about Tillix POS." />
          <div className="mt-10 divide-y divide-slate-200 rounded-2xl border border-slate-200 bg-white">
            {FAQS.map((f, i) => {
              const open = openFaq === i;
              return (
                <div key={f.q}>
                  <button
                    type="button"
                    onClick={() => setOpenFaq(open ? null : i)}
                    aria-expanded={open}
                    className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left"
                  >
                    <span className="text-sm font-semibold text-tx-navy sm:text-base">{f.q}</span>
                    <ChevronDown className={`h-5 w-5 shrink-0 text-slate-400 transition ${open ? "rotate-180 text-tx-green" : ""}`} />
                  </button>
                  {open && (
                    <div className="px-5 pb-5 pt-0 text-sm leading-relaxed text-slate-600">{f.a}</div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* TEAM */}
      <section id="team" className="relative border-t border-slate-100 bg-gradient-to-b from-white via-slate-50 to-white py-20 sm:py-24">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-2xl text-center">
            <div className="inline-flex items-center gap-2 rounded-full border border-tx-green/30 bg-tx-green-light px-3 py-1 text-xs font-semibold text-tx-green-dark">
              Meet the Team
            </div>
            <h2 className="mt-4 text-3xl font-black tracking-tight text-slate-900 sm:text-4xl">
              The people behind Tillix
            </h2>
            <p className="mt-3 text-base text-slate-600">
              A dedicated crew building, supporting and scaling retail technology you can rely on.
            </p>
          </div>

          <div className="mx-auto mt-12 grid max-w-5xl gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {[
              {
                name: "Shahid Mehmood",
                role: "Developer",
                phone: "0304-4604659",
                initials: "SM",
                gradient: "from-emerald-500 to-teal-600",
              },
              {
                name: "Abdullah Iftekhar",
                role: "I.T. Manager",
                phone: "0301-7160701",
                initials: "AI",
                gradient: "from-indigo-500 to-blue-600",
              },
              {
                name: "Babar Hussain",
                role: "Technical Support",
                phone: "0333-4950141",
                initials: "BH",
                gradient: "from-amber-500 to-orange-600",
              },
            ].map((m) => (
              <div
                key={m.name}
                className="group relative overflow-hidden rounded-2xl border border-slate-200 bg-white p-6 shadow-sm transition hover:-translate-y-1 hover:border-tx-green/40 hover:shadow-xl"
              >
                <div className={`absolute inset-x-0 top-0 h-1 bg-gradient-to-r ${m.gradient}`} />
                <div className="flex items-center gap-4">
                  <div
                    className={`grid h-14 w-14 place-items-center rounded-xl bg-gradient-to-br ${m.gradient} text-lg font-bold text-white shadow-md ring-4 ring-white`}
                  >
                    {m.initials}
                  </div>
                  <div className="min-w-0">
                    <div className="truncate text-lg font-bold text-slate-900">{m.name}</div>
                    <div className="text-sm font-medium text-slate-500">{m.role}</div>
                  </div>
                </div>
                <div className="mt-5 border-t border-slate-100 pt-4">
                  <a
                    href={`tel:${m.phone.replace(/-/g, "")}`}
                    className="inline-flex items-center gap-2 text-sm font-semibold text-slate-700 transition group-hover:text-tx-green-dark"
                  >
                    <span className="grid h-8 w-8 place-items-center rounded-full bg-slate-100 text-slate-600 transition group-hover:bg-tx-green-light group-hover:text-tx-green-dark">
                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
                    </span>
                    {m.phone}
                  </a>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* FOOTER */}
      </main>

      <footer className="border-t border-slate-200 bg-white">

        <div className="mx-auto grid max-w-7xl gap-8 px-4 py-12 sm:px-6 md:grid-cols-4 lg:px-8">
          <div className="md:col-span-2">
            <BrandMark className="h-10 w-auto" />
            <p className="mt-3 max-w-sm text-sm text-slate-600">
              Tillix — Smart Retail Starts Here. Cloud POS and retail management software for modern retailers, worldwide.
            </p>
            <div className="mt-4 flex flex-wrap gap-2 text-[11px] font-semibold text-slate-500">
              {["UAE","Saudi Arabia","Pakistan","USA","UK","EU","Australia","New Zealand"].map(c => (
                <span key={c} className="rounded-full border border-slate-200 px-2 py-0.5">{c}</span>
              ))}
            </div>
          </div>
          <div>
            <div className="text-xs font-bold uppercase tracking-wider text-tx-navy">Product</div>
            <ul className="mt-3 space-y-2 text-sm text-slate-600">
              <li><a href="#features" className="hover:text-tx-green-dark">Features</a></li>
              <li><a href="#industries" className="hover:text-tx-green-dark">Industries</a></li>
              <li><a href="#pricing" className="hover:text-tx-green-dark">Pricing</a></li>
              <li><a href="#faq" className="hover:text-tx-green-dark">FAQ</a></li>
            </ul>
          </div>
          <div>
            <div className="text-xs font-bold uppercase tracking-wider text-tx-navy">Get started</div>
            <ul className="mt-3 space-y-2 text-sm text-slate-600">
              <li><Link to="/auth" className="hover:text-tx-green-dark">Sign in</Link></li>
              <li><Link to="/auth" className="hover:text-tx-green-dark">Register free</Link></li>
            </ul>

            <div className="mt-6 text-xs font-bold uppercase tracking-wider text-tx-navy">Follow Tillix</div>
            <div className="mt-3 flex items-center gap-2">
              {[
                { Icon: BrandFacebook, label: "Facebook", href: "https://facebook.com/tillix.co" },
                { Icon: BrandInstagram, label: "Instagram", href: "https://instagram.com/tillix.co" },
                { Icon: BrandLinkedin, label: "LinkedIn", href: "https://linkedin.com/company/tillix-co" },
                { Icon: BrandYoutube, label: "YouTube", href: "https://www.youtube.com/@tillixpos" },
              ].map(({ Icon, label, href }) => (
                <a
                  key={label}
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={`Follow Tillix on ${label}`}
                  className="inline-flex transition hover:-translate-y-0.5 hover:drop-shadow-md"
                >
                  <Icon className="h-8 w-8" />
                </a>
              ))}
            </div>
            <a
              href="https://www.youtube.com/@tillixpos"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Watch Tillix product videos on YouTube"
              className="mt-4 inline-flex items-center gap-2 rounded-full border border-tx-green/30 bg-tx-green-light px-3.5 py-2 text-xs font-semibold text-tx-green-dark transition hover:-translate-y-0.5 hover:border-tx-green/60 hover:shadow-sm"
            >
              <PlayCircle className="h-4 w-4" />
              Watch Tillix Product Videos
            </a>
          </div>




        </div>
        <div className="border-t border-slate-100">
          <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-2 px-4 py-5 text-xs text-slate-500 sm:flex-row sm:px-6 lg:px-8">
            <div>© {new Date().getFullYear()} Tillix. All rights reserved.</div>
            <div>Smart Retail Starts Here.</div>
          </div>
        </div>
        <div className="border-t border-slate-200 bg-slate-50">
          <div className="mx-auto max-w-7xl px-4 py-4 text-center text-xs text-slate-600 sm:px-6 lg:px-8">
            Copyrights reserved by{" "}
            <a
              href="https://tillix.co"
              target="_blank"
              rel="noopener noreferrer"
              className="font-semibold text-slate-900 hover:underline"
            >
              tillix.co
            </a>{" "}
            — Designed &amp; developed by{" "}
            <a
              href="https://logichills.com"
              target="_blank"
              rel="noopener noreferrer"
              className="font-semibold text-slate-900 hover:underline"
            >
              logichills.com
            </a>
            .
          </div>
        </div>
      </footer>

    </div>
  );
}
