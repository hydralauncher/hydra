import { useTranslation } from "react-i18next";
import type { DownloadSource, GameRepack } from "@types";
import cn from "classnames";

export interface RepacksSourcesSidebarProps {
  sources: DownloadSource[];
  selectedFingerprints: string[];
  onToggleFingerprint: (fingerprint: string) => void;
  onClearFingerprints: () => void;
  repacks: GameRepack[];
}

export function RepacksSourcesSidebar({
  sources,
  selectedFingerprints,
  onToggleFingerprint,
  onClearFingerprints,
  repacks,
}: Readonly<RepacksSourcesSidebarProps>) {
  const { t } = useTranslation("game_details");

  const validSources = sources.filter(
    (s): s is DownloadSource & { fingerprint: string } =>
      s.fingerprint !== undefined
  );

  const getSourceCount = (source: DownloadSource) => {
    return repacks.filter(
      (r) =>
        r.downloadSourceId === source.id ||
        (source.name &&
          r.downloadSourceName?.toLowerCase() === source.name.toLowerCase())
    ).length;
  };

  return (
    <aside className="repacks-modal__sidebar">
      <div className="repacks-modal__sidebar-header">
        <span className="repacks-modal__sidebar-title">
          {t("filter_by_source", { defaultValue: "Fontes" })}
        </span>
        {selectedFingerprints.length > 0 && (
          <button
            type="button"
            className="repacks-modal__sidebar-clear-btn"
            onClick={onClearFingerprints}
          >
            {t("clear", { defaultValue: "Limpar" })}
          </button>
        )}
      </div>

      <div className="repacks-modal__sidebar-list">
        <button
          type="button"
          className={cn("repacks-modal__sidebar-item", {
            "repacks-modal__sidebar-item--active":
              selectedFingerprints.length === 0,
          })}
          onClick={onClearFingerprints}
        >
          <span className="repacks-modal__sidebar-item-name">
            {t("all_sources", { defaultValue: "Todas as fontes" })}
          </span>
          <span className="repacks-modal__sidebar-item-count">
            {repacks.length}
          </span>
        </button>

        {validSources.map((source) => {
          const isSelected = selectedFingerprints.includes(source.fingerprint);
          const count = getSourceCount(source);

          return (
            <button
              key={source.fingerprint}
              type="button"
              className={cn("repacks-modal__sidebar-item", {
                "repacks-modal__sidebar-item--active": isSelected,
              })}
              onClick={() => onToggleFingerprint(source.fingerprint)}
            >
              <span
                className="repacks-modal__sidebar-item-name"
                title={source.name || source.url}
              >
                {source.name || source.url}
              </span>
              <span className="repacks-modal__sidebar-item-count">{count}</span>
            </button>
          );
        })}
      </div>
    </aside>
  );
}
