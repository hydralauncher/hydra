import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { describe, it } from "node:test";
import { JSDOM } from "jsdom";
import * as React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react-dom/test-utils";
import ts from "typescript";
import type { LibraryGame } from "@types";
import { getBigPictureDownloadView } from "../../../types/download-contract.js";
import { readActiveLibraryDownload } from "../components/modals/download-game/download-queue.js";

const requireModule = createRequire(import.meta.url);

function loadModule(file: string, stubs: Record<string, unknown>) {
  const filename = path.resolve(process.cwd(), "src/big-picture/src", file);
  const { outputText } = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true },
    fileName: filename,
  });
  const exports: Record<string, unknown> = {};
  new Function("exports", "require", outputText)(
    exports,
    (name: string) => stubs[name] ?? requireModule(name)
  );
  return exports;
}

function game(
  objectId: string,
  status: NonNullable<LibraryGame["download"]>["status"],
  isConcealed = true,
  options: { queued?: boolean; extracting?: boolean } = {}
): LibraryGame {
  return {
    id: `steam:${objectId}`,
    objectId,
    shop: "steam",
    title: objectId,
    isConcealed,
    download: {
      shop: "steam",
      objectId,
      status,
      downloader: 1,
      progress: status === "complete" ? 1 : 0.5,
      bytesDownloaded: 50,
      fileSize: 100,
      ...options,
    },
  } as LibraryGame;
}

