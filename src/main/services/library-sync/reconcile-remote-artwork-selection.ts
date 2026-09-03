import type { ArtworkAssetType, Game, GameArtworkSelection } from "@types";

type CustomAssetField =
  | "customIconUrl"
  | "customLogoImageUrl"
  | "customHeroImageUrl"
  | "customCoverImageUrl";

export type CustomArtworkUrls = Partial<Pick<Game, CustomAssetField>>;

const CUSTOM_ASSET_TYPES: Record<CustomAssetField, ArtworkAssetType> = {
  customIconUrl: "icon",
  customLogoImageUrl: "logo",
  customHeroImageUrl: "hero",
  customCoverImageUrl: "grid",
};

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

    if (selected[type] && selected[type]?.url !== remoteValue) {
      delete selected[type];
      changed = true;
    }
  }

  return { selected, changed };
};
