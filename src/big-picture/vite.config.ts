import { resolve } from "node:path";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import svgr from "vite-plugin-svgr";
import { contentSecurityPolicy } from "./vite-content-security-policy";
import { scopeBigPictureCss } from "./vite-scope-big-picture-css";

export default defineConfig(({ mode }) => ({
  root: resolve(__dirname),
  build: {
    outDir: resolve(__dirname, "../../dist/big-picture"),
    emptyOutDir: true,
  },
  css: {
    postcss: {
      plugins: [scopeBigPictureCss()],
    },
  },
  resolve: {
    alias: {
      "@renderer": resolve(__dirname, "../../src/renderer/src"),
      "@shared": resolve(__dirname, "../../src/shared"),
      "@locales": resolve(__dirname, "../../src/locales"),
    },
  },
  plugins: [
    svgr(),
    react(),
    contentSecurityPolicy(
      loadEnv(mode, resolve(__dirname, "../.."), "RENDERER_VITE_")
        .RENDERER_VITE_EXTERNAL_RESOURCES_URL
    ),
  ],
}));
