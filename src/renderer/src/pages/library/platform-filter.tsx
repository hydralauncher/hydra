import { useTranslation } from "react-i18next";
import { SelectField } from "@renderer/components";
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
    { key: "all", value: "", label: t("all_consoles") },
    ...platforms.map((p) => ({ key: p, value: p, label: p })),
  ];

  return (
    <div className="library-platform-filter__container">
      <SelectField
        className="library-platform-filter__select"
        value={platform ?? ""}
        disabled={disabled}
        onChange={(event) =>
          onPlatformChange(
            event.target.value === "" ? null : event.target.value
          )
        }
        options={options}
      />
    </div>
  );
}
