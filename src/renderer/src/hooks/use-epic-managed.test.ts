import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import { describe, it, type TestContext } from "node:test";
import { JSDOM } from "jsdom";
import * as React from "react";
import { createRoot } from "react-dom/client";
import ts from "typescript";
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
    (name: string) => stubs[name] ?? requireModule(name)
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
  lastPacket: unknown = null
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
          values ? `${key}:${values.space ?? values.size}` : key,
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
    "@renderer/helpers/epic-managed-error": {
      getEpicManagedError: () => ({ key: "error", ns: "game_details" }),
    },
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
  t.after(async () => {
    await React.act(async () => root.unmount());
    dom.window.close();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  });
  const render = async (component: React.ReactElement) =>
    React.act(async () => root.render(component));
  return { render };
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
  it("prefetches only the confirmed real Epic copy on page entry and stays quiet on failures or old bridges", async (t) => {
    const calls: string[] = [];
    const { render } = await fixture(t, {
      getEpicGameInstallOptions: async (objectId: string) => {
        calls.push(objectId);
        throw new Error("preview unavailable");
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
    const element = (currentGame = game) =>
      React.createElement(
        context.Provider,
        { value: { ...contextValue, game: currentGame } },
        React.createElement(Repacks, {
          visible: false,
          onClose: () => {},
          startDownload: async () => ({ ok: true }),
        })
      );
    await render(element());
    assert.deepEqual(calls, []);
    connection = { ...connection, verification: "confirmed" };
    await render(element());
    assert.deepEqual(calls, ["actual:epic"]);
    await render(element({ ...game, title: "updated metadata" }));
    assert.deepEqual(calls, ["actual:epic"]);
    const nextGame = { ...game, objectId: "next:epic" };
    await render(element(nextGame));
    assert.deepEqual(calls, ["actual:epic", "next:epic"]);
    connection = { ...connection, hydraUserId: "other-user" };
    await render(element());
    assert.equal(calls.length, 2);
    connection = { ...connection, hydraUserId: "user" };
    Object.assign(electron, { getEpicGameInstallOptions: undefined });
    await render(element());
    assert.equal(calls.length, 2);
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

  it("passes the observed manifest in an explicit conflict decision", async (t) => {
    const calls: unknown[] = [];
    const { render } = await fixture(t, {
      getEpicCloudSaveState: async () =>
        state({ status: "conflict", remoteManifest: "remote-v2" }),
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

  it("explains serialized launch prerequisites and update errors without exposing raw messages", () => {
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
      ["session-expired", "epic_error_session-expired"],
    ]) {
      const error = new Error(
        `Error invoking remote method 'openGame': EpicSaveFailure: ${code}`
      );
      const parsed = helpers.getEpicLaunchError(error);
      assert.equal(parsed, code);
      assert.equal(helpers.getEpicManagedError(parsed).key, key);
    }
    assert.equal(
      helpers.getEpicLaunchError(
        new Error("untrusted output with credentials")
      ),
      undefined
    );
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
    it(`routes launch failure ${launchError} to conflict resolution (${conflict}) or supported offline retry (${canRunOffline}) for the real Epic copy`, async (t) => {
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
        presentation: null,
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
