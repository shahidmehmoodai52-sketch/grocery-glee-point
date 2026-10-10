import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Clock, Download, Loader2, LogIn, MonitorDown, ShieldAlert } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";

const SITE_URL = "https://tillix.co";
// Installers are published by electron-builder to the public
// tillix-releases repo (see electron-builder.yml). Until its first release
// exists, fall back to the source repo's old releases. The browser downloads
// the asset straight from GitHub's file host, so the shop never lands on a
// GitHub page.
const RELEASE_APIS = [
  "https://api.github.com/repos/shahidmehmoodai52-sketch/tillix-releases/releases/latest",
  "https://api.github.com/repos/shahidmehmoodai52-sketch/grocery-glee-point/releases/latest",
];

export const Route = createFileRoute("/download")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Download Tillix POS for Windows | Tillix" },
      { name: "description", content: "Install the Tillix POS desktop app on Windows." },
      { name: "robots", content: "noindex" },
    ],
    links: [{ rel: "canonical", href: `${SITE_URL}/download` }],
  }),
  component: DownloadPage,
});

type State =
  | { kind: "checking" }
  | { kind: "signed_out" }
  | { kind: "pending" }
  | { kind: "blocked"; status: string }
  | { kind: "ready" }
  | { kind: "starting" }
  | { kind: "started"; fileName: string; version: string }
  | { kind: "error"; message: string };

async function latestInstaller(): Promise<{ url: string; name: string; version: string }> {
  let lastError = "No Windows installer found.";
  for (const api of RELEASE_APIS) {
    try {
      const res = await fetch(api, { headers: { Accept: "application/vnd.github+json" } });
      if (!res.ok) { lastError = `Could not look up the latest version (${res.status}).`; continue; }
      const rel = await res.json();
      const exe = (rel.assets ?? []).find((a: any) => /\.exe$/i.test(a.name ?? ""));
      if (exe?.browser_download_url) {
        return { url: exe.browser_download_url, name: exe.name, version: rel.tag_name ?? "" };
      }
    } catch (e: any) {
      lastError = e?.message ?? lastError;
    }
  }
  throw new Error(lastError);
}

function DownloadPage() {
  const [state, setState] = useState<State>({ kind: "checking" });

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (!data.session) return setState({ kind: "signed_out" });
      const { data: status, error } = await supabase.rpc("my_tenant_status");
      if (error) return setState({ kind: "error", message: error.message });
      if (status === "active") return setState({ kind: "ready" });
      if (status === "pending" || status == null) return setState({ kind: "pending" });
      setState({ kind: "blocked", status: String(status) });
    })();
  }, []);

  const startDownload = async () => {
    setState({ kind: "starting" });
    try {
      const exe = await latestInstaller();
      // Plain navigation to the file: the browser saves it and stays here.
      window.location.href = exe.url;
      setState({ kind: "started", fileName: exe.name, version: exe.version });
    } catch (e: any) {
      setState({ kind: "error", message: e?.message ?? "Download failed." });
    }
  };

  // Approved shops get the download right away, no extra click.
  useEffect(() => {
    if (state.kind === "ready") void startDownload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.kind]);

  return (
    <div className="min-h-screen w-full bg-gradient-to-br from-background via-secondary to-background flex items-center justify-center p-4">
      <div className="w-full max-w-md rounded-xl border bg-card p-8 text-center shadow-sm">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-50 dark:bg-emerald-950/40">
          <MonitorDown className="h-7 w-7 text-emerald-600 dark:text-emerald-400" />
        </div>
        <h1 className="mt-4 text-xl font-semibold">Tillix POS for Windows</h1>

        {(state.kind === "checking" || state.kind === "starting" || state.kind === "ready") && (
          <p className="mt-3 flex items-center justify-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            {state.kind === "checking" ? "Checking your shop…" : "Starting download…"}
          </p>
        )}

        {state.kind === "signed_out" && (
          <>
            <p className="mt-3 text-sm text-muted-foreground">
              The desktop app is available to approved shops. Sign in with your shop owner account to download it.
            </p>
            <Button asChild className="mt-6 w-full">
              <Link to="/auth" search={{ next: "/download" }}><LogIn className="mr-2 h-4 w-4" />Sign in to download</Link>
            </Button>
          </>
        )}

        {state.kind === "pending" && (
          <div className="mt-4 rounded-md border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-900 dark:text-amber-100">
            <Clock className="mx-auto mb-2 h-5 w-5" />
            Your shop is waiting for approval. The download (and your 7-day free trial) becomes available as soon as it is approved.
          </div>
        )}

        {state.kind === "blocked" && (
          <div className="mt-4 rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
            <ShieldAlert className="mx-auto mb-2 h-5 w-5" />
            Your shop is {state.status}. Contact Tillix support (info@tillix.co · +923096431377) to restore access.
          </div>
        )}

        {state.kind === "started" && (
          <>
            <p className="mt-3 text-sm text-muted-foreground">
              <strong className="text-foreground">{state.fileName}</strong> ({state.version}) is downloading.
              Open it when it finishes and follow the installer. If Windows shows "Windows protected your PC", click <strong>More info → Run anyway</strong>.
            </p>
            <Button variant="outline" className="mt-6 w-full" onClick={startDownload}>
              <Download className="mr-2 h-4 w-4" />Download again
            </Button>
          </>
        )}

        {state.kind === "error" && (
          <>
            <p className="mt-3 text-sm text-destructive">{state.message}</p>
            <Button className="mt-6 w-full" onClick={startDownload}>
              <Download className="mr-2 h-4 w-4" />Try again
            </Button>
          </>
        )}

        <Link to="/" className="mt-6 inline-block text-xs text-muted-foreground hover:text-foreground">← Back to tillix.co</Link>
      </div>
    </div>
  );
}
