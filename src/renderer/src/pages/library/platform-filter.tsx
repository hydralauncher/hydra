import { useTranslation } from "react-i18next";
import { LibraryMultiSelect } from "./library-multi-select";
import "./platform-filter.scss";

interface PlatformFilterProps {
  selectedPlatforms: string[];
  platforms: string[];
  disabled?: boolean;
  onPlatformsChange: (platforms: string[]) => void;
}

export function PlatformFilter({
  selectedPlatforms,
  platforms,
  disabled = false,
  onPlatformsChange,
}: Readonly<PlatformFilterProps>) {
  const { t } = useTranslation("library");

  const allLabel = t("all_consoles");

  const getTriggerLabel = () => {
    if (selectedPlatforms.length === 0) return allLabel;
    if (selectedPlatforms.length === 1) return selectedPlatforms[0];
    return t("selected_consoles", { count: selectedPlatforms.length });
  };

  return (
    <div className="library-platform-filter__container">
      <LibraryMultiSelect
        value={selectedPlatforms}
        disabled={disabled}
        ariaLabel={allLabel}
        allLabel={allLabel}
        triggerLabel={getTriggerLabel()}
        onChange={onPlatformsChange}
        options={platforms.map((platform) => ({
          value: platform,
          label: platform,
        }))}
      />
    </div>
  );
}
