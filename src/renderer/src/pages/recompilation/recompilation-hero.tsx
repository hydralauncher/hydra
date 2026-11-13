import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  DownloadIcon,
  FileDirectoryIcon,
  KebabHorizontalIcon,
  PlayIcon,
  SyncIcon,
  TrashIcon,
} from "@primer/octicons-react";
import { Disc3, Unlink, XCircle } from "lucide-react";
import type {
  LibraryGame,
  RecompilationDetails,
  RecompilationReleaseAsset,
} from "@types";
import { formatBytes } from "@shared";

import { Button } from "@renderer/components/button/button";
import { ConfirmationModal } from "@renderer/components/confirmation-modal/confirmation-modal";
import { DropdownMenu } from "@renderer/components/dropdown-menu/dropdown-menu";
import { InstallProgressBar } from "@renderer/components/setup-modal/install-progress-bar";
import { useAppSelector, useToast } from "@renderer/hooks";
import { usePs4PkgPicker } from "@renderer/components/ps4-pkg-job/ps4-pkg-job-host";
import { CloudSaveWidget } from "../game-details/cloud-save-v2";
import {
  getInstallErrorKey,
  type RecompilationInstall,
} from "./use-recompilation-install";
import type { RecompilationRom } from "./use-recompilation-rom";
import { RecompilationPlaytime } from "./recompilation-playtime";
import { formatExtracting, toExtractionBar } from "./extraction-progress";
import "@renderer/components/setup-modal/setup-modal.scss";
import "../game-details/hero.scss";

interface RecompilationHeroProps {
  objectId: string;
  details: RecompilationDetails;
  game: LibraryGame | null;
  installAsset: RecompilationReleaseAsset | null;
  areReleasesLoaded: boolean;
  install: RecompilationInstall;
  rom: RecompilationRom;
  hasCloudSave: boolean;
  onOpenInstall: () => void;
  onOpenUpdate: () => void;
  onDownloadRom: () => void;
}

