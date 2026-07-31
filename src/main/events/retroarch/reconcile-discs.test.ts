import assert from "node:assert/strict";
import path from "node:path";
import { describe, it } from "node:test";

import { reconcileDiscsForRemovedFolder } from "./reconcile-discs.js";

const KEPT = path.join(path.sep, "roms", "kept");
const REMOVED = path.join(path.sep, "roms", "removed");

const disc = (folder: string, fileName: string) => ({
  path: path.join(folder, fileName),
  label: fileName,
  fileName,
});

describe("reconcileDiscsForRemovedFolder", () => {
  it("ignores titles with no disc under the removed folder", () => {
    const discs = [disc(KEPT, "Disc 1.n64")];

    assert.equal(
      reconcileDiscsForRemovedFolder(discs, null, REMOVED, [KEPT]),
      null
    );
  });

  it("ignores titles whose discs all remain covered", () => {
    // Overlapping folders: the removed path is a parent of one that stays.
    const nested = path.join(REMOVED, "nested");
    const discs = [disc(nested, "Disc 1.n64")];

    assert.equal(
      reconcileDiscsForRemovedFolder(discs, null, REMOVED, [nested]),
      null
    );
  });

  it("deletes the title when no disc survives", () => {
    const discs = [disc(REMOVED, "Disc 1.n64"), disc(REMOVED, "Disc 2.n64")];

    const result = reconcileDiscsForRemovedFolder(discs, null, REMOVED, [KEPT]);

    assert.ok(result);
    assert.equal(result.isDeleted, true);
  });

  it("deletes the title when the last remaining folder goes away", () => {
    const discs = [disc(REMOVED, "Disc 1.n64")];

    const result = reconcileDiscsForRemovedFolder(discs, null, REMOVED, []);

    assert.ok(result);
    assert.equal(result.isDeleted, true);
  });

  it("keeps a mixed-folder title and drops only the uncovered discs", () => {
    const gone = disc(REMOVED, "Disc 1.n64");
    const stays = disc(KEPT, "Disc 2.n64");

    const result = reconcileDiscsForRemovedFolder(
      [gone, stays],
      null,
      REMOVED,
      [KEPT]
    );

    assert.ok(result);
    assert.equal(result.isDeleted, false);
    assert.deepEqual(
      result.discs.map((d) => d.path),
      [stays.path]
    );
  });

  it("moves a selection that pointed at a dropped disc", () => {
    const gone = disc(REMOVED, "Disc 1.n64");
    const stays = disc(KEPT, "Disc 2.n64");

    const result = reconcileDiscsForRemovedFolder(
      [gone, stays],
      gone.path,
      REMOVED,
      [KEPT]
    );

    assert.ok(result);
    assert.equal(result.selectedDiscPath, stays.path);
  });

  it("leaves a selection that still resolves", () => {
    const gone = disc(REMOVED, "Disc 1.n64");
    const stays = disc(KEPT, "Disc 2.n64");

    const result = reconcileDiscsForRemovedFolder(
      [gone, stays],
      stays.path,
      REMOVED,
      [KEPT]
    );

    assert.ok(result);
    assert.equal(result.selectedDiscPath, stays.path);
  });

  it("returns null for a title with no discs", () => {
    assert.equal(
      reconcileDiscsForRemovedFolder([], null, REMOVED, [KEPT]),
      null
    );
  });
});
