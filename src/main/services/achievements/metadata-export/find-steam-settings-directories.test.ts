import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";

import { findSteamSettingsDirectories } from "./find-steam-settings-directories.js";

let library: string;

const makeDirectory = (...segments: string[]) => {
  const directory = path.join(library, ...segments);
  fs.mkdirSync(directory, { recursive: true });
  return directory;
};

const makeFile = (...segments: string[]) => {
  const filePath = path.join(library, ...segments);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, "");
  return filePath;
};

describe("findSteamSettingsDirectories", () => {
  before(() => {
    library = fs.mkdtempSync(path.join(os.tmpdir(), "hydra-steam-settings-"));
  });

  after(() => {
    fs.rmSync(library, { recursive: true, force: true });
  });

  it("finds the steamworks folder of an unreal engine game from either executable", async () => {
    const game = "unreal-game";

    const steamSettings = makeDirectory(
      game,
      "Engine/Binaries/ThirdParty/Steamworks/Steamv153/Win64/steam_settings"
    );

    makeFile(game, "UnrealGame.exe");
    makeFile(
      game,
      "Engine/Binaries/ThirdParty/Steamworks/Steamv153/Win64/steam_api64.dll"
    );
    makeFile(game, "UnrealGame/Binaries/Win64/UnrealGame-Win64-Shipping.exe");
    makeDirectory(game, "UnrealGame/Content/Paks");

    const fromShippingExecutable = await findSteamSettingsDirectories(
      path.join(
        library,
        game,
        "UnrealGame/Binaries/Win64/UnrealGame-Win64-Shipping.exe"
      )
    );

    const fromRootExecutable = await findSteamSettingsDirectories(
      path.join(library, game, "UnrealGame.exe")
    );

    assert.deepEqual(fromShippingExecutable, [path.resolve(steamSettings)]);
    assert.deepEqual(fromRootExecutable, [path.resolve(steamSettings)]);
  });

  it("finds a steam_settings folder next to the executable", async () => {
    const game = "flat-game";

    const steamSettings = makeDirectory(game, "steam_settings");
    makeFile(game, "game.exe");
    makeFile(game, "steam_api64.dll");

    assert.deepEqual(
      await findSteamSettingsDirectories(path.join(library, game, "game.exe")),
      [path.resolve(steamSettings)]
    );
  });

  it("finds the unity plugins folder", async () => {
    const game = "unity-game";

    const steamSettings = makeDirectory(
      game,
      "UnityGame_Data/Plugins/x86_64/steam_settings"
    );
    makeFile(game, "UnityGame.exe");

    assert.deepEqual(
      await findSteamSettingsDirectories(
        path.join(library, game, "UnityGame.exe")
      ),
      [path.resolve(steamSettings)]
    );
  });

  it("walks out of nested executable folders to reach the game root", async () => {
    const game = "nested-game";

    const steamSettings = makeDirectory(game, "steam_settings");
    makeFile(game, "bin/x64/game.exe");

    assert.deepEqual(
      await findSteamSettingsDirectories(
        path.join(library, game, "bin/x64/game.exe")
      ),
      [path.resolve(steamSettings)]
    );
  });

  it("falls back to a breadth-first search for unknown layouts", async () => {
    const game = "unknown-layout-game";

    const steamSettings = makeDirectory(game, "redist/emu/steam_settings");
    makeFile(game, "game.exe");

    assert.deepEqual(
      await findSteamSettingsDirectories(path.join(library, game, "game.exe")),
      [path.resolve(steamSettings)]
    );
  });

  it("returns nothing when no emulator is installed", async () => {
    const game = "clean-game";

    makeFile(game, "game.exe");
    makeDirectory(game, "Content/Paks");
    makeDirectory(game, "assets/textures");

    assert.deepEqual(
      await findSteamSettingsDirectories(path.join(library, game, "game.exe")),
      []
    );
  });

  it("does not reach into a sibling game", async () => {
    makeDirectory("sibling-a", "steam_settings");
    makeFile("sibling-a", "game.exe");
    makeFile("sibling-b", "game.exe");

    assert.deepEqual(
      await findSteamSettingsDirectories(
        path.join(library, "sibling-b", "game.exe")
      ),
      []
    );
  });
});
