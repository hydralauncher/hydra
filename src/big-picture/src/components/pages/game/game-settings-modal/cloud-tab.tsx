import {
  CloudIcon,
  SpinnerIcon,
  UploadSimpleIcon,
} from "@phosphor-icons/react";
import type {
  EmulationCloudSave,
  EmulationSavePlatform,
  GameArtifact,
  LibraryGame,
  LudusaviBackup,
  MemoryCardSaveRecord,
} from "@types";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { platformToSystem } from "@renderer/helpers";
import {
  Button,
  Checkbox,
  HorizontalFocusGroup,
  VerticalFocusGroup,
} from "../../../common";
import { useBigPictureToast } from "../../../../hooks";
import { useUserDetails } from "../../../../hooks/use-user-details.hook";
import { SettingsSection } from "../../../../pages/settings/settings-section";
import { EmulationCloudRestoreModal } from "../../../../pages/settings/emulation/emulation-cloud-restore-modal";
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

function formatDownloadProgress(progress: number): string {
  return `${Math.round(progress * 100)}%`;
}

const RESTORE_MODAL_REGION_ID = "emu-saves-restore-modal-region";
const RESTORE_MODAL_ACTIONS_REGION_ID = "emu-saves-restore-modal-actions";
const RESTORE_MODAL_PICK_BUTTON_ID = "emu-saves-restore-pick-button";
const RESTORE_MODAL_CONFIRM_BUTTON_ID = "emu-saves-restore-confirm";

const recordKey = (record: MemoryCardSaveRecord): string =>
  `${record.cardFilePath}::${record.folderName}`;

function emulationSaveToArtifact(save: EmulationCloudSave): GameArtifact {
  return {
    id: save.id,
    artifactLengthInBytes: save.artifactLengthInBytes,
    downloadOptionTitle: save.fileName,
    createdAt: save.createdAt,
    updatedAt: save.updatedAt,
    hostname: save.hostname ?? "—",
    downloadCount: 0,
    label: save.label ?? undefined,
    isFrozen: false,
  };
}

function EmulationRestoreModal({
  save,
  platform,
  onClose,
  onRestored,
}: Readonly<{
  save: EmulationCloudSave | null;
  platform: EmulationSavePlatform;
  onClose: () => void;
  onRestored: () => void;
}>) {
  const { showErrorToast, showSuccessToast } = useBigPictureToast();
  return (
    <EmulationCloudRestoreModal
      save={save}
      platform={platform}
      onClose={onClose}
      onRestored={onRestored}
      onRestoreSuccess={() => showSuccessToast("Cloud save restored")}
      onRestoreError={() => showErrorToast("Failed to restore cloud save")}
      regionId={RESTORE_MODAL_REGION_ID}
      actionsRegionId={RESTORE_MODAL_ACTIONS_REGION_ID}
      pickButtonId={RESTORE_MODAL_PICK_BUTTON_ID}
      confirmButtonId={RESTORE_MODAL_CONFIRM_BUTTON_ID}
    />
  );
}

