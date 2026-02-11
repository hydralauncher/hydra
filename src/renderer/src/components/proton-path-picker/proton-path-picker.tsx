import { useId } from "react";
import type { ProtonVersion } from "@types";
import { Tooltip } from "react-tooltip";
import "./proton-path-picker.scss";

export interface ProtonPathPickerProps {
  versions: ProtonVersion[];
  selectedPath: string;
  onChange: (value: string) => void;
  radioName: string;
  autoLabel: string;
  autoSourceDescription: string;
  steamSourceDescription: string;
  compatibilityToolsSourceDescription: string;
}

const getProtonSourceDescription = (
  source: ProtonVersion["source"],
  versionPath: string,
  steamSourceDescription: string,
  compatibilityToolsSourceDescription: string
) => {
  if (
    source === "compatibility_tools" ||
    versionPath.includes("compatibilitytools.d")
  ) {
    return compatibilityToolsSourceDescription;
  }

  return steamSourceDescription;
};

export function ProtonPathPicker({
  versions,
  selectedPath,
  onChange,
  radioName,
  autoLabel,
  autoSourceDescription,
  steamSourceDescription,
  compatibilityToolsSourceDescription,
}: Readonly<ProtonPathPickerProps>) {
  const protonTooltipId = useId();

  return (
    <div className="proton-path-picker">
      <label
        className={`proton-path-picker__option ${
          selectedPath === "" ? "proton-path-picker__option--selected" : ""
        }`}
        aria-label={autoLabel}
      >
        <input
          type="radio"
          className="proton-path-picker__radio-input"
          name={radioName}
          value=""
          checked={selectedPath === ""}
          onChange={(event) => onChange(event.target.value)}
        />
        <span className="proton-path-picker__radio-control">
          <span className="proton-path-picker__radio-dot" />
        </span>
        <span className="proton-path-picker__option-main">
          <span
            className="proton-path-picker__option-label"
            data-tooltip-id={protonTooltipId}
            data-tooltip-content={autoSourceDescription}
          >
            {autoLabel}
          </span>
        </span>
      </label>

      {versions.map((version) => (
        <label
          key={version.path}
          className={`proton-path-picker__option ${
            selectedPath === version.path
              ? "proton-path-picker__option--selected"
              : ""
          }`}
          aria-label={version.name}
        >
          <input
            type="radio"
            className="proton-path-picker__radio-input"
            name={radioName}
            value={version.path}
            checked={selectedPath === version.path}
            onChange={(event) => onChange(event.target.value)}
          />
          <span className="proton-path-picker__radio-control">
            <span className="proton-path-picker__radio-dot" />
          </span>
          <span className="proton-path-picker__option-main">
            <span
              className="proton-path-picker__option-label"
              data-tooltip-id={protonTooltipId}
              data-tooltip-content={getProtonSourceDescription(
                version.source,
                version.path,
                steamSourceDescription,
                compatibilityToolsSourceDescription
              )}
            >
              {version.name}
            </span>
          </span>
        </label>
      ))}

      <Tooltip id={protonTooltipId} />
    </div>
  );
}
