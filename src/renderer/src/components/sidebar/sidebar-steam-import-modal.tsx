import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { Modal } from "@renderer/components";

import "./sidebar-steam-import-modal.scss";

interface SteamImportProgress {
  totalGames: number;
  currentIndex: number;
  currentGame: string;
  importedCount: number;
  done: boolean;
}

interface SteamImportResult {
  importedCount: number;
  totalFound: number;
  alreadyInLibrary: number;
}

export interface SidebarSteamImportModalProps {
  visible: boolean;
  onClose: () => void;
}

export function SidebarSteamImportModal({
  visible,
  onClose,
}: SidebarSteamImportModalProps) {
  const { t } = useTranslation("sidebar");

  const [progress, setProgress] = useState<SteamImportProgress | null>(null);
  const [result, setResult] = useState<SteamImportResult | null>(null);

  useEffect(() => {
    if (!visible) return;

    setProgress(null);
    setResult(null);

    const unsubscribe = window.electron.onSteamImportProgress((value) => {
      setProgress(value);
    });

    window.electron.importSteamGames().then((importResult) => {
      setResult(importResult);
    });

    return () => {
      unsubscribe();
    };
  }, [visible]);

  const progressValue =
    progress && progress.totalGames > 0
      ? progress.currentIndex / progress.totalGames
      : 0;

  const isDone = result !== null;

  return (
    <Modal
      visible={visible}
      title={t("import_steam_games_modal_title")}
      onClose={onClose}
      clickOutsideToClose={isDone}
    >
      <div className="steam-import-modal">
        {!isDone && (
          <>
            <p className="steam-import-modal__current-game">
              {progress?.currentGame || t("import_steam_games_scanning")}
            </p>

            <div>
              <div className="steam-import-modal__progress-info">
                <span className="steam-import-modal__progress-label">
                  {progress
                    ? t("import_steam_games_progress", {
                        current: progress.currentIndex,
                        total: progress.totalGames,
                      })
                    : t("import_steam_games_scanning")}
                </span>
                {progressValue > 0 && (
                  <span className="steam-import-modal__progress-percentage">
                    {Math.round(progressValue * 100)}%
                  </span>
                )}
              </div>

              <div className="steam-import-modal__progress-track">
                <div
                  className={`steam-import-modal__progress-fill${
                    progressValue === 0
                      ? " steam-import-modal__progress-fill--indeterminate"
                      : ""
                  }`}
                  style={
                    progressValue > 0
                      ? { width: `${progressValue * 100}%` }
                      : undefined
                  }
                />
              </div>
            </div>
          </>
        )}

        {isDone && (
          <div className="steam-import-modal__result">
            <div className="steam-import-modal__result-stat">
              <span>{t("import_steam_games_found")}</span>
              <span className="steam-import-modal__result-value">
                {result.totalFound}
              </span>
            </div>
            <div className="steam-import-modal__result-stat">
              <span>{t("import_steam_games_imported")}</span>
              <span className="steam-import-modal__result-value">
                {result.importedCount}
              </span>
            </div>
            <div className="steam-import-modal__result-stat">
              <span>{t("import_steam_games_already_in_library")}</span>
              <span className="steam-import-modal__result-value">
                {result.alreadyInLibrary}
              </span>
            </div>

            <button
              type="button"
              className="steam-import-modal__close-button"
              onClick={onClose}
            >
              {t("import_steam_games_close")}
            </button>
          </div>
        )}
      </div>
    </Modal>
  );
}
