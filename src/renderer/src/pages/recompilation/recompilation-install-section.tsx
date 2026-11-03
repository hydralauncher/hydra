import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import cn from "classnames";
import {
  DeviceDesktopIcon,
  DownloadIcon,
  FileIcon,
  FileDirectoryIcon,
  LinkExternalIcon,
  PackageIcon,
} from "@primer/octicons-react";
import type { RecompilationDetails, RecompilationReleaseAsset } from "@types";
import { formatBytes } from "@shared";

import {
  InstallProgressBar,
  type InstallProgressLike,
} from "@renderer/components/setup-modal/install-progress-bar";
import { SidebarSection } from "../game-details/sidebar-section/sidebar-section";
import type { RecompilationInstall } from "./use-recompilation-install";
import type { RecompilationRom } from "./use-recompilation-rom";
import "@renderer/components/setup-modal/setup-modal.scss";
import "./recompilation-install-section.scss";

const OS_LABELS: Record<RecompilationReleaseAsset["os"], string> = {
  windows: "Windows",
  linux: "Linux",
  macos: "macOS",
};

/** The last two folders of a path, e.g. recompilations\zelda64recomp. */
const shortPath = (fullPath: string) => {
  const separator = fullPath.includes("\\") ? "\\" : "/";
  return fullPath.split(/[\\/]/).filter(Boolean).slice(-2).join(separator);
};

const fileName = (fullPath: string) => fullPath.split(/[\\/]/).pop() ?? "";

const folderOf = (fullPath: string) =>
  fullPath.slice(
    0,
    Math.max(fullPath.lastIndexOf("\\"), fullPath.lastIndexOf("/"))
  );

function Row({
  icon,
  label,
  children,
  off = false,
}: Readonly<{
  icon: ReactNode;
  label: string;
  children: ReactNode;
  off?: boolean;
}>) {
  return (
    <div className="stats__category">
      <p className="stats__category-title">
        {icon}
        {label}
      </p>
      <div
        className={cn("recompilation-install-section__value", {
          "recompilation-install-section__value--off": off,
        })}
      >
        {children}
      </div>
    </div>
  );
}

/** Cuts long text with "..." and shows the full text as a tooltip only then. */
function Truncated({
  text,
  fullText = text,
  strong = false,
}: Readonly<{ text: string; fullText?: string; strong?: boolean }>) {
  const [tooltip, setTooltip] = useState<string | undefined>();
  const Tag = strong ? "strong" : "span";

  return (
    <Tag
      className="recompilation-install-section__path"
      title={tooltip}
      onMouseEnter={(event) => {
        const element = event.currentTarget;
        setTooltip(
          element.scrollWidth > element.clientWidth ? fullText : undefined
        );
      }}
    >
      {text}
    </Tag>
  );
}

function OpenButton({
  label,
  onClick,
}: Readonly<{ label: string; onClick: () => void }>) {
  return (
    <button
      type="button"
      className="recompilation-install-section__open"
      aria-label={label}
      title={label}
      onClick={onClick}
    >
      <LinkExternalIcon size={14} />
    </button>
  );
}

interface RecompilationInstallSectionProps {
  details: RecompilationDetails;
  installAsset: RecompilationReleaseAsset | null;
  install: RecompilationInstall;
  rom: RecompilationRom;
}

