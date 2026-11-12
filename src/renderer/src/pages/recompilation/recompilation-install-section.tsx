import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  CheckIcon,
  FileDirectoryIcon,
  LinkExternalIcon,
  XIcon,
} from "@primer/octicons-react";
import type { RecompilationDetails, RecompilationReleaseAsset } from "@types";
import { formatBytes } from "@shared";

import {
  InstallProgressBar,
  type InstallProgressLike,
} from "@renderer/components/setup-modal/install-progress-bar";
import { SidebarSection } from "../game-details/sidebar-section/sidebar-section";
import { splitRomRequirement } from "./rom-requirement";
import type { RecompilationInstall } from "./use-recompilation-install";
import type { RecompilationRom } from "./use-recompilation-rom";
import "@renderer/components/setup-modal/setup-modal.scss";
import { formatRecompilationVersion } from "./recompilation-version";
import "./recompilation-install-section.scss";

const shortPath = (fullPath: string) => {
  const separator = fullPath.includes("\\") ? "\\" : "/";
  const tail = fullPath.split(/[\\/]/).filter(Boolean).slice(-2);
  return `…${separator}${tail.join(separator)}`;
};

const fileName = (fullPath: string) => fullPath.split(/[\\/]/).pop() ?? "";

const withoutExtension = (name: string) =>
  name.includes(".") ? name.slice(0, name.lastIndexOf(".")) : name;

const folderOf = (fullPath: string) =>
  fullPath.slice(
    0,
    Math.max(fullPath.lastIndexOf("\\"), fullPath.lastIndexOf("/"))
  );

export function StatusDot({ ok }: Readonly<{ ok: boolean }>) {
  return (
    <span
      className={
        ok
          ? "recompilation-status-dot"
          : "recompilation-status-dot recompilation-status-dot--off"
      }
    >
      {ok ? <CheckIcon size={12} /> : <XIcon size={12} />}
    </span>
  );
}

function Truncated({
  text,
  fullText = text,
}: Readonly<{ text: string; fullText?: string }>) {
  const [tooltip, setTooltip] = useState<string | undefined>();

  return (
    <span
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
    </span>
  );
}

function LocationRow({
  path,
  openLabel,
  onOpen,
}: Readonly<{ path: string; openLabel: string; onOpen: () => void }>) {
  const { t } = useTranslation("recompilation");

  return (
    <div className="recompilation-install-section__location">
      <span className="recompilation-install-section__location-label">
        <FileDirectoryIcon size={14} />
        {t("row_location")}
      </span>
      <Truncated text={shortPath(path)} fullText={path} />
      <button
        type="button"
        className="recompilation-install-section__open"
        aria-label={openLabel}
        title={openLabel}
        onClick={onOpen}
      >
        <LinkExternalIcon size={14} />
      </button>
    </div>
  );
}

function Item({
  done,
  title,
  children,
}: Readonly<{ done: boolean; title: string; children: ReactNode }>) {
  return (
    <div className="recompilation-install-section__item">
      <div className="recompilation-install-section__item-head">
        <StatusDot ok={done} />
        <strong>{title}</strong>
      </div>
      <div className="recompilation-install-section__item-body">{children}</div>
    </div>
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
  const romFile = romState?.romPath ?? null;
  const { romName, romDetails } = splitRomRequirement(details.romRequirement);
  const cover =
    details.game.coverImageUrl ??
    details.game.libraryImageUrl ??
    details.game.iconUrl;

  const renderPort = () => {
    if (isDownloading || isExtracting) {
      const percent =
        isDownloading && progress.total && progress.loaded !== undefined
          ? Math.min(100, Math.round((progress.loaded / progress.total) * 100))
          : null;
      return (
        <>
          <p className="recompilation-install-section__sub">
            {isExtracting || percent === null
              ? t("extracting")
              : t("downloading_value", {
                  loaded: formatBytes(progress.loaded ?? 0),
                  total: formatBytes(progress.total ?? 0),
                  percent,
                })}
          </p>
          <InstallProgressBar progress={progress} />
        </>
      );
    }

    if (isInstalled) {
      const hasUpdate = state.version !== details.version;
      return (
        <>
          <p className="recompilation-install-section__sub">
            <strong>{formatRecompilationVersion(state.version)}</strong>
            {" · "}
            {hasUpdate
              ? t("version_available", {
                  version: formatRecompilationVersion(details.version),
                })
              : t("version_latest_long")}
          </p>
          {state.installPath && (
            <LocationRow
              path={state.installPath}
              openLabel={t("open_folder")}
              onOpen={() => void install.openFolder()}
            />
          )}
        </>
      );
    }

    if (!installAsset) {
      return (
        <p className="recompilation-install-section__sub">
          {t("no_file_for_this_pc")}
        </p>
      );
    }

    return (
      <p className="recompilation-install-section__sub">
        {t("not_installed")} · {formatBytes(installAsset.size)}
      </p>
    );
  };

  const renderRom = () => {
    if (isRomDownloading) {
      const isRomExtracting = rom.downloadPhase === "extracting";
      const romProgress: InstallProgressLike = isRomExtracting
        ? { phase: "extracting" }
        : { phase: "downloading", loaded: romPercent, total: 100 };
      return (
        <>
          <p className="recompilation-install-section__sub">
            {isRomExtracting ? t("rom_extracting") : `${romPercent}%`}
          </p>
          <InstallProgressBar progress={romProgress} />
        </>
      );
    }

    if (romFile) {
      return (
        <>
          <div className="recompilation-install-section__rom">
            {cover ? (
              <img
                className="recompilation-install-section__cover"
                src={cover}
                alt=""
              />
            ) : (
              <span className="recompilation-install-section__cover" />
            )}
            <div className="recompilation-install-section__rom-text">
              <strong title={fileName(romFile)}>
                {withoutExtension(fileName(romFile))}
              </strong>
              {romDetails && <span>{romDetails}</span>}
            </div>
          </div>
          <LocationRow
            path={folderOf(romFile)}
            openLabel={t("open_rom_folder")}
            onOpen={() => void window.electron.showItemInFolder(romFile)}
          />
        </>
      );
    }

    if (romState?.isReady) return null;

    return (
      <p className="recompilation-install-section__sub">
        {romName
          ? t("rom_needs_short", {
              rom: romDetails ? `${romName} (${romDetails})` : romName,
            })
          : t("not_selected")}
      </p>
    );
  };

  return (
    <SidebarSection title={t("play_section_title")}>
      <div className="recompilation-install-section">
        <Item done={isInstalled} title={t("install_step_port")}>
          {renderPort()}
        </Item>

        {romState?.handlesRom && (
          <Item
            done={Boolean(romFile) || romState.isReady}
            title={t("install_step_rom")}
          >
            {renderRom()}
          </Item>
        )}

        {romState && !romState.handlesRom && details.romRequirement && (
          <p className="recompilation-install-section__sub">
            {t("needs")} {details.romRequirement}
          </p>
        )}
      </div>
    </SidebarSection>
  );
}
