import { useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import type { LibraryGame } from "@types";
import {
  applyLibraryGroupAction,
  findLibraryGamePresentation,
  getRemoveFilesTarget,
  isLibraryGameDownloading,
  type RemoveFilesTarget,
} from "@shared";
import { Button, VerticalFocusGroup } from "../../../common";
import { ConfirmationModal } from "../../../modals";
import { SettingsSection } from "../../../../pages/settings/settings-section";
import { useBigPictureToast } from "../../../../hooks/use-big-picture-toast.hook";

import "./danger-zone-tab.scss";

function getConfirmationConfig(
  pendingAction: DangerAction,
  game: LibraryGame,
  pendingRemoveFilesTarget: RemoveFilesTarget | null,
  t: (key: string, options?: Record<string, unknown>) => string,
  handleRemoveFromLibrary: () => Promise<void>,
  handleResetAchievements: () => Promise<void>,
  handleRemoveFiles: () => Promise<void>
) {
  switch (pendingAction) {
    case "remove-from-library":
      return {
        title: t("remove_from_library"),
        description: t("remove_from_library_description", { game: game.title }),
        confirmLabel: t("remove_from_library"),
        onConfirm: handleRemoveFromLibrary,
      };
    case "reset-achievements":
      return {
        title: t("reset_achievements"),
        description: t(
          game.shop === "steam"
            ? "reset_achievements_steam_description"
            : "reset_achievements_souvenirs_description",
          { game: game.title }
        ),
        confirmLabel: t("reset_achievements"),
        onConfirm: handleResetAchievements,
      };
    case "remove-files":
      if (pendingRemoveFilesTarget?.kind === "steam") {
        return {
          title: t("remove_game_files_steam_title"),
          description: t("remove_game_files_steam_description", {
            game: pendingRemoveFilesTarget.game.title,
          }),
          confirmLabel: t("remove_game_files_steam_confirm"),
          onConfirm: handleRemoveFiles,
        };
      }
      return {
        title: t("remove_game_files"),
        description: t("remove_game_files_description", {
          game: pendingRemoveFilesTarget?.game.title ?? game.title,
        }),
        confirmLabel: t("remove_game_files"),
        onConfirm: handleRemoveFiles,
      };
  }
}

export const GAME_DANGER_ZONE_PRIMARY_CONTROL_ID =
  "game-danger-zone-primary-control";

interface GameDangerZoneSettingsTabProps {
  game: LibraryGame;
  removeFilesGame?: LibraryGame;
  onClose: () => void;
}

type DangerAction =
  | "remove-from-library"
  | "reset-achievements"
  | "remove-files";

export function GameDangerZoneSettingsTab({
  game,
  removeFilesGame,
  onClose,
}: Readonly<GameDangerZoneSettingsTabProps>) {
  const { t } = useTranslation("big_picture");
  const { showSuccessToast, showErrorToast } = useBigPictureToast();
  const [pendingAction, setPendingAction] = useState<DangerAction | null>(null);
  const [pendingRemoveFilesTarget, setPendingRemoveFilesTarget] =
    useState<RemoveFilesTarget | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  const steamUninstallAvailable =
    typeof globalThis.window.electron.uninstallGameOnSteam === "function";
  const removeFilesTarget = getRemoveFilesTarget(
    removeFilesGame ?? game,
    steamUninstallAvailable
  );
  const isGameDownloading =
    removeFilesTarget?.kind === "hydra" &&
    isLibraryGameDownloading(removeFilesTarget.game);
  const removeFilesSectionTitle =
    removeFilesTarget?.kind === "steam"
      ? t("remove_game_files_steam_title")
      : t("remove_game_files");
  const removeFilesSectionDescription =
    removeFilesTarget?.kind === "steam"
      ? t("remove_game_files_steam_description", {
          game: removeFilesTarget.game.title,
        })
      : t("remove_game_files_description", {
          game: removeFilesTarget?.game.title ?? game.title,
        });

  const clearPendingAction = useCallback(() => {
    setPendingAction(null);
    setPendingRemoveFilesTarget(null);
  }, []);

  const handleRemoveFromLibrary = useCallback(async () => {
    setActionLoading(true);
    try {
      const library = await globalThis.window.electron.getLibrary(true);
      const members = findLibraryGamePresentation(library, game)?.members ?? [
        game,
      ];
      await applyLibraryGroupAction(members, async (member) => {
        if (member.download)
          await globalThis.window.electron.cancelGameDownload(
            member.shop,
            member.objectId
          );
        await globalThis.window.electron.removeGameFromLibrary(
          member.shop,
          member.objectId
        );
      });
      showSuccessToast("Game removed from library");
      clearPendingAction();
      onClose();
    } catch {
      showErrorToast("Failed to remove from library");
    } finally {
      globalThis.window.dispatchEvent(new Event("library-update"));
      setActionLoading(false);
    }
  }, [game, onClose, showSuccessToast, showErrorToast, clearPendingAction]);

  const handleResetAchievements = useCallback(async () => {
    setActionLoading(true);
    try {
      await globalThis.window.electron.resetGameAchievements(
        game.shop,
        game.objectId
      );
      showSuccessToast("Achievements reset");
      clearPendingAction();
    } catch {
      showErrorToast("Failed to reset achievements");
    } finally {
      setActionLoading(false);
    }
  }, [game, showSuccessToast, showErrorToast, clearPendingAction]);

  const handleRemoveFiles = useCallback(async () => {
    const pendingTarget = pendingRemoveFilesTarget;
    if (!pendingTarget) return;

    setActionLoading(true);
    try {
      const liveTarget = getRemoveFilesTarget(
        removeFilesGame ?? game,
        steamUninstallAvailable
      );
      if (
        !liveTarget ||
        liveTarget.kind !== pendingTarget.kind ||
        (liveTarget.kind === "hydra" &&
          pendingTarget.kind === "hydra" &&
          (liveTarget.game.shop !== pendingTarget.game.shop ||
            liveTarget.game.objectId !== pendingTarget.game.objectId)) ||
        (liveTarget.kind === "steam" &&
          pendingTarget.kind === "steam" &&
          liveTarget.appId !== pendingTarget.appId)
      ) {
        showErrorToast(t("remove_game_files_target_changed"));
        return;
      }

      if (
        liveTarget.kind === "hydra" &&
        isLibraryGameDownloading(liveTarget.game)
      ) {
        showErrorToast(t("remove_game_files_downloading"));
        return;
      }

      if (liveTarget.kind === "steam") {
        if (
          typeof globalThis.window.electron.uninstallGameOnSteam !== "function"
        ) {
          showErrorToast(t("steam_uninstall_failed"));
          return;
        }
        await globalThis.window.electron.uninstallGameOnSteam(liveTarget.appId);
        showSuccessToast(t("steam_uninstall_requested"));
        clearPendingAction();
        return;
      }

      await globalThis.window.electron.deleteGameFolder(
        liveTarget.game.shop,
        liveTarget.game.objectId
      );
      showSuccessToast("Game files removed");
      clearPendingAction();
      globalThis.window.dispatchEvent(new Event("library-update"));
    } catch {
      showErrorToast(
        pendingTarget.kind === "steam"
          ? t("steam_uninstall_failed")
          : t("remove_game_files_failed")
      );
    } finally {
      setActionLoading(false);
    }
  }, [
    game,
    removeFilesGame,
    steamUninstallAvailable,
    pendingRemoveFilesTarget,
    t,
    showSuccessToast,
    showErrorToast,
    clearPendingAction,
  ]);

  const confirmationConfig = pendingAction
    ? getConfirmationConfig(
        pendingAction,
        game,
        pendingRemoveFilesTarget,
        t,
        handleRemoveFromLibrary,
        handleResetAchievements,
        handleRemoveFiles
      )
    : null;

  return (
    <VerticalFocusGroup className="game-danger-zone-settings-tab">
      <SettingsSection
        className="game-danger-zone-settings-tab__section"
        title={t("remove_from_library")}
        description={t("remove_from_library_description", {
          game: game.title,
        })}
      >
        <Button
          focusId={GAME_DANGER_ZONE_PRIMARY_CONTROL_ID}
          variant="danger"
          className="game-danger-zone-settings-tab__action-button"
          onClick={() => setPendingAction("remove-from-library")}
        >
          {t("remove_from_library")}
        </Button>
      </SettingsSection>

      {game.shop !== "custom" && (
        <SettingsSection
          className="game-danger-zone-settings-tab__section"
          title={t("reset_achievements")}
          description={t(
            game.shop === "steam"
              ? "reset_achievements_steam_description"
              : "reset_achievements_description",
            { game: game.title }
          )}
        >
          <Button
            variant="danger"
            className="game-danger-zone-settings-tab__action-button"
            disabled={!game.achievementCount}
            onClick={() => setPendingAction("reset-achievements")}
          >
            {t("reset_achievements")}
          </Button>
        </SettingsSection>
      )}

      {game.shop !== "custom" && (
        <SettingsSection
          className="game-danger-zone-settings-tab__section"
          title={removeFilesSectionTitle}
          description={removeFilesSectionDescription}
        >
          <Button
            variant="danger"
            className="game-danger-zone-settings-tab__action-button"
            disabled={!removeFilesTarget || isGameDownloading}
            onClick={() => {
              if (!removeFilesTarget || isGameDownloading) return;
              setPendingRemoveFilesTarget(removeFilesTarget);
              setPendingAction("remove-files");
            }}
          >
            {t("remove_game_files")}
          </Button>
        </SettingsSection>
      )}

      {confirmationConfig && (
        <ConfirmationModal
          visible={true}
          title={confirmationConfig.title}
          description={confirmationConfig.description}
          confirmLabel={confirmationConfig.confirmLabel}
          danger
          loading={actionLoading}
          onClose={clearPendingAction}
          onConfirm={confirmationConfig.onConfirm}
        />
      )}
    </VerticalFocusGroup>
  );
}
