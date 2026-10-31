import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  LibtorrentStatus,
  isQueueVerifyCandidate,
  isVerifyingStatus,
} from "./types.ts";

describe("isVerifyingStatus", () => {
  it("treats checking files as verifying", () => {
    assert.equal(isVerifyingStatus(LibtorrentStatus.CheckingFiles), true);
  });

  it("treats resume-data check as verifying", () => {
    assert.equal(isVerifyingStatus(LibtorrentStatus.CheckingResumeData), true);
    assert.equal(isVerifyingStatus(7), true);
  });

  it("does not treat terminal or active states as verifying", () => {
    assert.equal(
      isVerifyingStatus(LibtorrentStatus.DownloadingMetadata),
      false
    );
    assert.equal(isVerifyingStatus(LibtorrentStatus.Downloading), false);
    assert.equal(isVerifyingStatus(LibtorrentStatus.Finished), false);
    assert.equal(isVerifyingStatus(LibtorrentStatus.Seeding), false);
  });
});

describe("isQueueVerifyCandidate", () => {
  it("treats partial selection with saved zero as candidate", () => {
    assert.equal(
      isQueueVerifyCandidate({
        bytesDownloaded: 0,
        folderName: "Game",
        fileIndices: [0, 2],
      }),
      true
    );
  });

  it("treats selecting all files with saved zero as candidate", () => {
    assert.equal(
      isQueueVerifyCandidate({
        bytesDownloaded: 0,
        folderName: "Game",
        fileIndices: [0, 1, 2],
      }),
      true
    );
  });

  it("rejects downloads with progress and missing folders", () => {
    assert.equal(
      isQueueVerifyCandidate({ bytesDownloaded: 5, folderName: "Game" }),
      false
    );
    assert.equal(
      isQueueVerifyCandidate({ bytesDownloaded: 0, folderName: null }),
      false
    );
  });
});
