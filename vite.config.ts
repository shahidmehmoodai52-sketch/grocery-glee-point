// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths, nitro (build-only using cloudflare as a default target),
//     componentTagger (dev-only), VITE_* env injection, @ path alias, React/TanStack dedupe,
//     error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import { mcpPlugin } from "@lovable.dev/mcp-js/stacks/tanstack/vite";
import { VitePWA } from "vite-plugin-pwa";

// Electron desktop build uses the Nitro `node-server` preset so we can spawn a
// local Node server from main.cjs. Enable via NITRO_PRESET=node-server (see the
// `electron:build` script). Default cloud build stays on cloudflare-module.
const nitroPreset = process.env.NITRO_PRESET;

export default defineConfig({
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
  vite: {
    plugins: [
      mcpPlugin(),
      VitePWA({
        registerType: "autoUpdate",
        injectRegister: null, // registration happens from our guarded wrapper
        srcDir: "public",
        filename: "sw.js",
        strategy: "injectManifest" as const,
        devOptions: { enabled: false },
        includeAssets: ["favicon.svg", "favicon.png", "offline.html", "manifest.webmanifest", "sw.js"],
        injectManifest: {
          injectionPoint: undefined, // sw.js is fully custom and does not use precache injection
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
    ],
  },
  ...(nitroPreset
    ? {
        nitro: {
          preset: nitroPreset,
        },
      }
    : {}),
});
