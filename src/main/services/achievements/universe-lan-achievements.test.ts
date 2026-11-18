import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it, type TestContext } from "node:test";

import { Cracker } from "../../../shared/constants.ts";
import { iniParse, processUniverseLan } from "./parse-achievement-formats.ts";
import {
  findAchievementFilesInLocations,
  resolveGameDirectoryLocations,
} from "./scan-game-directory-achievement-files.ts";
import {
  findGogRootGameIds,
  resolveUniverseLanDataDirectories,
} from "./universe-lan-locations.ts";

const createTempDirectory = async (t: TestContext) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "hydra-ulan-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return directory;
};

const writeFile = async (filePath: string, content: string) => {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content);
};

const gogInfo = (gameId: string, rootGameId?: string) =>
  JSON.stringify({
    gameId,
    ...(rootGameId ? { rootGameId } : {}),
    name: "Fixture",
    playTasks: [],
  });

const ACHIEVEMENTS_INI = [
  "\uFEFF[ACH_FIRST_GAME]",
  "Description=",
  "Unlocked=true",
  "UnlockTime=1700000000",
  "Visible=true",
  "VisibleWhileLocked=false",
  "",
  "[ACH_LOCKED]",
  "Description=",
  "Unlocked=false",
  "UnlockTime=0",
  "",
  "[ach_numeric_true]",
  "Description = Spaced like the UniverseLAN sample file",
  "Unlocked = 1",
  "UnlockTime = 1700000500",
  "",
].join("\r\n");

describe("processUniverseLan", () => {
  it("returns only unlocked achievements with millisecond timestamps", async (t) => {
    const directory = await createTempDirectory(t);
    const filePath = path.join(directory, "Achievements.ini");
    await writeFile(filePath, ACHIEVEMENTS_INI);

    assert.deepEqual(processUniverseLan(iniParse(filePath)), [
      { name: "ACH_FIRST_GAME", unlockTime: 1_700_000_000_000 },
      { name: "ach_numeric_true", unlockTime: 1_700_000_500_000 },
    ]);
  });

  it("accepts every boolean spelling SimpleIni treats as true", () => {
    const unlocked = processUniverseLan({
      A: { Unlocked: "yes", UnlockTime: "10" },
      B: { Unlocked: "On", UnlockTime: "10" },
      C: { Unlocked: "TRUE", UnlockTime: "10" },
      D: { Unlocked: "no", UnlockTime: "10" },
      E: { Unlocked: "off", UnlockTime: "10" },
      F: { Unlocked: "0", UnlockTime: "10" },
      G: { UnlockTime: "10" },
    });

    assert.deepEqual(
      unlocked.map(({ name }) => name),
      ["A", "B", "C"]
    );
  });

  it("falls back to the current time when the unlock time is missing", () => {
    const before = Date.now();
    const [achievement] = processUniverseLan({
      ACH: { Unlocked: "true", UnlockTime: "0" },
    });

    assert.equal(achievement.name, "ACH");
    assert.ok(achievement.unlockTime >= before);
  });
});

describe("findGogRootGameIds", () => {
  it("prefers rootGameId, falls back to gameId and skips invalid files", async (t) => {
    const directory = await createTempDirectory(t);

    await writeFile(
      path.join(directory, "goggame-1222450693.info"),
      gogInfo("1222450693", "1645177204")
    );
    await writeFile(
      path.join(directory, "goggame-1645177204.info"),
      gogInfo("1645177204", "1645177204")
    );
    await writeFile(
      path.join(directory, "goggame-2000000000.info"),
      gogInfo("2000000000")
    );
    await writeFile(path.join(directory, "goggame-broken.info"), "{not json");
    await writeFile(path.join(directory, "other.info"), gogInfo("3"));

    assert.deepEqual(await findGogRootGameIds([directory]), [
      "1645177204",
      "2000000000",
    ]);
  });

  it("ignores directories that do not exist", async () => {
    assert.deepEqual(
      await findGogRootGameIds([path.join(os.tmpdir(), "hydra-missing-dir")]),
      []
    );
  });
});

describe("UniverseLAN achievement file discovery", () => {
  it("finds the per-game LocalAppData file and the legacy game folder file", async (t) => {
    const root = await createTempDirectory(t);
    const gameDirectory = path.join(root, "Games", "Arcade Fixture");
    const localAppData = path.join(root, "LocalAppData");
    const executablePath = path.join(gameDirectory, "Game.exe");

    await writeFile(executablePath, "");
    await writeFile(
      path.join(gameDirectory, "goggame-1222450693.info"),
      gogInfo("1222450693", "1645177204")
    );

    const globalFile = path.join(
      localAppData,
      "UniverseLAN",
      "1645177204",
      "UniverseLANData",
      "Achievements.ini"
    );
    const legacyFile = path.join(
      gameDirectory,
      "UniverseLANData",
      "Achievements.ini"
    );

    await writeFile(globalFile, ACHIEVEMENTS_INI);
    await writeFile(legacyFile, ACHIEVEMENTS_INI);

    const locations = await resolveGameDirectoryLocations(executablePath);
    const universeLanDataDirectories = await resolveUniverseLanDataDirectories(
      locations.bases,
      localAppData
    );

    assert.deepEqual(universeLanDataDirectories, [path.dirname(globalFile)]);

    const files = await findAchievementFilesInLocations({
      ...locations,
      universeLanDataDirectories,
    });

    const universeLanFiles = files
      .filter((file) => file.type === Cracker.universeLan)
      .map((file) => path.resolve(file.filePath))
      .sort();

    assert.deepEqual(
      universeLanFiles,
      [path.resolve(globalFile), path.resolve(legacyFile)].sort()
    );
  });

  it("finds GOG info files stored next to a Unity plugin folder", async (t) => {
    const root = await createTempDirectory(t);
    const gameDirectory = path.join(root, "Games", "Unity Fixture");
    const pluginDirectory = path.join(
      gameDirectory,
      "Fixture_Data",
      "Plugins",
      "x86_64"
    );

    await writeFile(path.join(gameDirectory, "Fixture.exe"), "");
    await writeFile(path.join(pluginDirectory, "Galaxy64.dll"), "");
    await writeFile(
      path.join(gameDirectory, "goggame-42.info"),
      gogInfo("42", "41")
    );

    const locations = await resolveGameDirectoryLocations(
      path.join(gameDirectory, "Fixture.exe")
    );

    assert.ok(
      locations.bases.some(
        (base) => path.resolve(base) === path.resolve(pluginDirectory)
      )
    );
    assert.deepEqual(
      await resolveUniverseLanDataDirectories(locations.bases, root),
      [path.join(root, "UniverseLAN", "41", "UniverseLANData")]
    );
  });

  it("returns nothing when there is no LocalAppData path", async () => {
    assert.deepEqual(await resolveUniverseLanDataDirectories(["C:/x"], ""), []);
  });
});
