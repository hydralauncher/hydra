import type { LibraryGame } from "@types";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";

import { ContextMenu } from "../../common";
import { buildLibraryGameContextMenuItems } from "./game-context-menu-items";

interface LibraryGameContextMenuProps {
  game: LibraryGame | null;
  visible: boolean;
  position: { x: number; y: number };
  restoreFocusId?: string | null;
  isFavoriteLoading?: boolean;
  onClose: () => void;
  onLaunchOrDownload: (game: LibraryGame) => Promise<void> | void;
  onOpenGamePage: (game: LibraryGame) => void;
  onToggleFavorite: (game: LibraryGame) => Promise<void> | void;
  onViewAchievements: (game: LibraryGame) => void;
  onShare: (game: LibraryGame) => void;
  onOptions: (game: LibraryGame) => void;
  onUninstall: (game: LibraryGame) => void;
  onRemoveFromLibrary: (game: LibraryGame) => void;
}

export function LibraryGameContextMenu({
  game,
  visible,
  position,
  restoreFocusId = null,
  isFavoriteLoading = false,
  onClose,
  onLaunchOrDownload,
  onOpenGamePage,
  onToggleFavorite,
  onViewAchievements,
  onShare,
  onOptions,
  onUninstall,
  onRemoveFromLibrary,
}: Readonly<LibraryGameContextMenuProps>) {
  const { t } = useTranslation("library");

  const items = useMemo(() => {
    if (!game) return [];

    return buildLibraryGameContextMenuItems(
      t,
      game,
      {
        onLaunchOrDownload,
        onOpenGamePage,
        onToggleFavorite,
        onViewAchievements,
        onShare,
        onOptions,
        onUninstall,
        onRemoveFromLibrary,
      },
      isFavoriteLoading
    );
  }, [
    game,
    isFavoriteLoading,
    onLaunchOrDownload,
    onOpenGamePage,
    onOptions,
    onRemoveFromLibrary,
    onShare,
    onToggleFavorite,
    onUninstall,
    onViewAchievements,
    t,
  ]);

  if (!game) {
    return null;
  }

  return (
    <ContextMenu
      ariaLabel={t("context_menu_accessible_label")}
      items={items}
      visible={visible}
      position={position}
      onClose={onClose}
      restoreFocusId={restoreFocusId}
    />
  );
}
