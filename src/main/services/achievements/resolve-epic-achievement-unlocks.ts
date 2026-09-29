import type { SteamAchievement, UnlockedAchievement } from "@types";

/** Provider IDs can repeat in different achievement sets. Local files have no set ID. */
export const resolveEpicAchievementUnlocks = (
  unlocks: UnlockedAchievement[],
  definitions: SteamAchievement[]
) => {
  const namesByExternalId = new Map<string, string | null>();

  for (const definition of definitions) {
    if (!definition.externalId || !definition.externalSetId) continue;

    const previousName = namesByExternalId.get(definition.externalId);
    namesByExternalId.set(
      definition.externalId,
      previousName === undefined ? definition.name : null
    );
  }

  const resolved: UnlockedAchievement[] = [];
  const unresolvedExternalIds: string[] = [];

  for (const unlock of unlocks) {
    const name = namesByExternalId.get(unlock.name);
    if (!name) {
      unresolvedExternalIds.push(unlock.name);
      continue;
    }
    resolved.push({ ...unlock, name });
  }

  return {
    resolved,
    unresolvedCount: unresolvedExternalIds.length,
    unresolvedExternalIds,
  };
};
