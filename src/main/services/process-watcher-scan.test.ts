import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";

import {
  isValidProcessWatcherScan,
  startOptionalExecutableCatalogueLoad,
} from "./process-watcher-scan.js";

describe("process watcher scan result", () => {
  it("skips failed enumeration but accepts a valid empty map", () => {
    assert.equal(isValidProcessWatcherScan(null), false);
    assert.equal(
      isValidProcessWatcherScan({
        processMap: {},
        winePrefixMap: {},
        linuxProcesses: [],
      }),
      true
    );
  });

  it("starts optional executable catalogue loading without blocking the watcher", () => {
    const loadOptionalExecutableCatalogue = mock.fn(async () => false);

    startOptionalExecutableCatalogueLoad(loadOptionalExecutableCatalogue);

    assert.equal(loadOptionalExecutableCatalogue.mock.callCount(), 1);
  });

  it("returns before optional executable catalogue loading finishes", () => {
    let finishLoading!: (loaded: boolean) => void;
    const loadOptionalExecutableCatalogue = mock.fn(
      () =>
        new Promise<boolean>((resolve) => {
          finishLoading = resolve;
        })
    );
    startOptionalExecutableCatalogueLoad(loadOptionalExecutableCatalogue);

    assert.equal(loadOptionalExecutableCatalogue.mock.callCount(), 1);
    finishLoading(false);
  });
});
