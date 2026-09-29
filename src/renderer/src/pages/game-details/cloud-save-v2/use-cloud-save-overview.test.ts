// eslint-disable-next-line @typescript-eslint/triple-slash-reference
/// <reference path="../../../declaration.d.ts" />

import assert from "node:assert/strict";
import { register } from "node:module";
import { afterEach, describe, it } from "node:test";

import { JSDOM } from "jsdom";
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";

import { isManualCloudSaveV2Blocked } from "../../../../../shared/cloud-save-shops.js";
import type { CloudSaveOverview } from "@types";

// @ts-ignore The Node ESM test runner requires the source extension.
import { useCloudSaveOverview } from "./use-cloud-save-overview.ts";

const desktopPanelUrl = new URL("./cloud-save-modal.tsx", import.meta.url).href;
const bigPicturePanelUrl = new URL(
  "../../../../../big-picture/src/components/pages/game/cloud-save-v2/cloud-save-modal.tsx",
  import.meta.url
).href;
const presentationUrl = new URL("./cloud-save-presentation.ts", import.meta.url)
  .href;
const typescriptUrl = import.meta.resolve("typescript");
const virtualModules: Record<string, string> = {
  "@phosphor-icons/react": `
    const Icon = () => null;
    export const ArrowClockwiseIcon = Icon;
    export const CircleNotchIcon = Icon;
    export const CloudArrowDownIcon = Icon;
    export const CloudArrowUpIcon = Icon;
    export const CloudCheckIcon = Icon;
    export const CloudIcon = Icon;
    export const FolderOpenIcon = Icon;
    export const MonitorIcon = Icon;
    export const SpinnerIcon = Icon;
    export const ToggleLeftIcon = Icon;
    export const ToggleRightIcon = Icon;
    export const WarningCircleIcon = Icon;
  `,
  "react-i18next": "export const useTranslation = () => ({ t: (key) => key });",
  "react-loading-skeleton": `
    export default function Skeleton() { return null; }
    export const SkeletonTheme = ({ children }) => children;
  `,
  "@shared": "export const formatBytes = (bytes) => String(bytes);",
  "@renderer/hooks":
    "export const useDate = () => ({ formatDateTime: (date) => date });",
  "../../../../hooks":
    "export const useDate = () => ({ formatDateTime: (date) => date });",
  "@renderer/components": `
    export const Button = globalThis.__cloudSaveUiTestBoundary.Button;
    export const Modal = globalThis.__cloudSaveUiTestBoundary.Wrapper;
  `,
  "../../../common": `
    export const Button = globalThis.__cloudSaveUiTestBoundary.Button;
    export const HorizontalFocusGroup = globalThis.__cloudSaveUiTestBoundary.Wrapper;
    export const VerticalFocusGroup = globalThis.__cloudSaveUiTestBoundary.Wrapper;
    export const Modal = globalThis.__cloudSaveUiTestBoundary.Wrapper;
  `,
};
const loaderSource = `
  import { readFile } from "node:fs/promises";
  import ts from ${JSON.stringify(typescriptUrl)};
  const targets = new Set(${JSON.stringify([desktopPanelUrl, bigPicturePanelUrl])});
  const modules = ${JSON.stringify(virtualModules)};
  const presentationUrl = ${JSON.stringify(presentationUrl)};
  export async function resolve(specifier, context, nextResolve) {
    if (targets.has(context.parentURL) && specifier in modules) {
      return {
        url: "data:text/javascript," + encodeURIComponent(modules[specifier]),
        shortCircuit: true,
      };
    }
    if (targets.has(context.parentURL) &&
        (specifier === "./cloud-save-presentation" ||
         specifier === "@renderer/pages/game-details/cloud-save-v2/cloud-save-presentation")) {
      return nextResolve(presentationUrl, context);
    }
    if (context.parentURL === ${JSON.stringify(bigPicturePanelUrl)} &&
        specifier === "./cloud-save-v2-presentation") {
      return nextResolve(new URL("./cloud-save-v2-presentation.ts", context.parentURL).href, context);
    }
    return nextResolve(specifier, context);
  }
  export async function load(url, context, nextLoad) {
    if (targets.has(url)) {
      const source = await readFile(new URL(url), "utf8");
      return {
        format: "module",
        source: ts.transpileModule(source, {
          compilerOptions: {
            jsx: ts.JsxEmit.ReactJSX,
            module: ts.ModuleKind.ESNext,
            target: ts.ScriptTarget.ES2022,
          },
          fileName: new URL(url).pathname,
        }).outputText,
        shortCircuit: true,
      };
    }
    return nextLoad(url, context);
  }
`;
register(
  `data:text/javascript,${encodeURIComponent(loaderSource)}`,
  import.meta.url
);

