import { useId, useState } from "react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  BookIcon,
  CalendarIcon,
  ChevronDownIcon,
  DeviceDesktopIcon,
  DownloadIcon,
  FileDirectoryIcon,
  FileIcon,
  LawIcon,
  LinkExternalIcon,
  PeopleIcon,
  TagIcon,
} from "@primer/octicons-react";
import { format } from "date-fns";

import { formatBytes, getDateLocale } from "@shared";
import type {
  RecompilationOs,
  RecompilationPort,
  RecompilationPortId,
} from "@types";
import { Button, Link } from "@renderer/components";
import { DropdownMenu } from "@renderer/components/dropdown-menu/dropdown-menu";
import { useFormat, useUserDetails } from "@renderer/hooks";

import { RecompilationReadme } from "./recompilation-readme";
import { RecompilationReviews } from "./recompilation-reviews";
import { useRecompilationInstall } from "./use-recompilation-install";
import twoShipReadme from "./readmes/2ship2harkinian.md?raw";
import zelda64RecompReadme from "./readmes/zelda64recomp.md?raw";

import "./recompilation-section.scss";

const READMES: Record<RecompilationPortId, string> = {
  "2ship2harkinian": twoShipReadme,
  zelda64recomp: zelda64RecompReadme,
};

const ROM_REQUIREMENT_KEYS: Record<RecompilationPortId, string> = {
  "2ship2harkinian": "recompilation_rom_2ship2harkinian",
  zelda64recomp: "recompilation_rom_zelda64recomp",
};

const OS_NAMES: Record<RecompilationOs, string> = {
  windows: "Windows",
  linux: "Linux",
  macos: "macOS",
};

interface RecompilationSectionProps {
  /** Native PC ports of the game, most downloaded first. */
  ports: RecompilationPort[];
}

interface PortDetailsProps {
  port: RecompilationPort;
  ports: RecompilationPort[];
  headingId: string;
  onSelectPort: (portId: RecompilationPortId) => void;
}

