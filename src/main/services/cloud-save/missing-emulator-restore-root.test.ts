import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import type {
  Game,
  LocalGameSnapshotContext,
  ResolvedRestoreTarget,
  SnapshotFile,
  UserLocationCoverage,
} from "@types";

// @ts-ignore The Node ESM test runner requires the source extension.
import { cloudSaveFileKey } from "./cloud-save-contract.ts";
// @ts-ignore The Node ESM test runner requires the source extension.
import { mergeUserVariantSnapshots } from "./merge-user-variant-snapshots.ts";
// @ts-ignore The Node ESM test runner requires the source extension.
import {
  assertFilesystemEmulatorRestoreRoots,
  isSafeConfiguredRetroArchRestoreRoot,
  safeMissingEmulatorRestoreEntryIds,
} from "./missing-emulator-restore-root.ts";

const variantId = "a".repeat(64);
const rawPath = "<emulator>/retroarch/snes/1234ABCD";
const file = (relativePath: string): SnapshotFile => ({
  variantId,
  rawPath,
  relativePath,
  hash: "b".repeat(64),
  sizeBytes: 4,
  lastModifiedAt: "2026-09-28T00:00:00.000Z",
});

const emptyLocal = (homeDir: string): LocalGameSnapshotContext => ({
  gameId: { shop: "launchbox", objectId: "game" },
  ruleSourceRevision: "test",
  discoveryEngineVersion: 2,
  coverage: [],
  variants: [{ variantId, kind: "default" }],
  fileCount: 0,
  totalSizeBytes: 0,
  files: [],
  aggregateHash: "c".repeat(64),
  sourceFiles: [],
  environmentId: "host-b",
  customPathRawPaths: [],
  pathContext: {
    shop: "launchbox",
    objectId: "game",
    platform: "mac",
    homeDir,
    storeUserContext: { known: [] },
  },
});

const retroArchGame = {
  shop: "launchbox",
  platform: "Super Nintendo Entertainment System",
} as Game;

const splitRetroArchFixture = async () => {
  const temp = await fs.mkdtemp(
    path.join(os.tmpdir(), "hydra-retroarch-root-")
  );
  const home = path.join(temp, "home");
  const configPath = path.join(
    home,
    "Library",
    "Application Support",
    "RetroArch",
    "config",
    "retroarch.cfg"
  );
  const documents = path.join(home, "Documents", "RetroArch");
  await fs.mkdir(path.dirname(configPath), { recursive: true });
  await fs.mkdir(documents, { recursive: true });
  const saveRoot = path.join(documents, "saves", "Snes9x");
  const stateRoot = path.join(documents, "states", "Snes9x");
  const writeConfig = async (saveDirectory = saveRoot) =>
    fs.writeFile(
      configPath,
      `savefile_directory = "${path.dirname(saveDirectory)}"\nsavestate_directory = "${path.dirname(stateRoot)}"\nsort_savefiles_enable = "true"\nsort_savestates_enable = "true"\n`
    );
  await writeConfig();
  const local = emptyLocal(home);
  const save: ResolvedRestoreTarget = {
    ...file("battery.srm"),
    action: "create",
    restoreRootPath: saveRoot,
    targetPath: path.join(saveRoot, "Super Mario World.srm"),
  };
  const state: ResolvedRestoreTarget = {
    ...file("state.state1"),
    action: "create",
    restoreRootPath: stateRoot,
    targetPath: path.join(stateRoot, "Super Mario World.state1"),
  };
  const state2: ResolvedRestoreTarget = {
    ...file("state.state2"),
    action: "create",
    restoreRootPath: stateRoot,
    targetPath: path.join(stateRoot, "Super Mario World.state2"),
  };
  const resolve = async (target: ResolvedRestoreTarget) => {
    if (target.rawPath !== rawPath) return null;
    const config = await fs.readFile(configPath, "utf8");
    const key = target.relativePath.startsWith("state.")
      ? "savestate_directory"
      : "savefile_directory";
    const configuredDirectory = new RegExp(`${key} = "([^"]+)"`).exec(
      config
    )?.[1];
    return configuredDirectory
      ? {
          directory: path.join(configuredDirectory, "Snes9x"),
          configPath,
          targetPath: path.join(
            configuredDirectory,
            "Snes9x",
            `Super Mario World${target.relativePath.slice(target.relativePath.indexOf("."))}`
          ),
        }
      : null;
  };
  return {
    temp,
    home,
    configPath,
    documents,
    saveRoot,
    stateRoot,
    local,
    save,
    state,
    state2,
    resolve,
    writeConfig,
  };
};

