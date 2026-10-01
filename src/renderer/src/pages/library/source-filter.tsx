import { useTranslation } from "react-i18next";
import { LibraryMultiSelect } from "./library-multi-select";
import { LIBRARY_SOURCES, type LibrarySource } from "./library-category";
import { SourceIcon } from "./source-icon";
import "./source-filter.scss";

interface SourceFilterProps {
  selectedSources: LibrarySource[];
  disabled?: boolean;
  onSourcesChange: (sources: LibrarySource[]) => void;
}

export function SourceFilter({
  selectedSources,
  disabled = false,
  onSourcesChange,
}: Readonly<SourceFilterProps>) {
  const { t } = useTranslation("library");

  const allLabel = t("all_libraries");
  const sourceLabels: Record<LibrarySource, string> = {
    hydra: t("library_hydra"),
    steam: t("library_steam"),
  };

  const selectedSource =
    selectedSources.length === 1 ? selectedSources[0] : null;

  return (
    <div className="library-source-filter__container">
      <LibraryMultiSelect
        value={selectedSources}
        disabled={disabled}
        ariaLabel={allLabel}
        allLabel={allLabel}
        triggerLabel={selectedSource ? sourceLabels[selectedSource] : allLabel}
        triggerIcon={
          selectedSource ? <SourceIcon source={selectedSource} /> : undefined
        }
        singleSelect
        onChange={(sources) =>
          onSourcesChange(
            LIBRARY_SOURCES.filter((source) => sources.includes(source))
          )
        }
        options={LIBRARY_SOURCES.map((source) => ({
          value: source,
          label: sourceLabels[source],
          icon: <SourceIcon source={source} />,
        }))}
      />
    </div>
  );
}