export function GameCloudSettingsTab({
  game,
  automaticCloudSync,
  onToggleAutomaticCloudSync,
}: Readonly<GameCloudSettingsProps>) {
  const { t } = useTranslation("big_picture");
  const { showErrorToast, showSuccessToast } = useBigPictureToast();
  const { userDetails } = useUserDetails();

  const system =
    game.shop === "launchbox" ? platformToSystem(game.platform) : null;
  const isEmulationGame = system === "ps1" || system === "ps2";

  const [artifacts, setArtifacts] = useState<GameArtifact[]>([]);
  const [emulationSaves, setEmulationSaves] = useState<EmulationCloudSave[]>(
    []
  );
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
  const [backupPreview, setBackupPreview] = useState<LudusaviBackup | null>(
    null
  );
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [backupDownloadProgress, setBackupDownloadProgress] = useState<
    number | null
  >(null);
  const [emulationRestoreTarget, setEmulationRestoreTarget] =
    useState<EmulationCloudSave | null>(null);
  const [records, setRecords] = useState<MemoryCardSaveRecord[]>([]);
  const [uploadingCardKey, setUploadingCardKey] = useState<string | null>(null);

  const localSaves = useMemo(
    () => records.filter((r) => r.objectId === game.objectId),
    [records, game.objectId]
  );
  const hasLocalSaves = localSaves.length > 0;
  const formatBytes = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const backupsPerGameLimit = userDetails?.quirks?.backupsPerGameLimit ?? 0;
  const hasReachedLimit =
    backupsPerGameLimit > 0 && artifacts.length >= backupsPerGameLimit;
  const hasRestoreInProgress = restoringArtifactId !== null;
  const hasDeleteInProgress = deletingArtifactId !== null;
  const hasUpdateInProgress = updatingArtifactId !== null;
  const hasBackupDownloadProgress = backupDownloadProgress !== null;
  const backupPreviewGameCount = backupPreview?.overall?.totalGames ?? 0;

  const disableActions =
    creatingBackup ||
    hasRestoreInProgress ||
    hasDeleteInProgress ||
    hasUpdateInProgress;

  const formatProgress = useMemo(() => {
    if (hasBackupDownloadProgress) {
      return formatDownloadProgress(backupDownloadProgress);
    }

    return null;
  }, [backupDownloadProgress, hasBackupDownloadProgress]);

  const backupStateLabel = useMemo(() => {
    if (creatingBackup) {
      return t("uploading_backup");
    }

    if (hasRestoreInProgress) {
      if (formatProgress === null) {
        return t("restoring_backup");
      }

      return `${t("restoring_backup")} ${formatProgress}`;
    }

    if (loadingPreview) {
      return t("loading_save_preview");
    }

    if (hasReachedLimit) {
      return t("max_number_of_artifacts_reached");
    }

    if (backupPreview === null) {
      return t("no_backup_preview");
    }

    if (artifacts.length === 0) {
      return t("no_backups");
    }

    return null;
  }, [
    creatingBackup,
    hasRestoreInProgress,
    formatProgress,
    loadingPreview,
    hasReachedLimit,
    backupPreview,
    artifacts.length,
    t,
  ]);

  const loadArtifacts = useCallback(async () => {
    setLoadingArtifacts(true);

    if (isEmulationGame) {
      const platform = system;
      const localPromise =
        platform === "ps2"
          ? globalThis.window.electron.listPs2MemcardSaves()
          : globalThis.window.electron.listPs1MemcardSaves();
      const [saves, local] = await Promise.all([
        globalThis.window.electron
          .listEmulationSaves(platform, game.objectId)
          .catch(() => [] as EmulationCloudSave[]),
        localPromise,
      ]);
      const filtered = saves.filter((s) => s.objectId === game.objectId);
      setEmulationSaves(filtered);
      setArtifacts(filtered.map(emulationSaveToArtifact));
      setRecords(local);
      setLoadingArtifacts(false);
      return;
    }

    const params = new URLSearchParams({
      objectId: game.objectId,
      shop: game.shop,
    });
    const result = await globalThis.window.electron.hydraApi
      .get<GameArtifact[]>(`/profile/games/artifacts?${params.toString()}`, {
        needsSubscription: true,
      })
      .catch(() => []);
    setArtifacts(result ?? []);
    setLoadingArtifacts(false);
  }, [game.objectId, game.shop, isEmulationGame, system]);

  const loadBackupPreview = useCallback(async () => {
    if (isEmulationGame) {
      setLoadingPreview(false);
      setBackupPreview(null);
      return;
    }

    setLoadingPreview(true);

    try {
      const preview = await (
        globalThis.window.electron as any
      ).getGameBackupPreview(game.objectId, game.shop);
      setBackupPreview(preview);
    } catch {
      setBackupPreview(null);
    } finally {
      setLoadingPreview(false);
    }
  }, [game.objectId, game.shop, isEmulationGame]);

  useEffect(() => {
    loadArtifacts().catch(() => {});
    loadBackupPreview().catch(() => {});
  }, [loadArtifacts, loadBackupPreview]);

  useEffect(() => {
    if (isEmulationGame) return;

    const removeUploadCompleteListener =
      globalThis.window.electron.onUploadComplete(
        game.objectId,
        game.shop,
        () => {
          showSuccessToast("Cloud backup complete");
          setCreatingBackup(false);
          loadArtifacts().catch(() => {});
          loadBackupPreview().catch(() => {});
        }
      );

    const removeDownloadCompleteListener =
      globalThis.window.electron.onBackupDownloadComplete(
        game.objectId,
        game.shop,
        (success) => {
          if (success) {
            showSuccessToast("Cloud save restored");
          } else {
            showErrorToast("Failed to restore cloud save");
          }
          setRestoringArtifactId(null);
          setBackupDownloadProgress(null);
          loadArtifacts().catch(() => {});
          loadBackupPreview().catch(() => {});
        }
      );

    const removeBackupDownloadProgressListener = (
      globalThis.window.electron as any
    ).onBackupDownloadProgress(
      game.objectId,
      game.shop,
      (progressEvent: any) => {
        if (progressEvent.progress !== undefined) {
          setBackupDownloadProgress(progressEvent.progress);
        }
      }
    );

    return () => {
      removeUploadCompleteListener();
      removeDownloadCompleteListener();
      removeBackupDownloadProgressListener();
    };
  }, [
    game.objectId,
    game.shop,
    loadArtifacts,
    loadBackupPreview,
    showErrorToast,
    showSuccessToast,
    isEmulationGame,
  ]);

  const handleUploadCard = useCallback(
    async (record: MemoryCardSaveRecord) => {
      const key = recordKey(record);
      setUploadingCardKey(key);
      try {
        await globalThis.window.electron.uploadEmulationSave(
          system as EmulationSavePlatform,
          record.cardFilePath,
          record.folderName
        );
        showSuccessToast("Cloud backup complete");
        loadArtifacts().catch(() => {});
      } catch {
        showErrorToast("Cloud backup failed");
      } finally {
        setUploadingCardKey(null);
      }
    },
    [system, showSuccessToast, showErrorToast, loadArtifacts]
  );

  const handleCreateBackup = useCallback(async () => {
    if (creatingBackup || isEmulationGame) return;

    setCreatingBackup(true);

    try {
      await globalThis.window.electron.uploadSaveGame(
        game.objectId,
        game.shop,
        null
      );
    } catch {
      setCreatingBackup(false);
      showErrorToast("Cloud backup failed");
    }
  }, [
    creatingBackup,
    game.objectId,
    game.shop,
    showErrorToast,
    isEmulationGame,
  ]);

  const handleRestoreArtifact = useCallback(
    async (artifactId: string) => {
      if (isEmulationGame) {
        const save = emulationSaves.find((s) => s.id === artifactId);
        if (save) setEmulationRestoreTarget(save);
        return;
      }

      if (restoringArtifactId) return;

      setRestoringArtifactId(artifactId);

      try {
        await globalThis.window.electron.downloadGameArtifact(
          game.objectId,
          game.shop,
          artifactId
        );
      } catch {
        setRestoringArtifactId(null);
        showErrorToast("Failed to restore cloud save");
      }
    },
    [
      game.objectId,
      game.shop,
      restoringArtifactId,
      showErrorToast,
      isEmulationGame,
      emulationSaves,
    ]
  );

  const handleToggleArtifactFreeze = useCallback(
    async (artifactId: string, freeze: boolean) => {
      if (updatingArtifactId || deletingArtifactId) return;

      setUpdatingArtifactId(artifactId);

      try {
        await globalThis.window.electron.hydraApi.put(
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
        if (isEmulationGame) {
          await globalThis.window.electron.deleteEmulationSave(artifactId);
        } else {
          await globalThis.window.electron.hydraApi.delete<{ ok: boolean }>(
            `/profile/games/artifacts/${artifactId}`
          );
        }
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
      isEmulationGame,
    ]
  );

  if (game.shop === "custom") {
    return <p>{t("settings_not_available_for_custom_games")}</p>;
  }

  return (
    <VerticalFocusGroup className="game-cloud-settings-tab">
      {isEmulationGame ? (
        hasLocalSaves && (
          <SettingsSection
            className="game-cloud-settings-tab__section"
            title={t("cloud_saves_section_title")}
            description={t("cloud_saves_section_description_memory")}
          >
            <div className="game-cloud-settings-tab__saves-list">
              {localSaves.map((record) => {
                const key = recordKey(record);
                const uploading = uploadingCardKey === key;
                return (
                  <div key={key} className="game-cloud-settings-tab__save-card">
                    <div className="game-cloud-settings-tab__save-copy">
                      <p
                        className="game-cloud-settings-tab__save-title"
                        title={record.title ?? record.folderName}
                      >
                        {record.title ?? record.folderName}
                      </p>
                      <p className="game-cloud-settings-tab__save-info">
                        {record.cardLabel} · {formatBytes(record.sizeBytes)}
                      </p>
                    </div>
                    <HorizontalFocusGroup asChild>
                      <div className="game-cloud-settings-tab__save-actions">
                        <Button
                          focusId={`${GAME_CLOUD_SETTINGS_PRIMARY_CONTROL_ID}-${key}`}
                          variant="secondary"
                          className="game-cloud-settings-tab__save-restore-button"
                          loading={uploading}
                          disabled={uploading}
                          icon={
                            uploading ? (
                              <SpinnerIcon size={20} />
                            ) : (
                              <UploadSimpleIcon size={20} weight="bold" />
                            )
                          }
                          onClick={() => handleUploadCard(record)}
                        >
                          {uploading ? "Uploading..." : t("create_backup")}
                        </Button>
                      </div>
                    </HorizontalFocusGroup>
                  </div>
                );
              })}
            </div>
          </SettingsSection>
        )
      ) : (
        <SettingsSection
          className="game-cloud-settings-tab__section"
          title={t("cloud_saves_section_title")}
          description={t("cloud_saves_section_description")}
        >
          <div className="game-cloud-settings-tab__section-content">
            <Button
              focusId={GAME_CLOUD_SETTINGS_PRIMARY_CONTROL_ID}
              variant="primary"
              className="game-cloud-settings-tab__new-backup-button"
              onClick={() => {
                handleCreateBackup().catch(() => {});
              }}
              loading={creatingBackup}
              disabled={
                disableActions ||
                backupPreviewGameCount === 0 ||
                hasReachedLimit
              }
              icon={<CloudIcon size={20} />}
            >
              {t("create_backup")}
            </Button>

            {backupStateLabel && (
              <p className="game-cloud-settings-tab__status-label">
                {backupStateLabel}
              </p>
            )}

            <Checkbox
              block
              focusId={GAME_CLOUD_SETTINGS_AUTO_SYNC_ID}
              label={t("enable_automatic_cloud_sync")}
              checked={automaticCloudSync}
              onChange={onToggleAutomaticCloudSync}
            />
          </div>
        </SettingsSection>
      )}

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
            hideFreeze={isEmulationGame}
          />
        </div>
      </SettingsSection>

      <EmulationRestoreModal
        save={emulationRestoreTarget}
        platform={system as EmulationSavePlatform}
        onClose={() => setEmulationRestoreTarget(null)}
        onRestored={() => {
          setEmulationRestoreTarget(null);
          loadArtifacts().catch(() => {});
        }}
      />
    </VerticalFocusGroup>
  );
}
