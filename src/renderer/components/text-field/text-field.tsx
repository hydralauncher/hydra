import { useId, useState } from "react";
import type { RecipeVariants } from "@vanilla-extract/recipes";
import * as styles from "./text-field.css";

export interface TextFieldProps
  extends React.DetailedHTMLProps<
    React.InputHTMLAttributes<HTMLInputElement>,
    HTMLInputElement
  > {
  theme?: RecipeVariants<typeof styles.textField>["theme"];
  label?: string;
}

export function TextField({
  theme = "primary",
  label,
  ...props
}: TextFieldProps) {
  const [isFocused, setIsFocused] = useState(false);
  const id = useId();

  return (
    <div style={{ flex: 1 }}>
      {label && (
        <label htmlFor={id} className={styles.label}>
          {label}
        </label>
      )}

      <div className={styles.textField({ focused: isFocused, theme })}>
        <input
          id={id}
          type="text"
          className={styles.textFieldInput}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          {...props}
        />
      </div>
    </div>
  );
}
