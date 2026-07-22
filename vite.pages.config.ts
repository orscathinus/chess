import { fileURLToPath, URL } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const projectRoot = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  root: fileURLToPath(new URL("./github-pages", import.meta.url)),
  base: "/chess/",
  publicDir: fileURLToPath(new URL("./public", import.meta.url)),
  plugins: [react()],
  css: {
    postcss: fileURLToPath(new URL("./postcss.config.mjs", import.meta.url)),
  },
  build: {
    outDir: `${projectRoot}/gh-pages-dist`,
    emptyOutDir: true,
  },
});
