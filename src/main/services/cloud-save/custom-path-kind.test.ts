import assert from "node:assert/strict";
import { it } from "node:test";

// @ts-ignore The Node ESM test runner requires the source extension.
import { inferCustomPathKind } from "./custom-path-kind.ts";

it("infers a selected save file without treating a shared folder as a file", () => {
  const rawPath = "<custom><mac><home>/RetroArch/Super Mario World.srm";
  assert.equal(
    inferCustomPathKind(rawPath, [{ relativePath: "Super Mario World.srm" }]),
    "file"
  );
  assert.equal(
    inferCustomPathKind(rawPath, [
      { relativePath: "Super Mario World.srm" },
      { relativePath: "Another Game.srm" },
    ]),
    "dir"
  );
  assert.equal(
    inferCustomPathKind("<custom><mac><home>/RetroArch/saves", [
      { relativePath: "Super Mario World.srm" },
    ]),
    "dir"
  );
});
