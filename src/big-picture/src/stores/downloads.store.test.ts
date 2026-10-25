import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs";
import { createRequire } from "node:module";
import ts from "typescript";
import type { DownloadProgress } from "@types";
const requireModule = createRequire(import.meta.url);
const exports: Record<string, unknown> = {};
const source = fs.readFileSync(
  new URL("./downloads.store.ts", import.meta.url),
  "utf8"
);
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
});
new Function("exports", "require", outputText)(exports, requireModule);
type TestStore = {
  getState: () => {
    setLastPacket: (packet: DownloadProgress | null) => void;
    packetsByGameId: Record<string, DownloadProgress>;
    speedHistoryByGameId: Record<string, number[]>;
  };
};
const useBigPictureDownloadsStore =
  exports.useBigPictureDownloadsStore as TestStore;

test("interleaved progress and completion retain the other transfer's packet and history", () => {
  const store = useBigPictureDownloadsStore;
  const packet = (gameId: string, progress: number, downloadSpeed: number) =>
    ({ gameId, progress, downloadSpeed }) as DownloadProgress;
  store.getState().setLastPacket(packet("steam:first", 0.2, 100));
  store.getState().setLastPacket(packet("steam:second", 0.4, 200));
  store.getState().setLastPacket(null);
  assert.equal(store.getState().packetsByGameId["steam:first"].progress, 0.2);
  assert.equal(store.getState().packetsByGameId["steam:second"].progress, 0.4);
  store.getState().setLastPacket(packet("steam:second", 1, 0));
  assert.equal(store.getState().packetsByGameId["steam:second"], undefined);
  assert.equal(
    store.getState().packetsByGameId["steam:first"].downloadSpeed,
    100
  );
  assert.deepEqual(store.getState().speedHistoryByGameId["steam:first"], [100]);
  assert.deepEqual(store.getState().speedHistoryByGameId["steam:second"], [
    200,
  ]);
});