const fixture = async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "hydra-restore-root-"));
  const home = path.join(temp, "home");
  const profile = path.join(
    home,
    "Library",
    "Application Support",
    "RetroArch"
  );
  const saves = path.join(profile, "saves", "Snes9x");
  const states = path.join(profile, "states", "Snes9x");
  await fs.mkdir(saves, { recursive: true });
  await fs.writeFile(path.join(saves, "Super Mario World.srm"), "save");
  await fs.writeFile(path.join(saves, "Super Mario World.rtc"), "clock");
  const savesOnDisk = ["battery.srm", "battery.rtc"];
  const localFiles = savesOnDisk.map(file);
  const local = {
    gameId: { shop: "launchbox", objectId: "game" },
    files: localFiles,
    variants: [{ variantId, kind: "default" }],
    sourceFiles: savesOnDisk.map((_, index) => ({
      ...localFiles[index],
      ruleId: "retroarch",
      absolutePath: path.join(
        saves,
        `Super Mario World.${index === 0 ? "srm" : "rtc"}`
      ),
      localBindings: {
        environmentId: "host-b",
        rootId: "saves",
        concreteUserSegment: "__default__",
        concretePath: saves,
      },
      confidence: "exact",
      provenance: ["emulator:retroarch"],
    })),
    pathContext: { homeDir: home },
  } as LocalGameSnapshotContext;
  const remote = file("state.state1");
  const target: ResolvedRestoreTarget = {
    ...remote,
    action: "create",
    targetPath: path.join(states, "Super Mario World.state1"),
    restoreRootPath: states,
  };
  return { temp, home, local, remote, target, states };
};

const partialCoverage: UserLocationCoverage = {
  candidateId: "states",
  ruleId: "retroarch",
  variantId,
  rawPath,
  relativePath: "state.state1",
  selectedRoot: true,
  authority: "exact",
  outcome: "partial",
  enumeratedCompletely: false,
  warningCodes: ["retroarch-location-partial"],
};

