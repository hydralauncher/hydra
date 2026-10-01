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

/** A live observation wins when another source reports the same unlock as historical. */
export const classifyResolvedEpicAchievementUnlocks = (
  resolved: UnlockedAchievement[],
  liveUnlocks: UnlockedAchievement[],
  definitions: SteamAchievement[]
) => {
  const liveNames = new Set(
    resolveEpicAchievementUnlocks(liveUnlocks, definitions).resolved.map(
      (achievement) => achievement.name.toUpperCase()
    )
  );

  return {
    historical: resolved.filter(
      (achievement) => !liveNames.has(achievement.name.toUpperCase())
    ),
    live: resolved.filter((achievement) =>
      liveNames.has(achievement.name.toUpperCase())
    ),
  };
};
