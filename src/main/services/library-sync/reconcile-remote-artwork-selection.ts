import type { ArtworkAssetType, Game, GameArtworkSelection } from "@types";

type CustomAssetField =
  | "customIconUrl"
  | "customLogoImageUrl"
  | "customHeroImageUrl"
  | "customCoverImageUrl";

export type CustomArtworkUrls = Partial<Pick<Game, CustomAssetField>>;

export const CUSTOM_ASSET_FIELD_BY_TYPE: Record<
  ArtworkAssetType,
  CustomAssetField
> = {
  icon: "customIconUrl",
  logo: "customLogoImageUrl",
  hero: "customHeroImageUrl",
  grid: "customCoverImageUrl",
};

const CUSTOM_ASSET_TYPES = Object.fromEntries(
  Object.entries(CUSTOM_ASSET_FIELD_BY_TYPE).map(([type, field]) => [
    field,
    type,
  ])
) as Record<CustomAssetField, ArtworkAssetType>;

export const reconcileRemoteArtworkSelection = (
  current: GameArtworkSelection["selected"],
  localAssets: CustomArtworkUrls,
  remoteAssets: CustomArtworkUrls
): {
  selected: GameArtworkSelection["selected"];
  changed: boolean;
} => {
  const selected = { ...current };
  let changed = false;

  for (const [field, type] of Object.entries(CUSTOM_ASSET_TYPES) as Array<
    [CustomAssetField, ArtworkAssetType]
  >) {
    const remoteValue = remoteAssets[field];
    const localValue = localAssets[field];

    if (remoteValue === undefined || localValue?.startsWith("local:")) {
      continue;
    }

    const selection = selected[type];
    if (!selection || selection.url === remoteValue) {
      continue;
    }

    if (!selection.syncedAt) {
      continue;
    }

    delete selected[type];
    changed = true;
  }

  return { selected, changed };
};
