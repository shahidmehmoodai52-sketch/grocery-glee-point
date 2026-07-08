import { Link, useRouterState, useNavigate } from "@tanstack/react-router";
import {
  LayoutDashboard, ShoppingCart, Package, Users, Truck, ClipboardList, Receipt,
  BarChart3, Settings, LogOut, Store, Undo2, RotateCcw, Wallet, Upload, HardDriveDownload, UserCog, ClipboardCheck, CalendarClock, Brain,
} from "lucide-react";

import {
  Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent, SidebarGroupLabel,
  SidebarHeader, SidebarFooter, SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar,
} from "@/components/ui/sidebar";
import { supabase } from "@/integrations/supabase/client";
import { useSettings } from "@/hooks/use-settings";
import { usePermissions } from "@/hooks/use-permissions";

type Item = { title: string; url: string; icon: any; perm: string; adminOnly?: boolean };
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
      { title: "Intelligence", url: "/intelligence", icon: Brain, perm: "intelligence" },
    ],

  },
  {
    label: "Insights",
    items: [
      { title: "Reports", url: "/reports", icon: BarChart3, perm: "reports" },
      { title: "Auto backup", url: "/backup", icon: HardDriveDownload, perm: "backup" },
      { title: "Settings", url: "/settings", icon: Settings, perm: "settings" },
      { title: "Staff & access", url: "/users", icon: UserCog, perm: "users", adminOnly: true },
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
  const visibleGroups = groups
    .map((g) => ({ ...g, items: g.items.filter((it) => (it.adminOnly ? isAdmin : can(it.perm))) }))
    .filter((g) => g.items.length > 0);
  const isActive = (path: string) => currentPath === path || currentPath.startsWith(path + "/");

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  };

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="border-b border-sidebar-border">
        <div className="flex items-center gap-2 px-2 py-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-md bg-sidebar-primary text-sidebar-primary-foreground">
            <Store className="h-5 w-5" />
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
                      <Link to={item.url} className="flex items-center gap-2">
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
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton onClick={handleSignOut} tooltip="Sign out">
              <LogOut className="h-4 w-4" />
              {!collapsed && <span>Sign out</span>}
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
