import type { SteamAchievement, UnlockedAchievement } from "@types";

const ALAN_WAKE_2_ID_PREFIX = "ACH_";

/**
 * Local files only know Epic's raw achievement id. The same id can exist in
 * several achievement sets, and local files carry no set id, so an id shared
 * by more than one definition is left unresolved.
 */
const getNamesByExternalId = (definitions: SteamAchievement[]) => {
  const namesByExternalId = new Map<string, string | null>();

  for (const definition of definitions) {
    if (!definition.externalId || !definition.externalSetId) continue;

    namesByExternalId.set(
      definition.externalId,
      namesByExternalId.has(definition.externalId) ? null : definition.name
    );
  }

  return namesByExternalId;
};

// Alan Wake 2 records only carry their position, which Epic may expose
// either as "38" or as "ACH_38".
const getExternalIdCandidates = (externalId: string) =>
  /^\d+$/.test(externalId)
    ? [externalId, `${ALAN_WAKE_2_ID_PREFIX}${externalId}`]
    : [externalId];

export const resolveEpicAchievementNames = (
  unlocks: UnlockedAchievement[],
  definitions: SteamAchievement[]
) => {
  const namesByExternalId = getNamesByExternalId(definitions);
  const resolved: UnlockedAchievement[] = [];
  const unresolved: UnlockedAchievement[] = [];

  for (const unlock of unlocks) {
    const names = getExternalIdCandidates(unlock.name)
      .map((externalId) => namesByExternalId.get(externalId))
      .filter((name) => name !== undefined);

    const [name] = names;
    if (names.length !== 1 || !name) {
      unresolved.push(unlock);
      continue;
    }

    resolved.push({ ...unlock, name });
  }

  return { resolved, unresolved };
};
