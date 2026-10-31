import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { getContentDispositionFilename } from "./download-filename.ts";

describe("getContentDispositionFilename", () => {
  it("reads quoted and plain filenames", () => {
    assert.equal(
      getContentDispositionFilename('attachment; filename="Game.part1.rar"'),
      "Game.part1.rar"
    );
    assert.equal(
      getContentDispositionFilename("attachment; filename=Game.part2.rar"),
      "Game.part2.rar"
    );
  });

  it("prefers the encoded filename", () => {
    assert.equal(
      getContentDispositionFilename(
        "attachment; filename=\"fallback.rar\"; filename*=UTF-8''Caf%C3%A9.part1.rar"
      ),
      "Café.part1.rar"
    );
  });

  it("keeps only the base name and replaces unsafe characters", () => {
    assert.equal(
      getContentDispositionFilename('attachment; filename="../dir/a:b.rar"'),
      "a_b.rar"
    );
  });

  it("returns undefined without a filename", () => {
    assert.equal(getContentDispositionFilename(null), undefined);
    assert.equal(getContentDispositionFilename("attachment"), undefined);
    assert.equal(getContentDispositionFilename('filename=""'), undefined);
  });
});
