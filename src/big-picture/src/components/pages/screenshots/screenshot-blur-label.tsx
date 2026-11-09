import { EyeSlashIcon, WarningCircleIcon } from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";

import type { ScreenshotBlurReason } from "./helpers";

interface ScreenshotBlurLabelProps {
  className: string;
  reason: ScreenshotBlurReason;
  iconSize: number;
}

export function ScreenshotBlurLabel({
  className,
  reason,
  iconSize,
}: Readonly<ScreenshotBlurLabelProps>) {
  const { t } = useTranslation("big_picture");

  if (reason === "sensitive") {
    return (
      <span className={className}>
        <WarningCircleIcon size={iconSize} weight="bold" />
        {t("screenshots_sensitive")}
      </span>
    );
  }

  return (
    <span className={className}>
      <EyeSlashIcon size={iconSize} weight="bold" />
      {t("screenshots_spoiler")}
    </span>
  );
}
