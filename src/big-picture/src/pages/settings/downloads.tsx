import "./downloads.scss";

import { DownloadsBehaviorSection } from "./downloads-behavior-section";
import { DownloadsSourcesSection } from "./downloads-sources-section";
import { DOWNLOADS_SOURCES_ACTIONS_REGION_ID } from "./settings-navigation";

interface SettingsSectionProps {
  className?: string;
}

export function DownloadsSettingsSection({
  className,
}: Readonly<SettingsSectionProps>) {
  return (
    <div
      className={
        className
          ? `downloads-settings-section ${className}`
          : "downloads-settings-section"
      }
    >
      <DownloadsBehaviorSection
        lastItemDownTarget={{
          type: "region",
          regionId: DOWNLOADS_SOURCES_ACTIONS_REGION_ID,
          entryDirection: "down",
          preferRememberedFocus: false,
        }}
      />
      <DownloadsSourcesSection />
    </div>
  );
}
