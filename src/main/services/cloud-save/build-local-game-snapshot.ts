import { createHash } from "node:crypto";

import { SystemPath } from "@main/services/system-path";
import { cloudSaveLocalHashCacheSublevel, levelKeys } from "@main/level";
import type {
  CloudSaveCustomPathBindings,
  CloudSaveStateMetadata,
  GameShop,
  LocalGameSnapshotContext,
  RestoreManifestFile,
} from "@types";

import { NativeAddon } from "../native-addon";
import { getCloudSaveGameContext } from "./cloud-save-game-context";
import { cloudSaveFileKey } from "./cloud-save-contract";
import { getUsableCloudSaveCustomPathBindings } from "./custom-path-overlap";
import { customPathToCloudSaveRule } from "./custom-path-store";
import {
  discoverEmulatorSaveFiles,
  getEmulatorGameSaveFileFilter,
  getEmulatorSaveProvider,
} from "./emulator-save-provider";
import { parseRpcs3SavestateRawPath } from "./emulator-provider-identity";
import { isEligibleEmulatorManualFile } from "./emulator-manual-file-eligibility.js";
import { buildCloudSaveAggregateHash } from "./snapshot-aggregate-hash";

interface BuildLocalGameSnapshotContextOptions {
  customPathBindings?: CloudSaveCustomPathBindings;
  remoteFiles?: RestoreManifestFile[];
  rpcs3SavedataTitleIds?: readonly string[];
}

