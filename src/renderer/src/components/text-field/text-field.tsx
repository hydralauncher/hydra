import { useId, useState } from "react";
import type { RecipeVariants } from "@vanilla-extract/recipes";
import * as styles from "./text-field.css";

export interface TextFieldProps
  extends React.DetailedHTMLProps<
    React.InputHTMLAttributes<HTMLInputElement>,
    HTMLInputElement
  > {
  theme?: NonNullable<RecipeVariants<typeof styles.textField>>["theme"];
  label?: string | React.ReactNode;
  hint?: string | React.ReactNode;
  textFieldProps?: React.DetailedHTMLProps<
    React.HTMLAttributes<HTMLDivElement>,
    HTMLDivElement
  >;
  containerProps?: React.DetailedHTMLProps<
    React.HTMLAttributes<HTMLDivElement>,
    HTMLDivElement
  >;
}

export function TextField({
  theme = "primary",
  label,
  hint,
  textFieldProps,
  containerProps,
  ...props
}: TextFieldProps) {
  const [isFocused, setIsFocused] = useState(false);
  const id = useId();

  return (
    <div className={styles.textFieldContainer} {...containerProps}>
      {label && <label htmlFor={id}>{label}</label>}

      <div
        className={styles.textField({ focused: isFocused, theme })}
        {...textFieldProps}
      >
        <input
          id={id}
          type="text"
          className={styles.textFieldInput}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          {...props}
        />
      </div>

      {hint && <small>{hint}</small>}
    </div>
  );
}
