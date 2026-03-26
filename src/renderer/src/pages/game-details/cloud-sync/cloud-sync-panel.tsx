import { Button, CheckboxField } from "@renderer/components";
import { useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ChangeEvent } from "react";
import { cloudSyncContext, gameDetailsContext } from "@renderer/context";
import "./cloud-sync-panel.scss";
import { formatBytes } from "@shared";
import {
  ClockIcon,
  DeviceDesktopIcon,
  HistoryIcon,
  InfoIcon,
  PencilIcon,
  PinIcon,
  PinSlashIcon,
  SyncIcon,
  TrashIcon,
  UploadIcon,
} from "@primer/octicons-react";
import {
  useAppSelector,
  useDate,
  useFormat,
  useToast,
  useUserDetails,
} from "@renderer/hooks";
import { useTranslation } from "react-i18next";
import { AxiosProgressEvent } from "axios";
import { formatDownloadProgress } from "@renderer/helpers";
import { CloudSyncRenameArtifactModal } from "../cloud-sync-rename-artifact-modal/cloud-sync-rename-artifact-modal";
import { GameArtifact, WebDavBackupEntry } from "@types";
import { orderBy } from "lodash-es";
import { MoreVertical } from "lucide-react";
import { DropdownMenu } from "@renderer/components/dropdown-menu/dropdown-menu";
import { Tooltip } from "react-tooltip";

interface CloudSyncPanelProps {
  automaticCloudSync: boolean;
  automaticWebDavSync: boolean;
  onToggleAutomaticCloudSync: (event: ChangeEvent<HTMLInputElement>) => void;
  onToggleAutomaticWebDavSync: (event: ChangeEvent<HTMLInputElement>) => void;
}