export const buildLocalGameSnapshotContext = async (
  objectId: string,
  shop: GameShop,
  suppliedContext?: Awaited<ReturnType<typeof getCloudSaveGameContext>>,
  options: BuildLocalGameSnapshotContextOptions = {}
): Promise<LocalGameSnapshotContext> => {
  const context =
    suppliedContext ?? (await getCloudSaveGameContext(objectId, shop));
  const { game, pathContext, environmentId } = context;
  const cacheKey = levelKeys.game(shop, objectId);
  const [hashCache, customPathBindings] = await Promise.all([
    cloudSaveLocalHashCacheSublevel.get(cacheKey).then((value) => value ?? []),
    options.customPathBindings
      ? Promise.resolve(options.customPathBindings)
      : getUsableCloudSaveCustomPathBindings(objectId, shop, context),
  ]);
  const extraRules = customPathBindings.ready.map(customPathToCloudSaveRule);
  const customPathRawPaths = customPathBindings.ready
    .map(({ rawPath }) => rawPath)
    .sort((left, right) => left.localeCompare(right));
  const pipelineInput = {
    ...pathContext,
    environmentId,
    title: game?.title,
    remoteId: game?.remoteId ?? undefined,
    userDataPath: SystemPath.getPath("userData"),
    hashCache,
    extraRules,
  };
  let nativeSnapshot;
  const stateMetadataByFile = new Map<string, CloudSaveStateMetadata>();
  if (game && getEmulatorSaveProvider(game)) {
    const rpcs3SavedataTitleIds =
      getEmulatorSaveProvider(game) === "rpcs3"
        ? (options.rpcs3SavedataTitleIds ??
          (await (
            await import("./rpcs3-savedata-title-ids.js")
          ).getRpcs3SavedataTitleIds(game)))
        : undefined;
    const { variant, discovery } = await discoverEmulatorSaveFiles(
      game,
      environmentId,
      options.remoteFiles,
      rpcs3SavedataTitleIds
    );
    for (const file of discovery.files) {
      const stateMetadata =
        file.stateMetadata ??
        (parseRpcs3SavestateRawPath(file.rawPath)
          ? { emulatorId: "rpcs3" }
          : undefined);
      if (stateMetadata) {
        stateMetadataByFile.set(cloudSaveFileKey(file), stateMetadata);
      }
    }
    const customSnapshot = extraRules.length
      ? await NativeAddon.buildLocalGameSnapshotPipeline(pipelineInput).catch(
          () => null
        )
      : null;
    const unresolvedCustomCoverage =
      extraRules.length > 0 && !customSnapshot
        ? extraRules.map((rule) => ({
            candidateId: createHash("sha256")
              .update(rule.rawPath)
              .digest("hex"),
            ruleId: rule.ruleId,
            rawPath: rule.rawPath,
            selectedRoot: false,
            authority: "exact" as const,
            outcome: "partial" as const,
            enumeratedCompletely: false,
            warningCodes: ["custom-path-discovery-unavailable"],
          }))
        : [];
    const providerPaths = new Set(
      discovery.files.map((file) => file.absolutePath)
    );
    const isGameSaveFile = await getEmulatorGameSaveFileFilter(
      game,
      rpcs3SavedataTitleIds
    );
    const customFiles = (
      await Promise.all(
        (customSnapshot?.sourceFiles ?? []).map(async (file) => {
          if (!file.rawPath.startsWith("<custom>")) return null;
          if (providerPaths.has(file.absolutePath)) return null;
          const binding = customPathBindings.ready.find(
            ({ rawPath }) => rawPath === file.rawPath
          );
          if (!binding) return null;
          if (
            binding.kind === "file"
              ? !(await isEligibleEmulatorManualFile(
                  game,
                  file.absolutePath,
                  isGameSaveFile
                ))
              : !(await isGameSaveFile(file.absolutePath))
          ) {
            return null;
          }
          return file;
        })
      )
    )
      .filter((file): file is NonNullable<typeof file> => file !== null)
      .map(
        ({
          variantId,
          ruleId,
          rawPath,
          relativePath,
          absolutePath,
          localBindings,
          confidence,
          provenance,
        }) => ({
          variantId,
          ruleId,
          rawPath,
          relativePath,
          absolutePath,
          localBindings,
          confidence,
          provenance,
        })
      );
    const variants = new Map(
      [variant, ...(customSnapshot?.variants ?? [])].map((item) => [
        item.variantId,
        item,
      ])
    );
    nativeSnapshot = await NativeAddon.buildLocalGameSnapshot({
      gameId: { shop, objectId },
      ruleSourceRevision: discovery.revision,
      discoveryEngineVersion: 4,
      coverage: [
        ...discovery.coverage,
        ...unresolvedCustomCoverage,
        ...(customSnapshot?.coverage ?? []).filter((item) =>
          item.rawPath?.startsWith("<custom>")
        ),
      ],
      variants: [...variants.values()],
      files: [...discovery.files, ...customFiles],
      hashCache: customSnapshot?.hashCache ?? hashCache,
    });
  } else {
    nativeSnapshot =
      await NativeAddon.buildLocalGameSnapshotPipeline(pipelineInput);
  }
  const { hashCache: updatedHashCache, ...nativeResult } = nativeSnapshot;
  const files = nativeResult.files.map((file) => ({
    ...file,
    ...(stateMetadataByFile.has(cloudSaveFileKey(file))
      ? { stateMetadata: stateMetadataByFile.get(cloudSaveFileKey(file))! }
      : {}),
  }));
  const sourceFiles = nativeResult.sourceFiles.map((file) => ({
    ...file,
    ...(stateMetadataByFile.has(cloudSaveFileKey(file))
      ? { stateMetadata: stateMetadataByFile.get(cloudSaveFileKey(file))! }
      : {}),
  }));
  const snapshot = {
    ...nativeResult,
    files,
    sourceFiles,
    aggregateHash: buildCloudSaveAggregateHash({
      variants: nativeResult.variants,
      files,
    }),
  };

  if (updatedHashCache.length === 0) {
    await cloudSaveLocalHashCacheSublevel.del(cacheKey);
  } else {
    await cloudSaveLocalHashCacheSublevel.put(cacheKey, updatedHashCache);
  }

  return { ...snapshot, environmentId, pathContext, customPathRawPaths };
};
