import { Link, useRouterState, useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import {
  LayoutDashboard, ShoppingCart, Package, Users, Truck, ClipboardList, Receipt,
  BarChart3, Settings, LogOut, Undo2, RotateCcw, Wallet, Upload, HardDriveDownload, UserCog, ClipboardCheck, CalendarClock, Brain, Clock, Library, ShieldCheck, Box, Coins, Scale,
} from "lucide-react";


import {
  Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent, SidebarGroupLabel,
  SidebarHeader, SidebarFooter, SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar,
} from "@/components/ui/sidebar";
import { supabase } from "@/integrations/supabase/client";
import { useSettings } from "@/hooks/use-settings";
import { usePermissions } from "@/hooks/use-permissions";
import { useSuperAdmin } from "@/hooks/use-super-admin";
import { OfflineStatusBadge } from "@/components/offline-status";


type Item = { titleKey: string; title: string; url: string; icon: any; perm: string; adminOnly?: boolean; search?: Record<string, any> };
const groups: { labelKey: string; label: string; items: Item[] }[] = [
  {
    labelKey: "common.group_overview", label: "Overview",
    items: [
      { titleKey: "common.dashboard", title: "Dashboard", url: "/dashboard", icon: LayoutDashboard, perm: "dashboard" },
      { titleKey: "common.pos", title: "POS", url: "/pos", icon: ShoppingCart, perm: "pos" },
    ],
  },
  {
    labelKey: "common.group_transactions", label: "Transactions",
    items: [
      { titleKey: "common.sales", title: "Sales", url: "/sales", icon: Receipt, perm: "sales" },
      { titleKey: "common.sale_returns", title: "Sale returns", url: "/sale-returns", icon: Undo2, perm: "sale-returns" },
      { titleKey: "common.purchases", title: "Purchases", url: "/purchases", icon: ClipboardList, perm: "purchases" },
      { titleKey: "common.purchase_returns", title: "Purchase returns", url: "/purchase-returns", icon: RotateCcw, perm: "purchase-returns" },
      { titleKey: "common.expenses", title: "Expenses", url: "/expenses", icon: Wallet, perm: "expenses" },
      { titleKey: "common.cash_flow", title: "Cash flow", url: "/cash-flow", icon: Coins, perm: "cash-flow" },
      { titleKey: "common.shifts", title: "Shifts", url: "/shifts", icon: Clock, perm: "shifts" },
      { titleKey: "common.operations", title: "Operations", url: "/operations", icon: ClipboardCheck, perm: "operations" },


    ],
  },
  {
    labelKey: "common.group_catalog", label: "Catalog",
    items: [
      { titleKey: "common.products", title: "Products", url: "/products", icon: Package, perm: "products" },
      { titleKey: "common.customers", title: "Customers", url: "/customers", icon: Users, perm: "customers" },
      { titleKey: "common.suppliers", title: "Suppliers", url: "/suppliers", icon: Truck, perm: "suppliers" },
      { titleKey: "common.bulk_import", title: "Bulk import", url: "/import", icon: Upload, perm: "import" },
      { titleKey: "common.stock_count", title: "Stock count", url: "/stock-count", icon: ClipboardCheck, perm: "stock-count" },
      { titleKey: "common.expiry_waste", title: "Expiry & waste", url: "/expiry", icon: CalendarClock, perm: "expiry" },
      { titleKey: "common.short_excess", title: "Short & Excess", url: "/expiry", icon: Scale, perm: "expiry", search: { tab: "shortexcess" } },
      { titleKey: "common.intelligence", title: "Intelligence", url: "/intelligence", icon: Brain, perm: "intelligence" },
      { titleKey: "common.global_library", title: "Global library", url: "/library", icon: Library, perm: "library" },
      { titleKey: "common.assets", title: "Assets", url: "/assets", icon: Box, perm: "assets" },
    ],

  },
  {
    labelKey: "common.group_insights", label: "Insights",
    items: [
      { titleKey: "common.reports", title: "Reports", url: "/reports", icon: BarChart3, perm: "reports" },
      { titleKey: "common.auto_backup", title: "Auto backup", url: "/backup", icon: HardDriveDownload, perm: "backup" },
      { titleKey: "common.settings", title: "Settings", url: "/settings", icon: Settings, perm: "settings" },
      { titleKey: "common.shop_admin", title: "Shop admin", url: "/shop-admin", icon: UserCog, perm: "shop-admin", adminOnly: true },
    ],
  },
];

export function AppSidebar() {
  const { t } = useTranslation();
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const currentPath = useRouterState({ select: (s) => s.location.pathname });
  const navigate = useNavigate();
  const { data: settings } = useSettings();
  const { isAdmin, can } = usePermissions();
  const { isSuperAdmin } = useSuperAdmin();
  const visibleGroups = groups
    .map((g) => ({ ...g, items: g.items.filter((it) => (it.adminOnly ? isAdmin : can(it.perm))) }))
    .filter((g) => g.items.length > 0);
  const isActive = (path: string) => currentPath === path || currentPath.startsWith(path + "/");

  const handleSignOut = async () => {
    const { clearOfflineDataOnLogout } = await import("@/lib/offline/device");
    const { getPendingQueueCount } = await import("@/lib/offline/sync");

    let hasPending = false;
    try {
      const count = await getPendingQueueCount();
      if (count > 0) {
        hasPending = true;
        // Sidebar uses native confirm for simplicity as it's less reachable than the header button
        // but we ensure it correctly preserves data unless confirmed.
        if (!confirm(`Warning: You have ${count} unsynced offline transactions. Logging out now will PERMANENTLY delete them. \n\nClick OK to discard and log out, or Cancel to stay and sync.`)) {
          return;
        }
      }
    } catch {}

    await clearOfflineDataOnLogout({ includeQueue: hasPending });
    await supabase.auth.signOut();
    navigate({ to: "/auth", search: { next: "/dashboard" }, replace: true });
  };


  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="border-b border-sidebar-border">
        <div className="flex items-center gap-2 px-2 py-3">
          <div className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-md bg-white">
            <img
              src="/favicon.png"
              alt="Tillix POS logo"
              className="h-9 w-9 object-cover"
              width={36}
              height={36}
              decoding="async"
              loading="eager"
            />
          </div>
          {!collapsed && (
            <div className="flex flex-col">
              <span className="text-sm font-semibold leading-tight">{settings?.store_name ?? "Grocery POS"}</span>
              <span className="text-[11px] text-sidebar-foreground/60">{t('common.point_of_sale', 'Point of Sale')}</span>
            </div>
          )}
        </div>
      </SidebarHeader>
      <SidebarContent>
        {visibleGroups.map((g) => (
          <SidebarGroup key={g.label}>
            <SidebarGroupLabel>{t(g.labelKey, g.label)}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {g.items.map((item) => {
                  const label = t(item.titleKey, item.title);
                  return (
                    <SidebarMenuItem key={item.title}>
                      <SidebarMenuButton asChild isActive={isActive(item.url)} tooltip={label}>
                        <Link to={item.url} search={item.search as any} className="flex items-center gap-2">
                          <item.icon className="h-4 w-4" />
                          {!collapsed && <span>{label}</span>}
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>
      <SidebarFooter className="border-t border-sidebar-border">
        {!collapsed && (
          <div className="px-2 pt-2">
            <OfflineStatusBadge />
          </div>
        )}
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              onClick={handleSignOut}
              tooltip={t('common.logout', 'Sign out')}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90 hover:text-destructive-foreground font-medium"
            >
              <LogOut className="h-4 w-4" />
              {!collapsed && <span>{t('common.logout', 'Sign out')}</span>}
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>

    </Sidebar>
  );
}