describe("missing emulator restore roots", () => {
  it("approves missing Mac RetroArch save and state folders from the active config", async () => {
    const sample = await splitRetroArchFixture();
    try {
      const targets = [sample.save, sample.state, sample.state2];
      assert.equal(
        (await sample.resolve(sample.save))?.directory,
        sample.saveRoot
      );
      assert.equal(
        await isSafeConfiguredRetroArchRestoreRoot(
          sample.save,
          sample.local,
          (await sample.resolve(sample.save))!
        ),
        true
      );
      const safe = await safeMissingEmulatorRestoreEntryIds(
        targets,
        sample.local,
        retroArchGame,
        sample.resolve
      );
      assert.deepEqual([...safe], targets.map(cloudSaveFileKey));
      await assertFilesystemEmulatorRestoreRoots(
        targets,
        sample.local,
        safe,
        retroArchGame,
        sample.resolve
      );
      const merge = mergeUserVariantSnapshots({
        local: { ...sample.local, coverage: [partialCoverage] },
        remoteVariants: [{ variantId, kind: "default" }],
        remoteFiles: targets,
        base: null,
        safeMissingEmulatorRestoreEntryIds: safe,
      });
      assert.deepEqual(merge.restoreEntryIds, targets.map(cloudSaveFileKey));
      await fs.mkdir(sample.saveRoot, { recursive: true });
      await fs.mkdir(sample.stateRoot, { recursive: true });
      await assertFilesystemEmulatorRestoreRoots(
        targets,
        sample.local,
        safe,
        retroArchGame,
        sample.resolve
      );
    } finally {
      await fs.rm(sample.temp, { recursive: true, force: true });
    }
  });

  it("rejects a changed config or ROM identity before writing", async () => {
    const sample = await splitRetroArchFixture();
    try {
      const safe = await safeMissingEmulatorRestoreEntryIds(
        [sample.save],
        sample.local,
        retroArchGame,
        sample.resolve
      );
      await fs.mkdir(sample.saveRoot, { recursive: true });
      await sample.writeConfig(path.join(sample.documents, "other", "Snes9x"));
      await assert.rejects(
        assertFilesystemEmulatorRestoreRoots(
          [sample.save],
          sample.local,
          safe,
          retroArchGame,
          sample.resolve,
          async () => false
        ),
        /cloud_save_restore_root_unavailable/
      );
      await assertFilesystemEmulatorRestoreRoots(
        [sample.save],
        sample.local,
        safe,
        retroArchGame,
        sample.resolve,
        async () => true
      );
      assert.deepEqual(
        [
          ...(await safeMissingEmulatorRestoreEntryIds(
            [{ ...sample.save, rawPath: "<emulator>/retroarch/snes/DEADBEEF" }],
            sample.local,
            retroArchGame,
            sample.resolve
          )),
        ],
        []
      );
      await sample.writeConfig();
      assert.equal(
        await isSafeConfiguredRetroArchRestoreRoot(
          {
            ...sample.save,
            targetPath: path.join(sample.saveRoot, "Other Game.srm"),
          },
          sample.local,
          (await sample.resolve(sample.save))!
        ),
        false
      );
    } finally {
      await fs.rm(sample.temp, { recursive: true, force: true });
    }
  });

  it("keeps symlinked and external RetroArch destinations manual", async () => {
    const sample = await splitRetroArchFixture();
    try {
      const outside = path.join(sample.temp, "external", "saves", "Snes9x");
      assert.equal(
        await isSafeConfiguredRetroArchRestoreRoot(sample.save, sample.local, {
          directory: outside,
          configPath: sample.configPath,
          targetPath: path.join(outside, "Super Mario World.srm"),
        }),
        false
      );
      await fs.symlink(
        path.join(sample.temp, "external"),
        path.join(sample.documents, "saves")
      );
      assert.equal(
        await isSafeConfiguredRetroArchRestoreRoot(
          sample.save,
          sample.local,
          (await sample.resolve(sample.save))!
        ),
        false
      );
    } finally {
      await fs.rm(sample.temp, { recursive: true, force: true });
    }
  });

  it("restores a missing state folder beside scanned .srm and .rtc files", async () => {
    const sample = await fixture();
    try {
      const safe = await safeMissingEmulatorRestoreEntryIds(
        [sample.target],
        sample.local
      );
      assert.deepEqual([...safe], [cloudSaveFileKey(sample.remote)]);
      await assertFilesystemEmulatorRestoreRoots(
        [sample.target],
        sample.local,
        safe
      );
      const merge = mergeUserVariantSnapshots({
        local: {
          ...sample.local,
          coverage: [partialCoverage],
        },
        remoteVariants: [{ variantId, kind: "default" }],
        remoteFiles: [sample.remote, ...sample.local.files],
        base: null,
        safeMissingEmulatorRestoreEntryIds: safe,
      });
      assert.deepEqual(merge.restoreEntryIds, [
        cloudSaveFileKey(sample.remote),
      ]);
      assert.deepEqual(merge.deleteRemoteEntryIds, []);
    } finally {
      await fs.rm(sample.temp, { recursive: true, force: true });
    }
  });

  it("restores a clean host with a real RetroArch profile and no local saves", async () => {
    const sample = await fixture();
    try {
      const profile = path.dirname(path.dirname(sample.states));
      await fs.writeFile(path.join(profile, "retroarch.cfg"), "config");
      const local = {
        ...sample.local,
        files: [],
        sourceFiles: [],
        coverage: [partialCoverage],
      };
      const safe = await safeMissingEmulatorRestoreEntryIds(
        [sample.target],
        local
      );
      assert.deepEqual([...safe], [cloudSaveFileKey(sample.remote)]);
      const merge = mergeUserVariantSnapshots({
        local,
        remoteVariants: [{ variantId, kind: "default" }],
        remoteFiles: [sample.remote],
        base: null,
        safeMissingEmulatorRestoreEntryIds: safe,
      });
      assert.deepEqual(merge.restoreEntryIds, [
        cloudSaveFileKey(sample.remote),
      ]);
    } finally {
      await fs.rm(sample.temp, { recursive: true, force: true });
    }
  });

  it("accepts RetroArch's config subfolder layout", async () => {
    const sample = await fixture();
    try {
      const profile = path.dirname(path.dirname(sample.states));
      const config = path.join(profile, "config");
      await fs.mkdir(config, { recursive: true });
      await fs.writeFile(path.join(config, "retroarch.cfg"), "config");
      const target = {
        ...sample.target,
        restoreRootPath: path.join(config, "states", "Snes9x"),
        targetPath: path.join(
          config,
          "states",
          "Snes9x",
          "Super Mario World.state1"
        ),
      };
      const cleanHost = { ...sample.local, files: [], sourceFiles: [] };
      assert.deepEqual(
        [...(await safeMissingEmulatorRestoreEntryIds([target], cleanHost))],
        [cloudSaveFileKey(target)]
      );
    } finally {
      await fs.rm(sample.temp, { recursive: true, force: true });
    }
  });

  it("does not recreate a missing configured folder on another drive", async () => {
    const sample = await fixture();
    try {
      const external = path.join(
        sample.temp,
        "Volumes",
        "External",
        "RetroArch"
      );
      const externalSaves = path.join(external, "saves", "Snes9x");
      await fs.mkdir(externalSaves, { recursive: true });
      const externalFile = path.join(externalSaves, "Super Mario World.srm");
      await fs.writeFile(externalFile, "save");
      await fs.writeFile(path.join(external, "retroarch.cfg"), "config");
      sample.local.sourceFiles[0].absolutePath = externalFile;
      sample.local.sourceFiles[0].localBindings.concretePath = externalSaves;
      sample.local.sourceFiles.splice(1);
      const target = {
        ...sample.target,
        restoreRootPath: path.join(external, "states", "Snes9x"),
        targetPath: path.join(external, "states", "Snes9x", "state1"),
      };
      const safe = await safeMissingEmulatorRestoreEntryIds(
        [target],
        sample.local
      );
      assert.deepEqual([...safe], []);
      await assert.rejects(
        assertFilesystemEmulatorRestoreRoots([target], sample.local, safe),
        /cloud_save_restore_root_unavailable/
      );
    } finally {
      await fs.rm(sample.temp, { recursive: true, force: true });
    }
  });

  it("blocks a root that disappeared after local discovery", async () => {
    const sample = await fixture();
    try {
      await fs.mkdir(sample.states, { recursive: true });
      await fs.writeFile(sample.target.targetPath, "state");
      sample.local.files.push(sample.remote);
      await fs.rm(sample.states, { recursive: true });
      await assert.rejects(
        assertFilesystemEmulatorRestoreRoots(
          [sample.target],
          sample.local,
          new Set([cloudSaveFileKey(sample.remote)])
        ),
        /cloud_save_restore_root_unavailable/
      );
    } finally {
      await fs.rm(sample.temp, { recursive: true, force: true });
    }
  });
});