function PortDetails({
  port,
  ports,
  headingId,
  onSelectPort,
}: Readonly<PortDetailsProps>) {
  const { t, i18n } = useTranslation("game_details");
  const { formatNumber } = useFormat();
  const { userDetails } = useUserDetails();
  const { status, progress, asset, install, openFolder } =
    useRecompilationInstall(port);

  const { release } = port;
  const versionLabel = `v${release.version}`;
  const repositoryUrl = `https://github.com/${port.repository}`;
  const hasManyPorts = ports.length > 1;

  const releaseDate = format(new Date(release.publishedAt), "MMM d, yyyy", {
    locale: getDateLocale(i18n.language),
  });

  const facts: { icon: ReactNode; label: string; value: string }[] = [
    {
      icon: <DownloadIcon size={18} />,
      label: t("recompilation_downloads"),
      value: formatNumber(port.totalDownloads),
    },
    {
      icon: <TagIcon size={18} />,
      label: t("recompilation_version"),
      value: release.codename
        ? `${release.version} · ${release.codename}`
        : release.version,
    },
    {
      icon: <CalendarIcon size={18} />,
      label: t("recompilation_released"),
      value: releaseDate,
    },
    {
      icon: <PeopleIcon size={18} />,
      label: t("recompilation_developer"),
      value: port.developer,
    },
    {
      icon: <DeviceDesktopIcon size={18} />,
      label: t("recompilation_platforms"),
      value: port.supportedOs.map((os) => OS_NAMES[os]).join(", "),
    },
    ...(port.license
      ? [
          {
            icon: <LawIcon size={18} />,
            label: t("recompilation_license"),
            value: port.license,
          },
        ]
      : []),
  ];

  const installLabel = () => {
    if (status === "extracting") return t("recompilation_extracting");
    if (status === "downloading") {
      const total = progress?.total ?? asset?.size ?? 0;
      const percent = total
        ? Math.min(100, Math.floor(((progress?.loaded ?? 0) / total) * 100))
        : 0;
      return t("recompilation_downloading", { progress: `${percent}%` });
    }
    return t("recompilation_install", { port: port.name });
  };

  const installCaption = () => {
    if (status === "installed") {
      return t("recompilation_installed_caption", { version: versionLabel });
    }
    if (!asset) return t("recompilation_no_release_file");
    if (status === "downloading" && progress?.loaded) {
      return t("recompilation_download_progress", {
        loaded: formatBytes(progress.loaded),
        total: formatBytes(progress.total ?? asset.size),
      });
    }
    return [versionLabel, asset.fileLabel, formatBytes(asset.size)].join(" · ");
  };

  return (
    <>
      <div className="recompilation__header">
        <div className="recompilation__heading">
          <h2 id={headingId} className="recompilation__eyebrow">
            <DeviceDesktopIcon size={12} />
            {t("recompilation_eyebrow", { count: ports.length })}
          </h2>

          <div className="recompilation__title-row">
            {hasManyPorts ? (
              <h3 className="recompilation__switcher">
                <DropdownMenu
                  title={t("recompilation_ports_menu_title")}
                  align="start"
                  sideOffset={5}
                  items={ports.map((item) => ({
                    label: item.name,
                    icon: <DeviceDesktopIcon size={16} />,
                    disabled: item.id === port.id,
                    onClick: () => onSelectPort(item.id),
                  }))}
                >
                  <button
                    type="button"
                    className="recompilation__port-trigger"
                    title={t("recompilation_switch_port")}
                  >
                    <span className="recompilation__port-name">
                      {port.name}
                    </span>
                    <ChevronDownIcon
                      size={16}
                      className="recompilation__port-chevron"
                    />
                  </button>
                </DropdownMenu>
              </h3>
            ) : (
              <h3 className="recompilation__port-name recompilation__port-name--static">
                {port.name}
              </h3>
            )}

            <span className="recompilation__developer">
              {t("recompilation_by")}{" "}
              <strong className="recompilation__developer-name">
                {port.developer}
              </strong>
            </span>
          </div>

          <p className="recompilation__blurb">{port.blurb}</p>
        </div>

        <div className="recompilation__install">
          {status === "installed" ? (
            <Button theme="outline" onClick={openFolder}>
              <FileDirectoryIcon size={16} />
              {t("recompilation_open_folder")}
            </Button>
          ) : (
            <Button
              theme="primary"
              onClick={install}
              disabled={!asset || status !== "idle"}
            >
              <DownloadIcon size={16} />
              {installLabel()}
            </Button>
          )}
          <span className="recompilation__install-caption">
            {installCaption()}
          </span>
        </div>
      </div>

      <div className="recompilation__notes">
        {port.featureLabels.map((label) => (
          <span key={label} className="recompilation__label">
            {label}
          </span>
        ))}
        <p className="recompilation__rom">
          <FileIcon size={12} />
          <span>{t(ROM_REQUIREMENT_KEYS[port.id])}</span>
        </p>
      </div>

      <div className="recompilation__body">
        <div className="recompilation__main">
          <div className="recompilation__readme-header">
            <BookIcon size={16} />
            <h4 className="recompilation__readme-title">
              {t("recompilation_readme")}
            </h4>
            <Link to={repositoryUrl} className="recompilation__repository">
              {port.repository}
              <LinkExternalIcon size={12} />
            </Link>
          </div>

          <RecompilationReadme source={READMES[port.id]} />

          <RecompilationReviews port={port} isSignedIn={Boolean(userDetails)} />
        </div>

        <aside
          className="recompilation__rail"
          aria-label={t("recompilation_details_label", { port: port.name })}
        >
          <div className="recompilation__card">
            <h4 className="recompilation__card-title">
              {t("recompilation_details")}
            </h4>
            <div className="recompilation__card-body recompilation__facts">
              {facts.map((fact) => (
                <div key={fact.label} className="recompilation__fact">
                  <p className="recompilation__fact-label">
                    {fact.icon}
                    {fact.label}
                  </p>
                  <p className="recompilation__fact-value" title={fact.value}>
                    {fact.value}
                  </p>
                </div>
              ))}
            </div>
          </div>

          <div className="recompilation__card">
            <div className="recompilation__card-header">
              <h4 className="recompilation__card-title">
                {t("recompilation_release_files")}
              </h4>
              <span className="recompilation__card-meta">{versionLabel}</span>
            </div>
            <ul className="recompilation__files">
              {release.assets.map((file) => {
                const isThisPc = file.name === asset?.name;

                return (
                  <li
                    key={file.name}
                    className={`recompilation__file${isThisPc ? " recompilation__file--this-pc" : ""}`}
                  >
                    <div className="recompilation__file-info">
                      <span className="recompilation__file-os">
                        {file.osLabel}
                        {isThisPc && (
                          <span className="recompilation__this-pc">
                            {t("recompilation_this_pc")}
                          </span>
                        )}
                      </span>
                      <span className="recompilation__file-meta">
                        <span
                          className="recompilation__file-name"
                          title={file.name}
                        >
                          {file.name}
                        </span>
                        <span className="recompilation__file-size">
                          · {formatBytes(file.size)}
                        </span>
                      </span>
                    </div>
                    <span
                      className="recompilation__file-downloads"
                      title={t("recompilation_downloads")}
                    >
                      <DownloadIcon size={12} />
                      {formatNumber(file.downloadCount)}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        </aside>
      </div>
    </>
  );
}

/**
 * Prototype of the approved "Recompilations" section of the Classics game
 * page: one native PC port at a time (most downloaded first), switched from
 * the port name with Hydra's DropdownMenu.
 */
export function RecompilationSection({
  ports,
}: Readonly<RecompilationSectionProps>) {
  const headingId = useId();
  const [selectedPortId, setSelectedPortId] = useState(ports[0]?.id);

  const port = ports.find((item) => item.id === selectedPortId) ?? ports[0];
  if (!port) return null;

  return (
    <section className="recompilation" aria-labelledby={headingId}>
      <div className="recompilation__container">
        {/* Keyed by port so switching resets the README, install and reviews. */}
        <PortDetails
          key={port.id}
          port={port}
          ports={ports}
          headingId={headingId}
          onSelectPort={setSelectedPortId}
        />
      </div>
    </section>
  );
}
