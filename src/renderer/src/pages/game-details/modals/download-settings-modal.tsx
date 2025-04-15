import { useCallback, useEffect, useMemo, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import {
  Button,
  CheckboxField,
  Link,
  Modal,
  TextField,
} from "@renderer/components";
import { CheckCircleFillIcon, DownloadIcon } from "@primer/octicons-react";
import { Downloader, formatBytes, getDownloadersForUris } from "@shared";
import type { GameRepack } from "@types";
import { DOWNLOADER_NAME } from "@renderer/constants";
import { useAppSelector, useFeature, useToast } from "@renderer/hooks";
import "./download-settings-modal.scss";

export interface DownloadSettingsModalProps {
  visible: boolean;
  onClose: () => void;
  startDownload: (
    repack: GameRepack,
    downloader: Downloader,
    downloadPath: string,
    automaticallyExtract: boolean
  ) => Promise<{ ok: boolean; error?: string }>;
  repack: GameRepack | null;
}

export function DownloadSettingsModal({
  visible,
  onClose,
  startDownload,
  repack,
}: Readonly<DownloadSettingsModalProps>) {
  const { t } = useTranslation("game_details");

  const { showErrorToast } = useToast();

  const [diskFreeSpace, setDiskFreeSpace] = useState<number | null>(null);
  const [selectedPath, setSelectedPath] = useState("");
  const [downloadStarting, setDownloadStarting] = useState(false);
  const [automaticExtractionEnabled, setAutomaticExtractionEnabled] =
    useState(true);
  const [selectedDownloader, setSelectedDownloader] =
    useState<Downloader | null>(null);
  const [hasWritePermission, setHasWritePermission] = useState<boolean | null>(
    null
  );

  const { isFeatureEnabled, Feature } = useFeature();

  const userPreferences = useAppSelector(
    (state) => state.userPreferences.value
  );

  const getDiskFreeSpace = async (path: string) => {
    const result = await window.electron.getDiskFreeSpace(path);
    setDiskFreeSpace(result.free);
  };

  const checkFolderWritePermission = useCallback(
    async (path: string) => {
      if (isFeatureEnabled(Feature.CheckDownloadWritePermission)) {
        const result = await window.electron.checkFolderWritePermission(path);
        setHasWritePermission(result);
      } else {
        setHasWritePermission(true);
      }
    },
    [Feature, isFeatureEnabled]
  );

  useEffect(() => {
    if (visible) {
      getDiskFreeSpace(selectedPath);
      checkFolderWritePermission(selectedPath);
    }
  }, [visible, checkFolderWritePermission, selectedPath]);

  const downloaders = useMemo(() => {
    return getDownloadersForUris(repack?.uris ?? []);
  }, [repack?.uris]);

  const getDefaultDownloader = useCallback(
    (availableDownloaders: Downloader[]) => {
      if (availableDownloaders.includes(Downloader.Hydra)) {
        return Downloader.Hydra;
      }

      if (availableDownloaders.includes(Downloader.RealDebrid)) {
        return Downloader.RealDebrid;
      }

      if (availableDownloaders.includes(Downloader.TorBox)) {
        return Downloader.TorBox;
      }

      return availableDownloaders[0];
    },
    []
  );

  useEffect(() => {
    if (userPreferences?.downloadsPath) {
      setSelectedPath(userPreferences.downloadsPath);
    } else {
      window.electron
        .getDefaultDownloadsPath()
        .then((defaultDownloadsPath) => setSelectedPath(defaultDownloadsPath));
    }

    const filteredDownloaders = downloaders.filter((downloader) => {
      if (downloader === Downloader.RealDebrid)
        return userPreferences?.realDebridApiToken;
      if (downloader === Downloader.TorBox)
        return userPreferences?.torBoxApiToken;
      if (downloader === Downloader.Hydra)
        return isFeatureEnabled(Feature.Nimbus);
      return true;
    });

    setSelectedDownloader(getDefaultDownloader(filteredDownloaders));
  }, [
    Feature,
    isFeatureEnabled,
    getDefaultDownloader,
    userPreferences?.downloadsPath,
    downloaders,
    userPreferences?.realDebridApiToken,
    userPreferences?.torBoxApiToken,
  ]);

  const handleChooseDownloadsPath = async () => {
    const { filePaths } = await window.electron.showOpenDialog({
      defaultPath: selectedPath,
      properties: ["openDirectory"],
    });

    if (filePaths && filePaths.length > 0) {
      const path = filePaths[0];
      setSelectedPath(path);
    }
  };

  const handleStartClick = async () => {
    if (repack) {
      setDownloadStarting(true);

      try {
        const response = await startDownload(
          repack,
          selectedDownloader!,
          selectedPath,
          automaticExtractionEnabled
        );

        if (response.ok) {
          onClose();
          return;
        } else if (response.error) {
          showErrorToast(t("download_error"), t(response.error), 4_000);
        }
      } catch (error) {
        if (error instanceof Error) {
          showErrorToast(t("download_error"), error.message, 4_000);
        }
      } finally {
        setDownloadStarting(false);
      }
    }
  };

  return (
    <Modal
      visible={visible}
      title={t("download_settings")}
      description={t("space_left_on_disk", {
        space: formatBytes(diskFreeSpace ?? 0),
      })}
      onClose={onClose}
    >
      <div className="download-settings-modal__container">
        <div className="download-settings-modal__downloads-path-field">
          <span>{t("downloader")}</span>

          <div className="download-settings-modal__downloaders">
            {downloaders.map((downloader) => {
              const shouldDisableButton =
                (downloader === Downloader.RealDebrid &&
                  !userPreferences?.realDebridApiToken) ||
                (downloader === Downloader.TorBox &&
                  !userPreferences?.torBoxApiToken) ||
                (downloader === Downloader.Hydra &&
                  !isFeatureEnabled(Feature.Nimbus));

              return (
                <Button
                  key={downloader}
                  className="download-settings-modal__downloader-option"
                  theme={
                    selectedDownloader === downloader ? "primary" : "outline"
                  }
                  disabled={shouldDisableButton}
                  onClick={() => setSelectedDownloader(downloader)}
                >
                  {selectedDownloader === downloader && (
                    <CheckCircleFillIcon className="download-settings-modal__downloader-icon" />
                  )}
                  {DOWNLOADER_NAME[downloader]}
                </Button>
              );
            })}
          </div>
        </div>

        <div className="download-settings-modal__downloads-path-field">
          <TextField
            value={selectedPath}
            readOnly
            disabled
            label={t("download_path")}
            error={
              hasWritePermission === false ? (
                <span
                  className="download-settings-modal__path-error"
                  data-open-article="cannot-write-directory"
                >
                  {t("no_write_permission")}
                </span>
              ) : undefined
            }
            rightContent={
              <Button
                className="download-settings-modal__change-path-button"
                theme="outline"
                onClick={handleChooseDownloadsPath}
                disabled={downloadStarting}
              >
                {t("change")}
              </Button>
            }
          />

          <p className="download-settings-modal__hint-text">
            <Trans i18nKey="select_folder_hint" ns="game_details">
              <Link to="/settings" />
            </Trans>
          </p>
        </div>

        <CheckboxField
          label={t("automatically_extract_downloaded_files")}
          checked={automaticExtractionEnabled}
          onChange={() =>
            setAutomaticExtractionEnabled(!automaticExtractionEnabled)
          }
        />

        <Button
          onClick={handleStartClick}
          disabled={
            downloadStarting ||
            selectedDownloader === null ||
            !hasWritePermission
          }
        >
          <DownloadIcon />
          {t("download_now")}
        </Button>
      </div>
    </Modal>
  );
}
