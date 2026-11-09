import react from "@vitejs/plugin-react";
import {
  defineConfig,
  externalizeDepsPlugin,
  loadEnv,
  swcPlugin,
} from "electron-vite";
import JavaScriptObfuscator from "javascript-obfuscator";
import { resolve } from "path";
import { transformWithEsbuild, type Plugin } from "vite";
import svgr from "vite-plugin-svgr";
import { scopeBigPictureCss } from "./src/big-picture/vite-scope-big-picture-css";

const mangleIdentifiers = (): Plugin => ({
  name: "hydra:mangle-identifiers",
  apply: "build",
  renderChunk: async (code, chunk) => {
    const result = await transformWithEsbuild(code, chunk.fileName, {
      loader: "js",
      format: "esm",
      charset: "utf8",
      minify: true,
    });

    return { code: result.code, map: null };
  },
});

const rendererContentSecurityPolicy = (
  externalResourcesUrl: string | undefined
): Plugin => ({
  name: "hydra:renderer-content-security-policy",
  transformIndexHtml: (_html, context) => {
    const scriptSources = [
      "'self'",
      ...(externalResourcesUrl ? [new URL(externalResourcesUrl).origin] : []),
      // React Refresh injects an inline preamble that only exists on the dev server.
      ...(context.server ? ["'unsafe-inline'"] : []),
    ];

    return [
      {
        tag: "meta",
        attrs: {
          "http-equiv": "Content-Security-Policy",
          content: [
            "default-src 'self' 'unsafe-inline' * data: local: blob:",
            `script-src ${scriptSources.join(" ")}`,
            "worker-src 'self' blob:",
            "object-src 'none'",
            "base-uri 'self'",
            "media-src 'self' 'unsafe-inline' * data: local: blob:",
          ].join("; "),
        },
        injectTo: "head-prepend",
      },
    ];
  },
});

const buildSeed = Math.floor(Math.random() * 2 ** 31);

const obfuscate = (): Plugin => ({
  name: "hydra:obfuscate",
  apply: "build",
  generateBundle: (_options, bundle) => {
    for (const file of Object.values(bundle)) {
      if (file.type !== "chunk") continue;

      file.code = JavaScriptObfuscator.obfuscate(file.code, {
        target: "node",
        seed: buildSeed,
        compact: true,
        simplify: true,
        identifierNamesGenerator: "mangled",
        renameGlobals: false,
        stringArray: true,
        stringArrayThreshold: 0.8,
        stringArrayEncoding: ["base64"],
        stringArrayRotate: true,
        stringArrayShuffle: true,
        stringArrayIndexShift: true,
        splitStrings: false,
        numbersToExpressions: false,
        controlFlowFlattening: false,
        deadCodeInjection: false,
        selfDefending: false,
        debugProtection: false,
        disableConsoleOutput: false,
        sourceMap: false,
      }).getObfuscatedCode();
    }
  },
});

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode);
  const contentSecurityPolicy = rendererContentSecurityPolicy(
    env.RENDERER_VITE_EXTERNAL_RESOURCES_URL
  );

  const isProduction = mode === "production";
  const minify = isProduction ? "esbuild" : false;
  const sourcemap = !isProduction;

  return {
    main: {
      build: {
        minify,
        sourcemap,
      },
      resolve: {
        alias: {
          "@main": resolve("src/main"),
          "@locales": resolve("src/locales"),
          "@resources": resolve("resources"),
          "@shared": resolve("src/shared"),
        },
      },
      plugins: [
        externalizeDepsPlugin(),
        swcPlugin(),
        ...(isProduction ? [mangleIdentifiers(), obfuscate()] : []),
      ],
    },
    preload: {
      build: {
        minify,
      },
      plugins: [
        externalizeDepsPlugin(),
        ...(isProduction ? [obfuscate()] : []),
      ],
    },
    bigPicture: {
      root: "src/big-picture",
      build: {
        outDir: "out/big-picture",
        rollupOptions: {
          input: resolve("src/big-picture/index.html"),
        },
      },
      css: {
        postcss: {
          plugins: [scopeBigPictureCss()],
        },
      },
      resolve: {
        alias: {
          "@renderer": resolve("src/renderer/src"),
          "@locales": resolve("src/locales"),
          "@shared": resolve("src/shared"),
        },
      },
      plugins: [svgr(), react(), contentSecurityPolicy],
    },
    renderer: {
      build: {
        minify,
        sourcemap,
      },
      esbuild: {
        keepNames: !isProduction,
      },
      css: {
        postcss: {
          plugins: [scopeBigPictureCss()],
        },
        preprocessorOptions: {
          scss: {
            api: "modern",
          },
        },
      },
      resolve: {
        alias: {
          "@renderer": resolve("src/renderer/src"),
          "@locales": resolve("src/locales"),
          "@shared": resolve("src/shared"),
        },
      },
      plugins: [svgr(), react(), contentSecurityPolicy],
    },
  };
});
