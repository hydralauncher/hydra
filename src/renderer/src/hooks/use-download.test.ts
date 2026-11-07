import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import ts from "typescript";
import type { DownloadProgress } from "@types";

const require = createRequire(import.meta.url);

function loadModule(file: URL, stubs: Record<string, unknown>) {
  const { outputText } = ts.transpileModule(fs.readFileSync(file, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  });
  const exports: Record<string, unknown> = {};
  new Function("exports", "require", outputText)(exports, (name: string) =>
    Object.hasOwn(stubs, name) ? stubs[name] : require(name)
  );
  return exports as unknown as typeof import("./use-download") &
    typeof import("../features/download-slice");
}

test("download consumers keep per-game progress when concurrent packets alternate", () => {
  const { downloadSlice } = loadModule(
    new URL("../features/download-slice.ts", import.meta.url),
    { "@renderer/constants": { MAX_DOWNLOAD_SPEED_HISTORY: 30 } }
  );
  let state = downloadSlice.reducer(undefined, { type: "init" });
  const { useDownload: readDownload } = loadModule(
    new URL("./use-download.ts", import.meta.url),
    {
      "@renderer/helpers": {
        formatDownloadProgress: (progress: number) => `${progress * 100}%`,
      },
      "./use-library": { useLibrary: () => ({ updateLibrary: () => {} }) },
      "./redux": {
        useAppSelector: (selector: (state: unknown) => unknown) =>
          selector({ download: state, userPreferences: { value: null } }),
        useAppDispatch:
          () => (action: Parameters<typeof downloadSlice.reducer>[1]) => {
            state = downloadSlice.reducer(state, action);
          },
      },
      "@renderer/features": downloadSlice.actions,
      "./use-date": { useDate: () => ({ formatDistance: () => "soon" }) },
      "@shared": { formatBytes: String, formatBytesToMbps: String },
    }
  );
  const first = {
    gameId: "steam:first",
    progress: 0.2,
    downloadSpeed: 10,
    timeRemaining: 100,
  } as DownloadProgress;
  const second = {
    gameId: "steam:second",
    progress: 0.8,
    downloadSpeed: 20,
    timeRemaining: 200,
  } as DownloadProgress;
  for (const packet of [first, second, { ...first, progress: 0.3 }, second]) {
    state = downloadSlice.reducer(
      state,
      downloadSlice.actions.setLastPacket(packet)
    );
    assert.equal(readDownload().lastPacket.gameId, first.gameId);
  }
  assert.equal(readDownload(first.gameId).progress, "30%");
  assert.equal(readDownload(second.gameId).progress, "80%");
  assert.equal(readDownload("steam:idle").lastPacket, null);
  readDownload().clearDownloadById(first.gameId);
  assert.equal(readDownload().lastPacket.gameId, second.gameId);
  assert.equal(readDownload(first.gameId).lastPacket, null);
});
