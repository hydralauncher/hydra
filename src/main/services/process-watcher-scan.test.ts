import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { isValidProcessWatcherScan } from "./process-watcher-scan.js";

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
});