describe("Big Picture operational download library", () => {
  it("refreshes concealed downloads while keeping the visible library filtered", async () => {
    const dom = new JSDOM("<div id='root'></div>");
    const globalKeys = ["window", "document", "IS_REACT_ACT_ENVIRONMENT"];
    const previous = globalKeys.map((key) =>
      Object.getOwnPropertyDescriptor(globalThis, key)
    );
    Object.assign(globalThis, {
      window: dom.window,
      document: dom.window.document,
      IS_REACT_ACT_ENVIRONMENT: true,
    });

    let games = [game("visible", "complete", false), game("hidden", "active")];
    const reads: Array<boolean | undefined> = [];
    const listeners = new Map<string, () => void>();
    const unsubscribed: string[] = [];
    const subscribe = (event: string) => (callback: () => void) => {
      listeners.set(event, callback);
      return () => unsubscribed.push(event);
    };
    Object.assign(dom.window, {
      electron: {
        getLibrary: async (includeConcealed?: boolean) => {
          reads.push(includeConcealed);
          return games.filter(
            (entry) => includeConcealed || !entry.isConcealed
          );
        },
        onLibraryBatchComplete: subscribe("batch"),
        onDownloadsUpdated: subscribe("downloads"),
      },
    });

    type HookResult = {
      library: LibraryGame[];
      downloadLibrary: LibraryGame[];
    };
    const useLibrary = loadModule("hooks/use-library.hook.ts", {
      "../constants": { IS_DESKTOP: true },
    }).useLibrary as () => HookResult;
    let current: HookResult = { library: [], downloadLibrary: [] };
    const Probe = () => {
      current = useLibrary();
      return null;
    };
    const root = createRoot(dom.window.document.getElementById("root")!);

    try {
      await act(async () => root.render(React.createElement(Probe)));
      assert.deepEqual(
        current.library.map((entry) => entry.id),
        ["steam:visible"]
      );
      assert.deepEqual(
        current.downloadLibrary.map((entry) => entry.id),
        ["steam:visible", "steam:hidden"]
      );

      games = [game("visible", "complete"), game("hidden", "paused")];
      await act(async () => listeners.get("downloads")!());
      assert.equal(current.library.length, 0);
      assert.equal(current.downloadLibrary[1].download?.status, "paused");

      games = [game("hidden", "paused", false)];
      await act(async () =>
        dom.window.dispatchEvent(new dom.window.Event("library-update"))
      );
      assert.deepEqual(
        current.library.map((entry) => entry.id),
        ["steam:hidden"]
      );

      games = [game("new", "active")];
      await act(async () => listeners.get("batch")!());
      assert.equal(current.library.length, 0);
      assert.equal(current.downloadLibrary[0].id, "steam:new");
      assert.deepEqual(reads, [true, true, true, true]);
    } finally {
      await act(async () => root.unmount());
      dom.window.close();
      globalKeys.forEach((key, index) => {
        const descriptor = previous[index];
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else Reflect.deleteProperty(globalThis, key);
      });
    }
    assert.deepEqual(unsubscribed.sort(), ["batch", "downloads"]);
  });

  it("shows concealed active, queued, paused and completed downloads", () => {
    const games = [
      game("active", "active"),
      game("queued", "paused", true, { queued: true }),
      game("paused", "paused"),
      game("complete", "complete"),
      game("removed", "removed"),
    ];
    const store = {
      lastPacket: null,
      seedingStatuses: [],
      extractionProgressByGameId: {},
      speedHistoryByGameId: {},
      peakSpeedByGameId: {},
      setLastPacket: () => {},
    };
    const useDownloadsPageData = loadModule(
      "pages/downloads/use-big-picture-downloads-page-data.ts",
      {
        react: {
          useState: (value: unknown) => [value, () => {}],
          useMemo: (callback: () => unknown) => callback(),
          useCallback: (callback: unknown) => callback,
          useEffect: () => {},
        },
        "@shared": {
          Downloader: {},
          formatBytes: String,
          formatBytesToMbps: String,
        },
        "../../../../types": { getBigPictureDownloadView },
        "react-i18next": {
          useTranslation: () => ({ t: (key: string) => key }),
        },
        "../../constants": { IS_DESKTOP: false, DOWNLOADER_NAME: {} },
        "../../helpers": {
          getBigPictureGameDetailsPath: () => "/game",
          resolveImageSource: (value: unknown) => value,
        },
        "../../hooks": {
          useLibrary: () => ({
            library: [],
            downloadLibrary: games,
            updateLibrary: () => {},
          }),
          useDate: () => ({ formatDistance: String, formatTime: String }),
          useDownloadLayout: () => ({
            layoutState: { version: 1, queueOrder: [], pausedOrder: [] },
          }),
        },
        "../../stores": {
          useBigPictureDownloadsStore: (
            selector: (value: typeof store) => unknown
          ) => selector(store),
        },
      }
    ).useBigPictureDownloadsPageData as () => {
      activeDownload: { id: string };
      queuedDownloads: Array<{ id: string }>;
      pausedDownloads: Array<{ id: string }>;
      completedDownloads: Array<{ id: string }>;
      hasDownloads: boolean;
    };
    const result = useDownloadsPageData();
    assert.equal(result.activeDownload.id, "steam:active");
    assert.deepEqual(
      result.queuedDownloads.map((entry) => entry.id),
      ["steam:queued"]
    );
    assert.deepEqual(
      result.pausedDownloads.map((entry) => entry.id),
      ["steam:paused"]
    );
    assert.deepEqual(
      result.completedDownloads.map((entry) => entry.id),
      ["steam:complete"]
    );
    assert.equal(result.hasDownloads, true);
  });
});

describe("Big Picture download queue reads", () => {
  for (const entry of [
    game("active", "active"),
    game("extracting", "extracting"),
    game("extracting-flag", "complete", true, { extracting: true }),
  ]) {
    it(`queues for concealed ${entry.objectId} downloads`, async () => {
      const reads: Array<boolean | undefined> = [];
      const shouldQueue = await readActiveLibraryDownload(
        async (includeConcealed) => {
          reads.push(includeConcealed);
          return includeConcealed ? [entry] : [];
        }
      );
      assert.equal(shouldQueue, true);
      assert.deepEqual(reads, [true]);
    });
  }

  it("starts directly when the library is empty or only has finished downloads", async () => {
    assert.equal(await readActiveLibraryDownload(async () => []), false);
    assert.equal(
      await readActiveLibraryDownload(async () => [
        game("finished", "complete"),
      ]),
      false
    );
  });

  it("rechecks concealed active downloads after the initial preview", async () => {
    let games: LibraryGame[] = [];
    const getLibrary = async (includeConcealed?: boolean) =>
      games.filter((entry) => includeConcealed || !entry.isConcealed);
    assert.equal(await readActiveLibraryDownload(getLibrary), false);
    games = [game("started-later", "active")];
    assert.equal(await readActiveLibraryDownload(getLibrary), true);
  });
});
