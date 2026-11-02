import type { ComparedAchievements, SteamAchievement } from "@types";

type ComparedAchievement = ComparedAchievements["achievements"][number];

type Definition = Pick<
  SteamAchievement,
  "icon" | "displayName" | "globalUnlockPercentage" | "set"
>;

const findDefinition = (
  achievement: ComparedAchievement,
  definitionsByIcon: Map<string, Definition[]>
) => {
  const candidates = definitionsByIcon.get(achievement.icon) ?? [];
  if (candidates.length === 1) return candidates[0];

  return candidates.find(
    (definition) => definition.displayName === achievement.displayName
  );
};

export const withComparedAchievementDefinitions = <
  T extends Pick<ComparedAchievements, "achievements">,
>(
  compared: T,
  definitions: readonly Definition[]
): T => {
  const definitionsByIcon = new Map<string, Definition[]>();
  for (const definition of definitions) {
    const group = definitionsByIcon.get(definition.icon) ?? [];
    group.push(definition);
    definitionsByIcon.set(definition.icon, group);
  }

  return {
    ...compared,
    achievements: compared.achievements.map((achievement) => {
      const definition = findDefinition(achievement, definitionsByIcon);

      return {
        ...achievement,
        globalUnlockPercentage:
          achievement.globalUnlockPercentage ??
          definition?.globalUnlockPercentage ??
          null,
        set: achievement.set ?? definition?.set ?? null,
      };
    }),
  };
};
