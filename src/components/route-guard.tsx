import { useRouterState, useNavigate, Link } from "@tanstack/react-router";
import { useEffect } from "react";
import { usePermissions } from "@/hooks/use-permissions";
import { Button } from "@/components/ui/button";

const PATH_PERM: { match: RegExp; perm: string }[] = [
  { match: /^\/dashboard/, perm: "dashboard" },
  { match: /^\/pos/, perm: "pos" },
  { match: /^\/sales/, perm: "sales" },
  { match: /^\/sale-returns/, perm: "sale-returns" },
  { match: /^\/purchases/, perm: "purchases" },
  { match: /^\/purchase-returns/, perm: "purchase-returns" },
  { match: /^\/expenses/, perm: "expenses" },
  { match: /^\/products/, perm: "products" },
  { match: /^\/customers/, perm: "customers" },
  { match: /^\/suppliers/, perm: "suppliers" },
  { match: /^\/import/, perm: "import" },
  { match: /^\/reports/, perm: "reports" },
  { match: /^\/backup/, perm: "backup" },
  { match: /^\/settings/, perm: "settings" },
];

export function RouteGuard({ children }: { children: React.ReactNode }) {
  const path = useRouterState({ select: (s) => s.location.pathname });
  const { can, isAdmin, loading } = usePermissions();
  const navigate = useNavigate();

  const required = PATH_PERM.find((p) => p.match.test(path))?.perm;
  const isUsers = /^\/users/.test(path);
  const allowed = loading || !required || can(required) || (isUsers && isAdmin);

  useEffect(() => {
    if (loading) return;
    if (!allowed) {
      // Redirect cashier landing on a blocked URL to POS
      const fallback = can("pos") ? "/pos" : "/auth";
      if (path !== fallback) navigate({ to: fallback, replace: true });
    }
  }, [allowed, loading, path]);

  if (loading) return null;
  if (isUsers && !isAdmin) {
    return (
      <div className="p-10 text-center space-y-3">
        <h2 className="text-lg font-semibold">Access denied</h2>
        <p className="text-sm text-muted-foreground">Only the owner (admin) can manage staff.</p>
        <Button asChild><Link to="/pos">Back to POS</Link></Button>
      </div>
    );
  }
  if (!allowed) return null;
  return <>{children}</>;
}
