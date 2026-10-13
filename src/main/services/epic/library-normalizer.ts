import type { EpicSnapshotGame } from "../../../types/epic-integration.types";
import { EpicIntegrationError, isRecord } from "./auth-protocol.js";
import {
  EPIC_MAX_ARTIFACTS,
  EPIC_ID_MAX_LENGTH,
  EPIC_GAME_NAME_MAX_LENGTH,
  EPIC_MAX_PLAYTIME_SECONDS,
  EPIC_SNAPSHOT_MAX_GAMES,
} from "./constants.js";

// The bundled Legendary explicitly recognizes launchable add-ons.
// Do not guess tool/demo category names absent from verified metadata.
const excludedCategories = new Set(["addons", "addons/launchable"]);
const compareEpicStrings = (left: string, right: string): number => {
  const comparison = left.localeCompare(right, "en");
  if (comparison !== 0 || left === right) return comparison;
  // Distinct Unicode representations can compare equally under collation.
  return left < right ? -1 : 1;
};
const validId = (value: unknown, max = EPIC_ID_MAX_LENGTH): value is string =>
  typeof value === "string" &&
  value.length > 0 &&
  value.length <= max &&
  !Array.from(value).some(
    (character) =>
      character.charCodeAt(0) < 32 ||
      (character.charCodeAt(0) >= 127 && character.charCodeAt(0) <= 159)
  );
export const isEpicObjectId = (value: unknown): value is string =>
  validId(value) &&
  value.split(":").length === 2 &&
  value.split(":").every((part) => validId(part));

export function classifyEpicItem(
  metadata: unknown
): "include" | "exclude" | "unknown" {
  if (!isRecord(metadata)) return "unknown";
  if (
    metadata.namespace === "ue" ||
    Object.hasOwn(metadata, "mainGameItem") ||
    (Array.isArray(metadata.mainGameItemList) &&
      metadata.mainGameItemList.length > 0)
  )
    return "exclude";
  if (!Array.isArray(metadata.categories)) return "unknown";
  const categories = metadata.categories.map((row) =>
    isRecord(row) ? row.path : undefined
  );
  if (categories.some((value) => typeof value !== "string" || !value))
    return "unknown";
  const playable = categories.includes("games");
  if (categories.some((value) => excludedCategories.has(value as string)))
    return playable ? "unknown" : "exclude";
  // Additional unproven category paths must not override contradictory metadata.
  if (
    categories.some(
      (value) => !["games", "applications", "public"].includes(value as string)
    )
  )
    return "unknown";
  return playable ? "include" : "unknown";
}

export function normalizeEpicLibrary(platforms: unknown[]): EpicSnapshotGame[] {
  const games = new Map<string, EpicSnapshotGame>();
  const artifacts = new Map<string, string>();
  for (const platform of platforms) {
    if (!Array.isArray(platform))
      throw new EpicIntegrationError("snapshot-invalid");
    for (const entry of platform) {
      if (!isRecord(entry)) throw new EpicIntegrationError("snapshot-invalid");
      const classification = classifyEpicItem(entry.metadata);
      if (classification === "exclude") continue;
      if (classification === "unknown" || !isRecord(entry.metadata))
        throw new EpicIntegrationError("snapshot-invalid");
      const { namespace, id } = entry.metadata;
      const artifact = entry.app_name;
      const objectId = `${namespace}:${id}`;
      if (
        !validId(namespace) ||
        namespace.includes(":") ||
        !validId(id) ||
        id.includes(":") ||
        !isEpicObjectId(objectId) ||
        !validId(artifact)
      )
        throw new EpicIntegrationError("snapshot-invalid");
      if (isRecord(entry.asset_infos)) {
        for (const asset of Object.values(entry.asset_infos)) {
          if (
            !isRecord(asset) ||
            (asset.app_name !== undefined && asset.app_name !== artifact) ||
            (asset.namespace !== undefined && asset.namespace !== namespace) ||
            (asset.catalog_item_id !== undefined &&
              asset.catalog_item_id !== id)
          )
            throw new EpicIntegrationError("snapshot-invalid");
        }
      }
      const previous = artifacts.get(artifact);
      if (previous && previous !== objectId)
        throw new EpicIntegrationError("snapshot-invalid");
      artifacts.set(artifact, objectId);
      const name =
        typeof entry.app_title === "string" ? entry.app_title.trim() : "";
      if (!validId(name, EPIC_GAME_NAME_MAX_LENGTH))
        throw new EpicIntegrationError("snapshot-invalid");
      const existing = games.get(objectId);
      if (existing) {
        existing.artifactIds = [
          ...new Set([...existing.artifactIds, artifact]),
        ].sort(compareEpicStrings);
        if (existing.artifactIds.length > EPIC_MAX_ARTIFACTS)
          throw new EpicIntegrationError("snapshot-invalid");
        // Stable across command order and platforms, without using titles as identity.
        existing.name = [existing.name, name].sort(compareEpicStrings)[0];
      } else
        games.set(objectId, {
          namespace,
          catalogItemId: id,
          artifactIds: [artifact],
          name,
          playTimeInSeconds: 0,
        });
    }
  }
  if (games.size > EPIC_SNAPSHOT_MAX_GAMES)
    throw new EpicIntegrationError("snapshot-too-large");
  return [...games.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([, game]) => game);
}

export function normalizeEpicPlaytime(
  input: unknown,
  accountId: string
): Map<string, number> {
  if (!Array.isArray(input)) throw new EpicIntegrationError("invalid-response");
  const times = new Map<string, number>();
  for (const row of input) {
    if (
      !isRecord(row) ||
      row.accountId !== accountId ||
      !validId(row.artifactId) ||
      typeof row.totalTime !== "number" ||
      !Number.isInteger(row.totalTime) ||
      row.totalTime < 0 ||
      row.totalTime > EPIC_MAX_PLAYTIME_SECONDS
    )
      throw new EpicIntegrationError("invalid-response");
    times.set(
      row.artifactId,
      Math.max(times.get(row.artifactId) ?? 0, row.totalTime)
    );
  }
  return times;
}

export function getEpicGamePlaytime(
  artifactIds: string[],
  times: Map<string, number>
): number | null {
  const values = artifactIds.flatMap((id) =>
    times.has(id) ? [times.get(id)!] : []
  );
  return values.length ? Math.max(...values) : null;
}

export function applyEpicPlaytime(
  games: EpicSnapshotGame[],
  times: Map<string, number>
): EpicSnapshotGame[] {
  return games.map((game) => ({
    ...game,
    playTimeInSeconds: getEpicGamePlaytime(game.artifactIds, times) ?? 0,
  }));
}
