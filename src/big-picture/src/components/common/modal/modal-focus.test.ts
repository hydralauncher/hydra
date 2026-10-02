import { after, before, describe, it } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
import { JSDOM } from "jsdom";

const require = createRequire(import.meta.url);
const projectRoot = fileURLToPath(
  new URL("../../../../../../", import.meta.url)
);
const previousGlobals = new Map<string, PropertyDescriptor | undefined>();
let dom: JSDOM;
let directory: string;
let verifyModalFocus: (
  enabled: boolean,
  navigateBeforeActivation: boolean
) => Promise<void>;

function setGlobal(key: string, value: unknown) {
  previousGlobals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
  Object.defineProperty(globalThis, key, { configurable: true, value });
}

before(async () => {
  dom = new JSDOM('<div id="root"></div><div id="big-picture"></div>', {
    pretendToBeVisual: true,
    url: "http://localhost/",
  });
  const window = dom.window;
  for (const key of [
    "window",
    "document",
    "self",
    "Window",
    "HTMLElement",
    "Element",
    "Node",
    "KeyboardEvent",
    "MouseEvent",
    "HTMLInputElement",
    "HTMLTextAreaElement",
    "SVGElement",
    "CustomEvent",
    "FocusEvent",
    "localStorage",
  ] as const) {
    setGlobal(key, window[key]);
  }
  for (const key of [
    "getComputedStyle",
    "requestAnimationFrame",
    "cancelAnimationFrame",
    "addEventListener",
    "removeEventListener",
  ] as const) {
    setGlobal(key, window[key].bind(window));
  }
  setGlobal("navigator", window.navigator);
  setGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  // jsdom has no layout or scrolling. Model visible, rendered modal controls.
  window.scrollTo = () => {};
  window.HTMLElement.prototype.getClientRects = function () {
    return (this.hidden || this.style.display === "none"
      ? []
      : [{}]) as unknown as DOMRectList;
  };

  directory = await mkdtemp(join(tmpdir(), "hydra-modal-focus-"));
  const output = join(directory, "fixture.mjs");
  // Bundle TSX and ignore assets so Node runs the production React components.
  // External imports use project-resolved URLs, including when temp is on Windows.
  await build({
    entryPoints: [
      fileURLToPath(new URL("./modal-focus.fixture.tsx", import.meta.url)),
    ],
    bundle: true,
    platform: "node",
    format: "esm",
    packages: "external",
    outfile: output,
    tsconfig: join(projectRoot, "tsconfig.web.json"),
    plugins: [
      {
        name: "test-package-resolution",
        setup(builder) {
          builder.onResolve(
            { filter: /^(lodash-es|electron-log)\// },
            (args) => ({
              path: require.resolve(args.path),
            })
          );
          builder.onResolve({ filter: /^[^./]/ }, (args) => {
            if (isAbsolute(args.path)) return;
            if (/^@(shared|types|renderer|locales)(\/|$)/.test(args.path))
              return;
            return { path: import.meta.resolve(args.path), external: true };
          });
        },
      },
    ],
    loader: {
      ".scss": "empty",
      ".css": "empty",
      ".wav": "text",
      ".png": "text",
      ".svg": "text",
      ".jpg": "text",
      ".webp": "text",
    },
    define: { "process.env.NODE_ENV": '"test"' },
  });
  ({ verifyModalFocus } = await import(pathToFileURL(output).href));
});

after(async () => {
  dom?.window.close();
  for (const [key, descriptor] of previousGlobals) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
  if (directory) await rm(directory, { recursive: true, force: true });
});

describe("modal physical keyboard focus", () => {
  for (const setting of [undefined, true, false]) {
    for (const navigateBeforeActivation of [false, true]) {
      const activation = navigateBeforeActivation
        ? "after controller navigation"
        : "directly after Tab";
      it(`supports typing, Tab, Shift+Tab and activation ${activation} with virtual keyboard ${setting ?? "enabled by default"}`, async () => {
        Object.defineProperty(dom.window, "electron", {
          configurable: true,
          value: {
            getUserPreferences: async () =>
              setting === undefined
                ? null
                : { bigPictureVirtualKeyboardEnabled: setting },
          },
        });
        await verifyModalFocus(setting ?? true, navigateBeforeActivation);
      });
    }
  }
});
