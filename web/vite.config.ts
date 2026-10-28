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
  },
});
