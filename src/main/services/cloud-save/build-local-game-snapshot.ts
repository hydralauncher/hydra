import { createHash } from "node:crypto";

import { SystemPath } from "@main/services/system-path";
import { cloudSaveLocalHashCacheSublevel, levelKeys } from "@main/level";
import type {
  CloudSaveCustomPathBindings,
  GameShop,
  LocalGameSnapshotContext,
} from "@types";

import { NativeAddon } from "../native-addon";
import { getCloudSaveGameContext } from "./cloud-save-game-context";
import { getUsableCloudSaveCustomPathBindings } from "./custom-path-overlap";
import { customPathToCloudSaveRule } from "./custom-path-store";
import {
  discoverEmulatorSaveFiles,
  getEmulatorSaveProvider,
} from "./emulator-save-provider";

interface BuildLocalGameSnapshotContextOptions {
  customPathBindings?: CloudSaveCustomPathBindings;
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
  if (game && getEmulatorSaveProvider(game)) {
    const { variant, discovery } = await discoverEmulatorSaveFiles(
      game,
      environmentId
    );
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
    const customFiles = (customSnapshot?.sourceFiles ?? [])
      .filter(
        (file) =>
          file.rawPath.startsWith("<custom>") &&
          !providerPaths.has(file.absolutePath)
      )
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
  const { hashCache: updatedHashCache, ...snapshot } = nativeSnapshot;

  if (updatedHashCache.length === 0) {
    await cloudSaveLocalHashCacheSublevel.del(cacheKey);
  } else {
    await cloudSaveLocalHashCacheSublevel.put(cacheKey, updatedHashCache);
  }

  return { ...snapshot, environmentId, pathContext, customPathRawPaths };
};
