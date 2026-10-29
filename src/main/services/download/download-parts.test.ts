import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  estimateMultipartTotalBytes,
  getDownloadParts,
  getMultipartFolderName,
} from "./download-parts.ts";

describe("getDownloadParts", () => {
  it("accepts ordered parts that start with the download URI", () => {
    assert.deepEqual(getDownloadParts("a", ["a", "b"]), ["a", "b"]);
    assert.equal(getDownloadParts("a", undefined), undefined);
  });

  it("rejects parts that cannot be one download", () => {
    for (const parts of [["a"], ["b", "a"], ["a", "a"], ["a", ""], "a"]) {
      assert.throws(() => getDownloadParts("a", parts));
    }
  });
});

describe("getMultipartFolderName", () => {
  it("removes the first volume suffix", () => {
    assert.equal(
      getMultipartFolderName("Example_Game_--_v1.0_--_.part1.rar"),
      "Example_Game_--_v1.0"
    );
    assert.equal(getMultipartFolderName("Game.part001.rar"), "Game");
    assert.equal(getMultipartFolderName("Game.7z.001"), "Game");
    assert.equal(getMultipartFolderName("Game.zip"), "Game");
    assert.equal(getMultipartFolderName("folder/Game.part1.rar"), "Game");
    assert.equal(getMultipartFolderName("_.part1.rar"), "download");
  });
});

describe("estimateMultipartTotalBytes", () => {
  it("uses the fallback until a part size is known", () => {
    assert.equal(estimateMultipartTotalBytes([undefined, undefined], 900), 900);
    assert.equal(estimateMultipartTotalBytes([undefined], null), 0);
  });

  it("estimates unknown parts from the largest known part", () => {
    assert.equal(
      estimateMultipartTotalBytes([500, undefined, undefined], 9000),
      1500
    );
  });

  it("returns the exact total once every part is known", () => {
    assert.equal(estimateMultipartTotalBytes([500, 500, 120], 9000), 1120);
  });
});
