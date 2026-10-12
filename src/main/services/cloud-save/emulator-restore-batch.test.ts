import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { existsSync, promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import type {
  CloudSavePathContext,
  LocalGameSnapshotContext,
  ReplaceRestoreTarget,
  ReplaceRestoreTargetsResult,
  ResolveRestoreTargetsInput,
  ResolveRestoreTargetsResult,
  SnapshotFile,
} from "@types";

import { cloudSaveFileKey } from "./cloud-save-contract.js";
import {
  assertRestorePlanUnchanged,
  filterUnsafeEmulatorRestoreTargets,
} from "./emulator-restore-plan.js";
import {
  emulatorRestoreRule,
  retroArchSaveRawPath,
  rpcs3SaveRawPath,
  rpcs3SavestateRawPath,
} from "./emulator-provider-identity.js";
import {
  parseRetroArchSaveConfig,
  resolveRetroArchSaveDirectory,
} from "./retroarch-save-config.js";
import {
  discoverRetroArchTargets,
  retroArchTargetForFile,
  type RomSaveLocation,
} from "./retroarch-save-scanner.js";
import { hashRomFile } from "../retroarch/rom-hash.js";
import { mergeUserVariantSnapshots } from "./merge-user-variant-snapshots.js";
import { blockAmbiguousRestoreTargets } from "./restore-target-collision.js";
import {
  parseRpcs3ActiveProfileId,
  resolveRpcs3VfsHdd0,
} from "./rpcs3-save-layout.js";

const addonPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../hydra-native/hydra-native.node"
);
const require = createRequire(import.meta.url);
type NativeRestore = {
  resolveRestoreTargets: (
    input: ResolveRestoreTargetsInput
  ) => Promise<ResolveRestoreTargetsResult>;
  replaceRestoreTargets: (
    files: ReplaceRestoreTarget[]
  ) => Promise<ReplaceRestoreTargetsResult>;
};
const variantId = "a".repeat(64);
const lastModifiedAt = "2026-09-29T00:00:00.000Z";
const contents = new Map([
  ["battery.srm", "battery progress"],
  ["state.state1", "first slot"],
  ["state.state2", "second slot"],
]);

const sha256 = (value: string) =>
  createHash("sha256").update(value).digest("hex");

const fixture = async () => {
  const root = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), "hydra-restore-batch-"))
  );
  const homeDir = path.join(root, "home");
  const configPath = path.join(
    homeDir,
    "Library",
    "Application Support",
    "RetroArch",
    "config",
    "retroarch.cfg"
  );
  const romPath = path.join(homeDir, "ROMs", "Super Mario World.sfc");
  const documentsDir = path.join(homeDir, "Documents", "RetroArch");
  const saveBase = path.join(documentsDir, "saves");
  const stateBase = path.join(documentsDir, "states");
  await fs.mkdir(path.dirname(configPath), { recursive: true });
  await fs.mkdir(path.dirname(romPath), { recursive: true });
  await fs.mkdir(documentsDir, { recursive: true });
  await fs.writeFile(romPath, "Super Mario World ROM identity");
  await fs.writeFile(
    configPath,
    `savefile_directory = "${saveBase}"\nsavestate_directory = "${stateBase}"\nsort_savefiles_enable = "true"\nsort_savestates_enable = "true"\n`
  );
  const config = parseRetroArchSaveConfig(
    await fs.readFile(configPath, "utf8")
  );
  const romHash = await hashRomFile(romPath, "snes");
  assert.ok(romHash);
  const location: RomSaveLocation = {
    rawPath: retroArchSaveRawPath("snes", romHash),
    romPath,
    stem: path.parse(romPath).name,
    saveDirectory: resolveRetroArchSaveDirectory({
      values: config,
      configPath,
      homeDir,
      romPath,
      coreName: "Snes9x",
      kind: "save",
    }),
    stateDirectory: resolveRetroArchSaveDirectory({
      values: config,
      configPath,
      homeDir,
      romPath,
      coreName: "Snes9x",
      kind: "state",
    }),
    hasTransferPak: false,
  };
  assert.equal(location.saveDirectory, path.join(saveBase, "Snes9x"));
  assert.equal(location.stateDirectory, path.join(stateBase, "Snes9x"));
  const files: SnapshotFile[] = [...contents].map(
    ([relativePath, content]) => ({
      variantId,
      rawPath: location.rawPath,
      relativePath,
      hash: sha256(content),
      sizeBytes: Buffer.byteLength(content),
      lastModifiedAt,
    })
  );
  return { root, homeDir, romPath, location, files };
};

