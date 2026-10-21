import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";

import { Cracker } from "../../../../shared/constants.ts";
import {
  ALAN_WAKE_2_NAMESPACE,
  findEpicAchievementFilesInRoots,
} from "./find-epic-achievement-files.ts";

const ALAN_WAKE_2_OBJECT_ID = `${ALAN_WAKE_2_NAMESPACE}:d59bd88b62394cdfa8e6911ec385f3dc`;
const OTHER_OBJECT_ID =
  "0123456789abcdef0123456789abcdef:fedcba9876543210fedcba9876543210";

const roots: string[] = [];

const createRoot = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "hydra-epic-files-"));
  roots.push(root);
  return root;
};

const writeFile = (filePath: string, content: string, mtimeSeconds = 1) => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
  fs.utimesSync(filePath, mtimeSeconds, mtimeSeconds);
  return filePath;
};

const writeNemirtingas = (
  roaming: string,
  profile: string,
  namespace: string,
  mtimeSeconds = 1
) =>
  writeFile(
    path.join(
      roaming,
      "NemirtingasEpicEmu",
      profile,
      namespace,
      "achievements.json"
    ),
    "[]",
    mtimeSeconds
  );

const writeAlanWake2 = (
  appData: string,
  profile: string,
  { displayName = "achievements", mtimeSeconds = 1 } = {}
) => {
  const container = path.join(
    appData,
    "Remedy",
    "AlanWake2",
    profile,
    "achievements"
  );
  writeFile(path.join(container, "--containerDisplayName.chunk"), displayName);
  return writeFile(path.join(container, "data.chunk"), "chunk", mtimeSeconds);
};

afterEach(() => {
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("findEpicAchievementFilesInRoots", () => {
  it("finds the Nemirtingas file for the game namespace", async () => {
    const roaming = createRoot();
    const filePath = writeNemirtingas(
      roaming,
      "17380c2a51230d05a341a2319657af57",
      ALAN_WAKE_2_NAMESPACE
    );
    writeNemirtingas(roaming, "other", "ffffffffffffffffffffffffffffffff");

    assert.deepEqual(
      await findEpicAchievementFilesInRoots(ALAN_WAKE_2_OBJECT_ID, {
        nemirtingas: [roaming],
        alanWake2: [],
      }),
      [{ type: Cracker.nemirtingas, filePath }]
    );
  });

  it("uses the most recently written profile of each source", async () => {
    const roaming = createRoot();
    const local = createRoot();
    writeNemirtingas(roaming, "old", ALAN_WAKE_2_NAMESPACE, 10);
    const nemirtingas = writeNemirtingas(
      roaming,
      "new",
      ALAN_WAKE_2_NAMESPACE,
      20
    );
    writeAlanWake2(local, "Default-Epic-User", { mtimeSeconds: 30 });
    const alanWake2 = writeAlanWake2(local, "1638", { mtimeSeconds: 40 });

    assert.deepEqual(
      await findEpicAchievementFilesInRoots(ALAN_WAKE_2_OBJECT_ID, {
        nemirtingas: [roaming],
        alanWake2: [local],
      }),
      [
        { type: Cracker.nemirtingas, filePath: nemirtingas },
        { type: Cracker.alanWake2, filePath: alanWake2 },
      ]
    );
  });

  it("searches every Alan Wake 2 root", async () => {
    const local = createRoot();
    const roaming = createRoot();
    writeAlanWake2(local, "a", { mtimeSeconds: 10 });
    const filePath = writeAlanWake2(roaming, "b", { mtimeSeconds: 20 });

    assert.deepEqual(
      await findEpicAchievementFilesInRoots(ALAN_WAKE_2_OBJECT_ID, {
        nemirtingas: [],
        alanWake2: [local, roaming],
      }),
      [{ type: Cracker.alanWake2, filePath }]
    );
  });

  it("requires the achievements container marker", async () => {
    const local = createRoot();
    writeAlanWake2(local, "a", { displayName: "Quick Save 1" });
    fs.mkdirSync(path.join(local, "Remedy", "AlanWake2", "b", "achievements"), {
      recursive: true,
    });
    writeFile(
      path.join(
        local,
        "Remedy",
        "AlanWake2",
        "b",
        "achievements",
        "data.chunk"
      ),
      "chunk"
    );

    assert.deepEqual(
      await findEpicAchievementFilesInRoots(ALAN_WAKE_2_OBJECT_ID, {
        nemirtingas: [],
        alanWake2: [local],
      }),
      []
    );
  });

  it("only reads the Alan Wake 2 save for Alan Wake 2", async () => {
    const local = createRoot();
    writeAlanWake2(local, "a");

    assert.deepEqual(
      await findEpicAchievementFilesInRoots(OTHER_OBJECT_ID, {
        nemirtingas: [],
        alanWake2: [local],
      }),
      []
    );
  });

  it("ignores object ids that are not Epic catalogue ids", async () => {
    const roaming = createRoot();
    writeNemirtingas(roaming, "a", "not-a-namespace");

    assert.deepEqual(
      await findEpicAchievementFilesInRoots("not-a-namespace", {
        nemirtingas: [roaming],
        alanWake2: [],
      }),
      []
    );
  });

  it("ignores missing roots and folders in place of files", async () => {
    const roaming = createRoot();
    fs.mkdirSync(
      path.join(
        roaming,
        "NemirtingasEpicEmu",
        "a",
        ALAN_WAKE_2_NAMESPACE,
        "achievements.json"
      ),
      { recursive: true }
    );

    assert.deepEqual(
      await findEpicAchievementFilesInRoots(ALAN_WAKE_2_OBJECT_ID, {
        nemirtingas: [roaming, path.join(roaming, "missing")],
        alanWake2: [path.join(roaming, "missing")],
      }),
      []
    );
  });
});