export function CloudSyncPanel({
  automaticCloudSync,
  automaticWebDavSync,
  onToggleAutomaticCloudSync,
  onToggleAutomaticWebDavSync,
}: Readonly<CloudSyncPanelProps>) {
  const [deletingArtifact, setDeletingArtifact] = useState(false);
  const [deletingWebDavBackup, setDeletingWebDavBackup] = useState(false);
  const [backupDownloadProgress, setBackupDownloadProgress] =
    useState<AxiosProgressEvent | null>(null);
  const [artifactToRename, setArtifactToRename] = useState<GameArtifact | null>(
    null
  );
  const [webDavBackupToRename, setWebDavBackupToRename] =
    useState<WebDavBackupEntry | null>(null);
  const [webDavBackups, setWebDavBackups] = useState<WebDavBackupEntry[]>([]);
  const [loadingWebDavBackups, setLoadingWebDavBackups] = useState(false);
  const [restoringWebDavBackup, setRestoringWebDavBackup] = useState(false);
  const [uploadingWebDavBackup, setUploadingWebDavBackup] = useState(false);
  const [webDavBackupDownloadProgress, setWebDavBackupDownloadProgress] =
    useState<AxiosProgressEvent | null>(null);
  const [pinnedWebDavBackups, setPinnedWebDavBackups] = useState<string[]>([]);

  const { t } = useTranslation("game_details");
  const { t: tHydraCloud } = useTranslation("hydra_cloud");
  const { formatDate, formatDateTime } = useDate();
  const { formatNumber } = useFormat();
  const { hasActiveSubscription } = useUserDetails();

  const {
    artifacts,
    backupPreview,
    uploadingBackup,
    restoringBackup,
    loadingPreview,
    freezingArtifact,
    uploadSaveGame,
    downloadGameArtifact,
    deleteGameArtifact,
    toggleArtifactFreeze,
    setShowCloudSyncFilesModal,
    getGameBackupPreview,
    getGameArtifacts,
  } = useContext(cloudSyncContext);

  const { objectId, shop, lastDownloadedOption, game } =
    useContext(gameDetailsContext);

  const { showSuccessToast, showErrorToast } = useToast();

  const userDetails = useAppSelector((state) => state.userDetails.userDetails);
  const userPreferences = useAppSelector(
    (state) => state.userPreferences.value
  );
  const backupsPerGameLimit = userDetails?.quirks?.backupsPerGameLimit ?? 0;

  const isWebDavConfigured = Boolean(
    userPreferences?.webDavHost &&
      userPreferences?.webDavUsername &&
      userPreferences?.webDavPassword
  );
  const webDavPinnedStorageKey = `pinned-webdav-backups-${shop}-${objectId}`;

  const handleDeleteArtifactClick = async (gameArtifactId: string) => {
    setDeletingArtifact(true);
    try {
      await deleteGameArtifact(gameArtifactId);
      showSuccessToast(t("backup_deleted"));
    } catch (_err) {
      showErrorToast("backup_deletion_failed");
    } finally {
      setDeletingArtifact(false);
    }
  };

  const savePinnedWebDavBackups = useCallback(
    (hrefs: string[]) => {
      setPinnedWebDavBackups(hrefs);
      if (!objectId) return;
      window.localStorage.setItem(
        webDavPinnedStorageKey,
        JSON.stringify(hrefs)
      );
    },
    [objectId, webDavPinnedStorageKey]
  );

  const loadWebDavBackups = useCallback(async () => {
    if (!isWebDavConfigured || !objectId) {
      setWebDavBackups([]);
      return;
    }

    setLoadingWebDavBackups(true);
    try {
      const backups = await window.electron.listWebDavBackups(objectId, shop);
      setWebDavBackups(backups);
    } catch {
      setWebDavBackups([]);
    } finally {
      setLoadingWebDavBackups(false);
    }
  }, [isWebDavConfigured, objectId, shop]);

  const handleRestoreWebDavBackup = async (href: string) => {
    if (!objectId) return;

    setWebDavBackupDownloadProgress(null);
    setRestoringWebDavBackup(true);
    try {
      await window.electron.downloadWebDavBackup(objectId, shop, href);
    } catch {
      setRestoringWebDavBackup(false);
      showErrorToast(t("webdav_restore_failed"));
    }
  };

  const handleDeleteWebDavBackup = async (href: string) => {
    if (!objectId) return;

    setDeletingWebDavBackup(true);
    try {
      await window.electron.deleteWebDavBackup(objectId, shop, href);
      showSuccessToast(t("backup_deleted"));
      await loadWebDavBackups();
      savePinnedWebDavBackups(
        pinnedWebDavBackups.filter((pinnedHref) => pinnedHref !== href)
      );
    } catch {
      showErrorToast(t("backup_deletion_failed"));
    } finally {
      setDeletingWebDavBackup(false);
    }
  };

  const handleRenameWebDavBackup = async () => {
    await loadWebDavBackups();
  };

  const handleTogglePinWebDavBackup = (href: string) => {
    if (pinnedWebDavBackups.includes(href)) {
      savePinnedWebDavBackups(
        pinnedWebDavBackups.filter((pinnedHref) => pinnedHref !== href)
      );
      return;
    }

    savePinnedWebDavBackups([...pinnedWebDavBackups, href]);
  };

  const handleUploadWebDavBackup = async () => {
    if (!objectId) return;

    setUploadingWebDavBackup(true);
    try {
      await window.electron.uploadSaveGameToWebDav(
        objectId,
        shop,
        lastDownloadedOption?.title ?? null
      );
      showSuccessToast(t("webdav_upload_success"));
      await loadWebDavBackups();
    } catch {
      showErrorToast(t("webdav_upload_failed"));
    } finally {
      setUploadingWebDavBackup(false);
    }
  };

  useEffect(() => {
    const removeBackupDownloadProgressListener =
      window.electron.onBackupDownloadProgress(
        objectId!,
        shop,
        (progressEvent) => {
          setBackupDownloadProgress(progressEvent);
        }
      );

    return () => {
      removeBackupDownloadProgressListener();
    };
  }, [objectId, shop]);

  useEffect(() => {
    const removeProgressListener =
      window.electron.onWebDavBackupDownloadProgress(
        objectId!,
        shop,
        (progressEvent) => {
          setWebDavBackupDownloadProgress(progressEvent);
        }
      );

    const removeCompleteListener =
      window.electron.onWebDavBackupDownloadComplete(
        objectId!,
        shop,
        (success) => {
          setRestoringWebDavBackup(false);
          if (success) {
            showSuccessToast(t("webdav_restore_success"));
          } else {
            showErrorToast(t("webdav_restore_failed"));
          }
        }
      );

    return () => {
      removeProgressListener();
      removeCompleteListener();
    };
  }, [objectId, shop, showSuccessToast, showErrorToast, t]);

  useEffect(() => {
    if (!objectId) return;

    const savedPinnedWebDavBackups = window.localStorage.getItem(
      webDavPinnedStorageKey
    );
    if (!savedPinnedWebDavBackups) {
      setPinnedWebDavBackups([]);
      return;
    }

    try {
      const parsed = JSON.parse(savedPinnedWebDavBackups);
      setPinnedWebDavBackups(Array.isArray(parsed) ? parsed : []);
    } catch {
      setPinnedWebDavBackups([]);
    }
  }, [objectId, webDavPinnedStorageKey]);

  useEffect(() => {
    if (!hasActiveSubscription && !isWebDavConfigured) return;

    getGameBackupPreview();
    if (hasActiveSubscription) {
      getGameArtifacts();
    }
    if (isWebDavConfigured) {
      loadWebDavBackups();
    }
  }, [
    getGameArtifacts,
    getGameBackupPreview,
    hasActiveSubscription,
    isWebDavConfigured,
    objectId,
    shop,
    loadWebDavBackups,
  ]);

  useEffect(() => {
    if (!uploadingBackup && isWebDavConfigured) {
      loadWebDavBackups();
    }
  }, [isWebDavConfigured, loadWebDavBackups, uploadingBackup]);

  useEffect(() => {
    if (pinnedWebDavBackups.length === 0 || webDavBackups.length === 0) return;

    const existingHrefs = new Set(webDavBackups.map((backup) => backup.href));
    const validPinned = pinnedWebDavBackups.filter((href) =>
      existingHrefs.has(href)
    );
    if (validPinned.length !== pinnedWebDavBackups.length) {
      savePinnedWebDavBackups(validPinned);
    }
  }, [pinnedWebDavBackups, savePinnedWebDavBackups, webDavBackups]);

  const handleBackupInstallClick = async (artifactId: string) => {
    setBackupDownloadProgress(null);
    downloadGameArtifact(artifactId);
  };

  const handleFreezeArtifactClick = async (
    artifactId: string,
    isFrozen: boolean
  ) => {
    try {
      await toggleArtifactFreeze(artifactId, isFrozen);
      showSuccessToast(isFrozen ? t("backup_frozen") : t("backup_unfrozen"));
    } catch (_err) {
      showErrorToast(
        t("backup_freeze_failed"),
        t("backup_freeze_failed_description")
      );
    }
  };

  const hasReachedLimit =
    backupsPerGameLimit > 0 && artifacts.length >= backupsPerGameLimit;

  const hydraByLabel = useMemo(() => {
    const map = new Map<string, GameArtifact>();
    for (const artifact of artifacts) {
      if (artifact.label) {
        map.set(artifact.label, artifact);
      }
    }
    return map;
  }, [artifacts]);

  const mergedBackupRows = useMemo(() => {
    const rows: Array<{
      key: string;
      hydraArtifact?: GameArtifact;
      webDavBackup?: WebDavBackupEntry;
      createdAt: string;
      isPinned: boolean;
    }> = [];

    const consumedHydraIds = new Set<string>();
    const consumedWebDavHrefs = new Set<string>();

    for (const webDavBackup of webDavBackups) {
      const nameWithoutExt = webDavBackup.filename.replace(/\.tar$/i, "");
      const matchingHydra = hydraByLabel.get(nameWithoutExt);

      if (matchingHydra) {
        consumedHydraIds.add(matchingHydra.id);
        consumedWebDavHrefs.add(webDavBackup.href);
        rows.push({
          key: `both-${matchingHydra.id}-${webDavBackup.href}`,
          hydraArtifact: matchingHydra,
          webDavBackup,
          createdAt: matchingHydra.createdAt,
          isPinned:
            matchingHydra.isFrozen ||
            pinnedWebDavBackups.includes(webDavBackup.href),
        });
      }
    }

    for (const artifact of artifacts) {
      if (consumedHydraIds.has(artifact.id)) continue;
      rows.push({
        key: `hydra-${artifact.id}`,
        hydraArtifact: artifact,
        createdAt: artifact.createdAt,
        isPinned: artifact.isFrozen,
      });
    }

    for (const webDavBackup of webDavBackups) {
      if (consumedWebDavHrefs.has(webDavBackup.href)) continue;
      rows.push({
        key: `webdav-${webDavBackup.href}`,
        webDavBackup,
        createdAt: webDavBackup.createdAt,
        isPinned: pinnedWebDavBackups.includes(webDavBackup.href),
      });
    }

    return orderBy(
      rows,
      [(row) => !row.isPinned, (row) => new Date(row.createdAt).getTime()],
      ["asc", "desc"]
    );
  }, [artifacts, hydraByLabel, pinnedWebDavBackups, webDavBackups]);

  const backupStateLabel = useMemo(() => {
    if (uploadingBackup) {
      return (
        <span className="cloud-sync-panel__backup-state-label">
          <SyncIcon className="cloud-sync-panel__sync-icon" />
          {t("uploading_backup")}
        </span>
      );
    }
    if (restoringBackup) {
      return (
        <span className="cloud-sync-panel__backup-state-label">
          <SyncIcon className="cloud-sync-panel__sync-icon" />
          {t("restoring_backup", {
            progress: formatDownloadProgress(
              backupDownloadProgress?.progress ?? 0
            ),
          })}
        </span>
      );
    }
    if (restoringWebDavBackup) {
      return (
        <span className="cloud-sync-panel__backup-state-label">
          <SyncIcon className="cloud-sync-panel__sync-icon" />
          {t("webdav_restoring", {
            progress: formatDownloadProgress(
              webDavBackupDownloadProgress?.progress ?? 0
            ),
          })}
        </span>
      );
    }
    if (loadingPreview) {
      return (
        <span className="cloud-sync-panel__backup-state-label">
          <SyncIcon className="cloud-sync-panel__sync-icon" />
          {t("loading_save_preview")}
        </span>
      );
    }
    if (loadingWebDavBackups) {
      return (
        <span className="cloud-sync-panel__backup-state-label">
          <SyncIcon className="cloud-sync-panel__sync-icon" />
          {t("webdav_loading_backups")}
        </span>
      );
    }
    if (hasReachedLimit) {
      return t("max_number_of_artifacts_reached");
    }
    if (mergedBackupRows.length === 0) {
      if (!backupPreview) {
        return t("no_backup_preview");
      }
      return t("no_backups");
    }
    return "";
  }, [
    backupDownloadProgress?.progress,
    backupPreview,
    hasReachedLimit,
    loadingWebDavBackups,
    loadingPreview,
    mergedBackupRows.length,
    restoringBackup,
    restoringWebDavBackup,
    t,
    uploadingBackup,
    webDavBackupDownloadProgress?.progress,
  ]);

  const disableActions =
    uploadingBackup ||
    restoringBackup ||
    deletingArtifact ||
    deletingWebDavBackup ||
    freezingArtifact ||
    restoringWebDavBackup;

  if (!hasActiveSubscription && !isWebDavConfigured) {
    return (
      <div className="cloud-sync-panel__upgrade">
        <p>{tHydraCloud("hydra_cloud_feature_found")}</p>
        <Button onClick={() => window.electron.openCheckout()}>
          {tHydraCloud("learn_more")}
        </Button>
      </div>
    );
  }

  return (
    <>
      <CloudSyncRenameArtifactModal
        visible={!!artifactToRename || !!webDavBackupToRename}
        onClose={() => {
          setArtifactToRename(null);
          setWebDavBackupToRename(null);
        }}
        artifact={artifactToRename}
        webDavBackup={webDavBackupToRename}
        onWebDavBackupRenamed={handleRenameWebDavBackup}
      />

      <div className="cloud-sync-panel__section-header">
        <h2>{t("cloud_save")}</h2>
        <p>{t("cloud_save_description")}</p>
      </div>

      <div className="cloud-sync-panel__automatic-sync">
        <CheckboxField
          label={
            <div className="cloud-sync-panel__automatic-sync-label">
              {t("enable_automatic_cloud_sync")}
              <span className="cloud-sync-panel__automatic-sync-badge">
                Hydra Cloud
              </span>
            </div>
          }
          checked={automaticCloudSync}
          disabled={!hasActiveSubscription || !game?.executablePath}
          onChange={onToggleAutomaticCloudSync}
        />
      </div>

      {isWebDavConfigured && (
        <div className="cloud-sync-panel__automatic-sync">
          <CheckboxField
            label={
              <div className="cloud-sync-panel__automatic-sync-label">
                {t("enable_automatic_webdav_sync")}
                <span className="cloud-sync-panel__automatic-sync-badge">
                  WebDAV
                </span>
              </div>
            }
            checked={automaticWebDavSync}
            disabled={!game?.executablePath}
            onChange={onToggleAutomaticWebDavSync}
          />
        </div>
      )}

      <div className="cloud-sync-panel__header">
        <div className="cloud-sync-panel__title-container">
          <p>{backupStateLabel}</p>
          <button
            type="button"
            className="cloud-sync-panel__manage-files-button"
            onClick={() => setShowCloudSyncFilesModal(true)}
            disabled={disableActions}
          >
            {t("manage_files")}
          </button>
        </div>

        <Button
          type="button"
          onClick={() =>
            hasReachedLimit && isWebDavConfigured
              ? handleUploadWebDavBackup()
              : uploadSaveGame(lastDownloadedOption?.title ?? null)
          }
          disabled={
            disableActions ||
            !backupPreview?.overall.totalGames ||
            (hasReachedLimit && !isWebDavConfigured)
          }
        >
          {uploadingBackup || uploadingWebDavBackup ? (
            <SyncIcon className="cloud-sync-panel__sync-icon" />
          ) : (
            <UploadIcon />
          )}
          {t("create_backup")}
        </Button>
      </div>

      <div className="cloud-sync-panel__backups-header">
        <h3>{t("backups")}</h3>
        <span className="cloud-sync-panel__backups-count">
          {formatNumber(mergedBackupRows.length)}
        </span>
      </div>

      {mergedBackupRows.length > 0 ? (
        <ul className="cloud-sync-panel__artifacts">
          {mergedBackupRows.map((row) => {
            const artifact = row.hydraArtifact;
            const webDavBackup = row.webDavBackup;
            const isHydra = Boolean(artifact);
            const isWebDav = Boolean(webDavBackup);
            const artifactName = artifact
              ? (artifact.label ??
                t("backup_from", {
                  date: formatDate(artifact.createdAt),
                }))
              : (webDavBackup?.filename ?? "").replace(/\.tar$/i, "");
            const hostname = artifact?.hostname
              ? artifact.hostname
              : (webDavBackup?.hostname ?? "");
            const sizeInBytes =
              artifact?.artifactLengthInBytes ?? webDavBackup?.sizeInBytes ?? 0;
            const createdAt =
              artifact?.createdAt ?? webDavBackup?.createdAt ?? "";
            const backupInfo =
              artifact?.downloadOptionTitle ??
              webDavBackup?.downloadOptionTitle ??
              t("no_download_option_info");
            const isFrozen = artifact?.isFrozen ?? false;
            const isWebDavPinned = webDavBackup
              ? pinnedWebDavBackups.includes(webDavBackup.href)
              : false;

            return (
              <li key={row.key} className="cloud-sync-panel__artifact">
                <div className="cloud-sync-panel__artifact-info">
                  <div className="cloud-sync-panel__artifact-header">
                    {artifact || webDavBackup ? (
                      <button
                        type="button"
                        className="cloud-sync-panel__artifact-label"
                        onClick={() => {
                          if (artifact) {
                            setArtifactToRename(artifact);
                          } else if (webDavBackup) {
                            setWebDavBackupToRename(webDavBackup);
                          }
                        }}
                        data-tooltip-id="cloud-sync-artifact-name-tooltip"
                        data-tooltip-content={artifactName}
                      >
                        <span className="cloud-sync-panel__artifact-label-text">
                          {artifactName}
                        </span>
                        <PencilIcon />
                      </button>
                    ) : (
                      <span className="cloud-sync-panel__artifact-label-text">
                        {artifactName}
                      </span>
                    )}
                    <small>{formatBytes(sizeInBytes)}</small>
                    <div className="cloud-sync-panel__artifact-source-badges">
                      {isHydra && (
                        <span className="cloud-sync-panel__source-badge">
                          Hydra Cloud
                        </span>
                      )}
                      {isWebDav && (
                        <span className="cloud-sync-panel__source-badge">
                          WebDAV
                        </span>
                      )}
                    </div>
                  </div>

                  {hostname && (
                    <span className="cloud-sync-panel__artifact-meta">
                      <DeviceDesktopIcon size={14} />
                      {hostname}
                    </span>
                  )}

                  {(artifact || webDavBackup) && (
                    <span className="cloud-sync-panel__artifact-meta">
                      <InfoIcon size={14} />
                      {backupInfo}
                    </span>
                  )}

                  {createdAt && (
                    <span className="cloud-sync-panel__artifact-meta">
                      <ClockIcon size={14} />
                      {formatDateTime(createdAt)}
                    </span>
                  )}
                </div>

                <div className="cloud-sync-panel__artifact-actions">
                  {artifact && (
                    <>
                      <Button
                        type="button"
                        onClick={() => handleBackupInstallClick(artifact.id)}
                        disabled={disableActions}
                        theme="outline"
                      >
                        {restoringBackup ? (
                          <SyncIcon className="cloud-sync-panel__sync-icon" />
                        ) : (
                          <HistoryIcon />
                        )}
                        {t("install_backup")}
                      </Button>
                      <DropdownMenu
                        align="end"
                        items={[
                          {
                            label: webDavBackup
                              ? isFrozen
                                ? `${t("unfreeze_backup")} (Hydra Cloud)`
                                : `${t("freeze_backup")} (Hydra Cloud)`
                              : isFrozen
                                ? t("unfreeze_backup")
                                : t("freeze_backup"),
                            icon: isFrozen ? <PinSlashIcon /> : <PinIcon />,
                            onClick: () =>
                              handleFreezeArtifactClick(artifact.id, !isFrozen),
                            disabled: disableActions,
                          },
                          ...(webDavBackup
                            ? [
                                {
                                  label: isWebDavPinned
                                    ? `${t("unfreeze_backup")} (WebDAV)`
                                    : `${t("freeze_backup")} (WebDAV)`,
                                  icon: isWebDavPinned ? (
                                    <PinSlashIcon />
                                  ) : (
                                    <PinIcon />
                                  ),
                                  onClick: () =>
                                    handleTogglePinWebDavBackup(
                                      webDavBackup.href
                                    ),
                                  disabled: disableActions,
                                },
                              ]
                            : []),
                          {
                            label: webDavBackup
                              ? `${t("delete_backup")} (Hydra Cloud)`
                              : t("delete_backup"),
                            icon: <TrashIcon />,
                            onClick: () =>
                              handleDeleteArtifactClick(artifact.id),
                            disabled: disableActions || isFrozen,
                          },
                          ...(webDavBackup
                            ? [
                                {
                                  label: `${t("delete_backup")} (WebDAV)`,
                                  icon: <TrashIcon />,
                                  onClick: () =>
                                    handleDeleteWebDavBackup(webDavBackup.href),
                                  disabled: disableActions,
                                },
                              ]
                            : []),
                        ]}
                      >
                        <Button
                          type="button"
                          theme="outline"
                          tooltip={t("options")}
                        >
                          <MoreVertical size={16} />
                        </Button>
                      </DropdownMenu>
                    </>
                  )}
                  {!artifact && webDavBackup && (
                    <>
                      <Button
                        type="button"
                        onClick={() =>
                          handleRestoreWebDavBackup(webDavBackup.href)
                        }
                        disabled={disableActions}
                        theme="outline"
                      >
                        {restoringWebDavBackup ? (
                          <SyncIcon className="cloud-sync-panel__sync-icon" />
                        ) : (
                          <HistoryIcon />
                        )}
                        {t("install_backup")}
                      </Button>
                      <DropdownMenu
                        align="end"
                        items={[
                          {
                            label: isWebDavPinned
                              ? t("unfreeze_backup")
                              : t("freeze_backup"),
                            icon: isWebDavPinned ? (
                              <PinSlashIcon />
                            ) : (
                              <PinIcon />
                            ),
                            onClick: () =>
                              handleTogglePinWebDavBackup(webDavBackup.href),
                            disabled: disableActions,
                          },
                          {
                            label: t("delete_backup"),
                            icon: <TrashIcon />,
                            onClick: () =>
                              handleDeleteWebDavBackup(webDavBackup.href),
                            disabled: disableActions,
                          },
                        ]}
                      >
                        <Button
                          type="button"
                          theme="outline"
                          tooltip={t("options")}
                        >
                          <MoreVertical size={16} />
                        </Button>
                      </DropdownMenu>
                    </>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <p>{t("no_backups_created")}</p>
      )}

      <Tooltip id="cloud-sync-artifact-name-tooltip" />
    </>
  );
}
