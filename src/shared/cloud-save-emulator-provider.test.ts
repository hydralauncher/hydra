import assert from "node:assert/strict";
import { it } from "node:test";

import {
  canSelectCloudSaveCustomFile,
  getCloudSaveEmulatorProvider,
  hasCloudSaveExecutableSelection,
  hasCloudSaveDisc,
  isCloudSaveV2Eligible,
} from "./cloud-save-emulator-provider.js";

it("offers V2 for Epic catalogue games without exposing emulator file selection", () => {
  assert.equal(isCloudSaveV2Eligible("epic"), true);
  assert.equal(isCloudSaveV2Eligible("steam"), true);
  assert.equal(isCloudSaveV2Eligible("custom"), false);
  assert.equal(canSelectCloudSaveCustomFile("epic"), false);
});

it("recognizes legacy custom save files only for LaunchBox emulator V2 games", () => {
  assert.equal(canSelectCloudSaveCustomFile("steam"), false);
  assert.equal(canSelectCloudSaveCustomFile("steam", "Super Nintendo"), false);
  assert.equal(
    canSelectCloudSaveCustomFile("launchbox", "Unsupported Platform"),
    false
  );
  assert.equal(
    canSelectCloudSaveCustomFile("launchbox", "Super Nintendo"),
    true
  );
  assert.equal(
    canSelectCloudSaveCustomFile("launchbox", "PlayStation 3"),
    true
  );
  for (const platform of [
    "Sony PlayStation",
    "Sony PlayStation 2",
    "Sony PlayStation Portable",
    "Nintendo GameCube",
    "Nintendo Wii",
  ]) {
    assert.equal(canSelectCloudSaveCustomFile("launchbox", platform), false);
    assert.equal(isCloudSaveV2Eligible("launchbox", platform), false);
  }
});

it("requires a new RetroArch ROM choice after the active ROM is removed", () => {
  const game = {
    shop: "launchbox" as const,
    platform: "Super Nintendo",
    discs: [{ path: "/roms/Mario Europe.sfc" }],
    selectedDiscPath: null,
  };
  assert.equal(hasCloudSaveExecutableSelection(game), false);
  assert.equal(
    hasCloudSaveExecutableSelection({
      ...game,
      selectedDiscPath: game.discs[0].path,
    }),
    true
  );
  assert.equal(
    hasCloudSaveExecutableSelection({
      ...game,
      selectedDiscPath: undefined,
    }),
    true
  );
  assert.equal(
    hasCloudSaveExecutableSelection({
      shop: "steam",
      executablePath: "/games/mario.exe",
    }),
    true
  );
});

it("requires a registered RPCS3 disc regardless of active disc selection", () => {
  const game = {
    shop: "launchbox" as const,
    platform: "PlayStation 3",
    discs: [] as Array<{ path: string }>,
    selectedDiscPath: null,
  };

  assert.equal(hasCloudSaveDisc(game), false);
  assert.equal(hasCloudSaveExecutableSelection(game), false);
  assert.equal(
    hasCloudSaveExecutableSelection({ ...game, discs: [{ path: " " }] }),
    false
  );

  const oneDisc = { ...game, discs: [{ path: "/games/Minecraft.iso" }] };
  assert.equal(hasCloudSaveDisc(oneDisc), true);
  assert.equal(hasCloudSaveExecutableSelection(oneDisc), true);
  assert.equal(
    hasCloudSaveExecutableSelection({
      ...game,
      discs: [{ path: "/games/Minecraft.iso" }, { path: "/games/Other.iso" }],
    }),
    true
  );

  assert.equal(
    hasCloudSaveExecutableSelection({
      ...game,
      platform: "Super Nintendo",
      selectedDiscPath: null,
      discs: [{ path: "/roms/Mario.sfc" }],
    }),
    false
  );
  assert.equal(
    hasCloudSaveExecutableSelection({
      shop: "steam",
      executablePath: "/games/minecraft.exe",
    }),
    true
  );
});

it("routes PS4 games to shadPS4 and requires a registered game folder", () => {
  assert.equal(
    getCloudSaveEmulatorProvider("launchbox", "Sony Playstation 4"),
    "shadps4"
  );
  assert.equal(getCloudSaveEmulatorProvider("launchbox", "PS4"), "shadps4");
  assert.equal(
    getCloudSaveEmulatorProvider("steam", "Sony Playstation 4"),
    null
  );
  assert.equal(isCloudSaveV2Eligible("launchbox", "Sony Playstation 4"), true);
  const ps4 = { shop: "launchbox" as const, platform: "Sony Playstation 4" };
  assert.equal(hasCloudSaveExecutableSelection({ ...ps4, discs: [] }), false);
  assert.equal(
    hasCloudSaveExecutableSelection({
      ...ps4,
      discs: [{ path: "D:/PS4/CUSA00207" }],
    }),
    true
  );
});

it("does not count a port disc as an emulator disc", () => {
  const portOnly = {
    shop: "launchbox" as const,
    platform: "Sony Playstation 4",
    discs: [{ path: "C:/recompilations/bbport", recompilationSlug: "bbport" }],
  };
  assert.equal(hasCloudSaveDisc(portOnly), false);
  assert.equal(hasCloudSaveExecutableSelection(portOnly), false);

  const withGame = {
    ...portOnly,
    discs: [...portOnly.discs, { path: "C:/games/CUSA03173" }],
  };
  assert.equal(hasCloudSaveDisc(withGame), true);
  assert.equal(hasCloudSaveExecutableSelection(withGame), true);
});
