import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import { describe, it, type TestContext } from "node:test";
import { JSDOM } from "jsdom";
import * as React from "react";
import { createRoot } from "react-dom/client";
import ts from "typescript";
import * as epicInstallTimingModule from "../helpers/epic-install-timing.js";
import type {
  EpicCloudSaveState,
  EpicGameInstallOptions,
  LibraryGame,
  StartEpicGameDownloadPayload,
} from "@types";
import type { useEpicInstall } from "./use-epic-install";
import type {
  useEpicCloudSaves,
  useEpicManagedConnection,
} from "./use-epic-managed";
import type { useEpicCloudSaveControls } from "./use-epic-cloud-save-controls";
import type { useGameLinuxCompatibility } from "./use-game-linux-compatibility";
import type {
  getEpicLaunchError,
  getEpicManagedError,
} from "../helpers/epic-managed-error";
import {
  getInstalledStoreMembers,
  getOfficialStoreMembers,
  isEpicMemberInCurrentScope,
} from "../../../shared/official-store-options.js";

const requireModule = createRequire(import.meta.url);
function loadModule(filename: string, stubs: Record<string, unknown> = {}) {
  const { outputText } = ts.transpileModule(
    fs.readFileSync(new URL(filename, import.meta.url), "utf8"),
    {
      compilerOptions: {
        target: ts.ScriptTarget.ESNext,
        module: ts.ModuleKind.CommonJS,
        jsx: ts.JsxEmit.ReactJSX,
        esModuleInterop: true,
      },
      fileName: filename,
    }
  );
  const exports: Record<string, unknown> = {};
  new Function("exports", "require", outputText)(
    exports,
    (name: string) =>
      stubs[name] ??
      (name.endsWith("/epic-install-timing")
        ? epicInstallTimingModule
        : requireModule(name))
  );
  return exports;
}

function loadInstallHook(downloadsPath?: string | (() => string | undefined)) {
  return loadModule("./use-epic-install.ts", {
    "./redux": {
      useAppSelector: (
        select: (state: {
          userPreferences: { value: { downloadsPath?: string } };
        }) => unknown
      ) =>
        select({
          userPreferences: {
            value: {
              downloadsPath:
                typeof downloadsPath === "function"
                  ? downloadsPath()
                  : downloadsPath,
            },
          },
        }),
    },
  }).useEpicInstall as typeof useEpicInstall;
}

function loadInstallModal(
  hook: typeof useEpicInstall,
  lastPacket: unknown = null,
  translations: Record<string, string> = {}
) {
  return loadModule("../pages/game-details/modals/epic-install-modal.tsx", {
    "@renderer/hooks/use-epic-install": { useEpicInstall: hook },
    "@renderer/hooks/use-download": { useDownload: () => ({ lastPacket }) },
    "@renderer/components": {
      Button: ({ children, ...props }: React.ComponentProps<"button">) =>
        React.createElement("button", props, children),
      Link: ({ to }: { to: string }) =>
        React.createElement("a", { href: to }, "settings"),
      Modal: ({
        title,
        description,
        children,
      }: {
        title: string;
        description?: string;
        children: React.ReactNode;
      }) =>
        React.createElement(
          "section",
          null,
          React.createElement("h2", null, title),
          React.createElement(
            "p",
            { "data-header-description": true },
            description
          ),
          children
        ),
      TextField: ({
        label,
        rightContent,
        ...props
      }: React.ComponentProps<"input"> & {
        label: string;
        rightContent: React.ReactNode;
      }) =>
        React.createElement(
          "label",
          null,
          label,
          React.createElement("input", props),
          rightContent
        ),
      SelectField: ({
        options,
        label,
        ...props
      }: React.ComponentProps<"select"> & {
        label: string;
        options: { key: string; value: string; label: string }[];
      }) =>
        React.createElement(
          "label",
          null,
          label,
          React.createElement(
            "select",
            props,
            options.map(({ key, value, label: text }) =>
              React.createElement("option", { key, value }, text)
            )
          )
        ),
    },
    "@renderer/components/vertical-cover-card/vertical-cover-card-image-sources":
      loadModule(
        "../components/vertical-cover-card/vertical-cover-card-image-sources.ts"
      ),
    "react-i18next": {
      useTranslation: () => ({
        t: (key: string, values?: { space?: string; size?: string }) =>
          translations[key] ??
          (values ? `${key}:${values.space ?? values.size}` : key),
      }),
      Trans: ({
        children,
        i18nKey,
        values,
      }: {
        children?: React.ReactNode;
        i18nKey: string;
        values?: { size: string };
      }) =>
        values
          ? React.createElement(
              React.Fragment,
              null,
              `${i18nKey}:`,
              React.createElement("strong", null, values.size)
            )
          : React.createElement(
              React.Fragment,
              null,
              "select_folder_hint",
              children
            ),
    },
    "@primer/octicons-react": Object.fromEntries(
      ["DownloadIcon", "ImageIcon", "PlusIcon", "SyncIcon"].map((name) => [
        name,
        () => React.createElement("svg", { "data-icon": name }),
      ])
    ),
    "react-router-dom": { useNavigate: () => () => {} },
    "@shared": { formatBytes: (size: number) => `${size}B` },
    "@renderer/helpers/epic-managed-error": loadModule(
      "../helpers/epic-managed-error.ts",
      {
        "../pages/settings/settings-epic-state": {
          getEpicErrorTranslation: (code: string) => `epic_error_${code}`,
        },
      }
    ),
    "./epic-install-modal.scss": {},
    "./download-settings-modal.scss": {},
  }).EpicInstallModal as React.FunctionComponent<{
    game: LibraryGame;
    presentationGame?: LibraryGame;
    onClose: () => void;
    onStarted: () => void;
  }>;
}

async function fixture(t: TestContext, bridge: Record<string, unknown>) {
  const dom = new JSDOM("<div id='root'></div>");
  const globals = {
    window: dom.window,
    document: dom.window.document,
    IS_REACT_ACT_ENVIRONMENT: true,
  };
  const previous = new Map(
    Object.keys(globals).map((key) => [
      key,
      Object.getOwnPropertyDescriptor(globalThis, key),
    ])
  );
  for (const [key, value] of Object.entries(globals))
    Object.defineProperty(globalThis, key, {
      value,
      configurable: true,
      writable: true,
    });
  Object.assign(dom.window, {
    electron: {
      platform: "win32",
      getEpicConnection: async () => ({ connection: { connected: false } }),
      onEpicConnectionChanged: () => () => {},
      setEpicCloudSaveSettings: async () => ({ ok: true }),
      syncEpicCloudSaves: async () => state(),
      resolveEpicCloudSaveConflict: async () => state(),
      onEpicCloudSaveStateChanged: () => () => {},
      ...bridge,
    },
  });
  const root = createRoot(dom.window.document.getElementById("root")!);
  let unmounted = false;
  const unmount = async () => {
    if (unmounted) return;
    unmounted = true;
    await React.act(async () => root.unmount());
  };
  t.after(async () => {
    await unmount();
    dom.window.close();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  });
  const render = async (component: React.ReactElement) =>
    React.act(async () => root.render(component));
  return { render, unmount };
}
const state = (
  overrides: Partial<EpicCloudSaveState> = {}
): EpicCloudSaveState => ({
  epicObjectId: "namespace:executable",
  status: "up-to-date",
  supportsCloudSaves: true,
  automaticSync: true,
  savePath: "C:\\saves",
  pendingUpload: false,
  remoteManifest: "remote-v1",
  ...overrides,
});

