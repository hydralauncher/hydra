import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { LibtorrentStatus, isVerifyingStatus } from "./types.ts";

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
