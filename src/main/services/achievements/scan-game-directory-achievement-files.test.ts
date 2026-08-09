import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";

import { scanGameDirectoryAchievementFiles } from "./scan-game-directory-achievement-files.js";

let library: string;

const makeFile = (relativePath: string, contents = "") => {
  const filePath = path.join(library, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, contents);
  return filePath;
};

const scan = async (executableRelativePath: string) =>
  (
    await scanGameDirectoryAchievementFiles(
      path.join(library, executableRelativePath)
    )
  ).map(({ type, filePath }) => ({
    type,
    filePath: path.relative(library, filePath).replaceAll("\\", "/"),
  }));

describe("scanGameDirectoryAchievementFiles", () => {
  before(() => {
    library = fs.mkdtempSync(path.join(os.tmpdir(), "hydra-game-dir-"));
  });

  after(() => {
    fs.rmSync(library, { recursive: true, force: true });
  });

  it("finds an ALI213 profile next to the executable", async () => {
    makeFile("ali213-game/Bin32/game.exe");
    makeFile("ali213-game/Bin32/steam_api.dll");
    makeFile("ali213-game/Bin32/Profile/Player/Stats/Achievements.Bin");

    assert.deepEqual(await scan("ali213-game/Bin32/game.exe"), [
      {
        type: "ALI213",
        filePath: "ali213-game/Bin32/Profile/Player/Stats/Achievements.Bin",
      },
    ]);
  });

  it("finds an ALI213 profile from a launcher at the game root", async () => {
    makeFile("stub-game/Launcher.exe");
    makeFile("stub-game/Bin32/steam_api.dll");
    makeFile("stub-game/Bin32/Profile/Player/Stats/Achievements.Bin");

    assert.deepEqual(await scan("stub-game/Launcher.exe"), [
      {
        type: "ALI213",
        filePath: "stub-game/Bin32/Profile/Player/Stats/Achievements.Bin",
      },
    ]);
  });

  it("still finds the user_stats and 3DM locations", async () => {
    makeFile("legacy-game/game.exe");
    makeFile("legacy-game/SteamData/user_stats.ini");
    makeFile("legacy-game/3DMGAME/Player/stats/achievements.ini");

    const found = await scan("legacy-game/game.exe");

    assert.deepEqual(found.map(({ type }) => type).sort(), [
      "3dm",
      "user_stats",
    ]);
  });

  it("takes goldberg unlocks from numeric steam_settings subfolders only", async () => {
    makeFile("sekiro/game.exe");
    makeFile("sekiro/steam_api64.dll");
    makeFile("sekiro/steam_settings/achievements.json", "[]");
    makeFile("sekiro/steam_settings/814380/achievements.json", "{}");
    makeFile("sekiro/steam_settings/images/1.jpg");

    assert.deepEqual(await scan("sekiro/game.exe"), [
      {
        type: "Goldberg",
        filePath: "sekiro/steam_settings/814380/achievements.json",
      },
    ]);
  });

  it("never returns the steam_settings metadata file", async () => {
    makeFile("metadata-only/game.exe");
    makeFile("metadata-only/steam_settings/achievements.json", "[]");

    assert.deepEqual(await scan("metadata-only/game.exe"), []);
  });

  it("returns nothing for a game with no emulator data", async () => {
    makeFile("clean-game/game.exe");
    makeFile("clean-game/Content/data.pak");

    assert.deepEqual(await scan("clean-game/game.exe"), []);
  });

  it("returns nothing without an executable path", async () => {
    assert.deepEqual(await scanGameDirectoryAchievementFiles(""), []);
  });
});