export function RecompilationInstallSection({
  details,
  installAsset,
  install,
  rom,
}: Readonly<RecompilationInstallSectionProps>) {
  const { t } = useTranslation("recompilation");
  const { state, progress } = install;

  const isDownloading = progress?.phase === "downloading";
  const isExtracting = progress?.phase === "extracting";
  const isInstalled = state?.installed === true;

  const romState = rom.state;
  const isRomDownloading = rom.downloadPhase !== null;
  const romPercent = Math.round((rom.downloadProgress ?? 0) * 100);
  // Ports Hydra cannot hand a ROM to read the base game's ROM from the library.
  const romFile =
    romState?.romPath ??
    (romState && !romState.handlesRom ? romState.libraryRomPath : null);

  const renderPort = () => {
    if (isDownloading || isExtracting) {
      const percent =
        isDownloading && progress.total && progress.loaded !== undefined
          ? Math.min(100, Math.round((progress.loaded / progress.total) * 100))
          : null;
      return (
        <>
          <Row icon={<DownloadIcon size={14} />} label={t("row_downloading")}>
            {isExtracting || percent === null
              ? t("extracting")
              : t("downloading_value", {
                  loaded: formatBytes(progress.loaded ?? 0),
                  total: formatBytes(progress.total ?? 0),
                  percent,
                })}
          </Row>
          <InstallProgressBar progress={progress} />
        </>
      );
    }

    if (isInstalled) {
      const hasUpdate = state.version !== details.version;
      return (
        <>
          <Row icon={<DeviceDesktopIcon size={14} />} label={t("row_version")}>
            <span>
              <strong>v{state.version}</strong> ·{" "}
              {hasUpdate
                ? t("version_available", { version: details.version })
                : t("version_latest")}
            </span>
          </Row>
          {state.installPath && (
            <Row
              icon={<FileDirectoryIcon size={14} />}
              label={t("row_location")}
            >
              <Truncated
                text={shortPath(state.installPath)}
                fullText={state.installPath}
              />
              <OpenButton
                label={t("open_folder")}
                onClick={() => void install.openFolder()}
              />
            </Row>
          )}
        </>
      );
    }

    return (
      <>
        <Row
          icon={<DeviceDesktopIcon size={14} />}
          label={t("row_version")}
          off
        >
          {t("value_absent")}
        </Row>
        <Row icon={<PackageIcon size={14} />} label={t("row_size")}>
          {installAsset
            ? `${formatBytes(installAsset.size)} · ${OS_LABELS[installAsset.os]}`
            : t("no_file_for_this_pc")}
        </Row>
      </>
    );
  };

  const renderRom = () => {
    if (isRomDownloading) {
      const isRomExtracting = rom.downloadPhase === "extracting";
      // No number yet (download being prepared, extraction not reported):
      // the bar runs without a value instead of showing 0%.
      const hasPercent = romPercent > 0;
      const romProgress: InstallProgressLike = hasPercent
        ? { phase: "downloading", loaded: romPercent, total: 100 }
        : { phase: "starting" };
      const percentText = hasPercent ? `${romPercent}%` : "";
      return (
        <>
          <Row icon={<DownloadIcon size={14} />} label={t("row_downloading")}>
            {isRomExtracting
              ? [t("extracting"), percentText].filter(Boolean).join(" · ")
              : percentText}
          </Row>
          <InstallProgressBar progress={romProgress} />
        </>
      );
    }

    if (romFile) {
      return (
        <>
          <Row icon={<FileIcon size={14} />} label={t("row_file")}>
            <Truncated text={fileName(romFile)} strong />
          </Row>
          <Row icon={<FileDirectoryIcon size={14} />} label={t("row_location")}>
            <Truncated
              text={shortPath(folderOf(romFile))}
              fullText={folderOf(romFile)}
            />
            <OpenButton
              label={t("open_rom_folder")}
              onClick={() => void window.electron.showItemInFolder(romFile)}
            />
          </Row>
        </>
      );
    }

    return (
      <Row icon={<FileIcon size={14} />} label={t("row_file")} off>
        {t("value_absent")}
      </Row>
    );
  };

  return (
    <SidebarSection title={t("install_section_title")}>
      <div className="recompilation-install-section">
        <div className="recompilation-install-section__group">
          <p className="recompilation-install-section__group-title">
            {t("install_step_port")}
          </p>
          {renderPort()}
        </div>

        <div className="recompilation-install-section__group">
          <p className="recompilation-install-section__group-title">
            {t("rom_group")}
          </p>
          {renderRom()}
        </div>

        {!romFile && details.romRequirement && (
          <p className="recompilation-install-section__need">
            <strong>{t("needs")}</strong> {details.romRequirement}
          </p>
        )}
      </div>
    </SidebarSection>
  );
}
