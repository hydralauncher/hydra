import { AppsIcon, RowsIcon, SquareIcon } from "@primer/octicons-react";
import { useTranslation } from "react-i18next";
import "./view-options.scss";

export type ViewMode = "grid" | "compact" | "large";

interface ViewOptionsProps {
  viewMode: ViewMode;
  onViewModeChange: (viewMode: ViewMode) => void;
}

export function ViewOptions({ viewMode, onViewModeChange }: ViewOptionsProps) {
  const { t } = useTranslation("library");

  return (
    <div className="library-view-options__container">
      <div className="library-view-options__options">
        <button
          className={`library-view-options__option ${viewMode === "compact" ? "active" : ""}`}
          onClick={() => onViewModeChange("compact")}
          title={t("compact_view")}
        >
          <SquareIcon size={16} />
        </button>
        <button
          className={`library-view-options__option ${viewMode === "grid" ? "active" : ""}`}
          onClick={() => onViewModeChange("grid")}
          title={t("grid_view")}
        >
          <AppsIcon size={16} />
        </button>
        <button
          className={`library-view-options__option ${viewMode === "large" ? "active" : ""}`}
          onClick={() => onViewModeChange("large")}
          title={t("large_view")}
        >
          <RowsIcon size={16} />
        </button>
      </div>
    </div>
  );
}
