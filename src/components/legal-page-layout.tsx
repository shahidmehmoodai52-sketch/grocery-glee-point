import { Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";

const LOGO_URL = "/tillix-logo.jpeg?v=2";

/**
 * Shared chrome for standalone legal pages (Privacy Policy, Terms of Use).
 * Kept minimal and English-only regardless of the shop's UI language —
 * legal text shouldn't be machine/auto-translated, and pinning dir="ltr"
 * keeps the layout correct even when the app's <html> is set to rtl for
 * Urdu/Arabic.
 */
// This project doesn't have the Tailwind Typography plugin installed, so
// legal-page prose is styled by hand with these small shared pieces instead
// of a `prose` wrapper.
export function LegalH2({ children }: { children: React.ReactNode }) {
  return <h2 className="mb-3 mt-10 text-xl font-bold text-tx-navy first:mt-0">{children}</h2>;
}

export function LegalP({ children }: { children: React.ReactNode }) {
  return <p className="mb-4 leading-relaxed text-slate-700">{children}</p>;
}

export function LegalUl({ children }: { children: React.ReactNode }) {
  return <ul className="mb-4 list-disc space-y-1.5 pl-5 leading-relaxed text-slate-700">{children}</ul>;
}

export function LegalPageLayout({
  title,
  updated,
  children,
}: {
  title: string;
  updated: string;
  children: React.ReactNode;
}) {
  return (
    <div dir="ltr" className="min-h-screen bg-white text-slate-800">
      <header className="border-b border-slate-200">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-4 sm:px-6">
          <Link to="/" className="flex items-center gap-2">
            <img src={LOGO_URL} alt="Tillix logo" className="h-8 w-auto" width={110} height={36} />
          </Link>
          <Link to="/" className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-600 hover:text-tx-green-dark">
            <ArrowLeft className="h-4 w-4" />
            Back to home
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
        <h1 className="text-3xl font-bold text-tx-navy">{title}</h1>
        <p className="mt-1 text-sm text-slate-500">Last updated: {updated}</p>
        <div className="mt-8">{children}</div>
      </main>

      <footer className="border-t border-slate-100 bg-slate-50">
        <div className="mx-auto flex max-w-3xl flex-col items-center justify-between gap-2 px-4 py-6 text-xs text-slate-500 sm:flex-row sm:px-6">
          <div>© {new Date().getFullYear()} tillix.co — All rights reserved.</div>
          <div className="flex gap-4">
            <Link to="/privacy-policy" className="hover:text-tx-green-dark">Privacy Policy</Link>
            <Link to="/terms-of-use" className="hover:text-tx-green-dark">Terms of Use</Link>
            <a href="mailto:info@tillix.co" className="hover:text-tx-green-dark">info@tillix.co</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
