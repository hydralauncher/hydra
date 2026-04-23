import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button, Modal, TextField } from "@renderer/components";
import type { LibraryGame } from "@types";
import { CheckCircleFillIcon, XCircleFillIcon } from "@primer/octicons-react";
import { HardDrive } from "lucide-react";
import "./transfer-game-modal.scss";

interface DriveInfo {
  root: string;
  label: string;
  free: number;
  total: number;
}

interface TransferGameModalProps {
  visible: boolean;
  game: LibraryGame;
  onClose: () => void;
  onTransferComplete: (newExePath: string) => void;
}

function formatBytes(b: number) {
  if (b >= 1e12) return (b / 1e12).toFixed(1) + " TB";
  if (b >= 1e9) return (b / 1e9).toFixed(1) + " GB";
  if (b >= 1e6) return (b / 1e6).toFixed(1) + " MB";
  return (b / 1e3).toFixed(0) + " KB";
}

export function TransferGameModal({
  visible,
  game,
  onClose,
  onTransferComplete,
}: TransferGameModalProps) {
  const { t } = useTranslation("game_details");
  const [drives, setDrives] = useState<DriveInfo[]>([]);
  const [selectedDrive, setSelectedDrive] = useState<string | null>(null);
  const [customPath, setCustomPath] = useState("");
  const [progress, setProgress] = useState<number | null>(null);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const gameSize = game.installedSizeInBytes ?? 0;
  const transferring = progress !== null && !done;

  useEffect(() => {
    if (!visible) return;
    setProgress(null);
    setDone(false);
    setError(null);
    setSelectedDrive(null);
    setCustomPath("");

    // Load drives
    window.electron
      .getAvailableDrives?.()
      .then(setDrives)
      .catch(() => {});

    // IPC listeners
    const onProgress = (_: unknown, shop: string, oid: string, p: number) => {
      if (shop === game.shop && oid === game.objectId) setProgress(p);
    };
    const onComplete = (
      _: unknown,
      shop: string,
      oid: string,
      newPath: string
    ) => {
      if (shop === game.shop && oid === game.objectId) {
        setProgress(1);
        setDone(true);
        setTimeout(() => {
          onTransferComplete(newPath);
          onClose();
        }, 1200);
      }
    };
    const onError = (_: unknown, shop: string, oid: string) => {
      if (shop === game.shop && oid === game.objectId) {
        setProgress(null);
        setError(t("transfer_failed"));
      }
    };

    window.electron.on("on-game-transfer-progress", onProgress);
    window.electron.on("on-game-transfer-complete", onComplete);
    window.electron.on("on-game-transfer-error", onError);

    return () => {
      window.electron.off("on-game-transfer-progress", onProgress);
      window.electron.off("on-game-transfer-complete", onComplete);
      window.electron.off("on-game-transfer-error", onError);
    };
  }, [visible, game.shop, game.objectId, onTransferComplete, onClose, t]);

  const effectiveDest = customPath.trim() || selectedDrive;
  const selectedDriveInfo = drives.find((d) => d.root === selectedDrive);
  const enoughSpace = !selectedDriveInfo || selectedDriveInfo.free >= gameSize;

  const handleBrowse = async () => {
    const result = await window.electron.showOpenDialog({
      properties: ["openDirectory"],
    });
    if (!result.canceled && result.filePaths[0]) {
      setCustomPath(result.filePaths[0]);
      setSelectedDrive(null);
    }
  };

  const handleTransfer = async () => {
    const dest = effectiveDest;
    if (!dest) return;
    setError(null);
    setProgress(0);
    const result = await window.electron.transferGameFiles(
      game.shop,
      game.objectId,
      dest
    );
    if (!result.ok) {
      setProgress(null);
      if (result.error === "not_enough_space") {
        setError(
          t("not_enough_space_detail", {
            needed: formatBytes(result.needed!),
            available: formatBytes(result.available!),
          })
        );
      } else {
        setError(t("transfer_failed"));
      }
    }
  };

  return (
    <Modal
      visible={visible}
      title={t("transfer_game")}
      onClose={transferring ? undefined : onClose}
    >
      <div className="transfer-modal">
        {/* Drive picker */}
        {!transferring && !done && (
          <>
            <p className="transfer-modal__subtitle">
              {t("transfer_game_description", { game: game.title })}
            </p>

            {gameSize > 0 && (
              <p className="transfer-modal__size">
                {t("game_size")}: <strong>{formatBytes(gameSize)}</strong>
              </p>
            )}

            <div className="transfer-modal__drives">
              {drives.map((drive) => {
                const selected = selectedDrive === drive.root && !customPath;
                const hasSpace = drive.free >= gameSize;
                return (
                  <button
                    key={drive.root}
                    className={[
                      "transfer-modal__drive-card",
                      selected && "transfer-modal__drive-card--selected",
                      !hasSpace && "transfer-modal__drive-card--no-space",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    onClick={() => {
                      setSelectedDrive(drive.root);
                      setCustomPath("");
                    }}
                    disabled={!hasSpace}
                  >
                    <HardDrive size={22} />
                    <div className="transfer-modal__drive-info">
                      <span className="transfer-modal__drive-label">
                        {drive.label || drive.root}
                      </span>
                      <span className="transfer-modal__drive-space">
                        {formatBytes(drive.free)} {t("free_of")}{" "}
                        {formatBytes(drive.total)}
                      </span>
                    </div>
                    {hasSpace ? (
                      <CheckCircleFillIcon
                        size={16}
                        className="transfer-modal__drive-ok"
                      />
                    ) : (
                      <XCircleFillIcon
                        size={16}
                        className="transfer-modal__drive-nospace"
                      />
                    )}
                  </button>
                );
              })}
            </div>

            <div className="transfer-modal__custom-path">
              <p className="transfer-modal__or">{t("or_enter_path")}</p>
              <div className="transfer-modal__path-row">
                <TextField
                  value={customPath}
                  onChange={(e) => {
                    setCustomPath(e.target.value);
                    setSelectedDrive(null);
                  }}
                  placeholder={t("destination_folder_placeholder")}
                  theme="dark"
                />
                <Button theme="outline" onClick={handleBrowse}>
                  {t("browse")}
                </Button>
              </div>
            </div>

            {error && <p className="transfer-modal__error">{error}</p>}

            <div className="transfer-modal__actions">
              <Button theme="outline" onClick={onClose}>
                {t("cancel")}
              </Button>
              <Button
                theme="primary"
                onClick={handleTransfer}
                disabled={!effectiveDest || !enoughSpace}
              >
                {t("start_transfer")}
              </Button>
            </div>
          </>
        )}

        {/* Progress */}
        {transferring && (
          <div className="transfer-modal__progress-area">
            <p>{t("transferring_files")}</p>
            <div className="transfer-modal__bar-track">
              <div
                className="transfer-modal__bar-fill"
                style={{ width: `${Math.round((progress ?? 0) * 100)}%` }}
              />
            </div>
            <span>{Math.round((progress ?? 0) * 100)}%</span>
          </div>
        )}

        {done && (
          <div className="transfer-modal__progress-area">
            <CheckCircleFillIcon
              size={32}
              className="transfer-modal__drive-ok"
            />
            <p>{t("transfer_complete")}</p>
          </div>
        )}
      </div>
    </Modal>
  );
}
