import { useCallback, useEffect, useMemo, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import {
  Badge,
  Button,
  CheckboxField,
  Link,
  Modal,
  TextField,
} from "@renderer/components";
import {
  DownloadIcon,
  SyncIcon,
  CheckCircleFillIcon,
} from "@primer/octicons-react";
import { Downloader, formatBytes, getDownloadersForUri } from "@shared";
import type { GameRepack } from "@types";
import { DOWNLOADER_NAME } from "@renderer/constants";
import { useAppSelector, useFeature, useToast } from "@renderer/hooks";
import { motion } from "framer-motion";
import { Tooltip } from "react-tooltip";
import { RealDebridInfoModal } from "./real-debrid-info-modal";
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

  const userPreferences = useAppSelector(
    (state) => state.userPreferences.value
  );

  const { showErrorToast } = useToast();

  const [diskFreeSpace, setDiskFreeSpace] = useState<number | null>(null);
  const [selectedPath, setSelectedPath] = useState("");
  const [downloadStarting, setDownloadStarting] = useState(false);
  const [automaticExtractionEnabled, setAutomaticExtractionEnabled] = useState(
    userPreferences?.extractFilesByDefault ?? true
  );
  const [selectedDownloader, setSelectedDownloader] =
    useState<Downloader | null>(null);
  const [hasWritePermission, setHasWritePermission] = useState<boolean | null>(
    null
  );
  const [showRealDebridModal, setShowRealDebridModal] = useState(false);

  const { isFeatureEnabled, Feature } = useFeature();

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

  const downloadOptions = useMemo(() => {
    const unavailableUrisSet = new Set(repack?.unavailableUris ?? []);

    const downloaderMap = new Map<
      Downloader,
      { hasAvailable: boolean; hasUnavailable: boolean }
    >();

    if (repack) {
      for (const uri of repack.uris) {
        const uriDownloaders = getDownloadersForUri(uri);
        const isAvailable = !unavailableUrisSet.has(uri);

        for (const downloader of uriDownloaders) {
          const existing = downloaderMap.get(downloader);
          if (existing) {
            existing.hasAvailable = existing.hasAvailable || isAvailable;
            existing.hasUnavailable = existing.hasUnavailable || !isAvailable;
          } else {
            downloaderMap.set(downloader, {
              hasAvailable: isAvailable,
              hasUnavailable: !isAvailable,
            });
          }
        }
      }
    }

    const allDownloaders = Object.values(Downloader).filter(
      (value) => typeof value === "number"
    ) as Downloader[];

    const getDownloaderPriority = (option: {
      isAvailable: boolean;
      canHandle: boolean;
      isAvailableButNotConfigured: boolean;
    }) => {
      if (option.isAvailable) return 0;
      if (option.canHandle && !option.isAvailableButNotConfigured) return 1;
      if (option.isAvailableButNotConfigured) return 2;
      return 3;
    };

    return allDownloaders
      .filter((downloader) => downloader !== Downloader.Hydra) // Temporarily comment out Nimbus
      .map((downloader) => {
        const status = downloaderMap.get(downloader);
        const canHandle = status !== undefined;
        const isAvailable = status?.hasAvailable ?? false;

        let isConfigured = true;
        if (downloader === Downloader.RealDebrid) {
          isConfigured = !!userPreferences?.realDebridApiToken;
        } else if (downloader === Downloader.TorBox) {
          isConfigured = !!userPreferences?.torBoxApiToken;
        }
        // } else if (downloader === Downloader.Hydra) {
        //   isConfigured = isFeatureEnabled(Feature.Nimbus);
        // }

        const isAvailableButNotConfigured =
          isAvailable && !isConfigured && canHandle;

        return {
          downloader,
          isAvailable: isAvailable && isConfigured,
          canHandle,
          isAvailableButNotConfigured,
        };
      })
      .sort((a, b) => getDownloaderPriority(a) - getDownloaderPriority(b));
  }, [
    repack,
    userPreferences?.realDebridApiToken,
    userPreferences?.torBoxApiToken,
  ]);

  const getDefaultDownloader = useCallback(
    (availableDownloaders: Downloader[]) => {
      if (availableDownloaders.length === 0) return null;

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

    const availableDownloaders = downloadOptions
      .filter((option) => option.isAvailable)
      .map((option) => option.downloader);

    setSelectedDownloader(getDefaultDownloader(availableDownloaders));
  }, [getDefaultDownloader, userPreferences?.downloadsPath, downloadOptions]);

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

          <div className="download-settings-modal__downloaders-list-wrapper">
            <div className="download-settings-modal__downloaders-list">
              {downloadOptions.map((option, index) => {
                const isSelected = selectedDownloader === option.downloader;
                const tooltipId = `availability-indicator-${option.downloader}`;
                const isLastItem = index === downloadOptions.length - 1;

                const Indicator = option.isAvailable ? motion.span : "span";

                const isDisabled =
                  !option.canHandle ||
                  (!option.isAvailable && !option.isAvailableButNotConfigured);

                const getAvailabilityIndicator = () => {
                  if (option.isAvailable) {
                    return (
                      <Indicator
                        className={`download-settings-modal__availability-indicator download-settings-modal__availability-indicator--available download-settings-modal__availability-indicator--pulsating`}
                        animate={{
                          scale: [1, 1.1, 1],
                          opacity: [1, 0.7, 1],
                        }}
                        transition={{
                          duration: 2,
                          repeat: Infinity,
                          ease: "easeInOut",
                        }}
                        data-tooltip-id={tooltipId}
                        data-tooltip-content={t("downloader_online")}
                      />
                    );
                  }

                  if (option.isAvailableButNotConfigured) {
                    return (
                      <span
                        className={`download-settings-modal__availability-indicator download-settings-modal__availability-indicator--warning`}
                        data-tooltip-id={tooltipId}
                        data-tooltip-content={t("downloader_not_configured")}
                      />
                    );
                  }

                  if (option.canHandle) {
                    return (
                      <span
                        className={`download-settings-modal__availability-indicator download-settings-modal__availability-indicator--unavailable`}
                        data-tooltip-id={tooltipId}
                        data-tooltip-content={t("downloader_offline")}
                      />
                    );
                  }

                  return (
                    <span
                      className={`download-settings-modal__availability-indicator download-settings-modal__availability-indicator--not-present`}
                      data-tooltip-id={tooltipId}
                      data-tooltip-content={t("downloader_not_available")}
                    />
                  );
                };

                const getRightContent = () => {
                  if (isSelected) {
                    return (
                      <motion.div
                        className="download-settings-modal__check-icon-wrapper"
                        initial={{ scale: 0 }}
                        animate={{ scale: 1 }}
                        transition={{
                          type: "spring",
                          stiffness: 300,
                          damping: 20,
                        }}
                      >
                        <CheckCircleFillIcon
                          size={16}
                          className="download-settings-modal__check-icon"
                        />
                      </motion.div>
                    );
                  }

                  if (
                    option.downloader === Downloader.RealDebrid &&
                    option.canHandle
                  ) {
                    return (
                      <div className="download-settings-modal__recommendation-badge">
                        <Badge>{t("recommended")}</Badge>
                      </div>
                    );
                  }

                  return null;
                };

                return (
                  <div
                    key={option.downloader}
                    className="download-settings-modal__downloader-item-wrapper"
                  >
                    <button
                      type="button"
                      className={`download-settings-modal__downloader-item ${
                        isSelected
                          ? "download-settings-modal__downloader-item--selected"
                          : ""
                      } ${
                        isLastItem
                          ? "download-settings-modal__downloader-item--last"
                          : ""
                      }`}
                      disabled={isDisabled}
                      onClick={() => {
                        if (
                          option.downloader === Downloader.RealDebrid &&
                          option.isAvailableButNotConfigured
                        ) {
                          setShowRealDebridModal(true);
                        } else {
                          setSelectedDownloader(option.downloader);
                        }
                      }}
                    >
                      <span className="download-settings-modal__downloader-name">
                        {DOWNLOADER_NAME[option.downloader]}
                      </span>
                      <div className="download-settings-modal__availability-indicator-wrapper">
                        {getAvailabilityIndicator()}
                      </div>
                      <Tooltip id={tooltipId} />
                      {getRightContent()}
                    </button>
                  </div>
                );
              })}
            </div>
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
            !hasWritePermission ||
            downloadOptions.some(
              (option) =>
                option.downloader === selectedDownloader &&
                (option.isAvailableButNotConfigured ||
                  (!option.isAvailable && option.canHandle) ||
                  !option.canHandle)
            )
          }
        >
          {downloadStarting ? (
            <>
              <SyncIcon className="download-settings-modal__loading-spinner" />
              {t("loading")}
            </>
          ) : (
            <>
              <DownloadIcon />
              {t("download_now")}
            </>
          )}
        </Button>
      </div>

      <RealDebridInfoModal
        visible={showRealDebridModal}
        onClose={() => setShowRealDebridModal(false)}
      />
    </Modal>
  );
}
