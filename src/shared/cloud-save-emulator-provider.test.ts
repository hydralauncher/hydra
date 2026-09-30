import assert from "node:assert/strict";
import { it } from "node:test";

import {
  canSelectCloudSaveCustomFile,
  hasCloudSaveExecutableSelection,
  hasRpcs3CloudSaveDisc,
  isCloudSaveV2Eligible,
} from "./cloud-save-emulator-provider.js";

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

  assert.equal(hasRpcs3CloudSaveDisc(game), false);
  assert.equal(hasCloudSaveExecutableSelection(game), false);
  assert.equal(
    hasCloudSaveExecutableSelection({ ...game, discs: [{ path: " " }] }),
    false
  );

  const oneDisc = { ...game, discs: [{ path: "/games/Minecraft.iso" }] };
  assert.equal(hasRpcs3CloudSaveDisc(oneDisc), true);
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
