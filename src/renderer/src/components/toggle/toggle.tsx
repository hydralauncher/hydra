import { useId } from "react";
import cn from "classnames";
import "./toggle.scss";

interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
  disabled?: boolean;
  className?: string;
}

export function Toggle({
  checked,
  onChange,
  label,
  disabled = false,
  className,
}: Readonly<ToggleProps>) {
  const id = useId();

  return (
    <label
      htmlFor={id}
      className={cn("toggle", className, { "toggle--disabled": disabled })}
      aria-disabled={disabled}
    >
      <input
        id={id}
        type="checkbox"
        className="toggle__input"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />

      <span
        className={cn("toggle__track", { "toggle__track--checked": checked })}
      >
        <span
          className={cn("toggle__thumb", {
            "toggle__thumb--checked": checked,
          })}
        />
      </span>

      {label && (
        <span
          className={cn("toggle__label", {
            "toggle__label--checked": checked,
          })}
        >
          {label}
        </span>
      )}
    </label>
  );
}
