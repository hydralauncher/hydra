import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  AlertIcon,
  FileDirectoryIcon,
  SyncIcon,
  XIcon,
} from "@primer/octicons-react";
import cn from "classnames";

import { Button, Modal } from "@renderer/components";

import "./scan-games-modal.scss";

type ScanMode = "automatic" | "manual";

interface FoundGame {
  title: string;
  executablePath: string;
}

interface ScanResult {
  foundGames: FoundGame[];
  total: number;
}

export interface ScanGamesModalProps {
  visible: boolean;
  onClose: () => void;
  isScanning: boolean;
  scanResult: ScanResult | null;
  onStartScan: (
    additionalDirectories: string[],
    includeDefaultDirectories: boolean
  ) => void;
  onClearResult: () => void;
}

export function ScanGamesModal({
  visible,
  onClose,
  isScanning,
  scanResult,
  onStartScan,
  onClearResult,
}: Readonly<ScanGamesModalProps>) {
  const { t } = useTranslation("header");

  const isWindows = window.electron.platform === "win32";

  const [selectedFolders, setSelectedFolders] = useState<string[]>([]);
  const [scanMode, setScanMode] = useState<ScanMode>(
    isWindows ? "automatic" : "manual"
  );

  const isManualMode = !isWindows || scanMode === "manual";
  const requiresFolderSelection = isManualMode && selectedFolders.length === 0;

  const handleClose = () => {
    setSelectedFolders([]);
    setScanMode(isWindows ? "automatic" : "manual");
    onClose();
  };

  const handleStartScan = () => {
    if (isManualMode) {
      onStartScan(selectedFolders, false);
    } else {
      onStartScan([], true);
    }
  };

  const handleScanAgain = () => {
    onClearResult();
  };

  const handleAddFolder = async () => {
    const { canceled, filePaths } = await window.electron.showOpenDialog({
      properties: ["openDirectory", "multiSelections"],
    });

    if (canceled) return;

    setSelectedFolders((prev) => [
      ...prev,
      ...filePaths.filter((filePath) => !prev.includes(filePath)),
    ]);
  };

  const handleRemoveFolder = (folder: string) => {
    setSelectedFolders((prev) => prev.filter((item) => item !== folder));
  };

  return (
    <Modal
      visible={visible}
      title={t("scan_games_title")}
      onClose={handleClose}
      clickOutsideToClose={!isScanning}
    >
      <div className="scan-games-modal">
        {!scanResult && !isScanning && (
          <>
            {isWindows && (
              <div className="scan-games-modal__mode-toggle">
                <button
                  type="button"
                  className={cn("scan-games-modal__mode-option", {
                    "scan-games-modal__mode-option--active":
                      scanMode === "automatic",
                  })}
                  onClick={() => setScanMode("automatic")}
                >
                  {t("scan_games_mode_automatic")}
                </button>
                <button
                  type="button"
                  className={cn("scan-games-modal__mode-option", {
                    "scan-games-modal__mode-option--active":
                      scanMode === "manual",
                  })}
                  onClick={() => setScanMode("manual")}
                >
                  {t("scan_games_mode_manual")}
                </button>
              </div>
            )}

            <div className="scan-games-modal__warning">
              <AlertIcon size={14} className="scan-games-modal__warning-icon" />
              <span>{t("scan_games_detection_warning")}</span>
            </div>

            {!isManualMode && (
              <p className="scan-games-modal__description">
                {t("scan_games_description")}
              </p>
            )}

            {isManualMode && (
              <div className="scan-games-modal__folders">
                <div className="scan-games-modal__folders-header">
                  <span className="scan-games-modal__folders-title">
                    {t("scan_games_folders_title")}
                  </span>
                  <Button theme="outline" onClick={handleAddFolder}>
                    <FileDirectoryIcon size={14} />
                    {t("scan_games_add_folder")}
                  </Button>
                </div>

                {selectedFolders.length > 0 ? (
                  <ul className="scan-games-modal__folders-list">
                    {selectedFolders.map((folder) => (
                      <li
                        key={folder}
                        className="scan-games-modal__folder-item"
                      >
                        <span className="scan-games-modal__folder-path">
                          {folder}
                        </span>
                        <button
                          type="button"
                          className="scan-games-modal__folder-remove"
                          onClick={() => handleRemoveFolder(folder)}
                          aria-label={t("scan_games_remove_folder")}
                        >
                          <XIcon size={14} />
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="scan-games-modal__folders-hint">
                    {t("scan_games_folders_hint_manual")}
                  </p>
                )}
              </div>
            )}
          </>
        )}

        {isScanning && !scanResult && (
          <div className="scan-games-modal__scanning">
            <SyncIcon size={24} className="scan-games-modal__spinner" />
            <p className="scan-games-modal__scanning-text">
              {t("scan_games_in_progress")}
            </p>
            <p className="scan-games-modal__scanning-hint">
              {t("scan_games_in_progress_hint")}
            </p>
          </div>
        )}

        {scanResult && (
          <div className="scan-games-modal__results">
            {scanResult.foundGames.length > 0 ? (
              <>
                <p className="scan-games-modal__result">
                  {t("scan_games_result", {
                    found: scanResult.foundGames.length,
                    total: scanResult.total,
                  })}
                </p>

                <ul className="scan-games-modal__games-list">
                  {scanResult.foundGames.map((game) => (
                    <li
                      key={game.executablePath}
                      className="scan-games-modal__game-item"
                    >
                      <span className="scan-games-modal__game-title">
                        {game.title}
                      </span>
                      <span className="scan-games-modal__game-path">
                        {game.executablePath}
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <p className="scan-games-modal__no-results">
                {t("scan_games_no_results")}
              </p>
            )}
          </div>
        )}

        <div className="scan-games-modal__actions">
          <Button theme="outline" onClick={handleClose}>
            {scanResult
              ? t("scan_games_close")
              : isScanning
                ? t("scan_games_hide")
                : t("scan_games_cancel")}
          </Button>
          {!scanResult && (
            <Button
              onClick={handleStartScan}
              disabled={isScanning || requiresFolderSelection}
            >
              {t("scan_games_start")}
            </Button>
          )}
          {scanResult && (
            <Button onClick={handleScanAgain}>
              {t("scan_games_scan_again")}
            </Button>
          )}
        </div>
      </div>
    </Modal>
  );
}
