import assert from "node:assert/strict";
import path from "node:path";
import { describe, it } from "node:test";

import {
  reconcileDiscsAfterScan,
  reconcileDiscsForRemovedFolder,
} from "./reconcile-discs.js";

const KEPT = path.join(path.sep, "roms", "kept");
const REMOVED = path.join(path.sep, "roms", "removed");
const UNSCANNED = path.join(path.sep, "roms", "elsewhere");

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

describe("reconcileDiscsAfterScan", () => {
  const allPresent = () => true;
  const allMissing = () => false;

  it("ignores titles with no disc in the scanned folders", () => {
    const discs = [disc(UNSCANNED, "Game.gba")];

    assert.equal(
      reconcileDiscsAfterScan(discs, null, [KEPT], allMissing),
      null
    );
  });

  it("ignores titles whose scanned discs are all still on disk", () => {
    const discs = [disc(KEPT, "Disc 1.n64"), disc(KEPT, "Disc 2.n64")];

    assert.equal(
      reconcileDiscsAfterScan(discs, null, [KEPT], allPresent),
      null
    );
  });

  it("deletes the title when every scanned disc is gone", () => {
    const discs = [disc(KEPT, "Disc 1.n64"), disc(KEPT, "Disc 2.n64")];

    const result = reconcileDiscsAfterScan(discs, null, [KEPT], allMissing);

    assert.ok(result);
    assert.equal(result.isDeleted, true);
  });

  it("drops only the missing disc when a sibling survives", () => {
    const gone = disc(KEPT, "Disc 1.n64");
    const stays = disc(KEPT, "Disc 2.n64");

    const result = reconcileDiscsAfterScan(
      [gone, stays],
      null,
      [KEPT],
      (discPath) => discPath === stays.path
    );

    assert.ok(result);
    assert.equal(result.isDeleted, false);
    assert.deepEqual(
      result.discs.map((d) => d.path),
      [stays.path]
    );
  });

  it("keeps discs outside the scanned folders untouched", () => {
    const scannedGone = disc(KEPT, "Disc 1.n64");
    const untouched = disc(UNSCANNED, "Disc 2.n64");

    const result = reconcileDiscsAfterScan(
      [scannedGone, untouched],
      null,
      [KEPT],
      allMissing
    );

    assert.ok(result);
    assert.equal(result.isDeleted, false);
    assert.deepEqual(
      result.discs.map((d) => d.path),
      [untouched.path]
    );
  });

  it("moves a selection that pointed at a missing disc", () => {
    const gone = disc(KEPT, "Disc 1.n64");
    const stays = disc(KEPT, "Disc 2.n64");

    const result = reconcileDiscsAfterScan(
      [gone, stays],
      gone.path,
      [KEPT],
      (discPath) => discPath === stays.path
    );

    assert.ok(result);
    assert.equal(result.selectedDiscPath, stays.path);
  });
});
