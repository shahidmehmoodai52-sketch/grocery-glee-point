// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths, nitro (build-only using cloudflare as a default target),
//     componentTagger (dev-only), VITE_* env injection, @ path alias, React/TanStack dedupe,
//     error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import { mcpPlugin } from "@lovable.dev/mcp-js/stacks/tanstack/vite";
import { VitePWA } from "vite-plugin-pwa";
import { cpSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

// Electron desktop build uses the Nitro `node-server` preset so we can spawn a
// local Node server from main.cjs. Enable via NITRO_PRESET=node-server (see the
// `electron:build` script). Default cloud build stays on cloudflare-module.
const nitroPreset = process.env.NITRO_PRESET;

// vite-plugin-pwa writes the service worker to a fixed directory (`dist/client`).
// Nitro, however, points the client/public output at a preset-specific folder
// (e.g. `.vercel/output/static` on Vercel, `.output/public` for node-server).
// Anything left in `dist/client` is then never published, so `/sw.js` 404s and
// falls through to the SSR function. This plugin mirrors the generated worker
// files into whatever directory the client build actually resolved to.
// Resolve the directory the client/public assets actually land in for the
// active Nitro preset. Vercel builds publish `.vercel/output/static`; the
// Cloudflare default (and the Lovable sandbox) uses `dist/client`.
const SW_SOURCE_DIR = process.env.VERCEL
  ? ".vercel/output/static"
  : "dist/client";
function mirrorServiceWorker() {
  let root = process.cwd();
  let targets = new Set<string>();
  return {
    name: "tillix:mirror-service-worker",
    apply: "build" as const,
    enforce: "post" as const,
    configResolved(config: any) {
      root = config.root ?? process.cwd();
      const outDirs = [config.environments?.client?.build?.outDir].filter(
        Boolean,
      ) as string[];
      targets = new Set(outDirs.map((dir) => resolve(root, dir)));
    },
    closeBundle(this: any) {
      const from = resolve(root, SW_SOURCE_DIR);
      if (!existsSync(from)) return;
      const swFiles = readdirSync(from).filter((f) =>
        /^(sw\.js(\.map)?|workbox-[^/]+\.js(\.map)?|sw\.mjs)$/.test(f),
      );
      if (swFiles.length === 0) return;
      for (const target of targets) {
        if (target === from) continue;
        mkdirSync(target, { recursive: true });
        for (const file of swFiles) {
          cpSync(resolve(from, file), resolve(target, file));
        }
        this.warn?.(`copied service worker (${swFiles.join(", ")}) to ${target}`);
      }
    },
  };
}

export default defineConfig({
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
    // Split each route's component into its own chunk instead of bundling every
    // route (and everything it imports — xlsx, jspdf, pdfjs-dist, recharts...)
    // into the single eagerly-loaded routeTree.
    router: { autoCodeSplitting: true },
  },
  vite: {
    // The Vercel Supabase integration writes its own SUPABASE_URL /
    // SUPABASE_PUBLISHABLE_KEY project env vars (distinct from this repo's
    // VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY), and Vite only
    // auto-exposes VITE_-prefixed vars to the client bundle. Explicitly
    // replace the exact `process.env.SUPABASE_*` expressions client.ts
    // already reads (previously dead in the browser — process.env isn't
    // real there) so the integration's values reach the client bundle too.
    // Top-level `define` alone doesn't reach the "client" Vite Environment
    // this project builds separately (see the NODE_ENV override above for
    // the same pattern) — it must also be set under environments.client.
    define: {
      "process.env.SUPABASE_URL": JSON.stringify(process.env.SUPABASE_URL ?? ""),
      "process.env.SUPABASE_PUBLISHABLE_KEY": JSON.stringify(
        process.env.SUPABASE_PUBLISHABLE_KEY ?? "",
      ),
    },
    environments: {
      client: {
        define: {
          "process.env.SUPABASE_URL": JSON.stringify(process.env.SUPABASE_URL ?? ""),
          "process.env.SUPABASE_PUBLISHABLE_KEY": JSON.stringify(
            process.env.SUPABASE_PUBLISHABLE_KEY ?? "",
          ),
        },
      },
    },
    plugins: [
      mcpPlugin(),
      VitePWA({
        registerType: "autoUpdate",
        injectRegister: null, // registration happens from our guarded wrapper
        strategies: "injectManifest",
        // vite-plugin-pwa needs an explicit outDir; mirrorServiceWorker() copies
        // the result into the resolved client output dir if they ever diverge.
        outDir: SW_SOURCE_DIR,
        srcDir: "src",
        filename: "sw.js",
        devOptions: { enabled: false },
        includeAssets: ["favicon.png", "offline.html"],
        injectManifest: {
          injectionPoint: 'self.__WB_MANIFEST',
          // Precache the assets from the directory that is actually deployed.
          globDirectory: SW_SOURCE_DIR,
        },
        manifest: {
          name: "Tillix POS",
          short_name: "Tillix",
          start_url: "/",
          scope: "/",
          display: "standalone",
          background_color: "#ffffff",
          theme_color: "#ffffff",
          icons: [
            { src: "/favicon.png", sizes: "512x512", type: "image/png", purpose: "any" },
            { src: "/favicon.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
          ],
        },
      }),
      mirrorServiceWorker(),
    ],
  },
  nitro: {
    ...(nitroPreset ? { preset: nitroPreset } : {}),
    // Baseline security headers on every response, regardless of which Nitro
    // preset ends up building this (cloudflare-module by default, node-server
    // for Electron). No CSP here: this app calls out to Supabase, a Cloudflare
    // Worker proxy, and other third-party endpoints whose exact origins aren't
    // enumerated anywhere — a wrong CSP would silently break those requests,
    // so that needs its own careful pass, not a rushed addition here.
    routeRules: {
      "/**": {
        headers: {
          "X-Content-Type-Options": "nosniff",
          "X-Frame-Options": "SAMEORIGIN",
          "Strict-Transport-Security": "max-age=63072000; includeSubDomains; preload",
        },
      },
    },
  },
});
