import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  applyPendingFolderPreview,
  preparePendingFolderPreview,
} from "./pending-rom-folder-preview.js";
import type { PendingFolder } from "./types.js";

const folder = (overrides: Partial<PendingFolder> = {}): PendingFolder => ({
  path: "D:\\ROMS\\Dolphin",
  scanSubfolders: true,
  previewCount: 9,
  previewRequestId: 0,
  ...overrides,
});

describe("pending ROM folder previews", () => {
  it("starts a new preview every time subfolder scanning changes", () => {
    const disabled = preparePendingFolderPreview([folder()], 0, 1, {
      scanSubfolders: false,
    });
    assert.ok(disabled);
    assert.equal(disabled.request.scanSubfolders, false);
    assert.equal(disabled.folders[0].previewCount, null);

    const enabled = preparePendingFolderPreview(disabled.folders, 0, 2, {
      scanSubfolders: true,
    });
    assert.ok(enabled);
    assert.equal(enabled.request.scanSubfolders, true);
    assert.equal(enabled.request.requestId, 2);
  });

  it("ignores a preview that finished after a newer checkbox change", () => {
    const current = folder({ previewCount: null, previewRequestId: 2 });
    const staleResult = applyPendingFolderPreview(
      [current],
      { path: current.path, scanSubfolders: true, requestId: 1 },
      9
    );

    assert.deepEqual(staleResult, [current]);
  });

  it("applies the latest matching preview", () => {
    const current = folder({ previewCount: null, previewRequestId: 2 });
    const result = applyPendingFolderPreview(
      [current],
      { path: current.path, scanSubfolders: true, requestId: 2 },
      9
    );

    assert.equal(result[0].previewCount, 9);
  });
});