const uiBoundary = {
  Button: ({
    children,
    disabled,
    onClick,
    focusId,
    ...props
  }: {
    children?: ReactNode;
    disabled?: boolean;
    onClick?: () => void;
    focusId?: string;
    "aria-label"?: string;
  }) =>
    createElement(
      "button",
      {
        disabled,
        onClick,
        "data-focus-id": focusId,
        "aria-label": props["aria-label"],
      },
      children
    ),
  Wrapper: ({ children }: { children?: ReactNode }) => children,
};
(
  globalThis as typeof globalThis & {
    __cloudSaveUiTestBoundary: typeof uiBoundary;
  }
).__cloudSaveUiTestBoundary = uiBoundary;

const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
const originalDocument = Object.getOwnPropertyDescriptor(
  globalThis,
  "document"
);
const originalActEnvironment = Object.getOwnPropertyDescriptor(
  globalThis,
  "IS_REACT_ACT_ENVIRONMENT"
);
let root: Root | null = null;
let dom: JSDOM | null = null;

const restoreGlobal = (name: string, original?: PropertyDescriptor) => {
  if (original) {
    Object.defineProperty(globalThis, name, original);
  } else {
    Reflect.deleteProperty(globalThis, name);
  }
};

afterEach(async () => {
  if (root) {
    await act(async () => root?.unmount());
    root = null;
  }
  dom?.window.close();
  dom = null;
  restoreGlobal("window", originalWindow);
  restoreGlobal("document", originalDocument);
  restoreGlobal("IS_REACT_ACT_ENVIRONMENT", originalActEnvironment);
});

interface FakeElectron {
  getCloudSaveOverview: () => Promise<CloudSaveOverview>;
  getCloudSaveAutomaticSyncEnabled: () => Promise<boolean>;
  onCloudSaveAutomaticSyncModeChanged: () => () => void;
}

const mountOverview = async (
  electron: FakeElectron,
  renderContent?: (state: ReturnType<typeof useCloudSaveOverview>) => ReactNode
) => {
  dom = new JSDOM("<!doctype html><html><body></body></html>");
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: dom.window,
  });
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: dom.window.document,
  });
  Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
    configurable: true,
    value: true,
  });
  Object.defineProperty(dom.window, "electron", { value: electron });

  let result: ReturnType<typeof useCloudSaveOverview> | null = null;
  const HookHarness = () => {
    result = useCloudSaveOverview({
      objectId: "namespace:playableItemId",
      shop: "epic",
      enabled: true,
    });
    return result && renderContent ? renderContent(result) : null;
  };
  const container = dom.window.document.createElement("div");
  dom.window.document.body.append(container);
  root = createRoot(container);
  await act(async () => root?.render(createElement(HookHarness)));
  return () => result;
};

