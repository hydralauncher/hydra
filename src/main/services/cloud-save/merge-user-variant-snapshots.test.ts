import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type {
  LocalGameSnapshotContext,
  SnapshotFile,
  SnapshotVariant,
  UserLocationCoverage,
} from "@types";

// @ts-ignore The Node ESM test runner requires the source extension.
import { cloudSaveFileKey } from "./cloud-save-contract.ts";
// @ts-ignore The Node ESM test runner requires the source extension.
import { mergeUserVariantSnapshots } from "./merge-user-variant-snapshots.ts";

const variantId = "1".repeat(64);
const variant: SnapshotVariant = { variantId, kind: "default" };
const hash = (value: string) => value.repeat(64).slice(0, 64);
const file = (
  relativePath: string,
  value: string,
  rawPath = "<home>/game",
  fileVariantId = variantId
): SnapshotFile => ({
  variantId: fileVariantId,
  rawPath,
  relativePath,
  hash: hash(value),
  sizeBytes: 4,
  lastModifiedAt: "2026-07-22T10:00:00.000Z",
});

const context = (files: SnapshotFile[]): LocalGameSnapshotContext =>
  ({
    gameId: { shop: "steam", objectId: "1" },
    ruleSourceRevision: "rules",
    discoveryEngineVersion: 2,
    coverage: [],
    variants: [variant],
    fileCount: files.length,
    totalSizeBytes: files.reduce((total, item) => total + item.sizeBytes, 0),
    files,
    aggregateHash: hash("f"),
    sourceFiles: [],
    environmentId: "environment",
    customPathRawPaths: [],
    pathContext: {
      shop: "steam",
      objectId: "1",
      platform: "windows",
      homeDir: "C:/Users/Hydra",
      storeUserContext: { known: [] },
    },
  }) as LocalGameSnapshotContext;

const anchor = (files: SnapshotFile[]) => ({
  schemaVersion: 4 as const,
  environmentId: "environment",
  baseSnapshotId: "snapshot",
  baseVersion: 1,
  baseAggregateHash: hash("b"),
  entries: files.map(({ lastModifiedAt: _, ...entry }) => entry),
  unresolvedRemoteEntryIds: [],
  updatedAt: "2026-07-22T10:00:00.000Z",
});

