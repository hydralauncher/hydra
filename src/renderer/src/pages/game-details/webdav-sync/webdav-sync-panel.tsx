import { Button, CheckboxField } from "@renderer/components";
import { useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ChangeEvent } from "react";
import { gameDetailsContext } from "@renderer/context";
import "./webdav-sync-panel.scss";
import { formatBytes } from "@shared";
import {
  ClockIcon,
  DeviceDesktopIcon,
  HistoryIcon,
  InfoIcon,
  SyncIcon,
  UploadIcon,
} from "@primer/octicons-react";
import { useAppSelector, useDate, useToast } from "@renderer/hooks";
import { useTranslation } from "react-i18next";
import { AxiosProgressEvent } from "axios";
import { formatDownloadProgress } from "@renderer/helpers";
import type { WebDavBackupEntry } from "@types";

interface WebDavSyncPanelProps {
  automaticWebDavSync: boolean;
  onToggleAutomaticWebDavSync: (event: ChangeEvent<HTMLInputElement>) => void;
}

export function WebDavSyncPanel({
  automaticWebDavSync,
  onToggleAutomaticWebDavSync,
}: Readonly<WebDavSyncPanelProps>) {
  const [backups, setBackups] = useState<WebDavBackupEntry[]>([]);
  const [loadingBackups, setLoadingBackups] = useState(false);
  const [uploadingBackup, setUploadingBackup] = useState(false);
  const [restoringBackup, setRestoringBackup] = useState(false);
  const [backupDownloadProgress, setBackupDownloadProgress] =
    useState<AxiosProgressEvent | null>(null);

  const { t } = useTranslation("game_details");

  const { objectId, shop, lastDownloadedOption, game } =
    useContext(gameDetailsContext);

  const { showSuccessToast, showErrorToast } = useToast();
  const { formatDateTime } = useDate();

  const userPreferences = useAppSelector(
    (state) => state.userPreferences.value
  );

  const isWebDavConfigured = Boolean(
    userPreferences?.webDavHost &&
      userPreferences?.webDavUsername &&
      userPreferences?.webDavPassword
  );

  const loadBackups = useCallback(async () => {
    if (!isWebDavConfigured || !objectId) return;
    setLoadingBackups(true);
    try {
      const list = await window.electron.listWebDavBackups(objectId, shop);
      setBackups(list);
    } catch {
      setBackups([]);
    } finally {
      setLoadingBackups(false);
    }
  }, [isWebDavConfigured, objectId, shop]);

  useEffect(() => {
    if (isWebDavConfigured) {
      loadBackups();
    }
  }, [isWebDavConfigured, loadBackups]);

  useEffect(() => {
    const removeProgressListener =
      window.electron.onWebDavBackupDownloadProgress(
        objectId!,
        shop,
        (progressEvent) => {
          setBackupDownloadProgress(progressEvent);
        }
      );

    const removeCompleteListener =
      window.electron.onWebDavBackupDownloadComplete(
        objectId!,
        shop,
        (success) => {
          setRestoringBackup(false);
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

  const handleUploadBackup = async () => {
    if (!objectId) return;
    setUploadingBackup(true);
    try {
      await window.electron.uploadSaveGameToWebDav(
        objectId,
        shop,
        lastDownloadedOption?.title ?? null
      );
      showSuccessToast(t("webdav_upload_success"));
      await loadBackups();
    } catch {
      showErrorToast(t("webdav_upload_failed"));
    } finally {
      setUploadingBackup(false);
    }
  };

  const handleRestoreBackup = async (href: string) => {
    if (!objectId) return;
    setBackupDownloadProgress(null);
    setRestoringBackup(true);
    try {
      await window.electron.downloadWebDavBackup(objectId, shop, href);
    } catch {
      setRestoringBackup(false);
      showErrorToast(t("webdav_restore_failed"));
    }
  };

  const disableActions = uploadingBackup || restoringBackup;

  const backupStateLabel = useMemo(() => {
    if (uploadingBackup) {
      return (
        <span className="webdav-sync-panel__backup-state-label">
          <SyncIcon className="webdav-sync-panel__sync-icon" />
          {t("uploading_backup")}
        </span>
      );
    }
    if (restoringBackup) {
      return (
        <span className="webdav-sync-panel__backup-state-label">
          <SyncIcon className="webdav-sync-panel__sync-icon" />
          {t("webdav_restoring", {
            progress: formatDownloadProgress(
              backupDownloadProgress?.progress ?? 0
            ),
          })}
        </span>
      );
    }
    if (loadingBackups) {
      return (
        <span className="webdav-sync-panel__backup-state-label">
          <SyncIcon className="webdav-sync-panel__sync-icon" />
          {t("webdav_loading_backups")}
        </span>
      );
    }
    if (backups.length === 0) {
      return t("webdav_no_backups");
    }
    return "";
  }, [
    backupDownloadProgress?.progress,
    backups.length,
    loadingBackups,
    restoringBackup,
    t,
    uploadingBackup,
  ]);

  if (!isWebDavConfigured) {
    return (
      <div className="webdav-sync-panel__not-configured">
        <p>{t("webdav_not_configured")}</p>
      </div>
    );
  }

  return (
    <>
      <div className="webdav-sync-panel__section-header">
        <h2>{t("webdav_save")}</h2>
        <p>{t("webdav_save_description")}</p>
      </div>

      <div className="webdav-sync-panel__automatic-sync">
        <CheckboxField
          label={t("enable_automatic_webdav_sync")}
          checked={automaticWebDavSync}
          disabled={!game?.executablePath}
          onChange={onToggleAutomaticWebDavSync}
        />
      </div>

      <div className="webdav-sync-panel__header">
        <div className="webdav-sync-panel__title-container">
          <p>{backupStateLabel}</p>
        </div>

        <Button
          type="button"
          onClick={handleUploadBackup}
          disabled={disableActions}
        >
          {uploadingBackup ? (
            <SyncIcon className="webdav-sync-panel__sync-icon" />
          ) : (
            <UploadIcon />
          )}
          {t("webdav_create_backup")}
        </Button>
      </div>

      <div className="webdav-sync-panel__backups-header">
        <h3>{t("backups")}</h3>
        <span className="webdav-sync-panel__backups-count">
          {backups.length}
        </span>
      </div>

      {backups.length > 0 ? (
        <ul className="webdav-sync-panel__artifacts">
          {backups.map((backup) => (
            <li key={backup.href} className="webdav-sync-panel__artifact">
              <div className="webdav-sync-panel__artifact-info">
                <div className="webdav-sync-panel__artifact-header">
                  <span className="webdav-sync-panel__artifact-name">
                    {backup.filename}
                  </span>
                  <small>{formatBytes(backup.sizeInBytes)}</small>
                </div>

                {backup.createdAt && (
                  <span className="webdav-sync-panel__artifact-meta">
                    <ClockIcon size={14} />
                    {formatDateTime(new Date(backup.createdAt))}
                  </span>
                )}

                {backup.hostname && (
                  <span className="webdav-sync-panel__artifact-meta">
                    <DeviceDesktopIcon size={14} />
                    {backup.hostname}
                  </span>
                )}

                <span className="webdav-sync-panel__artifact-meta">
                  <InfoIcon size={14} />
                  {backup.downloadOptionTitle ?? t("no_download_option_info")}
                </span>
              </div>

              <div className="webdav-sync-panel__artifact-actions">
                <Button
                  type="button"
                  onClick={() => handleRestoreBackup(backup.href)}
                  disabled={disableActions}
                  theme="outline"
                >
                  {restoringBackup ? (
                    <SyncIcon className="webdav-sync-panel__sync-icon" />
                  ) : (
                    <HistoryIcon />
                  )}
                  {t("webdav_restore_backup")}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        !loadingBackups && <p>{t("no_backups_created")}</p>
      )}
    </>
  );
}
