import assert from "node:assert/strict";
import { it } from "node:test";

// @ts-ignore The Node ESM test runner requires the source extension.
import { inferCustomPathKind } from "./custom-path-kind.ts";

it("infers a selected save file without treating a shared folder as a file", () => {
  const rawPath = "<custom><mac><home>/RetroArch/Super Mario World.srm";
  const game = { shop: "launchbox" as const, platform: "Super Nintendo" };
  assert.equal(
    inferCustomPathKind(
      rawPath,
      [{ relativePath: "Super Mario World.srm" }],
      game
    ),
    "file"
  );
  assert.equal(
    inferCustomPathKind(
      rawPath,
      [
        { relativePath: "Super Mario World.srm" },
        { relativePath: "Another Game.srm" },
      ],
      game
    ),
    "dir"
  );
  assert.equal(
    inferCustomPathKind(
      "<custom><mac><home>/RetroArch/saves",
      [{ relativePath: "Super Mario World.srm" }],
      game
    ),
    "dir"
  );
});

it("keeps old Steam folders ending in .sav as folders", () => {
  const rawPath = "<custom><mac><home>/SteamGame/save.sav";
  const files = [{ relativePath: "save.sav" }];
  const steam = { shop: "steam" as const };

  assert.equal(inferCustomPathKind(rawPath, files, steam), "dir");
  assert.equal(
    inferCustomPathKind(rawPath, files, {
      ...steam,
      storedKind: "file",
    }),
    "file"
  );
  assert.equal(
    inferCustomPathKind(rawPath, files, {
      shop: "launchbox",
      platform: "Super Nintendo",
      storedKind: "dir",
    }),
    "dir"
  );
});

it("does not infer files from unsupported emulator save formats", () => {
  const rawPath = "<custom><mac><home>/Saves/Game.ps2";
  assert.equal(
    inferCustomPathKind(rawPath, [{ relativePath: "Game.ps2" }], {
      shop: "launchbox",
      platform: "Super Nintendo",
    }),
    "dir"
  );
});