describe("merge user variant snapshots", () => {
  it("preserves remote RPCS3 saves while the game disc is unresolved", () => {
    const remote = file(
      "NPUB31419-SLOT/GAMEDATA",
      "r",
      "<emulator>/rpcs3/NPUB31419/00000001"
    );
    const local = context([]);
    local.coverage = [
      {
        candidateId: "rpcs3-disc-missing",
        ruleId: "rpcs3",
        rawPath: "<emulator>/rpcs3/unresolved",
        selectedRoot: false,
        authority: "inferred",
        outcome: "unresolved",
        enumeratedCompletely: false,
        warningCodes: ["rpcs3-title-id-unresolved"],
      },
    ];

    const result = mergeUserVariantSnapshots({
      local,
      remoteVariants: [variant],
      remoteFiles: [remote],
      base: anchor([remote]),
    });

    assert.deepEqual(result.deleteRemoteEntryIds, []);
    assert.deepEqual(result.files, [remote]);
  });

  it("unites five cloud states with three new notebook states", () => {
    const rawPath = "<emulator>/retroarch-v2/snes";
    const remote = ["1", "2", "3", "4", "5"].map((value) =>
      file(`states/${value.repeat(64)}.state`, value, rawPath)
    );
    const local = ["a", "b", "c"].map((value) =>
      file(`states/${value.repeat(64)}.state`, value, rawPath)
    );
    const result = mergeUserVariantSnapshots({
      local: context(local),
      remoteVariants: [variant],
      remoteFiles: remote,
      base: null,
    });
    assert.equal(result.files.length, 8);
    assert.equal(result.restoreEntryIds.length, 5);
    assert.equal(result.conflicts.length, 0);
  });

  it("asks for a choice when the same state changed on both PCs", () => {
    const rawPath = "<emulator>/retroarch-v2/snes";
    const statePath = `states/${"a".repeat(64)}.state`;
    const base = file(statePath, "1", rawPath);
    const local = file(statePath, "2", rawPath);
    const remote = file(statePath, "3", rawPath);
    const result = mergeUserVariantSnapshots({
      local: context([local]),
      remoteVariants: [variant],
      remoteFiles: [remote],
      base: anchor([base]),
    });
    assert.deepEqual(
      result.conflicts.map((entry) => entry.entryId),
      [cloudSaveFileKey(remote)]
    );
  });

  it("keeps RetroArch state images with the chosen state version", () => {
    const rawPath = "<emulator>/retroarch-v2/snes";
    const stateId = "1".repeat(64);
    const local = [
      file(`states/${stateId}.state`, "a", rawPath),
      file(`states/${stateId}.png`, "b", rawPath),
    ];
    const remote = [
      file(`states/${stateId}.state`, "c", rawPath),
      file(`states/${stateId}.png`, "d", rawPath),
    ];
    const first = mergeUserVariantSnapshots({
      local: context(local),
      remoteVariants: [variant],
      remoteFiles: remote,
      base: null,
    });
    assert.equal(first.conflicts.length, 2);
    const resolved = mergeUserVariantSnapshots({
      local: context(local),
      remoteVariants: [variant],
      remoteFiles: remote,
      base: null,
      resolutions: new Map(
        first.conflicts.map((entry) => [entry.entryId, "keep-local"])
      ),
    });
    assert.deepEqual(
      resolved.files.map((entry) => entry.hash),
      [hash("b"), hash("a")]
    );
  });

  it("keeps RetroArch RTC with the chosen battery save", () => {
    const rawPath = "<emulator>/retroarch-v2/snes";
    const local = [file("battery.srm", "a", rawPath)];
    const remote = [
      file("battery.srm", "b", rawPath),
      file("battery.rtc", "c", rawPath),
    ];
    const first = mergeUserVariantSnapshots({
      local: context(local),
      remoteVariants: [variant],
      remoteFiles: remote,
      base: null,
    });
    assert.equal(first.conflicts.length, 2);
    const resolved = mergeUserVariantSnapshots({
      local: context(local),
      remoteVariants: [variant],
      remoteFiles: remote,
      base: null,
      resolutions: new Map(
        first.conflicts.map((entry) => [entry.entryId, "keep-local"])
      ),
    });
    assert.deepEqual(
      resolved.files.map((entry) => entry.relativePath),
      ["battery.srm"]
    );
  });

  it("keeps N64 auxiliary files with the chosen battery version", () => {
    const rawPath = "<emulator>/retroarch-v2/n64";
    const local = [
      file("battery.srm", "a", rawPath),
      file("battery.eep", "b", rawPath),
    ];
    const remote = [
      file("battery.srm", "c", rawPath),
      file("battery.eep", "d", rawPath),
      file("transfer-pak.sav", "e", rawPath),
    ];
    const first = mergeUserVariantSnapshots({
      local: context(local),
      remoteVariants: [variant],
      remoteFiles: remote,
      base: null,
    });
    assert.equal(first.conflicts.length, 3);
    const resolved = mergeUserVariantSnapshots({
      local: context(local),
      remoteVariants: [variant],
      remoteFiles: remote,
      base: null,
      resolutions: new Map(
        first.conflicts.map((entry) => [entry.entryId, "keep-local"])
      ),
    });
    assert.deepEqual(resolved.files.map((entry) => entry.relativePath).sort(), [
      "battery.eep",
      "battery.srm",
    ]);
  });

  it("retains an archived legacy battery save without restoring it", () => {
    const archive = file(
      "archive/battery/11111111.srm",
      "a",
      "<emulator>/retroarch-v2/snes"
    );
    const result = mergeUserVariantSnapshots({
      local: context([]),
      remoteVariants: [variant],
      remoteFiles: [archive],
      base: null,
      preserveCloudOnlyEntryIds: new Set([cloudSaveFileKey(archive)]),
    });
    assert.deepEqual(result.files, [archive]);
    assert.deepEqual(result.restoreEntryIds, []);
    assert.deepEqual(result.unresolvedRemoteEntryIds, []);
    assert.equal(result.partial, false);
  });
  it("combines independent local and remote changes", () => {
    const base = [file("A.sav", "a"), file("B.sav", "b")];
    const result = mergeUserVariantSnapshots({
      local: context([file("A.sav", "c"), file("B.sav", "b")]),
      remoteVariants: [variant],
      remoteFiles: [file("A.sav", "a"), file("B.sav", "d")],
      base: anchor(base),
    });

    assert.deepEqual(
      result.files.map((item) => [item.relativePath, item.hash]),
      [
        ["A.sav", hash("c")],
        ["B.sav", hash("d")],
      ]
    );
    assert.deepEqual(result.restoreEntryIds, [
      cloudSaveFileKey(file("B.sav", "d")),
    ]);
    assert.equal(result.conflicts.length, 0);
  });

  it("merges an existing v1 default variant without duplicating it", () => {
    const stableDefault: SnapshotVariant = {
      variantId:
        "6bb5b19456b48c65d5b6120154934d146013679fd8673e7d42694fff131774db",
      kind: "default",
    };
    const localFile = {
      ...file("achievements.json", "a", "<winAppData>/GSE Saves/1817070"),
      variantId: stableDefault.variantId,
    };
    const remoteFile = { ...localFile };

    const result = mergeUserVariantSnapshots({
      local: {
        ...context([localFile]),
        variants: [stableDefault],
      },
      remoteVariants: [stableDefault],
      remoteFiles: [remoteFile],
      base: anchor([remoteFile]),
    });

    assert.deepEqual(result.variants, [stableDefault]);
    assert.deepEqual(result.files, [remoteFile]);
    assert.deepEqual(result.conflicts, []);
  });

  it("preserves and schedules remote-only entries for restore", () => {
    const remote = file("remote.sav", "r");
    const result = mergeUserVariantSnapshots({
      local: context([]),
      remoteVariants: [variant],
      remoteFiles: [remote],
      base: null,
    });

    assert.deepEqual(result.files, [remote]);
    assert.deepEqual(result.restoreEntryIds, [cloudSaveFileKey(remote)]);
    assert.deepEqual(result.unresolvedRemoteEntryIds, [
      cloudSaveFileKey(remote),
    ]);
  });

  it("preserves a custom-path entry when this launcher has no local coverage", () => {
    const remote = file(
      "slot.sav",
      "r",
      "<custom><windows>C:/Users/Hydra/Saves/Game"
    );
    const result = mergeUserVariantSnapshots({
      local: context([]),
      remoteVariants: [variant],
      remoteFiles: [remote],
      base: anchor([remote]),
    });

    assert.deepEqual(result.files, [remote]);
    assert.deepEqual(result.deleteRemoteEntryIds, []);
    assert.deepEqual(result.unresolvedRemoteEntryIds, [
      cloudSaveFileKey(remote),
    ]);
  });

  it("keeps RPCS3 saves from an inactive profile when only the active profile was scanned", () => {
    const activeRawPath = "<emulator>/rpcs3/BLUS30443/00000002";
    const inactiveRawPath = "<emulator>/rpcs3/BLUS30443/00000001";
    const active = file("BLUS30443-SLOT/DATA.BIN", "a", activeRawPath);
    const inactive = file("BLUS30443-SLOT/DATA.BIN", "b", inactiveRawPath);
    const local = context([active]);
    local.coverage = [
      {
        candidateId: "active",
        ruleId: "active",
        variantId,
        rawPath: activeRawPath,
        selectedRoot: true,
        authority: "exact",
        outcome: "scanned",
        enumeratedCompletely: true,
        warningCodes: [],
      },
    ];

    const result = mergeUserVariantSnapshots({
      local,
      remoteVariants: [variant],
      remoteFiles: [active, inactive],
      base: anchor([active, inactive]),
    });

    assert.deepEqual(result.deleteRemoteEntryIds, []);
    assert.deepEqual(result.files, [inactive, active]);
    assert.deepEqual(result.unresolvedRemoteEntryIds, [
      cloudSaveFileKey(inactive),
    ]);
  });

  it("does not combine divergent files from one RPCS3 save slot", () => {
    const rawPath = "<emulator>/rpcs3/BLUS30443/00000001";
    const base = [
      file("BLUS30443-SLOT/PARAM.SFO", "a", rawPath),
      file("BLUS30443-SLOT/DATA.BIN", "b", rawPath),
    ];
    const local = [file("BLUS30443-SLOT/PARAM.SFO", "c", rawPath), base[1]];
    const remote = [base[0], file("BLUS30443-SLOT/DATA.BIN", "d", rawPath)];
    const input = {
      local: context(local),
      remoteVariants: [variant],
      remoteFiles: remote,
      base: anchor(base),
    };

    const unresolved = mergeUserVariantSnapshots(input);
    assert.deepEqual(
      unresolved.conflicts.map((item) => item.entryId).sort(),
      base.map(cloudSaveFileKey).sort()
    );

    for (const [resolution, expected] of [
      ["keep-local", local],
      ["keep-remote", remote],
    ] as const) {
      const resolutions = new Map(
        unresolved.conflicts.map((conflict) => [conflict.entryId, resolution])
      );
      const resolved = mergeUserVariantSnapshots({ ...input, resolutions });
      assert.deepEqual(resolved.conflicts, []);
      assert.deepEqual(
        resolved.files
          .map((item) => [item.relativePath, item.hash])
          .sort((left, right) => left[0].localeCompare(right[0])),
        expected
          .map((item) => [item.relativePath, item.hash])
          .sort((left, right) => left[0].localeCompare(right[0]))
      );
    }
  });

  it("keeps unrelated RPCS3 slots independent", () => {
    const rawPath = "<emulator>/rpcs3/BLUS30443/00000001";
    const base = [
      file("BLUS30443-SLOT-1/DATA.BIN", "a", rawPath),
      file("BLUS30443-SLOT-2/DATA.BIN", "b", rawPath),
    ];
    const result = mergeUserVariantSnapshots({
      local: context([
        file("BLUS30443-SLOT-1/DATA.BIN", "c", rawPath),
        base[1],
      ]),
      remoteVariants: [variant],
      remoteFiles: [base[0], file("BLUS30443-SLOT-2/DATA.BIN", "d", rawPath)],
      base: anchor(base),
    });

    assert.deepEqual(result.conflicts, []);
    assert.deepEqual(
      result.files.map((item) => item.hash),
      [hash("c"), hash("d")]
    );
  });

  it("resolves a deleted RPCS3 slot file and a remote edit together", () => {
    const rawPath = "<emulator>/rpcs3/BLUS30443/00000001";
    const base = [
      file("BLUS30443-SLOT/PARAM.SFO", "a", rawPath),
      file("BLUS30443-SLOT/DATA.BIN", "b", rawPath),
    ];
    const local = context([base[1]]);
    local.coverage = [
      {
        candidateId: "active",
        ruleId: "active",
        variantId,
        rawPath,
        selectedRoot: true,
        authority: "exact",
        outcome: "scanned",
        enumeratedCompletely: true,
        warningCodes: [],
      },
    ];
    const remote = [base[0], file("BLUS30443-SLOT/DATA.BIN", "c", rawPath)];
    const input = {
      local,
      remoteVariants: [variant],
      remoteFiles: remote,
      base: anchor(base),
    };
    const unresolved = mergeUserVariantSnapshots(input);
    assert.equal(unresolved.conflicts.length, 2);

    const resolutions = new Map(
      unresolved.conflicts.map((conflict) => [
        conflict.entryId,
        "keep-local" as const,
      ])
    );
    const resolved = mergeUserVariantSnapshots({ ...input, resolutions });
    assert.deepEqual(resolved.conflicts, []);
    assert.deepEqual(resolved.files, local.files);
    assert.deepEqual(resolved.deleteRemoteEntryIds, [
      cloudSaveFileKey(base[0]),
    ]);
  });

  it("treats different custom raw paths as different files", () => {
    const local = file("slot.sav", "a", "<custom><windows><winAppData>/Game");
    const remote = file(
      "slot.sav",
      "a",
      "<custom><linux><home>/.local/share/hydra/prefix/drive_c/users/steamuser/AppData/Roaming/Game"
    );
    const result = mergeUserVariantSnapshots({
      local: context([local]),
      remoteVariants: [variant],
      remoteFiles: [remote],
      base: null,
    });

    assert.deepEqual(
      result.files.map(({ rawPath }) => rawPath).sort(),
      [local.rawPath, remote.rawPath].sort()
    );
    assert.deepEqual(result.restoreEntryIds, [cloudSaveFileKey(remote)]);
    assert.deepEqual(result.deleteRemoteEntryIds, []);
    assert.deepEqual(result.conflicts, []);
  });

  it("does not create a conflict between different custom raw paths", () => {
    const local = file("slot.sav", "l", "<custom><windows><winAppData>/Game");
    const remote = file(
      "slot.sav",
      "r",
      "<custom><windows>C:/Users/Rodrigo/AppData/Roaming/Game"
    );
    const result = mergeUserVariantSnapshots({
      local: context([local]),
      remoteVariants: [variant],
      remoteFiles: [remote],
      base: null,
    });

    assert.deepEqual(
      result.files.map(({ rawPath }) => rawPath).sort(),
      [local.rawPath, remote.rawPath].sort()
    );
    assert.deepEqual(result.conflicts, []);
  });

  it("does not turn an unresolved remote entry into a later deletion", () => {
    const local = file("local.sav", "l");
    const remote = file("remote.sav", "r");
    const unresolvedCoverage: UserLocationCoverage = {
      candidateId: "candidate",
      ruleId: "rule",
      variantId,
      rawPath: remote.rawPath,
      relativePath: remote.relativePath,
      selectedRoot: true,
      authority: "authoritative",
      outcome: "partial",
      enumeratedCompletely: false,
      warningCodes: [],
    };
    const first = mergeUserVariantSnapshots({
      local: { ...context([local]), coverage: [unresolvedCoverage] },
      remoteVariants: [variant],
      remoteFiles: [remote],
      base: null,
    });
    const second = mergeUserVariantSnapshots({
      local: {
        ...context([local]),
        coverage: [
          {
            ...unresolvedCoverage,
            outcome: "scanned",
            enumeratedCompletely: true,
          },
        ],
      },
      remoteVariants: [variant],
      remoteFiles: [remote],
      base: {
        ...anchor(first.files),
        unresolvedRemoteEntryIds: first.unresolvedRemoteEntryIds,
      },
    });

    assert.deepEqual(second.deleteRemoteEntryIds, []);
    assert.deepEqual(second.restoreEntryIds, [cloudSaveFileKey(remote)]);
  });

  it("treats equivalent N-API and API variant shapes as equal", () => {
    const napiVariant = {
      variantId,
      kind: "default",
      steamId64: null,
      concreteFolderId: null,
    } as unknown as SnapshotVariant;

    assert.doesNotThrow(() =>
      mergeUserVariantSnapshots({
        local: { ...context([]), variants: [napiVariant] },
        remoteVariants: [variant],
        remoteFiles: [],
        base: null,
      })
    );
  });

  it("restores everything when the local snapshot is empty", () => {
    const remote = file("remote.sav", "r");
    const local = context([]);
    local.coverage = [
      {
        candidateId: "candidate",
        ruleId: "rule",
        variantId,
        rawPath: remote.rawPath,
        selectedRoot: true,
        authority: "authoritative",
        outcome: "partial",
        enumeratedCompletely: false,
        warningCodes: ["partial"],
      },
    ];
    const result = mergeUserVariantSnapshots({
      local,
      remoteVariants: [variant],
      remoteFiles: [remote],
      base: null,
    });

    assert.deepEqual(result.restoreEntryIds, [cloudSaveFileKey(remote)]);
    assert.equal(result.partial, true);
    assert.deepEqual(result.files, [remote]);
  });

  it("keeps an emulator snapshot pending when its only destination is incomplete", () => {
    const remote = file(
      "state.state1",
      "r",
      "<emulator>/retroarch/snes/1234ABCD"
    );
    const local = context([]);
    local.coverage = [
      {
        candidateId: "missing-state-root",
        ruleId: "retroarch",
        variantId,
        rawPath: remote.rawPath,
        selectedRoot: true,
        authority: "exact",
        outcome: "partial",
        enumeratedCompletely: false,
        warningCodes: ["retroarch-location-partial"],
      },
    ];
    const result = mergeUserVariantSnapshots({
      local,
      remoteVariants: [variant],
      remoteFiles: [remote],
      base: null,
    });

    assert.deepEqual(result.files, [remote]);
    assert.deepEqual(result.restoreEntryIds, []);
    assert.deepEqual(result.unresolvedRemoteEntryIds, [
      cloudSaveFileKey(remote),
    ]);
  });

  it("propagates a proven local deletion to the remote snapshot", () => {
    const deleted = file("deleted.sav", "a");
    const retained = file("retained.sav", "b");
    const local = context([retained]);
    local.coverage = [
      {
        candidateId: "candidate",
        ruleId: "rule",
        variantId,
        rawPath: deleted.rawPath,
        selectedRoot: true,
        authority: "authoritative",
        outcome: "scanned",
        enumeratedCompletely: true,
        warningCodes: [],
      },
    ];

    const result = mergeUserVariantSnapshots({
      local,
      remoteVariants: [variant],
      remoteFiles: [deleted, retained],
      base: anchor([deleted, retained]),
    });

    assert.deepEqual(result.files, [retained]);
    assert.deepEqual(result.deleteRemoteEntryIds, [cloudSaveFileKey(deleted)]);
    assert.deepEqual(result.restoreEntryIds, []);
  });

  it("deletes one empty profile without affecting another profile", () => {
    const firstVariant: SnapshotVariant = {
      variantId,
      kind: "opaque-folder",
      concreteFolderId: "76561197960267366",
    };
    const secondVariantId = "2".repeat(64);
    const secondVariant: SnapshotVariant = {
      variantId: secondVariantId,
      kind: "opaque-folder",
      concreteFolderId: "76561199873967367",
    };
    const rawPath = "<winAppData>/Sekiro/<storeUserId>/S0000.sl2";
    const deleted = file("S0000.sl2", "a", rawPath);
    const retained = file("S0000.sl2", "b", rawPath, secondVariantId);
    const local = context([retained]);
    local.variants = [secondVariant];
    local.coverage = [
      {
        candidateId: "empty-sekiro-profile",
        ruleId: "sekiro-save",
        variantId,
        rawPath,
        selectedRoot: true,
        authority: "exact",
        outcome: "scanned",
        enumeratedCompletely: true,
        warningCodes: [],
      },
    ];

    const result = mergeUserVariantSnapshots({
      local,
      remoteVariants: [firstVariant, secondVariant],
      remoteFiles: [deleted, retained],
      base: anchor([deleted, retained]),
    });

    assert.deepEqual(result.files, [retained]);
    assert.deepEqual(result.deleteRemoteEntryIds, [cloudSaveFileKey(deleted)]);
    assert.deepEqual(result.restoreEntryIds, []);
    assert.deepEqual(result.unresolvedRemoteEntryIds, []);
  });

  it("uses complete leaf-parent coverage to delete a missing filename profile", () => {
    const firstVariant: SnapshotVariant = {
      variantId,
      kind: "opaque-folder",
      concreteFolderId: "Goldberg",
    };
    const secondVariantId = "2".repeat(64);
    const secondVariant: SnapshotVariant = {
      variantId: secondVariantId,
      kind: "opaque-folder",
      concreteFolderId: "Rune",
    };
    const rawPath = "<home>/Game/PlayerProfile<storeUserId>.sav";
    const deleted = file("PlayerProfileGoldberg.sav", "a", rawPath);
    const retained = file(
      "PlayerProfileRune.sav",
      "b",
      rawPath,
      secondVariantId
    );
    const local = context([retained]);
    local.variants = [secondVariant];
    local.coverage = [
      {
        candidateId: "profiles-parent",
        ruleId: "profile-save",
        rawPath,
        selectedRoot: true,
        authority: "inferred",
        outcome: "scanned",
        enumeratedCompletely: true,
        warningCodes: [],
      },
    ];

    const result = mergeUserVariantSnapshots({
      local,
      remoteVariants: [firstVariant, secondVariant],
      remoteFiles: [deleted, retained],
      base: anchor([deleted, retained]),
    });

    assert.deepEqual(result.files, [retained]);
    assert.deepEqual(result.deleteRemoteEntryIds, [cloudSaveFileKey(deleted)]);
    assert.deepEqual(result.restoreEntryIds, []);
  });

  it("restores the last file even when coverage could prove deletion", () => {
    const deleted = file("S0000.sl2", "a");
    const local = context([]);
    local.coverage = [
      {
        candidateId: "sekiro-profile",
        ruleId: "sekiro-save",
        variantId,
        rawPath: deleted.rawPath,
        selectedRoot: true,
        authority: "exact",
        outcome: "scanned",
        enumeratedCompletely: true,
        warningCodes: [],
      },
    ];

    const result = mergeUserVariantSnapshots({
      local,
      remoteVariants: [variant],
      remoteFiles: [deleted],
      base: anchor([deleted]),
    });

    assert.deepEqual(result.files, [deleted]);
    assert.deepEqual(result.deleteRemoteEntryIds, []);
    assert.deepEqual(result.restoreEntryIds, [cloudSaveFileKey(deleted)]);
    assert.deepEqual(result.unresolvedRemoteEntryIds, []);
  });

  it("restores an empty local snapshot instead of conflicting with a changed remote", () => {
    const previous = file("S0000.sl2", "a");
    const remote = file("S0000.sl2", "b");
    const local = context([]);
    local.coverage = [
      {
        candidateId: "sekiro-profile",
        ruleId: "sekiro-save",
        variantId,
        rawPath: remote.rawPath,
        selectedRoot: true,
        authority: "exact",
        outcome: "scanned",
        enumeratedCompletely: true,
        warningCodes: [],
      },
    ];

    const result = mergeUserVariantSnapshots({
      local,
      remoteVariants: [variant],
      remoteFiles: [remote],
      base: anchor([previous]),
    });

    assert.deepEqual(result.files, [remote]);
    assert.deepEqual(result.conflicts, []);
    assert.deepEqual(result.deleteRemoteEntryIds, []);
    assert.deepEqual(result.restoreEntryIds, [cloudSaveFileKey(remote)]);
  });

  it("restores the last file during a restore-only pre-launch sync", () => {
    const deleted = file("S0000.sl2", "a");
    const local = context([]);
    local.coverage = [
      {
        candidateId: "sekiro-profile",
        ruleId: "sekiro-save",
        variantId,
        rawPath: deleted.rawPath,
        selectedRoot: true,
        authority: "exact",
        outcome: "scanned",
        enumeratedCompletely: true,
        warningCodes: [],
      },
    ];

    const result = mergeUserVariantSnapshots({
      local,
      remoteVariants: [variant],
      remoteFiles: [deleted],
      base: anchor([deleted]),
      direction: "restore-only",
    });

    assert.deepEqual(result.files, [deleted]);
    assert.deepEqual(result.deleteRemoteEntryIds, []);
    assert.deepEqual(result.restoreEntryIds, [cloudSaveFileKey(deleted)]);
  });

  it("restores an installation-owned custom path instead of publishing its absence", () => {
    const rawPath = "<custom><windows><base>/Saves";
    const missing = file("slot.sav", "a", rawPath);
    const retained = file("settings.ini", "b", "<home>/other");
    const local = context([retained]);
    local.coverage = [
      {
        candidateId: "custom",
        ruleId: "custom",
        variantId,
        rawPath,
        selectedRoot: true,
        authority: "authoritative",
        outcome: "scanned",
        enumeratedCompletely: true,
        warningCodes: [],
      },
    ];

    const result = mergeUserVariantSnapshots({
      local,
      remoteVariants: [variant],
      remoteFiles: [missing, retained],
      base: anchor([missing, retained]),
      preserveLocalMissingRawPaths: new Set([rawPath]),
    });

    assert.deepEqual(result.files, [missing, retained]);
    assert.deepEqual(result.restoreEntryIds, [cloudSaveFileKey(missing)]);
    assert.deepEqual(result.deleteRemoteEntryIds, []);
  });

  it("restores instead of deleting when the root is missing", () => {
    const missing = file("missing.sav", "a");
    const retained = file("retained.sav", "b", "<home>/other");
    const local = context([retained]);
    local.coverage = [
      {
        candidateId: "candidate",
        ruleId: "rule",
        variantId,
        rawPath: missing.rawPath,
        selectedRoot: false,
        authority: "authoritative",
        outcome: "confirmed-missing",
        enumeratedCompletely: true,
        warningCodes: [],
      },
    ];

    const result = mergeUserVariantSnapshots({
      local,
      remoteVariants: [variant],
      remoteFiles: [missing, retained],
      base: anchor([missing, retained]),
    });

    assert.deepEqual(result.deleteRemoteEntryIds, []);
    assert.deepEqual(result.restoreEntryIds, [cloudSaveFileKey(missing)]);
  });

  it("keeps Minecraft saves synced without local savestates and restores remote states", () => {
    const saveRawPath = "<emulator>/rpcs3/NPUB31419/00000001";
    const stateRawPath = "<emulator>/rpcs3-state/NPUB31419";
    const saves = Array.from({ length: 9 }, (_, index) =>
      file(
        `${index < 5 ? "NPUB31419--260930163517" : "NPUB31419-OPTIONS"}/FILE${index}`,
        String(index),
        saveRawPath
      )
    );
    const state = file("NPUB31419_1_0.SAVESTAT.zst", "s", stateRawPath);
    const local = context(saves);
    local.coverage = [
      {
        candidateId: "savedata",
        ruleId: "savedata",
        variantId,
        rawPath: saveRawPath,
        selectedRoot: true,
        authority: "exact",
        outcome: "scanned",
        enumeratedCompletely: true,
        warningCodes: [],
      },
      {
        candidateId: "savestates",
        ruleId: "savestates",
        variantId,
        rawPath: stateRawPath,
        selectedRoot: false,
        authority: "exact",
        outcome: "confirmed-missing",
        enumeratedCompletely: true,
        warningCodes: [],
      },
    ];

    const synced = mergeUserVariantSnapshots({
      local,
      remoteVariants: [variant],
      remoteFiles: saves,
      base: anchor(saves),
    });
    assert.equal(synced.files.length, 9);
    assert.equal(synced.partial, false);
    assert.deepEqual(synced.restoreEntryIds, []);

    const remoteFiles = [...saves, state];
    const missingState = mergeUserVariantSnapshots({
      local,
      remoteVariants: [variant],
      remoteFiles,
      base: anchor(remoteFiles),
    });
    assert.deepEqual(missingState.deleteRemoteEntryIds, []);
    assert.deepEqual(missingState.restoreEntryIds, [cloudSaveFileKey(state)]);

    const restored = context(remoteFiles);
    restored.coverage = [
      local.coverage[0],
      { ...local.coverage[1], selectedRoot: true, outcome: "scanned" },
    ];
    const afterRestore = mergeUserVariantSnapshots({
      local: restored,
      remoteVariants: [variant],
      remoteFiles,
      base: anchor(remoteFiles),
    });
    assert.equal(afterRestore.partial, false);
    assert.deepEqual(afterRestore.deleteRemoteEntryIds, []);
  });

  it("preserves remote data without restoring when coverage is incomplete", () => {
    const remote = file("remote.sav", "a");
    const retained = file("retained.sav", "b", "<home>/other");
    const local = context([retained]);
    local.coverage = [
      {
        candidateId: "candidate",
        ruleId: "rule",
        variantId,
        rawPath: remote.rawPath,
        selectedRoot: true,
        authority: "authoritative",
        outcome: "partial",
        enumeratedCompletely: false,
        warningCodes: ["filesystem-error"],
      },
    ];

    const result = mergeUserVariantSnapshots({
      local,
      remoteVariants: [variant],
      remoteFiles: [remote, retained],
      base: anchor([remote, retained]),
    });

    assert.deepEqual(result.files, [remote, retained]);
    assert.deepEqual(result.restoreEntryIds, []);
    assert.deepEqual(result.deleteRemoteEntryIds, []);
    assert.equal(result.partial, true);
  });

  it("preserves foreign-OS files without restoring, deleting or staying partial", () => {
    const windowsFile = file(
      "windows-slot.dat",
      "w",
      "<winAppData>/Team Cherry/Hollow Knight Silksong"
    );
    const linuxFile = file(
      "linux-slot.dat",
      "l",
      "<xdgConfig>/Team Cherry/Hollow Knight Silksong"
    );
    const local = context([windowsFile]);
    local.coverage = [
      {
        candidateId: "foreign-linux-rule",
        ruleId: "linux-rule",
        rawPath: linuxFile.rawPath,
        selectedRoot: false,
        authority: "inferred",
        outcome: "foreign-environment",
        enumeratedCompletely: false,
        warningCodes: [],
      },
    ];

    const result = mergeUserVariantSnapshots({
      local,
      remoteVariants: [variant],
      remoteFiles: [windowsFile, linuxFile],
      base: anchor([windowsFile, linuxFile]),
    });

    assert.deepEqual(result.files, [windowsFile, linuxFile]);
    assert.deepEqual(result.restoreEntryIds, []);
    assert.deepEqual(result.deleteRemoteEntryIds, []);
    assert.deepEqual(result.unresolvedRemoteEntryIds, []);
    assert.equal(result.partial, false);
  });

  it("restores only current-OS files when the local snapshot is empty", () => {
    const windowsFile = file(
      "windows-slot.dat",
      "w",
      "<winAppData>/Team Cherry/Hollow Knight Silksong"
    );
    const linuxFile = file(
      "linux-slot.dat",
      "l",
      "<xdgConfig>/Team Cherry/Hollow Knight Silksong"
    );
    const local = context([]);
    local.coverage = [
      {
        candidateId: "windows-rule",
        ruleId: "windows-rule",
        rawPath: windowsFile.rawPath,
        selectedRoot: true,
        authority: "exact",
        outcome: "scanned",
        enumeratedCompletely: true,
        warningCodes: [],
      },
      {
        candidateId: "foreign-linux-rule",
        ruleId: "linux-rule",
        rawPath: linuxFile.rawPath,
        selectedRoot: false,
        authority: "inferred",
        outcome: "foreign-environment",
        enumeratedCompletely: false,
        warningCodes: [],
      },
    ];

    const result = mergeUserVariantSnapshots({
      local,
      remoteVariants: [variant],
      remoteFiles: [windowsFile, linuxFile],
      base: anchor([windowsFile, linuxFile]),
    });

    assert.deepEqual(result.files, [windowsFile, linuxFile]);
    assert.deepEqual(result.restoreEntryIds, [cloudSaveFileKey(windowsFile)]);
    assert.deepEqual(result.deleteRemoteEntryIds, []);
  });

  it("conflicts when a locally deleted file changed remotely", () => {
    const base = file("slot.sav", "a");
    const remote = file("slot.sav", "r");
    const retained = file("retained.sav", "b");
    const local = context([retained]);
    local.coverage = [
      {
        candidateId: "candidate",
        ruleId: "rule",
        variantId,
        rawPath: base.rawPath,
        selectedRoot: true,
        authority: "authoritative",
        outcome: "scanned",
        enumeratedCompletely: true,
        warningCodes: [],
      },
    ];

    const result = mergeUserVariantSnapshots({
      local,
      remoteVariants: [variant],
      remoteFiles: [remote, retained],
      base: anchor([base, retained]),
    });

    assert.deepEqual(result.conflicts, [
      { entryId: cloudSaveFileKey(remote), local: null, remote },
    ]);
  });

  it("resolves deletion conflicts using the selected side", () => {
    const base = file("slot.sav", "a");
    const remote = file("slot.sav", "r");
    const retained = file("retained.sav", "b");
    const local = context([retained]);
    local.coverage = [
      {
        candidateId: "candidate",
        ruleId: "rule",
        variantId,
        rawPath: base.rawPath,
        selectedRoot: true,
        authority: "authoritative",
        outcome: "scanned",
        enumeratedCompletely: true,
        warningCodes: [],
      },
    ];
    const entryId = cloudSaveFileKey(remote);
    const input = {
      local,
      remoteVariants: [variant],
      remoteFiles: [remote, retained],
      base: anchor([base, retained]),
    };

    const keepLocal = mergeUserVariantSnapshots({
      ...input,
      resolutions: new Map([[entryId, "keep-local"]]),
    });
    const keepRemote = mergeUserVariantSnapshots({
      ...input,
      resolutions: new Map([[entryId, "keep-remote"]]),
    });

    assert.deepEqual(keepLocal.deleteRemoteEntryIds, [entryId]);
    assert.deepEqual(keepLocal.restoreEntryIds, []);
    assert.deepEqual(keepRemote.deleteRemoteEntryIds, []);
    assert.deepEqual(keepRemote.restoreEntryIds, [entryId]);
  });

  it("applies a remote deletion to an unchanged local file", () => {
    const deleted = file("deleted.sav", "a");
    const retained = file("retained.sav", "b");
    const result = mergeUserVariantSnapshots({
      local: context([deleted, retained]),
      remoteVariants: [variant],
      remoteFiles: [retained],
      base: anchor([deleted, retained]),
    });

    assert.deepEqual(result.files, [retained]);
    assert.deepEqual(result.deleteLocalEntryIds, [cloudSaveFileKey(deleted)]);
  });

  it("treats files from an explicitly re-added custom path as new", () => {
    const rawPath = "<custom><windows><winDocuments>/Game";
    const retained = file("slot.sav", "a", rawPath);
    const result = mergeUserVariantSnapshots({
      local: {
        ...context([retained]),
        customPathRawPaths: [rawPath],
      },
      remoteVariants: [],
      remoteFiles: [],
      base: anchor([retained]),
      treatLocalAsNewRawPaths: new Set([rawPath]),
    });

    assert.deepEqual(result.files, [retained]);
    assert.deepEqual(result.deleteLocalEntryIds, []);
    assert.deepEqual(result.conflicts, []);
  });

  it("conflicts when a remotely deleted file changed locally", () => {
    const base = file("slot.sav", "a");
    const local = file("slot.sav", "l");
    const result = mergeUserVariantSnapshots({
      local: context([local]),
      remoteVariants: [],
      remoteFiles: [],
      base: anchor([base]),
    });

    assert.deepEqual(result.conflicts, [
      { entryId: cloudSaveFileKey(local), local, remote: null },
    ]);
  });

  it("keeps pre-launch restore-only when a local file was deleted", () => {
    const deleted = file("deleted.sav", "a");
    const retained = file("retained.sav", "b");
    const local = context([retained]);
    local.coverage = [
      {
        candidateId: "candidate",
        ruleId: "rule",
        variantId,
        rawPath: deleted.rawPath,
        selectedRoot: true,
        authority: "authoritative",
        outcome: "scanned",
        enumeratedCompletely: true,
        warningCodes: [],
      },
    ];

    const result = mergeUserVariantSnapshots({
      local,
      remoteVariants: [variant],
      remoteFiles: [deleted, retained],
      base: anchor([deleted, retained]),
      direction: "restore-only",
    });

    assert.deepEqual(result.deleteRemoteEntryIds, []);
    assert.deepEqual(result.restoreEntryIds, [cloudSaveFileKey(deleted)]);
  });

  it("conflicts only when both sides changed the same composite entry", () => {
    const base = file("slot.sav", "a");
    const local = file("slot.sav", "l");
    const remote = file("slot.sav", "r");
    const result = mergeUserVariantSnapshots({
      local: context([local]),
      remoteVariants: [variant],
      remoteFiles: [remote],
      base: anchor([base]),
    });

    assert.deepEqual(
      result.conflicts.map((item) => item.entryId),
      [cloudSaveFileKey(remote)]
    );
    assert.deepEqual(result.files, [remote]);
  });

  it("applies keep-local to the actual conflicting composite entry", () => {
    const base = file("slot.sav", "a");
    const local = file("slot.sav", "l");
    const remote = file("slot.sav", "r");
    const entryId = cloudSaveFileKey(remote);
    const result = mergeUserVariantSnapshots({
      local: context([local]),
      remoteVariants: [variant],
      remoteFiles: [remote],
      base: anchor([base]),
      resolutions: new Map([[entryId, "keep-local"]]),
    });

    assert.deepEqual(result.files, [local]);
    assert.equal(result.conflicts.length, 0);
  });
});