const defaultStateLayouts = [
  {
    emulator: "RPCS3",
    profile: [".config", "rpcs3"],
    config: ["GuiConfigs", "persistent_settings.dat"],
    stateRoot: ["savestates", "BLUS30443"],
    rawPath: "<emulator>/rpcs3-state/BLUS30443",
    relativePath: "BLUS30443_0_1.SAVESTAT",
  },
] as const;

describe("first sync to a new emulator profile", () => {
  for (const layout of defaultStateLayouts) {
    it(`creates only ${layout.emulator}'s configured default state root`, async () => {
      const temp = await fs.mkdtemp(
        path.join(os.tmpdir(), "hydra-default-state-")
      );
      try {
        const home = path.join(temp, "home");
        const profile = path.join(home, ...layout.profile);
        const config = path.join(profile, ...layout.config);
        const stateRoot = path.join(profile, ...layout.stateRoot);
        await fs.mkdir(path.dirname(config), { recursive: true });
        await fs.writeFile(config, "config");
        const remote = {
          ...file(layout.relativePath),
          rawPath: layout.rawPath,
        };
        const target: ResolvedRestoreTarget = {
          ...remote,
          action: "create",
          restoreRootPath: stateRoot,
          targetPath: path.join(stateRoot, layout.relativePath),
        };
        const local = emptyLocal(home);
        local.coverage = [
          {
            ...partialCoverage,
            rawPath: layout.rawPath,
            relativePath: layout.relativePath,
          },
        ];
        const safe = await safeMissingEmulatorRestoreEntryIds([target], local);
        assert.deepEqual([...safe], [cloudSaveFileKey(remote)]);
        const merge = mergeUserVariantSnapshots({
          local,
          remoteVariants: [{ variantId, kind: "default" }],
          remoteFiles: [remote],
          base: null,
          safeMissingEmulatorRestoreEntryIds: safe,
        });
        assert.deepEqual(merge.restoreEntryIds, [cloudSaveFileKey(remote)]);
        await assertFilesystemEmulatorRestoreRoots([target], local, safe);
      } finally {
        await fs.rm(temp, { recursive: true, force: true });
      }
    });
  }

  it("blocks RPCS3 when its state root vanishes after analysis", async () => {
    const temp = await fs.mkdtemp(
      path.join(os.tmpdir(), "hydra-rpcs3-state-race-")
    );
    try {
      const home = path.join(temp, "home");
      const profile = path.join(home, ".config", "rpcs3");
      const stateRoot = path.join(profile, "savestates", "BLUS30443");
      await fs.mkdir(stateRoot, { recursive: true });
      await fs.mkdir(path.join(profile, "GuiConfigs"));
      await fs.writeFile(
        path.join(profile, "GuiConfigs", "persistent_settings.dat"),
        "config"
      );
      const remote = {
        ...file("BLUS30443_0_1.SAVESTAT"),
        rawPath: "<emulator>/rpcs3-state/BLUS30443",
      };
      const target: ResolvedRestoreTarget = {
        ...remote,
        action: "create",
        restoreRootPath: stateRoot,
        targetPath: path.join(stateRoot, remote.relativePath),
      };
      const local = emptyLocal(home);
      const safeAtAnalysis = await safeMissingEmulatorRestoreEntryIds(
        [target],
        local
      );
      assert.equal(safeAtAnalysis.size, 0);
      await fs.rm(stateRoot, { recursive: true });
      await assert.rejects(
        assertFilesystemEmulatorRestoreRoots([target], local, safeAtAnalysis),
        /cloud_save_restore_root_unavailable/
      );
    } finally {
      await fs.rm(temp, { recursive: true, force: true });
    }
  });
});

