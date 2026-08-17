import { useTranslation } from "react-i18next";
import { GearIcon } from "@primer/octicons-react";
import { Activity, Globe } from "lucide-react";

interface DownloadsHeroMetricsProps {
  sourceName: string;
  currentNetworkSpeed: number;
  peakSpeed: number;
  currentDiskSpeed: number;
  formatSpeed: (bytesPerSecond: number) => string;
  onOpenSettings: () => void;
}

export function DownloadsHeroMetrics({
  sourceName,
  currentNetworkSpeed,
  peakSpeed,
  currentDiskSpeed,
  formatSpeed,
  onOpenSettings,
}: Readonly<DownloadsHeroMetricsProps>) {
  const { t } = useTranslation("downloads");

  return (
    <div className="downloads-hero__metrics-row">
      <div className="downloads-hero__metric downloads-hero__metric--source">
        <span className="downloads-hero__metric-label">
          <Globe
            size={12}
            className="downloads-hero__metric-icon downloads-hero__metric-icon--purple"
          />
          {t("source", { defaultValue: "FONTE" })}
        </span>
        <span
          className="downloads-hero__metric-value downloads-hero__metric-value--text"
          title={sourceName}
        >
          {sourceName}
        </span>
      </div>

      <div className="downloads-hero__metric">
        <span className="downloads-hero__metric-label">
          <Activity
            size={12}
            className="downloads-hero__metric-icon downloads-hero__metric-icon--blue"
          />
          {t("network", { defaultValue: "REDE" })}
        </span>
        <span className="downloads-hero__metric-value">
          {formatSpeed(currentNetworkSpeed)}
        </span>
      </div>

      <div className="downloads-hero__metric">
        <span className="downloads-hero__metric-label">
          <Activity
            size={12}
            className="downloads-hero__metric-icon downloads-hero__metric-icon--blue"
          />
          {t("peak", { defaultValue: "MÁXIMA" })}
        </span>
        <span className="downloads-hero__metric-value">
          {formatSpeed(peakSpeed)}
        </span>
      </div>

      <div className="downloads-hero__metric">
        <span className="downloads-hero__metric-label">
          <span className="downloads-hero__metric-line" />
          {t("storage", { defaultValue: "ARMAZENAMENTO" })}
        </span>
        <span className="downloads-hero__metric-value">
          {formatSpeed(currentDiskSpeed)}
        </span>
      </div>

      <button
        type="button"
        className="downloads-hero__settings-btn"
        onClick={onOpenSettings}
        title={t("downloads_settings", {
          defaultValue: "Configurações de Download",
        })}
      >
        <GearIcon size={14} />
      </button>
    </div>
  );
}
