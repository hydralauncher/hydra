import { useTranslation } from "react-i18next";
import cn from "classnames";
import {
  ClockIcon,
  CloudIcon,
  PlayIcon,
  TrophyIcon,
  type Icon,
} from "@primer/octicons-react";
import { Gamepad2 } from "lucide-react";
import type {
  RecompilationDetails,
  RecompilationRelease,
  RecompilationReleaseAsset,
  RecompilationTestedFeatureStatus,
} from "@types";
import {
  countWorkingRecompilationFeatures,
  RECOMPILATION_TESTED_FEATURE_KEYS,
} from "@shared";

import { TestedMedal } from "@renderer/components/tested-medal/tested-medal";
import { useDate, useFormat } from "@renderer/hooks";
import { SidebarSection } from "../game-details/sidebar-section/sidebar-section";
import { RecompilationInstallSection } from "./recompilation-install-section";
import type { RecompilationInstall } from "./use-recompilation-install";
import type { RecompilationRom } from "./use-recompilation-rom";
import "../game-details/sidebar/launchbox-details-section.scss";
import "../game-details/sidebar/sidebar.scss";

const FEATURE_ICONS: Record<string, Icon | typeof Gamepad2> = {
  launch: PlayIcon,
  playtime: ClockIcon,
  cloudSaves: CloudIcon,
  achievements: TrophyIcon,
  controllerBigPicture: Gamepad2,
};

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
  releases: RecompilationRelease[];
  onSelectRelease: (tag: string) => void;
}

export function RecompilationSidebar({
  details,
  installAsset,
  install,
  rom,
  releases,
  onSelectRelease,
}: Readonly<RecompilationSidebarProps>) {
  const { t } = useTranslation("recompilation");
  const { formatDate } = useDate();
  const { numberFormatter } = useFormat();
  const { tested } = details;

  const statusOf = (key: string): RecompilationTestedFeatureStatus | null =>
    tested.features.find((feature) => feature.key === key)?.status ?? null;

  const testedSubtitle =
    tested.level === "untested"
      ? t("tested_untested_description")
      : t("tested_summary", {
          count: countWorkingRecompilationFeatures(tested),
          version: tested.testedVersion ?? details.version,
        });

  const rows: [string, string][] = [
    [t("downloads"), numberFormatter.format(details.downloadCount)],
    [t("version"), details.version],
    [t("released"), formatDate(details.releasedAt)],
    [
      t("systems"),
      details.systems
        .map((system) => SYSTEM_LABELS[system] ?? system)
        .join(", "),
    ],
  ];
  if (details.license) rows.push([t("license"), details.license]);

  return (
    <aside className="content-sidebar">
      <SidebarSection title={t("tested_title")}>
        <div className="recompilation-page__tested-head">
          <TestedMedal level={tested.level} size={32} />
          <div>
            <strong>{t(`tested_level_${tested.level}`)}</strong>
            <p>{testedSubtitle}</p>
            {!tested.isLatestTested && tested.level !== "untested" && (
              <p>{t("tested_older_version")}</p>
            )}
          </div>
        </div>
        <div className="stats__section">
          {RECOMPILATION_TESTED_FEATURE_KEYS.map((key) => {
            const status = statusOf(key);
            const FeatureIcon = FEATURE_ICONS[key];
            return (
              <div key={key} className="stats__category">
                <p className="stats__category-title">
                  <FeatureIcon size={14} />
                  {t(`tested_feature_${key}`)}
                </p>
                <p
                  className={cn({
                    "recompilation-page__feature--off": status !== "works",
                  })}
                >
                  {status ? t(`tested_status_${status}`) : "—"}
                </p>
              </div>
            );
          })}
        </div>
      </SidebarSection>

      <RecompilationInstallSection
        details={details}
        installAsset={installAsset}
        install={install}
        rom={rom}
      />

      {releases.length > 0 && (
        <SidebarSection title={t("updates")}>
          <ul className="recompilation-page__list">
            {releases.map((release) => (
              <li key={release.tag} className="recompilation-page__list-row">
                <button
                  type="button"
                  className={cn("recompilation-page__list-link", {
                    "recompilation-page__list-link--active": release.isLatest,
                  })}
                  onClick={() => onSelectRelease(release.tag)}
                >
                  <span>{release.tag}</span>
                  <span className="recompilation-page__muted">
                    {formatDate(release.publishedAt)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </SidebarSection>
      )}

      <SidebarSection title={t("details")}>
        <div className="launchbox-details">
          {rows.map(([label, value]) => (
            <div key={label} className="launchbox-details__row">
              <span className="launchbox-details__label">{label}</span>
              <span className="launchbox-details__value">{value}</span>
            </div>
          ))}
        </div>
      </SidebarSection>
    </aside>
  );
}