describe("Epic automatic sync mode on overview failure", () => {
  it("loads persisted V2 mode despite failed save analysis", async () => {
    const current = await mountOverview({
      getCloudSaveOverview: async () => {
        throw new Error("save scanner failed");
      },
      getCloudSaveAutomaticSyncEnabled: async () => true,
      onCloudSaveAutomaticSyncModeChanged: () => () => undefined,
    });

    assert.equal(current()?.overview, null);
    assert.equal(current()?.hasRefreshError, true);
    assert.equal(current()?.isAutomaticSyncEnabled, true);
    assert.equal(
      isManualCloudSaveV2Blocked(
        "epic",
        true,
        current()?.isAutomaticSyncEnabled ?? null
      ),
      false
    );
  });

  it("keeps legacy mode distinct from V2 when analysis fails", async () => {
    const current = await mountOverview({
      getCloudSaveOverview: async () => {
        throw new Error("save scanner failed");
      },
      getCloudSaveAutomaticSyncEnabled: async () => false,
      onCloudSaveAutomaticSyncModeChanged: () => () => undefined,
    });

    assert.equal(current()?.hasRefreshError, true);
    assert.equal(current()?.isAutomaticSyncEnabled, false);
    assert.equal(
      isManualCloudSaveV2Blocked(
        "epic",
        true,
        current()?.isAutomaticSyncEnabled ?? null
      ),
      true
    );
  });

  it("reads persisted mode before a stalled analysis finishes", async () => {
    let rejectOverview: ((error: Error) => void) | undefined;
    const pendingOverview = new Promise<CloudSaveOverview>(
      (_resolve, reject) => {
        rejectOverview = reject;
      }
    );
    const current = await mountOverview({
      getCloudSaveOverview: () => pendingOverview,
      getCloudSaveAutomaticSyncEnabled: async () => true,
      onCloudSaveAutomaticSyncModeChanged: () => () => undefined,
    });

    assert.equal(current()?.isAutomaticSyncEnabled, true);
    assert.equal(current()?.isRefreshing, true);
    await act(async () => rejectOverview?.(new Error("save scanner failed")));
    assert.equal(current()?.hasRefreshError, true);
  });

  for (const surface of [
    {
      name: "desktop",
      url: desktopPanelUrl,
      exportName: "CloudSavePanel",
      selector: '[role="switch"]',
    },
    {
      name: "Big Picture",
      url: bigPicturePanelUrl,
      exportName: "BigPictureCloudSavePanel",
      selector: '[data-focus-id="big-picture-cloud-save-toggle"]',
    },
  ]) {
    it(`lets ${surface.name} switch from legacy mode after analysis rejects`, async () => {
      const panelModule = await import(surface.url);
      const Panel = panelModule[surface.exportName];
      const modeChanges: boolean[] = [];
      const current = await mountOverview(
        {
          getCloudSaveOverview: async () => {
            throw new Error("save scanner failed");
          },
          getCloudSaveAutomaticSyncEnabled: async () => false,
          onCloudSaveAutomaticSyncModeChanged: () => () => undefined,
        },
        (state) =>
          createElement(Panel, {
            showLaunchConflictWarning: false,
            overview: state.overview,
            isAutomaticSyncEnabled: state.isAutomaticSyncEnabled,
            isLoading: state.isRefreshing,
            isSyncing: false,
            isGameRunning: false,
            hasExecutablePath: true,
            manualSyncBlocked: isManualCloudSaveV2Blocked(
              "epic",
              true,
              state.isAutomaticSyncEnabled
            ),
            hasError: state.hasRefreshError,
            errorMessageKey: state.hasRefreshError
              ? "cloud_save_v2_load_error"
              : null,
            progress: null,
            onSync: () => undefined,
            onOpenFileBrowser: () => undefined,
            onSelectExecutable: () => undefined,
            onAutomaticSyncChange: async (enabled: boolean) => {
              modeChanges.push(enabled);
            },
            onResolveConflict: () => undefined,
          })
      );

      assert.equal(current()?.overview, null);
      assert.equal(current()?.hasRefreshError, true);
      assert.equal(current()?.isAutomaticSyncEnabled, false);
      const toggle = dom?.window.document.querySelector(surface.selector);
      assert.ok(toggle, `${surface.name} switch should render`);
      assert.equal(toggle.hasAttribute("disabled"), false);

      await act(async () => {
        (toggle as HTMLButtonElement).click();
      });
      assert.deepEqual(modeChanges, [true]);
    });
  }
});