describe("Epic managed UI lifecycle", () => {
  for (const [platform, capability, expected] of [
    ["win32", undefined, true],
    ["linux", undefined, false],
    ["linux", true, true],
    ["linux", false, false],
    ["win32", false, false],
    ["darwin", undefined, false],
  ] as const) {
    it(`keeps bridge availability separate from installation support on ${platform} (${capability})`, async (t) => {
      const { render } = await fixture(t, {
        platform,
        getEpicGameInstallOptions: async () => ({ options: [] }),
        startEpicGameDownload: async () => ({ ok: true }),
        getEpicConnection: async () => ({
          connection: { connected: false },
          ...(capability === undefined
            ? {}
            : { managedInstallation: { available: capability } }),
        }),
      });
      const hook = loadModule("./use-epic-managed.ts")
        .useEpicManagedConnection as typeof useEpicManagedConnection;
      let current!: ReturnType<typeof hook>;
      function Harness() {
        current = hook();
        return null;
      }
      await render(React.createElement(Harness));
      assert.equal(current.available, true);
      assert.equal(current.installationAvailable, expected);
    });
  }

  it("reads the real game's effective Linux context and ignores older identities and preferences", async (t) => {
    const requests: Array<{
      shop: string;
      objectId: string;
      resolve: (value: unknown) => void;
    }> = [];
    const { render } = await fixture(t, {
      platform: "linux",
      getGameLinuxCompatibility: (shop: string, objectId: string) =>
        new Promise((resolve) => requests.push({ shop, objectId, resolve })),
    });
    const hook = loadModule("./use-game-linux-compatibility.ts")
      .useGameLinuxCompatibility as typeof useGameLinuxCompatibility;
    let game = {
      shop: "epic",
      objectId: "actual:epic",
      catalogueGame: { shop: "steam", objectId: "presentation" },
    } as LibraryGame;
    let current!: ReturnType<typeof hook>;
    function Harness() {
      current = hook(game);
      return null;
    }
    await render(React.createElement(Harness));
    assert.equal(requests[0].shop, "epic");
    assert.equal(requests[0].objectId, "actual:epic");
    game = { ...game, objectId: "second:epic" };
    await render(React.createElement(Harness));
    await React.act(async () =>
      requests[0].resolve({
        winePrefixPath: "/stale",
        protonName: "old",
        protonSource: "umu",
      })
    );
    assert.equal(current.compatibility, null);
    await React.act(async () =>
      requests[1].resolve({
        winePrefixPath: "/prefixes/epic/confirmed",
        protonName: "UMU-Proton",
        protonSource: "umu",
      })
    );
    assert.equal(
      (current as ReturnType<typeof hook>).compatibility?.winePrefixPath,
      "/prefixes/epic/confirmed"
    );
    game = { ...game, protonPath: "/custom/Proton" };
    await render(React.createElement(Harness));
    assert.equal(current.compatibility, null);
    assert.equal(requests.length, 3);
    await render(React.createElement("div"));
    await React.act(async () => requests[2].resolve(null));
  });

  it("keeps the Linux context read optional for older bridges and inactive controls", async (t) => {
    const { render } = await fixture(t, { platform: "linux" });
    const hook = loadModule("./use-game-linux-compatibility.ts")
      .useGameLinuxCompatibility as typeof useGameLinuxCompatibility;
    const game = { shop: "epic", objectId: "actual:epic" } as LibraryGame;
    let current!: ReturnType<typeof hook>;
    let enabled = true;
    function Harness() {
      current = hook(game, enabled);
      return null;
    }
    await render(React.createElement(Harness));
    assert.equal(current.compatibility, null);
    let reads = 0;
    Object.assign(Reflect.get(window, "electron") as object, {
      getGameLinuxCompatibility: async () => {
        reads++;
        throw new Error("context unavailable");
      },
    });
    enabled = false;
    await render(React.createElement(Harness));
    assert.equal(reads, 0);
    enabled = true;
    await render(React.createElement(Harness));
    assert.equal(reads, 1);
    assert.equal(current.compatibility, null);
  });

  it("shows the effective automatic prefix in the existing Big Picture controls and restores it after clearing a custom prefix", async (t) => {
    const selected: unknown[][] = [];
    const { render } = await fixture(t, {
      platform: "linux",
      getGameLinuxCompatibility: async () => ({
        winePrefixPath: "/prefixes/epic/automatic",
        protonName: "UMU-Proton-test",
        protonSource: "umu",
      }),
      getInstalledProtonVersions: async () => [],
      isGamemodeAvailable: async () => false,
      isMangohudAvailable: async () => false,
      selectGameWinePrefix: async (...args: unknown[]) => selected.push(args),
    });
    const wrap = ({ children }: { children: React.ReactNode }) =>
      React.createElement("div", null, children);
    const hook = loadModule("./use-game-linux-compatibility.ts");
    const Tab = loadModule(
      "../../../big-picture/src/components/pages/game/game-settings-modal/compatibility-tab.tsx",
      {
        "@renderer/hooks/use-game-linux-compatibility": hook,
        "react-i18next": {
          useTranslation: () => ({ t: (key: string) => key }),
        },
        "@phosphor-icons/react": {
          FolderOpenIcon: () => null,
          TrashIcon: () => null,
        },
        "../../../../hooks/use-user-preferences.hook": {
          useUserPreferences: () => null,
        },
        "../../../../pages/settings/settings-section": {
          SettingsSection: wrap,
        },
        "../../../common": {
          VerticalFocusGroup: wrap,
          HorizontalFocusGroup: wrap,
          Input: ({
            value,
            placeholder,
          }: {
            value: string;
            placeholder: string;
          }) =>
            React.createElement("input", {
              value,
              placeholder,
              readOnly: true,
            }),
          Button: ({ children, onClick }: React.ComponentProps<"button">) =>
            React.createElement("button", { onClick }, children),
          Radio: ({ label }: { label: React.ReactNode }) => label,
          Checkbox: () => null,
          FileExplorerModal: () => null,
        },
        "./compatibility-tab.scss": {},
      }
    ).GameCompatibilitySettingsTab as React.FunctionComponent<{
      game: LibraryGame;
    }>;
    const game = { shop: "epic", objectId: "actual:epic" } as LibraryGame;
    await render(React.createElement(Tab, { game }));
    assert.equal(
      document.querySelector("input")?.value,
      "/prefixes/epic/automatic"
    );
    assert.ok(document.body.textContent?.includes("UMU-Proton-test"));
    assert.ok(!document.body.textContent?.includes("Clear"));
    await render(
      React.createElement(Tab, { game: { ...game, winePrefixPath: "/custom" } })
    );
    assert.equal(document.querySelector("input")?.value, "/custom");
    const clear = [...document.querySelectorAll("button")].find(
      (button) => button.textContent === "Clear"
    );
    assert.ok(clear);
    await React.act(async () => clear.click());
    assert.deepEqual(selected, [["epic", "actual:epic", null]]);
    assert.equal(
      document.querySelector("input")?.value,
      "/prefixes/epic/automatic"
    );
  });

  it("provides every compatibility error and preparation label in every locale", () => {
    const localeRoot = new URL("../../../locales/", import.meta.url);
    const keys = [
      "epic_compatibility_runtime_unavailable",
      "epic_compatibility_runtime_download_failed",
      "epic_compatibility_prefix_invalid",
      "epic_compatibility_prefix_busy",
      "epic_compatibility_launch_failed",
      "epic_install_platform_unsupported",
      "epic_compatibility_automatic",
      "epic_finalizing_install",
      "epic_prerequisites_required",
    ];
    for (const locale of fs.readdirSync(localeRoot, { withFileTypes: true })) {
      if (!locale.isDirectory()) continue;
      const { game_details: translations } = JSON.parse(
        fs.readFileSync(
          new URL(`${locale.name}/translation.json`, localeRoot),
          "utf8"
        )
      );
      for (const key of keys)
        assert.ok(
          typeof translations[key] === "string" && translations[key].length > 0,
          `${locale.name}: ${key}`
        );
    }
  });

  it("finishes the options measurement only after a painted enabled button and cancels abandoned frames", async (t) => {
    await fixture(t, {});
    const previous = ["requestAnimationFrame", "cancelAnimationFrame"].map(
      (key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const
    );
    let id = 0;
    const frames = new Map<number, FrameRequestCallback>();
    Object.defineProperty(globalThis, "requestAnimationFrame", {
      configurable: true,
      value: (callback: FrameRequestCallback) => {
        frames.set(++id, callback);
        return id;
      },
    });
    Object.defineProperty(globalThis, "cancelAnimationFrame", {
      configurable: true,
      value: (frame: number) => frames.delete(frame),
    });
    t.after(() => {
      for (const [key, descriptor] of previous) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else Reflect.deleteProperty(globalThis, key);
      }
    });
    const paint = () => {
      const current = [...frames.values()];
      frames.clear();
      current.forEach((callback) => callback(0));
    };
    let now = 0;
    const events: number[] = [];
    const timing = new epicInstallTimingModule.EpicInstallTiming(
      true,
      () => now,
      (_stage, duration) => events.push(duration)
    );
    const button = document.createElement("button");
    button.dataset.epicInstallSubmit = "private:game";
    button.disabled = true;
    document.body.append(button);
    timing.beginOptions("private:game");
    epicInstallTimingModule.afterEpicInstallReadyPaint("private:game", timing);
    paint();
    paint();
    assert.deepEqual(events, []);
    button.disabled = false;
    const cancel = epicInstallTimingModule.afterEpicInstallReadyPaint(
      "private:game",
      timing
    );
    cancel?.();
    assert.equal(frames.size, 0);
    epicInstallTimingModule.afterEpicInstallReadyPaint("private:game", timing);
    now = 10;
    paint();
    assert.deepEqual(events, []);
    now = 25;
    paint();
    assert.deepEqual(events, [25]);
  });
  it("records only numeric opt-in UI durations and never lets diagnostic failures affect submit", () => {
    let now = 100;
    const events: Array<[string, number]> = [];
    const timing = new epicInstallTimingModule.EpicInstallTiming(
      true,
      () => now,
      (stage, duration) => events.push([stage, duration])
    );
    timing.beginOptions("private:game");
    now = 145;
    timing.optionsReady("private:game");
    timing.optionsReady("private:game");
    timing.optionsReady("private:game", true);
    const started = timing.beginSubmit();
    now = 160;
    timing.accepted(started);
    assert.deepEqual(events, [
      ["options-ready", 45],
      ["options-and-space-ready", 45],
      ["accepted", 15],
    ]);
    assert.doesNotMatch(JSON.stringify(events), /private|game/);
    const disabled = new epicInstallTimingModule.EpicInstallTiming(
      false,
      () => assert.fail("disabled timing must not read clocks"),
      () => assert.fail("disabled timing must not log")
    );
    disabled.beginOptions("private:game");
    disabled.optionsReady("private:game");
    disabled.accepted(disabled.beginSubmit());
    const broken = new epicInstallTimingModule.EpicInstallTiming(
      true,
      () => now,
      () => {
        throw new Error("broken diagnostic sink");
      }
    );
    assert.doesNotThrow(() => broken.accepted(broken.beginSubmit()));
  });
  it("does not query Epic install metadata while navigating or opening the repack selector", async (t) => {
    const calls: Array<{ objectId: string; requestId: string }> = [];
    const cancelled: string[] = [];
    const { render } = await fixture(t, {
      getEpicGameInstallOptions: (objectId: string, requestId: string) => {
        calls.push({ objectId, requestId });
        return new Promise(() => {});
      },
      cancelEpicGameInstallOptions: async (requestId: string) => {
        cancelled.push(requestId);
      },
    });
    const electron = Reflect.get(window, "electron") as unknown as Record<
      string,
      unknown
    >;
    let connection = {
      verification: "unconfirmed",
      hydraUserId: "user",
      availability: { available: true },
      connection: { connected: true, connectionId: "connection" },
    };
    const game = {
      shop: "epic",
      objectId: "actual:epic",
      hasActiveEpicImport: true,
      catalogueGame: { shop: "steam", objectId: "presentation-only" },
      epicImportScope: {
        environment: "test",
        userId: "user",
        connectionId: "connection",
      },
    } as LibraryGame;
    const contextValue = {
      game,
      presentation: null,
      repacks: [],
      updateGame: async () => {},
    };
    const context = React.createContext(contextValue);
    const dispatch = () => {};
    const Repacks = loadModule(
      "../pages/game-details/modals/repacks-modal.tsx",
      {
        "@renderer/context": { gameDetailsContext: context },
        "@renderer/hooks/use-epic-managed": {
          useEpicManagedConnection: () => ({
            available: typeof electron.getEpicGameInstallOptions === "function",
            installationAvailable:
              typeof electron.getEpicGameInstallOptions === "function",
            connection,
          }),
        },
        "@renderer/hooks": {
          useDate: () => ({ formatDate: () => "" }),
          useAppDispatch: () => dispatch,
          useAppSelector: () => ({}),
          useIsNonSteamExecutable: () => false,
          useLibrary: () => ({ updateLibrary: async () => {} }),
        },
        "@shared": { getOfficialStoreMembers, isEpicMemberInCurrentScope },
        "@renderer/components": Object.fromEntries(
          [
            "Badge",
            "Button",
            "Modal",
            "TextField",
            "CheckboxField",
            "SteamIcon",
          ].map((name) => [name, () => null])
        ),
        "@renderer/helpers": {
          canDownloadOnSteam: () => false,
          isSteamImportedGame: () => false,
          getGameKey: () => "unused",
        },
        "@renderer/features": { clearNewDownloadOptions: () => ({}) },
        "@renderer/services/leveldb.service": {
          levelDBService: { values: async () => [], get: async () => null },
        },
        "lodash-es": { orderBy: (items: unknown[]) => items },
        "react-i18next": {
          useTranslation: () => ({ t: (key: string) => key }),
        },
        "react-router-dom": { useNavigate: () => () => {} },
        "react-tooltip": { Tooltip: () => null },
        "@primer/octicons-react": {
          PlusCircleIcon: () => null,
          ChevronDownIcon: () => null,
          ChevronUpIcon: () => null,
        },
        "./download-settings-modal": { DownloadSettingsModal: () => null },
        "./epic-install-modal": { EpicInstallModal: () => null },
        "@renderer/assets/epic-integration-logo.svg?react": () => null,
        "./repacks-modal.scss": {},
      }
    ).RepacksModal as React.FunctionComponent<{
      visible: boolean;
      onClose: () => void;
      startDownload: () => Promise<{ ok: boolean }>;
    }>;
    const element = (currentGame = game, visible = false) =>
      React.createElement(
        context.Provider,
        { value: { ...contextValue, game: currentGame } },
        React.createElement(Repacks, {
          visible,
          onClose: () => {},
          startDownload: async () => ({ ok: true }),
        })
      );
    await render(element(game, true));
    assert.equal(calls.length, 0);
    connection = { ...connection, verification: "confirmed" };
    for (let index = 0; index < 10; index++)
      await render(element({ ...game, objectId: `page-${index}:epic` }));
    assert.equal(calls.length, 0);
    assert.deepEqual(cancelled, []);
    await render(element(game, true));
    await render(element({ ...game, title: "updated metadata" }, true));
    await render(element(game));
    await render(element(game, true));
    await render(element({ ...game, objectId: "next:epic" }, true));
    connection = { ...connection, hydraUserId: "other-user" };
    await render(element(game, true));
    Object.assign(electron, { getEpicGameInstallOptions: undefined });
    await render(element(game, true));
    assert.equal(calls.length, 0);
    assert.deepEqual(cancelled, []);
  });

  it("closes an Epic install from an older page or scope without tying its lifetime to selector visibility", async (t) => {
    const requests: Array<{ objectId: string; requestId: string }> = [];
    const cancelled: string[] = [];
    const { render } = await fixture(t, {
      getEpicGameInstallOptions: (objectId: string, requestId: string) => {
        requests.push({ objectId, requestId });
        return new Promise(() => {});
      },
      cancelEpicGameInstallOptions: async (requestId: string) => {
        cancelled.push(requestId);
      },
      startEpicGameDownload: async () => ({ ok: true }),
    });
    const hook = loadInstallHook("D:\\downloads");
    const seen: Array<{ objectId: string | null; title: string | null }> = [];
    function Install({
      game,
      presentationGame,
    }: {
      game: LibraryGame | null;
      presentationGame: LibraryGame | null;
    }) {
      hook(game, () => {});
      seen.push({
        objectId: game?.objectId ?? null,
        title: presentationGame?.title ?? null,
      });
      return game
        ? React.createElement("div", { "data-install": true }, game.objectId)
        : null;
    }
    const game = {
      shop: "epic",
      objectId: "first:epic",
      title: "First game",
      hasActiveEpicImport: true,
      epicImportScope: {
        environment: "test",
        userId: "user",
        connectionId: "connection",
      },
    } as LibraryGame;
    const contextValue = {
      game,
      presentation: null,
      repacks: [],
      updateGame: async () => {},
    };
    const context = React.createContext(contextValue);
    let connection = {
      verification: "confirmed",
      hydraUserId: "user",
      availability: { available: true },
      connection: { connected: true, connectionId: "connection" },
    };
    const Repacks = loadModule(
      "../pages/game-details/modals/repacks-modal.tsx",
      {
        "@renderer/context": { gameDetailsContext: context },
        "@renderer/hooks/use-epic-managed": {
          useEpicManagedConnection: () => ({
            available: true,
            installationAvailable: true,
            connection,
          }),
        },
        "@renderer/hooks": {
          useDate: () => ({ formatDate: () => "" }),
          useAppDispatch: () => () => {},
          useAppSelector: () => ({}),
          useIsNonSteamExecutable: () => false,
          useLibrary: () => ({ updateLibrary: async () => {} }),
        },
        "@shared": { getOfficialStoreMembers, isEpicMemberInCurrentScope },
        "@renderer/components": {
          Badge: () => null,
          Button: ({
            onClick,
            children,
            className,
          }: React.ComponentProps<"button">) =>
            React.createElement("button", { onClick, className }, children),
          Modal: ({
            visible,
            children,
          }: {
            visible: boolean;
            children: React.ReactNode;
          }) =>
            visible ? React.createElement("section", null, children) : null,
          TextField: () => null,
          CheckboxField: () => null,
          SteamIcon: () => null,
        },
        "@renderer/helpers": {
          canDownloadOnSteam: () => false,
          isSteamImportedGame: () => false,
          getGameKey: () => "unused",
        },
        "@renderer/features": { clearNewDownloadOptions: () => ({}) },
        "@renderer/services/leveldb.service": {
          levelDBService: { values: async () => [], get: async () => null },
        },
        "lodash-es": { orderBy: (items: unknown[]) => items },
        "react-i18next": {
          useTranslation: () => ({ t: (key: string) => key }),
        },
        "react-router-dom": { useNavigate: () => () => {} },
        "react-tooltip": { Tooltip: () => null },
        "@primer/octicons-react": {
          PlusCircleIcon: () => null,
          ChevronDownIcon: () => null,
          ChevronUpIcon: () => null,
        },
        "./download-settings-modal": { DownloadSettingsModal: () => null },
        "./epic-install-modal": { EpicInstallModal: Install },
        "@renderer/assets/epic-integration-logo.svg?react": () => null,
        "./repacks-modal.scss": {},
      }
    ).RepacksModal as React.FunctionComponent<{
      visible: boolean;
      onClose: () => void;
      startDownload: () => Promise<{ ok: boolean }>;
    }>;
    const element = (currentGame = game, visible = true) =>
      React.createElement(
        context.Provider,
        { value: { ...contextValue, game: currentGame } },
        React.createElement(Repacks, {
          visible,
          onClose: () => {},
          startDownload: async () => ({ ok: true }),
        })
      );
    const openInstall = async () => {
      const button = document.querySelector<HTMLButtonElement>(
        ".repacks-modal__repack-button"
      );
      assert.ok(button);
      await React.act(async () => button.click());
      assert.ok(document.querySelector("[data-install]"));
      return requests.at(-1)!.requestId;
    };
    await render(element());
    const modalRequest = await openInstall();
    const requestCount = requests.length;
    await render(element(game, false));
    await render(element());
    assert.ok(document.querySelector("[data-install]"));
    assert.equal(requests.length, requestCount);
    assert.equal(cancelled.includes(modalRequest), false);
    const nextGame = { ...game, objectId: "second:epic", title: "Second game" };
    seen.length = 0;
    await render(element(nextGame));
    assert.equal(document.querySelector("[data-install]"), null);
    assert.ok(cancelled.includes(modalRequest));
    assert.ok(
      seen.every((value) => value.objectId === null && value.title === null)
    );
    await render(element());
    assert.equal(
      document.querySelector("[data-install]"),
      null,
      "returning to an older page does not reopen its modal"
    );
    for (const scope of [
      { ...game.epicImportScope!, environment: "other-environment" },
      { ...game.epicImportScope!, userId: "other-user" },
      { ...game.epicImportScope!, connectionId: "other-connection" },
    ]) {
      const scopeRequest = await openInstall();
      connection = {
        ...connection,
        hydraUserId: scope.userId,
        connection: { connected: true, connectionId: scope.connectionId },
      };
      await render(element({ ...game, epicImportScope: scope }));
      assert.equal(document.querySelector("[data-install]"), null);
      assert.ok(cancelled.includes(scopeRequest));
      connection = {
        ...connection,
        hydraUserId: "user",
        connection: { connected: true, connectionId: "connection" },
      };
      await render(element());
      assert.equal(document.querySelector("[data-install]"), null);
    }
  });

  it("cancels pending install metadata on retry, game change, closing and unmount while ignoring stale replies", async (t) => {
    const requests: Array<{
      objectId: string;
      requestId: string;
      reply: (options: EpicGameInstallOptions) => void;
    }> = [];
    const cancelled: string[] = [];
    const { render, unmount } = await fixture(t, {
      getEpicGameInstallOptions: (objectId: string, requestId: string) =>
        new Promise<EpicGameInstallOptions>((reply) =>
          requests.push({ objectId, requestId, reply })
        ),
      cancelEpicGameInstallOptions: async (requestId: string) => {
        cancelled.push(requestId);
      },
      startEpicGameDownload: async () => ({ ok: true }),
    });
    const hook = loadInstallHook("D:\\downloads");
    let game: LibraryGame | null = {
      shop: "epic",
      objectId: "first:epic",
    } as LibraryGame;
    let current!: ReturnType<typeof useEpicInstall>;
    function Harness() {
      current = hook(game, () => {});
      return null;
    }
    await render(React.createElement(Harness));
    await React.act(async () => {
      void current.retry();
    });
    assert.deepEqual(cancelled, [requests[0].requestId]);
    game = { ...game, objectId: "second:epic" };
    await render(React.createElement(Harness));
    assert.deepEqual(
      cancelled,
      requests.slice(0, 2).map((item) => item.requestId)
    );
    await React.act(async () =>
      requests[0].reply({
        connectionId: "stale",
        options: [
          {
            artifactId: "stale-app",
            platform: "Windows",
            downloadSizeInBytes: 1,
            diskSizeInBytes: 2,
            supportsCloudSaves: false,
            installed: false,
          },
        ],
      })
    );
    assert.equal(current.loading, true);
    assert.equal(current.result, null);
    game = null;
    await render(React.createElement(Harness));
    assert.deepEqual(
      cancelled,
      requests.map((item) => item.requestId)
    );
    assert.equal(current.loading, false);
    game = { shop: "epic", objectId: "third:epic" } as LibraryGame;
    await render(React.createElement(Harness));
    await React.act(async () =>
      requests[2].reply({ options: [], error: "operation-cancelled" })
    );
    assert.equal(current.loading, true);
    assert.equal(current.error, null);
    await unmount();
    assert.deepEqual(
      cancelled,
      requests.map((item) => item.requestId)
    );
    assert.equal(new Set(cancelled).size, 4);
    for (const requestId of cancelled)
      assert.match(requestId, /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i);
  });

  it("uses the Hydra modal header, directory and preferred presentation while downloading the actual Epic identity", async (t) => {
    const calls: StartEpicGameDownloadPayload[] = [];
    const { render } = await fixture(t, {
      getEpicGameInstallOptions: async () => ({
        connectionId: "confirmed",
        options: [
          {
            artifactId: "actual-build",
            platform: "Windows",
            downloadSizeInBytes: 50,
            diskSizeInBytes: 100,
            preparationId: "550e8400-e29b-41d4-a716-446655440000",
          },
        ],
      }),
      getDiskFreeSpace: async () => ({ free: 300 }),
      startEpicGameDownload: async (payload: StartEpicGameDownloadPayload) => {
        calls.push(payload);
        return { ok: true };
      },
    });
    const Modal = loadInstallModal(loadInstallHook("D:\\configured"));
    await render(
      React.createElement(Modal, {
        game: { shop: "epic", objectId: "actual:epic" } as LibraryGame,
        presentationGame: {
          shop: "steam",
          objectId: "presentation-only",
          title: "Preferred Steam title",
          customCoverImageUrl: "https://images.test/custom.png",
          coverImageUrl: "https://images.test/default.png",
        } as LibraryGame,
        onClose: () => {},
        onStarted: () => {},
      })
    );
    assert.equal(
      document.querySelector("h2")?.textContent,
      "download_settings"
    );
    assert.equal(
      document.querySelector("[data-header-description]")?.textContent,
      "space_left_on_disk:300B"
    );
    assert.equal(document.querySelector("input")?.value, "D:\\configured");
    assert.equal(
      document.querySelector("a")?.getAttribute("href"),
      "/settings"
    );
    assert.match(document.body.textContent!, /select_folder_hint/);
    assert.equal(
      document.querySelector(".epic-install-modal__title")?.textContent,
      "Preferred Steam title"
    );
    assert.equal(
      document.querySelector("img")?.getAttribute("src"),
      "https://images.test/custom.png"
    );
    assert.match(document.body.textContent!, /download_size:50B/);
    assert.match(document.body.textContent!, /required_storage_space:100B/);
    assert.equal(document.querySelector("select"), null);
    const buttons = [...document.querySelectorAll("button")];
    assert.deepEqual(
      buttons.map((button) => button.textContent),
      ["change", "download_now"]
    );
    assert.equal(
      buttons[1].querySelector("svg")?.getAttribute("data-icon"),
      "DownloadIcon"
    );
    await React.act(async () => buttons[1].click());
    assert.equal(calls[0].epicObjectId, "actual:epic");
    assert.equal(
      calls[0].preparationId,
      "550e8400-e29b-41d4-a716-446655440000"
    );
    assert.equal(calls[0].addToQueueOnly, false);
  });

  it("uses the queue action with an active download and Hydra loading feedback while starting", async (t) => {
    let payload!: StartEpicGameDownloadPayload;
    let finishStart!: (response: { ok: true }) => void;
    const { render } = await fixture(t, {
      getEpicGameInstallOptions: async () => ({
        connectionId: "confirmed",
        options: [{ artifactId: "actual-build", platform: "Windows" }],
      }),
      startEpicGameDownload: (value: StartEpicGameDownloadPayload) => {
        payload = value;
        return new Promise<{ ok: true }>((resolve) => {
          finishStart = resolve;
        });
      },
    });
    const Modal = loadInstallModal(loadInstallHook("D:\\configured"), {});
    await render(
      React.createElement(Modal, {
        game: { shop: "epic", objectId: "actual:epic" } as LibraryGame,
        onClose: () => {},
        onStarted: () => {},
      })
    );
    const primary = document.querySelectorAll("button")[1];
    assert.equal(primary.textContent, "add_to_queue");
    assert.equal(
      primary.querySelector("svg")?.getAttribute("data-icon"),
      "PlusIcon"
    );
    await React.act(async () => primary.click());
    assert.equal(payload.addToQueueOnly, true);
    assert.equal(primary.textContent, "loading");
    assert.equal(primary.disabled, true);
    assert.equal(
      primary.querySelector("svg")?.getAttribute("data-icon"),
      "SyncIcon"
    );
    await React.act(async () => finishStart({ ok: true }));
  });

  it("shows unknown sizes until an explicit build is selected and updates the card for that build", async (t) => {
    const { render } = await fixture(t, {
      getEpicGameInstallOptions: async () => ({
        connectionId: "confirmed",
        options: [
          {
            artifactId: "known-build",
            platform: "Windows",
            downloadSizeInBytes: 50,
            diskSizeInBytes: 100,
          },
          { artifactId: "unknown-build", platform: "Windows" },
        ],
      }),
      startEpicGameDownload: async () => ({ ok: true }),
    });
    const Modal = loadInstallModal(loadInstallHook("D:\\configured"));
    await render(
      React.createElement(Modal, {
        game: { shop: "epic", objectId: "actual:epic" } as LibraryGame,
        onClose: () => {},
        onStarted: () => {},
      })
    );
    const select = document.querySelector("select")!;
    assert.equal(select.value, "");
    assert.match(document.body.textContent!, /download_size:—/);
    assert.match(document.body.textContent!, /required_storage_space:—/);
    await React.act(async () => {
      select.value = "0";
      select.dispatchEvent(new window.Event("change", { bubbles: true }));
    });
    assert.match(document.body.textContent!, /download_size:50B/);
    assert.match(document.body.textContent!, /required_storage_space:100B/);
    await React.act(async () => {
      select.value = "1";
      select.dispatchEvent(new window.Event("change", { bubbles: true }));
    });
    assert.match(document.body.textContent!, /download_size:—/);
  });

  it("fills the preferred directory and updates free space while Legendary metadata is still pending", async (t) => {
    let defaultPathCalls = 0;
    const diskReplies: Array<{
      path: string;
      reply: (space: { free: number }) => void;
    }> = [];
    const { render } = await fixture(t, {
      getEpicGameInstallOptions: () => new Promise(() => {}),
      startEpicGameDownload: async () => ({ ok: true }),
      getDefaultDownloadsPath: async () => {
        defaultPathCalls++;
        return "C:\\downloads";
      },
      getDiskFreeSpace: (path: string) =>
        new Promise<{ free: number }>((reply) =>
          diskReplies.push({ path, reply })
        ),
      showOpenDialog: async () => ({ filePaths: ["E:\\chosen"] }),
    });
    const hook = loadInstallHook("D:\\configured");
    let current!: ReturnType<typeof useEpicInstall>;
    function Harness() {
      current = hook(
        { shop: "epic", objectId: "real:epic" } as LibraryGame,
        () => {}
      );
      return null;
    }
    await render(React.createElement(Harness));
    assert.equal(current.path, "D:\\configured");
    assert.equal(current.loading, true);
    assert.equal(defaultPathCalls, 0);
    assert.equal(diskReplies[0].path, "D:\\configured");
    await React.act(async () => current.chooseDirectory());
    assert.equal(current.path, "E:\\chosen");
    assert.equal(current.diskFreeSpace, null);
    assert.equal(diskReplies[1].path, "E:\\chosen");
    await React.act(async () => diskReplies[1].reply({ free: 200 }));
    await React.act(async () => diskReplies[0].reply({ free: 100 }));
    assert.equal(current.diskFreeSpace, 200);
  });

  it("fills the Hydra default directory before Legendary metadata arrives", async (t) => {
    const { render } = await fixture(t, {
      getEpicGameInstallOptions: () => new Promise(() => {}),
      startEpicGameDownload: async () => ({ ok: true }),
      getDefaultDownloadsPath: async () => "C:\\downloads",
      getDiskFreeSpace: async () => ({ free: 300 }),
    });
    const hook = loadInstallHook();
    let current!: ReturnType<typeof useEpicInstall>;
    function Harness() {
      current = hook(
        { shop: "epic", objectId: "real:epic" } as LibraryGame,
        () => {}
      );
      return null;
    }
    await render(React.createElement(Harness));
    assert.equal(current.path, "C:\\downloads");
    assert.equal(current.diskFreeSpace, 300);
    assert.equal(current.loading, true);
  });

  it("does not overwrite a chosen directory with a delayed default path or metadata retry", async (t) => {
    let replyDefault!: (path: string) => void;
    const { render } = await fixture(t, {
      getEpicGameInstallOptions: async () => ({
        options: [],
        error: "network",
      }),
      startEpicGameDownload: async () => ({ ok: true }),
      getDefaultDownloadsPath: () =>
        new Promise<string>((resolve) => {
          replyDefault = resolve;
        }),
      showOpenDialog: async () => ({ filePaths: ["D:\\chosen"] }),
    });
    const hook = loadInstallHook();
    let current!: ReturnType<typeof useEpicInstall>;
    function Harness() {
      current = hook(
        { shop: "epic", objectId: "real:epic" } as LibraryGame,
        () => {}
      );
      return null;
    }
    await render(React.createElement(Harness));
    await React.act(async () => current.chooseDirectory());
    await React.act(async () => replyDefault("C:\\downloads"));
    await React.act(async () => current.retry());
    assert.equal(current.path, "D:\\chosen");
  });

  it("preserves a chosen directory across same-connection notifications and delayed preferences", async (t) => {
    const preferences: { downloadsPath?: string } = {};
    let connectionListener!: (connection: unknown) => void;
    const { render } = await fixture(t, {
      getEpicGameInstallOptions: async () => ({ options: [] }),
      startEpicGameDownload: async () => ({ ok: true }),
      getDefaultDownloadsPath: async () => "C:\\downloads",
      showOpenDialog: async () => ({ filePaths: ["D:\\chosen"] }),
      onEpicConnectionChanged: (callback: typeof connectionListener) => {
        connectionListener = callback;
        return () => {};
      },
    });
    const hook = loadInstallHook(() => preferences.downloadsPath);
    let current!: ReturnType<typeof useEpicInstall>;
    function Harness() {
      current = hook(
        {
          shop: "epic",
          objectId: "real:epic",
          epicImportScope: {
            environment: "test",
            userId: "user",
            connectionId: "connection",
          },
        } as LibraryGame,
        () => {}
      );
      return null;
    }
    await render(React.createElement(Harness));
    await React.act(async () => current.chooseDirectory());
    await React.act(async () =>
      connectionListener({
        verification: "confirmed",
        hydraUserId: "user",
        connection: { connected: true, connectionId: "connection" },
      })
    );
    assert.equal(current.path, "D:\\chosen");
    preferences.downloadsPath = "E:\\configured-later";
    await render(React.createElement(Harness));
    assert.equal(current.path, "D:\\chosen");
  });

  it("ignores directory and disk responses from an older game or Epic context", async (t) => {
    const defaultReplies: Array<(path: string) => void> = [];
    const diskReplies: Array<(space: { free: number }) => void> = [];
    let connectionListener!: (connection: unknown) => void;
    let directoryReply!: (result: { filePaths: string[] }) => void;
    const { render } = await fixture(t, {
      getEpicGameInstallOptions: async () => ({ options: [] }),
      startEpicGameDownload: async () => ({ ok: true }),
      getDefaultDownloadsPath: () =>
        new Promise<string>((resolve) => defaultReplies.push(resolve)),
      getDiskFreeSpace: () =>
        new Promise<{ free: number }>((resolve) => diskReplies.push(resolve)),
      showOpenDialog: () =>
        new Promise<{ filePaths: string[] }>((resolve) => {
          directoryReply = resolve;
        }),
      onEpicConnectionChanged: (callback: typeof connectionListener) => {
        connectionListener = callback;
        return () => {};
      },
    });
    const hook = loadInstallHook();
    let current!: ReturnType<typeof useEpicInstall>;
    function Harness({ objectId }: { objectId: string }) {
      current = hook({ shop: "epic", objectId } as LibraryGame, () => {});
      return null;
    }
    await render(React.createElement(Harness, { objectId: "old:epic" }));
    await render(React.createElement(Harness, { objectId: "current:epic" }));
    await React.act(async () => defaultReplies[0]("C:\\old"));
    assert.equal(current.path, "");
    await React.act(async () => defaultReplies[1]("D:\\current"));
    let choosing!: Promise<void>;
    await React.act(async () => {
      choosing = current.chooseDirectory();
    });
    await React.act(async () =>
      connectionListener({
        verification: "unconfirmed",
        connection: { connected: false },
      })
    );
    await React.act(async () => {
      directoryReply({ filePaths: ["C:\\old-choice"] });
      await choosing;
      diskReplies[0]({ free: 400 });
    });
    assert.equal(current.path, "");
    assert.equal(current.diskFreeSpace, null);
    assert.equal(current.error, "stale-connection");
  });

  it("requires an explicit build choice and starts the real Epic copy with the returned connection", async (t) => {
    const calls: StartEpicGameDownloadPayload[] = [];
    let started = 0;
    const options: EpicGameInstallOptions = {
      connectionId: "confirmed",
      options: ["app-one", "app-two"].map((artifactId) => ({
        artifactId,
        platform: "Windows",
        downloadSizeInBytes: 50,
        diskSizeInBytes: 100,
        supportsCloudSaves: true,
        installed: false,
      })),
    };
    const { render } = await fixture(t, {
      getEpicGameInstallOptions: async () => options,
      getDefaultDownloadsPath: async () => "C:\\downloads",
      startEpicGameDownload: async (payload: StartEpicGameDownloadPayload) => {
        calls.push(payload);
        return { ok: true };
      },
    });
    const hook = loadInstallHook();
    let current!: ReturnType<typeof useEpicInstall>;
    const game = {
      shop: "epic",
      objectId: "namespace:executable",
      catalogueGame: { shop: "steam", objectId: "presentation-only" },
    } as LibraryGame;
    function Harness() {
      current = hook(game, () => {
        started++;
      });
      return null;
    }
    await render(React.createElement(Harness));
    assert.equal(current.selected, "");
    await React.act(async () => current.start(false));
    assert.equal(calls.length, 0);
    await React.act(async () => current.setSelected("1"));
    await React.act(async () => current.start(true));
    assert.deepEqual(calls, [
      {
        epicObjectId: "namespace:executable",
        connectionId: "confirmed",
        artifactId: "app-two",
        platform: "Windows",
        downloadPath: "C:\\downloads",
        addToQueueOnly: true,
      },
    ]);
    assert.equal(started, 1);
  });

  it("retries failed install metadata without losing the chosen directory", async (t) => {
    let attempts = 0;
    const { render } = await fixture(t, {
      getEpicGameInstallOptions: async () => {
        attempts++;
        return attempts === 1
          ? { options: [], error: "network" }
          : {
              connectionId: "connection",
              options: [{ artifactId: "verified-app", platform: "Windows" }],
            };
      },
      startEpicGameDownload: async () => ({ ok: true }),
      getDefaultDownloadsPath: async () => "C:\\downloads",
      showOpenDialog: async () => ({ filePaths: ["D:\\chosen"] }),
    });
    const hook = loadInstallHook();
    let current!: ReturnType<typeof useEpicInstall>;
    function Harness() {
      current = hook(
        { shop: "epic", objectId: "real:epic" } as LibraryGame,
        () => {}
      );
      return null;
    }
    await render(React.createElement(Harness));
    assert.equal(current.error, "network");
    await React.act(async () => current.chooseDirectory());
    await React.act(async () => current.retry());
    assert.equal(attempts, 2);
    assert.equal(current.path, "D:\\chosen");
    assert.equal(current.option?.artifactId, "verified-app");
    assert.equal(current.error, null);
  });

  it("invalidates install options on repeated context notifications and rejects duplicate starts", async (t) => {
    const replies: Array<(result: EpicGameInstallOptions) => void> = [];
    let connectionListener!: (value: unknown) => void;
    let finishStart!: (result: { ok: true }) => void;
    let started = 0;
    let startCalls = 0;
    const { render } = await fixture(t, {
      getEpicGameInstallOptions: () =>
        new Promise<EpicGameInstallOptions>((resolve) => replies.push(resolve)),
      startEpicGameDownload: () => {
        startCalls++;
        return new Promise<{ ok: true }>((resolve) => {
          finishStart = resolve;
        });
      },
      getDefaultDownloadsPath: async () => "C:\\downloads",
      onEpicConnectionChanged: (callback: typeof connectionListener) => {
        connectionListener = callback;
        return () => {};
      },
    });
    const hook = loadInstallHook();
    let current!: ReturnType<typeof useEpicInstall>;
    function Harness() {
      current = hook(
        {
          shop: "epic",
          objectId: "real:epic",
          epicImportScope: {
            userId: "user",
            connectionId: "connection",
            environment: "test",
          },
        } as LibraryGame,
        () => {
          started++;
        }
      );
      return null;
    }
    const connection = {
      verification: "confirmed",
      hydraUserId: "user",
      connection: { connected: true, connectionId: "connection" },
    };
    const options = (artifactId: string) =>
      ({
        connectionId: "connection",
        options: [{ artifactId, platform: "Windows" }],
      }) as EpicGameInstallOptions;
    await render(React.createElement(Harness));
    await React.act(async () => connectionListener(connection));
    await React.act(async () => connectionListener(connection));
    assert.equal(replies.length, 3);
    await React.act(async () => {
      replies[0](options("stale-one"));
      replies[1](options("stale-two"));
    });
    assert.equal(current.result, null);
    await React.act(async () => replies[2](options("current-app")));
    assert.equal(current.option?.artifactId, "current-app");
    let pending!: Promise<void>;
    await React.act(async () => {
      pending = current.start(false);
      void current.start(false);
    });
    assert.equal(startCalls, 1);
    await React.act(async () => {
      finishStart({ ok: true });
      await pending;
    });
    assert.equal(started, 1);
  });

  it("does not restore an old connection response over a disconnect event and removes its listener", async (t) => {
    let listener!: (value: unknown) => void;
    let reply!: (value: unknown) => void;
    let stopped = 0;
    const { render } = await fixture(t, {
      getEpicGameInstallOptions: async () => ({ options: [] }),
      startEpicGameDownload: async () => ({ ok: true }),
      getEpicConnection: () =>
        new Promise((resolve) => {
          reply = resolve;
        }),
      onEpicConnectionChanged: (callback: typeof listener) => {
        listener = callback;
        return () => {
          stopped++;
        };
      },
    });
    const hook = loadModule("./use-epic-managed.ts")
      .useEpicManagedConnection as typeof useEpicManagedConnection;
    let current!: ReturnType<typeof useEpicManagedConnection>;
    function Harness() {
      current = hook();
      return null;
    }
    await render(React.createElement(Harness));
    const disconnected = { connection: { connected: false } };
    await React.act(async () => listener(disconnected));
    await React.act(async () =>
      reply({ connection: { connected: true, connectionId: "old" } })
    );
    assert.equal(current.connection, disconnected);
    await render(React.createElement("div"));
    assert.equal(stopped, 1);
  });

  it("distinguishes a pending Epic save read from failure and exposes a successful retry through controls", async (t) => {
    const reads: Array<{
      resolve: (value: EpicCloudSaveState) => void;
      reject: (error: Error) => void;
    }> = [];
    let stateListener!: (value: EpicCloudSaveState) => void;
    const { render } = await fixture(t, {
      getEpicCloudSaveState: () =>
        new Promise<EpicCloudSaveState>((resolve, reject) =>
          reads.push({ resolve, reject })
        ),
      onEpicCloudSaveStateChanged: (callback: typeof stateListener) => {
        stateListener = callback;
        return () => {};
      },
    });
    const managed = loadModule("./use-epic-managed.ts");
    const hook = loadModule("./use-epic-cloud-save-controls.ts", {
      "./use-epic-managed": managed,
    }).useEpicCloudSaveControls as typeof useEpicCloudSaveControls;
    let current!: ReturnType<typeof useEpicCloudSaveControls>;
    function Harness() {
      current = hook({ objectId: "namespace:executable" } as LibraryGame);
      return null;
    }
    await render(React.createElement(Harness));
    assert.equal(current.loading, true);
    assert.equal(current.readError, false);
    assert.equal(Boolean(current.state), false);
    await React.act(async () => reads[0].reject(new Error("network")));
    assert.equal(current.loading, false);
    assert.equal(current.readError, true);
    assert.equal(current.failure, false);
    let refreshing!: Promise<void>;
    await React.act(async () => {
      refreshing = current.refresh();
    });
    assert.equal(current.loading, true);
    assert.equal(current.readError, false);
    await React.act(async () => {
      reads[1].resolve(state());
      await refreshing;
    });
    assert.equal(current.loading, false);
    assert.equal(current.readError, false);
    assert.equal(current.state?.status, "up-to-date");
    await React.act(async () => {
      refreshing = current.refresh();
    });
    await React.act(async () => {
      reads[2].reject(new Error("network"));
      await refreshing;
    });
    assert.equal(current.readError, true);
    await React.act(async () =>
      stateListener(state({ remoteManifest: "event" }))
    );
    assert.equal(current.readError, false);
    assert.equal(current.loading, false);
    assert.equal(current.state?.remoteManifest, "event");
  });

  it("clears an operation failure when retrying the Epic save read", async (t) => {
    const { render } = await fixture(t, {
      getEpicCloudSaveState: async () => state(),
      syncEpicCloudSaves: async () => {
        throw new Error("network");
      },
    });
    const managed = loadModule("./use-epic-managed.ts");
    const hook = loadModule("./use-epic-cloud-save-controls.ts", {
      "./use-epic-managed": managed,
    }).useEpicCloudSaveControls as typeof useEpicCloudSaveControls;
    let current!: ReturnType<typeof useEpicCloudSaveControls>;
    function Harness() {
      current = hook({ objectId: "namespace:executable" } as LibraryGame);
      return null;
    }
    await render(React.createElement(Harness));
    await React.act(async () => current.sync());
    assert.equal(current.failure, true);
    await React.act(async () => current.refresh());
    assert.equal(current.failure, false);
    assert.equal(current.readError, false);
    assert.equal(current.loading, false);
    assert.equal(current.state?.status, "up-to-date");
  });

  it("keeps the latest refresh result over a failed older request", async (t) => {
    const reads: Array<{
      resolve: (value: EpicCloudSaveState) => void;
      reject: (error: Error) => void;
    }> = [];
    const { render } = await fixture(t, {
      getEpicCloudSaveState: () =>
        new Promise<EpicCloudSaveState>((resolve, reject) =>
          reads.push({ resolve, reject })
        ),
    });
    const hook = loadModule("./use-epic-managed.ts")
      .useEpicCloudSaves as typeof useEpicCloudSaves;
    let current!: ReturnType<typeof useEpicCloudSaves>;
    function Harness() {
      current = hook("namespace:executable");
      return null;
    }
    await render(React.createElement(Harness));
    let refreshing!: Promise<void>;
    await React.act(async () => {
      refreshing = current.refresh();
    });
    await React.act(async () => {
      reads[1].resolve(state({ remoteManifest: "current" }));
      await refreshing;
    });
    await React.act(async () => reads[0].reject(new Error("old failure")));
    assert.equal(current.state?.remoteManifest, "current");
    assert.equal(current.loading, false);
    assert.equal(current.readError, false);
  });

  it("keeps conflict events over stale state reads and removes listeners when the page changes", async (t) => {
    let listener!: (value: EpicCloudSaveState) => void;
    let reply!: (value: EpicCloudSaveState) => void;
    let stopped = 0;
    const { render } = await fixture(t, {
      getEpicCloudSaveState: () =>
        new Promise<EpicCloudSaveState>((resolve) => {
          reply = resolve;
        }),
      onEpicCloudSaveStateChanged: (callback: typeof listener) => {
        listener = callback;
        return () => {
          stopped++;
        };
      },
    });
    const hook = loadModule("./use-epic-managed.ts")
      .useEpicCloudSaves as typeof useEpicCloudSaves;
    let current!: ReturnType<typeof useEpicCloudSaves>;
    function Harness({ id }: { id: string }) {
      current = hook(id);
      return null;
    }
    await render(React.createElement(Harness, { id: "namespace:executable" }));
    assert.equal(current.loading, true);
    await React.act(async () =>
      listener(state({ status: "conflict", remoteManifest: "remote-v2" }))
    );
    await React.act(async () => reply(state()));
    assert.equal(current.state?.status, "conflict");
    assert.equal(current.state?.remoteManifest, "remote-v2");
    assert.equal(current.loading, false);
    assert.equal(current.readError, false);
    await render(React.createElement(Harness, { id: "other:game" }));
    assert.equal(current.state, null);
    assert.equal(current.loading, true);
    assert.equal(stopped, 1);
  });

  it("passes the observed manifest and upload date in an explicit conflict decision", async (t) => {
    const calls: unknown[] = [];
    const { render } = await fixture(t, {
      getEpicCloudSaveState: async () =>
        state({
          status: "conflict",
          remoteManifest: "remote-v2",
          remoteModifiedAt: "2026-10-15T12:00:00.000Z",
        }),
      onEpicCloudSaveStateChanged: () => () => {},
      resolveEpicCloudSaveConflict: async (payload: unknown) => {
        calls.push(payload);
        return state({ remoteManifest: "remote-v3" });
      },
    });
    const managed = loadModule("./use-epic-managed.ts");
    const hook = loadModule("./use-epic-cloud-save-controls.ts", {
      "./use-epic-managed": managed,
    }).useEpicCloudSaveControls as typeof useEpicCloudSaveControls;
    let current!: ReturnType<typeof useEpicCloudSaveControls>;
    function Harness() {
      current = hook({ objectId: "namespace:executable" } as LibraryGame);
      return null;
    }
    await render(React.createElement(Harness));
    await React.act(async () => current.resolve("remote"));
    assert.deepEqual(calls, [
      {
        epicObjectId: "namespace:executable",
        expectedRemoteManifest: "remote-v2",
        expectedRemoteModifiedAt: "2026-10-15T12:00:00.000Z",
        choice: "remote",
      },
    ]);
    assert.equal(current.state?.status, "up-to-date");
  });

  it("invalidates a same-game response when the account changes and ignores old state after disconnect", async (t) => {
    let stateListener!: (value: EpicCloudSaveState) => void;
    let connectionListener!: (value: unknown) => void;
    let reply!: (value: EpicCloudSaveState) => void;
    let stopped = 0;
    const { render } = await fixture(t, {
      getEpicCloudSaveState: () =>
        new Promise<EpicCloudSaveState>((resolve) => {
          reply = resolve;
        }),
      onEpicCloudSaveStateChanged: (callback: typeof stateListener) => {
        stateListener = callback;
        return () => {
          stopped++;
        };
      },
      onEpicConnectionChanged: (callback: typeof connectionListener) => {
        connectionListener = callback;
        return () => {
          stopped++;
        };
      },
    });
    const hook = loadModule("./use-epic-managed.ts")
      .useEpicCloudSaves as typeof useEpicCloudSaves;
    let current!: ReturnType<typeof useEpicCloudSaves>;
    function Harness() {
      current = hook("namespace:executable");
      return null;
    }
    await render(React.createElement(Harness));
    const previousGeneration = current.getGeneration();
    await React.act(async () =>
      connectionListener({
        hydraUserId: "other",
        verification: "unconfirmed",
        connection: { connected: false },
      })
    );
    await React.act(async () => {
      stateListener(state());
      reply(state());
    });
    assert.equal(current.state, null);
    assert.equal(current.busy, false);
    assert.equal(current.loading, false);
    assert.equal(current.readError, true);
    assert.ok(current.getGeneration() > previousGeneration);
    await render(React.createElement("div"));
    assert.equal(stopped, 2);
  });

  it("invalidates identical-ID context events and preserves newer conflict events over operation replies", async (t) => {
    let connectionListener!: (value: unknown) => void;
    let stateListener!: (value: EpicCloudSaveState) => void;
    let finish!: (value: EpicCloudSaveState) => void;
    const { render } = await fixture(t, {
      getEpicCloudSaveState: async () => state(),
      onEpicCloudSaveStateChanged: (callback: typeof stateListener) => {
        stateListener = callback;
        return () => {};
      },
      onEpicConnectionChanged: (callback: typeof connectionListener) => {
        connectionListener = callback;
        return () => {};
      },
    });
    const hook = loadModule("./use-epic-managed.ts")
      .useEpicCloudSaves as typeof useEpicCloudSaves;
    let current!: ReturnType<typeof useEpicCloudSaves>;
    function Harness() {
      current = hook("namespace:executable");
      return null;
    }
    await render(React.createElement(Harness));
    const connection = {
      verification: "confirmed",
      hydraUserId: "user",
      connection: {
        connected: true,
        connectionId: "connection",
        epicAccountId: "account",
      },
    };
    await React.act(async () => connectionListener(connection));
    const firstGeneration = current.getGeneration();
    await React.act(async () => connectionListener(connection));
    assert.ok(current.getGeneration() > firstGeneration);
    let pending!: Promise<void>;
    await React.act(async () => {
      pending = current.run(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          })
      );
    });
    await React.act(async () =>
      stateListener(state({ status: "conflict", remoteManifest: "newer" }))
    );
    await React.act(async () => {
      finish(state());
      await pending;
    });
    assert.equal(current.state?.status, "conflict");
    assert.equal(current.state?.remoteManifest, "newer");
  });

  it("hides cloud controls when only part of the managed bridge is present", async (t) => {
    const { render } = await fixture(t, {
      getEpicCloudSaveState: async () => state(),
      syncEpicCloudSaves: undefined,
    });
    const hook = loadModule("./use-epic-managed.ts")
      .useEpicCloudSaves as typeof useEpicCloudSaves;
    let available = true;
    function Harness() {
      available = hook("namespace:executable").available;
      return null;
    }
    await render(React.createElement(Harness));
    assert.equal(available, false);
  });

  it("explains serialized launch prerequisites, external launchers and update errors without exposing raw messages", () => {
    const helpers = loadModule("../helpers/epic-managed-error.ts", {
      "../pages/settings/settings-epic-state": {
        getEpicErrorTranslation: (code: string) => `epic_error_${code}`,
      },
    }) as {
      getEpicLaunchError: typeof getEpicLaunchError;
      getEpicManagedError: typeof getEpicManagedError;
    };
    for (const [code, key] of [
      ["prerequisites-required", "epic_prerequisites_required"],
      ["update-required", "epic_update_required"],
      ["external-launcher-required", "epic_external_launcher_required"],
      ["session-expired", "epic_error_session-expired"],
      [
        "compatibility-runtime-unavailable",
        "epic_compatibility_runtime_unavailable",
      ],
      [
        "compatibility-runtime-download-failed",
        "epic_compatibility_runtime_download_failed",
      ],
      ["compatibility-prefix-invalid", "epic_compatibility_prefix_invalid"],
      ["compatibility-prefix-busy", "epic_compatibility_prefix_busy"],
      ["compatibility-launch-failed", "epic_compatibility_launch_failed"],
    ]) {
      const error = new Error(
        `Error invoking remote method 'openGame': EpicSaveFailure: ${code}`
      );
      const parsed = helpers.getEpicLaunchError(error);
      assert.equal(parsed, code);
      assert.equal(helpers.getEpicManagedError(parsed).key, key);
      if (code.startsWith("compatibility-"))
        assert.equal(helpers.getEpicManagedError(parsed).ns, "game_details");
    }
    assert.equal(
      helpers.getEpicLaunchError(
        new Error("untrusted output with credentials")
      ),
      undefined
    );
    assert.deepEqual(helpers.getEpicManagedError("unsupported-platform"), {
      key: "epic_install_platform_unsupported",
      ns: "game_details",
    });
  });

  it("shows only the game card, official launcher guidance and disabled download for external installation", async (t) => {
    let startCalls = 0;
    const { render } = await fixture(t, {
      getEpicGameInstallOptions: async () => ({
        options: [],
        error: "external-launcher-required",
      }),
      startEpicGameDownload: async () => {
        startCalls++;
        return { ok: true };
      },
      getDiskFreeSpace: async () => ({ free: 200 }),
    });
    const translations = JSON.parse(
      fs.readFileSync(
        new URL("../../../locales/pt-BR/translation.json", import.meta.url),
        "utf8"
      )
    ).game_details as Record<string, string>;
    const Modal = loadInstallModal(
      loadInstallHook("D:\\downloads"),
      { active: true },
      translations
    );
    await render(
      React.createElement(Modal, {
        game: {
          shop: "epic",
          objectId: "actual:epic",
          title: "External game",
          coverImageUrl: "https://example.test/external-cover.jpg",
        } as LibraryGame,
        onClose: () => {},
        onStarted: () => {},
      })
    );
    assert.equal(
      document.querySelector("[role='alert']")?.textContent,
      translations.epic_external_launcher_required
    );
    assert.match(
      document.querySelector("[role='alert']")!.textContent!,
      /depende de outro launcher/
    );
    assert.match(
      document.querySelector("[role='alert']")!.textContent!,
      /launcher oficial/
    );
    assert.doesNotMatch(
      document.querySelector("[role='alert']")!.textContent!,
      /Epic/
    );
    assert.equal(
      document.querySelector(".epic-install-modal__title")?.textContent,
      "External game"
    );
    assert.equal(
      document
        .querySelector(".epic-install-modal__cover img")
        ?.getAttribute("src"),
      "https://example.test/external-cover.jpg"
    );
    assert.equal(document.querySelector(".epic-install-modal__sizes"), null);
    assert.equal(
      document.querySelector(".download-settings-modal__downloads-path-field"),
      null
    );
    assert.equal(
      document.querySelector("[data-header-description]")?.textContent,
      ""
    );
    assert.equal(document.querySelector("input"), null);
    assert.equal(document.querySelector("select"), null);
    const buttons = Array.from(document.querySelectorAll("button"));
    assert.equal(
      buttons.some((button) =>
        [translations.epic_retry, "integrations"].includes(
          button.textContent ?? ""
        )
      ),
      false
    );
    const download = buttons.at(-1)!;
    assert.equal(buttons.length, 1);
    assert.equal(download.textContent, translations.download_now);
    assert.equal(download.disabled, true);
    await React.act(async () => download.click());
    assert.equal(startCalls, 0);
  });

  it("remains unavailable on an OTA renderer with no managed Epic bridge", async (t) => {
    const { render } = await fixture(t, {});
    const managed = loadModule("./use-epic-managed.ts");
    const connection =
      managed.useEpicManagedConnection as typeof useEpicManagedConnection;
    const cloud = managed.useEpicCloudSaves as typeof useEpicCloudSaves;
    let available: boolean[] = [];
    function Harness() {
      available = [
        connection().available,
        cloud("namespace:executable").available,
      ];
      return null;
    }
    await render(React.createElement(Harness));
    assert.deepEqual(available, [false, false]);
  });

  for (const { canRunOffline, launchError, conflict } of [
    { canRunOffline: false, launchError: "network", conflict: false },
    { canRunOffline: true, launchError: "network", conflict: false },
    { canRunOffline: true, launchError: "save-conflict", conflict: true },
    { canRunOffline: true, launchError: "network", conflict: true },
  ]) {
    it(`launches the selected Epic copy with both stores installed and routes ${launchError} to conflict (${conflict}) or offline retry (${canRunOffline})`, async (t) => {
      const calls: unknown[][] = [];
      const { render } = await fixture(t, {
        openGame: async (...args: unknown[]) => {
          calls.push(args);
          if (calls.length === 1) throw new Error(launchError);
        },
        getEpicCloudSaveState: async () =>
          state({
            status: conflict ? "conflict" : "unavailable",
            error: conflict ? "save-conflict" : "network",
            canRunOffline,
          }),
      });
      const game = {
        id: "epic:namespace:executable",
        shop: "epic",
        objectId: "namespace:executable",
        executablePath: "C:\\epic\\game.exe",
        launchOptions: "--windowed",
        hasActiveEpicImport: true,
        epicInstallation: {
          owner: {
            environment: "test",
            userId: "user",
            epicAccountId: "account",
          },
          artifactId: "app",
          platform: "Windows",
        },
      } as LibraryGame;
      const context = React.createContext({
        game,
        presentation: {
          members: [
            game,
            { ...game, id: "steam:123", shop: "steam", objectId: "123" },
          ],
        },
        downloadGame: null,
        repacks: [],
        updateGame: async () => {},
      });
      const ErrorHelpers = loadModule("../helpers/epic-managed-error.ts", {
        "../pages/settings/settings-epic-state": {
          getEpicErrorTranslation: (code: string) => `epic_error_${code}`,
        },
      });
      const Button = ({
        children,
        onClick,
        disabled,
      }: {
        children: React.ReactNode;
        onClick?: () => void;
        disabled?: boolean;
      }) => React.createElement("button", { onClick, disabled }, children);
      const Modal = ({
        visible,
        children,
      }: {
        visible: boolean;
        children: React.ReactNode;
      }) => (visible ? React.createElement("section", null, children) : null);
      const hooks = {
        useDownload: () => ({ isGameDeleting: () => false }),
        useLibrary: () => ({ updateLibrary: async () => {} }),
        useToast: () => ({
          showSuccessToast: () => {},
          showErrorToast: () => {},
        }),
        useUserDetails: () => ({ userDetails: null }),
      };
      const component = loadModule(
        "../pages/game-details/hero/hero-panel-actions.tsx",
        {
          "@renderer/components": {
            Button,
            Modal,
            ConfirmationModal: () => null,
          },
          "@renderer/hooks": hooks,
          "@renderer/context": { gameDetailsContext: context },
          "react-i18next": {
            useTranslation: () => ({ t: (key: string) => key }),
          },
          "react-router-dom": { useNavigate: () => () => {} },
          "@renderer/helpers": {
            canDownloadOnSteam: () => false,
            handleClassicsLaunchError: () => {},
          },
          "@renderer/helpers/epic-managed-error": ErrorHelpers,
          "@shared": {
            getInstalledStoreMembers,
            getOfficialStoreMembers,
            isLibraryGameDownloading: () => false,
            applyLibraryGroupAction: async () => {},
          },
          "../modals/disc-selection-modal": { DiscSelectionModal: () => null },
          "../modals/epic-cloud-save-conflict-modal": {
            EpicCloudSaveConflictModal: ({
              game: conflictGame,
            }: {
              game: LibraryGame | null;
            }) =>
              conflictGame
                ? React.createElement("section", {
                    "data-epic-save-conflict": conflictGame.objectId,
                  })
                : null,
          },
          "./hero-panel-actions.scss": {},
        }
      ).HeroPanelActions as React.FunctionComponent;
      await render(React.createElement(component));
      const findButton = (text: string) =>
        [...document.querySelectorAll("button")].find(
          (button) => button.textContent === text
        );
      await React.act(async () => findButton("play")!.click());
      assert.equal(
        !!findButton("epic_play_offline"),
        !conflict && canRunOffline
      );
      assert.equal(calls[0][0], "epic");
      assert.equal(calls[0][1], "namespace:executable");
      if (conflict) {
        assert.equal(
          document
            .querySelector("[data-epic-save-conflict]")
            ?.getAttribute("data-epic-save-conflict"),
          "namespace:executable"
        );
        assert.equal(!!findButton("epic_play_local_saves"), false);
        assert.equal(calls.length, 1);
        return;
      }
      if (canRunOffline) {
        await React.act(async () => findButton("epic_play_offline")!.click());
        assert.deepEqual(calls[1], [
          "epic",
          "namespace:executable",
          "C:\\epic\\game.exe",
          "--windowed",
          { epicOffline: true },
        ]);
      }
    });
  }
});
