import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DownloadError, Downloader } from "../../../shared/constants.ts";
import {
  getRendererDownloadBucket,
  isQueuedDownload,
} from "../../../types/download-contract.ts";
import type { Download } from "../../../types/level.types";
import { isDebridPendingError } from "./debrid-pending.ts";

describe("pending debrid downloads", () => {
  it("recognizes processing responses from each debrid service", () => {
    for (const [downloader, message] of [
      [Downloader.TorBox, DownloadError.TorBoxTorrentNotReady],
      [Downloader.RealDebrid, DownloadError.NotCachedOnRealDebrid],
      [Downloader.RealDebrid, DownloadError.RealDebridTorrentNotReady],
      [Downloader.Premiumize, DownloadError.PremiumizeTransferStarted],
      [Downloader.Premiumize, DownloadError.NotCachedOnPremiumize],
      [Downloader.AllDebrid, DownloadError.NotCachedOnAllDebrid],
    ] as const) {
      assert.equal(isDebridPendingError(new Error(message), downloader), true);
    }

    assert.equal(
      isDebridPendingError(
        new Error(DownloadError.TorBoxAccountNotAuthorized),
        Downloader.TorBox
      ),
      false
    );
    assert.equal(
      isDebridPendingError(
        new Error(DownloadError.NotCachedOnRealDebrid),
        Downloader.Torrent
      ),
      false
    );
  });

  it("shows a saved pending item without scheduling an automatic start", () => {
    const download: Download = {
      shop: "steam",
      objectId: "pending-item",
      uri: "magnet:?xt=urn:btih:example",
      folderName: null,
      downloadPath: "/downloads",
      progress: 0,
      downloader: Downloader.TorBox,
      bytesDownloaded: 0,
      fileSize: null,
      shouldSeed: false,
      status: "paused",
      queued: false,
      awaitingDebrid: true,
      timestamp: 1,
      extracting: false,
      automaticallyExtract: false,
      automaticallyDeleteArchiveFiles: false,
    };

    assert.equal(getRendererDownloadBucket(download), "queued");
    assert.equal(isQueuedDownload(download), false);
  });
});
