import type {
  CloudSaveSyncAnchor,
  Game,
  RestoreManifestFile,
  RestoreManifestResponse,
  SnapshotFile,
} from "@types";

import { cloudSaveFileKey } from "./cloud-save-contract.js";
import {
  parseRetroArchGameRawPath,
  parseRetroArchSaveRawPath,
  retroArchGameRawPath,
  retroArchStateRelativePath,
} from "./emulator-provider-identity.js";
import { legacyRetroArchStateId } from "./retroarch-state-binding-policy.js";

type FileIdentity = Pick<
  SnapshotFile,
  "variantId" | "rawPath" | "relativePath"
>;

export const isRetroArchBatteryRelativePath = (relativePath: string) =>
  /^battery\.(?:srm|rtc|eep|sra|fla|mpk|sav)$/.test(relativePath) ||
  relativePath === "transfer-pak.sav";

export const isRetroArchArchivedBattery = (file: FileIdentity) =>
  Boolean(parseRetroArchGameRawPath(file.rawPath)) &&
  /^archive\/battery\/[A-F0-9]{8}\.(?:srm|rtc|eep|sra|fla|mpk|sav|transfer-pak\.sav)$/.test(
    file.relativePath
  );

const archivedBatteryIdentity = <T extends FileIdentity>(file: T): T => {
  const parsed = parseRetroArchSaveRawPath(file.rawPath);
  if (!parsed) return file;
  return {
    ...file,
    rawPath: retroArchGameRawPath(parsed.platform),
    relativePath: `archive/battery/${parsed.romHash}${file.relativePath === "transfer-pak.sav" ? ".transfer-pak.sav" : file.relativePath.slice("battery".length)}`,
  };
};

export const migratedRetroArchIdentity = <T extends FileIdentity>(
  game: Game,
  file: T
): T => {
  const parsed = parseRetroArchSaveRawPath(file.rawPath);
  if (!parsed) return file;
  const state = /^state\.state(?:\d+|\.auto)?(\.png)?$/.exec(file.relativePath);
  if (state) {
    const id = legacyRetroArchStateId(game, {
      rawPath: file.rawPath,
      relativePath: file.relativePath.replace(/\.png$/, ""),
    });
    return {
      ...file,
      rawPath: retroArchGameRawPath(parsed.platform),
      relativePath: retroArchStateRelativePath(id, Boolean(state[1])),
    };
  }
  return {
    ...file,
    rawPath: retroArchGameRawPath(parsed.platform),
  };
};

const dedupeFiles = <T extends SnapshotFile>(files: T[]) => {
  const byKey = new Map<string, T>();
  const conflicts: Array<{ left: T; right: T }> = [];
  for (const file of files) {
    const key = cloudSaveFileKey(file);
    const known = byKey.get(key);
    if (!known) {
      byKey.set(key, file);
    } else if (known.hash !== file.hash || known.sizeBytes !== file.sizeBytes) {
      if (!file.relativePath.endsWith(".png")) {
        conflicts.push({ left: known, right: file });
      }
    }
  }
  return { files: [...byKey.values()], conflicts };
};

