import { useTranslation } from "react-i18next";
import { ClockIcon } from "@primer/octicons-react";

export const MISSIONS_TAB_PENDING_TOOLTIP_ID = "missions-tab-pending-tooltip";
export const PASSIVES_PENDING_TOOLTIP_ID = "passives-pending-tooltip";

export function PendingModerationBadge({
  count,
  tooltipId,
}: Readonly<{ count: number; tooltipId: string }>) {
  const { t } = useTranslation("user_profile");

  if (count <= 0) return null;

  const label = t("mission_awaiting_review", { count });

  return (
    <span
      className="pending-moderation-badge"
      role="img"
      aria-label={label}
      data-tooltip-id={tooltipId}
      data-tooltip-place="top"
      data-tooltip-content={label}
    >
      <ClockIcon size={12} />
    </span>
  );
}
