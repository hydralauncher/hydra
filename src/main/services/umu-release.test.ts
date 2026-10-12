import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { compareUmuVersions, parseUmuRelease } from "./umu-release.js";

const zipappAsset = {
  name: "umu-launcher-1.4.4-zipapp.tar",
  browser_download_url:
    "https://github.com/Open-Wine-Components/umu-launcher/releases/download/1.4.4/umu-launcher-1.4.4-zipapp.tar",
  digest:
    "sha256:eb590691841f7fad3fc3ad8fd5db4ccb87849fe7948e62b28ece7a4ee48cc851",
};

describe("umu release parsing", () => {
  it("reads the zipapp asset and its digest", () => {
    assert.deepEqual(
      parseUmuRelease({
        tag_name: "1.4.4",
        draft: false,
        prerelease: false,
        assets: [
          { name: "umu-launcher-1.4.4.fc43.x86_64.rpm", digest: "sha256:00" },
          zipappAsset,
        ],
      }),
      {
        version: "1.4.4",
        downloadUrl: zipappAsset.browser_download_url,
        sha256:
          "eb590691841f7fad3fc3ad8fd5db4ccb87849fe7948e62b28ece7a4ee48cc851",
      }
    );
  });

  it("rejects releases that cannot be verified or are not final", () => {
    assert.equal(
      parseUmuRelease({
        assets: [{ ...zipappAsset, digest: undefined }],
      }),
      null
    );
    assert.equal(
      parseUmuRelease({
        assets: [
          {
            ...zipappAsset,
            browser_download_url: "https://example.com/umu.tar",
          },
        ],
      }),
      null
    );
    assert.equal(
      parseUmuRelease({ prerelease: true, assets: [zipappAsset] }),
      null
    );
    assert.equal(parseUmuRelease({ assets: [] }), null);
    assert.equal(parseUmuRelease(null), null);
  });
});

describe("umu version comparison", () => {
  it("compares numeric segments", () => {
    assert.equal(compareUmuVersions("1.4.4", "1.3.0"), 1);
    assert.equal(compareUmuVersions("1.4.10", "1.4.9"), 1);
    assert.equal(compareUmuVersions("1.4", "1.4.0"), 0);
    assert.equal(compareUmuVersions("1.3.0", "1.4.4"), -1);
  });
});