export const migrateRetroArchManifest = (
  game: Game,
  manifest: RestoreManifestResponse,
  selectedLegacyBatteryRawPath?: string
) => {
  const selectedBattery =
    selectedLegacyBatteryRawPath &&
    manifest.files.some(
      (file) =>
        file.rawPath === selectedLegacyBatteryRawPath &&
        isRetroArchBatteryRelativePath(file.relativePath)
    )
      ? selectedLegacyBatteryRawPath
      : undefined;
  const stateIdByHash = new Map<string, string>();
  const stateIdByLegacyKey = new Map<string, string>();
  for (const file of [...manifest.files].sort((left, right) =>
    cloudSaveFileKey(left).localeCompare(cloudSaveFileKey(right))
  )) {
    if (
      !parseRetroArchSaveRawPath(file.rawPath) ||
      !/^state\.state(?:\d+|\.auto)?$/.test(file.relativePath)
    )
      continue;
    const id =
      stateIdByHash.get(file.hash) ?? legacyRetroArchStateId(game, file);
    stateIdByHash.set(file.hash, id);
    stateIdByLegacyKey.set(cloudSaveFileKey(file), id);
  }
  const migrated = manifest.files.map((file) => {
    if (
      selectedBattery &&
      file.rawPath !== selectedBattery &&
      parseRetroArchSaveRawPath(file.rawPath) &&
      isRetroArchBatteryRelativePath(file.relativePath)
    ) {
      return archivedBatteryIdentity(file);
    }
    const migratedFile = migratedRetroArchIdentity(game, file);
    if (
      !parseRetroArchSaveRawPath(file.rawPath) ||
      !/^state\.state(?:\d+|\.auto)?(?:\.png)?$/.test(file.relativePath)
    )
      return migratedFile;
    const stateKey = cloudSaveFileKey({
      ...file,
      relativePath: file.relativePath.replace(/\.png$/, ""),
    });
    const id = stateIdByLegacyKey.get(stateKey);
    return id
      ? {
          ...migratedFile,
          relativePath: retroArchStateRelativePath(
            id,
            file.relativePath.endsWith(".png")
          ),
        }
      : migratedFile;
  });
  const result = dedupeFiles(migrated);
  const sourceByMigratedFile = new Map(
    migrated.map((file, index) => [file, manifest.files[index]] as const)
  );
  const sourceFilesByEntryId = new Map(
    result.files.map(
      (file) =>
        [cloudSaveFileKey(file), sourceByMigratedFile.get(file)!] as const
    )
  );
  return {
    manifest: { ...manifest, files: result.files as RestoreManifestFile[] },
    sourceFilesByEntryId,
    conflicts: result.conflicts,
    stateIdByLegacyKey,
    selectedBatteryRawPath: selectedBattery,
    changed: migrated.some(
      (file, index) =>
        file.rawPath !== manifest.files[index].rawPath ||
        file.relativePath !== manifest.files[index].relativePath
    ),
  };
};

export const assertRetroArchRestoreSelectionUnchanged = (
  expected: ReturnType<typeof migrateRetroArchManifest>,
  current: ReturnType<typeof migrateRetroArchManifest>
) => {
  if (
    current.conflicts.length > 0 ||
    expected.selectedBatteryRawPath !== current.selectedBatteryRawPath
  ) {
    throw new Error("cloud_save_restore_destination_changed");
  }
};

export const migrateRetroArchAnchor = (
  game: Game,
  anchor: CloudSaveSyncAnchor | null,
  environmentId: string,
  selectedLegacyBatteryRawPath?: string,
  stateIdByLegacyKey: ReadonlyMap<string, string> = new Map()
): CloudSaveSyncAnchor | null => {
  if (!anchor) return null;
  const migrateEntry = <T extends FileIdentity>(entry: T): T => {
    if (
      selectedLegacyBatteryRawPath &&
      entry.rawPath !== selectedLegacyBatteryRawPath &&
      parseRetroArchSaveRawPath(entry.rawPath) &&
      isRetroArchBatteryRelativePath(entry.relativePath)
    ) {
      return archivedBatteryIdentity(entry);
    }
    const migrated = migratedRetroArchIdentity(game, entry);
    if (
      !parseRetroArchSaveRawPath(entry.rawPath) ||
      !/^state\.state(?:\d+|\.auto)?(?:\.png)?$/.test(entry.relativePath)
    ) {
      return migrated;
    }
    const stateKey = cloudSaveFileKey({
      ...entry,
      relativePath: entry.relativePath.replace(/\.png$/, ""),
    });
    const id = stateIdByLegacyKey.get(stateKey);
    return id
      ? {
          ...migrated,
          relativePath: retroArchStateRelativePath(
            id,
            entry.relativePath.endsWith(".png")
          ),
        }
      : migrated;
  };
  const entries = anchor.entries.map(migrateEntry);
  const byKey = new Map(
    entries.map((entry) => [cloudSaveFileKey(entry), entry])
  );
  return {
    ...anchor,
    environmentId,
    entries: [...byKey.values()],
    unresolvedRemoteEntryIds: anchor.unresolvedRemoteEntryIds.map((entryId) => {
      try {
        const [variantId, rawPath, relativePath] = JSON.parse(entryId);
        return cloudSaveFileKey(
          migrateEntry({
            variantId,
            rawPath,
            relativePath,
          })
        );
      } catch {
        return entryId;
      }
    }),
  };
};
