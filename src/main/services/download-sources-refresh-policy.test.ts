import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  DOWNLOAD_SOURCES_REFRESH_INTERVAL_MS,
  getDownloadSourcesSignature,
  shouldAdvanceDownloadSourcesBaseline,
  shouldRefreshDownloadSources,
} from "./download-sources-refresh-policy.ts";

describe("download sources refresh policy", () => {
  const now = Date.UTC(2026, 0, 1);
  const sourceSignature = getDownloadSourcesSignature(["b", "a"]);

  it("keeps the source signature stable regardless of source ordering", () => {
    assert.equal(sourceSignature, getDownloadSourcesSignature(["a", "b"]));
    assert.equal(
      getDownloadSourcesSignature(["source-10", "source-2"]),
      getDownloadSourcesSignature(["source-2", "source-10"])
    );
  });

  it("refreshes on the first run, an elapsed interval, or a source change", () => {
    assert.equal(
      shouldRefreshDownloadSources({
        lastCheckedAt: null,
        lastSourceSignature: null,
        sourceSignature,
        now,
      }),
      true
    );
    assert.equal(
      shouldRefreshDownloadSources({
        lastCheckedAt: now,
        lastSourceSignature: sourceSignature,
        sourceSignature,
        now,
      }),
      false
    );
    assert.equal(
      shouldRefreshDownloadSources({
        lastCheckedAt: now - DOWNLOAD_SOURCES_REFRESH_INTERVAL_MS,
        lastSourceSignature: sourceSignature,
        sourceSignature,
        now,
      }),
      true
    );
    assert.equal(
      shouldRefreshDownloadSources({
        lastCheckedAt: now,
        lastSourceSignature: getDownloadSourcesSignature(["a"]),
        sourceSignature,
        now,
      }),
      true
    );
  });

  it("advances the session baseline only for non-manual checks", () => {
    assert.equal(shouldAdvanceDownloadSourcesBaseline(false), true);
    assert.equal(shouldAdvanceDownloadSourcesBaseline(true), false);
  });
});
