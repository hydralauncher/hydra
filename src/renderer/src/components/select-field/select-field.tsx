import { useId, useState } from "react";
import "./select-field.scss";
import cn from "classnames";

export interface SelectProps
  extends React.DetailedHTMLProps<
    React.SelectHTMLAttributes<HTMLSelectElement>,
    HTMLSelectElement
  > {
  theme?: "primary" | "dark";
  label?: string;
  options?: { key: string; value: string; label: string }[];
}

export function SelectField({
  value,
  label,
  options = [{ key: "-", value: value?.toString() || "-", label: "-" }],
  theme = "primary",
  onChange,
}: SelectProps) {
  const [isFocused, setIsFocused] = useState(false);
  const id = useId();

  return (
    <div style={{ flex: 1 }}>
      {label && (
        <label htmlFor={id} className="select-field__label">
          {label}
        </label>
      )}

      <div
        className={cn("select-field", `select-field--${theme}`, {
          "select-field__focused": isFocused,
        })}
      >
        <select
          id={id}
          value={value}
          className="select-field__option"
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          onChange={onChange}
        >
          {options.map((option) => (
            <option key={option.key} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
