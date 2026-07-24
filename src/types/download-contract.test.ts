import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Downloader } from "../shared/constants.js";
import { isDownloadInFlight } from "./download-contract.js";
import type { Download } from "./level.types.js";

const buildDownload = (overrides: Partial<Download> = {}): Download => ({
  shop: "steam",
  objectId: "1",
  uri: "magnet:?xt=urn:btih:1",
  folderName: null,
  downloadPath: "/downloads",
  progress: 0,
  downloader: Downloader.Torrent,
  bytesDownloaded: 0,
  fileSize: null,
  shouldSeed: false,
  status: "active",
  queued: false,
  timestamp: 0,
  extracting: false,
  automaticallyExtract: false,
  automaticallyDeleteArchiveFiles: false,
  ...overrides,
});

describe("isDownloadInFlight", () => {
  it("reports active, paused, queued and errored downloads as in flight", () => {
    assert.equal(isDownloadInFlight(buildDownload({ status: "active" })), true);
    assert.equal(isDownloadInFlight(buildDownload({ status: "paused" })), true);
    assert.equal(
      isDownloadInFlight(buildDownload({ status: "paused", queued: true })),
      true
    );
    assert.equal(isDownloadInFlight(buildDownload({ status: "error" })), true);
    assert.equal(isDownloadInFlight(buildDownload({ status: null })), true);
  });

  it("reports extracting downloads as in flight", () => {
    assert.equal(
      isDownloadInFlight(
        buildDownload({ status: "complete", extracting: true, progress: 1 })
      ),
      true
    );
  });

  it("does not report finished or removed downloads as in flight", () => {
    assert.equal(
      isDownloadInFlight(buildDownload({ status: "complete", progress: 1 })),
      false
    );
    assert.equal(
      isDownloadInFlight(buildDownload({ status: "seeding", progress: 1 })),
      false
    );
    assert.equal(
      isDownloadInFlight(buildDownload({ status: "removed" })),
      false
    );
  });
});
