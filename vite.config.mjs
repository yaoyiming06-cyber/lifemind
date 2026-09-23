import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const rootDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  base: "./",
  cacheDir: "node_modules/.vite",
  resolve: {
    alias: {
      "@": path.resolve(rootDir, "src"),
    },
  },
  build: {
    outDir: "out",
    emptyOutDir: true,
  },
  css: {
    postcss: { plugins: [] },
  },
  server: {
    host: "127.0.0.1",
    port: 3000,
    strictPort: true,
    watch: {
      ignored: [
        "**/src-tauri/target/**",
        "**/.next/**",
        "**/out/**",
        "**/vite.config.mjs",
        "**/tsconfig.json",
      ],
    },
  },
});