const resolveNativeActions = async (
  native: NativeRestore,
  homeDir: string,
  location: RomSaveLocation,
  files: SnapshotFile[]
): Promise<ResolveRestoreTargetsResult> => {
  const plans: ResolveRestoreTargetsResult[] = [];
  for (const file of files) {
    const physical = retroArchTargetForFile(location, file.relativePath);
    assert.ok(physical);
    const rule = emulatorRestoreRule(file.rawPath, physical.filePath, "file");
    plans.push(
      await native.resolveRestoreTargets({
        shop: "launchbox",
        objectId: "super-mario-world",
        platform: "mac",
        homeDir,
        approvedRules: [
          {
            kind: rule.kind,
            rawPath: rule.rawPath,
            source: rule.source,
            preferredPath: rule.preferredPath,
            when: rule.when,
          },
        ],
        variants: [{ variantId, kind: "default" }],
        files: [file],
      })
    );
  }
  return {
    actions: plans.flatMap((plan) => plan.actions),
    blocked: plans.flatMap((plan) => plan.blocked),
    deferred: plans.flatMap((plan) => plan.deferred),
  };
};

describe("emulator restore batch", () => {
  it(
    "restores the battery save and two states into absent Mac RetroArch directories",
    { skip: !existsSync(addonPath) && "native addon is not built" },
    async () => {
      const sample = await fixture();
      try {
        const native = require(addonPath) as NativeRestore;
        assert.equal(existsSync(sample.location.saveDirectory!), false);
        assert.equal(existsSync(sample.location.stateDirectory!), false);

        const plan = await resolveNativeActions(
          native,
          sample.homeDir,
          sample.location,
          sample.files
        );
        const pathContext: CloudSavePathContext = {
          shop: "launchbox",
          objectId: "super-mario-world",
          platform: "mac",
          homeDir: sample.homeDir,
          storeUserContext: { known: [] },
        };
        const safePlan = await filterUnsafeEmulatorRestoreTargets(
          true,
          pathContext,
          plan
        );
        assert.deepEqual(safePlan.blocked, []);
        assert.deepEqual(safePlan.deferred, []);
        assert.equal(safePlan.actions.length, 3);
        assert.deepEqual(
          safePlan.actions.map((action) => action.targetPath),
          [
            path.join(sample.location.saveDirectory!, "Super Mario World.srm"),
            path.join(
              sample.location.stateDirectory!,
              "Super Mario World.state1"
            ),
            path.join(
              sample.location.stateDirectory!,
              "Super Mario World.state2"
            ),
          ]
        );

        const local: LocalGameSnapshotContext = {
          gameId: { shop: "launchbox", objectId: "super-mario-world" },
          ruleSourceRevision: "retroarch-v2",
          discoveryEngineVersion: 4,
          coverage: [
            {
              candidateId: "retroarch",
              ruleId: "retroarch",
              variantId,
              rawPath: sample.location.rawPath,
              selectedRoot: true,
              authority: "exact",
              outcome: "partial",
              enumeratedCompletely: false,
              warningCodes: ["retroarch-location-partial"],
            },
          ],
          variants: [{ variantId, kind: "default" }],
          fileCount: 0,
          totalSizeBytes: 0,
          files: [],
          aggregateHash: sha256("empty"),
          sourceFiles: [],
          environmentId: "host-b",
          customPathRawPaths: [],
          pathContext,
        };
        const selected = mergeUserVariantSnapshots({
          local,
          remoteVariants: [{ variantId, kind: "default" }],
          remoteFiles: sample.files,
          base: null,
          restorableEmulatorEntryIds: new Set(
            safePlan.actions.map(cloudSaveFileKey)
          ),
        });
        assert.deepEqual(
          selected.restoreEntryIds,
          sample.files.map(cloudSaveFileKey).sort()
        );
        assert.deepEqual(selected.deleteRemoteEntryIds, []);

        const tempDir = path.join(sample.root, "download");
        await fs.mkdir(tempDir);
        const replacements: ReplaceRestoreTarget[] = [];
        for (const action of safePlan.actions) {
          const content = contents.get(action.relativePath);
          assert.ok(content);
          const tempPath = path.join(tempDir, action.relativePath);
          await fs.writeFile(tempPath, content);
          replacements.push({
            variantId: action.variantId,
            rawPath: action.rawPath,
            relativePath: action.relativePath,
            targetPath: action.targetPath,
            restoreRootPath: action.restoreRootPath,
            lastModifiedAt: action.lastModifiedAt,
            action: "restore",
            tempPath,
            expectedHash: action.hash,
          });
        }
        const result = await native.replaceRestoreTargets(replacements);
        assert.equal(result.restoredFiles.length, 3);
        assert.deepEqual(result.failedFiles, []);
        assert.deepEqual(result.metadataFailures, []);
        for (const action of safePlan.actions) {
          assert.equal(
            await fs.readFile(action.targetPath, "utf8"),
            contents.get(action.relativePath)
          );
        }
        const discovered = await discoverRetroArchTargets(
          sample.location,
          "snes"
        );
        assert.equal(discovered.complete, true);
        assert.deepEqual(
          discovered.targets
            .filter((target) => contents.has(target.relativePath))
            .map((target) => target.relativePath)
            .sort(),
          [...contents.keys()].sort()
        );
        const mergedAfterRestore = mergeUserVariantSnapshots({
          local: {
            ...local,
            files: sample.files,
            fileCount: sample.files.length,
            totalSizeBytes: sample.files.reduce(
              (total, file) => total + file.sizeBytes,
              0
            ),
            coverage: [
              {
                ...local.coverage[0],
                outcome: "scanned",
                enumeratedCompletely: true,
                warningCodes: [],
              },
            ],
          },
          remoteVariants: [{ variantId, kind: "default" }],
          remoteFiles: sample.files,
          base: null,
        });
        assert.deepEqual(mergedAfterRestore.restoreEntryIds, []);
        assert.deepEqual(mergedAfterRestore.unresolvedRemoteEntryIds, []);
        assert.equal(mergedAfterRestore.partial, false);
      } finally {
        await fs.rm(sample.root, { recursive: true, force: true });
      }
    }
  );

  it(
    "keeps missing external roots and symlinked roots unavailable without changing Steam",
    { skip: !existsSync(addonPath) && "native addon is not built" },
    async () => {
      const sample = await fixture();
      try {
        const native = require(addonPath) as NativeRestore;
        const resolved = await resolveNativeActions(
          native,
          sample.homeDir,
          sample.location,
          sample.files
        );
        const first = resolved.actions[0];
        assert.ok(first);
        const single = { actions: [first], blocked: [], deferred: [] };
        const context: CloudSavePathContext = {
          shop: "launchbox",
          objectId: "super-mario-world",
          platform: "mac",
          homeDir: sample.homeDir,
          storeUserContext: { known: [] },
        };
        assert.equal(
          await filterUnsafeEmulatorRestoreTargets(false, context, single),
          single
        );

        const absentHome = path.join(sample.root, "absent-home");
        const absentHomeRoot = path.join(absentHome, "saves", "Snes9x");
        const missingHome = await filterUnsafeEmulatorRestoreTargets(
          true,
          { ...context, homeDir: absentHome },
          {
            ...single,
            actions: [
              {
                ...first,
                restoreRootPath: absentHomeRoot,
                targetPath: path.join(absentHomeRoot, "Super Mario World.srm"),
              },
            ],
          }
        );
        assert.equal(missingHome.actions.length, 0);
        assert.equal(
          missingHome.blocked[0]?.reason,
          "blocked-emulator-destination-unavailable"
        );

        const externalRoot = path.join(sample.root, "external", "Snes9x");
        const external = await filterUnsafeEmulatorRestoreTargets(
          true,
          context,
          {
            ...single,
            actions: [
              {
                ...first,
                restoreRootPath: externalRoot,
                targetPath: path.join(externalRoot, "Super Mario World.srm"),
              },
            ],
          }
        );
        assert.equal(external.actions.length, 0);
        assert.equal(external.blocked.length, 1);

        const outside = path.join(sample.root, "other-save-root");
        await fs.mkdir(outside);
        await fs.symlink(
          outside,
          path.join(sample.homeDir, "Documents", "RetroArch", "saves")
        );
        const symlinked = await filterUnsafeEmulatorRestoreTargets(
          true,
          context,
          single
        );
        assert.equal(symlinked.actions.length, 0);
        assert.equal(symlinked.blocked.length, 1);
        assert.throws(
          () => assertRestorePlanUnchanged(single, symlinked),
          /cloud_save_restore_destination_changed/
        );

        const collision = blockAmbiguousRestoreTargets(
          {
            actions: [
              first,
              {
                ...first,
                relativePath: "battery.rtc",
                targetPath: first.targetPath.replace(
                  "Super Mario World.srm",
                  "super mario world.srm"
                ),
              },
            ],
            blocked: [],
            deferred: [],
          },
          false
        );
        assert.equal(collision.actions.length, 0);
        assert.deepEqual(
          collision.blocked.map((blocked) => blocked.reason),
          ["blocked-target-ambiguous", "blocked-target-ambiguous"]
        );
      } finally {
        await fs.rm(sample.root, { recursive: true, force: true });
      }
    }
  );

  it(
    "rolls back the battery file when the second state target cannot be installed",
    { skip: !existsSync(addonPath) && "native addon is not built" },
    async () => {
      const sample = await fixture();
      try {
        const native = require(addonPath) as NativeRestore;
        const plan = await resolveNativeActions(
          native,
          sample.homeDir,
          sample.location,
          sample.files
        );
        const battery = plan.actions[0];
        assert.ok(battery);
        await fs.mkdir(path.dirname(battery.targetPath), { recursive: true });
        await fs.writeFile(battery.targetPath, "original local progress");
        await fs.mkdir(plan.actions[1]!.targetPath, { recursive: true });
        const tempDir = path.join(sample.root, "download");
        await fs.mkdir(tempDir);
        const replacements: ReplaceRestoreTarget[] = [];
        for (const action of plan.actions) {
          const tempPath = path.join(tempDir, action.relativePath);
          await fs.writeFile(tempPath, contents.get(action.relativePath)!);
          replacements.push({
            variantId: action.variantId,
            rawPath: action.rawPath,
            relativePath: action.relativePath,
            targetPath: action.targetPath,
            restoreRootPath: action.restoreRootPath,
            lastModifiedAt: action.lastModifiedAt,
            action: "restore",
            tempPath,
            expectedHash: action.hash,
          });
        }
        const result = await native.replaceRestoreTargets(replacements);
        assert.equal(result.restoredFiles.length, 0);
        assert.equal(result.failedFiles.length, 3);
        assert.equal(
          await fs.readFile(battery.targetPath, "utf8"),
          "original local progress"
        );
        assert.equal(
          (await fs.stat(plan.actions[1]!.targetPath)).isDirectory(),
          true
        );
        assert.equal(existsSync(plan.actions[2]!.targetPath), false);
      } finally {
        await fs.rm(sample.root, { recursive: true, force: true });
      }
    }
  );
  it(
    "maps RPCS3 cloud user 00000001 to local active user 00000002",
    { skip: !existsSync(addonPath) && "native addon is not built" },
    async () => {
      const root = await fs.mkdtemp(
        path.join(os.tmpdir(), "hydra-rpcs3-restore-")
      );
      try {
        const native = require(addonPath) as NativeRestore;
        const homeDir = path.join(root, "home");
        const configRoot = path.join(
          homeDir,
          "Library",
          "Application Support",
          "rpcs3"
        );
        const hdd0 = resolveRpcs3VfsHdd0(configRoot, null);
        const localProfileId = parseRpcs3ActiveProfileId(
          "[Users]\nactive_user=00000002\n"
        );
        assert.equal(localProfileId, "00000002");
        const profileRoot = path.join(hdd0, "home", localProfileId!);
        const saveRoot = path.join(profileRoot, "savedata");
        const stateRoot = path.join(configRoot, "savestates", "BLUS30443");
        await fs.mkdir(profileRoot, { recursive: true });
        await fs.mkdir(path.join(configRoot, "GuiConfigs"), {
          recursive: true,
        });
        await fs.writeFile(
          path.join(configRoot, "GuiConfigs", "persistent_settings.dat"),
          "[Users]\nactive_user=00000002\n"
        );
        assert.equal(existsSync(saveRoot), false);
        assert.equal(existsSync(stateRoot), false);

        const entries = [
          {
            rawPath: rpcs3SaveRawPath("BLUS30443", "00000001"),
            relativePath: "BLUS30443-SLOT01/DATA.BIN",
            preferredPath: saveRoot,
            kind: "dir" as const,
            content: "savedata",
          },
          {
            rawPath: rpcs3SavestateRawPath("BLUS30443"),
            relativePath: "BLUS30443_0_1.SAVESTAT",
            preferredPath: path.join(stateRoot, "BLUS30443_0_1.SAVESTAT"),
            kind: "file" as const,
            content: "savestate",
          },
        ];
        const plans: ResolveRestoreTargetsResult[] = [];
        const tempDir = path.join(root, "download");
        await fs.mkdir(tempDir);
        const replacements: ReplaceRestoreTarget[] = [];
        for (const [index, entry] of entries.entries()) {
          const file: SnapshotFile = {
            variantId,
            rawPath: entry.rawPath,
            relativePath: entry.relativePath,
            hash: sha256(entry.content),
            sizeBytes: Buffer.byteLength(entry.content),
            lastModifiedAt,
          };
          const rule = emulatorRestoreRule(
            entry.rawPath,
            entry.preferredPath,
            entry.kind
          );
          const plan = await native.resolveRestoreTargets({
            shop: "launchbox",
            objectId: "ps3-game",
            platform: "mac",
            homeDir,
            approvedRules: [
              {
                kind: rule.kind,
                rawPath: rule.rawPath,
                source: rule.source,
                preferredPath: rule.preferredPath,
                when: rule.when,
              },
            ],
            variants: [{ variantId, kind: "default" }],
            files: [file],
          });
          plans.push(plan);
          assert.equal(plan.actions.length, 1);
          const action = plan.actions[0];
          const tempPath = path.join(tempDir, `${index}.blob`);
          await fs.writeFile(tempPath, entry.content);
          replacements.push({
            variantId,
            rawPath: action.rawPath,
            relativePath: action.relativePath,
            targetPath: action.targetPath,
            restoreRootPath: action.restoreRootPath,
            lastModifiedAt,
            action: "restore",
            tempPath,
            expectedHash: file.hash,
          });
        }
        assert.deepEqual(
          plans.flatMap((plan) => plan.blocked),
          []
        );
        assert.deepEqual(
          plans.flatMap((plan) => plan.deferred),
          []
        );
        assert.deepEqual(
          replacements.map((replacement) => replacement.targetPath),
          [
            path.join(saveRoot, "BLUS30443-SLOT01", "DATA.BIN"),
            path.join(stateRoot, "BLUS30443_0_1.SAVESTAT"),
          ]
        );
        const result = await native.replaceRestoreTargets(replacements);
        assert.equal(result.restoredFiles.length, 2);
        assert.deepEqual(result.failedFiles, []);
        for (const [index, replacement] of replacements.entries()) {
          assert.equal(
            await fs.readFile(replacement.targetPath, "utf8"),
            entries[index].content
          );
        }
      } finally {
        await fs.rm(root, { recursive: true, force: true });
      }
    }
  );
});
