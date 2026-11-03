import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  DownloadIcon,
  FileDirectoryIcon,
  KebabHorizontalIcon,
  PlayIcon,
  SyncIcon,
  TrashIcon,
} from "@primer/octicons-react";
import { Disc3, XCircle } from "lucide-react";
import type { RecompilationDetails, RecompilationReleaseAsset } from "@types";
import { formatBytes } from "@shared";

import { Button } from "@renderer/components/button/button";
import { ConfirmationModal } from "@renderer/components/confirmation-modal/confirmation-modal";
import { DropdownMenu } from "@renderer/components/dropdown-menu/dropdown-menu";
import { InstallProgressBar } from "@renderer/components/setup-modal/install-progress-bar";
import { useToast } from "@renderer/hooks";
import { CloudSaveWidget } from "../game-details/cloud-save-v2";
import type { RecompilationInstall } from "./use-recompilation-install";
import type { RecompilationRom } from "./use-recompilation-rom";
import "@renderer/components/setup-modal/setup-modal.scss";
import "../game-details/hero.scss";

interface RecompilationHeroProps {
  details: RecompilationDetails;
  installAsset: RecompilationReleaseAsset | null;
  install: RecompilationInstall;
  rom: RecompilationRom;
  /** Shows the cloud save widget, for an installed port Hydra has saves for. */
  hasCloudSave: boolean;
  /** Opens the install modal on step 1 (install) or 2 (ROM). */
  onOpenInstall: () => void;
  /** Opens the base game download options, for ports Hydra cannot hand a ROM to. */
  onDownloadRom: () => void;
}

