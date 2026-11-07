import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { dirname } from "path";
import { fileURLToPath } from "url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(here);

export default defineConfig({
  root: here,
  plugins: [react()],
  // `data/*.json` no longer enters the bundle — the server publishes it and the
  // app fetches it — so the dev server proxies the API to `pnpm serve` instead.
  // Point RSCALC_API elsewhere when the backend runs on another port.
  server: {
    fs: { allow: [repoRoot] },
    proxy: { "/api": { target: process.env.RSCALC_API ?? "http://127.0.0.1:8080", changeOrigin: true } },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    // The bundle is now just the app: the snapshots are served by the backend.
    // The limit stays raised because the vendor chunk (React) is still large
    // enough to be worth not warning about on every build.
    chunkSizeWarningLimit: 2000,
    rollupOptions: {
      output: {
        manualChunks(id) {
          // The artifacts used to be separate chunks (~20 MB of JSON compiled into
          // the bundle). They are fetched at runtime now, so only the framework
          // code is split out.
          const path = id.replaceAll("\\", "/");
          if (path.includes("/node_modules/")) return "vendor";
          return undefined;
        },
      },
    },
  },
});
