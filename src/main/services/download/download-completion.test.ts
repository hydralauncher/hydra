import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { shouldFinalizeDownload } from "./download-completion.ts";

describe("shouldFinalizeDownload", () => {
  it("Epic waits for verified completion even after telemetry reaches 100 percent", () => {
    const input = {
      usingJsDownloader: false,
      usingEpicDownloader: true,
      isCheckingFiles: false,
      isDownloadingMetadata: false,
      progress: 1,
      downloadStatus: "active" as const,
    };
    assert.equal(shouldFinalizeDownload(input), false);
    assert.equal(
      shouldFinalizeDownload({ ...input, downloadStatus: "complete" }),
      true
    );
    assert.equal(
      shouldFinalizeDownload({
        ...input,
        downloadStatus: "complete",
        isCheckingFiles: true,
      }),
      false
    );
  });
  it("waits for JS downloads to report complete before finalizing", () => {
    assert.equal(
      shouldFinalizeDownload({
        usingJsDownloader: true,
        isCheckingFiles: false,
        isDownloadingMetadata: false,
        progress: 1,
        downloadStatus: "active",
      }),
      false
    );
  });

  it("finalizes JS downloads once the persisted status is complete", () => {
    assert.equal(
      shouldFinalizeDownload({
        usingJsDownloader: true,
        isCheckingFiles: false,
        isDownloadingMetadata: false,
        progress: 1,
        downloadStatus: "complete",
      }),
      true
    );
  });

  it("preserves progress-based completion for torrent downloads", () => {
    assert.equal(
      shouldFinalizeDownload({
        usingJsDownloader: false,
        isCheckingFiles: false,
        isDownloadingMetadata: false,
        progress: 1,
        downloadStatus: "active",
      }),
      true
    );
  });

  it("does not finalize while metadata or file checks are in progress", () => {
    assert.equal(
      shouldFinalizeDownload({
        usingJsDownloader: false,
        isCheckingFiles: true,
        isDownloadingMetadata: false,
        progress: 1,
        downloadStatus: "active",
      }),
      false
    );

    assert.equal(
      shouldFinalizeDownload({
        usingJsDownloader: false,
        isCheckingFiles: false,
        isDownloadingMetadata: true,
        progress: 1,
        downloadStatus: "active",
      }),
      false
    );
  });
});
