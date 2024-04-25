import { resolve } from "path";
import {
  defineConfig,
  loadEnv,
  swcPlugin,
  externalizeDepsPlugin,
  bytecodePlugin,
} from "electron-vite";
import react from "@vitejs/plugin-react";
import { vanillaExtractPlugin } from "@vanilla-extract/vite-plugin";
import svgr from "vite-plugin-svgr";

export default defineConfig(({ mode }) => {
  loadEnv(mode);

  return {
    main: {
      build: {
        rollupOptions: {
          external: ["better-sqlite3"],
        },
      },
      resolve: {
        alias: {
          "@main": resolve("src/main"),
          "@locales": resolve("src/locales"),
        },
      },
      plugins: [externalizeDepsPlugin(), swcPlugin(), bytecodePlugin()],
    },
    preload: {
      plugins: [externalizeDepsPlugin()],
    },
    renderer: {
      resolve: {
        alias: {
          "@renderer": resolve("src/renderer/src"),
          "@locales": resolve("src/locales"),
        },
      },
      plugins: [svgr(), react(), vanillaExtractPlugin(), bytecodePlugin()],
    },
  };
});
