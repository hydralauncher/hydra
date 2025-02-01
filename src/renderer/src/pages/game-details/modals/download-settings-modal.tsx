import { useCallback, useEffect, useMemo, useState } from "react";
import { Trans, useTranslation } from "react-i18next";

import * as styles from "./download-settings-modal.css";
import { Button, Link, Modal, TextField } from "@renderer/components";
import { CheckCircleFillIcon, DownloadIcon } from "@primer/octicons-react";
import { Downloader, formatBytes, getDownloadersForUris } from "@shared";

import type { GameRepack } from "@types";
import { SPACING_UNIT } from "@renderer/theme.css";
import { DOWNLOADER_NAME } from "@renderer/constants";
import { useAppSelector, useFeature, useToast } from "@renderer/hooks";

export interface DownloadSettingsModalProps {
  visible: boolean;
  onClose: () => void;
  startDownload: (
    repack: GameRepack,
    downloader: Downloader,
    downloadPath: string
  ) => Promise<void>;
  repack: GameRepack | null;
}

export function DownloadSettingsModal({
  visible,
  onClose,
  startDownload,
  repack,
}: DownloadSettingsModalProps) {
  const { t } = useTranslation("game_details");

  const { showErrorToast } = useToast();

  const [diskFreeSpace, setDiskFreeSpace] = useState<number | null>(null);
  const [selectedPath, setSelectedPath] = useState("");
  const [downloadStarting, setDownloadStarting] = useState(false);
  const [selectedDownloader, setSelectedDownloader] =
    useState<Downloader | null>(null);
  const [hasWritePermission, setHasWritePermission] = useState<boolean | null>(
    null
  );

  const { isFeatureEnabled, Feature } = useFeature();

  const userPreferences = useAppSelector(
    (state) => state.userPreferences.value
  );

  const getDiskFreeSpace = (path: string) => {
    window.electron.getDiskFreeSpace(path).then((result) => {
      setDiskFreeSpace(result.free);
    });
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
      return true;
    });

    /* Gives preference to TorBox */
    const selectedDownloader = filteredDownloaders.includes(Downloader.TorBox)
      ? Downloader.TorBox
      : filteredDownloaders[0];

    setSelectedDownloader(selectedDownloader ?? null);
  }, [
    userPreferences?.downloadsPath,
    downloaders,
    userPreferences?.realDebridApiToken,
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

  const handleStartClick = () => {
    if (repack) {
      setDownloadStarting(true);

      startDownload(repack, selectedDownloader!, selectedPath)
        .then(() => {
          onClose();
        })
        .catch(() => {
          showErrorToast(t("download_error"));
        })
        .finally(() => {
          setDownloadStarting(false);
        });
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
      <div className={styles.container}>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: `${SPACING_UNIT}px`,
          }}
        >
          <span>{t("downloader")}</span>

          <div className={styles.downloaders}>
            {downloaders.map((downloader) => (
              <Button
                key={downloader}
                className={styles.downloaderOption}
                theme={
                  selectedDownloader === downloader ? "primary" : "outline"
                }
                disabled={
                  downloader === Downloader.RealDebrid &&
                  !userPreferences?.realDebridApiToken
                }
                onClick={() => setSelectedDownloader(downloader)}
              >
                {selectedDownloader === downloader && (
                  <CheckCircleFillIcon className={styles.downloaderIcon} />
                )}
                {DOWNLOADER_NAME[downloader]}
              </Button>
            ))}
          </div>
        </div>

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: `${SPACING_UNIT}px`,
          }}
        >
          <TextField
            value={selectedPath}
            readOnly
            disabled
            label={t("download_path")}
            error={
              hasWritePermission === false ? (
                <span
                  className={styles.pathError}
                  data-open-article="cannot-write-directory"
                >
                  {t("no_write_permission")}
                </span>
              ) : undefined
            }
            rightContent={
              <Button
                style={{ alignSelf: "flex-end" }}
                theme="outline"
                onClick={handleChooseDownloadsPath}
                disabled={downloadStarting}
              >
                {t("change")}
              </Button>
            }
          />

          <p className={styles.hintText}>
            <Trans i18nKey="select_folder_hint" ns="game_details">
              <Link to="/settings" />
            </Trans>
          </p>
        </div>

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
