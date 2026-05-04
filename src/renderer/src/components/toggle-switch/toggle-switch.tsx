import { useId } from "react";
import "./toggle-switch.scss";

export interface ToggleSwitchProps {
  label: string;
  description?: string;
  checked: boolean;
  disabled?: boolean;
  onChange: () => void;
}

export function ToggleSwitch({
  label,
  description,
  checked,
  disabled,
  onChange,
}: ToggleSwitchProps) {
  const id = useId();

  return (
    <label
      htmlFor={id}
      className={`toggle-switch ${disabled ? "toggle-switch--disabled" : ""}`}
    >
      <div className="toggle-switch__text">
        <span className="toggle-switch__label">{label}</span>
        {description && (
          <span className="toggle-switch__description">{description}</span>
        )}
      </div>

      <div className="toggle-switch__track-wrapper">
        <input
          id={id}
          type="checkbox"
          className="toggle-switch__input"
          checked={checked}
          disabled={disabled}
          onChange={onChange}
        />
        <div
          className={`toggle-switch__track ${checked ? "toggle-switch__track--on" : ""}`}
        >
          <div className="toggle-switch__thumb" />
        </div>
      </div>
    </label>
  );
}
