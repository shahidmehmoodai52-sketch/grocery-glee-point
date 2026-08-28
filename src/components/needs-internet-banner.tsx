// Shown at the top of routes that need internet to function
// (Reports, Admin, Users, Backup, Import, Intelligence, Library, Shop-admin).
// Silently hides when the browser is online.

import { WifiOff } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useOfflineStatus } from "@/lib/offline/status";
import { cn } from "@/lib/utils";

interface Props {
  /** Short label describing the section, e.g. "Reports". */
  section?: string;
  className?: string;
}

export function NeedsInternetBanner({ section, className }: Props) {
  const { t } = useTranslation();
  const { online } = useOfflineStatus();
  if (online) return null;

  return (
    <div
      role="alert"
      className={cn(
        "flex items-start gap-3 rounded-md border border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300 px-3 py-2 text-sm",
        className,
      )}
    >
      <WifiOff className="h-4 w-4 mt-0.5 shrink-0" />
      <div className="leading-snug">
        <div className="font-medium">{t('common.offline_title', "You're offline")}</div>
        <div className="text-xs opacity-90">
          {section ? t('common.offline_section_needs_internet', '{{section}} needs internet to load.', { section }) : t('common.offline_generic_needs_internet', 'This section needs internet to load.')}
          {" "}{t('common.offline_billing_note', 'Billing, product lookup and past invoices still work in POS.')}
        </div>
      </div>
    </div>
  );
}
