import { useTranslation } from "react-i18next";
import { ClockIcon } from "@primer/octicons-react";

export const PENDING_MODERATION_TOOLTIP_ID = "pending-moderation-tooltip";

export function PendingModerationBadge({ count }: Readonly<{ count: number }>) {
  const { t } = useTranslation("user_profile");

  if (count <= 0) return null;

  const label = t("mission_awaiting_review", { count });

  return (
    <span
      className="pending-moderation-badge"
      role="img"
      aria-label={label}
      data-tooltip-id={PENDING_MODERATION_TOOLTIP_ID}
      data-tooltip-place="top"
      data-tooltip-content={label}
    >
      <ClockIcon size={14} />
    </span>
  );
}
