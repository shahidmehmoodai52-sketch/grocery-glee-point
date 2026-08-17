import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { LanguageSelect } from "@/components/language-select/language-select";

import {
  ShoppingCart, Barcode, Boxes, Users, TrendingUp, Store, Cloud, Shield,
  Smartphone, Zap, Globe2, ReceiptText, PackageSearch, Landmark, Truck,
  Pill, UtensilsCrossed, ShoppingBasket, Building2, Check, ChevronDown, Menu, X,
  PlayCircle, Sparkles,
} from "lucide-react";

/* ---------- IP-based currency localization ---------- */
import { WORLD_CURRENCIES_MAP, type WorldCurrency } from "@/lib/currencies";
import { CurrencySelect } from "@/components/currency-select";

type CurrencyInfo = WorldCurrency;
const CURRENCIES = WORLD_CURRENCIES_MAP;

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

const CURRENCY_OVERRIDE_KEY = "tx_cur_override";

function useLocalCurrency(): { cur: CurrencyInfo; setCur: (code: string) => void } {
  const [cur, setCurState] = useState<CurrencyInfo>(CURRENCIES.USD);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Manual override wins over IP detection
      try {
        const override = localStorage.getItem(CURRENCY_OVERRIDE_KEY);
        if (override && CURRENCIES[override]) {
          setCurState(CURRENCIES[override]);
          return;
        }
      } catch { /* ignore */ }
      try {
        const cached = localStorage.getItem("tx_geo_cur_v2");
        if (cached) {
          const parsed = JSON.parse(cached) as { code: string; t: number };
          if (Date.now() - parsed.t < 24 * 60 * 60 * 1000 && CURRENCIES[parsed.code]) {
            setCurState(CURRENCIES[parsed.code]);
            return;
          }
        }
      } catch { /* ignore */ }
      const geo = await detectCountry();
      if (cancelled) return;
      const picked = pickCurrency(geo?.country, geo?.currency);
      setCurState(picked);
      try { localStorage.setItem("tx_geo_cur_v2", JSON.stringify({ code: picked.code, t: Date.now() })); } catch { /* ignore */ }
    })();
    return () => { cancelled = true; };
  }, []);

  const setCur = (code: string) => {
    if (!CURRENCIES[code]) return;
    setCurState(CURRENCIES[code]);
    try { localStorage.setItem(CURRENCY_OVERRIDE_KEY, code); } catch { /* ignore */ }
  };

  return { cur, setCur };
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
      { property: "og:title", content: "Tillix – Smart Retail Starts Here | Cloud POS & Retail Management Software" },
      { property: "og:description", content: "Tillix is a modern cloud POS for grocery, supermarkets, retail shops, pharmacies, restaurants, wholesalers and multi-store businesses. Billing, inventory, barcodes, loyalty, suppliers, purchases and real-time analytics in one platform." },
      { property: "og:url", content: `${SITE_URL}/` },
      { property: "og:type", content: "website" },
      { property: "og:image", content: `${OG_LOGO_URL}` },
      { name: "twitter:title", content: "Tillix – Smart Retail Starts Here | Cloud POS & Retail Management Software" },
      { name: "twitter:description", content: "Tillix is a modern cloud POS for grocery, supermarkets, retail shops, pharmacies, restaurants, wholesalers and multi-store businesses. Billing, inventory, barcodes, loyalty, suppliers, purchases and real-time analytics in one platform." },
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
  const { t } = useTranslation();
  const [menuOpen, setMenuOpen] = useState(false);

  const [openFaq, setOpenFaq] = useState<number | null>(0);
  const [billing, setBilling] = useState<"monthly" | "yearly">("monthly");
  const { cur, setCur } = useLocalCurrency();

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
    { icon: ReceiptText, title: t('landing.features_sec.f1_title'), text: t('landing.features_sec.f1_text') },
    { icon: Barcode, title: t('landing.features_sec.f2_title'), text: t('landing.features_sec.f2_text') },
    { icon: Boxes, title: t('landing.features_sec.f3_title'), text: t('landing.features_sec.f3_text') },
    { icon: Users, title: t('landing.features_sec.f4_title'), text: t('landing.features_sec.f4_text') },
    { icon: Truck, title: t('landing.features_sec.f5_title'), text: t('landing.features_sec.f5_text') },
    { icon: TrendingUp, title: t('landing.features_sec.f6_title'), text: t('landing.features_sec.f6_text') },
    { icon: Shield, title: t('landing.features_sec.f7_title'), text: t('landing.features_sec.f7_text') },
    { icon: Cloud, title: t('landing.features_sec.f8_title'), text: t('landing.features_sec.f8_text') },
    { icon: Building2, title: t('landing.features_sec.f9_title'), text: t('landing.features_sec.f9_text') },
  ];

  const industries = [
    { icon: ShoppingBasket, name: t('landing.industries.grocery') },
    { icon: Store, name: t('landing.industries.supermarket') },
    { icon: Pill, name: t('landing.industries.pharmacy') },
    { icon: UtensilsCrossed, name: t('landing.industries.restaurant') },
    { icon: PackageSearch, name: t('landing.industries.retail') },
    { icon: Landmark, name: t('landing.industries.wholesale') },
    { icon: Building2, name: t('landing.industries.multi_store') },
    { icon: ShoppingCart, name: t('landing.industries.mini_mart') },
  ];

  const benefits = [
    t('landing.why.b1'),
    t('landing.why.b2'),
    t('landing.why.b3'),
    t('landing.why.b4'),
    t('landing.why.b5'),
    t('landing.why.b6'),
  ];

  const steps = [
    { n: "01", title: t('landing.how.s1_title'), text: t('landing.how.s1_text') },
    { n: "02", title: t('landing.how.s2_title'), text: t('landing.how.s2_text') },
    { n: "03", title: t('landing.how.s3_title'), text: t('landing.how.s3_text') },
  ];

  const testimonials = [
    { quote: t('landing.testimonials.t1_quote', "Tillix cut our billing time in half and finally gave us real numbers on which products actually make money."), name: t('landing.testimonials.t1_name', "Ahmed R."), role: t('landing.testimonials.t1_role', "Supermarket owner, Dubai") },
    { quote: t('landing.testimonials.t2_quote', "We run three branches on Tillix. Central stock and one dashboard — it's a night-and-day upgrade from spreadsheets."), name: t('landing.testimonials.t2_name', "Sara K."), role: t('landing.testimonials.t2_role', "Retail chain manager, Karachi") },
    { quote: t('landing.testimonials.t3_quote', "Offline mode saved a whole weekend of sales during an outage. Everything synced perfectly when we came back online."), name: t('landing.testimonials.t3_name', "Miguel A."), role: t('landing.testimonials.t3_role', "Grocery owner, Madrid") },
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
            <a href="#features" className="text-sm font-medium text-slate-700 hover:text-tx-green-dark">{t('landing.nav.features')}</a>
            <a href="#industries" className="text-sm font-medium text-slate-700 hover:text-tx-green-dark">{t('landing.nav.industries')}</a>
            <a href="#pricing" className="text-sm font-medium text-slate-700 hover:text-tx-green-dark">{t('landing.nav.pricing')}</a>
            <a href="#faq" className="text-sm font-medium text-slate-700 hover:text-tx-green-dark">{t('landing.nav.faq')}</a>
          </nav>

          <div className="flex items-center gap-2">
            <LanguageSelect className="mr-1" />
            <div className="hidden sm:block">
              <CurrencySelect
                value={cur.code}
                onChange={(code) => setCur(code)}
                compact
                className="min-w-[132px]"
              />
            </div>
            <Link
              to="/auth"
              className="hidden rounded-lg px-3 py-2 text-sm font-semibold text-tx-navy hover:bg-slate-100 sm:inline-flex"
            >
              {t('landing.nav.login')}
            </Link>
            <Link
              to="/auth"
              className="inline-flex items-center gap-1 rounded-lg bg-tx-green px-3.5 py-2 text-sm font-semibold text-white shadow-sm shadow-emerald-600/20 transition hover:bg-tx-green-dark sm:px-4"
            >
              {t('landing.nav.signup')}
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
              {[[t('landing.nav.features'),"#features"],[t('landing.nav.industries'),"#industries"],[t('landing.how.eyebrow'),"#how"],[t('landing.nav.pricing'),"#pricing"],[t('landing.nav.faq'),"#faq"]].map(([label, href]) => (
                <a key={href} href={href} onClick={() => setMenuOpen(false)} className="py-2 text-sm font-medium text-slate-700">
                  {label}
                </a>
              ))}
              <Link to="/auth" onClick={() => setMenuOpen(false)} className="py-2 text-sm font-semibold text-tx-navy">{t('landing.nav.login')}</Link>
              <Link to="/auth" onClick={() => setMenuOpen(false)} className="py-2 text-sm font-semibold text-tx-green-dark">{t('landing.pricing.start_trial')}</Link>
              <div className="py-2">
                <div className="mb-1 text-xs font-medium text-slate-500">{t('pos.settings.currency', 'Currency')}</div>
                <CurrencySelect value={cur.code} onChange={(code) => setCur(code)} />
              </div>


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
                <Globe2 className="h-3.5 w-3.5" /> {t('landing.hero.eyebrow')}
              </div>
              <h1 className="mt-5 text-4xl font-extrabold leading-[1.05] tracking-tight text-tx-navy sm:text-5xl lg:text-6xl">
                {t('landing.hero.title')}
              </h1>
              <p className="mt-4 max-w-xl text-base leading-relaxed text-slate-600 sm:text-lg">
                {t('landing.hero.subtitle')}
              </p>


              <div className="mt-8 flex flex-wrap items-center gap-3">
                <Link to="/auth" className="inline-flex items-center gap-2 rounded-xl bg-tx-green px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-emerald-600/20 transition hover:bg-tx-green-dark">
                  {t('landing.hero.getStarted')} <Zap className="h-4 w-4" />
                </Link>
                <Link to="/auth" className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-5 py-3 text-sm font-semibold text-tx-navy transition hover:bg-slate-50">
                  {t('landing.nav.login')}
                </Link>
              </div>

              <ul className="mt-6 grid grid-cols-2 gap-2 text-sm text-slate-600 sm:max-w-md">
                {[t('landing.why.b1'), t('landing.why.b2'), t('landing.why.b3'), t('landing.why.b4')].map(x => (
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
                    { l: t('landing.hero.card_sales', "Today's Sales"), v: formatPrice(4286, cur) },
                    { l: t('landing.hero.card_bills', "Bills"), v: "142" },
                    { l: t('landing.hero.card_profit', "Profit"), v: formatPrice(981, cur) },
                  ].map((k) => (
                    <div key={k.l} className="rounded-xl border border-slate-100 bg-slate-50 p-3">
                      <div className="text-[11px] font-medium uppercase tracking-wider text-slate-500">{k.l}</div>
                      <div className="mt-1 text-lg font-extrabold text-tx-navy">{k.v}</div>
                    </div>
                  ))}
                </div>
                <div className="mt-4 rounded-xl border border-slate-100">
                  {[
                    { n: t('landing.hero.item1', "Basmati Rice 5kg"), q: "×2", p: formatPrice(21.9, cur) },
                    { n: t('landing.hero.item2', "Fresh Milk 1L"), q: "×6", p: formatPrice(8.4, cur) },
                    { n: t('landing.hero.item3', "Chocolate Bar"), q: "×3", p: formatPrice(4.5, cur) },
                  ].map((r) => (
                    <div key={r.n} className="flex items-center justify-between border-b border-slate-100 px-3 py-2 text-sm last:border-b-0">
                      <span className="min-w-0 truncate text-slate-700">{r.n}</span>
                      <span className="mx-3 shrink-0 text-slate-400">{r.q}</span>
                      <span className="shrink-0 font-semibold text-tx-navy">{r.p}</span>
                    </div>
                  ))}
                </div>
                <div className="mt-4 flex items-center justify-between rounded-xl bg-tx-navy px-4 py-3 text-white">
                  <span className="text-sm font-medium opacity-80">{t('landing.hero.total_due', 'Total due')}</span>
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
            eyebrow={t('landing.industries.eyebrow')}
            title={t('landing.industries.title')}
            sub={t('landing.industries.sub')}
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
            eyebrow={t('landing.features_sec.eyebrow')}
            title={t('landing.features_sec.title')}
            sub={t('landing.features_sec.sub')}
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
            eyebrow={t('landing.global.eyebrow')}
            title={t('landing.global.title')}
            sub={t('landing.global.sub')}
          />
          <div className="mx-auto mt-6 max-w-3xl text-center">
            <p className="text-sm leading-relaxed text-slate-600 sm:text-base">
              {t('landing.global.sub')}
            </p>
            <p className="mt-4 text-sm font-medium text-tx-navy">{t('landing.global.perfect')}</p>
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
                {t('landing.global.supported_cur')}
              </div>
              <h3 className="mt-3 text-xl font-bold text-tx-navy sm:text-2xl">{t('landing.global.bill_in')}</h3>
              <p className="mt-2 text-sm text-slate-600">{t('landing.global.adapt')}</p>
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
              {t('landing.why.eyebrow')}
            </div>
            <h2 className="mt-4 text-3xl font-extrabold tracking-tight text-tx-navy sm:text-4xl">
              {t('landing.why.title')}
            </h2>
            <p className="mt-4 text-slate-600">
              {t('landing.why.sub')}
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
                  <span className="text-xs font-semibold text-tx-navy">{t('landing.why.manager')}</span>
                </div>
                <div className="mt-4 space-y-3">
                  {[
                    { l: t('landing.why.sales_week'), v: formatPrice(18420, cur), d: "+12.4%" },
                    { l: t('landing.why.low_stock'), v: "7", d: t('landing.why.review') },
                    { l: t('landing.why.new_cust'), v: "31", d: "+9 vs last week" },
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
          <SectionTitle eyebrow={t('landing.how.eyebrow')} title={t('landing.how.title')} />
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
            title={t('landing.pricing.title', 'Simple plans that grow with your shop')}
            sub={t('landing.pricing.sub', `Launch offer — save 50% for a limited time. Prices shown in your local currency (${cur.code}).`, { code: cur.code })}
          />

          <div className="mt-4 flex justify-center">
            <div className="inline-flex items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
              <Sparkles className="h-3.5 w-3.5" /> {t('landing.pricing.trial_info', '7-day free trial · No credit card required')}
            </div>
          </div>

          <div className="mt-6 flex justify-center">
            <div className="inline-flex rounded-full border border-slate-200 bg-white p-1 text-sm font-semibold shadow-sm">
              <button
                type="button"
                onClick={() => setBilling("monthly")}
                className={`rounded-full px-4 py-1.5 transition ${billing === "monthly" ? "bg-tx-navy text-white" : "text-slate-600 hover:text-tx-navy"}`}
              >
                {t('landing.pricing.monthly', 'Monthly')}
              </button>
              <button
                type="button"
                onClick={() => setBilling("yearly")}
                className={`rounded-full px-4 py-1.5 transition ${billing === "yearly" ? "bg-tx-navy text-white" : "text-slate-600 hover:text-tx-navy"}`}
              >
                {t('landing.pricing.yearly', 'Yearly')} <span className="ml-1 rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-bold text-emerald-700">{t('landing.pricing.save', 'SAVE')}</span>
              </button>
            </div>
          </div>

          <div className="mt-10 grid gap-6 md:grid-cols-2">
            {/* BASIC */}
            <div className="relative flex flex-col rounded-3xl border border-slate-200 bg-white p-8 shadow-sm">
              <h3 className="text-lg font-bold text-tx-navy">Basic</h3>
              <p className="mt-1 text-sm text-slate-500">{t('landing.pricing.basic_sub', 'Perfect for a single shop getting started.')}</p>
              <div className="mt-6 flex items-end gap-3">
                <span className="text-4xl font-extrabold text-tx-navy">{formatPrice(basicPrice, cur)}</span>
                <span className="pb-2 text-sm text-slate-500">{perLabel}</span>
              </div>
              <div className="mt-1 flex items-center gap-2">
                <span className="text-sm text-slate-400 line-through">{formatPrice(basicOrig, cur)}</span>
                <span className="rounded-md bg-emerald-100 px-2 py-0.5 text-[11px] font-bold text-emerald-700">{t('landing.pricing.save_pct', 'SAVE 50%')}</span>
              </div>
              <ul className="mt-6 space-y-2.5 text-sm text-slate-700">
                {[
                  t('landing.pricing.f1', "Unlimited products & barcodes"),
                  t('landing.pricing.f2', "Fast POS billing & receipts"),
                  t('landing.pricing.f3', "Inventory & low-stock alerts"),
                  t('landing.pricing.f4', "Customers, suppliers & ledger"),
                  t('landing.pricing.f5', "Purchases & purchase returns"),
                  t('landing.pricing.f6', "Offline mode & auto-sync"),
                  t('landing.pricing.f7', "Daily automatic backups"),
                  t('landing.pricing.f8', "Email support"),
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
                {t('landing.pricing.start_trial', 'Start 7-day free trial')}
              </Link>
            </div>

            {/* RECOMMENDED */}
            <div className="relative flex flex-col rounded-3xl border-2 border-tx-green bg-tx-navy p-8 text-white shadow-xl shadow-emerald-900/10">
              <div className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-tx-green px-3 py-1 text-[11px] font-bold uppercase tracking-wide text-white shadow">
                {t('landing.pricing.recommended', 'Recommended')}
              </div>
              <h3 className="text-lg font-bold">Pro</h3>
              <p className="mt-1 text-sm text-slate-300">{t('landing.pricing.pro_sub', 'For growing shops & multi-cashier teams.')}</p>
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
            {t('landing.pricing.auto_convert', 'Prices auto-converted from USD based on your location. Taxes may apply. Cancel anytime.')}
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
              {t('landing.team.eyebrow')}
            </div>
            <h2 className="mt-4 text-3xl font-black tracking-tight text-slate-900 sm:text-4xl">
              {t('landing.team.title')}
            </h2>
            <p className="mt-3 text-base text-slate-600">
              {t('landing.team.sub')}
            </p>
          </div>

          <div className="mx-auto mt-12 grid max-w-5xl gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {[
              {
                name: "Abdullah Iftikhar",
                role: "Founder & CEO",
                phone: "+92309 6431 377",
                initials: "AI",
                gradient: "from-emerald-500 to-teal-600",
              },
              {
                name: "Shahid Mehmood",
                role: "Co-Founder & CTO",
                phone: "+92309 6431 377",
                initials: "SM",
                gradient: "from-indigo-500 to-blue-600",
              },
              {
                name: "Babar Hussain",
                role: "COO & Head of Operations",
                phone: "+92309 6431 377",
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
              {t('landing.footer.desc')}
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
            <div>© {new Date().getFullYear()} tillix.co All rights reserved.</div>
            <div>Smart Retail Starts Here.</div>
          </div>
        </div>
        <div className="border-t border-slate-200 bg-slate-50">
          <div className="mx-auto max-w-7xl px-4 py-4 text-center text-xs text-slate-600 sm:px-6 lg:px-8">
            '''Do not make any visual modifications. The phrases I write are commands to understand what I want, not to be written down. Understand their content well, then execute what is required.'''\n                                        \n                                            \n                                            You are acting as a senior full-stack engineer working inside a Lovable project.\nThink in layers: understand the product goal, inspect the current app state, identify the root cause or opportunity, propose a precise fix, and validate the result before finalizing.\nPrioritize correctness, maintainability, UX quality, accessibility, and production-safe implementation.\nUse the context below to reason with more depth and avoid shallow or generic answers.\nProject ID: 0d8742ce-c858-4431-94b6-b23eb34b18b4\nWorkspace ID: KSnRWlbTs9TIiV7qYKD6\nPage URL: https://lovable.dev/projects/0d8742ce-c858-4431-94b6-b23eb34b18b4\nPage title: Grocery Genius | Lovable\nProject context: Skip to chat input Grocery Genius Loading Live Preview... Preview Files Code More Preview Files Code More /admin/shops/1c951f0e-0219-4c9d-9bae-f3132958342d/.../shops/1c951f0e-0219-4c9d-9bae-f3132958342d/.../1c951f0e-0219-4c9d-9bae-f3132958342d/... /... Homepage S Share Publish Lovable is working… Pushed from GitHub purchase tax fix Build unsuccessful Preview is out of date Details Preview Pushed from GitHub pos Build unsuccessful Preview is out of date Details Preview Pushed from GitHub didgatal payment Build unsuccessful Preview is out of date Details Preview Pushed from GitHub pos ui Build unsuccessful Preview is out of date Details Preview Pushed from GitHub bank Build unsuccessful Preview is out of date Details Preview Pushed from GitHub bug Build unsuccessful Preview is out of date Details Preview Pushed from GitHub bug fix Build unsuccessful Preview is out of date Details Preview Today at 11:10 PM Visual edit Fast Visual Edit Details Previewing Fixed the POS payment grid buttons to correctly update the selected payment method and cleared the filter in Stock Count after a successful entry. POS Payment Grid: Replaced the incorrect internal function call with the standard onChange handler, ensuring that clicking \"Cash\", \"Card\", or \"Bank\" methods correctly updates the bill's payment source. Stock Count: Added a search filter reset after confirming a product count, allowing the user to immediately see their new entry in the list regardless of previous search filters. The POS and Stock Count workflows are now smoother and more reliable. Today at 11:45 PM Visual edit This message was cancelled. hafiz-super-store-ba-023 is shop code ka data kuch missing hy invoice 5 bajy ke bad hoi hy but mujhy 4:56 pk time ke mutabiq sy raha hy Today at 11:46 PM Thinking Apply text edit\nUser request:\nhafiz-super-store-ba-023\n\nis shop code ka data kuch missing hy invoice 5 bajy ke bad hoi hy but mujhy 4:56 pk time ke mutabiq sy raha hy
          </div>
        </div>
      </footer>

    </div>
  );
}
