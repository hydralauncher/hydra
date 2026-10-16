import type { EpicSnapshotGame } from "../../../types/epic-integration.types";
import { EpicIntegrationError, isRecord } from "./auth-protocol.js";
import {
  EPIC_MAX_ARTIFACTS,
  EPIC_ID_MAX_LENGTH,
  EPIC_GAME_NAME_MAX_LENGTH,
  EPIC_MAX_PLAYTIME_SECONDS,
  EPIC_SNAPSHOT_MAX_GAMES,
} from "./constants.js";

// Legendary's list can contain applications as well as games.
const excludedCategories = new Set([
  "addons",
  "addons/launchable",
  "mods",
  "software",
]);
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
  if (!Array.isArray(metadata.categories) || !metadata.categories.length)
    return "unknown";
  const categories = metadata.categories.map((row) =>
    isRecord(row) ? row.path : undefined
  );
  if (categories.some((value) => typeof value !== "string" || !value))
    return "unknown";
  if (categories.some((value) => excludedCategories.has(value as string)))
    return "exclude";
  // Extra store labels do not invalidate an explicitly classified game.
  return categories.includes("games") ? "include" : "exclude";
}

export interface EpicLibraryDiagnostic {
  reason: string;
  platformIndex: number;
  entryIndex?: number;
  artifactId?: string;
  name?: string;
  namespace?: string;
  catalogItemId?: string;
}

export function normalizeEpicLibrary(
  platforms: unknown[],
  reportInvalid?: (diagnostic: EpicLibraryDiagnostic) => void
): EpicSnapshotGame[] {
  function invalid(
    reason: string,
    platformIndex: number,
    entryIndex?: number,
    entry?: unknown
  ): never {
    const text = (value: unknown, max = EPIC_ID_MAX_LENGTH) =>
      typeof value === "string"
        ? Array.from(value.slice(0, max))
            .filter((character) => {
              const code = character.charCodeAt(0);
              return code >= 32 && (code < 127 || code > 159);
            })
            .join("")
        : undefined;
    const row = isRecord(entry) ? entry : {};
    const metadata = isRecord(row.metadata) ? row.metadata : {};
    reportInvalid?.({
      reason,
      platformIndex,
      entryIndex,
      artifactId: text(row.app_name),
      name: text(row.app_title, EPIC_GAME_NAME_MAX_LENGTH),
      namespace: text(metadata.namespace),
      catalogItemId: text(metadata.id),
    });
    throw new EpicIntegrationError("snapshot-invalid");
  }
  const games = new Map<string, EpicSnapshotGame>();
  const artifacts = new Map<string, string>();
  for (const [platformIndex, platform] of platforms.entries()) {
    if (!Array.isArray(platform)) invalid("platform-not-array", platformIndex);
    for (const [entryIndex, entry] of platform.entries()) {
      if (!isRecord(entry))
        invalid("item-not-object", platformIndex, entryIndex);
      const classification = classifyEpicItem(entry.metadata);
      if (classification === "exclude") continue;
      if (classification === "unknown" || !isRecord(entry.metadata))
        invalid("classification-incomplete", platformIndex, entryIndex, entry);
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
        invalid("item-identity-invalid", platformIndex, entryIndex, entry);
      if (isRecord(entry.asset_infos)) {
        for (const asset of Object.values(entry.asset_infos)) {
          if (
            !isRecord(asset) ||
            (asset.app_name !== undefined && asset.app_name !== artifact) ||
            (asset.namespace !== undefined && asset.namespace !== namespace) ||
            (asset.catalog_item_id !== undefined &&
              asset.catalog_item_id !== id)
          )
            invalid(
              "asset-identity-mismatch",
              platformIndex,
              entryIndex,
              entry
            );
        }
      }
      const previous = artifacts.get(artifact);
      if (previous && previous !== objectId)
        invalid("artifact-identity-conflict", platformIndex, entryIndex, entry);
      artifacts.set(artifact, objectId);
      const name =
        typeof entry.app_title === "string" ? entry.app_title.trim() : "";
      if (!validId(name, EPIC_GAME_NAME_MAX_LENGTH))
        invalid("title-invalid", platformIndex, entryIndex, entry);
      const existing = games.get(objectId);
      if (existing) {
        existing.artifactIds = [
          ...new Set([...existing.artifactIds, artifact]),
        ].sort(compareEpicStrings);
        if (existing.artifactIds.length > EPIC_MAX_ARTIFACTS)
          invalid("artifact-limit-exceeded", platformIndex, entryIndex, entry);
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
