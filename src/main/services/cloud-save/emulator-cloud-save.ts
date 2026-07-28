import { createHash } from "node:crypto";
import path from "node:path";
import { promises as fs } from "node:fs";

import { platformToSystem } from "@main/helpers";
import {
  db,
  levelKeys,
  ps1MemoryCardSavesSublevel,
  ps2MemoryCardSavesSublevel,
} from "@main/level";
import * as emulators from "@main/services/emulators";
import { emulatorSessions } from "@main/services/emulators";
import { SystemPath } from "@main/services/system-path";
import type {
  EmulationSavePlatform,
  EmulatorCloudSaveCard,
  EmulatorLocalSaveCopy,
  Game,
  GameShop,
  LocalGameSnapshotContext,
  LocalGameSnapshotSourceFile,
  SnapshotFile,
  SnapshotVariant,
  User,
  RestoreManifestFile,
} from "@types";

import { NativeAddon } from "../native-addon";
import {
  canonicalizeMemoryCardPath,
  getEmulatorCloudSaveCardPreferences,
  removeEmulatorCloudSaveCardPreferences,
  setEmulatorCloudSaveCardPreferences,
} from "./emulator-card-store";
import {
  decodeEmulatorSaveIdentity,
  emulatorCloudSaveRawPath,
  encodeEmulatorSaveIdentity,
  isEmulatorCloudSaveRawPath,
} from "./emulator-cloud-save-codec";
import { selectEmulatorSaveCopies } from "./emulator-cloud-save-selection";
const DISCOVERY_ENGINE_VERSION = 2;
const RULE_SOURCE_REVISION = "emulator-v1";

const cardLocks = new Map<string, Promise<void>>();

export const withMemoryCardLock = async <T>(
  cardFilePath: string,
  operation: () => Promise<T>
) => {
  const key =
    process.platform === "win32" ? cardFilePath.toLowerCase() : cardFilePath;
  const previous = cardLocks.get(key) ?? Promise.resolve();
  const current = previous.catch(() => undefined).then(operation);
  const tail = current.then(
    () => undefined,
    () => undefined
  );
  cardLocks.set(key, tail);
  try {
    return await current;
  } finally {
    if (cardLocks.get(key) === tail) cardLocks.delete(key);
  }
};

export const getEmulatorCloudSavePlatform = (
  game: Game | undefined,
  shop: GameShop
): EmulationSavePlatform | null => {
  if (!game || shop !== "launchbox") return null;
  const system = platformToSystem(game.platform);
  return system === "ps1" || system === "ps2" ? system : null;
};

const buildDefaultVariant = (
  shop: GameShop,
  objectId: string
): SnapshotVariant => ({
  variantId: createHash("sha256")
    .update(
      JSON.stringify({
        variantIdVersion: 1,
        shop,
        objectId,
        kind: "default",
      })
    )
    .digest("hex"),
  kind: "default",
});

const currentUserId = async () => {
  const user = await db.get<string, User>(levelKeys.user, {
    valueEncoding: "json",
  });
  if (!user?.id) throw new Error("Emulator cloud saves require a user");
  return user.id;
};

const getCacheDirectory = async (
  shop: GameShop,
  objectId: string,
  platform: EmulationSavePlatform
) => {
  const digest = createHash("sha256")
    .update(JSON.stringify([await currentUserId(), shop, objectId, platform]))
    .digest("hex");
  return path.join(
    SystemPath.getPath("userData"),
    "cloud-save-v2",
    "emulator",
    digest
  );
};

const materializeArtifact = async (
  cacheDirectory: string,
  relativePath: string,
  hash: string,
  buffer: Buffer
) => {
  await fs.mkdir(cacheDirectory, { recursive: true });
  const filePath = path.join(cacheDirectory, `${hash}-${relativePath}`);
  const existing = await fs.stat(filePath).catch(() => null);
  if (existing?.isFile() && existing.size === buffer.length) {
    const current = await fs.readFile(filePath).catch(() => null);
    if (current?.equals(buffer)) return filePath;
  }

  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  await fs.writeFile(temporaryPath, buffer);
  await fs.rename(temporaryPath, filePath).catch(async (error) => {
    await fs.unlink(temporaryPath).catch(() => undefined);
    const current = await fs.readFile(filePath).catch(() => null);
    if (!current?.equals(buffer)) throw error;
  });
  return filePath;
};

