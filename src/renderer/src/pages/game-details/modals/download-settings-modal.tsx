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
import type { GameRepack, TorrentFile } from "@types";
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
    automaticallyExtract: boolean,
    fileIndices?: number[],
    selectedFilesSize?: number
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
  const [torrentFiles, setTorrentFiles] = useState<TorrentFile[]>([]);
  const [selectedFiles, setSelectedFiles] = useState<Set<number>>(new Set());
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [sortBy, setSortBy] = useState<"name" | "size" | "downloading">("name");

  const { isFeatureEnabled, Feature } = useFeature();

  const getDiskFreeSpace = async (path: string) => {
    const result = await globalThis.electron.getDiskFreeSpace(path);
    setDiskFreeSpace(result.free);
  };

  const checkFolderWritePermission = useCallback(
    async (path: string) => {
      if (isFeatureEnabled(Feature.CheckDownloadWritePermission)) {
        const result =
          await globalThis.electron.checkFolderWritePermission(path);
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

      // Fetch torrent files if it's a magnet link
      const magnetUri = repack?.uris.find((uri) => uri.startsWith("magnet"));

      if (
        magnetUri &&
        selectedDownloader === Downloader.Torrent &&
        typeof globalThis.electron.getTorrentFiles === "function"
      ) {
        setLoadingFiles(true);
        console.log(
          "Fetching torrent files for:",
          magnetUri.substring(0, 50) + "..."
        );

        globalThis.electron
          .getTorrentFiles(magnetUri)
          .then((files) => {
            console.log("Received torrent files:", files.length);
            setTorrentFiles(files);
            // Select all files by default
            setSelectedFiles(new Set(files.map((f) => f.index)));
          })
          .catch((error) => {
            console.error("Failed to fetch torrent files:", error);
            console.error("Error details:", {
              message: error?.message,
              stack: error?.stack,
              fullError: error,
            });
            showErrorToast(
              t("error"),
              error?.message || "Failed to fetch torrent files"
            );
            setTorrentFiles([]);
          })
          .finally(() => {
            setLoadingFiles(false);
          });
      } else {
        setTorrentFiles([]);
        setSelectedFiles(new Set());
      }
    }
  }, [
    visible,
    checkFolderWritePermission,
    selectedPath,
    repack,
    selectedDownloader,
    t,
    showErrorToast,
  ]);

  const downloaders = useMemo(() => {
    return getDownloadersForUris(repack?.uris ?? []);
  }, [repack?.uris]);

  const getDefaultDownloader = useCallback(
    (availableDownloaders: Downloader[]) => {
      if (availableDownloaders.length === 0) return null;

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
      globalThis.electron
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
    const { filePaths } = await globalThis.electron.showOpenDialog({
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
        // Only pass file indices for torrent downloads with file selection
        const fileIndices =
          selectedDownloader === Downloader.Torrent && torrentFiles.length > 0
            ? Array.from(selectedFiles)
            : undefined;

        const response = await startDownload(
          repack,
          selectedDownloader!,
          selectedPath,
          automaticExtractionEnabled,
          fileIndices,
          fileIndices ? selectedFilesSize : undefined
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

  const toggleFileSelection = (index: number) => {
    const newSelection = new Set(selectedFiles);
    if (newSelection.has(index)) {
      newSelection.delete(index);
    } else {
      newSelection.add(index);
    }
    setSelectedFiles(newSelection);
  };

  const toggleAllFiles = () => {
    if (selectedFiles.size === torrentFiles.length) {
      setSelectedFiles(new Set());
    } else {
      setSelectedFiles(new Set(torrentFiles.map((f) => f.index)));
    }
  };

  const sortedFiles = useMemo(() => {
    const files = [...torrentFiles];
    switch (sortBy) {
      case "name":
        return files.sort((a, b) => a.name.localeCompare(b.name));
      case "size":
        return files.sort((a, b) => a.size - b.size);
      case "downloading":
        return files.sort((a, b) => {
          const aSelected = selectedFiles.has(a.index) ? 1 : 0;
          const bSelected = selectedFiles.has(b.index) ? 1 : 0;
          return bSelected - aSelected;
        });
      default:
        return files;
    }
  }, [torrentFiles, sortBy, selectedFiles]);

  // Show right panel if Torrent downloader is selected (even while loading)
  const shouldShowFileSelection = selectedDownloader === Downloader.Torrent;

  // Calculate total size of selected files
  const selectedFilesSize = useMemo(() => {
    if (torrentFiles.length === 0) return 0;
    return torrentFiles
      .filter((file) => selectedFiles.has(file.index))
      .reduce((total, file) => total + file.size, 0);
  }, [torrentFiles, selectedFiles]);

  return (
    <Modal
      visible={visible}
      title={t("download_settings")}
      description={t("space_left_on_disk", {
        space: formatBytes(diskFreeSpace ?? 0),
      })}
      onClose={onClose}
      extraLarge={shouldShowFileSelection}
    >
      <div className="download-settings-modal__container">
        <div className="download-settings-modal__left-column">
          <div className="download-settings-modal__left-content">
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
                        selectedDownloader === downloader
                          ? "primary"
                          : "outline"
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
          </div>

          <div className="download-settings-modal__left-actions">
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
                (shouldShowFileSelection &&
                  torrentFiles.length > 0 &&
                  selectedFiles.size === 0)
              }
            >
              <DownloadIcon />
              {t("download_now")}
            </Button>
          </div>
        </div>

        {shouldShowFileSelection && (
          <>
            <div className="download-settings-modal__separator" />
            <div className="download-settings-modal__right-column">
              <div className="download-settings-modal__file-selection-header">
                <h3>{t("select_files")}</h3>
                <div className="download-settings-modal__filter-controls">
                  <button
                    className={`download-settings-modal__filter-button ${sortBy === "name" ? "active" : ""}`}
                    onClick={() => setSortBy("name")}
                  >
                    {t("name")}
                  </button>
                  <button
                    className={`download-settings-modal__filter-button ${sortBy === "size" ? "active" : ""}`}
                    onClick={() => setSortBy("size")}
                  >
                    {t("size")}
                  </button>
                  <button
                    className={`download-settings-modal__filter-button ${sortBy === "downloading" ? "active" : ""}`}
                    onClick={() => setSortBy("downloading")}
                  >
                    {t("downloading")}
                  </button>
                </div>
              </div>

              {loadingFiles ? (
                <div className="download-settings-modal__loading">
                  {t("loading_files")}
                </div>
              ) : (
                <div className="download-settings-modal__file-list">
                  <div className="download-settings-modal__file-item download-settings-modal__file-item--header">
                    <CheckboxField
                      label={t("select_all")}
                      checked={
                        selectedFiles.size === torrentFiles.length &&
                        torrentFiles.length > 0
                      }
                      onChange={toggleAllFiles}
                    />
                    <span>{t("size")}</span>
                  </div>
                  {sortedFiles.map((file) => (
                    <div
                      key={file.index}
                      className="download-settings-modal__file-item"
                    >
                      <CheckboxField
                        label={file.name}
                        checked={selectedFiles.has(file.index)}
                        onChange={() => toggleFileSelection(file.index)}
                      />
                      <span className="download-settings-modal__file-size">
                        {formatBytes(file.size)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
