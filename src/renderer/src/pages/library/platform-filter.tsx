import { useTranslation } from "react-i18next";
import { LibrarySelect } from "./library-select";
import "./platform-filter.scss";

interface PlatformFilterProps {
  platform: string | null;
  platforms: string[];
  disabled?: boolean;
  onPlatformChange: (platform: string | null) => void;
}

export function PlatformFilter({
  platform,
  platforms,
  disabled = false,
  onPlatformChange,
}: Readonly<PlatformFilterProps>) {
  const { t } = useTranslation("library");

  const options = [
    { value: "", label: t("all_consoles") },
    ...platforms.map((p) => ({ value: p, label: p })),
  ];

  return (
    <div className="library-platform-filter__container">
      <LibrarySelect
        value={platform ?? ""}
        disabled={disabled}
        ariaLabel={t("all_consoles")}
        onChange={(value) => onPlatformChange(value === "" ? null : value)}
        options={options}
      />
    </div>
  );
}
