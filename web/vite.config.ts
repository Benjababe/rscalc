import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { dirname } from "path";
import { fileURLToPath } from "url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(here);

export default defineConfig({
  root: here,
  plugins: [react()],
  // `data/*.json` lives outside `web/`, so Vite must be allowed to read it.
  server: { fs: { allow: [repoRoot] } },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    // The UI snapshots are several MB of JSON. Splitting them into their own
    // chunks keeps the page code small and lets each direction load only its
    // own data. Gzip is well under 500 kB; the raw minified data chunks are
    // larger, so raise the warning threshold rather than hide a code problem.
    chunkSizeWarningLimit: 5000,
    rollupOptions: {
      output: {
        manualChunks(id) {
          const path = id.replaceAll("\\", "/");
          if (path.includes("/data/opportunities.json")) {
            return "data-opportunities";
          }
          if (path.includes("/data/shop-sinks.json")) {
            return "data-shop-sinks";
          }
          if (path.includes("/data/process.json")) {
            return "data-process";
          }
          if (path.includes("/data/shop-access.json")) {
            return "data-shop-access";
          }
          if (path.includes("/node_modules/")) return "vendor";
          return undefined;
        },
      },
    },
  },
});
