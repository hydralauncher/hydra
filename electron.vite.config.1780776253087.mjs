// electron.vite.config.ts
import react from "@vitejs/plugin-react";
import {
  defineConfig,
  externalizeDepsPlugin,
  loadEnv,
  swcPlugin
} from "electron-vite";
import { resolve } from "path";
import svgr from "vite-plugin-svgr";

// src/big-picture/vite-scope-big-picture-css.ts
var BIG_PICTURE_ROOT_SELECTOR = "#big-picture";
var BIG_PICTURE_PATH_FRAGMENT = "/src/big-picture/";
var RENDERER_PATH_FRAGMENT = "/src/renderer/";
var ROOT_SELECTOR_ALIASES = /* @__PURE__ */ new Set([":root", "html", "body", "#root"]);
var isBigPictureStyle = (filePath) => {
  if (!filePath) return false;
  return filePath.replaceAll("\\", "/").includes(BIG_PICTURE_PATH_FRAGMENT);
};
var isRendererStyle = (filePath) => {
  if (!filePath) return false;
  return filePath.replaceAll("\\", "/").includes(RENDERER_PATH_FRAGMENT);
};
var shouldSkipRule = (rule) => {
  const parent = rule.parent;
  return parent?.type === "atrule" && "name" in parent && parent.name.toLowerCase().endsWith("keyframes");
};
var shouldSkipExclusion = (selector) => {
  const trimmed = selector.trim();
  if (!trimmed) return true;
  if (trimmed === "*") return true;
  if (ROOT_SELECTOR_ALIASES.has(trimmed)) return true;
  if (trimmed.includes("::")) return true;
  return false;
};
var scopeSelector = (selector) => {
  const trimmedSelector = selector.trim();
  if (!trimmedSelector) return selector;
  if (trimmedSelector === BIG_PICTURE_ROOT_SELECTOR || trimmedSelector.startsWith(`${BIG_PICTURE_ROOT_SELECTOR} `) || trimmedSelector.startsWith(`${BIG_PICTURE_ROOT_SELECTOR}:`)) {
    return selector;
  }
  if (ROOT_SELECTOR_ALIASES.has(trimmedSelector)) {
    return BIG_PICTURE_ROOT_SELECTOR;
  }
  return `${BIG_PICTURE_ROOT_SELECTOR} ${selector}`;
};
var excludeFromBigPicture = (selector) => {
  if (shouldSkipExclusion(selector)) {
    return selector;
  }
  return `${selector}:where(:not(${BIG_PICTURE_ROOT_SELECTOR} *))`;
};
var scopeBigPictureCss = () => ({
  postcssPlugin: "scope-big-picture-css",
  Rule(rule) {
    if (shouldSkipRule(rule)) {
      return;
    }
    if (isBigPictureStyle(rule.source?.input.file)) {
      rule.selectors = rule.selectors.map(scopeSelector);
      return;
    }
    if (isRendererStyle(rule.source?.input.file)) {
      rule.selectors = rule.selectors.map(excludeFromBigPicture);
    }
  }
});

// electron.vite.config.ts
var electron_vite_config_default = defineConfig(({ mode }) => {
  loadEnv(mode);
  return {
    main: {
      build: {
        sourcemap: true
      },
      resolve: {
        alias: {
          "@main": resolve("src/main"),
          "@locales": resolve("src/locales"),
          "@resources": resolve("resources"),
          "@shared": resolve("src/shared")
        }
      },
      plugins: [externalizeDepsPlugin(), swcPlugin()]
    },
    preload: {
      plugins: [externalizeDepsPlugin()]
    },
    bigPicture: {
      root: "src/big-picture",
      build: {
        outDir: "out/big-picture",
        rollupOptions: {
          input: resolve("src/big-picture/index.html")
        }
      },
      css: {
        postcss: {
          plugins: [scopeBigPictureCss()]
        }
      },
      resolve: {
        alias: {
          "@locales": resolve("src/locales"),
          "@shared": resolve("src/shared")
        }
      },
      plugins: [react()]
    },
    renderer: {
      build: {
        sourcemap: true
      },
      css: {
        postcss: {
          plugins: [scopeBigPictureCss()]
        },
        preprocessorOptions: {
          scss: {
            api: "modern"
          }
        }
      },
      resolve: {
        alias: {
          "@renderer": resolve("src/renderer/src"),
          "@locales": resolve("src/locales"),
          "@shared": resolve("src/shared")
        }
      },
      plugins: [svgr(), react()]
    }
  };
});
export {
  electron_vite_config_default as default
};
