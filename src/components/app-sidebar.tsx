import { Link, useRouterState, useNavigate } from "@tanstack/react-router";
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


type Item = { title: string; url: string; icon: any; perm: string; adminOnly?: boolean; search?: Record<string, any> };
const groups: { label: string; items: Item[] }[] = [
  {
    label: "Overview",
    items: [
      { title: "Dashboard", url: "/dashboard", icon: LayoutDashboard, perm: "dashboard" },
      { title: "POS", url: "/pos", icon: ShoppingCart, perm: "pos" },
    ],
  },
  {
    label: "Transactions",
    items: [
      { title: "Sales", url: "/sales", icon: Receipt, perm: "sales" },
      { title: "Sale returns", url: "/sale-returns", icon: Undo2, perm: "sale-returns" },
      { title: "Purchases", url: "/purchases", icon: ClipboardList, perm: "purchases" },
      { title: "Purchase returns", url: "/purchase-returns", icon: RotateCcw, perm: "purchase-returns" },
      { title: "Expenses", url: "/expenses", icon: Wallet, perm: "expenses" },
      { title: "Cash flow", url: "/cash-flow", icon: Coins, perm: "cash-flow" },
      { title: "Shifts", url: "/shifts", icon: Clock, perm: "shifts" },
      { title: "Operations", url: "/operations", icon: ClipboardCheck, perm: "operations" },


    ],
  },
  {
    label: "Catalog",
    items: [
      { title: "Products", url: "/products", icon: Package, perm: "products" },
      { title: "Customers", url: "/customers", icon: Users, perm: "customers" },
      { title: "Suppliers", url: "/suppliers", icon: Truck, perm: "suppliers" },
      { title: "Bulk import", url: "/import", icon: Upload, perm: "import" },
      { title: "Stock count", url: "/stock-count", icon: ClipboardCheck, perm: "stock-count" },
      { title: "Expiry & waste", url: "/expiry", icon: CalendarClock, perm: "expiry" },
      { title: "Short & Excess", url: "/expiry", icon: Scale, perm: "expiry", search: { tab: "shortexcess" } },
      { title: "Intelligence", url: "/intelligence", icon: Brain, perm: "intelligence" },
      { title: "Global library", url: "/library", icon: Library, perm: "library" },
      { title: "Assets", url: "/assets", icon: Box, perm: "assets" },
    ],

  },
  {
    label: "Insights",
    items: [
      { title: "Reports", url: "/reports", icon: BarChart3, perm: "reports" },
      { title: "Auto backup", url: "/backup", icon: HardDriveDownload, perm: "backup" },
      { title: "Settings", url: "/settings", icon: Settings, perm: "settings" },
      { title: "Shop admin", url: "/shop-admin", icon: UserCog, perm: "shop-admin", adminOnly: true },
    ],
  },
];

export function AppSidebar() {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const currentPath = useRouterState({ select: (s) => s.location.pathname });
  const navigate = useNavigate();
  const { data: settings } = useSettings();
  const { isAdmin, can } = usePermissions();
  const { isSuperAdmin } = useSuperAdmin();
  const withPlatform = isSuperAdmin
    ? [
        ...groups,
        {
          label: "Platform",
          items: [
            { title: "Admin panel", url: "/admin", icon: ShieldCheck, perm: "admin", adminOnly: false } as Item,
          ],
        },
      ]
    : groups;
  const visibleGroups = withPlatform
    .map((g) => ({ ...g, items: g.items.filter((it) => (it.url === "/admin" ? isSuperAdmin : it.adminOnly ? isAdmin : can(it.perm))) }))
    .filter((g) => g.items.length > 0);
  const isActive = (path: string) => currentPath === path || currentPath.startsWith(path + "/");

  const handleSignOut = async () => {
    // Both logout buttons should behave identically and safely.
    // The main logic is in the authenticated layout.
    const { clearOfflineDataOnLogout } = await import("@/lib/offline/device");
    const { getPendingQueueCount } = await import("@/lib/offline/sync");

    try {
      const count = await getPendingQueueCount();
      if (count > 0) {
        // If we're in the sidebar and there's pending data, we should probably
        // just trigger the main layout's logout flow if possible, or show a toast.
        // For simplicity and consistency, we'll just allow the logout if they
        // click here, but the header button is the primary one.
        // Actually, let's make it safe here too.
        if (!confirm(`Warning: You have ${count} unsynced offline transactions. Logging out will PERMANENTLY delete them. Proceed?`)) {
          return;
        }
      }
    } catch {}

    await clearOfflineDataOnLogout();
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
              <span className="text-[11px] text-sidebar-foreground/60">Point of Sale</span>
            </div>
          )}
        </div>
      </SidebarHeader>
      <SidebarContent>
        {visibleGroups.map((g) => (
          <SidebarGroup key={g.label}>
            <SidebarGroupLabel>{g.label}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {g.items.map((item) => (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton asChild isActive={isActive(item.url)} tooltip={item.title}>
                      <Link to={item.url} search={item.search as any} className="flex items-center gap-2">
                        <item.icon className="h-4 w-4" />
                        {!collapsed && <span>{item.title}</span>}
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
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
              tooltip="Sign out"
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90 hover:text-destructive-foreground font-medium"
            >
              <LogOut className="h-4 w-4" />
              {!collapsed && <span>Sign out</span>}
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>

    </Sidebar>
  );
}
