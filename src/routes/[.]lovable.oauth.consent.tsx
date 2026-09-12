import { createFileRoute, redirect } from "@tanstack/react-router";
import { useState } from "react";
import { Store, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";

// Local typed wrapper around the beta supabase.auth.oauth namespace.
type AuthorizationDetails = {
  client?: { name?: string; client_uri?: string } | null;
  redirect_url?: string | null;
  redirect_to?: string | null;
};
type OAuthResult = { data: AuthorizationDetails | null; error: { message: string } | null };
const oauthApi = (supabase.auth as unknown as {
  oauth: {
    getAuthorizationDetails: (id: string) => Promise<OAuthResult>;
    approveAuthorization: (id: string) => Promise<OAuthResult>;
    denyAuthorization: (id: string) => Promise<OAuthResult>;
  };
}).oauth;

export const Route = createFileRoute("/.lovable/oauth/consent")({
  ssr: false,
  validateSearch: (s: Record<string, unknown>) => ({
    authorization_id: typeof s.authorization_id === "string" ? s.authorization_id : "",
  }),
  beforeLoad: async ({ search, location }) => {
    if (!search.authorization_id) throw new Error("Missing authorization_id");
    const { data } = await supabase.auth.getSession();
    const next = location.pathname + location.searchStr;
    if (!data.session) throw redirect({ to: "/auth", search: { next } });
  },
  loader: async ({ location }) => {
    const authorizationId = new URLSearchParams(location.search).get("authorization_id")!;
    const { data, error } = await oauthApi.getAuthorizationDetails(authorizationId);
    if (error) throw new Error(error.message);
    const immediate = data?.redirect_url ?? data?.redirect_to;
    if (immediate && !data?.client) throw redirect({ href: immediate });
    return data;
  },
  component: Consent,
  errorComponent: ({ error }) => (
    <ConsentShell>
      <p className="text-sm text-destructive">
        Could not load this authorization request: {String((error as Error)?.message ?? error)}
      </p>
    </ConsentShell>
  ),
});

function ConsentShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen w-full bg-gradient-to-br from-background via-secondary to-background flex items-center justify-center p-4">
      <Card className="w-full max-w-md p-8">
        <div className="flex flex-col items-center text-center mb-6">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary text-primary-foreground mb-3">
            <Store className="h-6 w-6" />
          </div>
          <h1 className="text-2xl font-semibold">Tillix POS</h1>
        </div>
        {children}
      </Card>
    </div>
  );
}

function Consent() {
  const details = Route.useLoaderData();
  const { authorization_id } = Route.useSearch();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const clientName = details?.client?.name ?? "an external app";

  async function decide(approve: boolean) {
    setBusy(true);
    setError(null);
    const { data, error } = approve
      ? await oauthApi.approveAuthorization(authorization_id)
      : await oauthApi.denyAuthorization(authorization_id);
    if (error) {
      setBusy(false);
      setError(error.message);
      return;
    }
    const target = data?.redirect_url ?? data?.redirect_to;
    if (!target) {
      setBusy(false);
      setError("No redirect returned by the authorization server.");
      return;
    }
    window.location.href = target;
  }

  return (
    <ConsentShell>
      <h2 className="text-lg font-semibold text-center">
        Connect {clientName} to your Tillix POS account?
      </h2>
      <p className="mt-2 text-sm text-muted-foreground text-center">
        {clientName} will be able to use this app's tools (search products, view stock and sales) as you.
      </p>
      {error && (
        <p role="alert" className="mt-4 text-sm text-destructive text-center">
          {error}
        </p>
      )}
      <div className="mt-6 grid grid-cols-2 gap-2">
        <Button variant="outline" disabled={busy} onClick={() => decide(false)}>
          Deny
        </Button>
        <Button disabled={busy} onClick={() => decide(true)}>
          {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Approve
        </Button>
      </div>
    </ConsentShell>
  );
}
