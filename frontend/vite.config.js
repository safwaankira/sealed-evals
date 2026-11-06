import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

const here = dirname(fileURLToPath(import.meta.url));
const nm = (p) => resolve(here, "node_modules", p);

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    // ../src/shared is shared with the agent; resolve its imports from this package
    alias: {
      "@shared": resolve(here, "../src/shared"),
      "@noble/curves": nm("@noble/curves"),
      "@noble/hashes": nm("@noble/hashes"),
      "@noble/ciphers": nm("@noble/ciphers"),
    },
  },
  server: {
    port: 3001,
    fs: { allow: [resolve(here, "..")] },
    // in dev, forward API calls to a locally running agent
    proxy: { "/api": process.env.AGENT_URL || "http://localhost:3000" },
  },
  build: { outDir: "dist", sourcemap: false },
});
