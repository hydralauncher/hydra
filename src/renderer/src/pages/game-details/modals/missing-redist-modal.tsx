import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Button,
  CheckboxField,
  Modal,
  ProgressBar,
} from "@renderer/components";
import { logger } from "@renderer/logger";
import type { GameShop } from "@types";
import "./missing-redist-modal.scss";

export interface MissingRedistData {
  shop: GameShop;
  objectId: string;
  dllName: string;
  componentName: string;
  packageName: string;
  silentArgs: string[];
  estimatedSizeMB: number;
  localPath: string | null;
}

interface RedistDownloadProgress {
  packageName: string;
  bytesDownloaded: number;
  totalBytes: number;
  percentage: number;
  speed: number;
}

interface MissingRedistModalProps {
  visible: boolean;
  data: MissingRedistData | null;
  onClose: () => void;
  onRelaunch?: () => void;
}

export function MissingRedistModal({
  visible,
  data,
  onClose,
  onRelaunch,
}: Readonly<MissingRedistModalProps>) {
  const { t } = useTranslation();
  const [isInstalling, setIsInstalling] = useState(false);
  const [downloadProgress, setDownloadProgress] =
    useState<RedistDownloadProgress | null>(null);
  const [autoInstall, setAutoInstall] = useState(false);

  useEffect(() => {
    if (!visible) {
      setIsInstalling(false);
      setDownloadProgress(null);
      return;
    }

    const handleProgress = (progress: RedistDownloadProgress) => {
      if (data && progress.packageName === data.packageName) {
        setDownloadProgress(progress);
      }
    };

    globalThis.window.electron.on(
      "on-redist-download-progress",
      handleProgress
    );

    return () => {
      globalThis.window.electron.off(
        "on-redist-download-progress",
        handleProgress
      );
    };
  }, [visible, data]);

  if (!data) return null;

  const handleInstallAndRelaunch = async () => {
    setIsInstalling(true);
    logger.info("User initiated redist installation", { data, autoInstall });

    try {
      const success = await globalThis.window.electron.installGameRedist(
        data.shop,
        data.objectId,
        data.packageName,
        data.silentArgs,
        data.localPath
      );

      setIsInstalling(false);

      if (success) {
        onClose();
        onRelaunch?.();
      } else {
        logger.error("Redist installation returned false");
      }
    } catch (error) {
      logger.error("Failed to install missing redistributable", error);
      setIsInstalling(false);
    }
  };

  const handleOpenWinetricks = async () => {
    try {
      await globalThis.window.electron.openGameWinetricks(
        data.shop,
        data.objectId
      );
      onClose();
    } catch (error) {
      logger.error("Failed to open Winetricks", error);
    }
  };

  const formattedSpeed = downloadProgress?.speed
    ? `${(downloadProgress.speed / (1024 * 1024)).toFixed(1)} MB/s`
    : "";

  const downloadedMB = downloadProgress
    ? (downloadProgress.bytesDownloaded / (1024 * 1024)).toFixed(1)
    : "0";
  const totalMB = downloadProgress?.totalBytes
    ? (downloadProgress.totalBytes / (1024 * 1024)).toFixed(1)
    : data.estimatedSizeMB.toString();

  return (
    <Modal
      visible={visible}
      title={t("missing_redist_modal_title")}
      description={t("missing_redist_description", { dll: data.dllName })}
      onClose={onClose}
    >
      <div className="missing-redist-modal__container">
        <div className="missing-redist-modal__details">
          <span className="missing-redist-modal__component-title">
            {t("missing_redist_component", { component: data.componentName })}
          </span>

          <span className="missing-redist-modal__source-badge">
            {data.localPath
              ? t("missing_redist_size_local")
              : t("missing_redist_size_download", {
                  size: data.estimatedSizeMB,
                })}
          </span>
        </div>

        {isInstalling && (
          <div className="missing-redist-modal__progress-wrapper">
            <ProgressBar
              now={downloadProgress?.percentage ?? 0}
              max={100}
              label={t("downloading_redist", { component: data.componentName })}
              completed={downloadProgress?.percentage === 100}
              trackClassName="missing-redist-modal__progress-bar-track"
              barClassName="missing-redist-modal__progress-bar-fill"
            />
            {downloadProgress && (
              <div className="missing-redist-modal__progress-stats">
                <span>{`${downloadedMB} MB / ${totalMB} MB`}</span>
                <span>{formattedSpeed}</span>
              </div>
            )}
          </div>
        )}

        <CheckboxField
          label={t("auto_install_redists_label")}
          checked={autoInstall}
          onChange={() => setAutoInstall(!autoInstall)}
        />

        <div className="missing-redist-modal__actions">
          <Button
            onClick={handleOpenWinetricks}
            theme="outline"
            disabled={isInstalling}
          >
            {t("open_winetricks_fallback")}
          </Button>

          <Button onClick={onClose} theme="outline" disabled={isInstalling}>
            {t("cancel")}
          </Button>

          <Button
            onClick={handleInstallAndRelaunch}
            theme="primary"
            disabled={isInstalling}
          >
            {isInstalling
              ? t("installing_redist", { component: data.componentName })
              : t("install_and_relaunch")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
