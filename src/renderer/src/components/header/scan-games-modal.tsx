import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  AlertIcon,
  DeviceDesktopIcon,
  FileDirectoryIcon,
  SyncIcon,
  XIcon,
} from "@primer/octicons-react";
import cn from "classnames";

import { Button, CheckboxField, Modal } from "@renderer/components";

import "./scan-games-modal.scss";

type ScanMode = "automatic" | "manual";

interface FoundGame {
  title: string;
  executablePath: string;
  iconUrl: string | null;
}

interface AmbiguousChoice {
  objectId: string;
  title: string;
  iconUrl: string | null;
}

interface AmbiguousMatch {
  executablePath: string;
  choices: AmbiguousChoice[];
}

export interface ScanResult {
  linkedGames: FoundGame[];
  addedGames: FoundGame[];
  ambiguousMatches: AmbiguousMatch[];
  total: number;
}

export interface ScanGamesModalProps {
  visible: boolean;
  onClose: () => void;
  isScanning: boolean;
  scanResult: ScanResult | null;
  onStartScan: (
    additionalDirectories: string[],
    includeDefaultDirectories: boolean,
    addGamesToLibrary: boolean
  ) => void;
  onCancelScan: () => void;
  onClearResult: () => void;
}

const resolveResultSummary = (
  addedCount: number,
  linkedCount: number,
  addedText: string,
  linkedText: string,
  combinedText: string
) => {
  if (addedCount === 0) return linkedText;
  if (linkedCount === 0) return addedText;

  return combinedText;
};

