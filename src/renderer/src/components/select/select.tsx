import { useId, useState } from "react";
import type { RecipeVariants } from "@vanilla-extract/recipes";
import * as styles from "./select.css";

export interface SelectProps
  extends React.DetailedHTMLProps<
    React.InputHTMLAttributes<HTMLInputElement>,
    HTMLInputElement
  > {
  theme?: NonNullable<RecipeVariants<typeof styles.select>>["theme"];
  label?: string;
}

export function Select({
  theme = "primary",
  label,
  children,
  onChange,
  ...props
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
          className={styles.option}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          onChange={onChange} // Adiciona a função onChange aqui
        >
          {children}
        </select>
      </div>
    </div>
  );
}