export function RecompilationHero({
  objectId,
  details,
  game,
  installAsset,
  areReleasesLoaded,
  install,
  rom,
  hasCloudSave,
  onOpenInstall,
  onOpenUpdate,
  onDownloadRom,
}: Readonly<RecompilationHeroProps>) {
  const { t } = useTranslation("recompilation");
  // The game files are being written while a PS4 PKG is extracted or applied.
  const isPs4PkgJobRunning = useAppSelector((state) => {
    const job = state.ps4PkgJob.job;
    return job !== null && job.objectId === objectId;
  });
  const { showErrorToast, showSuccessToast } = useToast();
  const [isUninstallOpen, setIsUninstallOpen] = useState(false);
  const [isUninstallStarting, setIsUninstallStarting] = useState(false);
  const [isUnlinkOpen, setIsUnlinkOpen] = useState(false);
  const [uncertainFolder, setUncertainFolder] = useState<string | null>(null);

  const { state, progress } = install;
  const isUninstalling =
    isUninstallStarting || progress?.phase === "uninstalling";
  const uninstallPercent =
    progress?.phase === "uninstalling" && progress.total
      ? Math.min(
          100,
          Math.round(((progress.loaded ?? 0) / progress.total) * 100)
        )
      : null;
  const isDownloading = progress?.phase === "downloading";
  const isExtracting =
    progress?.phase === "extracting" ||
    (Boolean(state?.isInstalling) && !isDownloading);
  const isInstalled = state?.installed === true;
  const isLinked = state?.linked === true;
  const hasHydraFiles = (state?.installedFileCount ?? 0) > 0;
  const needsPortUpdate = isInstalled && isLinked && !state.verified;
  const hasUpdate = isInstalled && state.version !== details.version;
  const handlesRom = rom.state?.handlesRom === true;
  const needsRomChoice =
    handlesRom && !rom.state?.romPath && !rom.state?.isReady;
  const isRomDownloading = rom.downloadPhase !== null;
  const romPercent = Math.round((rom.downloadProgress ?? 0) * 100);
  const canApplyPs4Update =
    rom.state?.isFolder === true && Boolean(rom.state.romPath);
  const ps4Update = usePs4PkgPicker("launchbox", objectId, "update", () => {
    void rom.refresh();
  });

  const showsNoFileNote =
    areReleasesLoaded &&
    Boolean(state) &&
    !isInstalled &&
    !isDownloading &&
    !isExtracting &&
    !installAsset;

  const { prepareFailed } = install;
  useEffect(() => {
    if (prepareFailed) showErrorToast(t("prepare_failed"));
  }, [prepareFailed, showErrorToast, t]);

  const runUpdate = async () => {
    const result = await install.install();
    if (!result.ok && result.reason !== "already_installing") {
      showErrorToast(t(getInstallErrorKey(result.reason)));
    }
    if (result.preparing) onOpenInstall();
  };

  const runLinkFolder = async () => {
    void window.electron
      .warmRecompilationFolderCheck({ objectId, slug: details.slug })
      .catch(() => undefined);
    const { filePaths } = await window.electron.showOpenDialog({
      title: t("link_folder_title"),
      defaultPath: install.state?.installParentPath,
      properties: ["openDirectory"],
    });
    const [directory] = filePaths ?? [];
    if (!directory) return;

    await linkFolder(directory, false);
  };

  const linkFolder = async (directory: string, force: boolean) => {
    const result = await install.linkFolder(directory, force);
    if (!result.ok && result.reason === "doesnt_look_right") {
      setUncertainFolder(directory);
      return;
    }
    if (!result.ok) {
      showErrorToast(t(getInstallErrorKey(result.reason)));
      return;
    }
    showSuccessToast(t("link_folder_done"));
    if (rom.state?.handlesRom) onOpenInstall();
  };

  const runPlay = async () => {
    const played = await install.play();
    if (played === "rom_update_required") onOpenUpdate();
    if (played === "port_update_required") {
      showErrorToast(t("link_folder_update_first"));
    }
    if (played === "already_running") showErrorToast(t("already_running"));
    if (played === "folder_missing" || played === "program_missing") {
      showErrorToast(
        t(`recompilation_${played}_toast`, { ns: "game_details" })
      );
    } else if (played === "pkg_job_running") {
      showErrorToast(t("ps4_pkg_busy", { ns: "game_details" }));
    } else if (!played) showErrorToast(t("play_failed"));
  };

  const runClose = async () => {
    const ok = await install.close();
    if (!ok) showErrorToast(t("close_failed"));
  };

  const runUnlink = async () => {
    setIsUnlinkOpen(false);
    const result = await install.unlink();
    if (result.ok) {
      showSuccessToast(
        t(result.folderMissing ? "removed_folder_missing" : "unlink_done", {
          name: details.name,
        })
      );
    } else showErrorToast(t("unlink_failed"));
  };

  const runUninstall = async () => {
    setIsUninstallOpen(false);
    setIsUninstallStarting(true);
    const ok = await install
      .uninstall()
      .finally(() => setIsUninstallStarting(false));
    if (ok) showSuccessToast(t("uninstall_done", { name: details.name }));
    else showErrorToast(t("uninstall_failed"));
  };

  const percent =
    isDownloading && progress.total && progress.loaded !== undefined
      ? Math.min(100, Math.round((progress.loaded / progress.total) * 100))
      : null;

  const renderUninstallProgress = () => (
    <div className="recompilation-page__progress">
      <div className="setup-modal__progress-meta">
        <span className="setup-modal__progress-status">
          {uninstallPercent === null
            ? t("uninstalling")
            : t("uninstalling_percent", { percent: uninstallPercent })}
        </span>
      </div>
      <InstallProgressBar
        progress={
          uninstallPercent === null
            ? { phase: "extracting" }
            : { phase: "downloading", loaded: uninstallPercent, total: 100 }
        }
      />
    </div>
  );

  const renderPortProgress = () => (
    <div className="recompilation-page__progress">
      <div className="setup-modal__progress-meta">
        <span className="setup-modal__progress-status">
          {isExtracting
            ? formatExtracting(t("extracting"), progress)
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
      <InstallProgressBar
        progress={isDownloading ? progress : toExtractionBar(progress)}
      />
    </div>
  );

  const renderRomProgress = () => (
    <button
      type="button"
      className="recompilation-page__progress recompilation-page__progress--clickable"
      onClick={onOpenInstall}
    >
      <div className="setup-modal__progress-meta">
        <span className="setup-modal__progress-status">
          {t(
            rom.downloadPhase === "extracting"
              ? "rom_extracting_button"
              : "rom_downloading_button",
            { percent: romPercent }
          )}
        </span>
      </div>
      <InstallProgressBar
        progress={{ phase: "downloading", loaded: romPercent, total: 100 }}
      />
    </button>
  );

  const renderInstallButtons = () => (
    <>
      <Button onClick={onOpenInstall} disabled={!installAsset}>
        <DownloadIcon />
        {t("install")}
      </Button>
      <Button
        theme="outline"
        onClick={() => void runLinkFolder()}
        disabled={install.isBusy}
        title={t("link_folder_hint")}
      >
        <FileDirectoryIcon />
        {t("link_folder")}
      </Button>
    </>
  );

  const isPortBusy = install.isRunning || install.isPreparing;

  const getMenuItems = () => [
    ...(handlesRom && !needsRomChoice
      ? [
          {
            icon: <Disc3 size={16} />,
            label: t("change_rom"),
            onClick: onOpenInstall,
            disabled: isPortBusy,
          },
        ]
      : []),
    ...(canApplyPs4Update
      ? [
          {
            icon: <SyncIcon />,
            label: t("apply_ps4_update", { ns: "game_details" }),
            onClick: () => void ps4Update.pick(),
            disabled: isPortBusy || ps4Update.isBusy,
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
    ...(isLinked
      ? [
          {
            icon: <Unlink size={16} />,
            label: t("unlink"),
            onClick: () => setIsUnlinkOpen(true),
            disabled: isPortBusy,
          },
        ]
      : []),
    ...(!isLinked || hasHydraFiles
      ? [
          {
            icon: <TrashIcon />,
            label: t("uninstall"),
            danger: true,
            onClick: () => setIsUninstallOpen(true),
            disabled: isPortBusy,
          },
        ]
      : []),
  ];

  const showsUpdate =
    hasUpdate &&
    !install.isRunning &&
    !install.isLaunching &&
    !install.isPreparing;
  const showsPlay = !install.isRunning && !needsRomChoice && !needsPortUpdate;

  const renderInstalledButtons = () => (
    <>
      {showsUpdate && (
        <Button onClick={runUpdate}>
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
      {install.isRunning && (
        <Button theme="outline" onClick={runClose}>
          <XCircle size={16} />
          {t("close")}
        </Button>
      )}
      {showsPlay && (
        <Button
          theme={hasUpdate ? "outline" : "primary"}
          onClick={runPlay}
          disabled={
            install.isLaunching || install.isPreparing || isPs4PkgJobRunning
          }
        >
          <PlayIcon />
          {install.isPreparing ? t("prepare_title") : t("play")}
        </Button>
      )}
      <DropdownMenu align="end" items={getMenuItems()}>
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

  const renderPrimary = () => {
    if (isUninstalling) return renderUninstallProgress();
    if (isDownloading || isExtracting) return renderPortProgress();
    if (isRomDownloading && !install.isRunning) return renderRomProgress();
    if (!isInstalled) return renderInstallButtons();
    return renderInstalledButtons();
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
          <RecompilationPlaytime game={game} isRunning={install.isRunning} />
        </div>

        <div className="recompilation-page__hero-actions">
          <div className="recompilation-page__hero-buttons">
            {hasCloudSave && !isUninstalling && <CloudSaveWidget />}
            {renderPrimary()}
          </div>
          {showsNoFileNote && (
            <span className="recompilation-page__hero-note">
              {t("no_file_for_this_pc")}
            </span>
          )}
        </div>
      </div>

      <ConfirmationModal
        visible={isUninstallOpen}
        title={t("uninstall_title", { name: details.name })}
        descriptionText={t(
          isLinked ? "uninstall_linked_description" : "uninstall_description"
        )}
        confirmButtonLabel={t("uninstall")}
        cancelButtonLabel={t("cancel")}
        confirmButtonTheme="danger"
        onConfirm={runUninstall}
        onClose={() => setIsUninstallOpen(false)}
      />

      <ConfirmationModal
        visible={uncertainFolder !== null}
        title={t("link_folder_unsure_title")}
        descriptionText={t("link_folder_unsure_description")}
        confirmButtonLabel={t("link_folder_use_anyway")}
        cancelButtonLabel={t("cancel")}
        onConfirm={() => {
          const directory = uncertainFolder;
          setUncertainFolder(null);
          if (directory) void linkFolder(directory, true);
        }}
        onClose={() => setUncertainFolder(null)}
      />

      <ConfirmationModal
        visible={isUnlinkOpen}
        title={t("unlink_title", { name: details.name })}
        descriptionText={t("unlink_description")}
        confirmButtonLabel={t("unlink")}
        cancelButtonLabel={t("cancel")}
        onConfirm={runUnlink}
        onClose={() => setIsUnlinkOpen(false)}
      />
    </section>
  );
}
