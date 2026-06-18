import { Cloud } from "@phosphor-icons/react";
import type { GameArtifact, LibraryGame } from "@types";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button, Checkbox, VerticalFocusGroup } from "../../../common";
import { useBigPictureToast } from "../../../../hooks";
import { SettingsSection } from "../../../../pages/settings/settings-section";
import { CloudSavesList } from "./cloud-saves-list";

import "./cloud-tab.scss";

export const GAME_CLOUD_SETTINGS_PRIMARY_CONTROL_ID =
  "game-cloud-settings-primary-control";
const GAME_CLOUD_SETTINGS_AUTO_SYNC_ID = "game-cloud-settings-auto-sync";

export interface GameCloudSettingsProps {
  game: LibraryGame;
  automaticCloudSync: boolean;
  onToggleAutomaticCloudSync: (checked: boolean) => void;
}

export function GameCloudSettingsTab({
  game,
  automaticCloudSync,
  onToggleAutomaticCloudSync,
}: Readonly<GameCloudSettingsProps>) {
  const { t } = useTranslation("big_picture");
  const { showErrorToast, showSuccessToast } = useBigPictureToast();
  const [artifacts, setArtifacts] = useState<GameArtifact[]>([]);
  const [loadingArtifacts, setLoadingArtifacts] = useState(true);
  const [creatingBackup, setCreatingBackup] = useState(false);
  const [restoringArtifactId, setRestoringArtifactId] = useState<string | null>(
    null
  );
  const [updatingArtifactId, setUpdatingArtifactId] = useState<string | null>(
    null
  );
  const [deletingArtifactId, setDeletingArtifactId] = useState<string | null>(
    null
  );

  const loadArtifacts = useCallback(async () => {
    setLoadingArtifacts(true);

    const params = new URLSearchParams({
      objectId: game.objectId,
      shop: game.shop,
    });
    const result = await window.electron.hydraApi
      .get<GameArtifact[]>(`/profile/games/artifacts?${params.toString()}`, {
        needsSubscription: true,
      })
      .catch(() => []);
    setArtifacts(result ?? []);
    setLoadingArtifacts(false);
  }, [game.objectId, game.shop]);

  useEffect(() => {
    void loadArtifacts();
  }, [loadArtifacts]);

  useEffect(() => {
    const removeUploadCompleteListener = window.electron.onUploadComplete(
      game.objectId,
      game.shop,
      () => {
        showSuccessToast("Cloud backup complete");
        setCreatingBackup(false);
        void loadArtifacts();
      }
    );

    const removeDownloadCompleteListener =
      window.electron.onBackupDownloadComplete(game.objectId, game.shop, () => {
        showSuccessToast("Cloud save restored");
        setRestoringArtifactId(null);
        void loadArtifacts();
      });

    return () => {
      removeUploadCompleteListener();
      removeDownloadCompleteListener();
    };
  }, [game.objectId, game.shop, loadArtifacts, showSuccessToast]);

  const handleCreateBackup = useCallback(async () => {
    if (creatingBackup) return;

    setCreatingBackup(true);

    try {
      await window.electron.uploadSaveGame(game.objectId, game.shop, null);
    } catch {
      setCreatingBackup(false);
      showErrorToast("Cloud backup failed");
    }
  }, [creatingBackup, game.objectId, game.shop, showErrorToast]);

  const handleRestoreArtifact = useCallback(
    async (artifactId: string) => {
      if (restoringArtifactId) return;

      setRestoringArtifactId(artifactId);

      try {
        await window.electron.downloadGameArtifact(
          game.objectId,
          game.shop,
          artifactId
        );
      } catch {
        setRestoringArtifactId(null);
        showErrorToast("Failed to restore cloud save");
      }
    },
    [game.objectId, game.shop, restoringArtifactId, showErrorToast]
  );

  const handleToggleArtifactFreeze = useCallback(
    async (artifactId: string, freeze: boolean) => {
      if (updatingArtifactId || deletingArtifactId) return;

      setUpdatingArtifactId(artifactId);

      try {
        await window.electron.hydraApi.put(
          `/profile/games/artifacts/${artifactId}/${freeze ? "freeze" : "unfreeze"}`
        );
        await loadArtifacts();
      } catch {
        showErrorToast("Unable to sync cloud save");
      } finally {
        setUpdatingArtifactId(null);
      }
    },
    [deletingArtifactId, loadArtifacts, showErrorToast, updatingArtifactId]
  );

  const handleDeleteArtifact = useCallback(
    async (artifactId: string) => {
      if (updatingArtifactId || deletingArtifactId) return;

      setDeletingArtifactId(artifactId);

      try {
        await window.electron.hydraApi.delete<{ ok: boolean }>(
          `/profile/games/artifacts/${artifactId}`
        );
        showSuccessToast("Cloud save removed");
        await loadArtifacts();
      } catch (error) {
        showErrorToast("Unable to sync cloud save");
        throw error;
      } finally {
        setDeletingArtifactId(null);
      }
    },
    [
      deletingArtifactId,
      loadArtifacts,
      showErrorToast,
      showSuccessToast,
      updatingArtifactId,
    ]
  );

  if (game.shop === "custom") {
    return <p>{t("settings_not_available_for_custom_games")}</p>;
  }

  return (
    <VerticalFocusGroup className="game-cloud-settings-tab">
      <SettingsSection
        className="game-cloud-settings-tab__section"
        title={t("cloud_saves_section_title")}
        description={t(
          game.shop === "launchbox"
            ? "cloud_saves_section_description_memory"
            : "cloud_saves_section_description"
        )}
      >
        <div className="game-cloud-settings-tab__section-content">
          <Button
            focusId={GAME_CLOUD_SETTINGS_PRIMARY_CONTROL_ID}
            variant="primary"
            className="game-cloud-settings-tab__new-backup-button"
            onClick={() => void handleCreateBackup()}
            loading={creatingBackup}
            icon={<Cloud size={20} />}
          >
            {t("create_backup")}
          </Button>

          <Checkbox
            block
            focusId={GAME_CLOUD_SETTINGS_AUTO_SYNC_ID}
            label={t("enable_automatic_cloud_sync")}
            checked={automaticCloudSync}
            onChange={onToggleAutomaticCloudSync}
          />
        </div>
      </SettingsSection>

      <SettingsSection
        className="game-cloud-settings-tab__section game-cloud-settings-tab__section--backups"
        title={t("backups")}
        description={t("cloud_saves_list_description")}
      >
        <div className="game-cloud-settings-tab__section-content game-cloud-settings-tab__section-content--backups">
          <CloudSavesList
            artifacts={artifacts}
            loading={loadingArtifacts}
            restoringArtifactId={restoringArtifactId}
            updatingArtifactId={updatingArtifactId}
            deletingArtifactId={deletingArtifactId}
            onRestoreArtifact={handleRestoreArtifact}
            onToggleArtifactFreeze={handleToggleArtifactFreeze}
            onDeleteArtifact={handleDeleteArtifact}
          />
        </div>
      </SettingsSection>
    </VerticalFocusGroup>
  );
}
