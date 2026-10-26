import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { reconcileDiscsForRemovedFolder } from "./reconcile-discs.js";

const discs = [
  { path: "/roms/usa/Mario.sfc", label: "USA", fileName: "Mario.sfc" },
  { path: "/roms/europe/Mario.sfc", label: "Europe", fileName: "Mario.sfc" },
];

describe("RetroArch ROM removal", () => {
  it("requires a new choice when the active ROM is removed", () => {
    const result = reconcileDiscsForRemovedFolder(
      discs,
      discs[0].path,
      "/roms/usa",
      ["/roms/europe"]
    );
    assert.equal(result?.selectedDiscPath, null);
    assert.deepEqual(result?.discs, [discs[1]]);
  });

  it("keeps the active ROM when another ROM is removed", () => {
    const result = reconcileDiscsForRemovedFolder(
      discs,
      discs[0].path,
      "/roms/europe",
      ["/roms/usa"]
    );
    assert.equal(result?.selectedDiscPath, discs[0].path);
  });

  it("keeps a manually added executable when its ROM folder is removed", () => {
    const executable = {
      path: "/ports/Mario/mario.exe",
      label: "Executable",
      fileName: "mario.exe",
      isExecutable: true,
    };
    const result = reconcileDiscsForRemovedFolder(
      [discs[0], executable],
      executable.path,
      "/roms/usa",
      []
    );

    assert.equal(result?.isDeleted, false);
    assert.deepEqual(result?.discs, [executable]);
    assert.equal(result?.selectedDiscPath, executable.path);
  });
});
