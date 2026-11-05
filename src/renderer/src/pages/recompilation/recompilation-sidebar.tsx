import { useTranslation } from "react-i18next";
import {
  DeviceDesktopIcon,
  DownloadIcon,
  LawIcon,
  LinkExternalIcon,
  MarkGithubIcon,
} from "@primer/octicons-react";
import type { RecompilationDetails, RecompilationReleaseAsset } from "@types";
import {
  countWorkingRecompilationFeatures,
  RECOMPILATION_TESTED_FEATURE_KEYS,
} from "@shared";

import { TestedMedal } from "@renderer/components/tested-medal/tested-medal";
import { useFormat } from "@renderer/hooks";
import { SidebarSection } from "../game-details/sidebar-section/sidebar-section";
import {
  RecompilationInstallSection,
  StatusDot,
} from "./recompilation-install-section";
import type { RecompilationInstall } from "./use-recompilation-install";
import type { RecompilationRom } from "./use-recompilation-rom";
import "../game-details/sidebar/sidebar.scss";

const SYSTEM_LABELS: Record<string, string> = {
  windows: "Windows",
  linux: "Linux",
  macos: "macOS",
};

interface RecompilationSidebarProps {
  details: RecompilationDetails;
  installAsset: RecompilationReleaseAsset | null;
  install: RecompilationInstall;
  rom: RecompilationRom;
}

export function RecompilationSidebar({
  details,
  installAsset,
  install,
  rom,
}: Readonly<RecompilationSidebarProps>) {
  const { t } = useTranslation("recompilation");
  const { numberFormatter } = useFormat();
  const { tested } = details;

  const works = (key: string) =>
    tested.features.find((feature) => feature.key === key)?.status === "works";

  const aboutRows = [
    {
      icon: <DownloadIcon size={14} />,
      label: t("downloads"),
      value: numberFormatter.format(details.downloadCount),
    },
    {
      icon: <DeviceDesktopIcon size={14} />,
      label: t("systems"),
      value: details.systems
        .map((system) => SYSTEM_LABELS[system] ?? system)
        .join(", "),
    },
    ...(details.license
      ? [
          {
            icon: <LawIcon size={14} />,
            label: t("license"),
            value: details.license,
          },
        ]
      : []),
  ];

  return (
    <aside className="content-sidebar">
      <RecompilationInstallSection
        details={details}
        installAsset={installAsset}
        install={install}
        rom={rom}
      />

      <SidebarSection title={t("tested_title")}>
        <div className="recompilation-sidebar">
          <div className="recompilation-sidebar__tested-head">
            <TestedMedal level={tested.level} size={18} />
            <div>
              <strong>{t(`tested_level_${tested.level}`)}</strong>
              <span>
                {t("tested_count", {
                  count: countWorkingRecompilationFeatures(tested),
                  total: RECOMPILATION_TESTED_FEATURE_KEYS.length,
                })}
              </span>
            </div>
          </div>

          <ul className="recompilation-sidebar__features">
            {RECOMPILATION_TESTED_FEATURE_KEYS.map((key) => (
              <li key={key}>
                <StatusDot ok={works(key)} />
                {t(`tested_feature_${key}`)}
              </li>
            ))}
          </ul>
        </div>
      </SidebarSection>

      <SidebarSection title={t("about_project")}>
        <div className="recompilation-sidebar">
          <dl className="recompilation-sidebar__about">
            {aboutRows.map((row) => (
              <div key={row.label}>
                <dt>
                  {row.icon}
                  {row.label}
                </dt>
                <dd>{row.value}</dd>
              </div>
            ))}
          </dl>

          <button
            type="button"
            className="recompilation-sidebar__link"
            onClick={() => window.electron.openExternal(details.repository.url)}
          >
            <MarkGithubIcon size={16} />
            <span>{t("github_repository")}</span>
            <LinkExternalIcon size={14} />
          </button>
        </div>
      </SidebarSection>
    </aside>
  );
}
