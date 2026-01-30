import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useGamepadContext } from "../../context/gamepad";
import { PsIcon, XboxIcon } from "../icons/controller-icons";
import "./controller-indicator.scss";

/**
 * Visual indicator that shows when controller mode is active.
 * Displays in the corner of the screen with the current controller name.
 */
export function ControllerIndicator() {
  const { isControllerMode, activeGamepad } = useGamepadContext();
  const { t } = useTranslation();

  // Preview state for cycling icons
  const [previewType, setPreviewType] = useState<string | null>(null);

  if (!isControllerMode) {
    return null;
  }

  const controllerName =
    activeGamepad?.id?.split("(")[0]?.trim() || "Controller";

  const rawId = (activeGamepad?.id || "").toLowerCase();

  // Determine icon type: preview override -> explicit detection -> default
  const isPlayStation =
    previewType === "ps" ||
    (previewType === null &&
      (rawId.includes("sony") ||
        rawId.includes("dual") ||
        rawId.includes("ps4") ||
        rawId.includes("ps5")));

  const handleIconClick = () => {
    // Cycle: Auto -> Xbox -> PS -> Auto
    if (previewType === null) setPreviewType("xbox");
    else if (previewType === "xbox") setPreviewType("ps");
    else setPreviewType(null);
  };

  const previewLabel = previewType === "ps" ? "PS" : "Xbox";
  const displayText = previewType
    ? `[Preview: ${previewLabel}]`
    : controllerName;

  return (
    <div className="controller-indicator">
      <button
        type="button"
        className="controller-indicator__left"
        onClick={handleIconClick}
        title="Click to preview controller icons"
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") handleIconClick();
        }}
      >
        {isPlayStation ? (
          <PsIcon className="controller-indicator__icon" />
        ) : (
          <XboxIcon className="controller-indicator__icon" />
        )}
        <span className="controller-indicator__text">{displayText}</span>
      </button>

      <div className="controller-indicator__legend">
        <div className="legend-item">
          <span className="legend-btn">A</span>
          <span className="legend-label">
            {t("controller.select", "Select")}
          </span>
        </div>
        <div className="legend-item">
          <span className="legend-btn">B</span>
          <span className="legend-label">{t("controller.back", "Back")}</span>
        </div>
        <div className="legend-item">
          <span className="legend-btn">LB / RB</span>
          <span className="legend-label">{t("controller.tab", "Tab")}</span>
        </div>
        <div className="legend-item">
          <span className="legend-btn">Y</span>
          <span className="legend-label">
            {t("controller.search", "Search")}
          </span>
        </div>
      </div>
    </div>
  );
}
