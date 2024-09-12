import { resolve } from "path";
import {
  defineConfig,
  loadEnv,
  swcPlugin,
  externalizeDepsPlugin,
} from "electron-vite";
import react from "@vitejs/plugin-react";
import { sentryVitePlugin } from "@sentry/vite-plugin";
import { vanillaExtractPlugin } from "@vanilla-extract/vite-plugin";
import svgr from "vite-plugin-svgr";

const sentryPlugin = sentryVitePlugin({
  authToken: process.env.SENTRY_AUTH_TOKEN,
  org: "hydra-launcher",
  project: "hydra-launcher",
});

export default defineConfig(({ mode }) => {
  loadEnv(mode);

  return {
    main: {
      build: {
        sourcemap: true,
        rollupOptions: {
          external: ["better-sqlite3"],
        },
      },
      resolve: {
        alias: {
          "@main": resolve("src/main"),
          "@locales": resolve("src/locales"),
          "@resources": resolve("resources"),
          "@shared": resolve("src/shared"),
        },
      },
      plugins: [externalizeDepsPlugin(), swcPlugin(), sentryPlugin],
    },
    preload: {
      plugins: [externalizeDepsPlugin()],
    },
    renderer: {
      build: {
        sourcemap: true,
      },
      resolve: {
        alias: {
          "@renderer": resolve("src/renderer/src"),
          "@locales": resolve("src/locales"),
          "@shared": resolve("src/shared"),
        },
      },
      plugins: [svgr(), react(), vanillaExtractPlugin(), sentryPlugin],
    },
  };
});
