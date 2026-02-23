import { useId } from "react";
import type { ProtonVersion } from "@types";
import { Tooltip } from "react-tooltip";
import { RadioField } from "../radio-field/radio-field";
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
      <RadioField
        name={radioName}
        value=""
        checked={selectedPath === ""}
        onChange={(event) => onChange(event.target.value)}
        className="proton-path-picker__option"
        labelClassName="proton-path-picker__option-label"
        label={
          <span
            data-tooltip-id={protonTooltipId}
            data-tooltip-content={autoSourceDescription}
          >
            {autoLabel}
          </span>
        }
        aria-label={autoLabel}
      />

      {versions.map((version) => (
        <RadioField
          key={version.path}
          name={radioName}
          value={version.path}
          checked={selectedPath === version.path}
          onChange={(event) => onChange(event.target.value)}
          className="proton-path-picker__option"
          labelClassName="proton-path-picker__option-label"
          label={
            <span
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
          }
          aria-label={version.name}
        />
      ))}

      <Tooltip id={protonTooltipId} />
    </div>
  );
}