const removeObsoleteCacheFiles = async (
  cacheDirectory: string,
  activePaths: Set<string>
) => {
  const entries = await fs
    .readdir(cacheDirectory, {
      withFileTypes: true,
    })
    .catch(() => []);
  await Promise.all(
    entries
      .filter(
        (entry) =>
          entry.isFile() &&
          !entry.name.endsWith(".tmp") &&
          !activePaths.has(path.join(cacheDirectory, entry.name))
      )
      .map((entry) =>
        fs.unlink(path.join(cacheDirectory, entry.name)).catch(() => undefined)
      )
  );
};

const normalizeCardPath = async (cardFilePath: string) =>
  canonicalizeMemoryCardPath(cardFilePath).catch(() => null);

const cardPathKey = (cardFilePath: string) => {
  const resolved = path.resolve(cardFilePath);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
};

const getStoredRecords = async (platform: EmulationSavePlatform) =>
  platform === "ps1"
    ? ps1MemoryCardSavesSublevel.values().all()
    : ps2MemoryCardSavesSublevel.values().all();

const getKnownCardPaths = async (
  platform: EmulationSavePlatform,
  preferences: Record<string, string>
) => {
  const config = await emulators.getEmulatorConfig(platform);
  const [detected, records] = await Promise.all([
    platform === "ps1"
      ? emulators.resolvePs1MemcardFiles(config.executablePath)
      : emulators.resolvePs2MemcardFiles(config.executablePath),
    getStoredRecords(platform),
  ]);
  const paths = new Set([
    ...detected,
    ...records.map((record) => record.cardFilePath),
    ...Object.values(preferences),
  ]);
  const canonical = await Promise.all([...paths].map(normalizeCardPath));
  return [
    ...new Set(canonical.filter((value): value is string => !!value)),
  ].sort((left, right) => left.localeCompare(right));
};

export const assertEmulatorCloudSaveAvailable = async (
  platform: EmulationSavePlatform
) => {
  if (
    [...emulatorSessions.values()].some(
      (session) => session.system === platform
    )
  ) {
    throw new Error("cloud_save_emulator_in_use");
  }
  const config = await emulators.getEmulatorConfig(platform);
  if (!config.executablePath) {
    throw new Error("cloud_save_executable_missing");
  }
  await fs.access(config.executablePath).catch(() => {
    throw new Error("cloud_save_executable_missing");
  });

  const executableName = path.basename(config.executablePath).toLowerCase();
  const binaryName = config.binary.toLowerCase();
  const running = (await NativeAddon.listProcesses()).some((process) => {
    const processName = process.name.toLowerCase();
    const processExecutable = process.exe
      ? path.basename(process.exe).toLowerCase()
      : "";
    return (
      processExecutable === executableName ||
      processName === executableName ||
      processName.includes(binaryName)
    );
  });
  if (running) throw new Error("cloud_save_emulator_in_use");
  return config;
};

interface BuiltCopy {
  candidate: EmulatorLocalSaveCopy;
  buffer: Buffer;
  lastModifiedAt: string;
}

