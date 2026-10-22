import { useTranslation } from "react-i18next";
import { formatScreenshotHotkey, resolveScreenshotPreferences } from "@shared";

import { useUserPreferences } from "../../../../hooks";

export function ScreenshotHotkeyHint({
  className,
}: Readonly<{ className?: string }>) {
  const { t } = useTranslation("big_picture");
  const userPreferences = useUserPreferences();
  const hotkey = formatScreenshotHotkey(
    resolveScreenshotPreferences(userPreferences).hotkey
  );

  return (
    <p className={className}>{t("screenshots_empty_own_hint", { hotkey })}</p>
  );
}
