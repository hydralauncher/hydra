import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";

import {
  isValidProcessWatcherScan,
  shouldBroadcastGamesRunning,
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

describe("games-running broadcasts", () => {
  it("sends the first empty state and suppresses repeated empty states", () => {
    assert.equal(shouldBroadcastGamesRunning(0, false), true);
    assert.equal(shouldBroadcastGamesRunning(0, true), false);
  });

  it("always sends while games are running", () => {
    assert.equal(shouldBroadcastGamesRunning(1, false), true);
    assert.equal(shouldBroadcastGamesRunning(1, true), true);
  });
});
