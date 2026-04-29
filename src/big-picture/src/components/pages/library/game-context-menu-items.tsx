import type { LibraryGame, ShopAssets } from "@types";
import {
  BookmarkSimpleIcon,
  DownloadSimpleIcon,
  EyeIcon,
  ExportIcon,
  GearIcon,
  HeartIcon,
  PlayIcon,
  TrashIcon,
  TrophyIcon,
  XCircleIcon,
} from "@phosphor-icons/react";
import type { TFunction } from "i18next";

import type { ContextMenuItem } from "../../common";

export interface LibraryGameContextMenuHandlers {
  onLaunchOrDownload: (game: LibraryGame) => void | Promise<void>;
  onOpenGamePage: (game: LibraryGame) => void;
  onToggleFavorite: (game: LibraryGame) => void | Promise<void>;
  onViewAchievements: (game: LibraryGame) => void;
  onShare: (game: LibraryGame) => void;
  onOptions: (game: LibraryGame) => void;
  onUninstall: (game: LibraryGame) => void;
  onRemoveFromLibrary: (game: LibraryGame) => void;
}

export function buildLibraryGameContextMenuItems(
  t: TFunction<["library"]>,
  game: LibraryGame,
  handlers: LibraryGameContextMenuHandlers,
  isFavoriteLoading: boolean
): ContextMenuItem[] {
  const {
    onLaunchOrDownload,
    onOpenGamePage,
    onToggleFavorite,
    onViewAchievements,
    onShare,
    onOptions,
    onUninstall,
    onRemoveFromLibrary,
  } = handlers;

  const nextItems: ContextMenuItem[] = [
    {
      id: "launch-or-download",
      label: game.executablePath
        ? t("context_menu_launch_game")
        : t("context_menu_download_game"),
      icon: game.executablePath ? (
        <PlayIcon size={18} weight="fill" />
      ) : (
        <DownloadSimpleIcon size={18} />
      ),
      onSelect: () => onLaunchOrDownload(game),
    },
    {
      id: "open-game-page",
      label: t("context_menu_open_game_page"),
      icon: <EyeIcon size={18} />,
      restoreFocusOnClose: false,
      onSelect: () => onOpenGamePage(game),
    },
    {
      id: "favorite",
      label: game.favorite
        ? t("context_menu_remove_from_favorites")
        : t("context_menu_mark_as_favorite"),
      icon: <HeartIcon size={18} weight={game.favorite ? "fill" : "regular"} />,
      disabled: isFavoriteLoading,
      onSelect: () => onToggleFavorite(game),
    },
    {
      id: "view-achievements",
      label: t("context_menu_view_achievements"),
      icon: <TrophyIcon size={18} />,
      onSelect: () => onViewAchievements(game),
    },
    {
      id: "share",
      label: t("context_menu_share"),
      icon: <ExportIcon size={18} />,
      onSelect: () => onShare(game),
    },
    {
      id: "options",
      label: t("context_menu_options"),
      icon: <GearIcon size={18} />,
      onSelect: () => onOptions(game),
    },
  ];

  if (game.download?.downloadPath) {
    nextItems.push({
      id: "uninstall",
      label: t("context_menu_uninstall"),
      icon: <TrashIcon size={18} />,
      danger: true,
      restoreFocusOnClose: false,
      onSelect: () => onUninstall(game),
    });
  }

  nextItems.push({
    id: "remove-from-library",
    label: t("context_menu_remove_from_library"),
    icon: <XCircleIcon size={18} />,
    danger: true,
    restoreFocusOnClose: false,
    onSelect: () => onRemoveFromLibrary(game),
  });

  return nextItems;
}

export interface BuildCatalogGameContextMenuItemsArgs {
  canAddToLibrary: boolean;
  isAddingToLibrary: boolean;
  onAddToLibrary: () => void | Promise<void>;
  onViewAchievements: () => void;
  onShare: () => void;
  onOpenGamePage: () => void;
}

export function buildCatalogGameContextMenuItems(
  t: TFunction<["library"]>,
  _catalogGame: ShopAssets,
  args: BuildCatalogGameContextMenuItemsArgs
): ContextMenuItem[] {
  const {
    canAddToLibrary,
    isAddingToLibrary,
    onAddToLibrary,
    onViewAchievements,
    onShare,
    onOpenGamePage,
  } = args;

  const nextItems: ContextMenuItem[] = [];

  if (canAddToLibrary) {
    nextItems.push({
      id: "add-to-library",
      label: t("context_menu_add_to_library"),
      icon: <BookmarkSimpleIcon aria-hidden size={18} weight="regular" />,
      disabled: isAddingToLibrary,
      restoreFocusOnClose: false,
      onSelect: onAddToLibrary,
    });
  }

  nextItems.push(
    {
      id: "details",
      label: t("context_menu_open_game_page"),
      icon: <EyeIcon aria-hidden size={18} weight="regular" />,
      restoreFocusOnClose: false,
      onSelect: onOpenGamePage,
    },
    {
      id: "view-achievements",
      label: t("context_menu_view_achievements"),
      icon: <TrophyIcon aria-hidden size={18} />,
      onSelect: onViewAchievements,
    },
    {
      id: "share",
      label: t("context_menu_share"),
      icon: <ExportIcon aria-hidden size={18} />,
      onSelect: onShare,
    }
  );

  return nextItems;
}
