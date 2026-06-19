import { useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import type { LibraryGame } from "@types";
import { Button, VerticalFocusGroup } from "../../../common";
import { ConfirmationModal } from "../../../modals";
import { SettingsSection } from "../../../../pages/settings/settings-section";
import { useBigPictureToast } from "../../../../hooks/use-big-picture-toast.hook";

import "./danger-zone-tab.scss";

function getConfirmationConfig(
  pendingAction: DangerAction,
  game: LibraryGame,
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
        description: t("reset_achievements_description", { game: game.title }),
        confirmLabel: t("reset_achievements"),
        onConfirm: handleResetAchievements,
      };
    case "remove-files":
      return {
        title: t("remove_game_files"),
        description: t("remove_game_files_description", { game: game.title }),
        confirmLabel: t("remove_game_files"),
        onConfirm: handleRemoveFiles,
      };
  }
}

export const GAME_DANGER_ZONE_PRIMARY_CONTROL_ID =
  "game-danger-zone-primary-control";

interface GameDangerZoneSettingsTabProps {
  game: LibraryGame;
  onClose: () => void;
}

type DangerAction =
  | "remove-from-library"
  | "reset-achievements"
  | "remove-files";

export function GameDangerZoneSettingsTab({
  game,
  onClose,
}: Readonly<GameDangerZoneSettingsTabProps>) {
  const { t } = useTranslation("big_picture");
  const { showSuccessToast, showErrorToast } = useBigPictureToast();
  const [pendingAction, setPendingAction] = useState<DangerAction | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  const handleRemoveFromLibrary = useCallback(async () => {
    setActionLoading(true);
    try {
      await globalThis.window.electron.removeGameFromLibrary(
        game.shop,
        game.objectId
      );
      globalThis.window.dispatchEvent(new Event("library-update"));
      showSuccessToast("Game removed from library");
      setPendingAction(null);
      onClose();
    } catch {
      showErrorToast("Failed to remove from library");
    } finally {
      setActionLoading(false);
    }
  }, [game, onClose, showSuccessToast, showErrorToast]);

  const handleResetAchievements = useCallback(async () => {
    setActionLoading(true);
    try {
      await globalThis.window.electron.resetGameAchievements(
        game.shop,
        game.objectId
      );
      showSuccessToast("Achievements reset");
      setPendingAction(null);
    } catch {
      showErrorToast("Failed to reset achievements");
    } finally {
      setActionLoading(false);
    }
  }, [game, showSuccessToast, showErrorToast]);

  const handleRemoveFiles = useCallback(async () => {
    setActionLoading(true);
    try {
      await globalThis.window.electron.deleteGameFolder(
        game.shop,
        game.objectId
      );
      showSuccessToast("Game files removed");
      setPendingAction(null);
      globalThis.window.dispatchEvent(new Event("library-update"));
    } catch {
      showErrorToast("Failed to remove game files");
    } finally {
      setActionLoading(false);
    }
  }, [game, showSuccessToast, showErrorToast]);

  const confirmationConfig = pendingAction
    ? getConfirmationConfig(
        pendingAction,
        game,
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
          description={t("reset_achievements_description", {
            game: game.title,
          })}
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
          title={t("remove_game_files")}
          description={t("remove_game_files_description", {
            game: game.title,
          })}
        >
          <Button
            variant="danger"
            className="game-danger-zone-settings-tab__action-button"
            disabled={!game.download?.downloadPath}
            onClick={() => setPendingAction("remove-files")}
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
          onClose={() => setPendingAction(null)}
          onConfirm={confirmationConfig.onConfirm}
        />
      )}
    </VerticalFocusGroup>
  );
}
