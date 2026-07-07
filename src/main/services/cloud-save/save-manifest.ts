import path from "node:path";

import type { GameShop } from "@types";

import { getHydraManifestIndex } from "./manifest/cache";
import { findManifestEntryForGame } from "./manifest/lookup";
import type {
  CloudSaveRule,
  GameSaveRules,
  HydraManifestFileRule,
} from "./manifest/types";

export const __saveManifestDependencies = {
  getHydraManifestIndex,
  findManifestEntryForGame,
};

const inferManifestRuleKind = (rawPath: string): CloudSaveRule["kind"] => {
  if (/[*?[{\]]/.test(rawPath)) return "file";

  if (rawPath.endsWith("/")) return "dir";

  const baseName = path.posix.basename(rawPath);
  return baseName.includes(".") ? "file" : "dir";
};

const mapManifestFileRuleToCloudSaveRule = (
  fileRule: HydraManifestFileRule
): CloudSaveRule => ({
  kind: inferManifestRuleKind(fileRule.rawPath),
  rawPath: fileRule.rawPath,
  source: "ludusavi",
  tags: fileRule.tags,
  when: fileRule.when,
});

export const getSaveRulesForGame = async (
  shop: GameShop,
  objectId: string
): Promise<GameSaveRules> => {
  const manifestIndex =
    await __saveManifestDependencies.getHydraManifestIndex();

  const manifestGameEntry =
    await __saveManifestDependencies.findManifestEntryForGame(
      manifestIndex,
      shop,
      objectId
    );

  if (!manifestGameEntry) {
    return {
      gameId: { shop, objectId },
      manifestKey: null,
      rules: [],
    };
  }

  return {
    gameId: { shop, objectId },
    manifestKey: manifestGameEntry.manifestKey,
    rules: manifestGameEntry.files.map(mapManifestFileRuleToCloudSaveRule),
  };
};
