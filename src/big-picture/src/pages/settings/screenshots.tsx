import "./screenshots.scss";

import { SETTINGS_HEADER_RETURN_TARGET } from "./settings-navigation";
import { ScreenshotSettingsSection } from "./screenshots-section";

interface SettingsSectionProps {
  className?: string;
}

export function ScreenshotsSettingsSection({
  className,
}: Readonly<SettingsSectionProps>) {
  return (
    <div
      className={
        className
          ? `screenshots-settings-tab ${className}`
          : "screenshots-settings-tab"
      }
    >
      <ScreenshotSettingsSection upTarget={SETTINGS_HEADER_RETURN_TARGET} />
    </div>
  );
}