const inspectCard = async (
  platform: EmulationSavePlatform,
  cardFilePath: string,
  gameSkus: Set<string>,
  fallbackObjectId: string,
  fallbackRecords: Awaited<ReturnType<typeof getStoredRecords>>
): Promise<BuiltCopy[]> =>
  withMemoryCardLock(cardFilePath, async () => {
    const format =
      platform === "ps1"
        ? await emulators.inspectPs1Card(cardFilePath)
        : await emulators.inspectPs2Card(cardFilePath);
    if (format !== "formatted") {
      throw new Error("cloud_save_emulator_card_invalid");
    }
    const stat = await fs.stat(cardFilePath);
    const info =
      platform === "ps1"
        ? await emulators.listPs1Saves(cardFilePath)
        : await emulators.listSaves(cardFilePath);
    if (!info) return [];

    const saves = info.saves;
    const result: BuiltCopy[] = [];
    for (const save of saves) {
      const saveIdentity =
        platform === "ps1" && "identifier" in save
          ? save.identifier
          : "folderName" in save
            ? save.folderName
            : "";
      const normalizedSku = save.sku ? emulators.normalizeSku(save.sku) : null;
      const fallbackRecord = fallbackRecords.find(
        (record) =>
          cardPathKey(record.cardFilePath) === cardPathKey(cardFilePath) &&
          record.folderName === saveIdentity
      );
      const belongsToGame =
        gameSkus.size > 0
          ? normalizedSku !== null && gameSkus.has(normalizedSku)
          : fallbackRecord?.objectId === fallbackObjectId;
      if (!belongsToGame) continue;

      const contents =
        platform === "ps1"
          ? await emulators.readPs1SaveContents(cardFilePath, saveIdentity)
          : await emulators.readSaveContents(cardFilePath, saveIdentity);
      if (!contents) continue;
      const buffer =
        platform === "ps1"
          ? emulators.buildMcsBuffer(
              contents as Parameters<typeof emulators.buildMcsBuffer>[0]
            )
          : emulators.buildPsuBuffer(
              contents as Parameters<typeof emulators.buildPsuBuffer>[0]
            );
      const hash = createHash("sha256").update(buffer).digest("hex");
      const modifiedAt =
        platform === "ps2" && "modifiedSecs" in save && save.modifiedSecs > 0
          ? new Date(save.modifiedSecs * 1000).toISOString()
          : stat.mtime.toISOString();
      result.push({
        buffer,
        lastModifiedAt: modifiedAt,
        candidate: {
          saveIdentity,
          cardFilePath,
          cardLabel: path.basename(cardFilePath),
          hash,
          sizeBytes: buffer.length,
          fileCount:
            platform === "ps1" && "blockCount" in save
              ? save.blockCount
              : "fileCount" in save
                ? save.fileCount
                : 0,
          modifiedAt: platform === "ps2" ? modifiedAt : null,
        },
      });
    }
    return result;
  });

export const buildEmulatorLocalGameSnapshot = async (
  game: Game,
  environmentId: string,
  pathContext: LocalGameSnapshotContext["pathContext"]
): Promise<LocalGameSnapshotContext> => {
  const platform = getEmulatorCloudSavePlatform(game, game.shop);
  if (!platform) throw new Error("cloud_save_emulator_unsupported");
  await assertEmulatorCloudSaveAvailable(platform);

  const preferences = await getEmulatorCloudSaveCardPreferences(
    game.shop,
    game.objectId,
    platform
  );
  const [cardPaths, fallbackRecords] = await Promise.all([
    getKnownCardPaths(platform, preferences),
    getStoredRecords(platform),
  ]);
  const gameSkus = new Set(
    (game.discs ?? [])
      .map((disc) => disc.sku)
      .filter((sku): sku is string => !!sku)
      .map(emulators.normalizeSku)
  );
  const inspectedCards = await Promise.all(
    cardPaths.map(async (cardFilePath) => {
      const cardCopies = await inspectCard(
        platform,
        cardFilePath,
        gameSkus,
        game.objectId,
        fallbackRecords
      ).catch(() => null);
      return cardCopies ? { cardFilePath, copies: cardCopies } : null;
    })
  );
  const readableCards = inspectedCards.filter(
    (
      inspected
    ): inspected is {
      cardFilePath: string;
      copies: BuiltCopy[];
    } => inspected !== null
  );
  const copies = readableCards.flatMap(({ copies }) => copies);
  const { selected, selections } = selectEmulatorSaveCopies(
    copies,
    preferences,
    new Set(readableCards.map(({ cardFilePath }) => cardFilePath))
  );
  const variant = buildDefaultVariant(game.shop, game.objectId);
  const rawPath = emulatorCloudSaveRawPath(platform);
  const cacheDirectory = await getCacheDirectory(
    game.shop,
    game.objectId,
    platform
  );
  const activeCachePaths = new Set<string>();
  const files: SnapshotFile[] = [];
  const sourceFiles: LocalGameSnapshotSourceFile[] = [];

  for (const copy of selected) {
    const relativePath = encodeEmulatorSaveIdentity(
      copy.candidate.saveIdentity,
      platform
    );
    const absolutePath = await materializeArtifact(
      cacheDirectory,
      relativePath,
      copy.candidate.hash,
      copy.buffer
    );
    activeCachePaths.add(absolutePath);
    const file: SnapshotFile = {
      variantId: variant.variantId,
      rawPath,
      relativePath,
      hash: copy.candidate.hash,
      sizeBytes: copy.candidate.sizeBytes,
      lastModifiedAt: copy.lastModifiedAt,
    };
    files.push(file);
    sourceFiles.push({
      ...file,
      ruleId: createHash("sha256").update(rawPath).digest("hex"),
      absolutePath,
      localBindings: {
        environmentId,
        rootId: createHash("sha256")
          .update(copy.candidate.cardFilePath)
          .digest("hex"),
        concreteUserSegment: "__emulator__",
        concretePath: copy.candidate.cardFilePath,
      },
      confidence: "authoritative",
      provenance: ["emulator-v1", platform],
    });
  }
  await removeObsoleteCacheFiles(cacheDirectory, activeCachePaths);
  files.sort((left, right) =>
    left.relativePath.localeCompare(right.relativePath)
  );
  sourceFiles.sort((left, right) =>
    left.relativePath.localeCompare(right.relativePath)
  );
  const variants = files.length > 0 ? [variant] : [];
  const cards: EmulatorCloudSaveCard[] = readableCards.map(
    ({ cardFilePath }) => ({
      cardFilePath,
      cardLabel: path.basename(cardFilePath),
    })
  );
  const totalSizeBytes = files.reduce(
    (total, file) => total + file.sizeBytes,
    0
  );

  return {
    gameId: { shop: game.shop, objectId: game.objectId },
    manifestKey: null,
    ruleSourceRevision: RULE_SOURCE_REVISION,
    discoveryEngineVersion: DISCOVERY_ENGINE_VERSION,
    coverage: [
      {
        candidateId: `emulator-${platform}`,
        ruleId: createHash("sha256").update(rawPath).digest("hex"),
        variantId: variant.variantId,
        rawPath,
        selectedRoot: true,
        authority: "authoritative",
        outcome: "scanned",
        enumeratedCompletely: true,
        warningCodes: [],
      },
    ],
    variants,
    fileCount: files.length,
    totalSizeBytes,
    files,
    aggregateHash: NativeAddon.buildSnapshotAggregateHash({
      variants,
      files,
    }),
    sourceFiles,
    environmentId,
    pathContext,
    emulator: {
      platform,
      cards,
      copies: copies.map(({ candidate }) => candidate),
      selections,
      preferredCardPaths: preferences,
    },
  };
};

