import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildCoverThumbnailUrl,
  parseCoverThumbnailUrl,
  pickCoverThumbnailWidth,
} from "./cover-thumbnail-url.js";

describe("cover thumbnail urls", () => {
  it("round-trips remote and local sources", () => {
    for (const source of [
      "https://cdn2.steamgriddb.com/grid/a b.png?x=1&y=2",
      "local:C:/Users/me/AppData/Roaming/hydra/Assets/cover #1.jpg",
    ]) {
      const parsed = parseCoverThumbnailUrl(
        buildCoverThumbnailUrl(source, 300)
      );
      assert.deepEqual(parsed, { source, width: 360 });
    }
  });

  it("leaves data and blob sources untouched", () => {
    assert.equal(
      buildCoverThumbnailUrl("data:image/png;base64,AAAA", 300),
      "data:image/png;base64,AAAA"
    );
    assert.equal(buildCoverThumbnailUrl("blob:abc", 300), "blob:abc");
  });

  it("snaps widths to a fixed set of buckets", () => {
    assert.equal(pickCoverThumbnailWidth(1), 240);
    assert.equal(pickCoverThumbnailWidth(480), 480);
    assert.equal(pickCoverThumbnailWidth(481), 720);
    assert.equal(pickCoverThumbnailWidth(99999), 1600);
  });

  it("rejects unknown widths, schemes and sources", () => {
    assert.equal(
      parseCoverThumbnailUrl("cover-thumb:?w=123&src=https%3A%2F%2Fa.b%2Fc"),
      null
    );
    assert.equal(
      parseCoverThumbnailUrl("cover-thumb:?w=240&src=file%3A%2F%2F%2Fetc"),
      null
    );
    assert.equal(
      parseCoverThumbnailUrl("local:?w=240&src=https%3A%2F%2Fa.b%2Fc"),
      null
    );
  });
});
