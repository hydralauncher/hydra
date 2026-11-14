import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import { describe, it } from "node:test";
import ts from "typescript";
import type { Download, LibraryGame } from "@types";
import * as downloadContract from "../../../../types/download-contract.js";
import type * as DownloadIndicatorModule from "./download-indicator";

const requireModule = createRequire(import.meta.url);
const filename = "src/renderer/src/components/sidebar/download-indicator.ts";
const { outputText } = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
  fileName: filename,
});
const loadedModule = { exports: {} as typeof DownloadIndicatorModule };
new Function("require", "module", "exports", outputText)(
  (specifier: string) =>
    specifier === "../../../../types"
      ? downloadContract
      : requireModule(specifier),
  loadedModule,
  loadedModule.exports
);
const { getDownloadIndicatorState } = loadedModule.exports;

const game = (
  objectId: string,
  download: Partial<Download> | null
): LibraryGame =>
  ({
    id: `steam:${objectId}`,
    objectId,
    shop: "steam",
    title: objectId,
    download: download && {
      shop: "steam",
      objectId,
      progress: 0,
      status: "paused",
      queued: false,
      extracting: false,
      timestamp: 0,
      ...download,
    },
  }) as LibraryGame;

const packet = (gameId: string, progress: number, flags = {}) => ({
  gameId,
  progress,
  isDownloadingMetadata: false,
  isReconnecting: false,
  isRecovering: false,
  ...flags,
});

describe("getDownloadIndicatorState", () => {
  it("is idle with no downloads", () => {
    assert.deepEqual(
      getDownloadIndicatorState({
        downloads: [game("done", { status: "complete", progress: 1 })],
        lastPacket: null,
        extraction: null,
        queueOrder: [],
      }),
      { phase: "idle", progress: null, games: 0 }
    );
  });

  it("counts the active game and every queued game", () => {
    const state = getDownloadIndicatorState({
      downloads: [
        game("active", { status: "active", progress: 0.42 }),
        game("next", { status: "paused", queued: true }),
        game("later", { status: "paused", queued: true }),
        game("removed", { status: "removed", queued: true }),
      ],
      lastPacket: packet("steam:active", 0.42),
      extraction: null,
      queueOrder: [],
    });

    assert.deepEqual(state, { phase: "downloading", progress: 0.42, games: 3 });
  });

  it("has no percent while it fetches metadata or reconnects", () => {
    for (const flags of [
      { isDownloadingMetadata: true },
      { isReconnecting: true },
    ]) {
      const state = getDownloadIndicatorState({
        downloads: [game("active", { status: "active" })],
        lastPacket: packet("steam:active", 0.3, flags),
        extraction: null,
        queueOrder: [],
      });

      assert.deepEqual(state, { phase: "preparing", progress: null, games: 1 });
    }
  });

  it("shows recovery progress while it re-downloads the saved portion", () => {
    const state = getDownloadIndicatorState({
      downloads: [game("active", { status: "active" })],
      lastPacket: packet("steam:active", 0.8, {
        isRecovering: true,
        recoveryProgress: 0.25,
      }),
      extraction: null,
      queueOrder: [],
    });

    assert.equal(state.progress, 0.25);
  });

  it("shows extraction once the download itself is done", () => {
    const state = getDownloadIndicatorState({
      downloads: [game("unpacking", { status: "complete", extracting: true })],
      lastPacket: null,
      extraction: { visibleId: "steam:unpacking", progress: 0.7 },
      queueOrder: [],
    });

    assert.deepEqual(state, { phase: "extracting", progress: 0.7, games: 1 });
  });

  it("falls back to the stored extraction progress", () => {
    const state = getDownloadIndicatorState({
      downloads: [
        game("unpacking", {
          status: "complete",
          extracting: true,
          extractionProgress: 0.5,
        }),
      ],
      lastPacket: null,
      extraction: null,
      queueOrder: [],
    });

    assert.deepEqual(state, { phase: "extracting", progress: 0.5, games: 1 });
  });

  it("is preparing when a download is active before its first packet", () => {
    const state = getDownloadIndicatorState({
      downloads: [game("starting", { status: "active" })],
      lastPacket: null,
      extraction: null,
      queueOrder: [],
    });

    assert.deepEqual(state, { phase: "preparing", progress: null, games: 1 });
  });

  it("is paused when games are queued but none is running", () => {
    const state = getDownloadIndicatorState({
      downloads: [
        game("later", { status: "paused", queued: true, progress: 0.1 }),
        game("head", { status: "paused", queued: true, progress: 0.42 }),
        game("oldest", {
          status: "paused",
          queued: true,
          progress: 0.9,
          timestamp: -1,
        }),
      ],
      lastPacket: null,
      extraction: null,
      queueOrder: ["steam:head", "steam:later"],
    });

    assert.deepEqual(state, { phase: "paused", progress: 0.42, games: 3 });
  });

  it("ignores downloads the user paused and downloads that failed", () => {
    const state = getDownloadIndicatorState({
      downloads: [
        game("paused", { status: "paused", progress: 0.9 }),
        game("failed", { status: "error", progress: 0.3 }),
      ],
      lastPacket: null,
      extraction: null,
      queueOrder: [],
    });

    assert.deepEqual(state, { phase: "idle", progress: null, games: 0 });
  });
});
