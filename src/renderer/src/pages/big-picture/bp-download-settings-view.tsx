import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Downloader,
  formatBytes,
  getDownloadersForUri,
  parseBytes,
} from "@shared";
import type { GameRepack, DiskUsage } from "@types";
import { DOWNLOADER_NAME } from "@renderer/constants";
import { useAppSelector, useDownload, useFeature } from "@renderer/hooks";
import "./bp-download-settings-view.scss";

interface BpDownloadSettingsViewProps {
  repack: GameRepack;
  onStartDownload: (
    repack: GameRepack,
    downloader: Downloader,
    downloadPath: string,
    automaticallyExtract: boolean,
    addToQueueOnly?: boolean
  ) => Promise<{ ok: boolean; error?: string }>;
}

export function BpDownloadSettingsView({
  repack,
  onStartDownload,
}: Readonly<BpDownloadSettingsViewProps>) {
  const { t } = useTranslation("big_picture");

  const userPreferences = useAppSelector(
    (state) => state.userPreferences.value
  );
  const { lastPacket } = useDownload();
  const { isFeatureEnabled, Feature } = useFeature();

  const hasActiveDownload = lastPacket !== null;

  const [diskFreeSpace, setDiskFreeSpace] = useState<number | null>(null);
  const [diskUsage, setDiskUsage] = useState<DiskUsage | null>(null);
  const [selectedPath, setSelectedPath] = useState("");
  const [downloadStarting, setDownloadStarting] = useState(false);
  const [automaticExtractionEnabled, setAutomaticExtractionEnabled] = useState(
    userPreferences?.extractFilesByDefault ?? true
  );
  const [hasWritePermission, setHasWritePermission] = useState<boolean | null>(
    null
  );

  const getDiskFreeSpace = async (path: string) => {
    const result = await window.electron.getDiskFreeSpace(path);
    setDiskFreeSpace(result.free);
    setDiskUsage(result);
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
    getDiskFreeSpace(selectedPath);
    checkFolderWritePermission(selectedPath);
  }, [checkFolderWritePermission, selectedPath]);

  const estimatedSizeBytes = useMemo(() => {
    if (!repack.fileSize) return null;
    return parseBytes(repack.fileSize);
  }, [repack.fileSize]);

  const hasEnoughSpace = useMemo(() => {
    if (diskFreeSpace === null || estimatedSizeBytes === null) return true;
    return diskFreeSpace >= estimatedSizeBytes;
  }, [diskFreeSpace, estimatedSizeBytes]);

  const downloadOptions = useMemo(() => {
    const unavailableUrisSet = new Set(repack.unavailableUris ?? []);

    const downloaderMap = new Map<
      Downloader,
      { hasAvailable: boolean; hasUnavailable: boolean }
    >();

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
      .filter((downloader) => downloader !== Downloader.Hydra)
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

  useEffect(() => {
    if (userPreferences?.downloadsPath) {
      setSelectedPath(userPreferences.downloadsPath);
    } else {
      window.electron
        .getDefaultDownloadsPath()
        .then((defaultDownloadsPath) => setSelectedPath(defaultDownloadsPath));
    }
  }, [userPreferences?.downloadsPath]);

  const handleChooseDownloadsPath = async () => {
    const { filePaths } = await window.electron.showOpenDialog({
      defaultPath: selectedPath,
      properties: ["openDirectory"],
    });

    if (filePaths && filePaths.length > 0) {
      setSelectedPath(filePaths[0]);
    }
  };

  const handleStartWithDownloader = async (downloader: Downloader) => {
    if (!repack || downloadStarting) return;

    setDownloadStarting(true);
    try {
      const response = await onStartDownload(
        repack,
        downloader,
        selectedPath,
        automaticExtractionEnabled,
        hasActiveDownload
      );

      if (response.error) {
        /* error handled by parent */
      }
    } finally {
      setDownloadStarting(false);
    }
  };

  const storageBarSegments = useMemo(() => {
    if (!diskUsage) return null;

    const usedSpace = diskUsage.total - diskUsage.free;
    const usedPercent = (usedSpace / diskUsage.total) * 100;
    const downloadPercent = estimatedSizeBytes
      ? (estimatedSizeBytes / diskUsage.total) * 100
      : 0;

    return { usedPercent, downloadPercent };
  }, [diskUsage, estimatedSizeBytes]);

  const getStatusLabel = (option: {
    isAvailable: boolean;
    canHandle: boolean;
    isAvailableButNotConfigured: boolean;
  }) => {
    if (option.isAvailable) return t("downloader_online");
    if (option.isAvailableButNotConfigured)
      return t("downloader_not_configured");
    return t("downloader_offline");
  };

  const getStatusClass = (option: {
    isAvailable: boolean;
    canHandle: boolean;
    isAvailableButNotConfigured: boolean;
  }) => {
    if (option.isAvailable) return "online";
    if (option.isAvailableButNotConfigured) return "warning";
    return "offline";
  };

  return (
    <div className="bp-download-settings">
      <h2 className="bp-download-settings__title">{t("download_settings")}</h2>

      {/* Storage info */}
      {diskUsage && (
        <div className="bp-download-settings__card">
          <div className="bp-download-settings__storage-header">
            <span>{t("storage_usage")}</span>
            <span className="bp-download-settings__storage-free">
              {formatBytes(diskFreeSpace ?? 0)} {t("space_left")}
            </span>
          </div>

          <div className="bp-download-settings__storage-bar">
            {storageBarSegments && (
              <>
                <div
                  className="bp-download-settings__storage-bar-used"
                  style={{ width: `${storageBarSegments.usedPercent}%` }}
                />
                {estimatedSizeBytes && (
                  <div
                    className={`bp-download-settings__storage-bar-download ${
                      !hasEnoughSpace
                        ? "bp-download-settings__storage-bar-download--overflow"
                        : ""
                    }`}
                    style={{
                      width: `${Math.min(
                        storageBarSegments.downloadPercent,
                        100 - storageBarSegments.usedPercent
                      )}%`,
                    }}
                  />
                )}
              </>
            )}
          </div>

          {estimatedSizeBytes && (
            <div className="bp-download-settings__storage-legend">
              <span>
                {t("estimated_size")}: {repack.fileSize}
              </span>
              {!hasEnoughSpace && (
                <span className="bp-download-settings__storage-warning">
                  {t("not_enough_space")}
                </span>
              )}
            </div>
          )}
        </div>
      )}

      {/* Download path */}
      <button
        type="button"
        className="bp-download-settings__option"
        data-bp-focusable
        onClick={handleChooseDownloadsPath}
      >
        <div className="bp-download-settings__option-left">
          <span className="bp-download-settings__option-label">
            {t("download_path")}
          </span>
          <span className="bp-download-settings__option-value">
            {selectedPath}
          </span>
        </div>
        <span className="bp-download-settings__option-action">
          {t("change_path")}
        </span>
      </button>
      {hasWritePermission === false && (
        <span className="bp-download-settings__path-error">
          {t("no_write_permission")}
        </span>
      )}

      {/* Auto-extract toggle */}
      <button
        type="button"
        className="bp-download-settings__option"
        data-bp-focusable
        onClick={() =>
          setAutomaticExtractionEnabled(!automaticExtractionEnabled)
        }
      >
        <span className="bp-download-settings__option-label">
          {t("auto_extract_downloads")}
        </span>
        <span
          className={`bp-download-settings__switch ${
            automaticExtractionEnabled ? "bp-download-settings__switch--on" : ""
          }`}
        >
          <span className="bp-download-settings__switch-knob" />
        </span>
      </button>

      {/* Downloader selector — click downloads directly */}
      <div className="bp-download-settings__card">
        <div className="bp-download-settings__card-header">
          <h3 className="bp-download-settings__card-label">
            {t("downloader")}
          </h3>
        </div>

        <div className="bp-download-settings__downloaders">
          {downloadOptions
            .filter(
              (option) =>
                option.canHandle &&
                (option.isAvailable || option.isAvailableButNotConfigured)
            )
            .map((option) => {
              const statusClass = getStatusClass(option);

              return (
                <button
                  key={option.downloader}
                  type="button"
                  className="bp-download-settings__downloader"
                  data-bp-focusable
                  disabled={downloadStarting || !hasWritePermission}
                  onClick={() => {
                    handleStartWithDownloader(option.downloader);
                  }}
                >
                  <span className="bp-download-settings__downloader-name">
                    {DOWNLOADER_NAME[option.downloader]}
                  </span>
                  <span className="bp-download-settings__downloader-status">
                    <span
                      className={`bp-download-settings__downloader-dot bp-download-settings__downloader-dot--${statusClass}`}
                    />
                    {getStatusLabel(option)}
                  </span>
                </button>
              );
            })}
        </div>
      </div>
    </div>
  );
}
