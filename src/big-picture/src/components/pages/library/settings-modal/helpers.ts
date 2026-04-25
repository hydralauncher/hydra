import type { LibraryGame } from "@types";
import { GameSettingsCloudSyncState } from "./use-game-settings-cloud-sync";
import type {
  GameSettingsAssetType,
  GameSettingsCategoryId,
} from "./use-game-settings-controller";

export const GAME_SETTINGS_ASSET_TYPES = [
  "icon",
  "logo",
  "hero",
] satisfies GameSettingsAssetType[];

export function categoryLabel(categoryId: GameSettingsCategoryId) {
  switch (categoryId) {
    case "general":
      return "General";
    case "assets":
      return "Assets";
    case "hydra_cloud":
      return "Hydra Cloud";
    case "compatibility":
      return "Compatibility";
    case "downloads":
      return "Downloads";
    case "danger_zone":
      return "Danger Zone";
  }
}

export function assetLabel(assetType: GameSettingsAssetType) {
  if (assetType === "icon") return "Icon";
  if (assetType === "logo") return "Logo";

  return "Hero";
}

export function formatDateTime(value: string | Date) {
  return new Date(value).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export function formatBackupStateLabel(
  state: GameSettingsCloudSyncState,
  loadingPreview: boolean,
  uploadingBackup: boolean,
  restoringBackup: boolean,
  progress: number
) {
  if (uploadingBackup) return "Uploading backup...";
  if (restoringBackup) return `Restoring backup ${Math.round(progress * 100)}%`;
  if (loadingPreview) return "Loading save preview...";
  if (state === GameSettingsCloudSyncState.New) return "New save files found";
  if (state === GameSettingsCloudSyncState.Different)
    return "Save files changed";
  if (state === GameSettingsCloudSyncState.Same) return "Save files are synced";

  return "No backup preview";
}

export function getGameAssetUrl(
  game: LibraryGame,
  assetType: GameSettingsAssetType
) {
  if (assetType === "icon") return game.customIconUrl ?? game.iconUrl ?? null;
  if (assetType === "logo")
    return game.customLogoImageUrl ?? game.logoImageUrl ?? null;

  return game.customHeroImageUrl ?? game.libraryHeroImageUrl ?? null;
}

export function getGameSidebarCoverUrl(game: LibraryGame) {
  return (
    game.customHeroImageUrl ??
    game.libraryHeroImageUrl ??
    game.libraryImageUrl ??
    game.coverImageUrl ??
    game.customIconUrl ??
    game.iconUrl ??
    null
  );
}

export function getGameOriginalAssetPath(
  game: LibraryGame,
  assetType: GameSettingsAssetType
) {
  if (game.shop === "custom") {
    if (assetType === "icon") return game.originalIconPath ?? game.iconUrl;
    if (assetType === "logo") return game.originalLogoPath ?? game.logoImageUrl;

    return game.originalHeroPath ?? game.libraryHeroImageUrl;
  }

  if (assetType === "icon")
    return game.customOriginalIconPath ?? game.customIconUrl ?? game.iconUrl;

  if (assetType === "logo") {
    return (
      game.customOriginalLogoPath ??
      game.customLogoImageUrl ??
      game.logoImageUrl
    );
  }

  return (
    game.customOriginalHeroPath ??
    game.customHeroImageUrl ??
    game.libraryHeroImageUrl
  );
}
