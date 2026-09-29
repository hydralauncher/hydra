import assert from "node:assert/strict";
import { test } from "node:test";
import {
  copyFile,
  mkdtemp,
  mkdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  findEpicAchievementFilesInRoots,
  getNemirtingasSaveRoot,
  inspectEpicAchievementFilesInRoots,
  parseEpicAchievementFile,
} from "./achievement-state.ts";

const alanWake2ObjectId =
  "c4763f236d08423eb47b4c3008779c84:d59bd88b62394cdfa8e6911ec385f3dc";
const namespace = "c4763f236d08423eb47b4c3008779c84";
const alanWake2Sample = fileURLToPath(
  new URL("./fixtures/alan-wake-2-data.chunk", import.meta.url)
);
const nemirtingasSample = fileURLToPath(
  new URL("./fixtures/nemirtingas-achievements.json", import.meta.url)
);

test("parses the supplied Nemirtingas state with exact IDs and Unix seconds", () => {
  assert.deepEqual(parseEpicAchievementFile("nemirtingas", nemirtingasSample), [
    { externalId: "38", unlockTime: 1789103553000 },
    { externalId: "32", unlockTime: 1789103566000 },
  ]);
});

test("parses Alan Wake 2 progress without granting partial achievements", () => {
  const before = Date.now();
  const unlocks = parseEpicAchievementFile("alan-wake-2", alanWake2Sample);
  const after = Date.now();
  assert.deepEqual(
    unlocks?.map((unlock) => unlock.externalId),
    ["3", "32"]
  );
  assert(
    unlocks?.every(
      (unlock) => unlock.unlockTime >= before && unlock.unlockTime <= after
    )
  );
});

test("rejects partial binary and malformed JSON snapshots atomically", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "hydra-epic-state-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const binaryPath = path.join(directory, "data.chunk");
  const sample = readFileSync(alanWake2Sample);
  await writeFile(binaryPath, sample.subarray(0, -1));
  assert.equal(parseEpicAchievementFile("alan-wake-2", binaryPath), null);
  const invalidRecord = Buffer.from(sample);
  invalidRecord.writeUInt32LE(1, 8);
  await writeFile(binaryPath, invalidRecord);
  assert.equal(parseEpicAchievementFile("alan-wake-2", binaryPath), null);

  const jsonPath = path.join(directory, "achievements.json");
  await writeFile(jsonPath, '[{"AchievementId":');
  assert.equal(parseEpicAchievementFile("nemirtingas", jsonPath), null);
  await writeFile(
    jsonPath,
    JSON.stringify([
      { AchievementId: "valid", UnlockTime: 1789103553 },
      { AchievementId: "invalid", UnlockTime: "1789103553" },
    ])
  );
  assert.equal(parseEpicAchievementFile("nemirtingas", jsonPath), null);
});

test("discovers default roots and refuses ambiguous local profiles", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "hydra-epic-files-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const roaming = path.join(root, "Roaming");
  const local = path.join(root, "Local");
  const nemirtingas = path.join(
    roaming,
    "NemirtingasEpicEmu",
    "alice",
    namespace,
    "achievements.json"
  );
  const alanWake2 = path.join(
    local,
    "Remedy",
    "AlanWake2",
    "alice",
    "achievements",
    "data.chunk"
  );
  await mkdir(path.dirname(nemirtingas), { recursive: true });
  await mkdir(path.dirname(alanWake2), { recursive: true });
  await copyFile(nemirtingasSample, nemirtingas);
  await copyFile(alanWake2Sample, alanWake2);

  assert.deepEqual(
    await findEpicAchievementFilesInRoots(alanWake2ObjectId, {
      roaming: [roaming],
      local: [local],
    }),
    [{ filePath: nemirtingas, source: "nemirtingas" }]
  );

  await writeFile(
    path.join(path.dirname(alanWake2), "--containerDisplayName.chunk"),
    "achievements"
  );
  assert.deepEqual(
    await findEpicAchievementFilesInRoots(alanWake2ObjectId, {
      roaming: [roaming],
      local: [local],
    }),
    [
      { filePath: nemirtingas, source: "nemirtingas" },
      { filePath: alanWake2, source: "alan-wake-2" },
    ]
  );

  const roamingAlias = path.join(root, "roaming-alias");
  await symlink(roaming, roamingAlias, "dir");
  assert.deepEqual(
    await findEpicAchievementFilesInRoots(alanWake2ObjectId, {
      roaming: [roaming, roamingAlias],
      local: [local, local],
    }),
    [
      { filePath: nemirtingas, source: "nemirtingas" },
      { filePath: alanWake2, source: "alan-wake-2" },
    ]
  );

  const secondProfile = path.join(
    roaming,
    "NemirtingasEpicEmu",
    "bob",
    namespace,
    "achievements.json"
  );
  await mkdir(path.dirname(secondProfile), { recursive: true });
  await copyFile(nemirtingasSample, secondProfile);
  assert.deepEqual(
    await findEpicAchievementFilesInRoots(alanWake2ObjectId, {
      roaming: [roaming],
      local: [local],
    }),
    [{ filePath: alanWake2, source: "alan-wake-2" }]
  );

  await rm(nemirtingas);
  const warnings: string[] = [];
  assert.deepEqual(
    await inspectEpicAchievementFilesInRoots(
      alanWake2ObjectId,
      { roaming: [roaming], local: [local] },
      (warning) => warnings.push(warning)
    ),
    { files: [], ambiguous: true }
  );
  assert(
    warnings.some((warning) => warning.includes("different player profiles"))
  );
});

test("uses a bounded Nemirtingas savepath beside the game executable", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "hydra-epic-config-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const executablePath = path.join(root, "Game.exe");
  const configPath = path.join(root, "NemirtingasEpicEmu.json");

  assert.equal(await getNemirtingasSaveRoot(executablePath), undefined);
  await writeFile(configPath, JSON.stringify({ savepath: "saves\\profile" }));
  assert.equal(
    await getNemirtingasSaveRoot(executablePath),
    path.join(root, "saves", "profile")
  );
  const customState = path.join(
    root,
    "saves",
    "profile",
    "NemirtingasEpicEmu",
    "alice",
    namespace,
    "achievements.json"
  );
  await mkdir(path.dirname(customState), { recursive: true });
  await copyFile(nemirtingasSample, customState);
  assert.deepEqual(
    await findEpicAchievementFilesInRoots(alanWake2ObjectId, {
      roaming: [path.join(root, "saves", "profile")],
      local: [],
    }),
    [{ filePath: customState, source: "nemirtingas" }]
  );
  await writeFile(configPath, JSON.stringify({ savepath: "../other" }));
  assert.equal(await getNemirtingasSaveRoot(executablePath), null);
  await writeFile(configPath, JSON.stringify({ savepath: "C:\\other" }));
  assert.equal(await getNemirtingasSaveRoot(executablePath), null);
  const outside = await mkdtemp(path.join(os.tmpdir(), "hydra-epic-outside-"));
  t.after(() => rm(outside, { recursive: true, force: true }));
  await symlink(outside, path.join(root, "escape"), "dir");
  await writeFile(configPath, JSON.stringify({ savepath: "escape" }));
  assert.equal(await getNemirtingasSaveRoot(executablePath), null);
  await writeFile(configPath, "{partial");
  assert.equal(await getNemirtingasSaveRoot(executablePath), null);
});