describe("first sync of game save directories", () => {
  it("restores RPCS3 savedata only for its active default VFS profile", async () => {
    const temp = await fs.mkdtemp(
      path.join(os.tmpdir(), "hydra-rpcs3-savedata-")
    );
    try {
      const home = path.join(temp, "home");
      const profile = path.join(home, ".config", "rpcs3");
      const active = path.join(profile, "dev_hdd0", "home", "00000001");
      const saveRoot = path.join(active, "savedata");
      const settings = path.join(
        profile,
        "GuiConfigs",
        "persistent_settings.dat"
      );
      await fs.mkdir(active, { recursive: true });
      await fs.mkdir(path.dirname(settings), { recursive: true });
      await fs.writeFile(settings, "[Users]\nactive_user=00000001\n");
      const remote = {
        ...file("BLUS30443-SLOT/DATA.BIN"),
        rawPath: "<emulator>/rpcs3/BLUS30443/00000001",
      };
      const target: ResolvedRestoreTarget = {
        ...remote,
        action: "create",
        restoreRootPath: saveRoot,
        targetPath: path.join(saveRoot, "BLUS30443-SLOT", "DATA.BIN"),
      };
      const local = emptyLocal(home);
      local.coverage = [{ ...partialCoverage, rawPath: remote.rawPath }];
      const safe = await safeMissingEmulatorRestoreEntryIds([target], local);
      assert.deepEqual([...safe], [cloudSaveFileKey(remote)]);
      const merge = mergeUserVariantSnapshots({
        local,
        remoteVariants: [{ variantId, kind: "default" }],
        remoteFiles: [remote],
        base: null,
        safeMissingEmulatorRestoreEntryIds: safe,
      });
      assert.deepEqual(merge.restoreEntryIds, [cloudSaveFileKey(remote)]);
      await assertFilesystemEmulatorRestoreRoots([target], local, safe);

      await fs.writeFile(settings, "[Users]\nactive_user=00000002\n");
      assert.deepEqual(
        [...(await safeMissingEmulatorRestoreEntryIds([target], local))],
        []
      );
      await fs.writeFile(settings, "[Users]\nactive_user=00000001\n");
      await fs.writeFile(
        path.join(profile, "vfs.yml"),
        '"/dev_hdd0/": "/external/ps3"\n'
      );
      assert.deepEqual(
        [...(await safeMissingEmulatorRestoreEntryIds([target], local))],
        []
      );
    } finally {
      await fs.rm(temp, { recursive: true, force: true });
    }
  });

  it("blocks RPCS3 savedata after its root disappears between analysis and restore", async () => {
    const temp = await fs.mkdtemp(
      path.join(os.tmpdir(), "hydra-rpcs3-savedata-race-")
    );
    try {
      const home = path.join(temp, "home");
      const profile = path.join(home, ".config", "rpcs3");
      const saveRoot = path.join(
        profile,
        "dev_hdd0",
        "home",
        "00000001",
        "savedata"
      );
      await fs.mkdir(saveRoot, { recursive: true });
      await fs.mkdir(path.join(profile, "GuiConfigs"));
      await fs.writeFile(
        path.join(profile, "GuiConfigs", "persistent_settings.dat"),
        "[Users]\nactive_user=00000001\n"
      );
      const target: ResolvedRestoreTarget = {
        ...file("BLUS30443-SLOT/DATA.BIN"),
        rawPath: "<emulator>/rpcs3/BLUS30443/00000001",
        action: "create",
        restoreRootPath: saveRoot,
        targetPath: path.join(saveRoot, "BLUS30443-SLOT", "DATA.BIN"),
      };
      const local = emptyLocal(home);
      const safeAtAnalysis = await safeMissingEmulatorRestoreEntryIds(
        [target],
        local
      );
      assert.equal(safeAtAnalysis.size, 0);
      await fs.rm(saveRoot, { recursive: true });
      await assert.rejects(
        assertFilesystemEmulatorRestoreRoots([target], local, safeAtAnalysis),
        /cloud_save_restore_root_unavailable/
      );
    } finally {
      await fs.rm(temp, { recursive: true, force: true });
    }
  });
});
