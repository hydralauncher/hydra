import type { LibraryGame, ShopAssets } from "@types";
import {
  BookmarkSimpleIcon,
  DownloadSimpleIcon,
  ExportIcon,
  GearIcon,
  HeartIcon,
  PlayIcon,
  TrashIcon,
  TrophyIcon,
  XCircleIcon,
} from "@phosphor-icons/react";

import type { ContextMenuItem } from "../../common";
import { isLibraryGamePlayable } from "./library-data";

export interface LibraryGameContextMenuHandlers {
  onLaunchOrDownload: (game: LibraryGame) => void | Promise<void>;
  onToggleFavorite: (game: LibraryGame) => void | Promise<void>;
  onViewAchievements?: (game: LibraryGame) => void;
  onShare?: (game: LibraryGame) => void;
  onOptions?: (game: LibraryGame) => void;
  onUninstall?: (game: LibraryGame) => void;
  onRemoveFromLibrary?: (game: LibraryGame) => void;
}

export function buildLibraryGameContextMenuItems(
  game: LibraryGame,
  handlers: LibraryGameContextMenuHandlers,
  isFavoriteLoading: boolean,
  t?: (key: string) => string
): ContextMenuItem[] {
  const {
    onLaunchOrDownload,
    onToggleFavorite,
    onViewAchievements,
    onShare,
    onOptions,
    onUninstall,
    onRemoveFromLibrary,
  } = handlers;
  const isPlayable = isLibraryGamePlayable(game);

  const nextItems: ContextMenuItem[] = [
    {
      id: "launch-or-download",
      label: isPlayable ? "Launch Game" : "Download Game",
      icon: isPlayable ? (
        <PlayIcon size={18} weight="fill" />
      ) : (
        <DownloadSimpleIcon size={18} />
      ),
      onSelect: () => onLaunchOrDownload(game),
    },
    {
      id: "favorite",
      label: game.favorite ? "Remove from Favorites" : "Mark as Favorite",
      icon: <HeartIcon size={18} weight={game.favorite ? "fill" : "regular"} />,
      disabled: isFavoriteLoading,
      onSelect: () => onToggleFavorite(game),
    },
  ];

  if ((game.achievementCount ?? 0) > 0 && onViewAchievements) {
    nextItems.push({
      id: "view-achievements",
      label: "View Achievements",
      icon: <TrophyIcon size={18} />,
      restoreFocusOnClose: false,
      onSelect: () => onViewAchievements(game),
    });
  }

  if (onShare) {
    nextItems.push({
      id: "share",
      label: "Share",
      icon: <ExportIcon size={18} />,
      onSelect: () => onShare(game),
    });
  }

  if (onOptions) {
    nextItems.push({
      id: "options",
      label: t ? t("game_options") : "Game Options",
      icon: <GearIcon size={18} />,
      onSelect: () => onOptions(game),
    });
  }

  if (onUninstall && game.download?.downloadPath) {
    nextItems.push({
      id: "uninstall",
      label: "Uninstall",
      icon: <TrashIcon size={18} />,
      danger: true,
      restoreFocusOnClose: false,
      onSelect: () => onUninstall(game),
    });
  }

  if (onRemoveFromLibrary) {
    nextItems.push({
      id: "remove-from-library",
      label: "Remove from Library",
      icon: <XCircleIcon size={18} />,
      danger: true,
      restoreFocusOnClose: false,
      onSelect: () => onRemoveFromLibrary(game),
    });
  }

  return nextItems;
}

export interface BuildCatalogGameContextMenuItemsArgs {
  canAddToLibrary: boolean;
  isAddingToLibrary: boolean;
  onOpenDownloadOptions: () => void;
  onAddToLibrary: () => void | Promise<void>;
  onViewAchievements: () => void;
  onShare: () => void;
}

export function buildCatalogGameContextMenuItems(
  _catalogGame: ShopAssets,
  args: BuildCatalogGameContextMenuItemsArgs
): ContextMenuItem[] {
  const {
    canAddToLibrary,
    isAddingToLibrary,
    onOpenDownloadOptions,
    onAddToLibrary,
    onViewAchievements,
    onShare,
  } = args;

  const nextItems: ContextMenuItem[] = [];

  if (canAddToLibrary) {
    nextItems.push({
      id: "download-options",
      label: "Download Options",
      icon: <DownloadSimpleIcon aria-hidden size={18} weight="regular" />,
      restoreFocusOnClose: false,
      onSelect: onOpenDownloadOptions,
    });

    nextItems.push({
      id: "add-to-library",
      label: "Add to Library",
      icon: <BookmarkSimpleIcon aria-hidden size={18} weight="regular" />,
      disabled: isAddingToLibrary,
      restoreFocusOnClose: false,
      onSelect: onAddToLibrary,
    });
  }

  const hasAchievements =
    ((_catalogGame as { achievementCount?: number | null }).achievementCount ??
      0) > 0;

  if (hasAchievements) {
    nextItems.push({
      id: "view-achievements",
      label: "View Achievements",
      icon: <TrophyIcon aria-hidden size={18} />,
      restoreFocusOnClose: false,
      onSelect: onViewAchievements,
    });
  }

  nextItems.push({
    id: "share",
    label: "Share",
    icon: <ExportIcon aria-hidden size={18} />,
    onSelect: onShare,
  });

  return nextItems;
}
