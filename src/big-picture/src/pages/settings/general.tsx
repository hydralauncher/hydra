import "./general.scss";

import { BehaviorSection } from "./behavior-section";
import { DownloadDirectoriesSection } from "./download-directories-section";
import { LanguageSection } from "./language-section";

interface SettingsSectionProps {
  className?: string;
}

export function GeneralSettingsSection({
  className,
}: Readonly<SettingsSectionProps>) {
  return (
    <div
      className={
        className
          ? `general-settings-section ${className}`
          : "general-settings-section"
      }
    >
      <DownloadDirectoriesSection />
      <LanguageSection />
      <BehaviorSection />
    </div>
  );
}
