import type {
  SteamAchievement,
  UnlockedAchievement,
  UserAchievement,
} from "@types";

export type CombinedAchievementDefinitionLookup = (
  shop: "steam" | "epic",
  objectId: string,
  name: string
) => Pick<SteamAchievement, "globalUnlockPercentage" | "set"> | undefined;

export interface CombinedAchievementVariant {
  shop: "steam" | "epic";
  objectId: string;
  name: string;
  displayName: string;
  description?: string;
  hidden: boolean;
  icon: string;
  icongray: string;
  points?: number;
  unlockTime: number | null;
  imageUrl: string | null;
}

export interface CombinedAchievements {
  canonicalId: string | null;
  achievements: Array<{
    canonicalAchievementId: string;
    variants: CombinedAchievementVariant[];
  }>;
}

// Presentation only: never copy another store's unlock into its sync/cache state.
export function presentCombinedAchievements(
  combined: CombinedAchievements,
  localUnlocks: (
    shop: "steam" | "epic",
    objectId: string
  ) => readonly UnlockedAchievement[],
  revealHidden: boolean,
  findDefinition: CombinedAchievementDefinitionLookup = () => undefined
): UserAchievement[] {
  return combined.achievements
    .flatMap(({ canonicalAchievementId, variants }) => {
      const states = variants.map((variant) => {
        const local = localUnlocks(variant.shop, variant.objectId).find(
          (unlock) => unlock.name.toUpperCase() === variant.name.toUpperCase()
        );
        return {
          ...variant,
          unlockTime: variant.unlockTime ?? local?.unlockTime ?? null,
        };
      });
      const unlocked = states.filter((row) => row.unlockTime !== null);
      const choices = unlocked.length ? unlocked : states;
      const selected =
        choices.find((row) => row.shop === "steam") ?? choices[0];
      if (!selected) return [];
      const definitions = [
        selected,
        ...states.filter((row) => row !== selected),
      ].map((row) => ({
        shop: row.shop,
        definition: findDefinition(row.shop, row.objectId, row.name),
      }));
      return [
        {
          ...selected,
          globalUnlockPercentage:
            definitions.find(
              ({ definition }) => definition?.globalUnlockPercentage != null
            )?.definition?.globalUnlockPercentage ?? null,
          set:
            definitions.find(
              ({ shop, definition }) => shop === "steam" && definition?.set
            )?.definition?.set ?? null,
          canonicalAchievementId,
          source: selected.shop,
          sourceObjectId: selected.objectId,
          unlocked: selected.unlockTime !== null,
          description:
            selected.unlockTime !== null || !selected.hidden || revealHidden
              ? selected.description
              : undefined,
          icongray: selected.icongray.endsWith("/")
            ? selected.icon
            : selected.icongray,
          sources: unlocked.map((row) => ({
            shop: row.shop,
            objectId: row.objectId,
            name: row.name,
            unlockTime: row.unlockTime!,
          })),
        },
      ];
    })
    .sort(
      (a, b) =>
        Number(b.unlocked) - Number(a.unlocked) ||
        (b.unlockTime ?? 0) - (a.unlockTime ?? 0) ||
        Number(a.hidden) - Number(b.hidden)
    );
}
