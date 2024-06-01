import { useId, useState } from "react";
import type { RecipeVariants } from "@vanilla-extract/recipes";
import * as styles from "./select.css";

export interface SelectProps
  extends React.DetailedHTMLProps<
    React.SelectHTMLAttributes<HTMLSelectElement>,
    HTMLSelectElement
  > {
  theme?: NonNullable<RecipeVariants<typeof styles.select>>["theme"];
  label?: string;
  options?: { key: string; value: string; label: string }[];
}

export function Select({
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
        <label htmlFor={id} className={styles.label}>
          {label}
        </label>
      )}

      <div className={styles.select({ focused: isFocused, theme })}>
        <select
          id={id}
          value={value}
          className={styles.option}
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