export function ScanGamesModal({
  visible,
  onClose,
  isScanning,
  scanResult,
  onStartScan,
  onCancelScan,
  onClearResult,
}: Readonly<ScanGamesModalProps>) {
  const { t } = useTranslation("header");

  const isWindows = window.electron.platform === "win32";

  const [selectedFolders, setSelectedFolders] = useState<string[]>([]);
  const [scanMode, setScanMode] = useState<ScanMode>(
    isWindows ? "automatic" : "manual"
  );
  const [addGamesToLibrary, setAddGamesToLibrary] = useState(true);
  const [pending, setPending] = useState<AmbiguousMatch[]>([]);
  const [picks, setPicks] = useState<Record<string, string>>({});
  const [isResolving, setIsResolving] = useState(false);
  const [resolvedGames, setResolvedGames] = useState<FoundGame[]>([]);

  const isManualMode = !isWindows || scanMode === "manual";
  const requiresFolderSelection = isManualMode && selectedFolders.length === 0;

  const addedGames = [...(scanResult?.addedGames ?? []), ...resolvedGames];

  const linkedGames = scanResult?.linkedGames ?? [];

  const hasResults = Boolean(
    scanResult && addedGames.length + linkedGames.length > 0
  );

  const addedText = t("scan_games_result_added", { count: addedGames.length });
  const linkedText = t("scan_games_result_linked", {
    count: linkedGames.length,
  });

  const resultSummary = resolveResultSummary(
    addedGames.length,
    linkedGames.length,
    addedText,
    linkedText,
    t("scan_games_result_summary", { added: addedText, linked: linkedText })
  );

  useEffect(() => {
    if (!scanResult) {
      setPending([]);
      setPicks({});
      setResolvedGames([]);
      return;
    }

    setPending(scanResult.ambiguousMatches);
  }, [scanResult]);

  const handlePick = useCallback((executablePath: string, objectId: string) => {
    setPicks((prev) => ({ ...prev, [executablePath]: objectId }));
  }, []);

  const handleConfirmPicks = async () => {
    setIsResolving(true);

    try {
      const added: FoundGame[] = [];

      for (const [executablePath, objectId] of Object.entries(picks)) {
        const game = await window.electron
          .addScannedGame(objectId, executablePath)
          .catch(() => null);

        if (game) added.push(game);
      }

      setResolvedGames(added);
    } finally {
      setIsResolving(false);
      setPending([]);
    }
  };

  const handleClose = () => {
    setSelectedFolders([]);
    setScanMode(isWindows ? "automatic" : "manual");
    onClose();
  };

  const handleStartScan = () => {
    if (isManualMode) {
      onStartScan(selectedFolders, false, addGamesToLibrary);
    } else {
      onStartScan([], true, addGamesToLibrary);
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

  const renderGamesList = (games: FoundGame[]) => (
    <ul className="scan-games-modal__games-list">
      {games.map((game) => (
        <li key={game.executablePath} className="scan-games-modal__game-item">
          {game.iconUrl ? (
            <img
              src={game.iconUrl}
              alt=""
              className="scan-games-modal__game-icon"
            />
          ) : (
            <span className="scan-games-modal__game-icon scan-games-modal__game-icon--empty">
              <DeviceDesktopIcon size={16} />
            </span>
          )}
          <span className="scan-games-modal__game-info">
            <span className="scan-games-modal__game-title">{game.title}</span>
            <span className="scan-games-modal__game-path">
              {game.executablePath}
            </span>
          </span>
        </li>
      ))}
    </ul>
  );

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

            <div className="scan-games-modal__option">
              <CheckboxField
                label={t("scan_games_add_to_library")}
                checked={addGamesToLibrary}
                onChange={() => setAddGamesToLibrary((prev) => !prev)}
              />
            </div>
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

        {scanResult && pending.length > 0 && (
          <div className="scan-games-modal__ambiguous">
            <p className="scan-games-modal__ambiguous-title">
              {t("scan_games_ambiguous_title", { count: pending.length })}
            </p>
            <p className="scan-games-modal__ambiguous-hint">
              {t("scan_games_ambiguous_hint")}
            </p>

            <ul className="scan-games-modal__ambiguous-list">
              {pending.map((match) => (
                <li
                  key={match.executablePath}
                  className="scan-games-modal__ambiguous-item"
                >
                  <span className="scan-games-modal__game-path">
                    {match.executablePath}
                  </span>

                  <div className="scan-games-modal__ambiguous-choices">
                    {match.choices.map((choice) => (
                      <button
                        key={choice.objectId}
                        type="button"
                        className={cn("scan-games-modal__choice", {
                          "scan-games-modal__choice--active":
                            picks[match.executablePath] === choice.objectId,
                        })}
                        onClick={() =>
                          handlePick(match.executablePath, choice.objectId)
                        }
                      >
                        {choice.iconUrl && (
                          <img
                            src={choice.iconUrl}
                            alt=""
                            className="scan-games-modal__choice-icon"
                          />
                        )}
                        <span>{choice.title}</span>
                      </button>
                    ))}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}

        {scanResult && pending.length === 0 && (
          <div className="scan-games-modal__results">
            <div className="scan-games-modal__warning">
              <AlertIcon size={14} className="scan-games-modal__warning-icon" />
              <span>{t("scan_games_detection_warning")}</span>
            </div>

            {hasResults ? (
              <div className="scan-games-modal__result-section">
                <p className="scan-games-modal__result">{resultSummary}</p>
                {renderGamesList([...addedGames, ...linkedGames])}
              </div>
            ) : (
              <p className="scan-games-modal__no-results">
                {t("scan_games_no_results")}
              </p>
            )}
          </div>
        )}

        <div className="scan-games-modal__actions">
          {scanResult && pending.length > 0 ? (
            <>
              <Button theme="outline" onClick={() => setPending([])}>
                {t("scan_games_ambiguous_skip")}
              </Button>
              <Button
                onClick={handleConfirmPicks}
                disabled={isResolving || Object.keys(picks).length === 0}
              >
                {t("scan_games_ambiguous_confirm")}
              </Button>
            </>
          ) : (
            <>
              <Button theme="outline" onClick={handleClose}>
                {scanResult
                  ? t("scan_games_close")
                  : isScanning
                    ? t("scan_games_hide")
                    : t("scan_games_cancel")}
              </Button>
              {!scanResult && isScanning && (
                <Button theme="danger" onClick={onCancelScan}>
                  {t("scan_games_cancel_scan")}
                </Button>
              )}
              {!scanResult && !isScanning && (
                <Button
                  onClick={handleStartScan}
                  disabled={requiresFolderSelection}
                >
                  {t("scan_games_start")}
                </Button>
              )}
              {scanResult && (
                <Button onClick={handleScanAgain}>
                  {t("scan_games_scan_again")}
                </Button>
              )}
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}