export const getEmulatorCloudSaveSelections = (
  context: LocalGameSnapshotContext,
  remoteFiles: RestoreManifestFile[],
  restoreEntryIds: string[]
) => {
  if (!context.emulator) return [];
  const selections = [...context.emulator.selections];
  const selectedLocalIdentities = new Set(
    context.files
      .filter((file) => isEmulatorCloudSaveRawPath(file.rawPath))
      .map((file) =>
        decodeEmulatorSaveIdentity(
          file.relativePath,
          context.emulator!.platform
        )
      )
  );
  const selectionIdentities = new Set(
    selections.flatMap(({ saveIdentities }) => saveIdentities)
  );
  const remoteByEntryId = new Map(
    remoteFiles.map((file) => [
      JSON.stringify([file.variantId, file.rawPath, file.relativePath]),
      file,
    ])
  );
  const missingTargets: string[] = [];
  for (const entryId of restoreEntryIds) {
    const file = remoteByEntryId.get(entryId);
    if (!file || !isEmulatorCloudSaveRawPath(file.rawPath)) continue;
    const saveIdentity = decodeEmulatorSaveIdentity(
      file.relativePath,
      context.emulator.platform
    );
    if (
      selectionIdentities.has(saveIdentity) ||
      context.emulator.preferredCardPaths[saveIdentity]
    ) {
      continue;
    }
    const copies = context.emulator.copies.filter(
      (copy) => copy.saveIdentity === saveIdentity
    );
    if (selectedLocalIdentities.has(saveIdentity) && copies.length === 1) {
      continue;
    }
    if (copies.length > 1) {
      selections.push({
        reason: "restore-target",
        saveIdentities: [saveIdentity],
        candidates: copies,
      });
      selectionIdentities.add(saveIdentity);
      continue;
    }
    missingTargets.push(saveIdentity);
  }
  if (missingTargets.length > 0) {
    selections.push({
      reason: "restore-target",
      saveIdentities: [...new Set(missingTargets)].sort(),
      candidates: context.emulator.cards,
    });
  }
  return selections;
};

export const getEmulatorCloudSaveEnvironmentFingerprint = async (
  game: Game,
  platform: EmulationSavePlatform
) => {
  const config = await emulators.getEmulatorConfig(platform);
  const preferences = await getEmulatorCloudSaveCardPreferences(
    game.shop,
    game.objectId,
    platform
  );
  return createHash("sha256")
    .update(
      JSON.stringify({
        version: 1,
        platform,
        executablePath: config.executablePath,
        preferences: Object.entries(preferences).sort(),
      })
    )
    .digest("hex");
};

