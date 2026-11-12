import { useState, useCallback, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { LibraryGame } from "@types";
import {
  applyLibraryGroupAction,
  findLibraryGamePresentation,
  getLibraryGameMembers,
  getOfficialStoreMembers,
  getRemoveFilesTarget,
  isLibraryGameDownloading,
  isSameRemoveFilesTarget,
  type RemoveFilesTarget,
} from "@shared";
import { useIsSteamLibraryExecutable } from "@renderer/hooks/use-steam-library-executable";
import { Button, VerticalFocusGroup } from "../../../common";
import { ConfirmationModal } from "../../../modals";
import { useSourceArchive } from "@renderer/hooks/use-source-archive";
import { SettingsSection } from "../../../../pages/settings/settings-section";
import { useBigPictureToast } from "../../../../hooks/use-big-picture-toast.hook";
import { Feature, useFeature } from "../../../../hooks";
import { MyScreenshotsDangerSection } from "./my-screenshots-danger-section";

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
  const { isFeatureEnabled } = useFeature();
  const [pendingAction, setPendingAction] = useState<DangerAction | null>(null);
  const [pendingRemoveFilesTarget, setPendingRemoveFilesTarget] =
    useState<RemoveFilesTarget | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [deleteSourceArchive, setDeleteSourceArchive] = useState(false);
  const hasSourceArchive = useSourceArchive(
    pendingRemoveFilesTarget?.kind === "hydra"
      ? pendingRemoveFilesTarget.game
      : null,
    pendingAction === "remove-files"
  );

  useEffect(() => {
    setDeleteSourceArchive(false);
  }, [pendingAction]);

  const steamUninstallAvailable =
    typeof globalThis.window.electron.uninstallGameOnSteam === "function";
  const removeFilesSource = useMemo(
    () => removeFilesGame ?? game,
    [removeFilesGame, game]
  );
  const hydraRemoveFilesTarget = getRemoveFilesTarget(removeFilesSource, false);
  const steamMember = getOfficialStoreMembers(
    getLibraryGameMembers(removeFilesSource)
  ).steam;
  const isSteamLibraryExecutable = useIsSteamLibraryExecutable(
    steamMember,
    hydraRemoveFilesTarget === null
  );
  const removeFilesTarget = getRemoveFilesTarget(
    removeFilesSource,
    steamUninstallAvailable,
    isSteamLibraryExecutable === true
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
        removeFilesSource,
        steamUninstallAvailable,
        isSteamLibraryExecutable === true
      );
      if (!liveTarget || !isSameRemoveFilesTarget(liveTarget, pendingTarget)) {
        showErrorToast(t("remove_game_files_target_changed"));
        clearPendingAction();
        return;
      }

      if (
        liveTarget.kind === "hydra" &&
        isLibraryGameDownloading(liveTarget.game)
      ) {
        showErrorToast(t("remove_game_files_downloading"));
        clearPendingAction();
        return;
      }

      if (liveTarget.kind === "steam") {
        await globalThis.window.electron.uninstallGameOnSteam?.(
          liveTarget.appId
        );
        showSuccessToast(t("steam_uninstall_requested"));
        clearPendingAction();
        return;
      }

      await globalThis.window.electron.deleteGameFolder(
        liveTarget.game.shop,
        liveTarget.game.objectId,
        { deleteSourceArchive: hasSourceArchive && deleteSourceArchive }
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
    removeFilesSource,
    steamUninstallAvailable,
    isSteamLibraryExecutable,
    pendingRemoveFilesTarget,
    t,
    showSuccessToast,
    showErrorToast,
    clearPendingAction,
    hasSourceArchive,
    deleteSourceArchive,
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

      {isFeatureEnabled(Feature.Screenshots) ? (
        <MyScreenshotsDangerSection
          shop={game.shop}
          objectId={game.objectId}
          fallbackFocusId={GAME_DANGER_ZONE_PRIMARY_CONTROL_ID}
        />
      ) : null}

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
          sourceArchiveOption={
            pendingAction === "remove-files" && hasSourceArchive
              ? {
                  checked: deleteSourceArchive,
                  onChange: setDeleteSourceArchive,
                }
              : null
          }
        />
      )}
    </VerticalFocusGroup>
  );
}
