import { useTranslation } from "react-i18next";
import { SyncIcon } from "@primer/octicons-react";

import { Button, Modal } from "@renderer/components";

import "./scan-games-modal.scss";

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
  onStartScan: () => void;
  onClearResult: () => void;
}

export function ScanGamesModal({
  visible,
  onClose,
  isScanning,
  scanResult,
  onStartScan,
  onClearResult,
}: ScanGamesModalProps) {
  const { t } = useTranslation("header");

  const handleClose = () => {
    onClose();
  };

  const handleStartScan = () => {
    onStartScan();
  };

  const handleScanAgain = () => {
    onClearResult();
    onStartScan();
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
          <p className="scan-games-modal__description">
            {t("scan_games_description")}
          </p>
        )}

        {isScanning && !scanResult && (
          <div className="scan-games-modal__scanning">
            <SyncIcon size={24} className="scan-games-modal__spinner" />
            <p className="scan-games-modal__scanning-text">
              {t("scan_games_in_progress")}
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
            {scanResult ? t("scan_games_close") : t("scan_games_cancel")}
          </Button>
          {!scanResult && (
            <Button onClick={handleStartScan} disabled={isScanning}>
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