export function RecompilationHero({
  details,
  installAsset,
  install,
  rom,
  hasCloudSave,
  onOpenInstall,
  onDownloadRom,
}: Readonly<RecompilationHeroProps>) {
  const { t } = useTranslation("recompilation");
  const { showErrorToast } = useToast();
  const [isUninstallOpen, setIsUninstallOpen] = useState(false);

  const { state, progress } = install;
  const isDownloading = progress?.phase === "downloading";
  const isExtracting = progress?.phase === "extracting";
  const isInstalled = state?.installed === true;
  const hasUpdate = isInstalled && state.version !== details.version;
  const handlesRom = rom.state?.handlesRom === true;
  const needsRomChoice =
    handlesRom && !rom.state?.romPath && !rom.state?.isReady;
  const needsRomDownload =
    rom.state !== null &&
    !handlesRom &&
    !rom.state.libraryRomPath &&
    rom.downloadPhase === null;

  const runInstall = async () => {
    const ok = await install.install();
    if (!ok) showErrorToast(t("install_failed"));
  };

  const runPlay = async () => {
    const ok = await install.play();
    if (!ok) showErrorToast(t("play_failed"));
  };

  const runClose = async () => {
    const ok = await install.close();
    if (!ok) showErrorToast(t("close_failed"));
  };

  const runUninstall = async () => {
    setIsUninstallOpen(false);
    const ok = await install.uninstall();
    if (!ok) showErrorToast(t("uninstall_failed"));
  };

  const percent =
    isDownloading && progress.total && progress.loaded !== undefined
      ? Math.min(100, Math.round((progress.loaded / progress.total) * 100))
      : null;

  const renderPrimary = () => {
    if (isDownloading || isExtracting) {
      return (
        <div className="recompilation-page__progress">
          <div className="setup-modal__progress-meta">
            <span className="setup-modal__progress-status">
              {isExtracting
                ? t("extracting")
                : t("downloading_percent", { percent: percent ?? 0 })}
            </span>
            {isDownloading &&
              progress.total !== undefined &&
              progress.loaded !== undefined && (
                <span>
                  {t("size_of_total", {
                    loaded: formatBytes(progress.loaded),
                    total: formatBytes(progress.total),
                  })}
                </span>
              )}
          </div>
          <InstallProgressBar progress={progress} />
        </div>
      );
    }

    if (!isInstalled) {
      return (
        <Button
          onClick={
            handlesRom
              ? () => {
                  // The port downloads while the modal asks for the ROM.
                  void runInstall();
                  onOpenInstall();
                }
              : runInstall
          }
          disabled={!installAsset}
        >
          <DownloadIcon />
          {t("install")}
        </Button>
      );
    }

    return (
      <>
        {hasUpdate && !install.isRunning && (
          <Button onClick={runInstall}>
            <SyncIcon />
            {t("update")}
          </Button>
        )}
        {needsRomChoice && !install.isRunning && (
          <Button
            theme={hasUpdate ? "outline" : "primary"}
            onClick={onOpenInstall}
          >
            <Disc3 size={16} />
            {t("choose_rom")}
          </Button>
        )}
        {needsRomDownload && !install.isRunning && (
          <Button
            theme={hasUpdate ? "outline" : "primary"}
            onClick={onDownloadRom}
          >
            <DownloadIcon />
            {t("download_rom")}
          </Button>
        )}
        {install.isRunning && (
          <Button theme="outline" onClick={runClose}>
            <XCircle size={16} />
            {t("close")}
          </Button>
        )}
        {!install.isRunning && !needsRomChoice && !needsRomDownload && (
          <Button
            theme={hasUpdate ? "outline" : "primary"}
            onClick={runPlay}
            disabled={install.isLaunching}
          >
            <PlayIcon />
            {t("play")}
          </Button>
        )}
        <DropdownMenu
          align="end"
          items={[
            ...(needsRomDownload && !install.isRunning
              ? [
                  {
                    icon: <PlayIcon />,
                    label: t("play"),
                    onClick: runPlay,
                    disabled: install.isLaunching,
                  },
                ]
              : []),
            ...(handlesRom && !needsRomChoice
              ? [
                  {
                    icon: <Disc3 size={16} />,
                    label: t("change_rom"),
                    onClick: onOpenInstall,
                    disabled: install.isRunning,
                  },
                ]
              : []),
            {
              icon: <FileDirectoryIcon />,
              label: t("open_folder"),
              onClick: () => void install.openFolder(),
            },
            {
              icon: <DownloadIcon />,
              label: t("download_options"),
              onClick: onDownloadRom,
            },
            {
              icon: <TrashIcon />,
              label: t("uninstall"),
              onClick: () => setIsUninstallOpen(true),
              disabled: install.isRunning,
            },
          ]}
        >
          <Button
            theme="outline"
            className="recompilation-page__icon-button"
            aria-label={t("more_actions")}
          >
            <KebabHorizontalIcon />
          </Button>
        </DropdownMenu>
      </>
    );
  };

  return (
    <section className="recompilation-page__hero">
      {details.game.libraryHeroImageUrl && (
        <img
          className="recompilation-page__hero-backdrop"
          src={details.game.libraryHeroImageUrl}
          alt=""
        />
      )}
      <div className="recompilation-page__hero-shade" />

      <div className="recompilation-page__hero-content">
        {details.iconUrl && (
          <img
            className="recompilation-page__hero-icon"
            src={details.iconUrl}
            alt=""
          />
        )}

        <div className="recompilation-page__hero-text">
          <h1 className="recompilation-page__title">{details.name}</h1>
        </div>

        <div className="recompilation-page__hero-actions">
          <div className="recompilation-page__hero-buttons">
            {hasCloudSave && <CloudSaveWidget />}
            {renderPrimary()}
          </div>
        </div>
      </div>

      <ConfirmationModal
        visible={isUninstallOpen}
        title={t("uninstall_title", { name: details.name })}
        descriptionText={t("uninstall_description")}
        confirmButtonLabel={t("uninstall")}
        cancelButtonLabel={t("cancel")}
        confirmButtonTheme="danger"
        onConfirm={runUninstall}
        onClose={() => setIsUninstallOpen(false)}
      />
    </section>
  );
}
