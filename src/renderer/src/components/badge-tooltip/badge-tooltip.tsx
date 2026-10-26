import { createPortal } from "react-dom";
import { Tooltip } from "react-tooltip";

export const BADGE_TOOLTIP_ID = "hydra-badge-tooltip";

export function BadgeTooltip() {
  return createPortal(
    <Tooltip
      id={BADGE_TOOLTIP_ID}
      place="top"
      positionStrategy="fixed"
      style={{ zIndex: 9999, maxWidth: 280 }}
    />,
    document.body
  );
}