export const selectEmulatorCloudSaveCard = async (
  input: import("@types").SetEmulatorCloudSaveCardInput
) => {
  const game = await import("@main/level").then(({ gamesSublevel }) =>
    gamesSublevel
      .get(levelKeys.game(input.shop, input.objectId))
      .catch(() => undefined)
  );
  const platform = getEmulatorCloudSavePlatform(game, input.shop);
  if (!game || !platform || platform !== input.platform) {
    throw new Error("cloud_save_emulator_unsupported");
  }
  await assertEmulatorCloudSaveAvailable(platform);
  const cardFilePath = await canonicalizeMemoryCardPath(input.cardFilePath);
  await withMemoryCardLock(cardFilePath, async () => {
    const format =
      platform === "ps1"
        ? await emulators.inspectPs1Card(cardFilePath)
        : await emulators.inspectPs2Card(cardFilePath);
    if (format !== "formatted") {
      throw new Error("cloud_save_emulator_card_invalid");
    }
    if (input.requireExistingSave) {
      const info =
        platform === "ps1"
          ? await emulators.listPs1Saves(cardFilePath)
          : await emulators.listSaves(cardFilePath);
      const identities = new Set(
        info?.saves.map((save) =>
          platform === "ps1" && "identifier" in save
            ? save.identifier
            : "folderName" in save
              ? save.folderName
              : ""
        ) ?? []
      );
      if (
        input.saveIdentities.some(
          (saveIdentity) => !identities.has(saveIdentity)
        )
      ) {
        throw new Error("cloud_save_emulator_save_not_found_in_card");
      }
    }
  });
  return setEmulatorCloudSaveCardPreferences({
    ...input,
    cardFilePath,
  });
};

export interface EmulatorCloudSaveLaunchBaseline {
  platform: EmulationSavePlatform;
  copies: Array<{
    saveIdentity: string;
    cardFilePath: string;
    hash: string;
    sizeBytes: number;
  }>;
  selectedCardPaths: Record<string, string>;
}

export const createEmulatorCloudSaveLaunchBaseline = (
  context: LocalGameSnapshotContext
): EmulatorCloudSaveLaunchBaseline | undefined => {
  if (!context.emulator) return undefined;
  const selectedCardPaths: Record<string, string> = {};
  for (const source of context.sourceFiles) {
    if (!isEmulatorCloudSaveRawPath(source.rawPath)) continue;
    selectedCardPaths[
      decodeEmulatorSaveIdentity(source.relativePath, context.emulator.platform)
    ] = source.localBindings.concretePath;
  }
  return {
    platform: context.emulator.platform,
    copies: context.emulator.copies.map(
      ({ saveIdentity, cardFilePath, hash, sizeBytes }) => ({
        saveIdentity,
        cardFilePath,
        hash,
        sizeBytes,
      })
    ),
    selectedCardPaths,
  };
};

export const invalidateChangedUnselectedEmulatorCopies = async (
  shop: GameShop,
  objectId: string,
  context: LocalGameSnapshotContext,
  baseline: EmulatorCloudSaveLaunchBaseline
) => {
  if (!context.emulator || context.emulator.platform !== baseline.platform) {
    return [];
  }
  const before = new Map(
    baseline.copies.map((copy) => [
      JSON.stringify([copy.saveIdentity, copy.cardFilePath]),
      copy,
    ])
  );
  const changedUnselected = new Set<string>();
  for (const copy of context.emulator.copies) {
    const selectedPath = baseline.selectedCardPaths[copy.saveIdentity];
    const previous = before.get(
      JSON.stringify([copy.saveIdentity, copy.cardFilePath])
    );
    const changed =
      !previous ||
      previous.hash !== copy.hash ||
      previous.sizeBytes !== copy.sizeBytes;
    if (changed && selectedPath && copy.cardFilePath !== selectedPath) {
      changedUnselected.add(copy.saveIdentity);
    }
  }
  if (changedUnselected.size > 0) {
    await removeEmulatorCloudSaveCardPreferences(
      shop,
      objectId,
      baseline.platform,
      [...changedUnselected]
    );
  }
  return [...changedUnselected].sort();
};
