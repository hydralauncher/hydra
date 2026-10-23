import "./screenshots.scss";

import { Suspense, lazy } from "react";

import { SETTINGS_HEADER_RETURN_TARGET } from "./settings-navigation";
import {
  SCREENSHOTS_DEV_ENTRY_FOCUS_ID,
  SCREENSHOT_SETTINGS_FOCUS_IDS,
  ScreenshotSettingsSection,
} from "./screenshots-section";

const ScreenshotsDevSection = import.meta.env.DEV
  ? lazy(() => import("./screenshots-dev-section"))
  : null;

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
      <ScreenshotSettingsSection
        upTarget={SETTINGS_HEADER_RETURN_TARGET}
        downFocusId={
          ScreenshotsDevSection ? SCREENSHOTS_DEV_ENTRY_FOCUS_ID : null
        }
      />

      {ScreenshotsDevSection ? (
        <Suspense fallback={null}>
          <ScreenshotsDevSection
            upFocusId={SCREENSHOT_SETTINGS_FOCUS_IDS.folder}
          />
        </Suspense>
      ) : null}
    </div>
  );
}
