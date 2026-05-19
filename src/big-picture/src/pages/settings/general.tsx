import { DownloadDirectoriesSection } from "./download-directories-section";

interface SettingsSectionProps {
  className?: string;
}

export function GeneralSettingsSection({
  className,
}: Readonly<SettingsSectionProps>) {
  return <DownloadDirectoriesSection className={className} />;
}
